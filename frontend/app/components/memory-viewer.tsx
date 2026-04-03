"use client";

import { useState, useEffect, useCallback } from "react";

interface Memory {
  name: string;
  path: string;
  content: string;
  frontmatter: Record<string, string>;
  mtime: string;
}

// Simple markdown renderer without external deps
function renderMarkdown(text: string): string {
  let html = text
    // Escape HTML
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Headers
    .replace(/^### (.*$)/gim, '<h3 class="text-sm font-semibold mt-4 mb-2">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 class="text-sm font-bold mt-4 mb-2">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 class="text-base font-bold mt-4 mb-2">$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Code inline
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-muted rounded text-xs font-mono">$1</code>')
    // Code blocks
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="bg-muted p-2 rounded my-2 overflow-x-auto"><code class="text-xs font-mono">$2</code></pre>')
    // Blockquote
    .replace(/^> (.*$)/gim, '<blockquote class="border-l-2 border-muted-foreground pl-2 italic text-muted-foreground">$1</blockquote>')
    // Links - regular markdown
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-500 hover:underline">$1</a>')
    // Wikilinks [[Note]]
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (match, title, alias) => {
      const display = alias || title;
      return `<a href="#memory-${title.replace(/\s+/g, '-')}" class="wikilink px-1 py-0.5 bg-secondary rounded text-xs hover:bg-accent" data-title="${title}">[[${display}]]</a>`;
    })
    // Lists
    .replace(/^- (.*$)/gim, '<li class="ml-4">$1</li>')
    // Horizontal rule
    .replace(/^---$/gim, '<hr class="my-4 border-border" />')
    // Paragraphs (wrap remaining text)
    .split('\n\n').map(para => {
      if (para.startsWith('<') || para.trim() === '') return para;
      return `<p class="text-xs leading-relaxed mb-2">${para}</p>`;
    }).join('\n');

  return html;
}

function parseFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatter: Record<string, string> = {};
  let body = text;

  if (text.startsWith("---")) {
    const parts = text.split("---", 3);
    if (parts.length >= 3) {
      const fmText = parts[1].trim();
      body = parts[2].trim();
      
      for (const line of fmText.split('\n')) {
        if (line.includes(':')) {
          const [key, ...valParts] = line.split(':');
          frontmatter[key.trim()] = valParts.join(':').trim();
        }
      }
    }
  }

  return { frontmatter, body };
}

interface MemoryViewerProps {
  initialMemory?: string;
}

