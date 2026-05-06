export interface Source {
  page: number | string;
  file: string;
  excerpt: string;
  nodeType?: string;
}

export default function SourceCard({ source, index }: { source: Source; index: number }) {
  return (
    <div
      className="animate-fade-up"
      style={{
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "12px",
        padding: "12px 14px",
        transition: "border-color 0.2s, background 0.2s",
        cursor: "default",
        animationDelay: `${(index - 1) * 60}ms`,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(99,102,241,0.3)";
        (e.currentTarget as HTMLDivElement).style.background = "rgba(99,102,241,0.04)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.07)";
        (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <span style={{
          background: "rgba(99,102,241,0.2)",
          color: "#a5b4fc",
          fontSize: "10px",
          fontWeight: 700,
          padding: "2px 7px",
          borderRadius: "6px",
          letterSpacing: "0.05em",
          flexShrink: 0,
        }}>
          {index}
        </span>
        <span style={{ fontSize: "11px", color: "#9090a8", fontWeight: 500 }}>
          {source.nodeType ? `${source.nodeType.toUpperCase()} · ` : ""}Page {source.page}
        </span>
        <span style={{ color: "#2d2d3a", fontSize: "11px" }}>·</span>
        <span style={{
          fontSize: "11px", color: "#6b6b80",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          maxWidth: "180px",
        }} title={source.file}>
          {source.file}
        </span>
      </div>
      <p style={{
        fontSize: "12px",
        lineHeight: 1.6,
        display: "-webkit-box",
        WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        color: "#70708a",
      }}>
        {source.excerpt}
      </p>
    </div>
  );
}
