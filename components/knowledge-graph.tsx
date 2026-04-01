"use client"

import { useRef, useEffect, useState, useCallback } from "react"

interface GraphNode {
  id: string
  name: string
  x?: number
  y?: number
  vx?: number
  vy?: number
}

interface GraphLink {
  source: string
  target: string
  relationship: string
}

interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

// Sample knowledge graph data
const GRAPH_DATA: GraphData = {
  nodes: [
    { id: "wacc", name: "WACC" },
    { id: "cost-of-equity", name: "Cost of Equity" },
    { id: "cost-of-debt", name: "Cost of Debt" },
    { id: "risk-free-rate", name: "Risk-Free Rate" },
    { id: "beta", name: "Beta" },
    { id: "market-risk-premium", name: "Market Risk Premium" },
    { id: "capital-structure", name: "Capital Structure" },
    { id: "capm", name: "CAPM" },
    { id: "discount-rate", name: "Discount Rate" },
    { id: "npv", name: "NPV" },
    { id: "dcf", name: "DCF" },
    { id: "terminal-value", name: "Terminal Value" },
    { id: "growth-rate", name: "Growth Rate" },
    { id: "free-cash-flow", name: "Free Cash Flow" },
    { id: "enterprise-value", name: "Enterprise Value" },
  ],
  links: [
    { source: "wacc", target: "cost-of-equity", relationship: "composed_of" },
    { source: "wacc", target: "cost-of-debt", relationship: "composed_of" },
    { source: "cost-of-equity", target: "risk-free-rate", relationship: "depends_on" },
    { source: "cost-of-equity", target: "beta", relationship: "depends_on" },
    { source: "cost-of-equity", target: "market-risk-premium", relationship: "depends_on" },
    { source: "cost-of-equity", target: "capm", relationship: "calculated_by" },
    { source: "wacc", target: "capital-structure", relationship: "weighted_by" },
    { source: "discount-rate", target: "wacc", relationship: "often_equals" },
    { source: "npv", target: "discount-rate", relationship: "uses" },
    { source: "dcf", target: "discount-rate", relationship: "uses" },
    { source: "dcf", target: "free-cash-flow", relationship: "projects" },
    { source: "dcf", target: "terminal-value", relationship: "includes" },
    { source: "terminal-value", target: "growth-rate", relationship: "depends_on" },
    { source: "enterprise-value", target: "dcf", relationship: "derived_from" },
    { source: "capm", target: "risk-free-rate", relationship: "uses" },
    { source: "capm", target: "beta", relationship: "uses" },
  ],
}

