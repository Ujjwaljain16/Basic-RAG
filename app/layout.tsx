import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NotebookRAG — AI Document Chat",
  description: "Chat with your PDF and text documents using Gemini AI. Grounded answers with source citations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
