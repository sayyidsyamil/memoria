"use client";

import { useState, useEffect } from "react";

interface ObsidianStatus {
  enabled: boolean;
  configured: boolean;
  vault_path?: string;
  stats?: {
    wiki_articles: number;
    raw_sources: number;
    unprocessed: number;
    nodes: number;
    edges: number;
  };
  error?: string;
}

interface VaultItem {
  type: "folder" | "note" | "raw";
  name: string;
  path: string;
  count?: number;
}

export function KnowledgePanel() {
  const [status, setStatus] = useState<ObsidianStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"wiki" | "raw" | "graph">("wiki");
  const [items, setItems] = useState<VaultItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/obsidian/status");
      const data = await res.json();
      setStatus(data);
      setLoading(false);
      
      if (data.configured && !data.error) {
        fetchItems();
      }
    } catch (e) {
      setError("Failed to connect");
      setLoading(false);
    }
  };

  const fetchItems = async () => {
    // For now, we'll build a simple directory view
    // In production, this would fetch from /api/obsidian/list or similar
    const mockItems: VaultItem[] = [
      { type: "folder", name: "Concepts", path: "concepts", count: 0 },
      { type: "folder", name: "Daily", path: "daily", count: 0 },
      { type: "folder", name: "Sources", path: "sources", count: 0 },
    ];
    setItems(mockItems);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  if (!status?.enabled) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-sm text-muted-foreground mb-2">Obsidian not available</p>
      </div>
    );
  }

  if (!status?.configured) {
    return (
      <div className="h-full flex flex-col p-4">
        <div className="text-sm text-muted-foreground mb-4">
          No vault configured
        </div>
        <div className="text-xs text-muted-foreground">
          Run in terminal:
          <code className="block mt-2 p-2 bg-muted rounded">
            /obsidian vault ~/Documents/MyVault
          </code>
        </div>
      </div>
    );
  }

  if (status.error) {
    return (
      <div className="h-full flex flex-col p-4">
        <p className="text-sm text-red-500">{status.error}</p>
        <button 
          onClick={fetchStatus}
          className="mt-4 text-xs text-muted-foreground hover:text-foreground"
        >
          Retry
        </button>
      </div>
    );
  }

  const stats = status.stats;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Stats Bar - Karpathy style: minimal numbers */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border text-xs">
        <span className="text-muted-foreground">
          wiki: <span className="text-foreground">{stats?.wiki_articles || 0}</span>
        </span>
        <span className="text-muted-foreground">
          raw: <span className="text-foreground">{stats?.raw_sources || 0}</span>
        </span>
        {stats?.unprocessed ? (
          <span className="text-amber-500">
            unproc: {stats.unprocessed}
          </span>
        ) : null}
      </div>

      {/* View Switcher */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setView("wiki")}
          className={`px-3 py-1.5 text-xs ${
            view === "wiki" 
              ? "text-foreground border-b border-foreground" 
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          wiki/
        </button>
        <button
          onClick={() => setView("raw")}
          className={`px-3 py-1.5 text-xs ${
            view === "raw" 
              ? "text-foreground border-b border-foreground" 
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          raw/
        </button>
        <button
          onClick={() => setView("graph")}
          className={`px-3 py-1.5 text-xs ${
            view === "graph" 
              ? "text-foreground border-b border-foreground" 
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          graph
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {view === "wiki" && (
          <div className="space-y-1">
            {/* Index file link */}
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted cursor-pointer">
              <span className="text-muted-foreground">📄</span>
              <span>README.md</span>
              <span className="ml-auto text-muted-foreground">index</span>
            </div>
            
            {/* Folders */}
            {items.map((item) => (
              <div 
                key={item.path}
                className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted cursor-pointer"
              >
                <span className="text-muted-foreground">📁</span>
                <span>{item.name}/</span>
                {item.count ? (
                  <span className="ml-auto text-muted-foreground">{item.count}</span>
                ) : null}
              </div>
            ))}

            {/* Info */}
            <div className="mt-4 px-2 text-xs text-muted-foreground">
              <p>Vault: {status.vault_path?.split("/").pop()}</p>
              <p className="mt-1">Links: {stats?.edges || 0}</p>
            </div>
          </div>
        )}

        {view === "raw" && (
          <div className="space-y-1">
            {stats?.raw_sources === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">
                No raw sources. Use /ingest or /obsidian clip
              </p>
            ) : (
              <div className="px-2 text-xs text-muted-foreground">
                {stats?.unprocessed ? (
                  <button 
                    onClick={async () => {
                      await fetch("/api/obsidian/compile", { method: "POST" });
                      fetchStatus();
                    }}
                    className="text-amber-500 hover:underline"
                  >
                    Compile {stats.unprocessed} sources →
                  </button>
                ) : (
                  <span>All sources compiled</span>
                )}
              </div>
            )}
          </div>
        )}

        {view === "graph" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs text-muted-foreground">Nodes</span>
              <span className="text-xs">{stats?.nodes || 0}</span>
            </div>
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs text-muted-foreground">Edges</span>
              <span className="text-xs">{stats?.edges || 0}</span>
            </div>
            <div className="mt-4 px-2 text-xs text-muted-foreground">
              {stats && stats.edges > 0 && stats.nodes > 0 ? (
                <p>
                  Density: {((stats.edges / (stats.nodes * (stats.nodes - 1) / 2)) * 100).toFixed(1)}%
                </p>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Refresh */}
      <div className="border-t border-border p-2">
        <button
          onClick={fetchStatus}
          className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
