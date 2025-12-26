import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readTextFile, fileExists } from "../utils/file-utils.js";
import { loadConfig } from "../utils/config.js";

// Language detection from manifest files
const MANIFEST_LANGUAGE_MAP: Record<string, { language: string; projectType: string }> = {
  "package.json": { language: "typescript", projectType: "node" },
  "tsconfig.json": { language: "typescript", projectType: "node" },
  "Cargo.toml": { language: "rust", projectType: "rust" },
  "go.mod": { language: "go", projectType: "go" },
  "requirements.txt": { language: "python", projectType: "python" },
  "pyproject.toml": { language: "python", projectType: "python" },
  "setup.py": { language: "python", projectType: "python" },
  "pom.xml": { language: "java", projectType: "java" },
  "build.gradle": { language: "java", projectType: "java" },
  "*.csproj": { language: "csharp", projectType: "dotnet" },
  "Gemfile": { language: "ruby", projectType: "ruby" },
  "composer.json": { language: "php", projectType: "php" },
};

// Extension to language mapping
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
};

// File categories for prioritization
type FileCategory = "entry" | "model" | "service" | "util" | "config" | "test" | "other";

export interface CollectedFile {
  path: string;           // Relative to project root
  absolutePath: string;
  language: string;
  category: FileCategory;
  size: number;
  priority: number;
}

export interface CollectionResult {
  files: CollectedFile[];
  languages: string[];
  projectType: string;
  totalFilesScanned: number;
}

export interface CollectOptions {
  maxFiles?: number;
  excludePatterns?: string[];
  priorityPatterns?: string[];
  supportedLanguages?: string[];
}

export class FileCollector {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  async collect(options?: CollectOptions): Promise<CollectionResult> {
    const config = await loadConfig(this.projectPath);
    const mergedOptions = {
      maxFiles: options?.maxFiles ?? config.discover.maxFiles,
      excludePatterns: options?.excludePatterns ?? config.discover.excludePatterns,
      supportedLanguages: options?.supportedLanguages ?? config.discover.supportedLanguages,
    };

    // Detect project languages
    const { languages, projectType } = await this.detectLanguages();

    // Load ignore patterns
    const ignorePatterns = await this.loadIgnorePatterns(mergedOptions.excludePatterns);

    // Collect all source files
    const allFiles: CollectedFile[] = [];
    let totalScanned = 0;

    await this.walkDirectory(
      this.projectPath,
      async (filePath, stats) => {
        totalScanned++;
        const relativePath = path.relative(this.projectPath, filePath);

        // Skip if matches ignore pattern
        if (this.shouldIgnore(relativePath, ignorePatterns)) {
          return;
        }

        const ext = path.extname(filePath);
        const language = EXTENSION_LANGUAGE_MAP[ext];

        // Skip unsupported languages
        if (!language || !mergedOptions.supportedLanguages.includes(language)) {
          return;
        }

        const category = this.categorizeFile(relativePath);
        const priority = this.calculatePriority(relativePath, category, stats.size);

        allFiles.push({
          path: relativePath,
          absolutePath: filePath,
          language,
          category,
          size: stats.size,
          priority,
        });
      }
    );

    // Sort by priority (descending) and limit
    allFiles.sort((a, b) => b.priority - a.priority);
    const limitedFiles = allFiles.slice(0, mergedOptions.maxFiles);

    return {
      files: limitedFiles,
      languages,
      projectType,
      totalFilesScanned: totalScanned,
    };
  }

  async detectLanguages(): Promise<{ languages: string[]; projectType: string }> {
    const detected = new Set<string>();
    let projectType = "unknown";

    // Check for manifest files
    for (const [manifest, info] of Object.entries(MANIFEST_LANGUAGE_MAP)) {
      if (manifest.startsWith("*")) {
        // Glob pattern - skip for now
        continue;
      }
      const manifestPath = path.join(this.projectPath, manifest);
      if (await fileExists(manifestPath)) {
        detected.add(info.language);
        if (projectType === "unknown") {
          projectType = info.projectType;
        }
      }
    }

    // If package.json exists, check for TypeScript
    const packageJsonPath = path.join(this.projectPath, "package.json");
    if (await fileExists(packageJsonPath)) {
      const content = await readTextFile(packageJsonPath);
      if (content) {
        try {
          const pkg = JSON.parse(content);
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps.typescript || await fileExists(path.join(this.projectPath, "tsconfig.json"))) {
            detected.add("typescript");
          } else {
            detected.add("javascript");
          }
        } catch {
          detected.add("javascript");
        }
      }
    }

