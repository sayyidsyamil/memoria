"""Database models for Memoria knowledge graph."""

import json
import sqlite3
from datetime import datetime
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, asdict
from enum import Enum


# Database path constant
DB_PATH = "memoria.db"


class ExtractionStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    PARTIAL = "partial"
    SKIPPED = "skipped"


@dataclass
class Source:
    id: int
    url: str
    title: str
    transcript: str
    duration_seconds: float
    word_count: int
    extraction_status: ExtractionStatus
    proposed_entities: List[Dict[str, Any]]
    proposed_relationships: List[Dict[str, Any]]
    created_at: str
    reviewed_at: Optional[str] = None


@dataclass
class Entity:
    id: int
    name: str
    type: str
    description: str
    source_ids: List[int]
    created_at: str
    updated_at: str


@dataclass
class Relationship:
    id: int
    source_entity_id: int
    target_entity_id: int
    type: str
    description: str
    source_ids: List[int]
    created_at: str


def init_database(db_path: str = DB_PATH):
    """Initialize SQLite database with all tables."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Sources table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            title TEXT,
            transcript TEXT,
            duration_seconds REAL,
            word_count INTEGER,
            extraction_status TEXT DEFAULT 'pending',
            proposed_entities TEXT,  -- JSON
            proposed_relationships TEXT,  -- JSON
            created_at TEXT,
            reviewed_at TEXT
        )
    """)
    
    # Entities table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS entities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            type TEXT,
            description TEXT,
            source_ids TEXT,  -- JSON array
            created_at TEXT,
            updated_at TEXT
        )
    """)
    
    # Relationships table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS relationships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_entity_id INTEGER NOT NULL,
            target_entity_id INTEGER NOT NULL,
            type TEXT,
            description TEXT,
            source_ids TEXT,  -- JSON array
            created_at TEXT,
            FOREIGN KEY (source_entity_id) REFERENCES entities(id),
            FOREIGN KEY (target_entity_id) REFERENCES entities(id)
        )
    """)
    
    conn.commit()
    conn.close()


def save_source(
    url: str,
    title: str,
    transcript: str,
    duration_seconds: float,
    word_count: int,
    db_path: str = DB_PATH
) -> int:
    """Save a new source and return its ID."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    now = datetime.utcnow().isoformat()
    
    cursor.execute("""
        INSERT INTO sources (url, title, transcript, duration_seconds, word_count, 
                           extraction_status, proposed_entities, proposed_relationships, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        url, title, transcript, duration_seconds, word_count,
        ExtractionStatus.PENDING.value,
        json.dumps([]),
        json.dumps([]),
        now
    ))
    
    source_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return source_id


def update_source_extraction(
    source_id: int,
    proposed_entities: List[Dict[str, Any]],
    proposed_relationships: List[Dict[str, Any]],
    db_path: str = DB_PATH
):
    """Update source with proposed extraction results."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("""
        UPDATE sources 
        SET proposed_entities = ?, proposed_relationships = ?
        WHERE id = ?
    """, (
        json.dumps(proposed_entities),
        json.dumps(proposed_relationships),
        source_id
    ))
    
    conn.commit()
    conn.close()


def get_source(source_id: int, db_path: str = DB_PATH) -> Optional[Source]:
    """Get a source by ID."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM sources WHERE id = ?", (source_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return None
    
    return Source(
        id=row[0],
        url=row[1],
        title=row[2] or "",
        transcript=row[3] or "",
        duration_seconds=row[4] or 0,
        word_count=row[5] or 0,
        extraction_status=row[6],
        proposed_entities=json.loads(row[7]) if row[7] else [],
        proposed_relationships=json.loads(row[8]) if row[8] else [],
        created_at=row[9],
        reviewed_at=row[10]
    )


def get_pending_sources(db_path: str = DB_PATH) -> List[Source]:
    """Get all sources with pending extractions."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT * FROM sources 
        WHERE extraction_status = 'pending'
        ORDER BY created_at DESC
    """)
    
    rows = cursor.fetchall()
    conn.close()
    
    sources = []
    for row in rows:
        sources.append(Source(
            id=row[0],
            url=row[1],
            title=row[2] or "",
            transcript=row[3] or "",
            duration_seconds=row[4] or 0,
            word_count=row[5] or 0,
            extraction_status=row[6],
            proposed_entities=json.loads(row[7]) if row[7] else [],
            proposed_relationships=json.loads(row[8]) if row[8] else [],
            created_at=row[9],
            reviewed_at=row[10]
        ))
    
    return sources


def approve_source_extraction(
    source_id: int,
    entity_ids: List[int],
    relationship_ids: List[int],
    db_path: str = DB_PATH
) -> bool:
    """Mark source extraction as approved."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    now = datetime.utcnow().isoformat()
    
    cursor.execute("""
        UPDATE sources 
        SET extraction_status = ?, reviewed_at = ?
        WHERE id = ?
    """, (ExtractionStatus.APPROVED.value, now, source_id))
    
    conn.commit()
    conn.close()
    
    return cursor.rowcount > 0


def skip_source_extraction(source_id: int, db_path: str = DB_PATH) -> bool:
    """Mark source extraction as skipped."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    now = datetime.utcnow().isoformat()
    
    cursor.execute("""
        UPDATE sources 
        SET extraction_status = ?, reviewed_at = ?
        WHERE id = ?
    """, (ExtractionStatus.SKIPPED.value, now, source_id))
    
    conn.commit()
    conn.close()
    
    return cursor.rowcount > 0


def create_entity(
    name: str,
    type: str,
    description: str,
    source_id: int,
    db_path: str = DB_PATH
) -> int:
    """Create a new entity and return its ID."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    now = datetime.utcnow().isoformat()
    
    cursor.execute("""
        INSERT INTO entities (name, type, description, source_ids, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        name, type, description, json.dumps([source_id]), now, now
    ))
    
    entity_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return entity_id


def get_entity_by_name(name: str, db_path: str = DB_PATH) -> Optional[Entity]:
    """Get entity by name (for deduplication)."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM entities WHERE name = ?", (name,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return None
    
    return Entity(
        id=row[0],
        name=row[1],
        type=row[2],
        description=row[3],
        source_ids=json.loads(row[4]) if row[4] else [],
        created_at=row[5],
        updated_at=row[6]
    )


def get_all_entities(db_path: str = DB_PATH) -> List[Entity]:
    """Get all entities in the graph."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM entities ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    
    entities = []
    for row in rows:
        entities.append(Entity(
            id=row[0],
            name=row[1],
            type=row[2],
            description=row[3],
            source_ids=json.loads(row[4]) if row[4] else [],
            created_at=row[5],
            updated_at=row[6]
        ))
    
    return entities


def create_relationship(
    source_entity_id: int,
    target_entity_id: int,
    type: str,
    description: str,
    source_id: int,
    db_path: str = DB_PATH
) -> int:
    """Create a new relationship and return its ID."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    now = datetime.utcnow().isoformat()
    
    cursor.execute("""
        INSERT INTO relationships (source_entity_id, target_entity_id, type, description, source_ids, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        source_entity_id, target_entity_id, type, description, json.dumps([source_id]), now
    ))
    
    relationship_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return relationship_id


def get_all_relationships(db_path: str = DB_PATH) -> List[Relationship]:
    """Get all relationships in the graph."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM relationships ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    
    relationships = []
    for row in rows:
        relationships.append(Relationship(
            id=row[0],
            source_entity_id=row[1],
            target_entity_id=row[2],
            type=row[3],
            description=row[4],
            source_ids=json.loads(row[5]) if row[5] else [],
            created_at=row[6]
        ))
    
    return relationships
