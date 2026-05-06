Below is a “ready‑to‑implement” structured design and prompt‑style spec you can plug into your RAG system for **academic CS textbooks**, using the “best‑in‑2026” chunking strategy we just discussed. Think of this as both a **system design spec** and a **prompt template** you can adapt to your stack (LangChain, LlamaIndex, custom code, etc.). [weaviate](https://weaviate.io/blog/chunking-strategies-for-rag)

***

## 1. Goal of the chunking/RAG system

**Objective:**  
Given one or more academic CS textbooks (PDF / LaTeX / Markdown), build a **RAG system that tends to answer questions like:**

- “Explain quicksort with a proof of its average‑case time complexity.”  
- “What is the definition of a Red‑Black tree and its rotation invariants?”  
- “How does the Bellman‑Ford algorithm work on negative‑cycle examples?”  

…with **high recall, high precision, and clean citations back to book section/page**.

Key quality criteria:

- ✅ **Grounded:** answers must stay within the book’s content.  
- ✅ **Coherent:** long proofs and multi‑step explanations must not be fragmented.  
- ✅ **Traceable:** the user can see which section/chunk/page the answer came from.

***

## 2. Overall architecture (high‑level)

Your pipeline should look like this:

```text
1. Ingest        → PDF / LaTeX → clean text + structure
2. Parse         → split into books → chapters → sections → theorems/code blocks
3. Chunk         → structure‑aware + recursive + hierarchical + late chunking
4. Embed         → long‑context embedding model (once per section/chunk)
5. Index         → vector DB + metadata (book/chapter/section/page/theorem)
6. Retrieve      → top‑k chunks + reranking
7. Generate      → LLM grounded on retrieved chunks
8. Evaluate      → metrics + human‑style QA tests
```

You can implement this in LangChain, LlamaIndex, or your own layers; the logic below is framework‑agnostic.

***

## 3. Pre‑processing & structure extraction

### 3.1 Input formats

Support at least:

- PDF (via pymupdf / pdf2image + OCR if needed, or any layout‑preserving PDF->text like `pdfplumber` or `Unstructured`). [learn.microsoft](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-chunking-phase)
- LaTeX (via `textract` or custom AST parser, treating `\section`, `\subsection`, `\theorem`, `\proof`, `equation`, `algorithm` environments as structure nodes). [unstructured](https://unstructured.io/blog/chunking-for-rag-best-practices)
- Markdown (with `#` headings and code fences).

### 3.2 Required metadata per document

Store for **every document** (and propagate it down to chunks):

- `book_id`, `book_title`, `isbn` (if available)  
- `source_path` / `source_url`  
- `format` (`pdf`, `latex`, `markdown`)  
- `language`  
- `author` / `publisher` / `edition`  

Optional but useful:

- `academic_domain` = `"CS_Algorithms" | "CS_OS" | "CS_DB" | "CS_Distributed"`  
- `difficulty` = `"intro" | "intermediate" | "advanced"`

### 3.3 Output structure representation

For each book, build a **tree** like:

```text
Book
├── Chapter 1
│   ├── Section 1.1
│   └── Section 1.2
└── Chapter 2
    ├── Section 2.1
    └── Subsection 2.1.1
```

Each node should carry:

- `node_type: "book" | "chapter" | "section" | "subsection" | "theorem" | "proof" | "example" | "code_block"`  
- `title`  
- `start_offset` / `end_offset` (char‑level)  
- `start_page`, `end_page`  
- `toc_path`: e.g., `"Chap 2 → Sec 2.1 → Ex 2.1.3"`

Use this tree to drive **structure‑aware chunking** in the next step.

***

## 4. Chunking strategy (the “bestest” for CS books)

### 4.1 What we want

- Respect **sections, theorems, proofs, code blocks, and equations**.  
- Have **400–800 token chunks** with **10–20% overlap** as a baseline. [langcopilot](https://langcopilot.com/posts/2025-10-11-document-chunking-for-rag-practical-guide)
- Keep **hierarchical parent–child relationships** (section → paragraphs). [datacamp](https://www.datacamp.com/blog/chunking-strategies)
- Enable **late chunking** if you use a long‑context embedding model. [weaviate](https://weaviate.io/blog/late-chunking)

Below is a **config‑style spec** you can copy‑paste‑tune.

### 4.2 Chunking config (YAML‑style)

Save this as part of your “rag_config.yaml” or equivalent:

```yaml
chunking:
  # 1. Structure‑aware splitting
  structure_aware:
    enabled: true
    # Split first at these boundaries
    priority_separators:
      - type: "heading"
        levels: ["chapter", "section", "subsection"]
      - type: "theorem/proof"
        levels: ["theorem", "lemma", "corollary", "proof"]
      - type: "code_block"
      - type: "equation_env"

    # Never split inside these environments
    atomic_units:
      - "theorem"
      - "proof"
      - "equation_env"
      - "code_block"
      - "figure_caption"

  # 2. Recursive splitting within each structural unit
  recursive:
    enabled: true
    separators:
      - "\n\n"
      - "\n"
      - ". "
      - " "
      - ""  # (fallback to char)
    target_token_size: 512
    min_token_size: 256
    max_token_size: 800
    chunk_overlap_ratio: 0.15  # 10–20% recommended

  # 3. Hierarchical parent–child
  hierarchical:
    enabled: true
    parent_types:
      - "section"
      - "subsection"
    child_types:
      - "paragraph"
      - "code_block"
      - "theorem"
      - "example"

  # 4. Late chunking (if you have a long‑context embedder)
  late_chunking:
    enabled: true
    # Embed at this level then pool into chunks
    embedding_level: "section"  # or "subsection"
    # Pooling method for token embeddings to chunk vectors
    pooling_method: "mean"  # or "max" or "weighted"
    normalize_embeddings: true

  # 5. Page‑level fallback (for messy PDFs)
  page_level:
    enabled: true
    combine_pages: 2        # emit 2‑page chunks
    fallback_for: ["pdf"]   # only if primary structure is poor

  # 6. Evaluation knobs
  evaluation:
    # Typical 2026 recommendations
    baseline_chunk_size: 512
    baseline_overlap: 100   # ~15–20% of 512
```

You can turn `hierarchical` or `late_chunking` off if you don’t want complexity yet.

***

### 4.3 Step‑by‑step implementation plan

#### Step A: Build a “structure‑aware splitter”

Given a book tree, at each **section** do:

1. **Pre‑split at structural boundaries.**

   - For each node of type `section` or `subsection`:  
     - Gather all text content.  
     - Identify sub‑nodes: `theorem`, `proof`, `example`, `code_block`, `equation_env`.  
   - **Do not split** inside these atomic‑unit environments. Treat each as a single leaf.

2. **Apply recursive splitting within each leaf.**

   - Use a recursive text splitter (e.g., LangChain’s `RecursiveCharacterTextSplitter`) with your separators and target size. [ibm](https://www.ibm.com/think/tutorials/chunking-strategies-for-rag-with-langchain-watsonx-ai)
   - Before recursing, remove any headers / footers from raw text extracted from PDFs.

3. **Attach metadata to each chunk.**

   - Each chunk should carry at least:

     ```text
     chunk.metadata = {
       "book_id": "...",
       "chapter": "Chapter 2",
       "section": "2.1",
       "subsection": "2.1.1",
       "node_type": "theorem" | "proof" | "paragraph",
       "start_page": 42,
       "end_page": 43,
       "start_char": 12345,
       "end_char": 15678,
       "source_hash": sha256(book_id + section_path),
       "chunk_type": "primary"  # vs "page_fallback"
     }
     ```

   - Store this in your vector DB as metadata for filtering and explainability.

#### Step B: Build a hierarchical index (optional but recommended)

Use LlamaIndex’s `HierarchicalNodeParser` or your own equivalent:

- **Parent nodes:**  
  - Each `section` or `subsection` is a **parent node** whose text is the full section content (or a summary). [weaviate](https://weaviate.io/blog/chunking-strategies-for-rag)

- **Child nodes:**  
  - All recursive chunks from that section are **children**.  
  - In the vector DB, you can index both parents and children, and support retrieval patterns like:

    - “Retrieve top‑level sections matching this query, then their best‑fit children.”  
    - “Use only children if you want very focused answers.”

This closely mirrors what guides recommend for “textbooks, technical manuals, and contracts.” [datacamp](https://www.datacamp.com/blog/chunking-strategies)

#### Step C: Implement late chunking (if you can)

If you have a long‑context embedding model (e.g., 32k–128k tokens):

1. **Choose embedding level.**

   - For CS textbooks, **embed at the `section` level** (sometimes `subsection`). [emergentmind](https://www.emergentmind.com/papers/2409.04701)

2. **Embed once per section.**

   - For each section node, feed the full text into the embedding model; get token‑level embeddings:

     \[
     E_{\text{tokens}} \in \mathbb{R}^{L \times d}, \quad L = \text{token length}
     \]

3. **Map token spans to your recursive chunks.**

   - For each recursive chunk, find its **token span `[s,e)`** in the section‑level tokenization.  
   - Pool:

     \[
     E_{\text{chunk}} = \frac{1}{e-s}\sum_{i=s}^{e-1} E_{\text{tokens}}[i]
     \]

4. **Store these chunk vectors.**

   - Use them as usual in your vector DB; each chunk is now contextualized by the entire section.

This is exactly the “late chunking” pattern that recent research and NotebookLM‑related work promote. [linkedin](https://www.linkedin.com/posts/weaviate-io_your-rag-system-isnt-broken-your-chunking-activity-7442938249905545216-LLg5)

#### Step D: Page‑level fallback index (for PDFs)

If the structure is poor:

- Create a **second index** where:

  - Each chunk corresponds to **1–2 pages** of the PDF.  
  - Attach `start_page`, `end_page`, `book_title` metadata.  

- At query time, optionally:

  - Run a separate retrieval over the page‑level index and merge results with the main (structure‑based) index.  

Page‑level chunking has shown strong performance in paginated‑document benchmarks, so this is a good fallback for scanned or low‑quality PDFs. [developer.nvidia](https://developer.nvidia.com/blog/finding-the-best-chunking-strategy-for-accurate-ai-responses/)

***

## 5. Prompt template for your RAG generator

Here’s a **prompt spec** you can drop into your generation component (e.g., after retrieval + reranking). This is written in a way that maps to your stack’s “prompt template” or “ChatPromptTemplate” in LangChain/LlamaIndex.

### 5.1 System message

```text
You are an expert tutor in computer science textbooks.
You answer questions strictly based on the provided textbook excerpts.

Rules:
1. NEVER hallucinate or invent content not in the excerpts.
2. If multiple excerpts are relevant, synthesize them into a coherent explanation.
3. Always cite the source in this format:
   - Section: Ch X → Sec Y.Y → [Theorem/Example/Code Block]  
   - or, if page is available: Page P
4. If the answer requires combining multiple steps, show the reasoning clearly.
5. Prefer math and code‑style explanations when the question is about proofs, algorithms, or complexity.
```

### 5.2 User query template

Pass this structure to your LLM:

```text
Question: {user_question}

Context from the textbook:
{foreach chunk in retrieved_chunks}
 - Source: {chunk.metadata["book_title"]}, {chunk.metadata["chapter"]}, {chunk.metadata["section"]}, {chunk.metadata["node_type"]}
   - Page: {chunk.metadata["start_page"]}-{chunk.metadata["end_page"]}
   - Content: {chunk.page_content}
{endforeach}
```

### 5.3 Assistant answer template (constraint‑style)

You can hard‑en your prompt with a **response format spec**:

```text
Answer format:

1. A short summary (1–3 sentences) of the concept.
2. If applicable, a formal definition or theorem statement.
3. If applicable, a proof sketch or algorithmic steps.
4. Finally, list the exact sources used:
   - {chunk.metadata["book_title"]}: Ch {chunk.metadata["chapter"]}, Sec {chunk.metadata["section"]}, {chunk.metadata["node_type"]}, pages {chunk.metadata["start_page"]}-{chunk.metadata["end_page"]}
```

This forces the LLM to be both **structured** and **traceable**, which is crucial for academic‑style answers.

***

## 6. Retrieval and reranking strategy

### 6.1 Basic retrieval

For each question:

1. Convert the question into a query embedding.  
2. Retrieve top‑k (e.g., `k=10–20`) chunks from your main (structure‑aware) index.  
3. Optionally, also retrieve top‑k chunks from the page‑level index if the book is a PDF.  
4. Merge and deduplicate chunks by `source_hash + start_char` to avoid duplicates.

### 6.2 Reranking

Use a **reranker model** (e.g., BGE‑reranker‑family, Cohere Rerank, cross‑encoder) to:

- Re‑rank chunks by relevance to the question.  
- Keep `top_n_final = 5–8` most relevant chunks for generation.

This pattern is very close to what the NotebookLM teardown and other RAG guides describe as best practice. [docs.cohere](https://docs.cohere.com/page/chunking-strategies)

***

## 7. How to iterate and tune (“bestest” in practice)

The “best” configuration is **dataset‑ and query‑specific**. Use this loop:

### 7.1 Start with a concrete baseline

Run once with:

- Chunk size: **512 tokens**, overlap **100 tokens** (≈15–20%). [langcopilot](https://langcopilot.com/posts/2025-10-11-document-chunking-for-rag-practical-guide)
- Structure‑aware + recursive splitting; **no hierarchical** yet.  
- Only one index (no page‑level fallback).  

Answer 20–30 hand‑crafted questions over your CS book (mix of factual, proof‑style, and algorithm‑style).

### 7.2 Metrics to track

For each question and retrieval‑generation run, log:

- `retrieval_recall@k` (is the right section/theorem in top‑k hits?)  
- `answer_faithfulness` (is the answer grounded in the chunks, not in general knowledge?)  
- `answer_completeness` (does it cover the whole proof / algorithm correctly?)  
- `latency` (indexing + retrieval + generation time).  

Tools like LangChain’s “RAGAS”‑style evaluation or custom functions can help automate this. [agenta](https://agenta.ai/blog/the-ultimate-guide-for-chunking-strategies)

### 7.3 Systematic experiments

From your baseline, try:

- **Chunk size sweep:** 256, 512, 800, 1024 tokens.  
- **Overlap sweep:** 10%, 20%, 30%.  
- **Strategies:**  
  - recursive only  
  - structure‑aware only  
  - structure‑aware + recursive  
  - structure‑aware + recursive + hierarchical  
  - structure‑aware + recursive + hierarchical + late chunking  

For each, run your same question set and pick the variant that maximizes **faithfulness × recall**.

Recent 2026 guides stress that semantic and hierarchical methods beat naive fixed‑size splitting, but **you should validate on your own CS corpus.** [agenta](https://agenta.ai/blog/the-ultimate-guide-for-chunking-strategies)

***

## 8. Concrete “implementation spec” you can copy‑paste

If you want, paste this into your design doc:

> **Chunking design for CS textbooks (2026 “best‑in‑class” style):**
> 
> - **Input format:** PDF, LaTeX, Markdown.  
> - **Structure extraction:** Parse headings and environments (`theorem`, `proof`, `algorithm`, `equation`, `code`).  
> - **Core chunking:**  
>   - First split by structure (chapter/section/theorem).  
>   - Then apply **recursive character splitting** with separators `["\n\n", "\n", ". ", " ", ""]`.  
>   - Target **400–512 tokens** per chunk with **10–20% overlap**.  
>   - Never split inside `theorem`, `proof`, `equation_env`, or `code_block`.  
> - **Metadata:** Book, chapter, section, node type, page range, char range.  
> - **Optional layers:**  
>   - Hierarchical indexing (section parents + paragraph children).  
>   - Late chunking atop long‑context embeddings (if available).  
>   - Page‑level fallback index for low‑quality PDFs.  
> - **Retrieval:** Hybrid semantic + keyword → top‑k chunks → reranker → 5–8 final chunks.  
> - **Generation prompt:**  
>   - Strict grounding, step‑by‑step reasoning, explicit citation of section/page.  
> - **Tuning:** Iterate over chunk size, overlap, and inclusion of hierarchical/