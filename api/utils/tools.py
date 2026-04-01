import requests
import json
from typing import Dict, Any, Callable

# Import self-improvement tools - use try/except since these might not exist yet
try:
    from ..tools.memory import memory_tool, MEMORY_SCHEMA, get_memory_store
    from ..tools.skill_manager import skill_manage, SKILL_MANAGE_SCHEMA, list_skills, view_skill
    from ..tools.session_search import session_search, SESSION_SEARCH_SCHEMA, get_session_store
    _SELF_IMPROVEMENT_AVAILABLE = True
except ImportError as e:
    _SELF_IMPROVEMENT_AVAILABLE = False
    # Define placeholder functions and schemas if imports fail
    def memory_tool(**kwargs):
        return {"success": False, "error": "Memory tool not available"}
    def skill_manage(**kwargs):
        return {"success": False, "error": "Skill manager not available"}
    def session_search(**kwargs):
        return {"success": False, "error": "Session search not available"}
    def get_memory_store():
        return None
    def get_session_store():
        return None
    def list_skills():
        return []
    def view_skill(name):
        return None
    
    MEMORY_SCHEMA = {"name": "memory", "description": "Memory tool not available", "parameters": {"type": "object", "properties": {}}}
    SKILL_MANAGE_SCHEMA = {"name": "skill_manage", "description": "Skill manager not available", "parameters": {"type": "object", "properties": {}}}
    SESSION_SEARCH_SCHEMA = {"name": "session_search", "description": "Session search not available", "parameters": {"type": "object", "properties": {}}}


# =============================================================================
# Built-in Tools
# =============================================================================

def get_current_weather(latitude, longitude):
    url = f"https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto"
    try:
        response = requests.get(url)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        return {"error": str(e)}


# =============================================================================
# Tool Definitions
# =============================================================================

BASE_TOOL_DEFINITIONS = [{
    "type": "function",
    "function": {
        "name": "get_current_weather",
        "description": "Get the current weather at a location",
        "parameters": {
            "type": "object",
            "properties": {
                "latitude": {"type": "number", "description": "The latitude of the location"},
                "longitude": {"type": "number", "description": "The longitude of the location"},
            },
            "required": ["latitude", "longitude"],
        },
    },
}]

# Self-improvement tool definitions
SELF_IMPROVEMENT_TOOLS = [
    {
        "type": "function",
        "function": MEMORY_SCHEMA,
    },
    {
        "type": "function",
        "function": SKILL_MANAGE_SCHEMA,
    },
    {
        "type": "function",
        "function": SESSION_SEARCH_SCHEMA,
    },
]

# Combined tool definitions
TOOL_DEFINITIONS = BASE_TOOL_DEFINITIONS + SELF_IMPROVEMENT_TOOLS


# =============================================================================
# Tool Handlers
# =============================================================================

def handle_memory_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handle memory tool execution."""
    return memory_tool(
        action=args.get("action"),
        target=args.get("target", "memory"),
        content=args.get("content"),
        old_text=args.get("old_text"),
    )


def handle_skill_manager_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handle skill manager tool execution."""
    return skill_manage(
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


def handle_session_search_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handle session search tool execution."""
    return session_search(
        query=args.get("query"),
        role_filter=args.get("role_filter"),
        limit=args.get("limit", 3),
    )


# =============================================================================
# Available Tools Registry
# =============================================================================

BASE_AVAILABLE_TOOLS: Dict[str, Callable] = {
    "get_current_weather": get_current_weather,
}

# Self-improvement tool handlers
SELF_IMPROVEMENT_HANDLERS: Dict[str, Callable] = {
    "memory": handle_memory_tool,
    "skill_manage": handle_skill_manager_tool,
    "session_search": handle_session_search_tool,
}

# Combined available tools
AVAILABLE_TOOLS = {**BASE_AVAILABLE_TOOLS, **SELF_IMPROVEMENT_HANDLERS}


def execute_tool(tool_name: str, arguments: Dict[str, Any]) -> str:
    """
    Execute a tool by name with given arguments.
    Returns JSON string result.
    """
    if tool_name not in AVAILABLE_TOOLS:
        return json.dumps({"error": f"Tool '{tool_name}' not found"})
    
    try:
        handler = AVAILABLE_TOOLS[tool_name]
        result = handler(arguments)
        
        # Ensure result is JSON serializable
        if isinstance(result, dict):
            return json.dumps(result, ensure_ascii=False)
        elif isinstance(result, str):
            return json.dumps({"result": result}, ensure_ascii=False)
        else:
            return json.dumps({"result": str(result)}, ensure_ascii=False)
    except Exception as e:
        import traceback
        return json.dumps({"error": str(e), "traceback": traceback.format_exc()}, ensure_ascii=False)
