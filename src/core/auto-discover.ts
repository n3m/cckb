import { FileCollector, type CollectionResult } from "./file-collector.js";
import { ChunkManager, type FileChunk } from "./chunk-manager.js";
import { VaultIntegrator } from "./vault-integrator.js";
import { spawnClaudeAgent, isClaudeAvailable, type ProgressEvent } from "../utils/claude-sdk.js";
import { loadConfig } from "../utils/config.js";
import type {
  Summary,
  ExtractedEntity,
  ArchitectureItem,
  ServiceItem,
  KnowledgeItem,
} from "./compaction-engine.js";

const DISCOVERY_PROMPT = `You are a technical knowledge extractor analyzing a codebase. Extract information for a project knowledge base.

PROJECT CONTEXT:
- Language(s): {languages}
- Project Type: {projectType}

ANALYZE THESE SOURCE FILES:

{fileContents}

Extract and format the following:

## Entities
For each domain entity (data model, type, class, interface):
- **Name**: Entity name
- **Location**: File path
- **Attributes**: Key fields/properties
- **Relations**: Related entities

## Architecture
For each architectural pattern or design decision:
- **Pattern**: Name of pattern (e.g., MVC, Repository, Factory, Singleton, etc.)
- **Description**: Brief explanation of how it's used
- **Affected Files**: Relevant file paths

## Services
For each service or component:
- **Name**: Service name
- **Location**: File path
- **Purpose**: Brief description
- **Methods**: Key methods/functions

## Knowledge
For each convention, rule, or important context discovered:
- **Topic**: What it's about
- **Details**: The actual information

Guidelines:
- Only include sections that have content
- Be concise but complete
- Use exact file paths as shown
- Focus on domain logic, not framework boilerplate
- Identify patterns from code structure, not just naming
`;

export interface DiscoverOptions {
  maxFiles?: number;
  maxChunkSize?: number;
  verbose?: boolean;
}

export interface DiscoveryResult {
  summary: Summary;
  filesAnalyzed: number;
  chunksProcessed: number;
  duration: number;
  integrated: boolean;
}

export class AutoDiscover {
  private projectPath: string;
  private verbose: boolean;

  constructor(projectPath: string, verbose = false) {
    this.projectPath = projectPath;
    this.verbose = verbose;
  }

