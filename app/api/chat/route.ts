import { NextRequest, NextResponse } from "next/server";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { QdrantVectorStore } from "@langchain/qdrant";
import type { Document } from "@langchain/core/documents";

export async function POST(req: NextRequest) {
  try {
    const { messages, docId } = await req.json();
    
    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: "No messages provided" }, { status: 400 });
    }

    const userQuery = messages[messages.length - 1].content as string;

    const embeddings = new HuggingFaceInferenceEmbeddings({
      apiKey: process.env.HUGGINGFACE_API_KEY,
      model: "sentence-transformers/all-MiniLM-L6-v2",
    });

    const vectorStore = await QdrantVectorStore.fromExistingCollection(
      embeddings,
      {
        url: process.env.QDRANT_URL!,
        apiKey: process.env.QDRANT_API_KEY,
        collectionName: process.env.COLLECTION_NAME!,
      }
    );

    const filter = docId
      ? { must: [{ key: "metadata.docId", match: { value: docId } }] }
      : undefined;

    const relevantChunks = await vectorStore.similaritySearch(
      userQuery,
      8,
      filter
    );

    const context = relevantChunks
      .map((chunk: Document, i: number) => {
        const page = chunk.metadata.loc?.pageNumber ?? chunk.metadata.page ?? "?";
        const file = chunk.metadata.fileName ?? "document";
        return `[SOURCE ${i + 1} | File: ${file} | Page: ${page}]\n${chunk.pageContent}`;
      })
      .join("\n\n---\n\n");

    const systemPrompt = `You are a precise document assistant. Your ONLY job is to answer questions 
based strictly on the document excerpts provided below.

STRICT RULES — you must follow all of these without exception:
1. ONLY use information present in the SOURCE excerpts below.
2. NEVER use your general training knowledge to fill gaps.
3. If the answer is not in the excerpts, say exactly: 
   "I couldn't find that information in the uploaded document."
4. Always cite your sources by referencing [SOURCE N] for each claim.
5. If multiple sources support a claim, cite all of them.
6. Do not speculate, extrapolate, or infer beyond what is written.
7. Keep answers concise and factual.

=== DOCUMENT EXCERPTS ===

${context}

=== END OF EXCERPTS ===

Answer the user's question using ONLY the above excerpts.`;

    const llm = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash",
      temperature: 0,
      apiKey: process.env.GOOGLE_API_KEY,
    });

    // We combine the system prompt and the user query
    const prompt = `${systemPrompt}\n\nUser Question: ${userQuery}`;
    
    const response = await llm.invoke(prompt);

    const sources = relevantChunks.map((c: Document) => ({
      page: c.metadata.loc?.pageNumber ?? c.metadata.page ?? "?",
      file: c.metadata.fileName ?? "document",
      excerpt: c.pageContent.slice(0, 150) + "...",
    }));

    return NextResponse.json({
      answer: response.content,
      sources,
    });

  } catch (err: any) {
    console.error("[chat] error:", err);
    return NextResponse.json(
      { error: err.message ?? "Chat generation failed" },
      { status: 500 }
    );
  }
}
