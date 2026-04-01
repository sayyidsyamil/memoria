from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request as FastAPIRequest
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import OpenAI
import os
import json
import time
from .utils.prompt import ClientMessage, convert_to_openai_messages
from .utils.stream import patch_response_with_headers, stream_text
from .utils.tools import AVAILABLE_TOOLS, TOOL_DEFINITIONS
from .ingest import ingest_youtube_video, IngestRequest, IngestResponse
from .database import (
    init_database, get_pending_sources, get_source, approve_source_extraction,
    skip_source_extraction, create_entity, create_relationship,
    get_all_entities, get_all_relationships, get_entity_by_name, DB_PATH
)
from .extraction import find_duplicate_entities

# Import new self-improvement tools
from .tools.memory import memory_tool, MEMORY_SCHEMA, get_memory_store
from .tools.skill_manager import skill_manage, SKILL_MANAGE_SCHEMA
from .tools.session_search import session_search, SESSION_SEARCH_SCHEMA, get_session_store, Session, Message

load_dotenv(".env")

app = FastAPI()

# Enable CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Request(BaseModel):
    messages: List[ClientMessage]


FIREWORKS_API_KEY = os.getenv("FIREWORKS_API_KEY")
FIREWORKS_BASE_URL = os.getenv("FIREWORKS_BASE_URL", "https://api.fireworks.ai/inference/v1")
FIREWORKS_MODEL = os.getenv("FIREWORKS_MODEL", "accounts/fireworks/routers/kimi-k2p5-turbo")


# =============================================================================
# Self-Improvement Guidance (inspired by hermes-agent)
# =============================================================================

SELF_IMPROVEMENT_GUIDANCE = """
## Self-Improvement System

You are Memoria, a self-improving AI assistant. You have access to tools that let you learn and remember:

### MEMORY TOOL (memory)
Save durable facts that persist across sessions:
- Use target="user" for: user preferences, name, role, communication style
- Use target="memory" for: environment facts, tool quirks, project conventions

WHEN TO SAVE:
- User corrects you or says "remember this"
- User shares personal details or preferences
- You discover environment facts (OS, tools, project structure)
- You learn conventions or workflows specific to this user

### SKILL MANAGER (skill_manage)
Create reusable procedures for recurring tasks:
- Actions: create, edit, patch, delete, write_file, remove_file, list, view
- Skills are stored in ~/.memoria/skills/

WHEN TO CREATE A SKILL:
- After completing a complex task (5+ tool calls)
- After fixing a tricky error or discovering a non-trivial workflow
- User asks you to remember a procedure

SKILL FORMAT (SKILL.md):
```yaml
---
name: skill-name
description: Brief description
version: 1.0.0
---
# Instructions here
```

### SESSION SEARCH (session_search)
Search your long-term memory of past conversations:
- Use to recall previous work, solutions, discussions
- Call with no query to see recent sessions
- Call with keywords to search specific topics

PROACTIVE BEHAVIOR:
- Always save valuable discoveries to memory or skills
- Don't wait to be asked to remember things
- Search past sessions when user references previous work
- Patch skills immediately when you find they're outdated during use

Your goal: Get better at helping THIS specific user over time by accumulating knowledge.
"""


def build_system_prompt() -> str:
    """Build system prompt with memory injection."""
    base_prompt = """You are Memoria, an intelligent AI assistant with a knowledge graph memory system.

You help users by:
1. Answering questions using your knowledge
2. Searching the knowledge graph for relevant information
3. Ingesting new content from YouTube videos
4. Learning from interactions and improving over time

You have access to tools for:
- memory: Save facts about user/environment
- skill_manage: Create reusable procedures
- session_search: Search past conversations
- search_knowledge: Query the knowledge graph
- ingest: Add new content from YouTube

After complex tasks (5+ tool calls), consider saving the approach as a skill.
When you discover facts about the user or environment, save them to memory.
When a user references past work, search your session history."""

    # Inject memory into system prompt
    memory_store = get_memory_store()
    memory_block = memory_store.format_for_system_prompt()
    
    if memory_block:
        return f"{base_prompt}\n\n{SELF_IMPROVEMENT_GUIDANCE}\n\n{memory_block}"
    
    return f"{base_prompt}\n\n{SELF_IMPROVEMENT_GUIDANCE}"


