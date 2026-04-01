"""
Session Search Tool for Memoria - Long-Term Conversation Recall

Searches past session transcripts in SQLite via FTS5, then summarizes
matching sessions using a fast/cheap model.

Flow:
  1. FTS5 search finds matching messages
  2. Groups by session, takes top N
  3. Summarizes each session
  4. Returns per-session summaries
"""

import json
import logging
import re
from typing import Dict, Any, List, Optional
from datetime import datetime
from dataclasses import dataclass, asdict


logger = logging.getLogger(__name__)


@dataclass
class Session:
    """Represents a conversation session."""
    id: str
    title: str
    source: str  # 'cli', 'api', etc.
    started_at: float
    last_active: float
    message_count: int
    preview: str
    parent_session_id: Optional[str] = None


@dataclass
class Message:
    """Represents a message in a session."""
    id: int
    session_id: str
    role: str  # 'user', 'assistant', 'tool', 'system'
    content: str
    tool_name: Optional[str] = None
    tool_call_id: Optional[str] = None
    timestamp: float = 0


class SessionStore:
    """SQLite-based session store with FTS5 search."""
    
    def __init__(self, db_path: str = "memoria_sessions.db"):
        self.db_path = db_path
        self._init_db()
    
    def _init_db(self):
        """Initialize SQLite database with FTS5."""
        import sqlite3
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Sessions table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT,
                source TEXT,
                started_at REAL,
                last_active REAL,
                message_count INTEGER DEFAULT 0,
                preview TEXT,
                parent_session_id TEXT
            )
        """)
        
        # Messages table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tool_name TEXT,
                tool_call_id TEXT,
                timestamp REAL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        """)
        
        # FTS5 virtual table for full-text search
        cursor.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                content,
                role,
                session_id UNINDEXED,
                content_rowid=rowid,
                prefix='2,3,4'
            )
        """)
        
        # Triggers to keep FTS5 in sync
        cursor.execute("""
            CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages
            BEGIN
                INSERT INTO messages_fts(rowid, content, role, session_id)
                VALUES (new.id, new.content, new.role, new.session_id);
            END
        """)
        
        cursor.execute("""
            CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages
            BEGIN
                DELETE FROM messages_fts WHERE rowid = old.id;
            END
        """)
        
        cursor.execute("""
            CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages
            BEGIN
                DELETE FROM messages_fts WHERE rowid = old.id;
                INSERT INTO messages_fts(rowid, content, role, session_id)
                VALUES (new.id, new.content, new.role, new.session_id);
            END
        """)
        
        # Indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source)")
        
        conn.commit()
        conn.close()
    
    def save_session(self, session: Session):
        """Save or update a session."""
        import sqlite3
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT OR REPLACE INTO sessions 
            (id, title, source, started_at, last_active, message_count, preview, parent_session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            session.id, session.title, session.source,
            session.started_at, session.last_active,
            session.message_count, session.preview, session.parent_session_id
        ))
        
        conn.commit()
        conn.close()
    
    def save_message(self, message: Message):
        """Save a message."""
        import sqlite3
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO messages 
            (session_id, role, content, tool_name, tool_call_id, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            message.session_id, message.role, message.content,
            message.tool_name, message.tool_call_id, message.timestamp
        ))
        
        # Update session message count and last_active
        cursor.execute("""
            UPDATE sessions SET message_count = message_count + 1, last_active = ?
            WHERE id = ?
        """, (message.timestamp, message.session_id))
        
        conn.commit()
        conn.close()
    
    def get_session(self, session_id: str) -> Optional[Session]:
        """Get a session by ID."""
        import sqlite3
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return Session(
                id=row[0], title=row[1], source=row[2],
                started_at=row[3], last_active=row[4],
                message_count=row[5], preview=row[6],
                parent_session_id=row[7]
            )
        return None
    
    def get_session_messages(self, session_id: str) -> List[Message]:
        """Get all messages for a session."""
        import sqlite3
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, session_id, role, content, tool_name, tool_call_id, timestamp
            FROM messages WHERE session_id = ? ORDER BY id
        """, (session_id,))
        
        rows = cursor.fetchall()
        conn.close()
        
        return [Message(
            id=r[0], session_id=r[1], role=r[2], content=r[3],
            tool_name=r[4], tool_call_id=r[5], timestamp=r[6]
        ) for r in rows]
    
    def search_messages(
        self,
        query: str,
        role_filter: List[str] = None,
        limit: int = 50,
        exclude_sources: List[str] = None
    ) -> List[Dict[str, Any]]:
        """Search messages using FTS5."""
        import sqlite3
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Build FTS5 query
        # Convert user query to FTS5 format
        # "machine learning" -> "machine" AND "learning"
        # machine learning -> machine OR learning
        if '"' not in query:
            # Simple keywords - use OR for broad recall
            terms = query.split()
            fts_query = " OR ".join(f'"{term}"' for term in terms)
        else:
            # User provided quotes - respect them
            fts_query = query
        
        try:
            cursor.execute("""
                SELECT m.id, m.session_id, m.role, m.content, m.tool_name,
                       rank, s.source, s.started_at, s.title
                FROM messages_fts fts
                JOIN messages m ON fts.rowid = m.id
                JOIN sessions s ON m.session_id = s.id
                WHERE messages_fts MATCH ?
                ORDER BY rank
                LIMIT ?
            """, (fts_query, limit))
            
            rows = cursor.fetchall()
            
            results = []
            for row in rows:
                # Filter by role if specified
                if role_filter and row[2] not in role_filter:
                    continue
                # Filter by source if specified
                if exclude_sources and row[6] in exclude_sources:
                    continue
                
                results.append({
                    "message_id": row[0],
                    "session_id": row[1],
                    "role": row[2],
                    "content": row[3][:200] + "..." if len(row[3]) > 200 else row[3],
                    "tool_name": row[4],
                    "rank": row[5],
                    "source": row[6],
                    "session_started": row[7],
                    "session_title": row[8],
                })
            
            return results
            
        except Exception as e:
            logger.error(f"FTS5 search error: {e}")
            return []
        finally:
            conn.close()
    
    def list_recent_sessions(self, limit: int = 10, exclude_child_sessions: bool = True) -> List[Session]:
        """List recent sessions."""
        import sqlite3
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        if exclude_child_sessions:
            cursor.execute("""
                SELECT * FROM sessions 
                WHERE parent_session_id IS NULL
                ORDER BY last_active DESC
                LIMIT ?
            """, (limit,))
        else:
            cursor.execute("""
                SELECT * FROM sessions 
                ORDER BY last_active DESC
                LIMIT ?
            """, (limit,))
        
        rows = cursor.fetchall()
        conn.close()
        
        return [Session(
            id=r[0], title=r[1], source=r[2],
            started_at=r[3], last_active=r[4],
            message_count=r[5], preview=r[6],
            parent_session_id=r[7]
        ) for r in rows]


