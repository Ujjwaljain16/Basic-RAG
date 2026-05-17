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

    const perfObserver = {
      timings: {} as Record<string, number>,
      start(label: string) { this.timings[label] = Date.now(); },
      end(label: string) { this.timings[label] = Date.now() - this.timings[label]; }
    };
    perfObserver.start("Total");

    const userQuery = currentMessage;
    
    // 1. Subquery Generation
    perfObserver.start("SubqueryGeneration");
    let queries = [currentMessage];
    const chatHistory = messages.slice(0, -1).slice(-4).map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join("\n");
    const subqueryPrompt = `Given the user question and chat history, generate up to 2 distinct search queries to retrieve relevant documents.
The queries should cover different aspects, abstractions, or keywords of the user's question.
Return ONLY a valid JSON array of strings. Do not include markdown formatting or explanation.

Chat History:
${chatHistory}

User Question: ${currentMessage}

JSON Array:`;

    try {
      const subqueryRes = await llm.invoke(subqueryPrompt);
      const content = (subqueryRes.content as string).trim();
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          queries = Array.from(new Set([currentMessage, ...parsed])).slice(0, 3);
        }
      }
    } catch (err) {
      console.warn("[chat] Subquery generation failed, using raw query:", err);
    }
    perfObserver.end("SubqueryGeneration");

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

    // 2. Parallel Retrieval
    perfObserver.start("VectorRetrieval");
    const candidatesArrays = await Promise.all(
      queries.map(q => vectorStore.similaritySearch(q, 20, filter))
    );
    const allCandidates = candidatesArrays.flat();
    perfObserver.end("VectorRetrieval");

    // 3. Deduplication
    const uniqueChunks: Document[] = [];
    const seenText = new Set<string>();

    for (const chunk of allCandidates) {
      if ((chunk.metadata.parserConfidence ?? 1.0) <= 0.2 || chunk.pageContent.length <= 150) continue;
      const textFingerprint = chunk.pageContent.slice(0, 100).toLowerCase().replace(/\s+/g, "");
      if (!seenText.has(textFingerprint)) {
        seenText.add(textFingerprint);
        uniqueChunks.push(chunk);
      }
    }

    // 4. Cross-Encoder Reranking
    perfObserver.start("Reranking");
    let relevantChunks = uniqueChunks.slice(0, 5); // Fallback top 5
    let topScore = 1.0;

    if (uniqueChunks.length > 0) {
      try {
        const rerankRes = await fetch("https://api-inference.huggingface.co/models/cross-encoder/ms-marco-MiniLM-L-6-v2", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            inputs: uniqueChunks.map(c => ({ text: currentMessage, text_pair: c.pageContent.slice(0, 512) }))
          })
        });

        if (rerankRes.ok) {
          const scores = await rerankRes.json();
          const scoredChunks = uniqueChunks.map((chunk, index) => {
            let score = 0;
            const resScore = scores[index];
            if (typeof resScore === "number") score = resScore;
            else if (Array.isArray(resScore) && resScore[0] && typeof resScore[0].score === "number") {
                score = resScore[0].score;
            } else if (resScore && typeof resScore.score === "number") {
                score = resScore.score;
            }
            
            // Normalize logit to 0-1 range using sigmoid if it seems like a logit (can be negative or > 1)
            const normalizedScore = (score < 0 || score > 1) ? 1 / (1 + Math.exp(-score)) : score;
            return { chunk, score: normalizedScore };
          });
          
          scoredChunks.sort((a, b) => b.score - a.score);
          topScore = scoredChunks.length > 0 ? scoredChunks[0].score : 0;
          
          relevantChunks = scoredChunks
            .filter(c => c.score > 0.01) // Filter out complete noise
            .map(c => c.chunk)
            .slice(0, 5);
        } else {
           console.warn("[chat] HF Rerank failed, using fallback dense retrieval ranking.", await rerankRes.text());
        }
      } catch (e) {
        console.warn("[chat] Reranking exception:", e);
      }
    }
    perfObserver.end("Reranking");

    // 5. Confidence Thresholding
    // We use a relatively low threshold initially to avoid aggressive false negatives,
    // as suggested by the user but tuned for standard cross-encoder normalized scores.
    if (relevantChunks.length === 0 || topScore < 0.15) {
      const fallbackStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("Based on the provided document, I do not have sufficient context to answer this question accurately."));
          controller.close();
        }
      });
      return new Response(fallbackStream, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // 6. Context Compression & Parent Mapping
    perfObserver.start("ContextCompression");
    const uniqueParents = new Map<string, Document>();
    for (const chunk of relevantChunks) {
      const parentId = chunk.metadata.nodeId || chunk.pageContent;
      if (!uniqueParents.has(parentId)) {
        uniqueParents.set(parentId, chunk);
      }
    }
    
    const parentChunks = Array.from(uniqueParents.values());
    
    let compressedContext = "";
    if (parentChunks.length > 0) {
      const rawContext = parentChunks.map((chunk, i) => {
        const page = chunk.metadata.pageStart ?? "?";
        const toc = chunk.metadata.tocPath ?? "Unknown Section";
        const type = chunk.metadata.nodeType ?? "paragraph";
        return `[SOURCE ${i + 1} | ${toc} | ${type} | Page ${page}]\n${chunk.metadata.parentContent || chunk.pageContent}`;
      }).join("\n\n---\n\n");

      const compressionPrompt = `Extract the most relevant sentences and paragraphs from the following source documents that help answer the user's question. 
Keep the source tags (e.g. [SOURCE 1 | ...]) intact for citations. If a source is entirely irrelevant, omit it. Do not change the meaning.

User Question: ${userQuery}

Source Documents:
${rawContext}

Extracted Context:`;
      
      try {
        const compressionRes = await llm.invoke(compressionPrompt);
        compressedContext = (compressionRes.content as string).trim();
      } catch(err) {
        console.warn("[chat] Context compression failed, using raw parent chunks.", err);
        compressedContext = rawContext;
      }
    }
    perfObserver.end("ContextCompression");

    const context = compressedContext;

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

    const sources = parentChunks.map((c: Document) => ({
      page: c.metadata.pageStart ?? "?",
      file: c.metadata.tocPath ?? "Unknown Section",
      excerpt: (c.metadata.parentContent || c.pageContent).slice(0, 150) + "...",
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

    perfObserver.end("Total");
    console.log("[Observability] Request Metrics:", JSON.stringify({ 
      query: currentMessage, 
      timingsMs: perfObserver.timings,
      retrievedChunks: allCandidates.length,
      rerankedChunks: uniqueChunks.length,
      finalSources: parentChunks.length
    }));

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
