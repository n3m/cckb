import * as path from "node:path";
import {
  readTextFile,
  writeTextFile,
  appendToFile,
  ensureDir,
  fileExists,
} from "../utils/file-utils.js";
import { IndexManager } from "./index-manager.js";
import { EntityDetector, type DetectedItem } from "./entity-detector.js";
import type { Summary } from "./compaction-engine.js";

export class VaultIntegrator {
  private vaultPath: string;
  private indexManager: IndexManager;
  private entityDetector: EntityDetector;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.indexManager = new IndexManager(vaultPath);
    this.entityDetector = new EntityDetector();
  }

  async integrate(summary: Summary): Promise<void> {
    // Detect items from summary
    const items = this.entityDetector.detect(summary);

    if (items.length === 0) {
      return;
    }

    // Process each detected item
    for (const item of items) {
      await this.processItem(item);
    }

    // Update root INDEX.md with timestamp
    await this.updateRootIndex();
  }

  private async processItem(item: DetectedItem): Promise<void> {
    switch (item.type) {
      case "entity":
        await this.processEntity(item);
        break;
      case "service":
        await this.processService(item);
        break;
      case "pattern":
        await this.processPattern(item);
        break;
      case "knowledge":
        await this.processKnowledge(item);
        break;
    }
  }

  private async processEntity(item: DetectedItem): Promise<void> {
    const entityPath = await this.indexManager.ensureEntityFolder(item.name);
    const fullPath = path.join(this.vaultPath, entityPath);

    // Write attributes.md
    const attributesPath = path.join(fullPath, "attributes.md");
    await writeTextFile(attributesPath, item.content);

    // Update entity INDEX.md
    await this.indexManager.addEntry(entityPath, {
      name: "attributes",
      path: "./attributes.md",
      description: `Attributes of ${item.name}`,
      type: "file",
    });
  }

  private async processService(item: DetectedItem): Promise<void> {
    const pathParts = item.vaultPath.split("/");
    const fileName = pathParts.pop() + ".md";
    const folderPath = pathParts.join("/");
    const fullFolderPath = path.join(this.vaultPath, folderPath);

    await ensureDir(fullFolderPath);

    // Write service file
    const filePath = path.join(fullFolderPath, fileName);
    await writeTextFile(filePath, item.content);

    // Ensure parent has INDEX.md
    const parentIndexPath = path.join(fullFolderPath, "INDEX.md");
    if (!(await fileExists(parentIndexPath))) {
      await this.indexManager.createIndex(folderPath, []);
    }

    // Update parent INDEX.md
    await this.indexManager.addEntry(folderPath, {
      name: item.name,
      path: `./${fileName}`,
      description: (item.data as { purpose?: string }).purpose || `${item.name} service`,
      type: "file",
    });

    // Update entity INDEX if this is an entity service
    if (folderPath.startsWith("entities/") && folderPath.includes("/services")) {
      const entityFolder = folderPath.split("/").slice(0, 2).join("/");
      await this.indexManager.addEntry(entityFolder, {
        name: "services",
        path: "./services/INDEX.md",
        description: "Service layer documentation",
        type: "folder",
      });
    }
  }

  private async processPattern(item: DetectedItem): Promise<void> {
    const archPath = path.join(this.vaultPath, "architecture.md");
    const existing = await readTextFile(archPath);

    if (!existing) {
      await writeTextFile(archPath, `# Architecture\n\n${item.content}`);
      return;
    }

    // Check if pattern already exists
    if (existing.includes(`## ${item.name}`)) {
      // Replace existing section
      const regex = new RegExp(`## ${item.name}[\\s\\S]*?(?=\\n## |$)`);
      const updated = existing.replace(regex, item.content);
      await writeTextFile(archPath, updated);
    } else {
      // Append new pattern
      await appendToFile(archPath, `\n${item.content}`);
    }
  }

  private async processKnowledge(item: DetectedItem): Promise<void> {
    const knowledgePath = path.join(this.vaultPath, "general-knowledge.md");
    const existing = await readTextFile(knowledgePath);

    if (!existing) {
      await writeTextFile(knowledgePath, `# General Knowledge\n\n${item.content}`);
      return;
    }

    // Check if topic already exists
    if (existing.includes(`## ${item.name}`)) {
      // Replace existing section
      const regex = new RegExp(`## ${item.name}[\\s\\S]*?(?=\\n## |$)`);
      const updated = existing.replace(regex, item.content);
      await writeTextFile(knowledgePath, updated);
    } else {
      // Append new knowledge
      await appendToFile(knowledgePath, `\n${item.content}`);
    }
  }

  private async updateRootIndex(): Promise<void> {
    const indexPath = path.join(this.vaultPath, "INDEX.md");
    const content = await readTextFile(indexPath);

    if (!content) {
      return;
    }

    // Update the "Last Updated" line
    const timestamp = new Date().toISOString();
    const updated = content.replace(
      /## Last Updated[\s\S]*$/,
      `## Last Updated\n\n${timestamp}`
    );

    await writeTextFile(indexPath, updated);
  }
}
