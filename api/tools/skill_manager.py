"""
Skill Manager Tool for Memoria - Agent-Managed Skill Creation & Editing

Allows the agent to create, update, and delete skills, turning successful
approaches into reusable procedural knowledge.

Skills are stored as SKILL.md files in ~/.memoria/skills/
"""

import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional, List


# Get skills directory - same pattern as hermes-agent
MEMORIA_HOME = Path.home() / ".memoria"
SKILLS_DIR = MEMORIA_HOME / "skills"

MAX_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 1024

# Characters allowed in skill names (filesystem-safe)
VALID_NAME_RE = re.compile(r'^[a-z0-9][a-z0-9._-]*$')

# Subdirectories allowed for supporting files
ALLOWED_SUBDIRS = {"references", "templates", "scripts", "assets"}


def _ensure_dirs():
    """Ensure skills directory exists."""
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)


def _validate_name(name: str) -> Optional[str]:
    """Validate a skill name. Returns error message or None if valid."""
    if not name:
        return "Skill name is required."
    if len(name) > MAX_NAME_LENGTH:
        return f"Skill name exceeds {MAX_NAME_LENGTH} characters."
    if not VALID_NAME_RE.match(name):
        return (
            f"Invalid skill name '{name}'. Use lowercase letters, numbers, "
            f"hyphens, dots, and underscores. Must start with a letter or digit."
        )
    return None


def _validate_category(category: Optional[str]) -> Optional[str]:
    """Validate an optional category name."""
    if category is None:
        return None
    if not isinstance(category, str):
        return "Category must be a string."
    
    category = category.strip()
    if not category:
        return None
    if "/" in category or "\\" in category:
        return "Invalid category. Categories must be a single directory name."
    if len(category) > MAX_NAME_LENGTH:
        return f"Category exceeds {MAX_NAME_LENGTH} characters."
    return None


def _validate_frontmatter(content: str) -> Optional[str]:
    """Validate that SKILL.md content has proper frontmatter."""
    if not content.strip():
        return "Content cannot be empty."
    
    if not content.startswith("---"):
        return "SKILL.md must start with YAML frontmatter (---)."
    
    end_match = re.search(r'\n---\s*\n', content[3:])
    if not end_match:
        return "SKILL.md frontmatter is not closed. Ensure you have a closing '---' line."
    
    # Check for required fields
    yaml_content = content[3:end_match.start() + 3]
    if "name:" not in yaml_content:
        return "Frontmatter must include 'name' field."
    if "description:" not in yaml_content:
        return "Frontmatter must include 'description' field."
    
    body = content[end_match.end():].strip()
    if not body:
        return "SKILL.md must have content after the frontmatter."
    
    return None


def _resolve_skill_dir(name: str, category: str = None) -> Path:
    """Build the directory path for a skill."""
    _ensure_dirs()
    if category:
        return SKILLS_DIR / category / name
    return SKILLS_DIR / name


def _find_skill(name: str) -> Optional[Dict[str, Any]]:
    """Find a skill by name. Returns {'path': Path} or None."""
    if not SKILLS_DIR.exists():
        return None
    for skill_md in SKILLS_DIR.rglob("SKILL.md"):
        if skill_md.parent.name == name:
            return {"path": skill_md.parent}
    return None


def _validate_file_path(file_path: str) -> Optional[str]:
    """Validate a file path for write_file/remove_file."""
    if not file_path:
        return "file_path is required."
    
    normalized = Path(file_path)
    
    # Prevent path traversal
    if ".." in normalized.parts:
        return "Path traversal ('..') is not allowed."
    
    # Must be under an allowed subdirectory
    if not normalized.parts or normalized.parts[0] not in ALLOWED_SUBDIRS:
        allowed = ", ".join(sorted(ALLOWED_SUBDIRS))
        return f"File must be under one of: {allowed}. Got: '{file_path}'"
    
    # Must have a filename
    if len(normalized.parts) < 2:
        return f"Provide a file path, not just a directory."
    
    return None


