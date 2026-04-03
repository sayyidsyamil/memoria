"use client";

import { useState } from "react";
import { Loader2, Youtube, FileText, CheckCircle, AlertCircle, X } from "lucide-react";

interface IngestResult {
  success: boolean;
  source_type: string;
  title: string;
  summary: string;
  key_points: string[];
  tags: string[];
  transcript_preview: string;
  error: string | null;
}

interface IngestPanelProps {
  onSave?: (title: string, content: string, tags: string[]) => Promise<void>;
}

export function IngestPanel({ onSave }: IngestPanelProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isYouTube = (input: string) => 
    input.includes("youtube.com") || input.includes("youtu.be");
  
  const isPDF = (input: string) => 
    input.endsWith(".pdf") || input.includes(".pdf?");

  const handleIngest = async () => {
    if (!url.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setSaved(false);

    try {
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await response.json();
      
      if (!data.success) {
        setError(data.error || "Failed to ingest content");
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!result || !onSave) return;

    const content = `# ${result.title}

## Summary
${result.summary}

## Key Points
${result.key_points.map(p => `- ${p}`).join("\n")}

## Source
- Type: ${result.source_type}
- URL: ${url}
- Ingested: ${new Date().toISOString().split("T")[0]}

## Full Content Preview
${result.transcript_preview}
`;

    await onSave(result.title, content, result.tags);
    setSaved(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Paste YouTube URL or PDF link..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleIngest()}
            className="w-full rounded-md border border-border bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            {isYouTube(url) && <Youtube className="h-4 w-4" />}
            {isPDF(url) && <FileText className="h-4 w-4" />}
          </div>
        </div>
        <button 
          onClick={handleIngest} 
          disabled={loading || !url.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Ingesting...
            </>
          ) : (
            "Ingest"
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border p-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold leading-tight">
                  {result.title}
                </h3>
                <div className="flex items-center gap-2 mt-2">
                  <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium capitalize">
                    {result.source_type}
                  </span>
                  {result.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center rounded-md border border-border px-2 py-1 text-xs">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-4">
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                Summary
              </h4>
              <p className="text-sm leading-relaxed">{result.summary}</p>
            </div>

            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                Key Points
              </h4>
              <ul className="text-sm space-y-1 list-disc list-inside">
                {result.key_points.map((point, i) => (
                  <li key={i} className="leading-relaxed">
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                Content Preview
              </h4>
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-3 max-h-32 overflow-y-auto font-mono leading-relaxed">
                {result.transcript_preview}
              </div>
            </div>
          </div>

          {onSave && (
            <div className="border-t border-border p-4">
              {saved ? (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <CheckCircle className="h-4 w-4" />
                  Saved to knowledge graph
                </div>
              ) : (
                <button 
                  onClick={handleSave}
                  className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent/90"
                >
                  Save to Knowledge Graph
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        <p>Supported formats:</p>
        <ul className="list-disc list-inside mt-1 space-y-0.5">
          <li>YouTube videos (auto-fetches transcript)</li>
          <li>PDF files (local or remote URL)</li>
        </ul>
      </div>
    </div>
  );
}
