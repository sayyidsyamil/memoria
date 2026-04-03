"use client";

import { useState, useCallback, useRef } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { TerminalFeed, type FeedEntry } from "./components/terminal-feed";
import { MemoryViewer } from "./components/memory-viewer";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

const FEED_BOOTSTRAP: Omit<FeedEntry, "id"> = {
  type: "system",
  content: "Memoria · Brain. Type a message to chat, or / for commands.",
};

export default function MemoriaApp() {
  const [view, setView] = useState<"terminal" | "memory">("terminal");
  const [panelOpen, setPanelOpen] = useState(true);
  
  // Lifted state: terminal feed persists across tab switches
  const [feed, setFeed] = useState<FeedEntry[]>([{ ...FEED_BOOTSTRAP, id: "0" }]);
  const feedRef = useRef({ feed, setFeed });
  
  // Keep ref in sync for callbacks
  feedRef.current = { feed, setFeed };

  const addEntry = useCallback((entry: Omit<FeedEntry, "id">) => {
    setFeed((prev) => [...prev, { ...entry, id: `${Date.now()}-${prev.length}` }]);
  }, []);

  return (
    <main className="h-screen bg-background relative">
      <Toaster position="bottom-right" />

      {/* Center Floating Navbar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
        <div className="flex items-center gap-1 px-1.5 py-1.5 bg-card/90 backdrop-blur-sm border border-border rounded-full shadow-lg">
          <button
            onClick={() => setView("terminal")}
            className={`px-4 py-1.5 text-xs font-medium rounded-full transition-all ${
              view === "terminal"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            terminal
          </button>
          <button
            onClick={() => setView("memory")}
            className={`px-4 py-1.5 text-xs font-medium rounded-full transition-all ${
              view === "memory"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            memory
          </button>
        </div>
      </div>

      {/* Main Content - Both components mounted, visibility toggled */}
      <div className="h-full pt-16 relative">
        <div className={`h-full ${view === "terminal" ? "block" : "hidden"}`}>
          <TerminalFeed 
            onTogglePanel={() => {}}
            isPanelOpen={false}
            feed={feed}
            onAddEntry={addEntry}
          />
        </div>
        <div className={`h-full ${view === "memory" ? "block" : "hidden"}`}>
          <MemoryViewer />
        </div>
      </div>
    </main>
  );
}
