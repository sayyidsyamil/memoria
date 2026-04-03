"""Configuration management for Brain (multi-provider)."""
import os
import json
from pathlib import Path

# Load environment variables from .env file in project root
def _load_env_file():
    """Load .env file from project root if python-dotenv is available."""
    try:
        from dotenv import load_dotenv
        env_path = find_project_root() / ".env"
        if env_path.exists():
            load_dotenv(env_path, override=True)
    except ImportError:
        # python-dotenv not installed, skip
        pass


def find_project_root() -> Path:
    """Find the project root by looking for frontend/backend directories."""
    cwd = Path.cwd()
    
    # If we're in backend/ or frontend/, go up one level
    if cwd.name in ("backend", "frontend"):
        return cwd.parent
    
    # Check if we're in the project root
    if (cwd / "knowledge").exists() and (cwd / "frontend").exists() and (cwd / "backend").exists():
        return cwd
    
    # Check parent directories for the markers
    for parent in cwd.parents:
        if (parent / "knowledge").exists() and (parent / "frontend").exists() and (parent / "backend").exists():
            return parent
    
    # Fallback to cwd
    return cwd


def project_brain_root() -> Path:
    """Project-local Brain directory (e.g. skills, agents)."""
    return Path.cwd() / ".brain"


def get_knowledge_root() -> Path:
    """Knowledge vault directory for memory storage.
    
    Located at <project_root>/knowledge/ for structured storage.
    """
    return find_project_root() / "knowledge"


CONFIG_DIR   = Path.home() / ".brain"
CONFIG_FILE  = CONFIG_DIR  / "config.json"
HISTORY_FILE = CONFIG_DIR  / "input_history.txt"
SESSIONS_DIR = CONFIG_DIR  / "sessions"

# Load .env file early (before DEFAULTS definition)
_load_env_file()

# Get API key from environment or empty string (user must set in .env)
def _get_api_key():
    """Get API key from environment variables."""
    # Check multiple possible env var names
    for key_name in ["FIREWORKS_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AI_API_KEY"]:
        key = os.environ.get(key_name, "").strip()
        if key:
            return key
    return ""

DEFAULTS = {
    "model":            "accounts/fireworks/routers/kimi-k2p5-turbo",
    "max_tokens":       8192,
    "permission_mode":  "auto",   # auto | accept-all | manual
    "verbose":          False,
    "thinking":         False,
    "thinking_budget":  10000,
    "custom_base_url":  "",       # for "custom" provider
    "max_tool_output":  32000,
    "max_agent_depth":  3,
    "max_concurrent_agents": 3,
    # Fireworks routing for all OpenAI/Anthropic paths
    "openai_base_url":  "https://api.fireworks.ai/inference/v1",
    "openai_model":     "accounts/fireworks/routers/kimi-k2p5-turbo",
    "anthropic_base_url": "https://api.fireworks.ai/inference",
    "anthropic_model":    "accounts/fireworks/routers/kimi-k2p5-turbo",
    # API keys - loaded from environment variables (see .env file)
    "openai_api_key":   _get_api_key(),
    "anthropic_api_key": _get_api_key(),
    "fireworks_api_key": _get_api_key(),
}


def load_config() -> dict:
    CONFIG_DIR.mkdir(exist_ok=True)
    SESSIONS_DIR.mkdir(exist_ok=True)
    cfg = dict(DEFAULTS)
    if CONFIG_FILE.exists():
        try:
            cfg.update(json.loads(CONFIG_FILE.read_text()))
        except (json.JSONDecodeError, ValueError, IOError):
            pass
    # Backward-compat: legacy single api_key → anthropic_api_key
    if cfg.get("api_key") and not cfg.get("anthropic_api_key"):
        cfg["anthropic_api_key"] = cfg.pop("api_key")
    # Also accept ANTHROPIC_API_KEY env for backward-compat
    if not cfg.get("anthropic_api_key"):
        cfg["anthropic_api_key"] = os.environ.get("ANTHROPIC_API_KEY", "")
    return cfg


def save_config(cfg: dict):
    CONFIG_DIR.mkdir(exist_ok=True)
    data = dict(cfg)
    CONFIG_FILE.write_text(json.dumps(data, indent=2))


def current_provider(cfg: dict) -> str:
    from providers import detect_provider
    return detect_provider(cfg.get("model", DEFAULTS["model"]))


def has_api_key(cfg: dict) -> bool:
    """Check whether the active provider has an API key configured."""
    from providers import get_api_key
    pname = current_provider(cfg)
    key = get_api_key(pname, cfg)
    return bool(key)