# Global session store
_session_store: Optional[SessionStore] = None


def get_session_store() -> SessionStore:
    """Get or create global session store."""
    global _session_store
    if _session_store is None:
        _session_store = SessionStore()
    return _session_store


def session_search(
    query: str = None,
    role_filter: str = None,
    limit: int = 3,
    current_session_id: str = None
) -> Dict[str, Any]:
    """
    Search past sessions and return summaries.
    
    If query is empty/None, returns recent sessions list.
    """
    store = get_session_store()
    
    limit = min(limit, 5)
    
    # Recent sessions mode (no query)
    if not query or not query.strip():
        sessions = store.list_recent_sessions(limit=limit)
        return {
            "success": True,
            "mode": "recent",
            "results": [
                {
                    "session_id": s.id,
                    "title": s.title,
                    "source": s.source,
                    "started_at": datetime.fromtimestamp(s.started_at).isoformat() if s.started_at else None,
                    "message_count": s.message_count,
                    "preview": s.preview,
                }
                for s in sessions
            ],
            "count": len(sessions),
        }
    
    # Search mode
    query = query.strip()
    
    # Parse role filter
    role_list = None
    if role_filter and role_filter.strip():
        role_list = [r.strip() for r in role_filter.split(",") if r.strip()]
    
    # Search
    results = store.search_messages(
        query=query,
        role_filter=role_list,
        limit=50,
        exclude_sources=["tool"]  # Exclude tool-only sessions
    )
    
    if not results:
        return {
            "success": True,
            "query": query,
            "results": [],
            "count": 0,
            "message": "No matching sessions found.",
        }
    
    # Group by session, skipping current
    seen_sessions = {}
    for result in results:
        sid = result["session_id"]
        if current_session_id and sid == current_session_id:
            continue
        if sid not in seen_sessions:
            seen_sessions[sid] = result
        if len(seen_sessions) >= limit:
            break
    
    # Get full session info for each
    summaries = []
    for sid, match_info in seen_sessions.items():
        session = store.get_session(sid)
        if not session:
            continue
        
        messages = store.get_session_messages(sid)
        
        # Format messages
        conversation = []
        for m in messages[:20]:  # Limit to first 20 messages
            if m.role == "tool":
                content = m.content[:100] + "..." if len(m.content) > 100 else m.content
                conversation.append(f"[TOOL:{m.tool_name}]: {content}")
            elif m.role == "assistant":
                conversation.append(f"[ASSISTANT]: {m.content[:200]}...")
            else:
                conversation.append(f"[{m.role.upper()}]: {m.content[:200]}...")
        
        summaries.append({
            "session_id": sid,
            "title": session.title,
            "source": session.source,
            "when": datetime.fromtimestamp(session.started_at).strftime("%B %d, %Y at %I:%M %p") if session.started_at else "unknown",
            "message_count": session.message_count,
            "preview": session.preview,
            "conversation_preview": "\n".join(conversation),
        })
    
    return {
        "success": True,
        "query": query,
        "results": summaries,
        "count": len(summaries),
    }


# Tool schema for LLM
SESSION_SEARCH_SCHEMA = {
    "name": "session_search",
    "description": (
        "Search your long-term memory of past conversations, or browse recent sessions. "
        "Every conversation is searchable.\n\n"
        "TWO MODES:\n"
        "1. Recent sessions (no query): See what was worked on recently. "
        "Returns titles, previews, timestamps.\n"
        "2. Keyword search (with query): Search for specific topics. "
        "Returns matching sessions with conversation previews.\n\n"
        "USE THIS WHEN:\n"
        "- User says 'we did this before', 'remember when', 'last time'\n"
        "- User asks about a topic worked on before\n"
        "- You want to check if you've solved a similar problem\n\n"
        "Search syntax: keywords for broad recall, phrases in quotes for exact match."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query — keywords or phrases. Omit to browse recent sessions.",
            },
            "role_filter": {
                "type": "string",
                "description": "Optional: only search messages from specific roles (comma-separated).",
            },
            "limit": {
                "type": "integer",
                "description": "Max sessions to return (default: 3, max: 5).",
                "default": 3,
            },
        },
        "required": [],
    },
}
