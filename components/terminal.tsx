"use client"

import { useState, useRef, useEffect } from "react"

interface LogEntry {
  id: number
  type: "system" | "success" | "entity" | "error" | "command" | "link"
  prefix?: string
  content: string
  highlight?: string
}

const DEMO_SCENARIOS: Record<string, LogEntry[]> = {
  "/ingest https://youtube.com/damodaran_lecture_3": [
    { id: 1, type: "system", prefix: "System", content: "Downloading audio from YouTube..." },
    { id: 2, type: "system", prefix: "Whisper ASR", content: "Transcribing via Groq Whisper (Model: large-v3-turbo)..." },
    { id: 3, type: "success", prefix: "Whisper ASR", content: "Audio transcribed in 8.4s. Word Error Rate < 5%." },
    { id: 4, type: "system", prefix: "System", content: "Saving transcript to SQLite relational memory..." },
    { id: 5, type: "success", prefix: "System", content: "Successfully stored 12,847 tokens in memoria.db" },
  ],
  "/extract": [
    { id: 1, type: "system", prefix: "Memoria Engine", content: "Initializing ontology extraction pipeline..." },
    { id: 2, type: "system", prefix: "LLM", content: "Processing transcript chunks (4/4)..." },
    { id: 3, type: "success", prefix: "Ontology Extractor", content: "Successfully extracted 15 entities." },
    { id: 4, type: "entity", prefix: "LLM", content: "Extracted Concept: ", highlight: "WACC" },
    { id: 5, type: "entity", prefix: "LLM", content: "Extracted Concept: ", highlight: "Cost of Equity" },
    { id: 6, type: "entity", prefix: "LLM", content: "Extracted Concept: ", highlight: "Risk-Free Rate" },
    { id: 7, type: "entity", prefix: "LLM", content: "Extracted Concept: ", highlight: "Beta" },
    { id: 8, type: "entity", prefix: "LLM", content: "Extracted Concept: ", highlight: "Market Risk Premium" },
    { id: 9, type: "link", prefix: "LLM", content: "Linked [Cost of Equity] → depends_on → [Risk-Free Rate]" },
    { id: 10, type: "link", prefix: "LLM", content: "Linked [Cost of Equity] → depends_on → [Beta]" },
    { id: 11, type: "link", prefix: "LLM", content: "Linked [WACC] → composed_of → [Cost of Equity]" },
    { id: 12, type: "success", prefix: "System", content: "Committing 15 relationships to Knowledge Graph Database." },
  ],
  "/help": [
    { id: 1, type: "system", prefix: "Memoria", content: "Available commands:" },
    { id: 2, type: "entity", content: "  /ingest <url>  ", highlight: "- Ingest audio from YouTube URL" },
    { id: 3, type: "entity", content: "  /extract       ", highlight: "- Extract ontology from transcript" },
    { id: 4, type: "entity", content: "  <any question>  ", highlight: "- Ask anything about your knowledge graph" },
    { id: 5, type: "entity", content: "  /clear         ", highlight: "- Clear terminal output" },
    { id: 6, type: "entity", content: "  /help          ", highlight: "- Show this help message" },
  ],
  "query": [
    { id: 1, type: "system", prefix: "Query Engine", content: "Searching knowledge graph..." },
    { id: 2, type: "success", prefix: "RAG", content: "Found 3 relevant context chunks." },
    { id: 3, type: "entity", prefix: "LLM", content: "", highlight: "WACC (Weighted Average Cost of Capital)" },
    { id: 4, type: "system", prefix: "LLM", content: "The weighted average of a firm's cost of equity and cost of debt," },
    { id: 5, type: "system", prefix: "LLM", content: "proportionally weighted by their respective market values." },
    { id: 6, type: "link", prefix: "Graph", content: "Related: [Cost of Equity], [Cost of Debt], [Capital Structure]" },
  ],
}

export function Terminal() {
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 0, type: "system", prefix: "Memoria Engine", content: "Initialized. Ready to process." },
  ])
  const [input, setInput] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const processCommand = async (command: string) => {
    if (command === "/clear") {
      setLogs([{ id: 0, type: "system", prefix: "Memoria Engine", content: "Terminal cleared." }])
      return
    }

    // Add the command to logs
    setLogs(prev => [...prev, { id: Date.now(), type: "command", content: command }])
    setIsProcessing(true)

    // Find matching scenario or use default
    let scenario = DEMO_SCENARIOS[command]
    if (!scenario) {
      // Check for partial matches
      if (command.startsWith("/ingest")) {
        scenario = DEMO_SCENARIOS["/ingest https://youtube.com/damodaran_lecture_3"]
      } else {
        // Treat anything else as a natural language query
        scenario = DEMO_SCENARIOS["query"]
      }
    }

    // Stream logs with delay
    for (let i = 0; i < scenario.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 400 + Math.random() * 300))
      setLogs(prev => [...prev, { ...scenario[i], id: Date.now() + i }])
    }

    setIsProcessing(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isProcessing) return
    
    const command = input.trim()
    setInput("")
    processCommand(command)
  }

  const getLogColor = (type: LogEntry["type"]) => {
    switch (type) {
      case "system": return "text-[#888888]"
      case "success": return "text-emerald-400 glow-emerald"
      case "entity": return "text-white"
      case "error": return "text-rose-400"
      case "command": return "text-white"
      case "link": return "text-emerald-400 glow-emerald"
      default: return "text-white"
    }
  }

  return (
    <div className="w-full max-w-[900px] mx-auto h-[calc(100vh-120px)] flex flex-col">
      {/* Terminal Output */}
      <div className="flex-1 overflow-y-auto terminal-scrollbar p-6 space-y-2">
        {logs.map((log) => (
          <div key={log.id} className={`font-mono text-sm leading-relaxed ${getLogColor(log.type)}`}>
            {log.type === "command" ? (
              <span className="text-white">
                <span className="text-emerald-400">❯</span> {log.content}
              </span>
            ) : (
              <>
                {log.prefix && (
                  <span className="text-[#888888]">[{log.prefix}] </span>
                )}
                <span>{log.content}</span>
                {log.highlight && (
                  <span className="text-cyan-400 font-bold glow-cyan">{log.highlight}</span>
                )}
              </>
            )}
          </div>
        ))}
        {isProcessing && (
          <div className="font-mono text-sm text-[#888888]">
            <span className="loading-spinner"></span>
            <span className="ml-2">Processing...</span>
          </div>
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Input Bar */}
      <form onSubmit={handleSubmit} className="p-4">
        <div className="relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-400 font-mono text-lg glow-emerald">
            ❯
          </div>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isProcessing}
            placeholder="Ask anything or type /help for commands..."
            className="w-full bg-white/5 border border-white/10 rounded-lg py-4 pl-10 pr-4 
                       font-mono text-white placeholder:text-white/30
                       focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10
                       silver-glow transition-all duration-200
                       disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
      </form>
    </div>
  )
}