def _atomic_write_text(file_path: Path, content: str, encoding: str = "utf-8") -> None:
    """Atomically write text content to a file."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(
        dir=str(file_path.parent),
        prefix=f".{file_path.name}.tmp.",
        suffix="",
    )
    try:
        with os.fdopen(fd, "w", encoding=encoding) as f:
            f.write(content)
        os.replace(temp_path, file_path)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


# =============================================================================
# Core Actions
# =============================================================================

def _create_skill(name: str, content: str, category: str = None) -> Dict[str, Any]:
    """Create a new skill with SKILL.md content."""
    err = _validate_name(name)
    if err:
        return {"success": False, "error": err}
    
    err = _validate_category(category)
    if err:
        return {"success": False, "error": err}
    
    err = _validate_frontmatter(content)
    if err:
        return {"success": False, "error": err}
    
    # Check for name collisions
    existing = _find_skill(name)
    if existing:
        return {
            "success": False,
            "error": f"A skill named '{name}' already exists at {existing['path']}."
        }
    
    # Create the skill directory
    skill_dir = _resolve_skill_dir(name, category)
    skill_dir.mkdir(parents=True, exist_ok=True)
    
    # Write SKILL.md
    skill_md = skill_dir / "SKILL.md"
    _atomic_write_text(skill_md, content)
    
    result = {
        "success": True,
        "message": f"Skill '{name}' created.",
        "path": str(skill_dir.relative_to(SKILLS_DIR)),
        "skill_md": str(skill_md),
    }
    if category:
        result["category"] = category
    result["hint"] = (
        f"To add reference files, use skill_manage(action='write_file', "
        f"name='{name}', file_path='references/example.md', file_content='...')"
    )
    return result


def _edit_skill(name: str, content: str) -> Dict[str, Any]:
    """Replace the SKILL.md of an existing skill."""
    err = _validate_frontmatter(content)
    if err:
        return {"success": False, "error": err}
    
    existing = _find_skill(name)
    if not existing:
        return {"success": False, "error": f"Skill '{name}' not found."}
    
    skill_md = existing["path"] / "SKILL.md"
    _atomic_write_text(skill_md, content)
    
    return {
        "success": True,
        "message": f"Skill '{name}' updated.",
        "path": str(existing["path"]),
    }


def _patch_skill(
    name: str,
    old_string: str,
    new_string: str,
    file_path: str = None,
    replace_all: bool = False,
) -> Dict[str, Any]:
    """Targeted find-and-replace within a skill file."""
    if not old_string:
        return {"success": False, "error": "old_string is required for 'patch'."}
    if new_string is None:
        return {"success": False, "error": "new_string is required for 'patch'."}
    
    existing = _find_skill(name)
    if not existing:
        return {"success": False, "error": f"Skill '{name}' not found."}
    
    skill_dir = existing["path"]
    
    if file_path:
        err = _validate_file_path(file_path)
        if err:
            return {"success": False, "error": err}
        target = skill_dir / file_path
    else:
        target = skill_dir / "SKILL.md"
    
    if not target.exists():
        return {"success": False, "error": f"File not found: {target.relative_to(skill_dir)}"}
    
    content = target.read_text(encoding="utf-8")
    
    count = content.count(old_string)
    if count == 0:
        preview = content[:500] + ("..." if len(content) > 500 else "")
        return {
            "success": False,
            "error": "old_string not found in the file.",
            "file_preview": preview,
        }
    
    if count > 1 and not replace_all:
        return {
            "success": False,
            "error": (
                f"old_string matched {count} times. Provide more surrounding context "
                f"to make the match unique, or set replace_all=true."
            ),
            "match_count": count,
        }
    
    new_content = content.replace(old_string, new_string) if replace_all else content.replace(old_string, new_string, 1)
    
    # Validate frontmatter if patching SKILL.md
    if not file_path:
        err = _validate_frontmatter(new_content)
        if err:
            return {
                "success": False,
                "error": f"Patch would break SKILL.md structure: {err}",
            }
    
    _atomic_write_text(target, new_content)
    
    replacements = count if replace_all else 1
    return {
        "success": True,
        "message": f"Patched {'SKILL.md' if not file_path else file_path} ({replacements} replacement{'s' if replacements > 1 else ''}).",
    }


def _delete_skill(name: str) -> Dict[str, Any]:
    """Delete a skill."""
    existing = _find_skill(name)
    if not existing:
        return {"success": False, "error": f"Skill '{name}' not found."}
    
    skill_dir = existing["path"]
    shutil.rmtree(skill_dir)
    
    # Clean up empty category directories
    parent = skill_dir.parent
    if parent != SKILLS_DIR and parent.exists() and not any(parent.iterdir()):
        parent.rmdir()
    
    return {
        "success": True,
        "message": f"Skill '{name}' deleted.",
    }


def _write_file(name: str, file_path: str, file_content: str) -> Dict[str, Any]:
    """Add or overwrite a supporting file within a skill."""
    err = _validate_file_path(file_path)
    if err:
        return {"success": False, "error": err}
    
    if file_content is None:
        return {"success": False, "error": "file_content is required."}
    
    existing = _find_skill(name)
    if not existing:
        return {"success": False, "error": f"Skill '{name}' not found."}
    
    target = existing["path"] / file_path
    target.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write_text(target, file_content)
    
    return {
        "success": True,
        "message": f"File '{file_path}' written to skill '{name}'.",
        "path": str(target),
    }


def _remove_file(name: str, file_path: str) -> Dict[str, Any]:
    """Remove a supporting file from a skill."""
    err = _validate_file_path(file_path)
    if err:
        return {"success": False, "error": err}
    
    existing = _find_skill(name)
    if not existing:
        return {"success": False, "error": f"Skill '{name}' not found."}
    
    target = existing["path"] / file_path
    if not target.exists():
        available = []
        for subdir in ALLOWED_SUBDIRS:
            d = existing["path"] / subdir
            if d.exists():
                for f in d.rglob("*"):
                    if f.is_file():
                        available.append(str(f.relative_to(existing["path"])))
        return {
            "success": False,
            "error": f"File '{file_path}' not found.",
            "available_files": available if available else None,
        }
    
    target.unlink()
    
    # Clean up empty subdirectories
    parent = target.parent
    if parent != existing["path"] and parent.exists() and not any(parent.iterdir()):
        parent.rmdir()
    
    return {
        "success": True,
        "message": f"File '{file_path}' removed from skill '{name}'.",
    }


def _list_skills() -> List[Dict[str, Any]]:
    """List all skills in the skills directory."""
    if not SKILLS_DIR.exists():
        return []
    
    skills = []
    for skill_md in SKILLS_DIR.rglob("SKILL.md"):
        try:
            content = skill_md.read_text(encoding="utf-8")
            # Parse frontmatter
            if content.startswith("---"):
                end_match = re.search(r'\n---\s*\n', content[3:])
                if end_match:
                    yaml_content = content[3:end_match.start() + 3]
                    body = content[end_match.end():].strip()
                    
                    # Extract basic fields
                    name_match = re.search(r'^name:\s*(.+)$', yaml_content, re.MULTILINE)
                    desc_match = re.search(r'^description:\s*(.+)$', yaml_content, re.MULTILINE)
                    
                    skills.append({
                        "name": name_match.group(1) if name_match else skill_md.parent.name,
                        "path": str(skill_md.parent.relative_to(SKILLS_DIR)),
                        "description": desc_match.group(1) if desc_match else "",
                        "has_body": bool(body),
                    })
        except Exception:
            pass
    
    return skills


def _view_skill(name: str) -> Optional[Dict[str, Any]]:
    """View a skill's content."""
    existing = _find_skill(name)
    if not existing:
        return None
    
    skill_md = existing["path"] / "SKILL.md"
    content = skill_md.read_text(encoding="utf-8")
    
    # List supporting files
    files = []
    for subdir in ALLOWED_SUBDIRS:
        d = existing["path"] / subdir
        if d.exists():
            for f in d.rglob("*"):
                if f.is_file():
                    files.append(str(f.relative_to(existing["path"])))
    
    return {
        "name": name,
        "path": str(existing["path"]),
        "content": content,
        "files": files,
    }


