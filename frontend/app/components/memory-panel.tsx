"use client";

import { useState, useEffect } from "react";

interface Memory {
  name: string;
  description: string;
  type: string;
  scope: string;
  content: string;
  created: string;
}

export function MemoryPanel() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Memory | null>(null);

  useEffect(() => {
    fetchMemories();
  }, []);

  const fetchMemories = async () => {
    try {
      // Try to get memories from API
      const res = await fetch("/api/memory");
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      } else {
        // Fallback: no API yet
        setMemories([]);
      }
      setLoading(false);
    } catch (e) {
      setError("No memory API connected");
      setLoading(false);
    }
  };

  const filtered = memories.filter(m => 
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.description.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <span className="text-xs">Loading...</span>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="h-full flex flex-col bg-background">
        {/* Back button */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <button 
            onClick={() => setSelected(null)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← back
          </button>
        </div>
        
        {/* Memory detail */}
        <div className="flex-1 overflow-y-auto p-3">
          <h3 className="text-sm font-medium mb-1">{selected.name}</h3>
          <p className="text-xs text-muted-foreground mb-3">{selected.description}</p>
          <div className="flex gap-2 text-xs text-muted-foreground mb-3">
            <span>[{selected.type}]</span>
            <span>[{selected.scope}]</span>
            <span>{selected.created}</span>
          </div>
          <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">
            {selected.content}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Stats */}
      <div className="flex items-center gap-4 px-3 py-2 border-b border-border text-xs">
        <span className="text-muted-foreground">
          total: <span className="text-foreground">{memories.length}</span>
        </span>
        <span className="text-muted-foreground">
          user: <span className="text-foreground">{memories.filter(m => m.scope === "user").length}</span>
        </span>
        <span className="text-muted-foreground">
          project: <span className="text-foreground">{memories.filter(m => m.scope === "project").length}</span>
        </span>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memories..."
          className="w-full px-2 py-1 text-xs bg-transparent border border-border rounded focus:outline-none focus:border-foreground"
        />
      </div>

      {/* Memory list */}
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="p-4 text-xs text-muted-foreground">
            <p>{error}</p>
            <button 
              onClick={fetchMemories}
              className="mt-2 text-foreground hover:underline"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">
            {memories.length === 0 ? (
              <>
                <p className="mb-2">No memories stored yet.</p>
                <p>Memories are saved when AI uses MemorySave tool.</p>
              </>
            ) : (
              <p>No matches for "{search}"</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((m) => (
              <button
                key={`${m.scope}-${m.name}`}
                onClick={() => setSelected(m)}
                className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium">{m.name}</span>
                  <span className="text-xs text-muted-foreground">[{m.type}]</span>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {m.description}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
