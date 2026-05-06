import { NextRequest, NextResponse } from "next/server";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { Document } from "@langchain/core/documents";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { QdrantVectorStore } from "@langchain/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";
import { detectStructuralBlocks, stripHeadersFooters } from "@/lib/rag/parser";
import { chunkStructuralNodes } from "@/lib/rag/chunker";
import { writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import crypto from "crypto";
import "pdf-parse"; // Force Vercel to bundle this dependency

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Server-side check for 4.5MB limit (Vercel Hard Limit)
    if (file.size > 4.5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 4.5MB." },
        { status: 413 }
      );
    }

    const allowedTypes = ["application/pdf", "text/plain"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Only PDF and plain text files are supported" },
        { status: 415 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const ext = file.type === "application/pdf" ? ".pdf" : ".txt";
    const tmpPath = join(tmpdir(), `upload-${Date.now()}${ext}`);
    
    try {
      await writeFile(tmpPath, buffer);
    } catch (e) {
      console.error("[ingest] Write failed:", e);
      return NextResponse.json({ error: "Failed to write temporary file" }, { status: 500 });
    }

    const docId = crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex")
      .slice(0, 16);

    let rawDocs: Document[] = [];
    try {
      if (file.type === "application/pdf") {
        console.log("[ingest] Parsing PDF with PDFLoader...");
        const loader = new PDFLoader(tmpPath, { splitPages: true });
        rawDocs = await loader.load();
      } else {
        const text = buffer.toString("utf-8");
        rawDocs = [new Document({ pageContent: text, metadata: { source: tmpPath } })];
      }
    } catch (err) {
      console.error("[ingest] PDF/Text parsing error:", err);
      const msg = err instanceof Error ? err.message : "Failed to parse document";
      return NextResponse.json(
        { error: `Parsing failed: ${msg}. If this is a PDF, it might be corrupted or incompatible with the current parser.` },
        { status: 500 }
      );
    }

    const pages = rawDocs.map((doc, i) => ({
      text: doc.pageContent,
      pageNumber: (doc.metadata.loc?.pageNumber as number) || i + 1,
    }));

    const cleanText = stripHeadersFooters(pages);
    const nodes = detectStructuralBlocks(cleanText);
    const chunks = await chunkStructuralNodes(nodes, docId);

    const embeddings = new HuggingFaceInferenceEmbeddings({
      apiKey: process.env.HUGGINGFACE_API_KEY,
      model: "sentence-transformers/all-MiniLM-L6-v2",
    });

    const vectorStore = new QdrantVectorStore(embeddings, {
      url: process.env.QDRANT_URL!,
      apiKey: process.env.QDRANT_API_KEY,
      collectionName: process.env.COLLECTION_NAME!,
    });

    const BATCH_SIZE = 50;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      await vectorStore.addDocuments(batch);
    }

    const client = new QdrantClient({
      url: process.env.QDRANT_URL!,
      apiKey: process.env.QDRANT_API_KEY,
    });
    
    await Promise.all([
      client.createPayloadIndex(process.env.COLLECTION_NAME!, {
        field_name: "metadata.documentId",
        field_schema: "keyword",
      }),
      client.createPayloadIndex(process.env.COLLECTION_NAME!, {
        field_name: "metadata.nodeType",
        field_schema: "keyword",
      })
    ]);

    return NextResponse.json({
      success: true,
      docId,
      fileName: file.name,
      totalChunks: chunks.length,
    });
  } catch (err) {
    console.error("[ingest] error:", err);
    const msg = err instanceof Error ? err.message : "Ingestion failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