export function MemoryViewer({ initialMemory }: MemoryViewerProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [selected, setSelected] = useState<Memory | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "graph">("list");

  useEffect(() => {
    loadMemories();
  }, []);

  const loadMemories = async () => {
    try {
      // Try relative URL first (works with Next.js rewrite)
      let res = await fetch("/api/memory");
      
      // If that fails, try direct backend URL
      if (!res.ok) {
        res = await fetch("http://localhost:8000/api/memory");
      }
      
      if (!res.ok) {
        const text = await res.text();
        console.error("API error:", res.status, text);
        setError(`API error: ${res.status}`);
        setLoading(false);
        return;
      }
      
      const data = await res.json();
      
      if (data.memories) {
        const parsed = data.memories.map((m: any) => {
          const { frontmatter, body } = parseFrontmatter(m.content || "");
          return {
            name: m.name,
            path: m.scope,
            content: body,
            frontmatter,
            mtime: typeof m.created === 'number' 
              ? new Date(m.created * 1000).toLocaleDateString()
              : m.created || "unknown",
          };
        });
        setMemories(parsed);
        
        if (initialMemory) {
          const found = parsed.find((m: Memory) => m.name === initialMemory);
          if (found) setSelected(found);
        }
      } else if (data.error) {
        setError(data.error);
      }
      setLoading(false);
    } catch (e) {
      console.error("Fetch error:", e);
      setError(`Connection failed. Is backend running on port 8000?`);
      setLoading(false);
    }
  };

  const filtered = memories.filter(m => 
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.content.toLowerCase().includes(search.toLowerCase())
  );

  const handleWikilinkClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('.wikilink');
    if (link) {
      const title = link.getAttribute('data-title');
      if (title) {
        const found = memories.find(m => 
          m.name.toLowerCase() === title.toLowerCase() ||
          m.name.toLowerCase().replace(/_/g, ' ') === title.toLowerCase()
        );
        if (found) {
          setSelected(found);
        }
      }
    }
  }, [memories]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs text-muted-foreground">loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4">
        <p className="text-xs text-muted-foreground">{error}</p>
        <button onClick={loadMemories} className="mt-2 text-xs hover:underline">retry</button>
      </div>
    );
  }

  // Detail view
  if (selected) {
    const html = renderMarkdown(selected.content);
    
    return (
      <div className="h-full flex flex-col bg-background">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-border">
          <button 
            onClick={() => setSelected(null)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← back
          </button>
          <span className="text-xs font-medium truncate max-w-[200px]">{selected.name}</span>
          <span className="text-xs text-muted-foreground">{selected.path}</span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Frontmatter properties */}
          {Object.keys(selected.frontmatter).length > 0 && (
            <div className="px-6 py-2 border-b border-border bg-muted/30">
              {Object.entries(selected.frontmatter).map(([key, val]) => (
                <div key={key} className="flex gap-2 text-xs py-0.5">
                  <span className="text-muted-foreground">{key}:</span>
                  <span>{val}</span>
                </div>
              ))}
            </div>
          )}
          
          {/* Markdown content */}
          <div 
            className="p-6 prose prose-sm max-w-none"
            onClick={handleWikilinkClick}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    );
  }

  // List/Graph view
  return (
    <div className="h-full flex flex-col bg-background">
      {/* Controls */}
      <div className="flex items-center gap-2 px-6 py-2 border-b border-border">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search..."
          className="flex-1 px-2 py-1 text-xs bg-transparent border border-border rounded focus:outline-none focus:border-foreground"
        />
        <button
          onClick={() => setView(view === "list" ? "graph" : "list")}
          className={`px-2 py-1 text-xs border border-border rounded ${
            view === "graph" ? 'bg-secondary' : ''
          }`}
        >
          {view === "list" ? "graph" : "list"}
        </button>
        <ConnectButton onConnect={loadMemories} />
      </div>

      {/* Stats */}
      <div className="flex gap-4 px-6 py-1.5 border-b border-border text-xs">
        <span className="text-muted-foreground">
          total: <span className="text-foreground">{memories.length}</span>
        </span>
        <span className="text-muted-foreground">
          filtered: <span className="text-foreground">{filtered.length}</span>
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {view === "list" ? (
          <div className="divide-y divide-border">
            {filtered.map((m) => (
              <button
                key={m.name}
                onClick={() => setSelected(m)}
                className="w-full text-left px-6 py-2 hover:bg-muted transition-colors"
              >
                <div className="text-xs font-medium">{m.name}</div>
                {m.frontmatter.description && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {m.frontmatter.description}
                  </div>
                )}
                <div className="flex gap-2 mt-1">
                  {m.frontmatter.type && (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
                      {m.frontmatter.type}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {m.mtime}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <SimpleGraph memories={memories} onSelect={setSelected} />
        )}
      </div>
    </div>
  );
}

// Simple graph visualization
function SimpleGraph({ memories, onSelect }: { memories: Memory[]; onSelect: (m: Memory) => void }) {
  // Extract wikilinks from all memories
  const links: { source: string; target: string }[] = [];
  const nodeSet = new Set<string>();
  
  for (const m of memories) {
    nodeSet.add(m.name);
    const wikilinkMatches = m.content.match(/\[\[([^\]|]+)\|?[^\]]*\]\]/g) || [];
    for (const match of wikilinkMatches) {
      const title = match.replace(/\[\[|\]\]/g, '').split('|')[0];
      links.push({ source: m.name, target: title });
      nodeSet.add(title);
    }
  }

  const nodes = Array.from(nodeSet).map((name, i) => {
    const memory = memories.find(m => m.name === name);
    const angle = (i / nodeSet.size) * 2 * Math.PI;
    const radius = 100;
    return {
      name,
      x: 150 + radius * Math.cos(angle),
      y: 150 + radius * Math.sin(angle),
      hasContent: !!memory,
    };
  });

  return (
    <div className="h-full flex items-center justify-center bg-muted/20">
      <svg width="300" height="300" className="max-w-full">
        {/* Links */}
        {links.map((link, i) => {
          const source = nodes.find(n => n.name === link.source);
          const target = nodes.find(n => n.name === link.target);
          if (!source || !target) return null;
          return (
            <line
              key={i}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke="currentColor"
              strokeWidth="1"
              className="text-muted-foreground/30"
            />
          );
        })}
        
        {/* Nodes */}
        {nodes.map((node) => (
          <g key={node.name}>
            <circle
              cx={node.x}
              cy={node.y}
              r={node.hasContent ? 6 : 4}
              className={node.hasContent ? 'fill-foreground' : 'fill-muted-foreground/50'}
              onClick={() => {
                const memory = memories.find(m => m.name === node.name);
                if (memory) onSelect(memory);
              }}
              style={{ cursor: node.hasContent ? 'pointer' : 'default' }}
            />
            <text
              x={node.x}
              y={node.y + 12}
              textAnchor="middle"
              className="text-[8px] fill-muted-foreground"
            >
              {node.name.slice(0, 15)}{node.name.length > 15 ? '...' : ''}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// Connect button component
function ConnectButton({ onConnect }: { onConnect: () => void }) {
  const [connecting, setConnecting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    setResult(null);
    
    try {
      let res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "random" }),
      });
      
      if (!res.ok) {
        res = await fetch("http://localhost:8000/api/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "random" }),
        });
      }
      
      const data = await res.json();
      if (data.success) {
        setResult("Connection discovered and saved!");
        onConnect(); // Refresh memories
      } else {
        setResult(data.message || "Connection failed");
      }
    } catch (e) {
      setResult("Connection failed");
    } finally {
      setConnecting(false);
      // Clear result after 3 seconds
      setTimeout(() => setResult(null), 3000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleConnect}
        disabled={connecting}
        className="px-2 py-1 text-xs border border-border rounded hover:bg-secondary disabled:opacity-50"
        title="Find AI-discovered connections"
      >
        {connecting ? "..." : "connect"}
      </button>
      {result && (
        <span className="text-[10px] text-muted-foreground">{result}</span>
      )}
    </div>
  );
}