# Extended tool definitions with new self-improvement tools
EXTENDED_TOOL_DEFINITIONS = TOOL_DEFINITIONS + [
    MEMORY_SCHEMA,
    SKILL_MANAGE_SCHEMA,
    SESSION_SEARCH_SCHEMA,
]


# =============================================================================
# Session Management for Self-Improvement
# =============================================================================

# Track current session for saving conversations
_current_session_id: Optional[str] = None
_current_session_title: Optional[str] = None
_message_count: int = 0


def ensure_session():
    """Ensure we have a session for tracking."""
    global _current_session_id, _current_session_title, _message_count
    if _current_session_id is None:
        _current_session_id = f"session_{int(time.time())}"
        _current_session_title = "New Conversation"
        _message_count = 0


def save_message_to_session(role: str, content: str, tool_name: str = None):
    """Save a message to the current session."""
    global _message_count
    ensure_session()
    
    store = get_session_store()
    
    # Save or update session
    session = store.get_session(_current_session_id)
    if not session:
        store.save_session(Session(
            id=_current_session_id,
            title=_current_session_title or "Conversation",
            source="api",
            started_at=time.time(),
            last_active=time.time(),
            message_count=0,
            preview=content[:100] if content else "",
        ))
    else:
        # Update session
        store.save_session(Session(
            id=_current_session_id,
            title=session.title,
            source=session.source,
            started_at=session.started_at,
            last_active=time.time(),
            message_count=session.message_count + 1,
            preview=session.preview if session.preview else (content[:100] if content else ""),
        ))
    
    # Save message
    store.save_message(Message(
        id=0,  # Auto-generated
        session_id=_current_session_id,
        role=role,
        content=content or "",
        tool_name=tool_name,
        timestamp=time.time(),
    ))
    
    _message_count += 1


# =============================================================================
# Chat Endpoint with Self-Improvement
# =============================================================================

@app.post("/api/chat")
async def handle_chat_data(request: Request, protocol: str = Query('data')):
    messages = request.messages
    
    # Save user messages to session
    for msg in messages:
        if msg.role == "user" and msg.content:
            save_message_to_session("user", msg.content)
    
    # Convert and inject system prompt with memory
    openai_messages = convert_to_openai_messages(messages)
    system_prompt = build_system_prompt()
    
    # Insert system message at the beginning
    openai_messages.insert(0, {
        "role": "system",
        "content": system_prompt
    })
    
    client = OpenAI(api_key=FIREWORKS_API_KEY, base_url=FIREWORKS_BASE_URL)
    
    response = StreamingResponse(
        stream_text(client, openai_messages, EXTENDED_TOOL_DEFINITIONS, AVAILABLE_TOOLS, protocol, FIREWORKS_MODEL),
        media_type="text/event-stream",
    )
    return patch_response_with_headers(response, protocol)


# =============================================================================
# Tool Execution Endpoint
# =============================================================================

class ToolRequest(BaseModel):
    tool_name: str
    arguments: Dict[str, Any]


@app.post("/api/tools/execute")
async def execute_tool(request: ToolRequest):
    """Execute a tool and return results."""
    tool_name = request.tool_name
    args = request.arguments
    
    result = None
    
    if tool_name == "memory":
        result = memory_tool(
            action=args.get("action"),
            target=args.get("target", "memory"),
            content=args.get("content"),
            old_text=args.get("old_text"),
        )
    
    elif tool_name == "skill_manage":
        result = skill_manage(
            action=args.get("action"),
            name=args.get("name"),
            content=args.get("content"),
            category=args.get("category"),
            file_path=args.get("file_path"),
            file_content=args.get("file_content"),
            old_string=args.get("old_string"),
            new_string=args.get("new_string"),
            replace_all=args.get("replace_all", False),
        )
    
    elif tool_name == "session_search":
        result = session_search(
            query=args.get("query"),
            role_filter=args.get("role_filter"),
            limit=args.get("limit", 3),
            current_session_id=_current_session_id,
        )
    
    else:
        return {"success": False, "error": f"Unknown tool: {tool_name}"}
    
    # Save tool execution to session
    save_message_to_session(
        role="assistant",
        content=f"Used tool: {tool_name}",
        tool_name=tool_name
    )
    
    return result