  async discover(options?: DiscoverOptions): Promise<DiscoveryResult> {
    const startTime = Date.now();
    const config = await loadConfig(this.projectPath);

    const maxFiles = options?.maxFiles ?? config.discover.maxFiles;
    const maxChunkSize = options?.maxChunkSize ?? config.discover.maxChunkSize;

    this.log("Discovering codebase...\n");

    // Step 1: Collect files
    const collector = new FileCollector(this.projectPath);
    const collection = await collector.collect({ maxFiles });

    this.log(`Detected: ${collection.languages.join(", ")} (${collection.projectType} project)`);
    this.log(`Collected: ${collection.totalFilesScanned} files → ${collection.files.length} prioritized`);

    if (collection.files.length === 0) {
      this.log("No source files found to analyze.");
      return this.createEmptyResult(startTime);
    }

    // Step 2: Check Claude availability
    const claudeAvailable = await isClaudeAvailable();
    if (!claudeAvailable) {
      this.log("Claude CLI not available. Using fallback analysis...");
      return this.fallbackDiscovery(collection, startTime);
    }

    // Step 3: Prepare chunks
    const chunkManager = new ChunkManager(collection.files, { maxChunkSize });
    const chunks = await chunkManager.prepareChunks();

    this.log(`Grouped into ${chunks.length} chunks\n`);
    this.log("Analyzing with Claude...");

    // Step 4: Analyze each chunk with Claude
    const partialSummaries: Summary[] = [];
    let chunksProcessed = 0;

    for (const chunk of chunks) {
      const chunkKB = Math.round(chunk.content.length / 1024);
      this.log(`  [${chunk.index + 1}/${chunk.totalChunks}] Analyzing ${chunk.files.length} files (~${chunkKB}KB, ~${chunk.estimatedTokens} tokens)...`);

      try {
        const summary = await this.analyzeChunk(chunk, collection);
        partialSummaries.push(summary);
        chunksProcessed++;

        // Rate limiting between chunks
        if (chunk.index < chunks.length - 1) {
          await this.delay(1500);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.log(`    Warning: Chunk ${chunk.index + 1} analysis failed: ${errorMsg}`);
        // Continue with other chunks
      }
    }

    if (partialSummaries.length === 0) {
      this.log("\nNo successful analyses. Using fallback...");
      return this.fallbackDiscovery(collection, startTime);
    }

    // Step 5: Merge summaries
    const mergedSummary = this.mergeSummaries(partialSummaries);

    // Step 6: Integrate into vault
    this.log("\nIntegrating into vault...");
    let integrated = false;

    try {
      const integrator = new VaultIntegrator(this.projectPath);
      await integrator.integrate(mergedSummary);
      integrated = true;

      this.log(`  ${mergedSummary.entities.length} entities`);
      this.log(`  ${mergedSummary.architecture.length} patterns`);
      this.log(`  ${mergedSummary.services.length} services`);
      this.log(`  ${mergedSummary.knowledge.length} knowledge items`);
    } catch (error) {
      this.log(`  Warning: Vault integration failed: ${error}`);
    }

    const duration = Date.now() - startTime;
    this.log(`\nDiscovery complete (${(duration / 1000).toFixed(1)}s)`);

    return {
      summary: mergedSummary,
      filesAnalyzed: collection.files.length,
      chunksProcessed,
      duration,
      integrated,
    };
  }

  private async analyzeChunk(
    chunk: FileChunk,
    collection: CollectionResult
  ): Promise<Summary> {
    const prompt = DISCOVERY_PROMPT
      .replace("{languages}", collection.languages.join(", "))
      .replace("{projectType}", collection.projectType)
      .replace("{fileContents}", chunk.content);

    const response = await spawnClaudeAgent(prompt, {
      timeout: 600000, // 10 minutes
      onProgress: (event) => this.handleProgress(event, chunk),
      onStderr: (data) => {
        // Stream Claude's stderr in real-time for debugging
        if (this.verbose) {
          process.stderr.write(`      [Claude] ${data}`);
        }
      },
    });

    return this.parseResponse(response, chunk);
  }

  private handleProgress(event: ProgressEvent, chunk: FileChunk): void {
    const prefix = `      [${chunk.index + 1}/${chunk.totalChunks}]`;
    const elapsed = event.elapsed ? `${(event.elapsed / 1000).toFixed(0)}s` : "";

    switch (event.type) {
      case "started":
        // Process started - initial log already done in discover loop
        break;
      case "heartbeat":
        this.log(`${prefix} ${elapsed} - Still processing...`);
        break;
      case "stdout":
        this.log(`${prefix} ${elapsed} - Receiving data (${event.bytesReceived} bytes)`);
        break;
      case "complete":
        this.log(`${prefix} ${elapsed} - Analysis complete`);
        break;
      case "error":
        this.log(`${prefix} ERROR: ${event.message}`);
        break;
      // stderr is handled by onStderr callback
    }
  }

  private parseResponse(response: string, _chunk: FileChunk): Summary {
    const summary: Summary = {
      sessionId: `discover-${Date.now()}`,
      content: response,
      entities: [],
      architecture: [],
      services: [],
      knowledge: [],
    };

    // Parse entities
    const entitiesMatch = response.match(/## Entities\n([\s\S]*?)(?=\n## |$)/);
    if (entitiesMatch) {
      summary.entities = this.parseEntities(entitiesMatch[1]);
    }

    // Parse architecture
    const archMatch = response.match(/## Architecture\n([\s\S]*?)(?=\n## |$)/);
    if (archMatch) {
      summary.architecture = this.parseArchitecture(archMatch[1]);
    }

    // Parse services
    const servicesMatch = response.match(/## Services\n([\s\S]*?)(?=\n## |$)/);
    if (servicesMatch) {
      summary.services = this.parseServices(servicesMatch[1]);
    }

    // Parse knowledge
    const knowledgeMatch = response.match(/## Knowledge\n([\s\S]*?)(?=\n## |$)/);
    if (knowledgeMatch) {
      summary.knowledge = this.parseKnowledge(knowledgeMatch[1]);
    }

    return summary;
  }

  private parseEntities(section: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const blocks = section.split(/\n(?=- \*\*Name\*\*:)/);

    for (const block of blocks) {
      if (!block.trim()) continue;

      const nameMatch = block.match(/\*\*Name\*\*:\s*(.+)/);
      const locationMatch = block.match(/\*\*Location\*\*:\s*(.+)/);
      const attributesMatch = block.match(/\*\*Attributes\*\*:\s*(.+)/);
      const relationsMatch = block.match(/\*\*Relations\*\*:\s*(.+)/);

      if (nameMatch) {
        entities.push({
          name: nameMatch[1].trim(),
          location: locationMatch?.[1].trim(),
          attributes: attributesMatch?.[1].split(",").map((a) => a.trim()) || [],
          relations: relationsMatch?.[1].split(",").map((r) => r.trim()) || [],
        });
      }
    }

    return entities;
  }

  private parseArchitecture(section: string): ArchitectureItem[] {
    const items: ArchitectureItem[] = [];
    const blocks = section.split(/\n(?=- \*\*Pattern\*\*:)/);

    for (const block of blocks) {
      if (!block.trim()) continue;

      const patternMatch = block.match(/\*\*Pattern\*\*:\s*(.+)/);
      const descMatch = block.match(/\*\*Description\*\*:\s*(.+)/);
      const filesMatch = block.match(/\*\*Affected Files\*\*:\s*(.+)/);

      if (patternMatch) {
        items.push({
          pattern: patternMatch[1].trim(),
          description: descMatch?.[1].trim() || "",
          affectedFiles: filesMatch?.[1].split(",").map((f) => f.trim()) || [],
        });
      }
    }

    return items;
  }

  private parseServices(section: string): ServiceItem[] {
    const items: ServiceItem[] = [];
    const blocks = section.split(/\n(?=- \*\*Name\*\*:)/);

    for (const block of blocks) {
      if (!block.trim()) continue;

      const nameMatch = block.match(/\*\*Name\*\*:\s*(.+)/);
      const locationMatch = block.match(/\*\*Location\*\*:\s*(.+)/);
      const purposeMatch = block.match(/\*\*Purpose\*\*:\s*(.+)/);
      const methodsMatch = block.match(/\*\*Methods\*\*:\s*(.+)/);

      if (nameMatch) {
        items.push({
          name: nameMatch[1].trim(),
          location: locationMatch?.[1].trim(),
          purpose: purposeMatch?.[1].trim() || "",
          methods: methodsMatch?.[1].split(",").map((m) => m.trim()) || [],
        });
      }
    }

    return items;
  }

  private parseKnowledge(section: string): KnowledgeItem[] {
    const items: KnowledgeItem[] = [];
    const blocks = section.split(/\n(?=- \*\*Topic\*\*:)/);

    for (const block of blocks) {
      if (!block.trim()) continue;

      const topicMatch = block.match(/\*\*Topic\*\*:\s*(.+)/);
      const detailsMatch = block.match(/\*\*Details\*\*:\s*(.+)/);

      if (topicMatch) {
        items.push({
          topic: topicMatch[1].trim(),
          details: detailsMatch?.[1].trim() || "",
        });
      }
    }

    return items;
  }

  private mergeSummaries(summaries: Summary[]): Summary {
    const merged: Summary = {
      sessionId: `discover-${Date.now()}`,
      content: summaries.map((s) => s.content).join("\n\n---\n\n"),
      entities: [],
      architecture: [],
      services: [],
      knowledge: [],
    };

    // Merge and deduplicate by name
    const entityMap = new Map<string, ExtractedEntity>();
    const archMap = new Map<string, ArchitectureItem>();
    const serviceMap = new Map<string, ServiceItem>();
    const knowledgeMap = new Map<string, KnowledgeItem>();

    for (const summary of summaries) {
      for (const entity of summary.entities) {
        const key = entity.name.toLowerCase();
        if (!entityMap.has(key)) {
          entityMap.set(key, entity);
        }
      }

      for (const arch of summary.architecture) {
        const key = arch.pattern.toLowerCase();
        if (!archMap.has(key)) {
          archMap.set(key, arch);
        }
      }

      for (const service of summary.services) {
        const key = service.name.toLowerCase();
        if (!serviceMap.has(key)) {
          serviceMap.set(key, service);
        }
      }

      for (const knowledge of summary.knowledge) {
        const key = knowledge.topic.toLowerCase();
        if (!knowledgeMap.has(key)) {
          knowledgeMap.set(key, knowledge);
        }
      }
    }

    merged.entities = Array.from(entityMap.values());
    merged.architecture = Array.from(archMap.values());
    merged.services = Array.from(serviceMap.values());
    merged.knowledge = Array.from(knowledgeMap.values());

    return merged;
  }

  private async fallbackDiscovery(
    collection: CollectionResult,
    startTime: number
  ): Promise<DiscoveryResult> {
    // Basic discovery without Claude - just catalog files
    const summary: Summary = {
      sessionId: `discover-fallback-${Date.now()}`,
      content: "Fallback discovery - Claude unavailable",
      entities: [],
      architecture: [],
      services: [],
      knowledge: [
        {
          topic: "Project Languages",
          details: collection.languages.join(", "),
        },
        {
          topic: "Project Type",
          details: collection.projectType,
        },
        {
          topic: "Source Files Discovered",
          details: `${collection.files.length} files categorized by type`,
        },
      ],
    };

    // Group files by category
    const categories = new Map<string, string[]>();
    for (const file of collection.files) {
      if (!categories.has(file.category)) {
        categories.set(file.category, []);
      }
      categories.get(file.category)!.push(file.path);
    }

    for (const [category, files] of categories) {
      if (category !== "other" && category !== "test") {
        summary.knowledge.push({
          topic: `${category.charAt(0).toUpperCase() + category.slice(1)} Files`,
          details: files.slice(0, 10).join(", ") + (files.length > 10 ? ` (+${files.length - 10} more)` : ""),
        });
      }
    }

    // Try to integrate
    let integrated = false;
    try {
      const integrator = new VaultIntegrator(this.projectPath);
      await integrator.integrate(summary);
      integrated = true;
      this.log("\nFallback discovery integrated into vault");
    } catch {
      this.log("\nFallback discovery completed (vault integration failed)");
    }

    return {
      summary,
      filesAnalyzed: collection.files.length,
      chunksProcessed: 0,
      duration: Date.now() - startTime,
      integrated,
    };
  }

  private createEmptyResult(startTime: number): DiscoveryResult {
    return {
      summary: {
        sessionId: `discover-empty-${Date.now()}`,
        content: "",
        entities: [],
        architecture: [],
        services: [],
        knowledge: [],
      },
      filesAnalyzed: 0,
      chunksProcessed: 0,
      duration: Date.now() - startTime,
      integrated: false,
    };
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
