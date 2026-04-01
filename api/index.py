from typing import List
from pydantic import BaseModel
from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request as FastAPIRequest
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import OpenAI
import os
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
from pydantic import BaseModel
from typing import List, Optional


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


@app.post("/api/chat")
async def handle_chat_data(request: Request, protocol: str = Query('data')):
    messages = request.messages
    openai_messages = convert_to_openai_messages(messages)

    client = OpenAI(api_key=FIREWORKS_API_KEY, base_url=FIREWORKS_BASE_URL)
    response = StreamingResponse(
        stream_text(client, openai_messages, TOOL_DEFINITIONS, AVAILABLE_TOOLS, protocol, FIREWORKS_MODEL),
        media_type="text/event-stream",
    )
    return patch_response_with_headers(response, protocol)


@app.post("/api/ingest")
async def handle_ingest(request: IngestRequest) -> IngestResponse:
    """Ingest a YouTube video: download audio, apply VAD, transcribe with Whisper V3 Turbo."""
    return ingest_youtube_video(request.url)


# Graph API Endpoints

@app.get("/api/graph/pending")
async def get_pending_extractions():
    """Get all sources with pending extractions."""
    init_database(DB_PATH)
    sources = get_pending_sources(DB_PATH)
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
    init_database(DB_PATH)
    source = get_source(DB_PATH, source_id)
    if not source:
        return {"error": "Source not found"}, 404
    
    # Check for duplicates with existing entities
    existing_entities = get_all_entities(DB_PATH)
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
        "duplicates": duplicates
    }


class ApproveRequest(BaseModel):
    entity_ids: List[str]  # IDs of entities to approve (from proposed list)
    relationship_ids: List[str]  # IDs of relationships to approve
    entity_edits: dict = {}  # Optional edits: {entity_id: {name, type, description}}
    merge_map: dict = {}  # Map of proposed entity name -> existing entity name


@app.post("/api/sources/{source_id}/approve")
async def approve_extraction(source_id: int, request: ApproveRequest):
    """Approve and add selected entities/relationships to the graph."""
    init_database(DB_PATH)
    source = get_source(DB_PATH, source_id)
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
            existing = get_entity_by_name(DB_PATH, existing_name)
            if existing:
                created_entities[entity_id] = existing.id
                continue
        
        # Check if entity is in approve list
        if entity_id in request.entity_ids:
            # Apply edits if any
            name = request.entity_edits.get(entity_id, {}).get("name", entity["name"])
            entity_type = request.entity_edits.get(entity_id, {}).get("type", entity["type"])
            description = request.entity_edits.get(entity_id, {}).get("description", entity.get("description", ""))
            
            new_id = create_entity(DB_PATH, name, entity_type, description, source_id)
            created_entities[entity_id] = new_id
    
    # Create relationships
    for rel in source.proposed_relationships:
        rel_id = rel["id"]
        if rel_id in request.relationship_ids:
            source_entity_old_id = rel["source"]
            target_entity_old_id = rel["target"]
            
            # Map to new entity IDs
            if source_entity_old_id in created_entities and target_entity_old_id in created_entities:
                new_rel_id = create_relationship(
                    DB_PATH,
                    created_entities[source_entity_old_id],
                    created_entities[target_entity_old_id],
                    rel["type"],
                    rel.get("description", ""),
                    source_id
                )
                created_relationships.append(new_rel_id)
    
    # Mark source as approved
    approve_source_extraction(DB_PATH, source_id, [], [])
    
    return {
        "success": True,
        "entities_created": len([e for e in created_entities.values() if e]),
        "relationships_created": len(created_relationships)
    }


@app.post("/api/sources/{source_id}/skip")
async def skip_extraction(source_id: int):
    """Skip the extraction for this source."""
    init_database(DB_PATH)
    skip_source_extraction(DB_PATH, source_id)
    return {"success": True}


@app.get("/api/graph/entities")
async def list_entities():
    """Get all entities in the graph."""
    init_database(DB_PATH)
    entities = get_all_entities(DB_PATH)
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
    init_database(DB_PATH)
    relationships = get_all_relationships(DB_PATH)
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
