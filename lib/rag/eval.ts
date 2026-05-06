import fs from "fs";
import path from "path";

export async function runBenchmark(docId: string) {
  const benchPath = path.join(process.cwd(), "benchmark", "cs_bench.json");
  const { questions } = JSON.parse(fs.readFileSync(benchPath, "utf-8"));

  console.log(`Starting benchmark for document ${docId}...`);
  const results = [];

  for (const q of questions) {
    console.log(`Testing query: ${q.text}`);
    
    const start = Date.now();
    try {
      const res = await fetch("http://localhost:3000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: q.text }], docId }),
      });
      const data = await res.json();
      const end = Date.now();

      const matchedNodeTypes = data.sources?.filter((s: { file: string }) => 
        q.expectedNodeTypes.some((type: string) => s.file.toLowerCase().includes(type))
      ) || [];

      results.push({
        questionId: q.id,
        latency: end - start,
        success: !data.error,
        recall: matchedNodeTypes.length / q.expectedNodeTypes.length,
        answer: data.answer?.slice(0, 100) + "...",
      });
    } catch (e) {
      console.error(`Failed question ${q.id}:`, e);
    }
  }

  const avgLatency = results.reduce((acc, r) => acc + r.latency, 0) / results.length;
  const avgRecall = results.reduce((acc, r) => acc + r.recall, 0) / results.length;

  console.log("\n--- BENCHMARK RESULTS ---");
  console.log(`Avg Latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`Avg Recall: ${(avgRecall * 100).toFixed(2)}%`);
  
  return results;
}
