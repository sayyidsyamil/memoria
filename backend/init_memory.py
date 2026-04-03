"""Initialize Memoria memory structure with sample data.

This script creates a well-organized memory vault with:
- Folder structure (concepts/, daily/, sources/, projects/, logs/)
- Sample memories demonstrating wikilinks, frontmatter, and content types
- README.md as an index

Usage:
    python init_memory.py [vault_path]
    
Defaults to ~/.brain/memory/ for user scope.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path

# Sample memories to populate the vault
SAMPLE_MEMORIES = {
    "concepts": [
        {
            "name": "Memory_System_Design.md",
            "content": """---
name: Memory System Design
description: Architecture for organizing AI-accessible knowledge
type: concept
created: {date}
tags: [architecture, memory, design]
---

# Memory System Design

## Principles

1. **Flat structure** - Folders are optional, links matter more
2. **Everything is markdown** - Human-readable, portable, editable
3. **Wikilinks connect ideas** - `[[Related Concept]]` creates graph
4. **Frontmatter for metadata** - YAML properties for filtering
5. **Daily notes as entry point** - Temporal organization

## Structure

```
memory/
├── README.md          # Index + graph overview
├── daily/            # Journal entries
├── concepts/         # Evergreen notes
├── sources/          # Books, articles, papers
├── projects/         # Active work
└── logs/            # Activity, decisions
```

## Related
- [[Daily Notes Pattern]]
- [[Wikilinks vs Tags]]
- [[Karpathy Knowledge Base]]""",
        },
        {
            "name": "Daily_Notes_Pattern.md",
            "content": """---
name: Daily Notes Pattern
description: Using dated entries as knowledge entry points
type: pattern
created: {date}
tags: [workflow, daily, journal]
---

# Daily Notes Pattern

## Purpose

Use daily notes as:
- Entry point to knowledge
- Capture fleeting thoughts
- Link to permanent notes

## Format

```markdown
# YYYY-MM-DD

## Morning

## Research
- [[Topic Name]]

## Decisions

## Links Created
```

## Workflow

1. Open today's note
2. Write freely
3. Link important ideas to concept notes
4. Review weekly for consolidation

## Benefits

- No pressure to organize immediately
- Natural chronology
- Easy to find "what was I thinking"

## Related
- [[Memory System Design]]
- [[Zettelkasten Method]]""",
        },
        {
            "name": "Karpathy_Knowledge_Base.md",
            "content": """---
name: Karpathy Knowledge Base
description: Andrej Karpathy's LLM-powered knowledge workflow
type: reference
created: {date}
tags: [ai, workflow, reference]
---

# Karpathy Knowledge Base

## Workflow

1. **Data Ingest** - Index sources into `raw/`
2. **AI Compilation** - LLM compiles into wiki
3. **Obsidian IDE** - View and navigate
4. **Q&A** - Ask questions against wiki
5. **Output** - Render as markdown/slides
6. **Filing** - Outputs go back into wiki

## Key Insights

> "Your curiosity literally compounds. Every question you ask today makes tomorrow's answers better."

- Raw data → compiled wiki → Q&A → enhance wiki
- LLM maintains all data, user rarely edits directly
- Index files auto-maintained for RAG-style queries
- No need for fancy RAG at small scale (~100 articles)

## Tools

- Obsidian Web Clipper for articles
- Local images downloaded for LLM reference
- Marp for slide output
- Matplotlib for visualizations

## Related
- [[Memory System Design]]
- [[Obsidian Integration]]""",
        },
        {
            "name": "Wikilinks_vs_Tags.md",
            "content": """---
name: Wikilinks vs Tags
description: When to use wikilinks, tags, or folders
type: concept
created: {date}
tags: [organization, links, tags]
---

# Wikilinks vs Tags

## Wikilinks `[[Note]]`

**Use for:**
- Specific connections between ideas
- Building knowledge graph
- Discovering related concepts

**Example:**
```markdown
This uses [[Memory System Design]] principles.
```

## Tags `#concept`

