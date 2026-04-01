"""
Memory Tool for Memoria - Persistent Curated Memory

Provides bounded, file-backed memory that persists across sessions:
  - MEMORY.md: agent's personal notes (environment facts, conventions, tool quirks)
  - USER.md: user preferences, communication style, workflow habits

Entry delimiter: § (section sign)
Character limits: 2200 for memory, 1375 for user
"""

import json
import os
import re
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime
import threading


# Where memory files live
MEMORIA_HOME = Path.home() / ".memoria"
MEMORY_DIR = MEMORIA_HOME / "memories"

ENTRY_DELIMITER = "\n§\n"

# Thread-local storage for locks
_lock_storage = threading.local()

# Threat patterns for injection/exfiltration detection
_MEMORY_THREAT_PATTERNS = [
    (r'ignore\s+(previous|all|above|prior)\s+instructions', "prompt_injection"),
    (r'you\s+are\s+now\s+', "role_hijack"),
    (r'do\s+not\s+tell\s+the\s+user', "deception_hide"),
    (r'system\s+prompt\s+override', "sys_prompt_override"),
    (r'disregard\s+(your|all|any)\s+(instructions|rules|guidelines)', "disregard_rules"),
    (r'curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)', "exfil_curl"),
    (r'wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)', "exfil_wget"),
]

_INVISIBLE_CHARS = {
    '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff',
    '\u202a', '\u202b', '\u202c', '\u202d', '\u202e',
}


def _scan_memory_content(content: str) -> Optional[str]:
    """Scan memory content for injection/exfil patterns."""
    for char in _INVISIBLE_CHARS:
        if char in content:
            return f"Blocked: content contains invisible unicode character U+{ord(char):04X}"
    
    for pattern, pid in _MEMORY_THREAT_PATTERNS:
        if re.search(pattern, content, re.IGNORECASE):
            return f"Blocked: content matches threat pattern '{pid}'."
    
    return None


