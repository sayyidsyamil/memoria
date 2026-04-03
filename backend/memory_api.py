"""Memory Web Clipper integration endpoint.

This module provides an HTTP endpoint for browser extensions
to save content directly to the Memoria-managed knowledge base.

To set up:
1. Configure browser extension to POST to http://localhost:8000/api/memory/clip
2. Content will be saved to knowledge/raw/YYYY/MM/ for AI processing
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from pathlib import Path
from datetime import datetime

# Try to import MemoryVault - may not be available in all environments
try:
    from memory_vault import MemoryVault
    _MEMORY_VAULT_AVAILABLE = True
except ImportError:
    _MEMORY_VAULT_AVAILABLE = False

router = APIRouter()


class WebClipRequest(BaseModel):
    """Request body for web clipping."""
    title: str = Field(..., min_length=1, description="Page title")
    url: str = Field(..., min_length=1, description="Source URL")
    content: str = Field(..., min_length=1, description="Markdown content from page")
    tags: list[str] = Field(default_factory=list, description="Tags from the page")
    excerpt: str | None = Field(None, description="Short excerpt/summary")
    author: str | None = Field(None, description="Article author if available")
    published_date: str | None = Field(None, description="Published date if available")


class WebClipResponse(BaseModel):
    """Response after saving a web clip."""
    success: bool
    file_path: str | None = None
    message: str
    note_count: int = 0
    raw_count: int = 0


@router.post("/api/memory/clip", response_model=WebClipResponse)
def clip_web_content(body: WebClipRequest):
    """Save web clip to memory vault raw/ directory.

    This endpoint accepts clipped content from browser extensions
    and saves it for later AI compilation.
    """
    if not _MEMORY_VAULT_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="Memory vault integration not available"
        )

    # Get vault path from config
    try:
        from config import load_config
        cfg = load_config()
        vault_path = cfg.get("memory_vault_path", "")

        if not vault_path:
            return WebClipResponse(
                success=False,
                message="No memory vault configured. Set memory_vault_path in config."
            )
    except Exception as e:
        return WebClipResponse(
            success=False,
            message=f"Config error: {str(e)}"
        )

    try:
        vault = MemoryVault(vault_path)

        # Build metadata
        metadata = {
            "source_url": body.url,
            "clipped_date": datetime.now().strftime("%Y-%m-%d"),
        }
        if body.author:
            metadata["author"] = body.author
        if body.published_date:
            metadata["published_date"] = body.published_date
        if body.excerpt:
            metadata["excerpt"] = body.excerpt

        # Determine source type from URL
        source_type = "web_clip"
        if "arxiv.org" in body.url:
            source_type = "paper"
        elif "youtube.com" in body.url or "youtu.be" in body.url:
            source_type = "video"
        elif "github.com" in body.url:
            source_type = "repo"
        elif body.url.endswith(".pdf"):
            source_type = "document"

        # Ensure tags include source type
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

        return WebClipResponse(
            success=True,
            file_path=str(file_path),
            message=f"Saved to raw/: {file_path.name}",
            note_count=len(notes),
            raw_count=len(raw_sources)
        )

    except Exception as e:
        return WebClipResponse(
            success=False,
            message=f"Error saving clip: {str(e)}"
        )


@router.get("/api/memory/status")
def get_memory_vault_status():
    """Get memory vault status."""
    if not _MEMORY_VAULT_AVAILABLE:
        return {
            "enabled": False,
            "message": "Memory vault module not available"
        }

    try:
        from config import load_config
        cfg = load_config()
        vault_path = cfg.get("memory_vault_path", "")

        if not vault_path:
            return {
                "enabled": True,
                "configured": False,
                "message": "Vault path not configured. Use /memory vault <path>"
            }

        vault = MemoryVault(vault_path)
        notes = vault.get_all_notes()
        raw_sources = vault.get_raw_sources()
        unprocessed = vault.get_raw_sources(status="unprocessed")

        # Get graph stats
        graph = vault.get_knowledge_graph()

        return {
            "enabled": True,
            "configured": True,
            "vault_path": vault_path,
            "stats": {
                "wiki_articles": len(notes),
                "raw_sources": len(raw_sources),
                "unprocessed": len(unprocessed),
                "graph_nodes": len(graph["nodes"]),
                "graph_edges": len(graph["edges"])
            },
            "ready": True
        }

    except Exception as e:
        return {
            "enabled": True,
            "configured": bool(vault_path),
            "vault_path": vault_path if 'vault_path' in dir() else None,
            "error": str(e),
            "ready": False
        }


@router.post("/api/memory/compile")
def compile_raw_sources():
    """Trigger compilation of raw sources to wiki."""
    if not _MEMORY_VAULT_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="Memory vault integration not available"
        )

    try:
        from config import load_config
        cfg = load_config()
        vault_path = cfg.get("memory_vault_path", "")

        if not vault_path:
            return {
                "success": False,
                "message": "No vault configured"
            }

        vault = MemoryVault(vault_path)
        unprocessed = vault.get_raw_sources(status="unprocessed")

        if not unprocessed:
            return {
                "success": True,
                "compiled": 0,
                "message": "No unprocessed sources"
            }

        # Placeholder AI compilation - in production this would call the AI provider
        def simple_compile(content: str, title: str) -> str:
            return f"""## Summary

Compiled from: {title}

## Key Points

- [AI-generated summary would go here]

## Source Content

{content[:1000] if content else "[No content]"}
"""

        created = vault.compile_raw_to_wiki(simple_compile)

        return {
            "success": True,
            "compiled": len(created),
            "files": [str(c.name) for c in created[:10]],
            "message": f"Compiled {len(created)} articles to wiki/"
        }

    except Exception as e:
        return {
            "success": False,
            "message": f"Compilation error: {str(e)}"
        }