# =============================================================================
# Main Entry Point
# =============================================================================

def skill_manage(
    action: str,
    name: str = None,
    content: str = None,
    category: str = None,
    file_path: str = None,
    file_content: str = None,
    old_string: str = None,
    new_string: str = None,
    replace_all: bool = False,
) -> Dict[str, Any]:
    """
    Manage user-created skills.
    
    Actions:
    - create: Create a new skill (requires name, content)
    - edit: Replace SKILL.md content (requires name, content)
    - patch: Find-and-replace (requires name, old_string, new_string)
    - delete: Remove a skill (requires name)
    - write_file: Add supporting file (requires name, file_path, file_content)
    - remove_file: Remove supporting file (requires name, file_path)
    - list: List all skills (no name required)
    - view: View a skill's content (requires name)
    """
    if action == "list":
        skills = _list_skills()
        return {"success": True, "skills": skills, "count": len(skills)}
    
    if action == "view":
        if not name:
            return {"success": False, "error": "name is required for 'view'."}
        skill = _view_skill(name)
        if skill:
            return {"success": True, "skill": skill}
        return {"success": False, "error": f"Skill '{name}' not found."}
    
    # All other actions require a name
    if not name:
        return {"success": False, "error": "name is required for this action."}
    
    if action == "create":
        if not content:
            return {"success": False, "error": "content is required for 'create'."}
        return _create_skill(name, content, category)
    
    elif action == "edit":
        if not content:
            return {"success": False, "error": "content is required for 'edit'."}
        return _edit_skill(name, content)
    
    elif action == "patch":
        if old_string is None:
            return {"success": False, "error": "old_string is required for 'patch'."}
        if new_string is None:
            return {"success": False, "error": "new_string is required for 'patch'."}
        return _patch_skill(name, old_string, new_string, file_path, replace_all)
    
    elif action == "delete":
        return _delete_skill(name)
    
    elif action == "write_file":
        if not file_path:
            return {"success": False, "error": "file_path is required for 'write_file'."}
        if file_content is None:
            return {"success": False, "error": "file_content is required for 'write_file'."}
        return _write_file(name, file_path, file_content)
    
    elif action == "remove_file":
        if not file_path:
            return {"success": False, "error": "file_path is required for 'remove_file'."}
        return _remove_file(name, file_path)
    
    else:
        return {"success": False, "error": f"Unknown action '{action}'. Use: create, edit, patch, delete, write_file, remove_file, list, view"}


