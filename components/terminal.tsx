"use client"

import { useState, useRef, useEffect, useCallback } from "react"

interface LogEntry {
  id: number
  type: "system" | "success" | "entity" | "error" | "command" | "link" | "memory" | "skill"
  prefix?: string
  content: string
  highlight?: string
}

let logIdCounter = 1

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

  const getLogId = useCallback(() => {
    logIdCounter += 1
    return Date.now() + logIdCounter
  }, [])

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
                return [...prev, { id: getLogId(), type: "system", prefix: "AI", content: parsed.delta }]
              })
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }

  // Memory commands
  const handleMemoryCommand = async (args: string[]) => {
    const subcommand = args[0]
    
    if (!subcommand || subcommand === "read") {
      // Show all memory
      setLogs(prev => [...prev, { id: getLogId(), type: "system", prefix: "Memory", content: "Reading memory stores..." }])
      
      try {
        const response = await fetch("/api/memory")
        const data = await response.json()
        
        if (data.memory?.entries?.length > 0) {
          setLogs(prev => [...prev, { id: getLogId(), type: "memory", prefix: "Memory", content: `Entries (${data.memory.entry_count}):` }])
          data.memory.entries.forEach((entry: string, i: number) => {
            setLogs(prev => [...prev, { id: getLogId(), type: "memory", prefix: `${i + 1}`, content: entry }])
          })
        } else {
          setLogs(prev => [...prev, { id: getLogId(), type: "memory", prefix: "Memory", content: "No entries yet." }])
        }
        
        if (data.user?.entries?.length > 0) {
          setLogs(prev => [...prev, { id: getLogId(), type: "memory", prefix: "User", content: `Profile (${data.user.entry_count} entries):` }])
          data.user.entries.forEach((entry: string, i: number) => {
            setLogs(prev => [...prev, { id: getLogId(), type: "memory", prefix: `${i + 1}`, content: entry }])
          })
        }
      } catch (error) {
        setLogs(prev => [...prev, { id: getLogId(), type: "error", prefix: "Memory", content: `Failed to read memory: ${error}` }])
      }
      return
    }
    
    if (subcommand === "add") {
      const target = args[1] || "memory"
      const content = args.slice(2).join(" ")
      
      if (!content) {
        setLogs(prev => [...prev, { id: getLogId(), type: "error", prefix: "Memory", content: "Usage: /memory add <memory|user> <content>" }])
        return
      }
      
      setLogs(prev => [...prev, { id: getLogId(), type: "system", prefix: "Memory", content: `Saving to ${target}...` }])
      
      try {
        const response = await fetch("/api/tools/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool_name: "memory",
            arguments: { action: "add", target, content }
          }),
        })
        
        const data = await response.json()
        if (data.success) {
          setLogs(prev => [...prev, { id: getLogId(), type: "success", prefix: "Memory", content: `${data.message} (${data.usage})` }])
        } else {
          setLogs(prev => [...prev, { id: getLogId(), type: "error", prefix: "Memory", content: data.error }])
        }
      } catch (error) {
        setLogs(prev => [...prev, { id: getLogId(), type: "error", prefix: "Memory", content: `Failed to save: ${error}` }])
      }
      return
    }
    
    setLogs(prev => [...prev, { id: getLogId(), type: "error", prefix: "Memory", content: "Usage: /memory [read|add <target> <content> | replace <target> <old> <new> | remove <target> <old>]" }])
  }

  // Skill commands
  const handleSkillCommand = async (args: string[]) => {
    const subcommand = args[0]
    
    if (!subcommand || subcommand === "list") {
      setLogs(prev => [...prev, { id: getLogId(), type: "system", prefix: "Skills", content: "Listing saved skills..." }])
      
      try {
        const response = await fetch("/api/skills")
        const data = await response.json()
        
        if (data.skills?.length > 0) {
          setLogs(prev => [...prev, { id: getLogId(), type: "skill", prefix: "Skills", content: `Found ${data.count} skill(s):` }])
          data.skills.forEach((skill: any) => {
            setLogs(prev => [...prev, { id: getLogId(), type: "skill", prefix: skill.name, content: skill.description || "(no description)" }])
          })
        } else {
          setLogs(prev => [...prev, { id: getLogId(), type: "skill", prefix: "Skills", content: "No skills saved yet. Create one with /skill create <name>" }])
        }
      } catch (error) {
        setLogs(prev => [...prev, { id: getLogId(), type: "error", prefix: "Skills", content: `Failed to list skills: ${error}` }])
      }
      return
    }
    
    if (subcommand === "view" && args[1]) {
      const skillName = args[1]
      setLogs(prev => [...prev, { id: getLogId(), type: "system", prefix: "Skills", content: `Loading skill: ${skillName}...` }])
      
      try {
        const response = await fetch(`/api/skills/${skillName}`)
        const data = await response.json()
        
        if (data.success && data.skill) {
          setLogs(prev => [...prev, 
            { id: getLogId(), type: "skill", prefix: "Name", content: data.skill.name },
            { id: getLogId(), type: "skill", prefix: "Path", content: data.skill.path },
            { id: getLogId(), type: "skill", prefix: "Content", content: data.skill.content.slice(0, 500) + "..." },
          ])
          if (data.skill.files?.length > 0) {
            setLogs(prev => [...prev, { id: getLogId(), type: "skill", prefix: "Files", content: data.skill.files.join(", ") }])
          }
        } else {
          setLogs(prev => [...prev, { id: getLogId(), type: "error", prefix: "Skills", content: data.error || "Skill not found" }])
        }
      } catch (error) {
        setLogs(prev => [...prev, { id: getLogId(), type: "error", prefix: "Skills", content: `Failed to view skill: ${error}` }])
      }
      return
    }
    
    setLogs(prev => [...prev, { id: getLogId(), type: "error", prefix: "Skills", content: "Usage: /skill [list|view <name> | create <name> | edit <name> | delete <name>]" }])
  }

  // Session search
  const handleSessionCommand = async (args: string[]) => {
    const query = args.join(" ")
    
    setLogs(prev => [...prev, { id: getLogId(), type: "system", prefix: "Sessions", content: query ? `Searching for: ${query}...` : "Listing recent sessions..." }])
    
    try {
      let url = "/api/sessions/search"
      if (query) {
        url += `?query=${encodeURIComponent(query)}`
      }
      
      const response = await fetch(url, { method: "POST" })
      const data = await response.json()
      
      if (data.mode === "recent") {
        setLogs(prev => [...prev, { id: getLogId(), type: "system", prefix: "Recent", content: `${data.count} session(s):` }])
        data.results.forEach((session: any) => {
          setLogs(prev => [...prev, { id: getLogId(), type: "entity", prefix: session.title || session.id, content: `${session.message_count} messages | ${session.preview?.slice(0, 50)}...` }])
        })
      } else if (data.success && data.results?.length > 0) {
        setLogs(prev => [...prev, { id: getLogId(), type: "system", prefix: "Search", content: `Found ${data.count} matching session(s):` }])
        data.results.forEach((result: any, i: number) => {
          setLogs(prev => [...prev, { id: getLogId(), type: "entity", prefix: result.title || `Session ${i + 1}`, content: result.when || "Unknown date" }])
          if (result.summary) {
            setLogs(prev => [...prev, { id: getLogId(), type: "entity", prefix: "Summary", content: result.summary.slice(0, 200) + "..." }])
          }
        })
      } else {
        setLogs(prev => [...prev, { id: getLogId(), type: "system", prefix: "Sessions", content: "No sessions found." }])
      }
    } catch (error) {
      setLogs(prev => [...prev, { id: getLogId(), type: "error", prefix: "Sessions", content: `Failed to search: ${error}` }])
    }
  }

  const processCommand = async (command: string) => {
    // Clear command
    if (command === "/clear") {
      setLogs([{ id: 0, type: "system", prefix: "Memoria Engine", content: "Terminal cleared." }])
      return
    }

    // Help command
    if (command === "/help") {
      const helpLogs = [
        { id: getLogId(), type: "system" as const, prefix: "Memoria", content: "Available commands:" },
        { id: getLogId(), type: "entity" as const, content: "  <any question>  ", highlight: "- Ask anything (AI will use knowledge graph)" },
        { id: getLogId(), type: "entity" as const, content: "  /ingest <url>  ", highlight: "- Ingest audio from YouTube URL" },
        { id: getLogId(), type: "entity" as const, content: "  /memory         ", highlight: "- Show saved memories" },
        { id: getLogId(), type: "entity" as const, content: "  /memory add <t> <c> ", highlight: "- Add memory (target: memory/user)" },
        { id: getLogId(), type: "entity" as const, content: "  /skills         ", highlight: "- List saved skills" },
        { id: getLogId(), type: "entity" as const, content: "  /skill view <n> ", highlight: "- View a skill by name" },
        { id: getLogId(), type: "entity" as const, content: "  /sessions       ", highlight: "- List recent sessions" },
        { id: getLogId(), type: "entity" as const, content: "  /session <query> ", highlight: "- Search past sessions" },
        { id: getLogId(), type: "entity" as const, content: "  /clear          ", highlight: "- Clear terminal output" },
        { id: getLogId(), type: "entity" as const, content: "  /help           ", highlight: "- Show this help message" },
        { id: getLogId(), type: "system" as const, prefix: "Info", content: "Memoria learns from interactions and improves over time." },
      ]
      setLogs(prev => [...prev, ...helpLogs])
      return
    }

    // Memory commands
    if (command.startsWith("/memory")) {
      const args = command.replace("/memory", "").trim().split(/\s+/)
      await handleMemoryCommand(args)
      return
    }

    // Skill commands
    if (command.startsWith("/skill")) {
      const args = command.replace("/skill", "").trim().split(/\s+/)
      await handleSkillCommand(args)
      return
    }

    // Session commands
    if (command.startsWith("/sessions") || command.startsWith("/session ")) {
      const args = command.replace("/sessions", "").replace("/session", "").trim().split(/\s+/)
      await handleSessionCommand(args)
      return
    }

    // Ingest command
    if (command.startsWith("/ingest")) {
      const url = command.replace("/ingest", "").trim()
      if (!url) {
        setLogs(prev => [...prev,
          { id: getLogId(), type: "command", content: command },
          { id: getLogId(), type: "error", prefix: "System", content: "Usage: /ingest <youtube_url>" },
        ])
        return
      }

      setLogs(prev => [...prev, { id: getLogId(), type: "command", content: command }])
      setIsProcessing(true)

      try {
        setLogs(prev => [...prev, { id: getLogId(), type: "system", prefix: "System", content: "Downloading audio from YouTube..." }])
        
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
          const baseId = getLogId()
          setLogs(prev => [...prev,
            { id: baseId, type: "system", prefix: "Whisper ASR", content: `Transcribing via Fireworks Whisper V3 Turbo...` },
            { id: baseId + 1, type: "success", prefix: "System", content: data.message },
            { id: baseId + 2, type: "link", prefix: "Graph", content: `Source #${data.source_id} ready for review in Graph view` },
          ])
          
          if (data.transcript) {
            const preview = data.transcript.slice(0, 500) + (data.transcript.length > 500 ? "..." : "")
            setLogs(prev => [...prev,
              { id: baseId + 3, type: "entity", prefix: "Transcript", content: "Preview: ", highlight: preview },
            ])
          }
        } else {
          setLogs(prev => [...prev, { id: getLogId(), type: "error", prefix: "System", content: data.message }])
        }
      } catch (error) {
        setLogs(prev => [...prev, { id: getLogId(), type: "error", prefix: "System", content: `Ingestion failed: ${error}` }])
      }

      setIsProcessing(false)
      return
    }

    // For any other input, treat as a natural language query to the AI
    setLogs(prev => [...prev, { id: getLogId(), type: "command", content: command }])
    setIsProcessing(true)

    try {
      await callBackendAPI(command)
    } catch (error) {
      setLogs(prev => [...prev, { id: getLogId(), type: "error", prefix: "System", content: "Failed to get response from AI." }])
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
      case "memory": return "text-cyan-400"
      case "skill": return "text-amber-400"
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
            placeholder="Ask anything, use /memory, /skills, /sessions, or /help for more..."
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
