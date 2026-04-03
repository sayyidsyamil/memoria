"""HTTP chat + SSE streaming for Brain (Memoria frontend)."""
from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from agent import (
    AgentState,
    PermissionRequest,
    run,
    TextChunk,
    ThinkingChunk,
    ToolEnd,
    ToolStart,
    TurnDone,
)
from config import load_config
from context import build_system_prompt
from fastapi import APIRouter
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

from brain.repl import COMMANDS, execute_slash_for_http

router = APIRouter(tags=["brain-chat"])

_sessions: dict[str, AgentState] = {}
_MAX_TOOL_RESULT = 32000


class ChatBody(BaseModel):
    message: str = Field(..., min_length=1)
    session_id: str | None = None


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@router.get("/api/health")
def health():
    return {"ok": True, "service": "memoria-brain"}


@router.get("/api/commands")
def slash_commands():
    """Slash names supported by the Brain REPL (same as terminal / menu)."""
    names = sorted({k for k in COMMANDS.keys() if k != "quit"})
    return {
        "commands": names,
        "prefix": "/",
    }


@router.post("/api/chat")
def chat(body: ChatBody):
    sid = body.session_id or str(uuid.uuid4())
    if sid not in _sessions:
        _sessions[sid] = AgentState()
    state = _sessions[sid]

    cfg = load_config()
    cfg = {**cfg, "permission_mode": "accept-all"}
    system_prompt = build_system_prompt()

    def _stream_agent(user_message: str):
        for event in run(user_message, state, cfg, system_prompt):
            if isinstance(event, TextChunk):
                yield _sse({"type": "text", "text": event.text})
            elif isinstance(event, ThinkingChunk):
                yield _sse({"type": "thinking", "text": event.text})
            elif isinstance(event, ToolStart):
                yield _sse(
                    {"type": "tool_start", "name": event.name, "inputs": event.inputs}
                )
            elif isinstance(event, PermissionRequest):
                event.granted = True
            elif isinstance(event, ToolEnd):
                r = event.result
                if len(r) > _MAX_TOOL_RESULT:
                    r = r[:_MAX_TOOL_RESULT] + "\n… [truncated]"
                yield _sse(
                    {
                        "type": "tool_end",
                        "name": event.name,
                        "result": r,
                        "permitted": event.permitted,
                    }
                )
            elif isinstance(event, TurnDone):
                yield _sse(
                    {
                        "type": "turn_done",
                        "input_tokens": event.input_tokens,
                        "output_tokens": event.output_tokens,
                    }
                )

    def gen():
        yield _sse({"type": "session", "session_id": sid})
        try:
            sw = execute_slash_for_http(body.message, state, cfg)
            if sw is None:
                yield from _stream_agent(body.message)
            elif isinstance(sw, tuple):
                kind, payload = sw[0], sw[1]
                if kind == "clear":
                    yield _sse({"type": "clear_feed"})
                    if payload:
                        yield _sse({"type": "text", "text": payload + "\n"})
                elif kind == "agent":
                    yield from _stream_agent(payload)
                else:
                    yield _sse({"type": "error", "message": f"Unknown slash kind: {kind}"})
            else:
                if sw:
                    yield _sse({"type": "text", "text": sw + ("" if sw.endswith("\n") else "\n")})
        except Exception as e:
            yield _sse({"type": "error", "message": str(e)})
        yield _sse({"type": "done"})

    return StreamingResponse(gen(), media_type="text/event-stream")


# ── Ingest endpoints for knowledge management ────────────────────────────


class IngestRequest(BaseModel):
    url: str = Field(..., min_length=1)


class IngestResponse(BaseModel):
    success: bool
    source_type: str
    title: str
    summary: str
    key_points: list[str]
    tags: list[str]
    transcript_preview: str
    error: str | None = None


