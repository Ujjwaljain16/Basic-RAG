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

    const currentMessage = messages[messages.length - 1].content as string;
    
    const llm = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash",
      temperature: 0,
      apiKey: process.env.GOOGLE_API_KEY,
    });

    let userQuery = currentMessage;
    const needsRewrite = messages.length > 1 && 
      (/\b(it|this|that|these|those|they|them|he|she|his|her)\b/i.test(currentMessage) || currentMessage.split(" ").length < 6);

    if (needsRewrite) {
      const chatHistory = messages.slice(0, -1).slice(-4).map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join("\n");
      const rewritePrompt = `Given the conversation history and a new user question, rewrite it into a standalone technical search query.
Do not answer the question, just rewrite it. If it's already a standalone query, return it unchanged.

Chat History:
${chatHistory}

New Question: ${currentMessage}

Standalone Query:`;
      
      try {
        const rewriteRes = await llm.invoke(rewritePrompt);
        userQuery = (rewriteRes.content as string).trim();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[chat] Query rewrite failed, using raw query:", msg);
      }
    }

    const embeddings = new HuggingFaceInferenceEmbeddings({
      apiKey: process.env.HUGGINGFACE_API_KEY,
      model: "sentence-transformers/all-MiniLM-L6-v2",
    });

    const vectorStore = new QdrantVectorStore(embeddings, {
      url: process.env.QDRANT_URL!,
      apiKey: process.env.QDRANT_API_KEY,
      collectionName: process.env.COLLECTION_NAME!,
    });

    const filter = docId
      ? { must: [{ key: "metadata.documentId", match: { value: docId } }] }
      : undefined;

    const candidates = await vectorStore.similaritySearch(userQuery, 40, filter);

    const filteredCandidates = candidates.filter(c => 
      (c.metadata.parserConfidence ?? 1.0) > 0.2 && c.pageContent.length > 150
    );

    const uniqueChunks: Document[] = [];
    const seenText = new Set<string>();

    for (const chunk of filteredCandidates) {
      const textFingerprint = chunk.pageContent.slice(0, 100).toLowerCase().replace(/\s+/g, "");
      if (!seenText.has(textFingerprint)) {
        seenText.add(textFingerprint);
        uniqueChunks.push(chunk);
      }
      if (uniqueChunks.length >= 8) break;
    }

    const relevantChunks = uniqueChunks;
    const context = relevantChunks
      .map((chunk: Document, i: number) => {
        const page = chunk.metadata.pageStart ?? "?";
        const toc = chunk.metadata.tocPath ?? "Unknown Section";
        const type = chunk.metadata.nodeType ?? "paragraph";
        return `[SOURCE ${i + 1} | ${toc} | ${type} | Page ${page}]\n${chunk.pageContent}`;
      })
      .join("\n\n---\n\n");

    const systemPrompt = `You are a helpful and precise academic document assistant. 
Your goal is to answer the user's question by synthesizing the document excerpts provided below.

STRICT GUIDELINES:
1. Grounding: You must base your answer ONLY on the provided excerpts.
2. Synthesis: If information is spread across multiple excerpts, connect the dots.
3. Citations: Cite every claim using the format [SOURCE N].
4. Missing Information: If the excerpts were insufficient, say: "The retrieved excerpts from the document were insufficient to answer this question."
5. Precision: Do not use external knowledge.

=== DOCUMENT EXCERPTS ===

${context}

=== END OF EXCERPTS ===

Answer the question now by synthesizing the relevant sources above:`;

    const prompt = `${systemPrompt}\n\nUser Question: ${userQuery}`;

    const sources = relevantChunks.map((c: Document) => ({
      page: c.metadata.pageStart ?? "?",
      file: c.metadata.tocPath ?? "Unknown Section",
      excerpt: c.pageContent.slice(0, 150) + "...",
      nodeType: c.metadata.nodeType,
    }));

    const stream = await llm.stream(prompt);
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(`__SOURCES__:${JSON.stringify(sources)}\n`));
        for await (const chunk of stream) {
          controller.enqueue(encoder.encode(chunk.content as string));
        }
        controller.close();
      },
    });

    return new Response(readableStream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });

  } catch (err) {
    console.error("[chat] error:", err);
    let errorMessage = err instanceof Error ? err.message : "Chat generation failed";
    let statusCode = 500;

    if (err && typeof err === 'object' && 'status' in err && err.status === 503 || errorMessage.includes("503") || errorMessage.includes("Service Unavailable")) {
      errorMessage = "Google Gemini is currently experiencing high demand and is unavailable (503). Please wait a few moments and try again.";
      statusCode = 503;
    }

    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
