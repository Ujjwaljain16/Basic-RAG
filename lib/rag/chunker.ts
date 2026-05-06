import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Document } from "@langchain/core/documents";

export interface ChunkingConfig {
  chunkSize: number;       // target characters per chunk
  chunkOverlap: number;    // overlap between consecutive chunks
}

export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  chunkSize: 500,
  chunkOverlap: 100,
};

export async function chunkDocuments(
  docs: Document[],
  config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG
): Promise<Document[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    separators: ["\n\n", "\n", ". ", "! ", "? ", " ", ""],
  });

  const chunks = await splitter.splitDocuments(docs);

  // Enrich metadata
  return chunks.map((chunk, index) => ({
    ...chunk,
    metadata: {
      ...chunk.metadata,
      chunkIndex: index,
      chunkSize: chunk.pageContent.length,
      docId: chunk.metadata.docId ?? "unknown",
      fileName: chunk.metadata.fileName ?? "document",
    },
  }));
}