@router.post("/api/ingest", response_model=IngestResponse)
def ingest_content(body: IngestRequest):
    """Ingest YouTube video, PDF, or webpage and return structured notes.
    
    The frontend knowledge inspector can use this to preview notes
    before the user approves saving to memory.
    """
    import asyncio
    from ingest import ingest_youtube, ingest_pdf, ingest_webpage, download_pdf, IngestResult
    
    url_or_path = body.url.strip()
    
    # Detect input type
    is_url = url_or_path.startswith(('http://', 'https://', 'www.'))
    is_youtube = 'youtube.com' in url_or_path or 'youtu.be' in url_or_path
    is_pdf_url = is_url and url_or_path.endswith('.pdf')
    
    try:
        if is_youtube:
            result = ingest_youtube(url_or_path, {})
        elif url_or_path.endswith('.pdf'):
            if is_url or is_pdf_url:
                temp_path = download_pdf(url_or_path)
                result = ingest_pdf(temp_path, {})
            else:
                result = ingest_pdf(url_or_path, {})
        elif is_url:
            # Generic web URL ingestion
            result = ingest_webpage(url_or_path, {})
        else:
            return IngestResponse(
                success=False,
                source_type="unknown",
                title="",
                summary="",
                key_points=[],
                tags=[],
                transcript_preview="",
                error="Unknown input. Provide a YouTube URL, PDF URL, or webpage URL.",
            )
        
        return IngestResponse(
            success=True,
            source_type=result.source_type,
            title=result.title,
            summary=result.summary,
            key_points=result.key_points,
            tags=result.tags,
            transcript_preview=result.transcript[:500] + "..." if len(result.transcript) > 500 else result.transcript,
            error=None,
        )
        
    except ImportError as e:
        return IngestResponse(
            success=False,
            source_type="error",
            title="",
            summary="",
            key_points=[],
            tags=[],
            transcript_preview="",
            error=f"Missing dependency: {e}. Run: pip install youtube-transcript-api pymupdf",
        )
    except Exception as e:
        return IngestResponse(
            success=False,
            source_type="error",
            title="",
            summary="",
            key_points=[],
            tags=[],
            transcript_preview="",
            error=str(e),
        )


# ── Memory Vault endpoints for knowledge integration ────────────────────────────────

class MemoryVaultClipRequest(BaseModel):
    """Request body for saving content to memory vault."""
    title: str = Field(..., min_length=1)
    url: str = Field(..., min_length=1)
    content: str = Field(..., min_length=1)
    tags: list[str] = Field(default_factory=list)
    excerpt: str | None = None
    author: str | None = None


class MemoryVaultClipResponse(BaseModel):
    """Response after saving to memory vault."""
    success: bool
    file_path: str | None = None
    message: str
    wiki_count: int = 0
    raw_count: int = 0


@router.post("/api/memory/clip", response_model=MemoryVaultClipResponse)
def memory_vault_clip(body: MemoryVaultClipRequest):
    """Save web clip to memory vault raw/ directory.

    This integrates with browser extensions to save content
    for AI processing and wiki compilation.
    """
    try:
        from memory_vault import MemoryVault
        from config import load_config

        cfg = load_config()
        vault_path = cfg.get("memory_vault_path", "")

        if not vault_path:
            return MemoryVaultClipResponse(
                success=False,
                message="No vault configured. Use /memory vault <path> in terminal."
            )

        vault = MemoryVault(vault_path)

        # Determine source type
        source_type = "web_clip"
        if "arxiv.org" in body.url:
            source_type = "paper"
        elif "youtube.com" in body.url or "youtu.be" in body.url:
            source_type = "video"
        elif "github.com" in body.url:
            source_type = "repo"
        elif body.url.endswith(".pdf"):
            source_type = "document"

        # Ensure source type in tags
        tags = body.tags.copy()
        if source_type not in tags:
            tags.append(source_type)

        # Save to raw/
        file_path = vault.save_raw_source(
            title=body.title,
            content=body.content,
            source_url=body.url,
            source_type=source_type,
            tags=tags
        )

        # Get stats
        notes = vault.get_all_notes()
        raw_sources = vault.get_raw_sources()

        return MemoryVaultClipResponse(
            success=True,
            file_path=str(file_path),
            message=f"Saved to raw/: {file_path.name}",
            wiki_count=len(notes),
            raw_count=len(raw_sources)
        )

    except ImportError:
        return MemoryVaultClipResponse(
            success=False,
            message="Memory vault module not available"
        )
    except Exception as e:
        return MemoryVaultClipResponse(
            success=False,
            message=f"Error: {str(e)}"
        )


