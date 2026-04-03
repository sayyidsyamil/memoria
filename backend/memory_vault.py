"""Memory vault management for Memoria.

This module manages Memoria's knowledge storage, supporting:
- Wikilinks [[Note Title]] format
- YAML frontmatter for metadata
- Directory structure mapping
- Web clipper format for saving external content
- Backlinks and index generation
- Daily notes pattern

Usage:
    from memory_vault import MemoryVault
    
    vault = MemoryVault("~/Documents/MyVault")
    
    # Save a note
    vault.save_note(
        title="My Research",
        content="# My Research\n\nKey findings...",
        tags=["research", "ai"],
        folder="Research"
    )
    
    # Load all notes with backlinks
    notes = vault.get_all_notes()
    
    # Get knowledge graph (nodes and links)
    graph = vault.get_knowledge_graph()
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterator

from utils import parse_frontmatter_advanced as _parse_frontmatter


@dataclass
class MemoryNote:
    """A note in Obsidian format.
    
    Attributes:
        title: Note title (used for wikilinks)
        content: Markdown content (without frontmatter)
        tags: List of tags
        folder: Subfolder path within vault
        metadata: Additional YAML frontmatter fields
        backlinks: Notes that link to this note (auto-populated)
    """
    title: str
    content: str
    tags: list[str] = field(default_factory=list)
    folder: str = ""
    metadata: dict = field(default_factory=dict)
    backlinks: list[str] = field(default_factory=list)
    
    def to_markdown(self) -> str:
        """Convert to full markdown with YAML frontmatter."""
        # Build frontmatter
        frontmatter = {
            "title": self.title,
            "tags": self.tags,
            "created": datetime.now().strftime("%Y-%m-%d"),
            **self.metadata
        }
        
        # YAML frontmatter
        yaml_lines = ["---"]
        for key, value in frontmatter.items():
            if isinstance(value, list):
                yaml_lines.append(f"{key}:")
                for item in value:
                    yaml_lines.append(f"  - {item}")
            elif isinstance(value, str) and ("\n" in value or value.startswith("[") or value.startswith("{")):
                yaml_lines.append(f'{key}: "{value}"')
            else:
                yaml_lines.append(f"{key}: {value}")
        yaml_lines.append("---")
        
        # Content section with title
        lines = [
            "",
            f"# {self.title}",
            "",
            self.content,
        ]
        
        # Add backlinks section if any
        if self.backlinks:
            lines.extend([
                "",
                "## Backlinks",
                "",
            ])
            for link in self.backlinks:
                lines.append(f"- [[{link}]]")
        
        return "\n".join(yaml_lines + lines)
    
    @classmethod
    def from_markdown(cls, text: str, file_path: str = "") -> MemoryNote:
        """Parse markdown text into MemoryNote."""
        # Use shared frontmatter parser
        frontmatter, content = _parse_frontmatter(text)
        
        # Extract title from content (first # heading) or frontmatter
        title = frontmatter.pop("title", "")
        if not title:
            title_match = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
            if title_match:
                title = title_match.group(1).strip()
        
        if not title and file_path:
            title = Path(file_path).stem.replace("_", " ").replace("-", " ").title()
        
        # Extract tags
        tags = frontmatter.pop("tags", [])
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        
        # Remaining frontmatter goes to metadata
        metadata = frontmatter
        
        return cls(
            title=title,
            content=content,
            tags=tags,
            metadata=metadata,
            backlinks=[]  # Will be populated by vault
        )


class MemoryVault:
    """Manages an Obsidian vault for Memoria integration.
    
    Attributes:
        vault_path: Path to the Obsidian vault directory
        raw_dir: Path to the raw/ subdirectory for source materials
        wiki_dir: Path to the wiki/ subdirectory for compiled knowledge
    """
    
    def __init__(self, vault_path: str | Path):
        """Initialize with path to Obsidian vault.
        
        Args:
            vault_path: Path to the vault (e.g., ~/Documents/MyVault)
        """
        self.vault_path = Path(vault_path).expanduser().resolve()
        self.raw_dir = self.vault_path / "raw"
        self.wiki_dir = self.vault_path / "wiki"
        
        # Ensure directories exist
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.wiki_dir.mkdir(parents=True, exist_ok=True)
    
    def _slugify(self, title: str) -> str:
        """Convert title to filename-safe slug."""
        # Remove special characters but keep spaces
        slug = re.sub(r'[<>:"/\\|?*]', "", title)
        # Replace multiple spaces with single
        slug = re.sub(r'\s+', " ", slug)
        return slug.strip()
    
    def _get_note_path(self, title: str, folder: str = "") -> Path:
        """Get the file path for a note."""
        slug = self._slugify(title)
        
        if folder:
            folder_path = self.wiki_dir / folder
            folder_path.mkdir(parents=True, exist_ok=True)
            return folder_path / f"{slug}.md"
        else:
            return self.wiki_dir / f"{slug}.md"
    
    def save_note(
        self,
        title: str,
        content: str,
        tags: list[str] | None = None,
        folder: str = "",
        metadata: dict | None = None,
        source_url: str = "",
    ) -> Path:
        """Save a note to the vault.
        
        Args:
            title: Note title (used for wikilinks)
            content: Markdown content
            tags: List of tags
            folder: Subfolder within wiki/
            metadata: Additional frontmatter
            source_url: Original source URL (added to metadata)
            
        Returns:
            Path to the saved file
        """
        tags = tags or []
        metadata = metadata or {}
        
        if source_url:
            metadata["source"] = source_url
        
        note = MemoryNote(
            title=title,
            content=content,
            tags=tags,
            folder=folder,
            metadata=metadata
        )
        
        file_path = self._get_note_path(title, folder)
        file_path.write_text(note.to_markdown(), encoding="utf-8")
        
        # Rebuild index
        self._rebuild_index()
        
        return file_path
    
    def save_raw_source(
        self,
        title: str,
        content: str,
        source_url: str = "",
        source_type: str = "web_clip",
        tags: list[str] | None = None,
    ) -> Path:
        """Save a raw source document (article, paper, etc.).
        
        Args:
            title: Document title
            content: Raw markdown content (e.g., from Obsidian Web Clipper)
            source_url: Original URL
            source_type: Type of source (article, paper, video, etc.)
            tags: Tags for categorization
            
        Returns:
            Path to the saved file
        """
        tags = tags or []
        
        # Add source type to tags
        if source_type not in tags:
            tags.append(source_type)
        
        # Add date-based folder organization
        today = datetime.now()
        date_folder = f"{today.year}/{today.month:02d}"
        folder_path = self.raw_dir / date_folder
        folder_path.mkdir(parents=True, exist_ok=True)
        
        slug = self._slugify(title)
        file_path = folder_path / f"{slug}.md"
        
        # Build frontmatter
        frontmatter = {
            "title": title,
            "tags": tags,
            "source_url": source_url,
            "source_type": source_type,
            "date": today.strftime("%Y-%m-%d"),
            "status": "unprocessed"  # Memoria can process this later
        }
        
        # Write file
        yaml_lines = ["---"]
        for key, value in frontmatter.items():
            if isinstance(value, list):
                yaml_lines.append(f"{key}:")
                for item in value:
                    yaml_lines.append(f"  - {item}")
            else:
                yaml_lines.append(f"{key}: {value}")
        yaml_lines.append("---")
        
        full_content = "\n".join(yaml_lines) + "\n\n" + content
        file_path.write_text(full_content, encoding="utf-8")
        
        return file_path
    
    def get_note(self, title: str, folder: str = "") -> MemoryNote | None:
        """Load a note by title."""
        file_path = self._get_note_path(title, folder)
        
        if not file_path.exists():
            # Try searching in all folders
            for md_file in self.wiki_dir.rglob("*.md"):
                if md_file.stem == self._slugify(title):
                    file_path = md_file
                    break
        
        if not file_path.exists():
            return None
        
        text = file_path.read_text(encoding="utf-8")
        note = MemoryNote.from_markdown(text, str(file_path))
        note.backlinks = self._find_backlinks(note.title)
        return note
    
    def get_all_notes(self) -> list[MemoryNote]:
        """Get all notes in the vault."""
        notes = []
        for md_file in self.wiki_dir.rglob("*.md"):
            text = md_file.read_text(encoding="utf-8")
            note = MemoryNote.from_markdown(text, str(md_file))
            notes.append(note)
        
        # Populate backlinks
        for note in notes:
            note.backlinks = self._find_backlinks(note.title)
        
        return notes
    
    def get_raw_sources(self, status: str | None = None) -> list[Path]:
        """Get all raw source files.
        
        Args:
            status: Filter by status (unprocessed, processing, compiled)
            
        Returns:
            List of file paths
        """
        sources = []
        for md_file in self.raw_dir.rglob("*.md"):
            if status:
                text = md_file.read_text(encoding="utf-8")
                # Quick check for status in frontmatter
                if f"status: {status}" in text[:500]:
                    sources.append(md_file)
            else:
                sources.append(md_file)
        return sources
    
    def _find_backlinks(self, title: str) -> list[str]:
        """Find all notes that link to this title."""
        backlinks = []
        search_pattern = f"[[{title}]]"
        
        for md_file in self.wiki_dir.rglob("*.md"):
            text = md_file.read_text(encoding="utf-8")
            if search_pattern in text:
                # Get the title of this note
                note = MemoryNote.from_markdown(text, str(md_file))
                if note.title != title:
                    backlinks.append(note.title)
        
        return backlinks
    
    def _rebuild_index(self):
        """Rebuild the index file (Obsidian graph)."""
        index_path = self.wiki_dir / "README.md"
        
        notes = []
        for md_file in self.wiki_dir.rglob("*.md"):
            if md_file.name == "README.md":
                continue
            text = md_file.read_text(encoding="utf-8")
            note = MemoryNote.from_markdown(text, str(md_file))
            notes.append(note)
        
        # Build index content
        lines = [
            "# Knowledge Wiki Index",
            "",
            f"Total articles: {len(notes)}",
            f"Last updated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            "",
            "## All Articles",
            "",
        ]
        
        # Group by folder
        by_folder: dict[str, list[MemoryNote]] = {}
        for note in notes:
            folder = note.folder or "Uncategorized"
            by_folder.setdefault(folder, []).append(note)
        
        for folder, folder_notes in sorted(by_folder.items()):
            lines.append(f"### {folder}")
            lines.append("")
            for note in sorted(folder_notes, key=lambda n: n.title):
                tags_str = " " + " ".join([f"#{t}" for t in note.tags]) if note.tags else ""
                lines.append(f"- [[{note.title}]]{tags_str}")
                if note.metadata.get("description"):
                    lines.append(f"  - {note.metadata['description']}")
            lines.append("")
        
        # Add tag index
        all_tags: dict[str, list[str]] = {}
        for note in notes:
            for tag in note.tags:
                all_tags.setdefault(tag, []).append(note.title)
        
        if all_tags:
            lines.extend([
                "## Tags",
                "",
            ])
            for tag, tagged_notes in sorted(all_tags.items()):
                lines.append(f"- #{tag}: {len(tagged_notes)} articles")
            lines.append("")
        
        index_path.write_text("\n".join(lines), encoding="utf-8")
    
    def create_daily_note(self) -> Path:
        """Create a daily note for today (common Obsidian pattern)."""
        today = datetime.now()
        title = today.strftime("%Y-%m-%d")
        
        # Create or get daily folder
        daily_dir = self.wiki_dir / "Daily"
        daily_dir.mkdir(parents=True, exist_ok=True)
        
        file_path = daily_dir / f"{title}.md"
        
        if not file_path.exists():
            content = f"""# {title}

