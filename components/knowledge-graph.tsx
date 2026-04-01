"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { ChevronRight, ChevronLeft, Check, X, FileText, AlertCircle } from "lucide-react"

interface GraphNode {
  id: number
  name: string
  type: string
  x?: number
  y?: number
  vx?: number
  vy?: number
}

interface GraphLink {
  source: number
  target: number
  type: string
}

interface PendingSource {
  id: number
  url: string
  title: string
  duration_seconds: number
  word_count: number
  created_at: string
  entity_count: number
  relationship_count: number
}

interface ProposedEntity {
  id: string
  name: string
  type: string
  description: string
  confidence: number
}

interface ProposedRelationship {
  id: string
  source: string
  target: string
  type: string
  description: string
}

interface SourceDetails {
  id: number
  url: string
  title: string
  transcript_preview: string
  duration_seconds: number
  word_count: number
  extraction_status: string
  created_at: string
  proposed_entities: ProposedEntity[]
  proposed_relationships: ProposedRelationship[]
  duplicates: Record<string, string>
}

export function KnowledgeGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hoveredNode, setHoveredNode] = useState<number | null>(null)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [links, setLinks] = useState<GraphLink[]>([])
  const [pendingSources, setPendingSources] = useState<PendingSource[]>([])
  const [selectedSource, setSelectedSource] = useState<number | null>(null)
  const [sourceDetails, setSourceDetails] = useState<SourceDetails | null>(null)
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false)
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(new Set())
  const [selectedRelationships, setSelectedRelationships] = useState<Set<string>>(new Set())
  const [entityEdits, setEntityEdits] = useState<Record<string, Partial<ProposedEntity>>>({})
  const [mergeMap, setMergeMap] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Load graph data and pending sources
  useEffect(() => {
    loadGraphData()
    loadPendingSources()

    // Poll for updates every 10 seconds
    const interval = setInterval(() => {
      loadPendingSources()
      if (!selectedSource) loadGraphData()
    }, 10000)

    return () => clearInterval(interval)
  }, [selectedSource])

  const loadGraphData = async () => {
    try {
      const [entitiesRes, relationshipsRes] = await Promise.all([
        fetch("/api/graph/entities"),
        fetch("/api/graph/relationships")
      ])

      if (entitiesRes.ok && relationshipsRes.ok) {
        const entities = await entitiesRes.json()
        const relationships = await relationshipsRes.json()

        // Map to graph format
        const graphNodes = entities.entities.map((e: any) => ({
          id: e.id,
          name: e.name,
          type: e.type
        }))

        const graphLinks = relationships.relationships.map((r: any) => ({
          source: r.source_entity_id,
          target: r.target_entity_id,
          type: r.type
        }))

        setNodes(graphNodes)
        setLinks(graphLinks)
      }
    } catch (e) {
      console.error("Failed to load graph:", e)
    }
  }

  const loadPendingSources = async () => {
    try {
      const res = await fetch("/api/graph/pending")
      if (res.ok) {
        const data = await res.json()
        setPendingSources(data.sources)
      }
    } catch (e) {
      console.error("Failed to load pending sources:", e)
    }
  }

  const loadSourceDetails = async (sourceId: number) => {
    try {
      const res = await fetch(`/api/sources/${sourceId}`)
      if (res.ok) {
        const data = await res.json()
        setSourceDetails(data)
        // Pre-select all entities and relationships
        setSelectedEntities(new Set(data.proposed_entities.map((e: ProposedEntity) => e.id)))
        setSelectedRelationships(new Set(data.proposed_relationships.map((r: ProposedRelationship) => r.id)))
        // Initialize merge map from duplicates
        setMergeMap(data.duplicates || {})
      }
    } catch (e) {
      console.error("Failed to load source details:", e)
    }
  }

  const handleSourceClick = (sourceId: number) => {
    setSelectedSource(sourceId)
    loadSourceDetails(sourceId)
    setReviewPanelOpen(true)
  }

  const handleApprove = async () => {
    if (!selectedSource) return
    setIsSubmitting(true)

    try {
      const res = await fetch(`/api/sources/${selectedSource}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_ids: Array.from(selectedEntities),
          relationship_ids: Array.from(selectedRelationships),
          entity_edits: entityEdits,
          merge_map: mergeMap
        })
      })

      if (res.ok) {
        setReviewPanelOpen(false)
        setSelectedSource(null)
        setSourceDetails(null)
        loadPendingSources()
        loadGraphData()
      }
    } catch (e) {
      console.error("Failed to approve:", e)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSkip = async () => {
    if (!selectedSource) return
    setIsSubmitting(true)

    try {
      await fetch(`/api/sources/${selectedSource}/skip`, { method: "POST" })
      setReviewPanelOpen(false)
      setSelectedSource(null)
      setSourceDetails(null)
      loadPendingSources()
    } catch (e) {
      console.error("Failed to skip:", e)
    } finally {
      setIsSubmitting(false)
    }
  }

  const toggleEntity = (id: string) => {
    setSelectedEntities(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleRelationship = (id: string) => {
    setSelectedRelationships(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllEntities = () => {
    if (sourceDetails) {
      setSelectedEntities(new Set(sourceDetails.proposed_entities.map(e => e.id)))
    }
  }

  const deselectAllEntities = () => {
    setSelectedEntities(new Set())
  }

  const selectAllRelationships = () => {
    if (sourceDetails) {
      setSelectedRelationships(new Set(sourceDetails.proposed_relationships.map(r => r.id)))
    }
  }

  const deselectAllRelationships = () => {
    setSelectedRelationships(new Set())
  }

  // Initialize node positions
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || nodes.length === 0) return

    const width = canvas.offsetWidth
    const height = canvas.offsetHeight
    const centerX = width / 2
    const centerY = height / 2

    setNodes(prev => prev.map((node, i) => {
      if (node.x !== undefined) return node
      const angle = (i / nodes.length) * Math.PI * 2
      const radius = 150 + Math.random() * 100
      return {
        ...node,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        vx: 0,
        vy: 0
      }
    }))
  }, [nodes.length])

  // Force simulation
  const simulate = useCallback(() => {
    setNodes(prevNodes => {
      if (prevNodes.length === 0) return prevNodes

      const newNodes = prevNodes.map(node => ({ ...node }))
      const canvas = canvasRef.current
      if (!canvas) return prevNodes

      const width = canvas.offsetWidth
      const height = canvas.offsetHeight
      const centerX = width / 2
      const centerY = height / 2

      for (let i = 0; i < newNodes.length; i++) {
        const node = newNodes[i]
        if (node.x === undefined || node.y === undefined) continue

        node.vx = (node.vx || 0) + (centerX - node.x) * 0.001
        node.vy = (node.vy || 0) + (centerY - node.y) * 0.001

        for (let j = 0; j < newNodes.length; j++) {
          if (i === j) continue
          const other = newNodes[j]
          if (other.x === undefined || other.y === undefined) continue
          const dx = node.x - other.x
          const dy = node.y - other.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = 500 / (dist * dist)
          node.vx += (dx / dist) * force
          node.vy += (dy / dist) * force
        }

        links.forEach(link => {
          if (link.source !== node.id && link.target !== node.id) return
          const otherId = link.source === node.id ? link.target : link.source
          const other = newNodes.find(n => n.id === otherId)
          if (!other || other.x === undefined || other.y === undefined) return
          const dx = other.x - node.x
          const dy = other.y - node.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = (dist - 120) * 0.01
          node.vx += (dx / dist) * force
          node.vy += (dy / dist) * force
        })

        node.vx *= 0.9
        node.vy *= 0.9
        node.x += node.vx
        node.y += node.vy

        node.x = Math.max(50, Math.min(width - 50, node.x))
        node.y = Math.max(50, Math.min(height - 50, node.y))
      }

      return newNodes
    })
  }, [links])

  // Animation loop
  useEffect(() => {
    let animationId: number
    const loop = () => {
      simulate()
      animationId = requestAnimationFrame(loop)
    }
    if (nodes.length > 0) {
      animationId = requestAnimationFrame(loop)
    }
    return () => cancelAnimationFrame(animationId)
  }, [nodes.length, simulate])

  // Draw canvas
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

    ctx.fillStyle = "#050505"
    ctx.fillRect(0, 0, rect.width, rect.height)

    const connectedNodes = new Set<number>()
    if (hoveredNode) {
      connectedNodes.add(hoveredNode)
      links.forEach(link => {
        if (link.source === hoveredNode) connectedNodes.add(link.target)
        if (link.target === hoveredNode) connectedNodes.add(link.source)
      })
    }

    links.forEach(link => {
      const sourceNode = nodes.find(n => n.id === link.source)
      const targetNode = nodes.find(n => n.id === link.target)
      if (!sourceNode || !targetNode || sourceNode.x === undefined || targetNode.x === undefined) return

      const isHighlighted = hoveredNode && (link.source === hoveredNode || link.target === hoveredNode)

      ctx.beginPath()
      ctx.moveTo(sourceNode.x, sourceNode.y)
      ctx.lineTo(targetNode.x, targetNode.y)
      ctx.strokeStyle = isHighlighted
        ? "rgba(255, 255, 255, 0.6)"
        : hoveredNode
          ? "rgba(255, 255, 255, 0.03)"
          : "rgba(255, 255, 255, 0.1)"
      ctx.lineWidth = isHighlighted ? 1.5 : 0.5
      ctx.stroke()
    })

    nodes.forEach(node => {
      if (node.x === undefined || node.y === undefined) return
      const isHovered = node.id === hoveredNode
      const isConnected = connectedNodes.has(node.id)
      const dimmed = hoveredNode && !isConnected

      ctx.beginPath()
      ctx.arc(node.x, node.y, isHovered ? 6 : 4, 0, Math.PI * 2)

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

      if (isHovered || (isConnected && hoveredNode)) {
        ctx.font = "12px Inter, system-ui, sans-serif"
        ctx.fillStyle = isHovered ? "#06B6D4" : "rgba(255, 255, 255, 0.8)"
        ctx.textAlign = "center"
        ctx.fillText(node.name, node.x, node.y - 15)
      }
    })
  }, [nodes, links, hoveredNode])

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    let found: number | null = null
    for (const node of nodes) {
      if (node.x === undefined || node.y === undefined) continue
      const dx = x - node.x
      const dy = y - node.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 15) {
        found = node.id
        break
      }
    }
    setHoveredNode(found)
  }

  return (
    <div className="absolute inset-0 bg-[#050505] flex">
      {/* Main Graph Area */}
      <div className="flex-1 relative">
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
          {nodes.length} nodes · {links.length} edges
        </div>

        {/* Pending Review Badge */}
        {pendingSources.length > 0 && (
          <Button
            variant="outline"
            className="absolute top-6 right-6 bg-black/50 border-white/20 text-white hover:bg-white/10"
            onClick={() => setReviewPanelOpen(true)}
          >
            <AlertCircle className="w-4 h-4 mr-2 text-yellow-400" />
            Review {pendingSources.length} pending
          </Button>
        )}
      </div>

      {/* Review Panel */}
      {reviewPanelOpen && (
        <div className="w-[450px] bg-[#0A0A0A] border-l border-white/10 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="text-white/60 hover:text-white hover:bg-white/10"
                onClick={() => {
                  setReviewPanelOpen(false)
                  setSelectedSource(null)
                  setSourceDetails(null)
                }}
              >
                <ChevronRight className="w-5 h-5 rotate-180" />
              </Button>
              <h2 className="font-semibold text-white">Pending Review</h2>
            </div>
            <Badge variant="secondary" className="bg-white/10 text-white">
              {pendingSources.length}
            </Badge>
          </div>

          {/* Content */}
          <ScrollArea className="flex-1">
            {!selectedSource ? (
              // Source List
              <div className="p-4 space-y-3">
                {pendingSources.map(source => (
                  <Card
                    key={source.id}
                    className="bg-white/5 border-white/10 cursor-pointer hover:bg-white/10 transition-colors"
                    onClick={() => handleSourceClick(source.id)}
                  >
                    <CardHeader className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-emerald-400" />
                          <CardTitle className="text-sm text-white">Source #{source.id}</CardTitle>
                        </div>
                        <ChevronRight className="w-4 h-4 text-white/40" />
                      </div>
                      <CardDescription className="text-xs text-white/50 mt-1 truncate">
                        {source.title}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 pt-0">
                      <div className="flex gap-2 text-xs">
                        <Badge variant="outline" className="border-white/20 text-white/60">
                          {source.entity_count} entities
                        </Badge>
                        <Badge variant="outline" className="border-white/20 text-white/60">
                          {source.relationship_count} relationships
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {pendingSources.length === 0 && (
                  <div className="text-center py-8 text-white/40">
                    No pending extractions
                  </div>
                )}
              </div>
            ) : sourceDetails ? (
              // Source Detail Review
              <div className="p-4 space-y-4">
                {/* Source Info */}
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-white">{sourceDetails.title}</h3>
                  <p className="text-xs text-white/50 line-clamp-2">{sourceDetails.transcript_preview}</p>
                </div>

                <Separator className="bg-white/10" />

                {/* Entities Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-white">
                      Entities ({sourceDetails.proposed_entities.length})
                    </h4>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-6 text-xs text-white/60" onClick={selectAllEntities}>
                        All
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 text-xs text-white/60" onClick={deselectAllEntities}>
                        None
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {sourceDetails.proposed_entities.map(entity => {
                      const isDuplicate = sourceDetails.duplicates[entity.name]
                      const isSelected = selectedEntities.has(entity.id)
                      const edit = entityEdits[entity.id]

                      return (
                        <div
                          key={entity.id}
                          className={`p-3 rounded-lg border ${isSelected ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/10 bg-white/5'}`}
                        >
                          <div className="flex items-start gap-2">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleEntity(entity.id)}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-white truncate">
                                  {edit?.name || entity.name}
                                </span>
                                <Badge variant="outline" className="text-xs border-white/20 text-white/60 shrink-0">
                                  {edit?.type || entity.type}
                                </Badge>
                                {isDuplicate && (
                                  <Badge className="text-xs bg-yellow-500/20 text-yellow-400 border-yellow-500/50 shrink-0">
                                    Merge with "{isDuplicate}"
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-white/50 mt-1 line-clamp-2">
                                {edit?.description || entity.description}
                              </p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <Separator className="bg-white/10" />

                {/* Relationships Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-white">
                      Relationships ({sourceDetails.proposed_relationships.length})
                    </h4>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-6 text-xs text-white/60" onClick={selectAllRelationships}>
                        All
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 text-xs text-white/60" onClick={deselectAllRelationships}>
                        None
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {sourceDetails.proposed_relationships.map(rel => {
                      const isSelected = selectedRelationships.has(rel.id)
                      return (
                        <div
                          key={rel.id}
                          className={`p-2 rounded-lg border text-sm ${isSelected ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/10 bg-white/5'}`}
                        >
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleRelationship(rel.id)}
                            />
                            <span className="text-white/80">{rel.source}</span>
                            <span className="text-emerald-400">→</span>
                            <span className="text-cyan-400">{rel.type}</span>
                            <span className="text-emerald-400">→</span>
                            <span className="text-white/80">{rel.target}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <Separator className="bg-white/10" />

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-black"
                    onClick={handleApprove}
                    disabled={isSubmitting || selectedEntities.size === 0}
                  >
                    <Check className="w-4 h-4 mr-2" />
                    Approve {selectedEntities.size}
                  </Button>
                  <Button
                    variant="outline"
                    className="border-white/20 text-white hover:bg-white/10"
                    onClick={handleSkip}
                    disabled={isSubmitting}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
