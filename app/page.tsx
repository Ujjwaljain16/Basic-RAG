"use client";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import UploadZone from "@/components/UploadZone";
import SourceCard, { Source } from "@/components/SourceCard";

type Message = { role: "user" | "assistant"; content: string };

const SUGGESTED = [
  "What is WAL (Write-Ahead Log)?",
  "Explain B-Trees and their structure",
  "What is an LSM Tree?",
  "How does compaction work?",
  "What is MMAP in databases?",
];

export default function Home() {
  const [docId, setDocId]       = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [chunkCount, setChunkCount] = useState<number | null>(null);
  const [sources, setSources]   = useState<Source[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef               = useRef<HTMLDivElement>(null);
  const inputRef                = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleUpload = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res  = await fetch("/api/ingest", { method: "POST", body: fd });
    const data = await res.json();
    if (data.success) {
      setDocId(data.docId);
      setFileName(data.fileName);
      setChunkCount(data.totalChunks ?? null);
      setMessages([]);
      setSources([]);
    } else {
      alert("Error: " + data.error);
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const newMsgs: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMsgs);
    setInput("");
    setIsLoading(true);
    
    const assistantMsgIdx = newMsgs.length;
    setMessages(prev => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMsgs, docId }),
      });

      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let fullContent = "";

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        const chunkValue = decoder.decode(value);
        
        if (chunkValue.startsWith("__SOURCES__:")) {
          const splitIdx = chunkValue.indexOf("\n");
          const sourcesJson = chunkValue.substring(12, splitIdx);
          try {
            setSources(JSON.parse(sourcesJson));
          } catch (e) {
            console.error("Error parsing sources:", e);
          }
          const remaining = chunkValue.substring(splitIdx + 1);
          fullContent += remaining;
        } else {
          fullContent += chunkValue;
        }

        setMessages(prev => {
          const next = [...prev];
          next[assistantMsgIdx] = { role: "assistant", content: fullContent };
          return next;
        });
      }
    } catch (e) {
      console.error(e);
      alert("Error generating response. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); sendMessage(input); };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      background: "var(--bg-base)", overflow: "hidden",
    }}>
      <header style={{
        height: "52px", flexShrink: 0,
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", paddingInline: "20px", gap: "12px",
        background: "rgba(17,17,24,0.8)", backdropFilter: "blur(12px)",
        position: "relative", zIndex: 10,
      }}>
        <div style={{
          width: "28px", height: "28px", borderRadius: "8px",
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
        <span style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "-0.01em" }}>NotebookRAG</span>
        <span style={{
          fontSize: "10px", fontWeight: 600, padding: "2px 8px",
          background: "rgba(99,102,241,0.15)", color: "#a5b4fc",
          borderRadius: "99px", border: "1px solid rgba(99,102,241,0.25)",
          letterSpacing: "0.08em",
        }}>GEMINI</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e" }} />
          <span style={{ fontSize: "11px", color: "#9090a8" }}>Live</span>
        </div>
      </header>
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <aside style={{
          width: "300px", flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--bg-panel)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}>
          <div style={{
            padding: "16px 18px 14px",
            borderBottom: "1px solid var(--border)",
          }}>
            <p style={{ fontSize: "11px", fontWeight: 600, color: "#55556a", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" }}>
              Document
            </p>
            <UploadZone
              onUpload={handleUpload}
              isUploaded={!!docId}
              fileName={fileName}
              chunkCount={chunkCount}
            />
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
            {sources.length > 0 ? (
              <>
                <p style={{ fontSize: "11px", fontWeight: 600, color: "#55556a", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px" }}>
                  Sources · {sources.length}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {sources.map((s, i) => <SourceCard key={i} source={s} index={i + 1} />)}
                </div>
              </>
            ) : docId ? (
              <div style={{ textAlign: "center", paddingTop: "32px" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2d2d3a" strokeWidth={1.5} style={{ margin: "0 auto 10px" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p style={{ fontSize: "12px", color: "#3a3a4e" }}>Sources will appear after your first question</p>
              </div>
            ) : (
              <div style={{ textAlign: "center", paddingTop: "32px" }}>
                <p style={{ fontSize: "12px", color: "#2d2d3a" }}>Upload a document to begin</p>
              </div>
            )}
          </div>
        </aside>
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-base)" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
            {!docId ? (
              <div style={{
                height: "100%", display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: "20px",
                textAlign: "center",
              }}>
                <div style={{
                  width: "72px", height: "72px", borderRadius: "20px",
                  background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.1))",
                  border: "1px solid rgba(99,102,241,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <div>
                  <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px", color: "#c4c4d8" }}>Chat with your document</h2>
                  <p style={{ fontSize: "14px", color: "#55556a", maxWidth: "360px" }}>
                    Upload a PDF or TXT file on the left to start asking questions. Answers are grounded exclusively in your document.
                  </p>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div style={{
                height: "100%", display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: "24px",
              }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{
                    width: "44px", height: "44px", borderRadius: "12px",
                    background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.2)",
                    display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px",
                  }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                  </div>
                  <p style={{ fontSize: "15px", fontWeight: 600, color: "#c4c4d8", marginBottom: "4px" }}>Ready! Ask anything about {fileName}</p>
                  <p style={{ fontSize: "13px", color: "#55556a" }}>Try one of these to get started</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%", maxWidth: "540px" }}>
                  {SUGGESTED.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(q)}
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        borderRadius: "12px",
                        padding: "12px 16px",
                        textAlign: "left",
                        fontSize: "13px",
                        color: "#9090a8",
                        cursor: "pointer",
                        transition: "all 0.18s",
                        display: "flex", alignItems: "center", gap: "10px",
                      }}
                      onMouseEnter={e => {
                        const el = e.currentTarget;
                        el.style.borderColor = "rgba(99,102,241,0.3)";
                        el.style.background = "rgba(99,102,241,0.05)";
                        el.style.color = "#c4c4d8";
                      }}
                      onMouseLeave={e => {
                        const el = e.currentTarget;
                        el.style.borderColor = "rgba(255,255,255,0.07)";
                        el.style.background = "rgba(255,255,255,0.03)";
                        el.style.color = "#9090a8";
                      }}
                    >
                      <span style={{ color: "#6366f1", flexShrink: 0 }}>→</span>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "760px", margin: "0 auto" }}>
                {messages.map((m, i) => (
                  <div key={i} className="animate-fade-up" style={{
                    display: "flex",
                    justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                    animationDelay: "0ms",
                  }}>
                    {m.role === "assistant" && (
                      <div style={{
                        width: "28px", height: "28px", borderRadius: "8px",
                        background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, marginRight: "10px", marginTop: "2px",
                      }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      </div>
                    )}
                    <div style={{
                      maxWidth: m.role === "user" ? "75%" : "100%",
                      background: m.role === "user"
                        ? "linear-gradient(135deg, #6366f1, #7c3aed)"
                        : "var(--bg-card)",
                      border: m.role === "user" ? "none" : "1px solid var(--border)",
                      borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "4px 18px 18px 18px",
                      padding: "12px 16px",
                      boxShadow: m.role === "user" ? "0 4px 20px rgba(99,102,241,0.25)" : "none",
                    }}>
                      {m.role === "assistant" ? (
                        <div className="prose-chat">
                          {m.content ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {m.content}
                            </ReactMarkdown>
                          ) : (
                            <div style={{ display: "flex", gap: "4px", padding: "4px 0" }}>
                              <div className="dot-bounce" style={{ background: "#6366f1" }} />
                              <div className="dot-bounce" style={{ background: "#6366f1", animationDelay: "0.2s" }} />
                              <div className="dot-bounce" style={{ background: "#6366f1", animationDelay: "0.4s" }} />
                            </div>
                          )}
                        </div>
                      ) : (
                        <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.95)", lineHeight: 1.6 }}>{m.content}</p>
                      )}
                    </div>
                  </div>
                ))}

                <div ref={bottomRef} />
              </div>
            )}
          </div>
          <div style={{
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
            padding: "14px 32px 18px",
          }}>
            {!docId && (
              <p style={{ textAlign: "center", fontSize: "12px", color: "#3a3a4e", marginBottom: "10px" }}>
                ↑ Upload a document first to enable chat
              </p>
            )}
            <form onSubmit={handleSubmit} style={{ display: "flex", gap: "10px", alignItems: "flex-end", maxWidth: "760px", margin: "0 auto" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={e => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
                  }}
                  onKeyDown={handleKey}
                  placeholder={docId ? "Ask anything about your document… (Enter to send)" : "Upload a document to start chatting…"}
                  disabled={!docId || isLoading}
                  style={{
                    width: "100%",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                    borderRadius: "14px",
                    padding: "12px 16px",
                    fontSize: "14px",
                    color: "var(--text-primary)",
                    outline: "none",
                    resize: "none",
                    lineHeight: 1.5,
                    transition: "border-color 0.2s, box-shadow 0.2s",
                    fontFamily: "inherit",
                    minHeight: "48px",
                    maxHeight: "140px",
                    overflowY: "auto",
                  }}
                  onFocus={e => {
                    e.target.style.borderColor = "rgba(99,102,241,0.5)";
                    e.target.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.1)";
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = "var(--border)";
                    e.target.style.boxShadow = "none";
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={!docId || isLoading || !input.trim()}
                style={{
                  width: "44px", height: "44px", borderRadius: "12px", flexShrink: 0,
                  background: (!docId || isLoading || !input.trim())
                    ? "rgba(255,255,255,0.04)"
                    : "linear-gradient(135deg, #6366f1, #7c3aed)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  cursor: (!docId || isLoading || !input.trim()) ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.2s",
                  boxShadow: (!docId || isLoading || !input.trim()) ? "none" : "0 4px 14px rgba(99,102,241,0.35)",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke={(!docId || isLoading || !input.trim()) ? "#3a3a4e" : "white"}
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </form>
            <p style={{ textAlign: "center", fontSize: "11px", color: "#2d2d3a", marginTop: "10px" }}>
              Responses are grounded exclusively in the uploaded document
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
