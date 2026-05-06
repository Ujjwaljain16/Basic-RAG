"use client";
import { useState, useRef } from "react";

interface UploadZoneProps {
  onUpload: (file: File) => Promise<void>;
  isUploaded: boolean;
  fileName: string | null;
  chunkCount: number | null;
}

export default function UploadZone({ onUpload, isUploaded, fileName, chunkCount }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    setIsUploading(true);
    try {
      await onUpload(file);
    } catch (e) {
      console.error(e);
      alert("Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  if (isUploaded && fileName) {
    return (
      <div className="flex flex-col gap-4 animate-fade-up">
        <div style={{
          background: "linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.05))",
          border: "1px solid rgba(99,102,241,0.25)",
          borderRadius: "16px",
          padding: "20px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
            <div style={{
              width: "36px", height: "36px", borderRadius: "10px",
              background: "rgba(99,102,241,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              animation: "pulse-ring 2s ease-out 1",
            }}>
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#a5b4fc" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p style={{ fontSize: "13px", fontWeight: 600, color: "#a5b4fc", marginBottom: "2px" }}>Indexed Successfully</p>
              <p style={{ fontSize: "12px", color: "#6366f1", opacity: 0.8 }}>{chunkCount} chunks created</p>
            </div>
          </div>
          <div style={{
            background: "rgba(0,0,0,0.2)", borderRadius: "10px", padding: "10px 14px",
            display: "flex", alignItems: "center", gap: "8px"
          }}>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#9090a8" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span style={{ fontSize: "12px", color: "#9090a8", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {fileName}
            </span>
          </div>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px dashed rgba(255,255,255,0.1)",
            borderRadius: "12px",
            padding: "12px",
            fontSize: "12px",
            color: "#55556a",
            cursor: "pointer",
            transition: "all 0.2s",
            width: "100%",
            textAlign: "center",
          }}
          onMouseEnter={e => {
            (e.target as HTMLButtonElement).style.borderColor = "rgba(99,102,241,0.3)";
            (e.target as HTMLButtonElement).style.color = "#9090a8";
          }}
          onMouseLeave={e => {
            (e.target as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.1)";
            (e.target as HTMLButtonElement).style.color = "#55556a";
          }}
        >
          + Upload another document
        </button>
        <input ref={fileInputRef} type="file" className="hidden" accept="application/pdf,text/plain"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
        onClick={() => !isUploading && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${isDragging ? "#6366f1" : "rgba(255,255,255,0.1)"}`,
          borderRadius: "16px",
          padding: "32px 16px",
          textAlign: "center",
          cursor: isUploading ? "default" : "pointer",
          background: isDragging ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.01)",
          transition: "all 0.25s ease",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <div style={{
          width: "52px", height: "52px", borderRadius: "14px",
          background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.1))",
          border: "1px solid rgba(99,102,241,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {isUploading ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth={2} className="animate-spin">
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity={0.3}/>
              <path d="M21 12a9 9 0 01-9 9" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          )}
        </div>

        <div>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "#c4c4d8", marginBottom: "4px" }}>
            {isUploading ? "Indexing document…" : "Drop your document here"}
          </p>
          <p style={{ fontSize: "12px", color: "#55556a" }}>
            {isUploading ? "Chunking and embedding with HuggingFace" : "PDF or TXT · up to 10MB"}
          </p>
        </div>

        {!isUploading && (
          <span style={{
            marginTop: "4px",
            background: "rgba(99,102,241,0.15)",
            border: "1px solid rgba(99,102,241,0.3)",
            borderRadius: "8px",
            padding: "6px 18px",
            fontSize: "12px",
            fontWeight: 600,
            color: "#a5b4fc",
          }}>
            Browse File
          </span>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="application/pdf,text/plain"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
    </div>
  );
}
