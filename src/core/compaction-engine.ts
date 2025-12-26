import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as zlib from "node:zlib";
import { promisify } from "node:util";
import { writeTextFile, readTextFile } from "../utils/file-utils.js";
import { getConversationsPath, loadConfig } from "../utils/config.js";
import { spawnClaudeAgent } from "../utils/claude-sdk.js";

const gzip = promisify(zlib.gzip);

const SUMMARIZATION_PROMPT = `You are a technical knowledge extractor. Analyze this conversation log and extract key information for a project knowledge base.

Extract and format the following:

## Entities
For each domain entity (data model, type, class) created or modified:
- **Name**: Entity name
- **Location**: File path
- **Attributes**: Key fields/properties
- **Relations**: Related entities

## Architecture
For each architectural pattern or design decision:
- **Pattern**: Name of pattern
- **Description**: Brief explanation
- **Affected Files**: Relevant file paths

## Services
For each service or component created:
- **Name**: Service name
- **Location**: File path
- **Purpose**: Brief description
- **Methods**: Key methods/functions

## Knowledge
For each convention, rule, or important context:
- **Topic**: What it's about
- **Details**: The actual information

Only include sections that have content. Be concise but complete.
Use file paths exactly as shown in the conversation.

CONVERSATION LOG:
`;

export interface Summary {
  sessionId: string;
  content: string;
  entities: ExtractedEntity[];
  architecture: ArchitectureItem[];
  services: ServiceItem[];
  knowledge: KnowledgeItem[];
}

export interface ExtractedEntity {
  name: string;
  location?: string;
  attributes: string[];
  relations: string[];
}

export interface ArchitectureItem {
  pattern: string;
  description: string;
  affectedFiles: string[];
}

export interface ServiceItem {
  name: string;
  location?: string;
  purpose: string;
  methods: string[];
}

export interface KnowledgeItem {
  topic: string;
  details: string;
}

export class CompactionEngine {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  async compact(sessionId: string, conversation: string): Promise<Summary | null> {
    try {
      // Use Claude SDK to generate summary
      const summaryContent = await this.generateSummary(conversation);

      if (!summaryContent) {
        return null;
      }

      // Parse the summary to extract structured data
      const summary = this.parseSummary(sessionId, summaryContent);

      // Write summary to conversation folder
      await this.writeSummary(sessionId, summaryContent);

      // Cleanup original conversation files based on config
      await this.cleanupConversationFiles(sessionId);

      return summary;
    } catch (error) {
      console.error("Compaction failed:", error);
      return null;
    }
  }

  private async generateSummary(conversation: string): Promise<string | null> {
    const prompt = SUMMARIZATION_PROMPT + conversation;

    try {
      const result = await spawnClaudeAgent(prompt);
      return result;
    } catch (error) {
      // Fallback to basic extraction if Claude SDK fails
      return this.fallbackExtraction(conversation);
    }
  }

  private fallbackExtraction(conversation: string): string {
    // Basic extraction without AI - just capture file paths and actions
    const lines = conversation.split("\n");
    const files: string[] = [];
    const actions: string[] = [];

    for (const line of lines) {
      // Extract file paths
      const fileMatch = line.match(/(?:Created|Modified|Edited).*?:\s*(.+\.(?:ts|js|tsx|jsx|md))/i);
      if (fileMatch) {
        files.push(fileMatch[1]);
      }

      // Extract tool actions
      if (line.includes("[TOOL:")) {
        actions.push(line);
      }
    }

    let summary = "# Session Summary\n\n";

    if (files.length > 0) {
      summary += "## Files Modified\n";
      for (const file of [...new Set(files)]) {
        summary += `- ${file}\n`;
      }
      summary += "\n";
    }

    if (actions.length > 0) {
      summary += "## Actions\n";
      for (const action of actions.slice(0, 20)) {
        summary += `- ${action}\n`;
      }
    }

    return summary;
  }

  private parseSummary(sessionId: string, content: string): Summary {
    const summary: Summary = {
      sessionId,
      content,
      entities: [],
      architecture: [],
      services: [],
      knowledge: [],
    };

    // Parse entities section
    const entitiesMatch = content.match(/## Entities\n([\s\S]*?)(?=\n## |$)/);
    if (entitiesMatch) {
      summary.entities = this.parseEntities(entitiesMatch[1]);
    }

    // Parse architecture section
    const archMatch = content.match(/## Architecture\n([\s\S]*?)(?=\n## |$)/);
    if (archMatch) {
      summary.architecture = this.parseArchitecture(archMatch[1]);
    }

    // Parse services section
    const servicesMatch = content.match(/## Services\n([\s\S]*?)(?=\n## |$)/);
    if (servicesMatch) {
      summary.services = this.parseServices(servicesMatch[1]);
    }

    // Parse knowledge section
    const knowledgeMatch = content.match(/## Knowledge\n([\s\S]*?)(?=\n## |$)/);
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

  private async writeSummary(sessionId: string, content: string): Promise<void> {
    const conversationsPath = getConversationsPath(this.projectPath);
    const summaryPath = path.join(conversationsPath, sessionId, "summary.md");

    const fullContent = `# Session Summary: ${sessionId}
Generated: ${new Date().toISOString()}

${content}
`;

    await writeTextFile(summaryPath, fullContent);
  }

  private async cleanupConversationFiles(sessionId: string): Promise<void> {
    const config = await loadConfig(this.projectPath);
    const cleanupMode = config.compaction.cleanupAfterSummary;

    if (cleanupMode === "keep") {
      return; // Nothing to do
    }

    const conversationsPath = getConversationsPath(this.projectPath);
    const sessionPath = path.join(conversationsPath, sessionId);

    // Get all conversation files (numbered .txt files)
    const files = await fs.readdir(sessionPath);
    const conversationFiles = files.filter(
      (f) => /^\d+\.txt$/.test(f)
    );

    if (conversationFiles.length === 0) {
      return;
    }

    if (cleanupMode === "archive") {
      await this.archiveConversationFiles(sessionPath, conversationFiles);
    } else if (cleanupMode === "delete") {
      await this.deleteConversationFiles(sessionPath, conversationFiles);
    }
  }

  private async archiveConversationFiles(
    sessionPath: string,
    files: string[]
  ): Promise<void> {
    try {
      // Combine all conversation files into one archive
      const contents: string[] = [];

      for (const file of files.sort()) {
        const filePath = path.join(sessionPath, file);
        const content = await readTextFile(filePath);
        if (content) {
          contents.push(`=== ${file} ===\n${content}`);
        }
      }

      const combined = contents.join("\n\n");
      const compressed = await gzip(Buffer.from(combined, "utf-8"));

      // Write archive
      const archivePath = path.join(sessionPath, "raw.txt.gz");
      await fs.writeFile(archivePath, compressed);

      // Delete original files
      await this.deleteConversationFiles(sessionPath, files);
    } catch (error) {
      console.error("Failed to archive conversation files:", error);
      // Don't delete originals if archive fails
    }
  }

  private async deleteConversationFiles(
    sessionPath: string,
    files: string[]
  ): Promise<void> {
    for (const file of files) {
      try {
        await fs.unlink(path.join(sessionPath, file));
      } catch {
        // Ignore deletion errors
      }
    }
  }
}