class MemoryStore:
    """
    Bounded curated memory with file persistence.
    
    Maintains live state that is persisted to disk immediately on mutations.
    """
    
    def __init__(self, memory_char_limit: int = 2200, user_char_limit: int = 1375):
        self.memory_entries: List[str] = []
        self.user_entries: List[str] = []
        self.memory_char_limit = memory_char_limit
        self.user_char_limit = user_char_limit
        self._load_from_disk()
    
    def _ensure_dirs(self):
        """Ensure memory directory exists."""
        MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    
    def _load_from_disk(self):
        """Load entries from MEMORY.md and USER.md."""
        self._ensure_dirs()
        self.memory_entries = self._read_file(MEMORY_DIR / "MEMORY.md")
        self.user_entries = self._read_file(MEMORY_DIR / "USER.md")
        
        # Deduplicate entries
        self.memory_entries = list(dict.fromkeys(self.memory_entries))
        self.user_entries = list(dict.fromkeys(self.user_entries))
    
    @staticmethod
    @contextmanager
    def _file_lock(path: Path):
        """Acquire exclusive lock for file (Windows-compatible using threading lock)."""
        lock_key = str(path)
        
        if not hasattr(_lock_storage, 'locks'):
            _lock_storage.locks = {}
        
        if lock_key not in _lock_storage.locks:
            _lock_storage.locks[lock_key] = threading.Lock()
        
        lock = _lock_storage.locks[lock_key]
        lock.acquire()
        try:
            yield
        finally:
            lock.release()
    
    @staticmethod
    def _path_for(target: str) -> Path:
        if target == "user":
            return MEMORY_DIR / "USER.md"
        return MEMORY_DIR / "MEMORY.md"
    
    def _reload_target(self, target: str):
        """Re-read entries from disk into memory."""
        fresh = self._read_file(self._path_for(target))
        fresh = list(dict.fromkeys(fresh))
        if target == "user":
            self.user_entries = fresh
        else:
            self.memory_entries = fresh
    
    def _save_to_disk(self, target: str):
        """Persist entries to the appropriate file."""
        self._ensure_dirs()
        entries = self.user_entries if target == "user" else self.memory_entries
        self._write_file(self._path_for(target), entries)
    
    def _char_count(self, target: str) -> int:
        entries = self.user_entries if target == "user" else self.memory_entries
        if not entries:
            return 0
        return len(ENTRY_DELIMITER.join(entries))
    
    def _char_limit(self, target: str) -> int:
        return self.user_char_limit if target == "user" else self.memory_char_limit
    
    def add(self, target: str, content: str) -> Dict[str, Any]:
        """Append a new entry."""
        content = content.strip()
        if not content:
            return {"success": False, "error": "Content cannot be empty."}
        
        # Security scan
        scan_error = _scan_memory_content(content)
        if scan_error:
            return {"success": False, "error": scan_error}
        
        with self._file_lock(self._path_for(target)):
            self._reload_target(target)
            
            entries = self.user_entries if target == "user" else self.memory_entries
            limit = self._char_limit(target)
            
            # Reject exact duplicates
            if content in entries:
                return self._success_response(target, "Entry already exists.")
            
            # Check limit
            new_entries = entries + [content]
            new_total = len(ENTRY_DELIMITER.join(new_entries))
            
            if new_total > limit:
                current = self._char_count(target)
                return {
                    "success": False,
                    "error": (
                        f"Memory at {current:,}/{limit:,} chars. "
                        f"Adding this entry ({len(content)} chars) would exceed limit."
                    ),
                    "usage": f"{current:,}/{limit:,}",
                }
            
            entries.append(content)
            if target == "user":
                self.user_entries = entries
            else:
                self.memory_entries = entries
            self._save_to_disk(target)
        
        return self._success_response(target, "Entry added.")
    
    def replace(self, target: str, old_text: str, new_content: str) -> Dict[str, Any]:
        """Find entry containing old_text, replace with new_content."""
        old_text = old_text.strip()
        new_content = new_content.strip()
        if not old_text:
            return {"success": False, "error": "old_text cannot be empty."}
        if not new_content:
            return {"success": False, "error": "new_content cannot be empty. Use 'remove' to delete."}
        
        scan_error = _scan_memory_content(new_content)
        if scan_error:
            return {"success": False, "error": scan_error}
        
        with self._file_lock(self._path_for(target)):
            self._reload_target(target)
            
            entries = self.user_entries if target == "user" else self.memory_entries
            matches = [(i, e) for i, e in enumerate(entries) if old_text in e]
            
            if len(matches) == 0:
                return {"success": False, "error": f"No entry matched '{old_text}'."}
            
            if len(matches) > 1:
                unique_texts = set(e for _, e in matches)
                if len(unique_texts) > 1:
                    previews = [e[:80] + ("..." if len(e) > 80 else "") for _, e in matches]
                    return {
                        "success": False,
                        "error": f"Multiple entries matched '{old_text}'. Be more specific.",
                        "matches": previews,
                    }
            
            idx = matches[0][0]
            limit = self._char_limit(target)
            
            # Check replacement doesn't exceed limit
            test_entries = entries.copy()
            test_entries[idx] = new_content
            new_total = len(ENTRY_DELIMITER.join(test_entries))
            
            if new_total > limit:
                return {
                    "success": False,
                    "error": f"Replacement would exceed {limit:,} char limit.",
                }
            
            entries[idx] = new_content
            if target == "user":
                self.user_entries = entries
            else:
                self.memory_entries = entries
            self._save_to_disk(target)
        
        return self._success_response(target, "Entry replaced.")
    
    def remove(self, target: str, old_text: str) -> Dict[str, Any]:
        """Remove entry containing old_text."""
        old_text = old_text.strip()
        if not old_text:
            return {"success": False, "error": "old_text cannot be empty."}
        
        with self._file_lock(self._path_for(target)):
            self._reload_target(target)
            
            entries = self.user_entries if target == "user" else self.memory_entries
            matches = [(i, e) for i, e in enumerate(entries) if old_text in e]
            
            if len(matches) == 0:
                return {"success": False, "error": f"No entry matched '{old_text}'."}
            
            if len(matches) > 1:
                unique_texts = set(e for _, e in matches)
                if len(unique_texts) > 1:
                    previews = [e[:80] + ("..." if len(e) > 80 else "") for _, e in matches]
                    return {
                        "success": False,
                        "error": f"Multiple entries matched '{old_text}'. Be more specific.",
                        "matches": previews,
                    }
            
            idx = matches[0][0]
            entries.pop(idx)
            if target == "user":
                self.user_entries = entries
            else:
                self.memory_entries = entries
            self._save_to_disk(target)
        
        return self._success_response(target, "Entry removed.")
    
    def read(self, target: str) -> Dict[str, Any]:
        """Read all entries for a target."""
        return self._success_response(target)
    
    def format_for_system_prompt(self) -> str:
        """Format memory for injection into system prompt."""
        parts = []
        
        # Memory section
        if self.memory_entries:
            current = self._char_count("memory")
            limit = self.memory_char_limit
            pct = min(100, int((current / limit) * 100))
            header = f"MEMORY (your notes) [{pct}% — {current:,}/{limit:,} chars]"
            separator = "=" * 40
            content = ENTRY_DELIMITER.join(self.memory_entries)
            parts.append(f"{separator}\n{header}\n{separator}\n{content}")
        
        # User section
        if self.user_entries:
            current = self._char_count("user")
            limit = self.user_char_limit
            pct = min(100, int((current / limit) * 100))
            header = f"USER PROFILE [{pct}% — {current:,}/{limit:,} chars]"
            separator = "=" * 40
            content = ENTRY_DELIMITER.join(self.user_entries)
            parts.append(f"{separator}\n{header}\n{separator}\n{content}")
        
        return "\n\n".join(parts)
    
    def _success_response(self, target: str, message: str = None) -> Dict[str, Any]:
        entries = self.user_entries if target == "user" else self.memory_entries
        current = self._char_count(target)
        limit = self._char_limit(target)
        pct = min(100, int((current / limit) * 100)) if limit > 0 else 0
        
        resp = {
            "success": True,
            "target": target,
            "entries": entries,
            "usage": f"{pct}% — {current:,}/{limit:,} chars",
            "entry_count": len(entries),
        }
        if message:
            resp["message"] = message
        return resp
    
    @staticmethod
    def _read_file(path: Path) -> List[str]:
        """Read a memory file and split into entries."""
        if not path.exists():
            return []
        try:
            raw = path.read_text(encoding="utf-8")
        except (OSError, IOError):
            return []
        
        if not raw.strip():
            return []
        
        entries = [e.strip() for e in raw.split(ENTRY_DELIMITER)]
        return [e for e in entries if e]
    
    @staticmethod
    def _write_file(path: Path, entries: List[str]):
        """Write entries to a memory file atomically."""
        content = ENTRY_DELIMITER.join(entries) if entries else ""
        try:
            fd, tmp_path = tempfile.mkstemp(
                dir=str(path.parent), suffix=".tmp", prefix=".mem_"
            )
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(content)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp_path, str(path))
            except BaseException:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise
        except (OSError, IOError) as e:
            raise RuntimeError(f"Failed to write memory file {path}: {e}")


