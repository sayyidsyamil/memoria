"""File-based memory storage with knowledge vault layout.

Storage layout:
  project vault : <project_root>/knowledge/memory/<slug>.md
  
MEMORY.md in each directory is the index file — rebuilt automatically after
every save/delete. It is loaded into the system prompt as an overview of
available memories.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from config import get_knowledge_root
from utils import parse_frontmatter


# ── Paths ──────────────────────────────────────────────────────────────────

def get_memory_dir(scope: str = "user") -> Path:
    """Return the memory directory for the knowledge vault.
    
    All memories now stored in project knowledge vault for better
    organization and accessibility.
    """
    knowledge_root = get_knowledge_root()
    return knowledge_root / "memory"


USER_MEMORY_DIR = get_memory_dir()  # Backward compatibility
INDEX_FILENAME = "MEMORY.md"

# Maximum lines/bytes for the index file
MAX_INDEX_LINES = 200
MAX_INDEX_BYTES = 25_000


def get_project_memory_dir() -> Path:
    """Return the project-local memory directory (now same as get_memory_dir)."""
    return get_memory_dir()


# ── Data model ─────────────────────────────────────────────────────────────

@dataclass
class MemoryEntry:
    """A single memory entry loaded from a .md file.

    Attributes:
        name:        human-readable name (also the display title in the index)
        description: short one-line description (used for relevance decisions)
        type:        "user" | "feedback" | "project" | "reference"
        content:     body text of the memory
        file_path:   absolute path to the .md file on disk
        created:     date string, e.g. "2026-04-02"
        scope:       "user" | "project" — which directory this was loaded from
    """
    name: str
    description: str
    type: str
    content: str
    file_path: str = ""
    created: str = ""
    scope: str = "user"


# ── Helpers ────────────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    """Convert name to a filesystem-safe slug (max 60 chars)."""
    s = name.lower().strip().replace(" ", "_")
    s = re.sub(r"[^a-z0-9_]", "", s)
    return s[:60]


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Parse ---\\nkey: value\\n---\\nbody format.

    Returns:
        (meta_dict, body_str)

    Note: This function is now imported from utils module for consistency.
    This local copy is kept for backward compatibility during transition.
    """
    from utils import parse_frontmatter as _parse
    return _parse(text)


def _format_entry_md(entry: MemoryEntry) -> str:
    """Render a MemoryEntry as a markdown file with YAML frontmatter."""
    return (
        f"---\n"
        f"name: {entry.name}\n"
        f"description: {entry.description}\n"
        f"type: {entry.type}\n"
        f"created: {entry.created}\n"
        f"---\n"
        f"{entry.content}\n"
    )


# ── Core storage operations ────────────────────────────────────────────────

def save_memory(entry: MemoryEntry, scope: str = "user", folder: str = "") -> None:
    """Write/update a memory file and rebuild the index for that scope.

    If a memory with the same name (slug) already exists, it is overwritten.

    Args:
        entry: MemoryEntry to persist
        scope: "user" or "project"
        folder: Optional subfolder (e.g., "sources", "concepts", "daily")
    """
    mem_dir = get_memory_dir(scope)
    
    # Create subfolder if specified
    if folder:
        target_dir = mem_dir / folder
        target_dir.mkdir(parents=True, exist_ok=True)
    else:
        target_dir = mem_dir
    
    slug = _slugify(entry.name)
    fp = target_dir / f"{slug}.md"
    fp.write_text(_format_entry_md(entry))
    entry.file_path = str(fp)
    entry.scope = scope
    _rewrite_index(scope)


def delete_memory(name: str, scope: str = "user") -> None:
    """Remove the memory file matching name and rebuild the index.

    No error if not found.
    """
    mem_dir = get_memory_dir(scope)
    slug = _slugify(name)
    fp = mem_dir / f"{slug}.md"
    if fp.exists():
        fp.unlink()
    _rewrite_index(scope)


def load_entries(scope: str = "user") -> list[MemoryEntry]:
    """Scan all .md files (except MEMORY.md) in a scope and return entries.

    Returns:
        List of MemoryEntry sorted alphabetically by name.
    """
    mem_dir = get_memory_dir(scope)
    if not mem_dir.exists():
        return []
    entries: list[MemoryEntry] = []
    for fp in sorted(mem_dir.rglob("*.md")):
        if fp.name == INDEX_FILENAME or fp.name == "README.md":
            continue
        try:
            text = fp.read_text()
        except (IOError, OSError):
            continue
        meta, body = parse_frontmatter(text)
        entries.append(MemoryEntry(
            name=meta.get("name", fp.stem),
            description=meta.get("description", ""),
            type=meta.get("type", "user"),
            content=body,
            file_path=str(fp),
            created=meta.get("created", ""),
            scope=scope,
        ))
    return entries


def load_index(scope: str = "all") -> list[MemoryEntry]:
    """Load memory entries from one or both scopes.

    Args:
        scope: "user", "project", or "all" (both combined)

    Returns:
        List of MemoryEntry (user entries first, then project).
    """
    if scope == "all":
        return load_entries("user") + load_entries("project")
    return load_entries(scope)


def search_memory(query: str, scope: str = "all") -> list[MemoryEntry]:
    """Case-insensitive keyword match on name + description + content.

    Returns:
        List of matching MemoryEntry objects.
    """
    q = query.lower()
    results = []
    for entry in load_index(scope):
        haystack = f"{entry.name} {entry.description} {entry.content}".lower()
        if q in haystack:
            results.append(entry)
    return results


def _rewrite_index(scope: str) -> None:
    """Rebuild MEMORY.md for the given scope from all .md files in that dir."""
    mem_dir = get_memory_dir(scope)
    if not mem_dir.exists():
        return
    index_path = mem_dir / INDEX_FILENAME
    entries = load_entries(scope)
    lines = [
        f"- [{e.name}]({Path(e.file_path).name}) — {e.description}"
        for e in entries
    ]
    index_path.write_text("\n".join(lines) + ("\n" if lines else ""))


def get_index_content(scope: str = "user") -> str:
    """Return raw MEMORY.md content for the given scope, or '' if absent."""
    mem_dir = get_memory_dir(scope)
    index_path = mem_dir / INDEX_FILENAME
    if not index_path.exists():
        return ""
    return index_path.read_text().strip()