**Use for:**
- Broad categorization
- Status tracking (#inbox, #draft)
- Type classification (#book, #person)

**Example:**
```markdown
#concept #architecture #draft
```

## Folders

**Use for:**
- Separation of concerns (daily vs permanent)
- Access control (shared vs private)
- Archive (old projects)

## The Rule

1. Start with wikilinks (most valuable)
2. Add tags when filtering needed
3. Use folders for structural separation

## Related
- [[Memory System Design]]
- [[Daily Notes Pattern]]""",
        },
    ],
    
    "daily": [
        {
            "name": "{date}.md",
            "content": """---
name: '{date}'
description: Daily entry for {date}
type: daily
created: {date}
tags: [daily, journal]
---

# {date}

## Morning Thoughts

Setting up memory system for Memoria project. Goal: make AI knowledge persistent and navigable.

## Research

Reading about [[Karpathy Knowledge Base]] workflow. Key insight: LLM maintains wiki, human just queries.

Also exploring [[Memory System Design]] - flat structure with wikilinks beats deep hierarchies.

## Decisions

1. Keep it simple: markdown + wikilinks + frontmatter
2. No complex database, just files
3. Build mini-Obsidian viewer in Memoria UI
4. Support both terminal and GUI workflows

## Links Created

- [[Memory System Design]]
- [[Daily Notes Pattern]]  
- [[Karpathy Knowledge Base]]
- [[Wikilinks vs Tags]]

## Tasks

- [x] Create folder structure
- [x] Write sample memories
- [ ] Build memory viewer UI
- [ ] Add wikilink navigation
- [ ] Test graph visualization""",
        },
    ],
    
    "sources": [
        {
            "name": "Obsidian_Documentation.md",
            "content": """---
name: Obsidian Documentation
description: Official Obsidian help and reference
type: source
source_url: https://docs.obsidian.md/
created: {date}
tags: [source, obsidian, documentation]
---

# Obsidian Documentation

## Key Concepts

**Obsidian Flavored Markdown**
- Wikilinks: `[[Page Title]]`
- Embeds: `![[embedded.png]]`
- Callouts: `> [!info]`
- Properties: YAML frontmatter

**Core Plugins**
- Graph view
- Backlinks
- Tag pane
- Outline
- Daily notes

**File Organization**
- Vault = folder of markdown files
- Portable, no lock-in
- Works with any text editor

## Integration

Obsidian can be extended via:
- Community plugins
- Themes
- CSS snippets
- API for plugin developers

## Related
- [[Memory System Design]]
- [[Obsidian Integration]]""",
        },
    ],
    
    "projects": [
        {
            "name": "Memoria_Memory_System.md",
            "content": """---
name: Memoria Memory System
description: Building Obsidian-style memory viewer in Memoria
type: project
created: {date}
status: active
tags: [project, memoria, active]
---

# Memoria Memory System

## Goal

Build a lightweight, Obsidian-inspired memory system within Memoria:
- Simple markdown files
- Wikilinks for connections
- Minimal UI (text-focused)
- Terminal + GUI workflows

## Components

### Backend
- `memory/store.py` - File operations
- `memory/scan.py` - Indexing and freshness
- `obsidian.py` - Vault management
- `brain/chat.py` - `/memory` command

### Frontend
- `memory-viewer.tsx` - Markdown renderer
- `page.tsx` - Center floating navbar
- `/api/memory` - Memory API endpoints

## Decisions

**Why not full Obsidian integration?**
- Obsidian is desktop-only
- We want web-based access
- Simpler = more maintainable

**Why wikilinks over tags?**
- Links create graph structure
- More meaningful than tags
- Matches how we think (associative)

## Progress

- [x] Backend memory storage
- [x] /memory command in REPL
- [x] Sample data creation
- [ ] Memory viewer UI
- [ ] Wikilink navigation
- [ ] Graph visualization

## Related
- [[Memory System Design]]
- [[Karpathy Knowledge Base]]
- [[Daily Notes Pattern]]""",
        },
    ],
    
    "logs": [
        {
            "name": "Setup_Log.md",
            "content": """---
name: Setup Log
description: Log of memory system initialization
type: log
created: {date}
tags: [log, setup]
---

# Setup Log

## {date}

Created initial memory structure:

```
~/.brain/memory/
├── README.md
├── concepts/
│   ├── Memory_System_Design.md
│   ├── Daily_Notes_Pattern.md
│   ├── Karpathy_Knowledge_Base.md
│   └── Wikilinks_vs_Tags.md
├── daily/
│   └── {date}.md
├── sources/
│   └── Obsidian_Documentation.md
├── projects/
│   └── Memoria_Memory_System.md
└── logs/
    └── Setup_Log.md
```

Total: 9 memory files created

## Design Decisions

1. **Flat over hierarchical** - Concepts don't nest, they link
2. **Daily as journal** - Chronological entry point
3. **Projects for active work** - Cross-reference to concepts
4. **Sources for external refs** - Books, articles, docs
5. **Logs for decisions** - Why we did what we did
6. **Connected for insights** - AI-discovered connections between notes

## Next Steps

- Build memory viewer UI
- Add wikilink click handlers
- Create graph visualization
- Test search functionality
- Use `/connect` to discover connections""",
        },
    ],
}


# Sample connection to populate connected/ folder
CONNECTED_TEMPLATE = {
    "name": "Connection_Example.md",
    "content": """---
name: Connection Example
description: Sample AI-discovered connection between notes
type: connection
created: {date}
tags: [connection, example]
source_memories: ["Memory System Design", "Karpathy Knowledge Base"]
---

# Connection: Flat Structure + LLM Maintenance

## Connected Notes
[[Memory System Design]] + [[Karpathy Knowledge Base]]

## The Connection

Both approaches share a core philosophy: **reduce human organizational burden**.

**Memory System Design** advocates for flat structures where links matter more than folders.

**Karpathy Knowledge Base** demonstrates that LLMs can maintain this structure automatically.

## Synthesized Insight

The real power emerges when flat structure meets AI maintenance:
- Humans don't need to decide "which folder?"
- LLMs create connections as they discover them
- Knowledge graph grows organically
- Querying becomes exploration

## Practical Application

When building Memoria's memory system:
1. Use simple folders (concepts/, daily/, sources/)
2. Let LLM suggest links via `/connect` command
3. Review AI-discovered connections
4. The system becomes self-organizing

## Created By
Generated by `/connect` command as a demonstration of connection discovery.""",
}

def create_readme(vault_path: Path, stats: dict) -> None:
    """Create README.md as an index of the vault."""
    readme = f"""# Memory Vault

Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}

## Statistics

| Folder | Count |
|--------|-------|
"""
    total = 0
    for folder, count in sorted(stats.items()):
        readme += f"| {folder}/ | {count} |\n"
        total += count
    
    readme += f"| **Total** | **{total}** |\n\n"
    
    readme += """## Quick Links

### Concepts
- [[Memory System Design]]
- [[Daily Notes Pattern]]
- [[Karpathy Knowledge Base]]

### Active Projects
- [[Memoria Memory System]]

### Today
- [[""" + datetime.now().strftime('%Y-%m-%d') + """]]

## How to Use

1. **Create** - AI saves memories via MemorySave tool
2. **Browse** - Use memory viewer in Memoria UI
3. **Search** - Full-text search across all memories
4. **Navigate** - Click wikilinks to explore connections
5. **Edit** - Direct file editing in `~/.brain/memory/`

## Structure

```
concepts/   - Evergreen knowledge
daily/      - Dated entries
sources/    - External references
projects/   - Active work
logs/       - Decision records
connected/  - AI-discovered connections
```

## Commands

- `/memory` - Search and browse all memories
- `/connect` - Find connections between notes
- `/ingest <url>` - Import YouTube/PDF content

"""
    
    readme_path = vault_path / "README.md"
    readme_path.write_text(readme, encoding="utf-8")
    print(f"  Created: {readme_path}")


def init_memory_vault(vault_path: Path | None = None) -> None:
    """Initialize the memory vault with sample data."""
    
    # Default to knowledge/memory in project root
    if vault_path is None:
        # Find project root (where this script lives is backend/, so go up one level)
        script_dir = Path(__file__).parent
        project_root = script_dir.parent
        vault_path = project_root / "knowledge" / "memory"
    
    print(f"\nInitializing memory vault at: {vault_path}")
    print("=" * 60)
    
    # Create directories
    folders = ["concepts", "daily", "sources", "projects", "logs", "connected"]
    stats = {}
    
    for folder in folders:
        folder_path = vault_path / folder
        folder_path.mkdir(parents=True, exist_ok=True)
        
        # Create sample files for this folder
        count = 0
        if folder in SAMPLE_MEMORIES:
            today = datetime.now().strftime('%Y-%m-%d')
            
            for template in SAMPLE_MEMORIES[folder]:
                # Replace {date} placeholder
                content = template["content"].format(date=today)
                filename = template["name"].format(date=today)
                
                file_path = folder_path / filename
                file_path.write_text(content, encoding="utf-8")
                count += 1
                print(f"  Created: {folder}/{filename}")
        
        stats[folder] = count
    
    # Create README index
    create_readme(vault_path, stats)
    
    # Create sample connection note in connected/ folder
    connected_folder = vault_path / "connected"
    connected_folder.mkdir(parents=True, exist_ok=True)
    today = datetime.now().strftime('%Y-%m-%d')
    conn_content = CONNECTED_TEMPLATE["content"].format(date=today)
    conn_path = connected_folder / CONNECTED_TEMPLATE["name"]
    conn_path.write_text(conn_content, encoding="utf-8")
    stats["connected"] = 1
    print(f"  Created: connected/{CONNECTED_TEMPLATE['name']}")
    
    # Create .gitkeep in empty folders (none should be empty now)
    
    print("\n" + "=" * 60)
    print(f"Memory vault initialized with {sum(stats.values()) + 1} files")
    print(f"\nLocation: {vault_path}")
    print("\nNext steps:")
    print("  1. Open Memoria UI: http://localhost:3000")
    print("  2. Click 'memory' in the navbar")
    print("  3. Browse and click wikilinks to explore")
    print("  4. Use /memory command in terminal to search")


if __name__ == "__main__":
    # Allow custom path from command line
    custom_path = sys.argv[1] if len(sys.argv) > 1 else None
    vault_path = Path(custom_path) if custom_path else None
    
    init_memory_vault(vault_path)
