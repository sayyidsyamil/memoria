"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Command } from "cmdk";

const STORAGE_KEY = "memoria-session-id";

// Types extracted to simplify parsing - must match parent definition
export interface FeedEntry {
  id: string;
  type: "user" | "system" | "success" | "error";
  content: string;
}

interface TerminalFeedProps {
  onTogglePanel?: () => void;
  isPanelOpen?: boolean;
  // Lifted state from parent
  feed: FeedEntry[];
  onAddEntry: (entry: Omit<FeedEntry, "id">) => void;
}

interface CommandsPayload {
  commands: string[];
  prefix: string;
}

interface EventPayload {
  type: string;
  session_id?: string;
  text?: string;
  name?: string;
  inputs?: Record<string, unknown>;
  result?: string;
  message?: string;
  input_tokens?: number;
  output_tokens?: number;
}

function getOrCreateSessionId(): string {
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

const FEED_BOOTSTRAP: Omit<FeedEntry, "id"> = {
  type: "system",
  content: "Memoria · Brain. Type a message to chat, or / for commands.",
};

// Extracted Command Palette component to reduce main component complexity
function CommandPalette({
  input,
  commands,
  prefix,
  onSelect,
}: {
  input: string;
  commands: string[];
  prefix: string;
  onSelect: (name: string) => void;
}) {
  const needle = input.startsWith(prefix)
    ? input.slice(prefix.length).toLowerCase()
    : "";
  const names = commands.length ? commands : ["help", "clear"];
  const visible = names.filter(
    (n) => !needle || n.toLowerCase().startsWith(needle)
  );

  if (visible.length === 0) return null;

  return (
    <div className="absolute right-4 bottom-full left-4 mb-2">
      <Command className="rounded-lg border border-border bg-card shadow-lg" shouldFilter={false}>
        <Command.List className="p-2">
          {visible.map((name) => {
            const label = `${prefix}${name}`;
            return (
              <Command.Item
                key={name}
                value={label}
                onSelect={() => onSelect(name)}
                className="cursor-pointer rounded px-3 py-2 font-mono text-sm hover:bg-secondary"
              >
                {label}
              </Command.Item>
            );
          })}
        </Command.List>
      </Command>
    </div>
  );
}

export function TerminalFeed({ 
  onTogglePanel, 
  isPanelOpen, 
  feed, 
  onAddEntry 
}: TerminalFeedProps) {
  // Remove local feed state - now managed by parent
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [streamPreview, setStreamPreview] = useState("");
  const [slashMeta, setSlashMeta] = useState<CommandsPayload>({
    commands: [],
    prefix: "/",
  });
  const feedEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Simplified scroll effect with less reactivity
  useEffect(() => {
    const timer = setTimeout(() => {
      feedEndRef.current?.scrollIntoView({ behavior: "auto" });
    }, 50);
    return () => clearTimeout(timer);
  }, [feed.length, streamPreview]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const p = slashMeta.prefix || "/";
    const rest = input.startsWith(p) ? input.slice(p.length) : "";
    setShowPalette(input.startsWith(p) && !rest.includes(" "));
  }, [input, slashMeta.prefix]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/brain/commands");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as CommandsPayload;
        if (cancelled || !Array.isArray(data.commands)) return;
        setSlashMeta({
          commands: data.commands,
          prefix: typeof data.prefix === "string" ? data.prefix : "/",
        });
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Removed local addEntry - now using onAddEntry prop from parent
  // const addEntry = useCallback((entry: Omit<FeedEntry, "id">) => {
  //   setFeed((prev) => [...prev, { ...entry, id: `${Date.now()}-${prev.length}` }]);
  // }, []);

  const sendToBrain = useCallback(
    async (message: string) => {
      onAddEntry({ type: "user", content: `> ${message}` });
      setIsProcessing(true);
      setStreamPreview("");
      let pendingText = "";
      let assistantAccum = "";

      const sid = getOrCreateSessionId();

      const flushPending = () => {
        if (pendingText) {
          assistantAccum += pendingText;
          onAddEntry({ type: "success", content: pendingText });
          pendingText = "";
          setStreamPreview("");
        }
      };

      const resetFeedFromServer = () => {
        pendingText = "";
        setStreamPreview("");
        assistantAccum = "";
      };

      try {
        const res = await fetch("/api/brain/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, session_id: sid }),
        });

        if (!res.ok) {
          onAddEntry({ type: "error", content: `HTTP ${res.status}` });
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          onAddEntry({ type: "error", content: "No response body" });
          return;
        }

        const dec = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";

          for (const block of parts) {
            for (const line of block.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              let payload: EventPayload;
              try {
                payload = JSON.parse(line.slice(6)) as EventPayload;
              } catch {
                continue;
              }

              if (payload.type === "session" && payload.session_id) {
                localStorage.setItem(STORAGE_KEY, payload.session_id);
              } else if (payload.type === "clear_feed") {
                // Reset handled by parent - just reset local accumulator
                resetFeedFromServer();
              } else if (payload.type === "text" && payload.text) {
                pendingText += payload.text.replace(/\r/g, "");
                setStreamPreview(pendingText);
              } else if (payload.type === "thinking" && payload.text) {
                flushPending();
                onAddEntry({
                  type: "system",
                  content: `[thinking] ${payload.text.slice(0, 500)}`,
                });
              } else if (payload.type === "tool_start") {
                flushPending();
                const ins = payload.inputs
                  ? JSON.stringify(payload.inputs).slice(0, 240)
                  : "";
                onAddEntry({
                  type: "system",
                  content: `⚙ ${payload.name ?? "?"} ${ins}`,
                });
              } else if (payload.type === "tool_end" && payload.result) {
                const r = payload.result.replace(/\r/g, "");
                const preview = r.length > 500 ? `${r.slice(0, 500)}…` : r;
                onAddEntry({ type: "system", content: `✓ ${preview}` });
              } else if (payload.type === "turn_done") {
                flushPending();
                onAddEntry({
                  type: "system",
                  content: `[tokens in ${payload.input_tokens ?? 0} / out ${payload.output_tokens ?? 0}]`,
                });
              } else if (payload.type === "error" && payload.message) {
                flushPending();
                onAddEntry({ type: "error", content: payload.message });
              } else if (payload.type === "done") {
                flushPending();
              }
            }
          }
        }

        flushPending();
      } catch (e) {
        onAddEntry({ type: "error", content: String(e) });
      } finally {
        setIsProcessing(false);
        setStreamPreview("");
      }
    },
    [onAddEntry]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = input.trim();
    if (!t || isProcessing) return;
    void sendToBrain(t);
    setInput("");
    setShowPalette(false);
  };

  const handleSelect = (name: string) => {
    const p = slashMeta.prefix || "/";
    setInput(`${p}${name} `);
    setShowPalette(false);
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-border px-4 py-2">
        <span className="font-mono text-xs text-muted-foreground">Memoria Brain</span>
      </div>

      <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto p-6">
        {feed.map((entry) => (
          <div key={entry.id} className="font-mono text-sm">
            {entry.type === "user" && (
              <div className="text-foreground">{entry.content}</div>
            )}
            {entry.type === "system" && (
              <div className="text-muted-foreground">{entry.content}</div>
            )}
            {entry.type === "success" && (
              <div className="whitespace-pre-wrap text-accent">{entry.content}</div>
            )}
            {entry.type === "error" && (
              <div className="text-destructive">{entry.content}</div>
            )}
          </div>
        ))}
        {streamPreview && (
          <div className="font-mono text-sm whitespace-pre-wrap text-accent">
            {streamPreview}
          </div>
        )}
        {isProcessing && !streamPreview && (
          <div className="font-mono text-sm text-muted-foreground">
            <span className="loading-spinner" />
          </div>
        )}
        <div ref={feedEndRef} />
      </div>

      <div className="relative border-t border-border p-4">
        {showPalette && (
          <CommandPalette
            input={input}
            commands={slashMeta.commands}
            prefix={slashMeta.prefix}
            onSelect={handleSelect}
          />
        )}

        <form onSubmit={handleSubmit}>
          <div className="relative">
            <span className="absolute top-1/2 left-4 -translate-y-1/2 font-mono text-accent">
              {">"}
            </span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isProcessing}
              placeholder="Message Brain, or / for commands…"
              className="w-full rounded-lg border border-border bg-card py-3 pr-4 pl-8 font-mono text-sm transition-all focus:ring-1 focus:ring-accent focus:outline-none disabled:opacity-50"
            />
          </div>
        </form>
      </div>
    </div>
  );
}
