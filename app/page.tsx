"use client"

import { useState } from "react"
import { FloatingNav } from "@/components/floating-nav"
import { Terminal } from "@/components/terminal"
import { KnowledgeGraph } from "@/components/knowledge-graph"

export default function MemoriaEngine() {
  const [activeView, setActiveView] = useState<"terminal" | "graph">("terminal")

  return (
    <main className="min-h-screen bg-[#0A0A0A] relative overflow-hidden">
      {/* Radial gradient background */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, #121212 0%, #0A0A0A 70%)"
        }}
      />

      {/* Floating Navigation */}
      <FloatingNav activeView={activeView} onViewChange={setActiveView} />

      {/* Content Views */}
      <div className="relative pt-20">
        {/* Terminal View */}
        <div 
          className={`absolute inset-0 pt-20 px-4 transition-opacity duration-300 ${
            activeView === "terminal" ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <Terminal />
        </div>

        {/* Graph View */}
        <div 
          className={`fixed inset-0 transition-opacity duration-300 ${
            activeView === "graph" ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <KnowledgeGraph />
        </div>
      </div>
    </main>
  )
}
