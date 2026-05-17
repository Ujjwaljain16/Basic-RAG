import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Document } from "@langchain/core/documents";
import { StructuralNode, NodeType } from "./parser";
import crypto from "crypto";

export const SCHEMA_VERSION = "2026.05.07.v3";
const MAX_ATOMIC_TOKENS = 1000;

export interface DocumentChunk {
  content: string;
  metadata: {
    documentId: string;
    documentVersion: string;
    nodeId: string;
    parentNodeId?: string;
    nodeType: NodeType;
    tocPath: string;
    title?: string;
    pageStart: number;
    pageEnd: number;
    startChar: number;
    endChar: number;
    chunkOrder: number;
    tokenCount: number;
    isAtomic: boolean;
    atomicGroupId?: string;
    isFallback: boolean;
    sourceStrategy: "structure" | "page_fallback";
    parserConfidence: number;
  };
}

export async function chunkStructuralNodes(
  nodes: StructuralNode[],
  documentId: string
): Promise<Document[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 400,
    chunkOverlap: 50,
    separators: ["\n\n", "\n", ". ", " ", ""],
  });

  const chunks: Document[] = [];

  for (const node of nodes) {
    if (node.isAtomic && node.content.length <= MAX_ATOMIC_TOKENS) {
      chunks.push({
        pageContent: node.content,
        metadata: {
          ...createMetadata(node, documentId, 0, node.content.length, false),
          parentContent: node.content,
        },
      });
    } else {
      const subDocs = await splitter.splitDocuments([
        { pageContent: node.content, metadata: {} } as Document
      ]);

      const atomicGroupId = node.isAtomic ? crypto.randomUUID() : undefined;

      subDocs.forEach((doc, index) => {
        chunks.push({
          pageContent: doc.pageContent,
          metadata: {
            ...createMetadata(node, documentId, index, doc.pageContent.length, false),
            atomicGroupId,
            parentContent: node.content,
          },
        });
      });
    }
  }

  return chunks;
}

function createMetadata(
  node: StructuralNode,
  documentId: string,
  order: number,
  tokenCount: number,
  isFallback: boolean
) {
  return {
    documentId,
    documentVersion: SCHEMA_VERSION,
    nodeId: node.id,
    nodeType: node.type,
    tocPath: node.tocPath,
    title: node.title,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    startChar: node.startChar,
    endChar: node.endChar,
    chunkOrder: order,
    tokenCount,
    isAtomic: node.isAtomic,
    isFallback,
    sourceStrategy: isFallback ? "page_fallback" : "structure",
    parserConfidence: node.confidence,
  };
}