# Tool schema for LLM function calling
SKILL_MANAGE_SCHEMA = {
    "name": "skill_manage",
    "description": (
        "Manage skills (create, update, delete). Skills are reusable procedures for recurring task types. "
        "New skills go to ~/.memoria/skills/.\n\n"
        "Actions: create (full SKILL.md), patch (old_string/new_string for fixes), "
        "edit (full SKILL.md rewrite), delete, write_file, remove_file, list, view.\n\n"
        "Create when: complex task succeeded (5+ calls), errors overcome, "
        "non-trivial workflow discovered, or user asks to remember a procedure.\n"
        "Update when: instructions stale/wrong, missing steps found during use. "
        "Patch immediately if you hit issues not covered by the skill.\n\n"
        "After difficult/iterative tasks, save as a skill. "
        "Good skills have: trigger conditions, numbered steps, pitfalls section, verification."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["create", "edit", "patch", "delete", "write_file", "remove_file", "list", "view"],
                "description": "The action to perform."
            },
            "name": {
                "type": "string",
                "description": "Skill name (lowercase, hyphens/underscores, max 64 chars)."
            },
            "content": {
                "type": "string",
                "description": "Full SKILL.md content (YAML frontmatter + markdown body). Required for 'create' and 'edit'."
            },
            "old_string": {
                "type": "string",
                "description": "Text to find (required for 'patch'). Must be unique unless replace_all=true."
            },
            "new_string": {
                "type": "string",
                "description": "Replacement text (required for 'patch'). Can be empty to delete."
            },
            "replace_all": {
                "type": "boolean",
                "description": "Replace all occurrences instead of requiring unique match (default: false)."
            },
            "category": {
                "type": "string",
                "description": "Optional category for organizing skills (e.g., 'dev', 'data')."
            },
            "file_path": {
                "type": "string",
                "description": "Path to supporting file under references/, templates/, scripts/, or assets/."
            },
            "file_content": {
                "type": "string",
                "description": "Content for the file. Required for 'write_file'."
            },
        },
        "required": ["action"],
    },
}
