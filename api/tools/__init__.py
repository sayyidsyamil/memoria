"""
Tools package for Memoria self-improvement system.

Inspired by hermes-agent, this provides:
- memory: Persistent curated memory (user facts, environment notes)
- skill_manager: Create reusable skills/procedures
- session_search: FTS5-based session history search
"""

from .memory import memory_tool, MEMORY_SCHEMA, MemoryStore, get_memory_store
from .skill_manager import skill_manage, SKILL_MANAGE_SCHEMA
from .session_search import session_search, SESSION_SEARCH_SCHEMA, SessionStore, get_session_store

__all__ = [
    "memory_tool",
    "MEMORY_SCHEMA",
    "MemoryStore",
    "get_memory_store",
    "skill_manage",
    "SKILL_MANAGE_SCHEMA",
    "session_search",
    "SESSION_SEARCH_SCHEMA",
    "SessionStore",
    "get_session_store",
]
