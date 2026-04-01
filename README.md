# Memoria - Self-Improving AI with Knowledge Graph

Memoria is a self-improving AI assistant that learns from interactions and builds a knowledge graph over time. Inspired by [hermes-agent](https://github.com/jimscard/hermes-agent), it implements persistent memory, reusable skills, and session search.

## Features

### Core AI Features
- **Natural Language Queries**: Ask anything, Memoria uses its knowledge graph to answer
- **YouTube Ingestion**: Download, transcribe (Whisper V3 Turbo), and extract knowledge from videos
- **Knowledge Graph**: Entities, relationships, and sources stored in SQLite
- **Smart Extraction**: AI-powered entity/relationship extraction with confidence scoring

### Self-Improvement System (from hermes-agent)
- **Memory Tool**: Persistent curated memory across sessions
  - `target="user"`: User preferences, name, role, communication style
  - `target="memory"`: Environment facts, tool quirks, project conventions
- **Skill Manager**: Create reusable skills/procedures
  - Store as SKILL.md files in `~/.memoria/skills/`
  - Actions: create, edit, patch, delete, write_file, remove_file, list, view
- **Session Search**: FTS5-based conversation history
  - Search past sessions with keywords
  - List recent conversations

## Terminal Commands

```
/help                    - Show all available commands
/ingest <url>            - Ingest YouTube video and extract knowledge
/memory                  - Show saved memories
/memory add <t> <c>      - Add memory (target: memory/user)
/skills                  - List saved skills
/skill view <name>       - View a skill by name
/sessions                - List recent sessions
/session <query>         - Search past sessions
/clear                   - Clear terminal
```

## API Endpoints

### Chat & Tools
- `POST /api/chat` - Chat with AI (streaming response)
- `POST /api/tools/execute` - Execute a tool (memory, skill_manage, session_search)
- `GET /api/tools` - List available tools

### Memory
- `GET /api/memory` - Get current memory contents

### Skills
- `GET /api/skills` - List all skills
- `GET /api/skills/{name}` - View specific skill

### Sessions
- `GET /api/sessions/recent` - List recent sessions
- `POST /api/sessions/search` - Search past sessions

### Knowledge Graph
- `GET /api/graph/pending` - List pending extractions
- `GET /api/sources/{id}` - Get source details
- `POST /api/sources/{id}/approve` - Approve extraction
- `GET /api/graph/entities` - List entities
- `GET /api/graph/relationships` - List relationships

## How Self-Improvement Works

### 1. Memory Persistence
The AI saves important discoveries to persistent memory:
```
/memory add user "User prefers TypeScript over JavaScript"
/memory add memory "Always use atomic writes for file operations"
```

These are injected into the system prompt on every conversation.

### 2. Skill Creation
After complex tasks, the AI can save the approach as a reusable skill:
```
/skill create nextjs-deploy
```

Skills are stored as SKILL.md files:
```yaml
---
name: nextjs-deploy
description: Deploy Next.js to Vercel
description: Deploy Next.js to Vercel
---
# Steps
1. Run `vercel --version` to check CLI
2. Run `vercel` in project root
3. Follow prompts

# Pitfalls
- Ensure vercel.json is configured
- Check environment variables in dashboard
```

### 3. Session Search
Recall past conversations:
```
/session "docker deployment"
/sessions           # List recent
```

## Project Structure

```
memoria/
├── api/
│   ├── index.py              # FastAPI app with self-improvement endpoints
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── memory.py         # Memory tool (hermes-agent style)
│   │   ├── skill_manager.py  # Skill management
│   │   └── session_search.py # Session history with FTS5
│   ├── utils/
│   │   ├── tools.py          # Tool registry
│   │   ├── prompt.py         # Message conversion
│   │   └── stream.py         # Streaming response
│   ├── database.py           # Knowledge graph storage
│   ├── extraction_v2.py      # Smart AI extraction
│   └── ingest.py             # YouTube ingestion
├── components/
│   ├── terminal.tsx          # Terminal UI with commands
│   └── knowledge-graph.tsx   # Graph visualization
└── app/
    ├── page.tsx              # Main terminal view
    └── graph/page.tsx        # Knowledge graph view
```

## Data Storage

All persistent data is stored in `~/.memoria/`:
```
~/.memoria/
├── memories/
│   ├── MEMORY.md            # Agent's notes
│   └── USER.md               # User profile
├── skills/
│   └── {category}/
│       └── {skill-name}/
│           ├── SKILL.md
│           ├── references/
│           ├── templates/
│           ├── scripts/
│           └── assets/
├── memoria.db               # Knowledge graph
└── memoria_sessions.db      # Conversation history
```

## Environment Variables

```env
FIREWORKS_API_KEY=your_api_key
FIREWORKS_BASE_URL=https://api.fireworks.ai/inference/v1
FIREWORKS_MODEL=accounts/fireworks/routers/kimi-k2p5-turbo
WHISPER_MODEL=whisper-v3-turbo
AUDIO_API_BASE_URL=https://audio-turbo.api.fireworks.ai/v1
```

## Running Locally

```bash
# Backend
cd api
uvicorn index:app --reload --port 8000

# Frontend
cd memoria
pnpm dev
```

## Inspiration

This project implements the self-improvement architecture from [hermes-agent](https://github.com/jimscard/hermes-agent), adapted for Memoria's knowledge graph system.

Key hermes-agent concepts implemented:
- **Procedural memory** via skills (SKILL.md)
- **Declarative memory** via MEMORY.md/USER.md
- **Episodic memory** via FTS5 session search
- **Self-improvement guidance** in system prompts