# Global memory store instance
_memory_store: Optional[MemoryStore] = None


def get_memory_store() -> MemoryStore:
    """Get or create the global memory store."""
    global _memory_store
    if _memory_store is None:
        _memory_store = MemoryStore()
    return _memory_store


def memory_tool(
    action: str,
    target: str = "memory",
    content: str = None,
    old_text: str = None,
) -> Dict[str, Any]:
    """
    Manage persistent memory across sessions.
    
    Actions:
    - add: Add new entry
    - replace: Update existing entry (use old_text to identify)
    - remove: Delete entry (use old_text to identify)
    - read: Read all entries
    """
    store = get_memory_store()
    
    if target not in ("memory", "user"):
        return {"success": False, "error": f"Invalid target '{target}'. Use 'memory' or 'user'."}
    
    if action == "add":
        if not content:
            return {"success": False, "error": "content is required for 'add'."}
        return store.add(target, content)
    
    elif action == "replace":
        if not old_text:
            return {"success": False, "error": "old_text is required for 'replace'."}
        if not content:
            return {"success": False, "error": "content is required for 'replace'."}
        return store.replace(target, old_text, content)
    
    elif action == "remove":
        if not old_text:
            return {"success": False, "error": "old_text is required for 'remove'."}
        return store.remove(target, old_text)
    
    elif action == "read":
        return store.read(target)
    
    else:
        return {"success": False, "error": f"Unknown action '{action}'. Use: add, replace, remove, read"}


# Tool schema for LLM
MEMORY_SCHEMA = {
    "name": "memory",
    "description": (
        "Save durable information to persistent memory that survives across sessions. "
        "Memory is injected into future turns, so keep it compact and focused.\n\n"
        "WHEN TO SAVE:\n"
        "- User corrects you or says 'remember this' / 'don't do that again'\n"
        "- User shares preferences, habits, personal details\n"
        "- You discover environment facts (OS, tools, project structure)\n"
        "- You learn conventions, API quirks, workflow specifics\n"
        "- Stable facts that will be useful again\n\n"
        "TARGETS:\n"
        "- 'user': who the user is -- name, role, preferences, style\n"
        "- 'memory': your notes -- environment facts, conventions, tool quirks\n\n"
        "Do NOT save task progress, completed work, or temporary state."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["add", "replace", "remove", "read"],
                "description": "The action to perform."
            },
            "target": {
                "type": "string",
                "enum": ["memory", "user"],
                "description": "Which memory store: 'memory' for notes, 'user' for user profile."
            },
            "content": {
                "type": "string",
                "description": "The entry content. Required for 'add' and 'replace'."
            },
            "old_text": {
                "type": "string",
                "description": "Short unique substring identifying the entry to replace or remove."
            },
        },
        "required": ["action", "target"],
    },
}