@router.get("/api/memory/status")
def memory_vault_status():
    """Get memory vault status for frontend display."""
    try:
        from memory_vault import MemoryVault
        from config import load_config

        cfg = load_config()
        vault_path = cfg.get("memory_vault_path", "")

        if not vault_path:
            return {
                "enabled": True,
                "configured": False,
                "message": "Set vault path with /memory vault <path>"
            }

        vault = MemoryVault(vault_path)
        notes = vault.get_all_notes()
        raw_sources = vault.get_raw_sources()
        unprocessed = vault.get_raw_sources(status="unprocessed")

        # Get graph stats
        try:
            graph = vault.get_knowledge_graph()
            graph_stats = {
                "nodes": len(graph["nodes"]),
                "edges": len(graph["edges"])
            }
        except:
            graph_stats = {"nodes": 0, "edges": 0}

        return {
            "enabled": True,
            "configured": True,
            "vault_path": vault_path,
            "stats": {
                "wiki_articles": len(notes),
                "raw_sources": len(raw_sources),
                "unprocessed": len(unprocessed),
                **graph_stats
            }
        }

    except ImportError:
        return {"enabled": False, "message": "Memory vault module not available"}
    except Exception as e:
        return {
            "enabled": True,
            "configured": bool(vault_path),
            "error": str(e)
        }


@router.post("/api/memory/compile")
def memory_vault_compile():
    """Compile raw sources to wiki articles (placeholder)."""
    try:
        from memory_vault import MemoryVault
        from config import load_config

        cfg = load_config()
        vault_path = cfg.get("memory_vault_path", "")

        if not vault_path:
            return {"success": False, "message": "No vault configured"}

        vault = MemoryVault(vault_path)
        unprocessed = vault.get_raw_sources(status="unprocessed")

        return {
            "success": True,
            "message": f"{len(unprocessed)} sources ready for AI compilation",
            "unprocessed": len(unprocessed)
        }

    except ImportError:
        return {"success": False, "message": "Memory vault module not available"}
    except Exception as e:
        return {"success": False, "message": f"Error: {str(e)}"}


# ── Memory endpoints for knowledge panel ───────────────────────────────────

class MemoryResponse(BaseModel):
    """Memory item for frontend display."""
    name: str
    description: str
    type: str
    scope: str
    content: str
    created: str


@router.get("/api/memory")
def get_memories():
    """Get all stored memories for the knowledge panel."""
    try:
        from memory.scan import scan_all_memories
        
        headers = scan_all_memories()
        memories = []
        
        for h in headers:
            # Load full content
            try:
                content = Path(h.file_path).read_text(encoding="utf-8") if h.file_path else ""
                # Extract content without frontmatter
                if content.startswith("---"):
                    parts = content.split("---", 2)
                    if len(parts) >= 3:
                        content = parts[2].strip()
            except:
                content = ""
            
            memories.append({
                "name": h.filename.replace(".md", ""),
                "description": h.description or "",
                "type": h.type or "unknown",
                "scope": h.scope,
                "content": content[:1000] + "..." if len(content) > 1000 else content,
                "created": h.mtime_s,
            })
        
        return {"memories": memories, "count": len(memories)}
        
    except ImportError:
        return {"memories": [], "count": 0, "error": "Memory module not available"}
    except Exception as e:
        return {"memories": [], "count": 0, "error": str(e)}


@router.get("/api/memory/search")
def search_memories(q: str = ""):
    """Search memories by query."""
    try:
        from memory.store import search_memory
        
        results = search_memory(q)
        memories = []
        
        for m in results:
            memories.append({
                "name": m.name,
                "description": m.description,
                "type": m.type,
                "scope": m.scope,
                "content": m.content[:500] + "..." if len(m.content) > 500 else m.content,
                "created": m.created,
            })
        
        return {"memories": memories, "count": len(memories)}
        
    except ImportError:
        return {"memories": [], "count": 0}
    except Exception as e:
        return {"memories": [], "count": 0, "error": str(e)}


# ── Connection endpoints for AI-discovered connections ─────────────────────

class ConnectRequest(BaseModel):
    query: str = ""  # Can be empty (all), "random", or specific memory name


class ConnectionResponse(BaseModel):
    success: bool
    connections: list[dict] | None = None
    saved_note: str | None = None
    message: str


@router.post("/api/connect")
def analyze_connections(body: ConnectRequest):
    """Analyze memories and find interesting connections."""
    try:
        # Delegate to the REPL command handler
        from brain.repl import cmd_connect, State, Config
        
        state = State()
        cfg = Config()
        
        # Capture output by redirecting stdout
        import io
        import sys
        
        old_stdout = sys.stdout
        sys.stdout = io.StringIO()
        
        try:
            cmd_connect(body.query, state, cfg)
            output = sys.stdout.getvalue()
        finally:
            sys.stdout = old_stdout
        
        return {
            "success": True,
            "message": "Connection analysis complete",
            "output": output,
        }
        
    except Exception as e:
        return {
            "success": False,
            "message": f"Connection analysis failed: {str(e)}",
        }
