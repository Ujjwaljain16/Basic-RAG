import { NextRequest, NextResponse } from "next/server";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { Document } from "@langchain/core/documents";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { QdrantVectorStore } from "@langchain/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";
import { chunkDocuments } from "@/lib/rag/chunker";
import { writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
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
    await writeFile(tmpPath, buffer);

    const docId = crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex")
      .slice(0, 16);

    let rawDocs: Document[] = [];
    if (file.type === "application/pdf") {
      const loader = new PDFLoader(tmpPath, { splitPages: true });
      rawDocs = await loader.load();
    } else {
      const text = buffer.toString("utf-8");
      rawDocs = [new Document({ pageContent: text, metadata: { source: tmpPath } })];
    }

    const taggedDocs = rawDocs.map((doc: Document) => ({
      ...doc,
      metadata: {
        ...doc.metadata,
        docId,
        fileName: file.name,
        ingestedAt: new Date().toISOString(),
      },
    }));

    const chunks = await chunkDocuments(taggedDocs);

    const embeddings = new HuggingFaceInferenceEmbeddings({
      apiKey: process.env.HUGGINGFACE_API_KEY,
      model: "sentence-transformers/all-MiniLM-L6-v2",
    });

    await QdrantVectorStore.fromDocuments(chunks, embeddings, {
      url: process.env.QDRANT_URL!,
      apiKey: process.env.QDRANT_API_KEY,
      collectionName: process.env.COLLECTION_NAME!,
    });

    const client = new QdrantClient({
      url: process.env.QDRANT_URL!,
      apiKey: process.env.QDRANT_API_KEY,
    });
    
    await client.createPayloadIndex(process.env.COLLECTION_NAME!, {
      field_name: "metadata.docId",
      field_schema: "keyword",
    });

    return NextResponse.json({
      success: true,
      docId,
      fileName: file.name,
      totalChunks: chunks.length,
      message: `Indexed ${chunks.length} chunks from "${file.name}"`,
    });
  } catch (err: any) {
    console.error("[ingest] error:", err);
    return NextResponse.json(
      { error: err.message ?? "Ingestion failed" },
      { status: 500 }
    );
  }
}
