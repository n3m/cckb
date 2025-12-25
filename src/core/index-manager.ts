import * as path from "node:path";
import {
  readTextFile,
  writeTextFile,
  listDir,
  fileExists,
  ensureDir,
} from "../utils/file-utils.js";

export interface IndexEntry {
  name: string;
  path: string;
  description: string;
  type: "file" | "folder";
}

export class IndexManager {
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  async getVaultOverview(): Promise<string | null> {
    const indexPath = path.join(this.vaultPath, "INDEX.md");
    const content = await readTextFile(indexPath);

    if (!content) {
      return null;
    }

    // Extract the Contents table
    const tableMatch = content.match(/## Contents\n\n\|[\s\S]*?\|\n(?:\|[\s\S]*?\|\n)*/);
    if (tableMatch) {
      return `Vault contents: ${this.parseTableToOverview(tableMatch[0])}`;
    }

    return "Vault available at cc-knowledge-base/vault/";
  }

  async listEntities(): Promise<string[]> {
    const entitiesPath = path.join(this.vaultPath, "entities");

    if (!(await fileExists(entitiesPath))) {
      return [];
    }

    const items = await listDir(entitiesPath);
    return items.filter((item) => !item.endsWith(".md"));
  }

  async readIndex(relativePath: string = ""): Promise<IndexEntry[]> {
    const indexPath = path.join(this.vaultPath, relativePath, "INDEX.md");
    const content = await readTextFile(indexPath);

    if (!content) {
      return [];
    }

    return this.parseIndex(content);
  }

  async updateIndex(
    relativePath: string,
    entries: IndexEntry[]
  ): Promise<void> {
    const indexPath = path.join(this.vaultPath, relativePath, "INDEX.md");
    const existingContent = await readTextFile(indexPath);

    if (!existingContent) {
      await this.createIndex(relativePath, entries);
      return;
    }

    // Parse existing entries
    const existingEntries = this.parseIndex(existingContent);

    // Merge entries (new entries override existing with same name)
    const mergedMap = new Map<string, IndexEntry>();
    for (const entry of existingEntries) {
      mergedMap.set(entry.name, entry);
    }
    for (const entry of entries) {
      mergedMap.set(entry.name, entry);
    }

    const mergedEntries = Array.from(mergedMap.values());

    // Rebuild the table
    const newTable = this.buildTable(mergedEntries);

    // Replace the table in the content
    const updatedContent = existingContent.replace(
      /## (?:Contents|Entity List)\n\n\|[\s\S]*?(?=\n\n|$)/,
      `## Contents\n\n${newTable}`
    );

    await writeTextFile(indexPath, updatedContent);
  }

  async createIndex(
    relativePath: string,
    entries: IndexEntry[],
    title?: string
  ): Promise<void> {
    const indexPath = path.join(this.vaultPath, relativePath, "INDEX.md");
    const folderName = path.basename(relativePath) || "Vault";
    const displayTitle = title || folderName.charAt(0).toUpperCase() + folderName.slice(1);

    const content = `# ${displayTitle}

## Contents

${this.buildTable(entries)}

_Last updated: ${new Date().toISOString()}_
`;

    await ensureDir(path.dirname(indexPath));
    await writeTextFile(indexPath, content);
  }

  async addEntry(
    relativePath: string,
    entry: IndexEntry
  ): Promise<void> {
    await this.updateIndex(relativePath, [entry]);
  }

  async ensureEntityFolder(entityName: string): Promise<string> {
    const entityPath = path.join("entities", entityName);
    const fullPath = path.join(this.vaultPath, entityPath);

    await ensureDir(fullPath);

    // Create entity INDEX.md if it doesn't exist
    const indexPath = path.join(fullPath, "INDEX.md");
    if (!(await fileExists(indexPath))) {
      await this.createIndex(entityPath, [], entityName);
    }

    // Ensure entity is in entities/INDEX.md
    await this.addEntry("entities", {
      name: entityName,
      path: `./${entityName}/INDEX.md`,
      description: `Documentation for ${entityName} entity`,
      type: "folder",
    });

    return entityPath;
  }

  private parseIndex(content: string): IndexEntry[] {
    const entries: IndexEntry[] = [];

    // Find table rows (skip header rows)
    const tableMatch = content.match(/\|[\s\S]*?\|/g);
    if (!tableMatch) {
      return entries;
    }

    // Skip header and separator rows
    const dataRows = tableMatch.slice(2);

    for (const row of dataRows) {
      const cells = row
        .split("|")
        .filter((c) => c.trim())
        .map((c) => c.trim());

      if (cells.length >= 2) {
        // Parse name and link
        const linkMatch = cells[0].match(/\[([^\]]+)\]\(([^)]+)\)/);
        const name = linkMatch ? linkMatch[1] : cells[0];
        const linkPath = linkMatch ? linkMatch[2] : "";
        const type = linkPath.includes("/") ? "folder" : "file";
        const description = cells[cells.length - 1] || "";

        entries.push({
          name,
          path: linkPath,
          description,
          type: type as "file" | "folder",
        });
      }
    }

    return entries;
  }

  private buildTable(entries: IndexEntry[]): string {
    if (entries.length === 0) {
      return "| Item | Description |\n|------|-------------|\n\n_No entries yet._";
    }

    let table = "| Item | Description |\n|------|-------------|\n";

    for (const entry of entries) {
      const link = `[${entry.name}](${entry.path})`;
      table += `| ${link} | ${entry.description} |\n`;
    }

    return table;
  }

  private parseTableToOverview(table: string): string {
    const entries = this.parseIndex(table);
    return entries.map((e) => e.name).join(", ");
  }
}
