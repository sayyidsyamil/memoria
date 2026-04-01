"use client"

import { useState, useRef, useEffect } from "react"

interface LogEntry {
  id: number
  type: "system" | "success" | "entity" | "error" | "command" | "link"
  prefix?: string
  content: string
  highlight?: string
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

  const callBackendAPI = async (message: string) => {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: message }]
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) return

    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6)
          if (data === "[DONE]") continue

          try {
            const parsed = JSON.parse(data)
            if (parsed.type === "text-delta" && parsed.delta) {
              setLogs(prev => {
                const lastLog = prev[prev.length - 1]
                if (lastLog && lastLog.type === "system" && lastLog.prefix === "AI") {
                  return [...prev.slice(0, -1), { ...lastLog, content: lastLog.content + parsed.delta }]
                }
                return [...prev, { id: Date.now(), type: "system", prefix: "AI", content: parsed.delta }]
              })
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }

  const processCommand = async (command: string) => {
    if (command === "/clear") {
      setLogs([{ id: 0, type: "system", prefix: "Memoria Engine", content: "Terminal cleared." }])
      return
    }

    if (command === "/help") {
      setLogs(prev => [...prev,
        { id: Date.now(), type: "system", prefix: "Memoria", content: "Available commands:" },
        { id: Date.now() + 1, type: "entity", content: "  /ingest <url>  ", highlight: "- Ingest audio from YouTube URL" },
        { id: Date.now() + 2, type: "entity", content: "  <any question>  ", highlight: "- Ask anything about your knowledge graph" },
        { id: Date.now() + 3, type: "entity", content: "  /clear         ", highlight: "- Clear terminal output" },
        { id: Date.now() + 4, type: "entity", content: "  /help          ", highlight: "- Show this help message" },
      ])
      return
    }

    if (command.startsWith("/ingest")) {
      const url = command.replace("/ingest", "").trim()
      if (!url) {
        setLogs(prev => [...prev,
          { id: Date.now(), type: "command", content: command },
          { id: Date.now() + 1, type: "error", prefix: "System", content: "Usage: /ingest <youtube_url>" },
        ])
        return
      }

      setLogs(prev => [...prev, { id: Date.now(), type: "command", content: command }])
      setIsProcessing(true)

      try {
        setLogs(prev => [...prev, { id: Date.now(), type: "system", prefix: "System", content: "Downloading audio from YouTube..." }])
        
        const response = await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const data = await response.json()

        if (data.success) {
          setLogs(prev => [...prev,
            { id: Date.now(), type: "system", prefix: "Whisper ASR", content: `Transcribing via Fireworks Whisper V3 Turbo...` },
            { id: Date.now() + 1, type: "success", prefix: "System", content: data.message },
            { id: Date.now() + 2, type: "link", prefix: "Graph", content: `Source #${data.source_id} ready for review in Graph view` },
          ])
          
          // Show transcript preview (first 500 chars)
          if (data.transcript) {
            const preview = data.transcript.slice(0, 500) + (data.transcript.length > 500 ? "..." : "")
            setLogs(prev => [...prev,
              { id: Date.now() + 2, type: "entity", prefix: "Transcript", content: "Preview: ", highlight: preview },
            ])
          }
        } else {
          setLogs(prev => [...prev, { id: Date.now(), type: "error", prefix: "System", content: data.message }])
        }
      } catch (error) {
        setLogs(prev => [...prev, { id: Date.now(), type: "error", prefix: "System", content: `Ingestion failed: ${error}` }])
      }

      setIsProcessing(false)
      return
    }

    // For any other input, treat as a natural language query to the AI
    setLogs(prev => [...prev, { id: Date.now(), type: "command", content: command }])
    setIsProcessing(true)

    try {
      await callBackendAPI(command)
    } catch (error) {
      setLogs(prev => [...prev, { id: Date.now(), type: "error", prefix: "System", content: "Failed to get response from AI." }])
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
