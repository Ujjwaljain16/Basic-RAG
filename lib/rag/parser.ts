export type NodeType = 
  | "chapter" | "section" | "subsection" 
  | "definition" | "theorem" | "lemma" | "corollary" 
  | "proof" | "example" | "algorithm" | "code_block" | "paragraph";

export interface StructuralNode {
  id: string;
  type: NodeType;
  title?: string;
  content: string;
  pageStart: number;
  pageEnd: number;
  startChar: number;
  endChar: number;
  parentId?: string;
  tocPath: string;
  isAtomic: boolean;
  confidence: number;
}

export function stripHeadersFooters(pages: { text: string; pageNumber: number }[]): string {
  if (pages.length < 2) return pages.map(p => p.text).join("\n");

  const pageLines = pages.map(p => p.text.split("\n"));
  const headerCandidates = new Map<string, number>();
  const footerCandidates = new Map<string, number>();

  pageLines.forEach(lines => {
    if (lines.length > 0) {
      const top = lines[0].trim();
      if (top) headerCandidates.set(top, (headerCandidates.get(top) || 0) + 1);
    }
    if (lines.length > 1) {
      const bottom = lines[lines.length - 1].trim();
      if (bottom) footerCandidates.set(bottom, (footerCandidates.get(bottom) || 0) + 1);
    }
  });

  const headersToRemove = new Set(
    Array.from(headerCandidates.entries())
      .filter(([, count]) => count > pages.length * 0.8)
      .map(([text]) => text)
  );

  const footersToRemove = new Set(
    Array.from(footerCandidates.entries())
      .filter(([, count]) => count > pages.length * 0.8)
      .map(([text]) => text)
  );

  return pages
    .map(p => {
      const lines = p.text.split("\n");
      return lines
        .filter((line, i) => {
          const trimmed = line.trim();
          if (i === 0 && headersToRemove.has(trimmed)) return false;
          if (i === lines.length - 1 && footersToRemove.has(trimmed)) return false;
          return true;
        })
        .join("\n");
    })
    .join("\n");
}

export function detectStructuralBlocks(fullText: string): StructuralNode[] {
  const detectors = [
    { type: "chapter" as NodeType, regex: /^Chapter\s+(\d+)\s+(.+)$/gim, atomic: false },
    { type: "section" as NodeType, regex: /^(\d+\.\d+)\s+(.+)$/gim, atomic: false },
    { type: "subsection" as NodeType, regex: /^(\d+\.\d+\.\d+)\s+(.+)$/gim, atomic: false },
    { type: "theorem" as NodeType, regex: /(Theorem|Lemma|Corollary|Definition)\s+(\d+\.\d+\.\d+)\s+(.+?)\.(?=\s|$)/gi, atomic: true },
    { type: "proof" as NodeType, regex: /Proof\.\s+([\s\S]+?)(?=■|Theorem|Section|Chapter|$)/gi, atomic: true },
    { type: "algorithm" as NodeType, regex: /Algorithm\s+(\d+\.\d+)\s+([\s\S]+?)(?=\n\n|\n[A-Z]|$)/gi, atomic: true },
    { type: "code_block" as NodeType, regex: /```[a-z]*\n([\s\S]+?)\n```/g, atomic: true },
  ];

  const nodes: StructuralNode[] = [];

  const getPage = (offset: number) => Math.floor(offset / 2000) + 1;

  detectors.forEach(d => {
    let match;
    while ((match = d.regex.exec(fullText)) !== null) {
      const content = match[0];
      const startChar = match.index;
      const endChar = startChar + content.length;

      const isLikelyTOC = (content.match(/\.{4,}/g) || []).length > 0;

      nodes.push({
        id: `${d.type}-${startChar}`,
        type: d.type,
        title: match[2]?.slice(0, 50),
        content,
        pageStart: getPage(startChar),
        pageEnd: getPage(endChar),
        startChar,
        endChar,
        tocPath: "", 
        isAtomic: d.atomic,
        confidence: isLikelyTOC ? 0.1 : 0.9,
      });
    }
  });

  nodes.sort((a, b) => a.startChar - b.startChar);

  let currentChapter = "1";
  let currentSection = "?";
  nodes.forEach(node => {
    if (node.type === "chapter") {
      const match = node.content.match(/Chapter\s+(\d+)/i);
      if (match) {
        currentChapter = match[1];
        currentSection = "?";
      }
    }
    if (node.type === "section") {
      const match = node.content.match(/(\d+\.\d+)/);
      if (match) currentSection = match[1];
    }
    node.tocPath = `Ch ${currentChapter} > Sec ${currentSection}`;
  });

  const finalNodes: StructuralNode[] = [];
  let lastIdx = 0;

  nodes.forEach(node => {
    if (node.startChar > lastIdx) {
      const gapContent = fullText.slice(lastIdx, node.startChar).trim();
      if (gapContent) {
        if (gapContent.length > 20 || gapContent.match(/[a-z]/i)) {
          finalNodes.push({
            id: `para-${lastIdx}`,
            type: "paragraph",
            content: gapContent,
            pageStart: getPage(lastIdx),
            pageEnd: getPage(node.startChar),
            startChar: lastIdx,
            endChar: node.startChar,
            tocPath: node.tocPath,
            isAtomic: false,
            confidence: 0.5,
          });
        }
      }
    }
    finalNodes.push(node);
    lastIdx = node.endChar;
  });

  if (lastIdx < fullText.length) {
    const remainingContent = fullText.slice(lastIdx).trim();
    if (remainingContent.length > 20) {
      finalNodes.push({
        id: `para-${lastIdx}`,
        type: "paragraph",
        content: remainingContent,
        pageStart: getPage(lastIdx),
        pageEnd: getPage(fullText.length),
        startChar: lastIdx,
        endChar: fullText.length,
        tocPath: nodes.length > 0 ? nodes[nodes.length - 1].tocPath : "Ch 1 > Sec ?",
        isAtomic: false,
        confidence: 0.5,
      });
    }
  }

  return finalNodes;
}
