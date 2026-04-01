"use client"

import { cn } from "@/lib/utils"

interface FloatingNavProps {
  activeView: "terminal" | "graph"
  onViewChange: (view: "terminal" | "graph") => void
}

export function FloatingNav({ activeView, onViewChange }: FloatingNavProps) {
  return (
    <nav className="fixed top-5 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 px-1.5 py-1.5 rounded-full 
                      bg-white/5 backdrop-blur-md border border-white/10 silver-glow">
        <button
          onClick={() => onViewChange("terminal")}
          className={cn(
            "px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
            "font-mono tracking-tight",
            activeView === "terminal" 
              ? "bg-white/10 text-white shadow-[inset_0_-2px_0_rgba(255,255,255,0.3)]" 
              : "text-white/50 hover:text-white/80"
          )}
        >
          <span className="mr-1.5 opacity-70">{">_"}</span>
          TERMINAL
        </button>
        <button
          onClick={() => onViewChange("graph")}
          className={cn(
            "px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
            "font-sans tracking-tight",
            activeView === "graph" 
              ? "bg-white/10 text-white shadow-[inset_0_-2px_0_rgba(255,255,255,0.3)]" 
              : "text-white/50 hover:text-white/80"
          )}
        >
          <span className="mr-1.5 opacity-70">⚲</span>
          GRAPH
        </button>
      </div>
    </nav>
  )
}