## Morning Thoughts

## Research Notes

## Links Created Today

## Tasks

"""
            file_path.write_text(content, encoding="utf-8")
        
        return file_path
    
    def get_knowledge_graph(self) -> dict:
        """Get the knowledge graph as nodes and edges for visualization.
        
        Returns:
            Dict with 'nodes' and 'edges' for visualization
        """
        notes = self.get_all_notes()
        
        nodes = []
        edges = []
        
        note_titles = {n.title for n in notes}
        
        for note in notes:
            node = {
                "id": note.title,
                "title": note.title,
                "tags": note.tags,
                "folder": note.folder,
            }
            nodes.append(node)
            
            # Find outgoing links
            wikilinks = re.findall(r'\[\[([^\]]+)\]\]', note.content)
            for link in wikilinks:
                # Link might have alias: [[Title|Alias]]
                link_title = link.split("|")[0].strip()
                if link_title in note_titles:
                    edges.append({
                        "source": note.title,
                        "target": link_title,
                    })
        
        return {"nodes": nodes, "edges": edges}
    
    def search(self, query: str) -> list[MemoryNote]:
        """Search notes by title, content, or tags."""
        results = []
        query_lower = query.lower()
        
        for md_file in self.wiki_dir.rglob("*.md"):
            text = md_file.read_text(encoding="utf-8").lower()
            note = MemoryNote.from_markdown(text, str(md_file))
            
            # Check in title, content, and tags
            if (query_lower in note.title.lower() or 
                query_lower in note.content.lower() or
                any(query_lower in tag.lower() for tag in note.tags)):
                results.append(note)
        
        return results
    
    def compile_raw_to_wiki(self, ai_processor: callable) -> list[Path]:
        """Compile raw sources into wiki articles using an AI processor.
        
        Args:
            ai_processor: Function that takes raw content and returns wiki article
            
        Returns:
            List of created wiki file paths
        """
        created = []
        
        for raw_file in self.get_raw_sources(status="unprocessed"):
            text = raw_file.read_text(encoding="utf-8")
            
            # Parse the raw note
            raw_note = MemoryNote.from_markdown(text, str(raw_file))
            
            # Process with AI
            wiki_content = ai_processor(raw_note.content, raw_note.title)
            
            # Save to wiki
            wiki_path = self.save_note(
                title=raw_note.title,
                content=wiki_content,
                tags=raw_note.tags,
                metadata={
                    "compiled_from": str(raw_file),
                    "source_url": raw_note.metadata.get("source_url", ""),
                }
            )
            created.append(wiki_path)
            
            # Update raw file status
            new_text = text.replace("status: unprocessed", "status: compiled")
            raw_file.write_text(new_text, encoding="utf-8")
        
        return created