    return {
      languages: Array.from(detected),
      projectType,
    };
  }

  private async loadIgnorePatterns(additionalPatterns: string[]): Promise<string[]> {
    const patterns: string[] = [
      // Default ignores
      "node_modules/**",
      ".git/**",
      "dist/**",
      "build/**",
      "coverage/**",
      "*.log",
      ".env*",
      "__pycache__/**",
      "*.pyc",
      "target/**",  // Rust
      "vendor/**",  // Go
      ".venv/**",
      "venv/**",
    ];

    // Load .gitignore
    const gitignorePath = path.join(this.projectPath, ".gitignore");
    const gitignore = await readTextFile(gitignorePath);
    if (gitignore) {
      const lines = gitignore
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      patterns.push(...lines);
    }

    // Add user-configured excludes
    patterns.push(...additionalPatterns);

    return patterns;
  }

  private shouldIgnore(relativePath: string, patterns: string[]): boolean {
    const normalizedPath = relativePath.replace(/\\/g, "/");

    for (const pattern of patterns) {
      if (this.matchPattern(normalizedPath, pattern)) {
        return true;
      }
    }
    return false;
  }

  private matchPattern(filePath: string, pattern: string): boolean {
    // Simple glob matching - supports *, **, and basic patterns
    const normalizedPattern = pattern.replace(/\\/g, "/");

    // Handle negation patterns
    if (normalizedPattern.startsWith("!")) {
      return false; // Negation patterns don't cause ignore
    }

    // Convert glob to regex
    let regex = normalizedPattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, "{{GLOBSTAR}}")
      .replace(/\*/g, "[^/]*")
      .replace(/{{GLOBSTAR}}/g, ".*")
      .replace(/\?/g, ".");

    // Handle patterns that should match from start or anywhere
    if (!regex.startsWith("/") && !regex.startsWith(".*")) {
      regex = "(^|/)" + regex;
    }

    // Handle trailing slash (directory match)
    if (regex.endsWith("/")) {
      regex = regex + ".*";
    }

    try {
      const re = new RegExp(regex);
      return re.test(filePath);
    } catch {
      // Invalid regex, do simple includes check
      return filePath.includes(pattern.replace(/\*/g, ""));
    }
  }

  private categorizeFile(relativePath: string): FileCategory {
    const lowerPath = relativePath.toLowerCase();
    const fileName = path.basename(lowerPath);

    // Test files
    if (
      /\.(test|spec)\.[^/]+$/.test(lowerPath) ||
      /\/__tests__\//.test(lowerPath) ||
      /\/test\//.test(lowerPath) ||
      /\/tests\//.test(lowerPath)
    ) {
      return "test";
    }

    // Entry points
    if (
      /^(index|main|app|server)\.[^/]+$/.test(fileName) ||
      /\/src\/(index|main|app)\.[^/]+$/.test(lowerPath)
    ) {
      return "entry";
    }

    // Models/Entities
    if (
      /\/(models?|entities|domain|types|schemas?)\//i.test(lowerPath) ||
      /\.(model|entity|type)\.[^/]+$/.test(lowerPath)
    ) {
      return "model";
    }

    // Services
    if (
      /\/(services?|controllers?|handlers?|api|routes?)\//i.test(lowerPath) ||
      /\.(service|controller|handler)\.[^/]+$/.test(lowerPath)
    ) {
      return "service";
    }

    // Config files
    if (
      /\.(config|conf)\.[^/]+$/.test(lowerPath) ||
      /\/config\//i.test(lowerPath) ||
      fileName.startsWith(".")
    ) {
      return "config";
    }

    // Utilities
    if (
      /\/(utils?|helpers?|lib|common|shared)\//i.test(lowerPath) ||
      /\.(util|helper)\.[^/]+$/.test(lowerPath)
    ) {
      return "util";
    }

    return "other";
  }

  private calculatePriority(
    relativePath: string,
    category: FileCategory,
    size: number
  ): number {
    let score = 0;

    // Category-based scoring
    const categoryScores: Record<FileCategory, number> = {
      entry: 100,
      model: 80,
      service: 70,
      util: 30,
      config: 20,
      other: 10,
      test: -50,
    };
    score += categoryScores[category];

    // Depth penalty (shallower files are usually more important)
    const depth = relativePath.split("/").length;
    score -= depth * 2;

    // Size preferences
    if (size < 5000) score += 10;       // Small, focused files
    if (size > 50000) score -= 20;      // Very large files
    if (size > 100000) score -= 30;     // Huge files

    // Bonus for src directory
    if (/^src\//.test(relativePath)) score += 15;

    return score;
  }

  private async walkDirectory(
    dir: string,
    callback: (filePath: string, stats: { size: number }) => Promise<void>
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip common non-source directories early
          if (
            entry.name === "node_modules" ||
            entry.name === ".git" ||
            entry.name === "dist" ||
            entry.name === "build" ||
            entry.name === "__pycache__" ||
            entry.name === "target" ||
            entry.name === "vendor" ||
            entry.name === ".venv" ||
            entry.name === "venv"
          ) {
            continue;
          }
          await this.walkDirectory(fullPath, callback);
        } else if (entry.isFile()) {
          try {
            const stats = await fs.stat(fullPath);
            await callback(fullPath, { size: stats.size });
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }
}