# =============================================================================
# Tool List Endpoint
# =============================================================================

@app.get("/api/tools")
async def list_tools():
    """List available tools and their schemas."""
    return {
        "tools": [
            {
                "name": "memory",
                "description": MEMORY_SCHEMA["description"][:200] + "...",
                "schema": MEMORY_SCHEMA,
            },
            {
                "name": "skill_manage",
                "description": SKILL_MANAGE_SCHEMA["description"][:200] + "...",
                "schema": SKILL_MANAGE_SCHEMA,
            },
            {
                "name": "session_search",
                "description": SESSION_SEARCH_SCHEMA["description"][:200] + "...",
                "schema": SESSION_SEARCH_SCHEMA,
            },
        ]
    }


# =============================================================================
# Memory Endpoints
# =============================================================================

@app.get("/api/memory")
async def get_memory():
    """Get current memory contents."""
    store = get_memory_store()
    return {
        "memory": store.read("memory"),
        "user": store.read("user"),
        "system_prompt_injection": store.format_for_system_prompt(),
    }


# =============================================================================
# Skills Endpoints
# =============================================================================

@app.get("/api/skills")
async def list_skills():
    """List all saved skills."""
    result = skill_manage(action="list")
    return result


@app.get("/api/skills/{skill_name}")
async def view_skill(skill_name: str):
    """View a specific skill."""
    result = skill_manage(action="view", name=skill_name)
    return result


# =============================================================================
# Session Endpoints
# =============================================================================

@app.get("/api/sessions/recent")
async def get_recent_sessions(limit: int = 10):
    """Get recent sessions."""
    store = get_session_store()
    sessions = store.list_recent_sessions(limit=limit)
    return {
        "sessions": [
            {
                "id": s.id,
                "title": s.title,
                "source": s.source,
                "started_at": s.started_at,
                "message_count": s.message_count,
                "preview": s.preview,
            }
            for s in sessions
        ]
    }


@app.post("/api/sessions/search")
async def search_sessions(query: str = None, limit: int = 3):
    """Search past sessions."""
    result = session_search(
        query=query,
        limit=limit,
        current_session_id=_current_session_id,
    )
    return result


# =============================================================================
# Ingest Endpoints
# =============================================================================

@app.post("/api/ingest")
async def handle_ingest(request: IngestRequest) -> IngestResponse:
    """Ingest a YouTube video: download audio, apply VAD, transcribe with Whisper V3 Turbo."""
    return ingest_youtube_video(request.url)


# =============================================================================
# Graph API Endpoints
# =============================================================================

@app.get("/api/graph/pending")
async def get_pending_extractions():
    """Get all sources with pending extractions."""
    init_database()
    sources = get_pending_sources()
    return {
        "sources": [
            {
                "id": s.id,
                "url": s.url,
                "title": s.title,
                "duration_seconds": s.duration_seconds,
                "word_count": s.word_count,
                "created_at": s.created_at,
                "entity_count": len(s.proposed_entities),
                "relationship_count": len(s.proposed_relationships)
            }
            for s in sources
        ]
    }


@app.get("/api/sources/{source_id}")
async def get_source_details(source_id: int):
    """Get full source details including proposed entities/relationships."""
    init_database()
    source = get_source(source_id)
    if not source:
        return {"error": "Source not found"}, 404
    
    # Check for duplicates with existing entities
    existing_entities = get_all_entities()
    duplicates = find_duplicate_entities(
        source.proposed_entities,
        [{"name": e.name, "type": e.type} for e in existing_entities]
    )
    
    return {
        "id": source.id,
        "url": source.url,
        "title": source.title,
        "transcript_preview": source.transcript[:500] + "..." if len(source.transcript) > 500 else source.transcript,
        "duration_seconds": source.duration_seconds,
        "word_count": source.word_count,
        "extraction_status": source.extraction_status,
        "created_at": source.created_at,
        "proposed_entities": source.proposed_entities,
        "proposed_relationships": source.proposed_relationships,
        "duplicates": duplicates,
        "quality_score": calculate_quality_score(source.proposed_entities, source.proposed_relationships)
    }


