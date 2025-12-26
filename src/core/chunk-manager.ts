import { readTextFile } from "../utils/file-utils.js";
import type { CollectedFile } from "./file-collector.js";

export interface FileChunk {
  files: CollectedFile[];
  content: string;
  estimatedTokens: number;
  index: number;
  totalChunks: number;
}

export interface ChunkOptions {
  maxChunkSize?: number;  // Max characters per chunk (default: 50000)
}

const DEFAULT_MAX_CHUNK_SIZE = 50000;

// Rough token estimation (avg ~4 chars per token for code)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class ChunkManager {
  private files: CollectedFile[];
  private maxChunkSize: number;
  private chunks: FileChunk[] | null = null;

  constructor(files: CollectedFile[], options?: ChunkOptions) {
    this.files = files;
    this.maxChunkSize = options?.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
  }

  async prepareChunks(): Promise<FileChunk[]> {
    if (this.chunks) {
      return this.chunks;
    }

    const chunks: FileChunk[] = [];
    let currentChunk: CollectedFile[] = [];
    let currentContent = "";
    let currentSize = 0;

    for (const file of this.files) {
      const content = await readTextFile(file.absolutePath);
      if (!content) continue;

      // Format file content with path header
      const formattedContent = this.formatFileContent(file.path, content);
      const contentSize = formattedContent.length;

      // If single file exceeds max size, truncate it
      if (contentSize > this.maxChunkSize) {
        // If we have pending content, save current chunk first
        if (currentChunk.length > 0) {
          chunks.push(this.createChunk(currentChunk, currentContent, chunks.length));
          currentChunk = [];
          currentContent = "";
          currentSize = 0;
        }

        // Add truncated file as its own chunk
        const truncatedContent = this.truncateContent(formattedContent, this.maxChunkSize);
        chunks.push(this.createChunk([file], truncatedContent, chunks.length));
        continue;
      }

      // If adding this file would exceed max size, start new chunk
      if (currentSize + contentSize > this.maxChunkSize && currentChunk.length > 0) {
        chunks.push(this.createChunk(currentChunk, currentContent, chunks.length));
        currentChunk = [];
        currentContent = "";
        currentSize = 0;
      }

      // Add file to current chunk
      currentChunk.push(file);
      currentContent += formattedContent + "\n\n";
      currentSize += contentSize;
    }

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
      chunks.push(this.createChunk(currentChunk, currentContent, chunks.length));
    }

    // Update totalChunks in all chunks
    for (const chunk of chunks) {
      chunk.totalChunks = chunks.length;
    }

    this.chunks = chunks;
    return chunks;
  }

  private createChunk(
    files: CollectedFile[],
    content: string,
    index: number
  ): FileChunk {
    return {
      files,
      content: content.trim(),
      estimatedTokens: estimateTokens(content),
      index,
      totalChunks: 0, // Will be updated after all chunks are created
    };
  }

  private formatFileContent(filePath: string, content: string): string {
    // Add clear file boundaries for Claude to parse
    return `===== FILE: ${filePath} =====
${content}
===== END: ${filePath} =====`;
  }

  private truncateContent(content: string, maxSize: number): string {
    if (content.length <= maxSize) {
      return content;
    }

    // Try to truncate at a reasonable point
    const truncateAt = maxSize - 100; // Leave room for truncation message
    const lastNewline = content.lastIndexOf("\n", truncateAt);
    const cutPoint = lastNewline > truncateAt * 0.5 ? lastNewline : truncateAt;

    return content.slice(0, cutPoint) + "\n\n[... TRUNCATED - file too large ...]";
  }

  getTotalChunks(): number {
    if (!this.chunks) {
      throw new Error("Chunks not prepared. Call prepareChunks() first.");
    }
    return this.chunks.length;
  }

  getChunkSummary(): string {
    if (!this.chunks) {
      return "Chunks not yet prepared";
    }

    const totalFiles = this.chunks.reduce((sum, c) => sum + c.files.length, 0);
    const totalTokens = this.chunks.reduce((sum, c) => sum + c.estimatedTokens, 0);

    return `${totalFiles} files in ${this.chunks.length} chunks (~${totalTokens} tokens)`;
  }

  // Async generator for processing chunks one at a time
  async *iterateChunks(): AsyncGenerator<FileChunk> {
    const chunks = await this.prepareChunks();
    for (const chunk of chunks) {
      yield chunk;
    }
  }
}