export function KnowledgeGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const animationRef = useRef<number>(0)
  const mousePos = useRef({ x: 0, y: 0 })

  // Initialize node positions
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const width = canvas.offsetWidth
    const height = canvas.offsetHeight
    const centerX = width / 2
    const centerY = height / 2

    // Position nodes in a circular layout with some randomness
    const initialNodes = GRAPH_DATA.nodes.map((node, i) => {
      const angle = (i / GRAPH_DATA.nodes.length) * Math.PI * 2
      const radius = 150 + Math.random() * 100
      return {
        ...node,
        x: centerX + Math.cos(angle) * radius + (Math.random() - 0.5) * 50,
        y: centerY + Math.sin(angle) * radius + (Math.random() - 0.5) * 50,
        vx: 0,
        vy: 0,
      }
    })

    setNodes(initialNodes)
  }, [])

  // Simple force simulation
  const simulate = useCallback(() => {
    setNodes(prevNodes => {
      const newNodes = prevNodes.map(node => ({ ...node }))
      const canvas = canvasRef.current
      if (!canvas) return prevNodes

      const width = canvas.offsetWidth
      const height = canvas.offsetHeight
      const centerX = width / 2
      const centerY = height / 2

      // Apply forces
      for (let i = 0; i < newNodes.length; i++) {
        const node = newNodes[i]
        
        // Center gravity
        node.vx! += (centerX - node.x!) * 0.001
        node.vy! += (centerY - node.y!) * 0.001

        // Repulsion between nodes
        for (let j = 0; j < newNodes.length; j++) {
          if (i === j) continue
          const other = newNodes[j]
          const dx = node.x! - other.x!
          const dy = node.y! - other.y!
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = 500 / (dist * dist)
          node.vx! += (dx / dist) * force
          node.vy! += (dy / dist) * force
        }

        // Link attraction
        GRAPH_DATA.links.forEach(link => {
          const isSource = link.source === node.id
          const isTarget = link.target === node.id
          if (!isSource && !isTarget) return

          const otherId = isSource ? link.target : link.source
          const other = newNodes.find(n => n.id === otherId)
          if (!other) return

          const dx = other.x! - node.x!
          const dy = other.y! - node.y!
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = (dist - 120) * 0.01
          node.vx! += (dx / dist) * force
          node.vy! += (dy / dist) * force
        })

        // Apply velocity with damping
        node.vx! *= 0.9
        node.vy! *= 0.9
        node.x! += node.vx!
        node.y! += node.vy!

        // Keep in bounds
        node.x = Math.max(50, Math.min(width - 50, node.x!))
        node.y = Math.max(50, Math.min(height - 50, node.y!))
      }

      return newNodes
    })

    animationRef.current = requestAnimationFrame(simulate)
  }, [])

  // Start simulation
  useEffect(() => {
    if (nodes.length > 0) {
      animationRef.current = requestAnimationFrame(simulate)
    }
    return () => cancelAnimationFrame(animationRef.current)
  }, [nodes.length, simulate])

  // Draw the graph
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || nodes.length === 0) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    // Clear
    ctx.fillStyle = "#050505"
    ctx.fillRect(0, 0, rect.width, rect.height)

    // Get connected nodes if hovering
    const connectedNodes = new Set<string>()
    if (hoveredNode) {
      connectedNodes.add(hoveredNode)
      GRAPH_DATA.links.forEach(link => {
        if (link.source === hoveredNode) connectedNodes.add(link.target)
        if (link.target === hoveredNode) connectedNodes.add(link.source)
      })
    }

    // Draw links
    GRAPH_DATA.links.forEach(link => {
      const sourceNode = nodes.find(n => n.id === link.source)
      const targetNode = nodes.find(n => n.id === link.target)
      if (!sourceNode || !targetNode) return

      const isHighlighted = hoveredNode && 
        (link.source === hoveredNode || link.target === hoveredNode)

      ctx.beginPath()
      ctx.moveTo(sourceNode.x!, sourceNode.y!)
      ctx.lineTo(targetNode.x!, targetNode.y!)
      ctx.strokeStyle = isHighlighted 
        ? "rgba(255, 255, 255, 0.6)" 
        : hoveredNode 
          ? "rgba(255, 255, 255, 0.03)" 
          : "rgba(255, 255, 255, 0.1)"
      ctx.lineWidth = isHighlighted ? 1.5 : 0.5
      ctx.stroke()
    })

    // Draw nodes
    nodes.forEach(node => {
      const isHovered = node.id === hoveredNode
      const isConnected = connectedNodes.has(node.id)
      const dimmed = hoveredNode && !isConnected

      ctx.beginPath()
      ctx.arc(node.x!, node.y!, isHovered ? 6 : 4, 0, Math.PI * 2)
      
      if (isHovered) {
        ctx.fillStyle = "#06B6D4"
        ctx.shadowColor = "#06B6D4"
        ctx.shadowBlur = 15
      } else if (dimmed) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.2)"
        ctx.shadowBlur = 0
      } else {
        ctx.fillStyle = "#FFFFFF"
        ctx.shadowColor = "#FFFFFF"
        ctx.shadowBlur = 8
      }
      
      ctx.fill()
      ctx.shadowBlur = 0

      // Draw label on hover
      if (isHovered || (isConnected && hoveredNode)) {
        ctx.font = "12px Inter, system-ui, sans-serif"
        ctx.fillStyle = isHovered ? "#06B6D4" : "rgba(255, 255, 255, 0.8)"
        ctx.textAlign = "center"
        ctx.fillText(node.name, node.x!, node.y! - 15)
      }
    })
  }, [nodes, hoveredNode])

  // Handle mouse move
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    mousePos.current = { x, y }

    // Check if hovering over a node
    let found: string | null = null
    for (const node of nodes) {
      const dx = x - node.x!
      const dy = y - node.y!
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 15) {
        found = node.id
        break
      }
    }
    setHoveredNode(found)
  }

  return (
    <div className="absolute inset-0 bg-[#050505]">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        style={{ display: "block" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredNode(null)}
      />
      
      {/* Legend */}
      <div className="absolute bottom-6 left-6 text-xs text-white/40 font-mono">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_white]" />
          <span>Concept Node</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-px bg-white/30" />
          <span>Relationship</span>
        </div>
      </div>

      {/* Node count */}
      <div className="absolute bottom-6 right-6 text-xs text-white/40 font-mono">
        {GRAPH_DATA.nodes.length} nodes · {GRAPH_DATA.links.length} edges
      </div>
    </div>
  )
}