def calculate_quality_score(entities: List[Dict], relationships: List[Dict]) -> float:
    """Calculate overall extraction quality score."""
    if not entities:
        return 0.0
    
    entity_confidences = [e.get("confidence", 0.5) for e in entities]
    avg_entity_conf = sum(entity_confidences) / len(entity_confidences)
    
    if relationships:
        rel_confidences = [r.get("confidence", 0.5) for r in relationships]
        avg_rel_conf = sum(rel_confidences) / len(rel_confidences)
    else:
        avg_rel_conf = 0.0
    
    return round(avg_entity_conf * 0.6 + avg_rel_conf * 0.4, 2)


class ApproveRequest(BaseModel):
    entity_ids: List[str]
    relationship_ids: List[str]
    entity_edits: dict = {}
    merge_map: dict = {}


@app.post("/api/sources/{source_id}/approve")
async def approve_extraction(source_id: int, request: ApproveRequest):
    """Approve and add selected entities/relationships to the graph."""
    init_database()
    source = get_source(source_id)
    if not source:
        return {"error": "Source not found"}, 404
    
    created_entities = {}
    created_relationships = []
    
    # Create entities
    for entity in source.proposed_entities:
        entity_id = entity["id"]
        
        # Check if we should merge with existing
        if entity["name"] in request.merge_map:
            existing_name = request.merge_map[entity["name"]]
            existing = get_entity_by_name(existing_name)
            if existing:
                created_entities[entity_id] = existing.id
                continue
        
        # Check if entity is in approve list
        if entity_id in request.entity_ids:
            name = request.entity_edits.get(entity_id, {}).get("name", entity["name"])
            entity_type = request.entity_edits.get(entity_id, {}).get("type", entity["type"])
            description = request.entity_edits.get(entity_id, {}).get("description", entity.get("description", ""))
            
            new_id = create_entity(name, entity_type, description, source_id)
            created_entities[entity_id] = new_id
    
    # Create relationships
    for rel in source.proposed_relationships:
        rel_id = rel["id"]
        if rel_id in request.relationship_ids:
            source_entity_old_id = rel["source"]
            target_entity_old_id = rel["target"]
            
            if source_entity_old_id in created_entities and target_entity_old_id in created_entities:
                new_rel_id = create_relationship(
                    created_entities[source_entity_old_id],
                    created_entities[target_entity_old_id],
                    rel["type"],
                    rel.get("description", ""),
                    source_id
                )
                created_relationships.append(new_rel_id)
    
    # Mark source as approved
    approve_source_extraction(source_id, [], [])
    
    return {
        "success": True,
        "entities_created": len([e for e in created_entities.values() if e]),
        "relationships_created": len(created_relationships)
    }


@app.post("/api/sources/{source_id}/skip")
async def skip_extraction(source_id: int):
    """Skip the extraction for this source."""
    init_database()
    skip_source_extraction(source_id)
    return {"success": True}


@app.get("/api/graph/entities")
async def list_entities():
    """Get all entities in the graph."""
    init_database()
    entities = get_all_entities()
    return {
        "entities": [
            {
                "id": e.id,
                "name": e.name,
                "type": e.type,
                "description": e.description,
                "source_ids": e.source_ids
            }
            for e in entities
        ]
    }


@app.get("/api/graph/relationships")
async def list_relationships():
    """Get all relationships in the graph."""
    init_database()
    relationships = get_all_relationships()
    return {
        "relationships": [
            {
                "id": r.id,
                "source_entity_id": r.source_entity_id,
                "target_entity_id": r.target_entity_id,
                "type": r.type,
                "description": r.description,
                "source_ids": r.source_ids
            }
            for r in relationships
        ]
    }
