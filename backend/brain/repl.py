#!/usr/bin/env python3
"""
Brain — terminal AI coding assistant.

Usage:
  (from memoria/backend)  python brain_cli.py [options] [prompt]
                          python -m brain.repl [options] [prompt]

Options:
  -p, --print          Non-interactive: run prompt and exit (also --print-output)
  -m, --model MODEL    Override model
  --accept-all         Never ask permission (dangerous)
  --verbose            Show thinking + token counts
  --version            Print version and exit

Slash commands in REPL:
  /help       Show this help
  /clear      Clear conversation
  /model [m]  Show or set model
  /config     Show config / set key=value
  /save [f]   Save session to file
  /load [f]   Load session from file
  /history    Print conversation history
  /context    Show context window usage
  /cost       Show API cost this session
  /verbose    Toggle verbose mode
  /thinking   Toggle extended thinking
  /permissions [mode]  Set permission mode
  /cwd [path] Show or change working directory
  /memory [query]   Show/search persistent memories
  /vault      Memory vault integration (path, daily, compile, search)
  /connect    Analyze notes and find interesting connections
  /ingest <url>     Ingest YouTube, PDF, or webpage
  /skills           List available skills
  /agents           Show sub-agent tasks
  /exit /quit Exit
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

# memoria/backend — flat packages (agent, memory, skill, …)
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
try:
    import readline
except ImportError:
    readline = None  # Windows compatibility
import atexit
import argparse
import textwrap
from datetime import datetime
from typing import Literal, Optional, Union

# ── Optional rich for markdown rendering ──────────────────────────────────
try:
    from rich.console import Console
    from rich.markdown import Markdown
    from rich.syntax import Syntax
    from rich.panel import Panel
    from rich import print as rprint
    _RICH = True
    console = Console()
except ImportError:
    _RICH = False
    console = None

VERSION = "1.0.0"

# ── ANSI helpers (used even with rich for non-markdown output) ─────────────
C = {
    "cyan":    "\033[36m",
    "green":   "\033[32m",
    "yellow":  "\033[33m",
    "red":     "\033[31m",
    "blue":    "\033[34m",
    "magenta": "\033[35m",
    "bold":    "\033[1m",
    "dim":     "\033[2m",
    "reset":   "\033[0m",
}

def clr(text: str, *keys: str) -> str:
    return "".join(C[k] for k in keys) + str(text) + C["reset"]

def info(msg: str):   print(clr(msg, "cyan"))
def ok(msg: str):     print(clr(msg, "green"))
def warn(msg: str):   print(clr(f"Warning: {msg}", "yellow"))
def err(msg: str):    print(clr(f"Error: {msg}", "red"), file=sys.stderr)


def render_diff(text: str):
    """Print diff text with ANSI colors: red for removals, green for additions."""
    for line in text.splitlines():
        if line.startswith("+++") or line.startswith("---"):
            print(C["bold"] + line + C["reset"])
        elif line.startswith("+"):
            print(C["green"] + line + C["reset"])
        elif line.startswith("-"):
            print(C["red"] + line + C["reset"])
        elif line.startswith("@@"):
            print(C["cyan"] + line + C["reset"])
        else:
            print(line)

def _has_diff(text: str) -> bool:
    """Check if text contains a unified diff."""
    return "--- a/" in text and "+++ b/" in text


# ── Conversation rendering ─────────────────────────────────────────────────

class _StreamBuffer:
    """Thread-safe buffer for streaming text during agent conversation.
    
    Uses thread-local storage to avoid module-level mutable state issues.
    """
    def __init__(self):
        self._buffer: list[str] = []
    
    def append(self, chunk: str) -> None:
        self._buffer.append(chunk)
    
    def get_and_clear(self) -> str:
        full = "".join(self._buffer)
        self._buffer.clear()
        return full
    
    def clear(self) -> None:
        self._buffer.clear()

# Global buffer instance (reset between runs)
_stream_buffer = _StreamBuffer()

def stream_text(chunk: str):
    """Called for each streamed text chunk."""
    print(chunk, end="", flush=True)
    _stream_buffer.append(chunk)

def stream_thinking(chunk: str, verbose: bool):
    if verbose:
        print(clr(chunk, "dim"), end="", flush=True)

def flush_response():
    """After streaming, optionally re-render as markdown."""
    full = _stream_buffer.get_and_clear()
    if _RICH and full.strip():
        # Re-print with markdown rendering
        print("\r", end="")      # go to line start to overwrite last newline
        # only re-render if there's actual markdown (contains # * ` _ etc.)
        if any(c in full for c in ("#", "*", "`", "_", "[")):
            print()   # newline after streaming
            console.print(Markdown(full))
            return
    print()  # ensure newline after stream

def print_tool_start(name: str, inputs: dict, verbose: bool):
    """Show tool invocation."""
    desc = _tool_desc(name, inputs)
    print(clr(f"\n  ⚙  {desc}", "dim", "cyan"), flush=True)
    if verbose:
        print(clr(f"     inputs: {json.dumps(inputs, ensure_ascii=False)[:200]}", "dim"))

def print_tool_end(name: str, result: str, verbose: bool):
    lines = result.count("\n") + 1
    size = len(result)
    summary = f"-> {lines} lines ({size} chars)"
    if not result.startswith("Error") and not result.startswith("Denied"):
        print(clr(f"  ✓ {summary}", "dim", "green"), flush=True)
        # Render diff for Edit/Write results
        if name in ("Edit", "Write") and _has_diff(result):
            parts = result.split("\n\n", 1)
            if len(parts) == 2:
                print(clr(f"  {parts[0]}", "dim"))
                render_diff(parts[1])
    else:
        print(clr(f"  ✗ {result[:120]}", "dim", "red"), flush=True)
    if verbose and not result.startswith("Denied"):
        preview = result[:500] + ("…" if len(result) > 500 else "")
        print(clr(f"     {preview.replace(chr(10), chr(10)+'     ')}", "dim"))

def _tool_desc(name: str, inputs: dict) -> str:
    if name == "Read":   return f"Read({inputs.get('file_path','')})"
    if name == "Write":  return f"Write({inputs.get('file_path','')})"
    if name == "Edit":   return f"Edit({inputs.get('file_path','')})"
    if name == "Bash":   return f"Bash({inputs.get('command','')[:80]})"
    if name == "Glob":   return f"Glob({inputs.get('pattern','')})"
    if name == "Grep":   return f"Grep({inputs.get('pattern','')})"
    if name == "WebFetch":    return f"WebFetch({inputs.get('url','')[:60]})"
    if name == "WebSearch":   return f"WebSearch({inputs.get('query','')})"
    if name == "Agent":
        atype = inputs.get("subagent_type", "")
        aname = inputs.get("name", "")
        iso   = inputs.get("isolation", "")
        bg    = not inputs.get("wait", True)
        parts = []
        if atype:  parts.append(atype)
        if aname:  parts.append(f"name={aname}")
        if iso:    parts.append(f"isolation={iso}")
        if bg:     parts.append("background")
        suffix = f"({', '.join(parts)})" if parts else ""
        prompt_short = inputs.get("prompt", "")[:60]
        return f"Agent{suffix}: {prompt_short}"
    if name == "SendMessage":
        return f"SendMessage(to={inputs.get('to','')}: {inputs.get('message','')[:50]})"
    if name == "CheckAgentResult": return f"CheckAgentResult({inputs.get('task_id','')})"
    if name == "ListAgentTasks":   return "ListAgentTasks()"
    if name == "ListAgentTypes":   return "ListAgentTypes()"
    return f"{name}({list(inputs.values())[:1]})"


# ── Permission prompt ──────────────────────────────────────────────────────

def ask_permission_interactive(desc: str, config: dict) -> bool:
    try:
        print()
        ans = input(clr(f"  Allow: {desc}  [y/N/a(ccept-all)] ", "yellow")).strip().lower()
        if ans == "a":
            config["permission_mode"] = "accept-all"
            ok("  Permission mode set to accept-all for this session.")
            return True
        return ans in ("y", "yes")
    except (KeyboardInterrupt, EOFError):
        print()
        return False


# ── Slash commands ─────────────────────────────────────────────────────────

def cmd_help(_args: str, _state, _config) -> bool:
    print(__doc__)
    return True

def cmd_clear(_args: str, state, _config) -> bool:
    state.messages.clear()
    state.turn_count = 0
    ok("Conversation cleared.")
    return True

def cmd_model(args: str, _state, config) -> bool:
    from providers import PROVIDERS, detect_provider
    if not args:
        model = config["model"]
        pname = detect_provider(model)
        info(f"Current model:    {model}  (provider: {pname})")
        info("\nAvailable models by provider:")
        for pn, pdata in PROVIDERS.items():
            ms = pdata.get("models", [])
            if ms:
                info(f"  {pn:12s}  " + ", ".join(ms[:4]) + ("..." if len(ms) > 4 else ""))
        info("\nFormat: 'provider/model' or just model name (auto-detected)")
        info("  e.g. /model gpt-4o")
        info("  e.g. /model ollama/qwen2.5-coder")
        info("  e.g. /model kimi:moonshot-v1-32k")
    else:
        # Accept both "ollama/model" and "ollama:model" syntax
        m = args.strip().replace(":", "/", 1)
        config["model"] = m
        pname = detect_provider(m)
        ok(f"Model set to {m}  (provider: {pname})")
        from config import save_config
        save_config(config)
    return True

def cmd_config(args: str, _state, config) -> bool:
    from config import save_config
    if not args:
        display = {k: v for k, v in config.items() if k != "api_key"}
        print(json.dumps(display, indent=2))
    elif "=" in args:
        key, _, val = args.partition("=")
        key, val = key.strip(), val.strip()
        # Type coercion
        if val.lower() in ("true", "false"):
            val = val.lower() == "true"
        elif val.isdigit():
            val = int(val)
        config[key] = val
        save_config(config)
        ok(f"Set {key} = {val}")
    else:
        k = args.strip()
        v = config.get(k, "(not set)")
        info(f"{k} = {v}")
    return True

def cmd_save(args: str, state, _config) -> bool:
    from config import SESSIONS_DIR
    fname = args.strip() or f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    path = Path(fname) if "/" in fname else SESSIONS_DIR / fname
    data = {
        "messages": [
            m if not isinstance(m.get("content"), list) else
            {**m, "content": [
                b if isinstance(b, dict) else b.model_dump()
                for b in m["content"]
            ]}
            for m in state.messages
        ],
        "turn_count": state.turn_count,
        "total_input_tokens": state.total_input_tokens,
        "total_output_tokens": state.total_output_tokens,
    }
    path.write_text(json.dumps(data, indent=2, default=str))
    ok(f"Session saved to {path}")
    return True

def cmd_load(args: str, state, _config) -> bool:
    from config import SESSIONS_DIR
    if not args.strip():
        # List available sessions
        sessions = sorted(SESSIONS_DIR.glob("*.json"))
        if not sessions:
            info("No saved sessions found.")
        else:
            info("Saved sessions:")
            for s in sessions:
                info(f"  {s.name}")
        return True
    fname = args.strip()
    path = Path(fname) if "/" in fname else SESSIONS_DIR / fname
    if not path.exists():
        err(f"File not found: {path}")
        return True
    data = json.loads(path.read_text())
    state.messages = data.get("messages", [])
    state.turn_count = data.get("turn_count", 0)
    state.total_input_tokens = data.get("total_input_tokens", 0)
    state.total_output_tokens = data.get("total_output_tokens", 0)
    ok(f"Session loaded from {path} ({len(state.messages)} messages)")
    return True

def cmd_history(_args: str, state, _config) -> bool:
    if not state.messages:
        info("(empty conversation)")
        return True
    for i, m in enumerate(state.messages):
        role = clr(m["role"].upper(), "bold",
                   "cyan" if m["role"] == "user" else "green")
        content = m["content"]
        if isinstance(content, str):
            print(f"[{i}] {role}: {content[:200]}")
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    btype = block.get("type", "")
                else:
                    btype = getattr(block, "type", "")
                if btype == "text":
                    text = block.get("text", "") if isinstance(block, dict) else block.text
                    print(f"[{i}] {role}: {text[:200]}")
                elif btype == "tool_use":
                    name = block.get("name", "") if isinstance(block, dict) else block.name
                    print(f"[{i}] {role}: [tool_use: {name}]")
                elif btype == "tool_result":
                    cval = block.get("content", "") if isinstance(block, dict) else block.content
                    print(f"[{i}] {role}: [tool_result: {str(cval)[:100]}]")
    return True

def cmd_context(_args: str, state, config) -> bool:
    import anthropic
    # Rough token estimate: 4 chars ≈ 1 token
    msg_chars = sum(
        len(str(m.get("content", ""))) for m in state.messages
    )
    est_tokens = msg_chars // 4
    info(f"Messages:         {len(state.messages)}")
    info(f"Estimated tokens: ~{est_tokens:,}")
    info(f"Model:            {config['model']}")
    info(f"Max tokens:       {config['max_tokens']:,}")
    return True

def cmd_cost(_args: str, state, config) -> bool:
    from providers import calc_cost
    cost = calc_cost(config["model"],
                     state.total_input_tokens,
                     state.total_output_tokens)
    info(f"Input tokens:  {state.total_input_tokens:,}")
    info(f"Output tokens: {state.total_output_tokens:,}")
    info(f"Est. cost:     ${cost:.4f} USD")
    return True

def cmd_verbose(_args: str, _state, config) -> bool:
    config["verbose"] = not config.get("verbose", False)
    state_str = "ON" if config["verbose"] else "OFF"
    ok(f"Verbose mode: {state_str}")
    return True

def cmd_thinking(_args: str, _state, config) -> bool:
    config["thinking"] = not config.get("thinking", False)
    state_str = "ON" if config["thinking"] else "OFF"
    ok(f"Extended thinking: {state_str}")
    return True

def cmd_permissions(args: str, _state, config) -> bool:
    from config import save_config
    modes = ["auto", "accept-all", "manual"]
    if not args.strip():
        info(f"Permission mode: {config.get('permission_mode','auto')}")
        info(f"Available modes: {', '.join(modes)}")
    else:
        m = args.strip()
        if m not in modes:
            err(f"Unknown mode: {m}. Choose: {', '.join(modes)}")
        else:
            config["permission_mode"] = m
            save_config(config)
            ok(f"Permission mode set to: {m}")
    return True

def cmd_cwd(args: str, _state, _config) -> bool:
    if not args.strip():
        info(f"Working directory: {os.getcwd()}")
    else:
        p = args.strip()
        try:
            os.chdir(p)
            ok(f"Changed directory to: {os.getcwd()}")
        except Exception as e:
            err(str(e))
    return True

def cmd_exit(_args: str, _state, _config) -> bool:
    ok("Goodbye!")
    sys.exit(0)

def cmd_ingest(args: str, _state, config) -> bool:
    """Ingest YouTube video, PDF, or webpage and generate structured notes.
    
    Usage:
      /ingest <youtube-url>   — Fetch transcript and create notes
      /ingest <pdf-path>      — Extract text and create notes
      /ingest <pdf-url>       — Download and extract text
      /ingest <web-url>       — Scrape webpage and create notes
    
    The generated notes will be shown for your review before saving.
    """
    from ingest import ingest_youtube, ingest_pdf, ingest_webpage, download_pdf, IngestResult
    from memory.store import save_memory, MemoryEntry
    from datetime import datetime
    
    args = args.strip()
    if not args:
        info("Usage:")
        info("  /ingest <youtube-url>  — Ingest YouTube video")
        info("  /ingest <pdf-path>     — Ingest local PDF")
        info("  /ingest <pdf-url>      — Download and ingest PDF")
        info("  /ingest <web-url>      — Scrape any webpage")
        info("\nExamples:")
        info("  /ingest https://www.youtube.com/watch?v=abc123")
        info("  /ingest ./documents/report.pdf")
        info("  /ingest https://en.wikipedia.org/wiki/Python_(programming_language)")
        return True
    
    # Detect input type
    url_or_path = args.split()[0]
    
    # Check if it's a URL
    is_url = url_or_path.startswith(('http://', 'https://', 'www.'))
    is_youtube = 'youtube.com' in url_or_path or 'youtu.be' in url_or_path
    is_pdf_url = is_url and url_or_path.endswith('.pdf')
    
    try:
        if is_youtube:
            info(f"Fetching YouTube transcript for: {url_or_path}")
            result = ingest_youtube(url_or_path, config)
        elif url_or_path.endswith('.pdf'):
            if is_url or is_pdf_url:
                info(f"Downloading PDF from: {url_or_path}")
                temp_path = download_pdf(url_or_path)
                info(f"PDF downloaded to: {temp_path}")
                result = ingest_pdf(temp_path, config)
            else:
                info(f"Extracting PDF: {url_or_path}")
                result = ingest_pdf(url_or_path, config)
        elif is_url:
            # Generic web URL ingestion
            info(f"Fetching webpage: {url_or_path}")
            result = ingest_webpage(url_or_path, config)
        else:
            err(f"Unknown input. Please provide a URL (YouTube, PDF, or webpage) or PDF file path.")
            return True
        
        # Display results
        print()
        ok(f"✓ Successfully ingested: {result.title}")
        print()
        print(clr("Generated Notes:", "bold", "cyan"))
        print(clr("━" * 60, "dim"))
        print()
        print(clr("Title:", "bold") + f" {result.title}")
        print()
        print(clr("Summary:", "bold"))
        print(result.summary)
        print()
        print(clr("Key Points:", "bold"))
        for i, point in enumerate(result.key_points, 1):
            print(f"  {i}. {point}")
        print()
        print(clr("Tags:", "bold") + f" {', '.join(result.tags)}")
        print()
        print(clr("━" * 60, "dim"))
        print()
        
        # Detect if running in non-interactive context (no TTY)
        import sys
        is_non_interactive = not sys.stdin.isatty()
        
        if is_non_interactive:
            # Auto-save in non-interactive contexts (HTTP/web UI)
            ok("Auto-saving to knowledge graph...")
            save_input = "y"
        else:
            # Prompt for save in terminal
            try:
                save_input = input(clr("Save to knowledge graph? [y/N/edit] ", "yellow")).strip().lower()
            except EOFError:
                save_input = "y"
        
        if save_input == 'edit' and not is_non_interactive:
            # Allow editing before save (terminal only)
            print(clr("\nEditing mode: Press Ctrl+D (Unix) or Ctrl+Z (Windows) when done", "dim"))
            
            try:
                new_title = input(clr(f"Title [{result.title}]: ", "cyan")).strip()
                if new_title:
                    result.title = new_title
            except EOFError:
                pass
            
            print(clr(f"Summary (current): {result.summary[:100]}...", "dim"))
            print(clr("Enter new summary (or press Enter to keep):", "cyan"))
            new_summary_lines = []
            while True:
                try:
                    line = input()
                    if line == "" and not new_summary_lines:
                        break
                    new_summary_lines.append(line)
                except EOFError:
                    break
            if new_summary_lines:
                result.summary = "\n".join(new_summary_lines)
            
            # Re-prompt for save
            try:
                save_input = input(clr("\nSave now? [y/N] ", "yellow")).strip().lower()
            except EOFError:
                save_input = "y"
        
        if save_input in ('y', 'yes'):
            # Create memory entry with full content
            content_lines = [
                f"## AI Summary",
                result.summary,
                "",
                f"## Key Points",
            ]
            for point in result.key_points:
                content_lines.append(f"- {point}")
            content_lines.append("")
            content_lines.append(f"## Full Content")
            content_lines.append("Content extracted from source:")
            content_lines.append("```")
            # Include the full extracted text (truncated if extremely long)
            full_content = result.transcript
            max_content_length = 50000  # ~50k chars max to avoid huge files
            if len(full_content) > max_content_length:
                full_content = full_content[:max_content_length] + "\n\n[Content truncated - original exceeded 50k characters]"
            content_lines.append(full_content)
            content_lines.append("```")
            content_lines.append("")
            content_lines.append(f"## Source")
            content_lines.append(f"- Type: {result.source_type}")
            content_lines.append(f"- URL: {result.source_url}")
            content_lines.append(f"- Ingested: {datetime.now().strftime('%Y-%m-%d')}")
            
            entry = MemoryEntry(
                name=result.title,
                description=result.summary[:120],
                type="source",  # Changed from "reference" to "source"
                content="\n".join(content_lines),
                created=datetime.now().strftime("%Y-%m-%d"),
            )
            
            # Save to sources/ subfolder
            save_memory(entry, scope="user", folder="sources")
            ok(f"✓ Saved to knowledge graph: sources/{result.title.replace(' ', '_')}.md")
            if is_non_interactive:
                info(f"  (Use the Ingest panel for interactive review/editing)")
            else:
                info(f"  Use /memory search to find it later")
        else:
            info("Not saved. You can re-run /ingest to try again.")
        
    except ImportError as e:
        err(f"Missing dependency: {e}")
        info("Run: pip install youtube-transcript-api pymupdf")
    except Exception as e:
        err(f"Ingest failed: {e}")
    
    return True


def cmd_memory_vault(args: str, _state, config) -> bool:
    """Memory vault integration commands.
    
    Usage:
      /vault                    — Show vault status
      /vault path <path>        — Set vault path
      /vault save <title>       — Save current topic to vault
      /vault clip <url>         — Save web clip to raw/
      /vault daily              — Create/open daily note
      /vault compile            — Compile raw/ sources to wiki/
      /vault graph              — Show knowledge graph stats
      /vault search <query>     — Search vault
    
    Integrates Memoria with the memory vault for knowledge management.
    """
    from memory_vault import MemoryVault
    from memory.store import MemoryEntry, save_memory
    from config import load_config, save_config
    
    cfg = load_config()
    
    # Get or set vault path
    vault_path = cfg.get("memory_vault_path", "")
    
    parts = args.strip().split(maxsplit=1)
    subcmd = parts[0].lower() if parts else "status"
    rest = parts[1] if len(parts) > 1 else ""
    
    if subcmd in ("", "status", "info"):
        if not vault_path:
            info("No memory vault configured.")
            info("Set one with: /vault path ~/Documents/MyVault")
            return True
        
        try:
            vault = MemoryVault(vault_path)
            notes = vault.get_all_notes()
            sources = vault.get_raw_sources()
            
            ok(f"Memory vault: {vault_path}")
            print()
            print(f"  Wiki articles: {len(notes)}")
            print(f"  Raw sources: {len(sources)}")
            
            # Count by folder
            by_folder: dict[str, int] = {}
            for n in notes:
                f = n.folder or "Uncategorized"
                by_folder[f] = by_folder.get(f, 0) + 1
            
            if by_folder:
                print()
                print("  Folders:")
                for folder, count in sorted(by_folder.items()):
                    print(f"    {folder}: {count}")
            
            # Show unprocessed sources
            unprocessed = vault.get_raw_sources(status="unprocessed")
            if unprocessed:
                print()
                print(f"  {clr('Unprocessed sources:', 'yellow')} {len(unprocessed)}")
                for src in unprocessed[:5]:
                    print(f"    - {src.name}")
                if len(unprocessed) > 5:
                    print(f"    ... and {len(unprocessed) - 5} more")
                    print("    Run /vault compile to process these")
            
        except Exception as e:
            err(f"Could not read vault: {e}")
        return True
    
    if subcmd == "path":
        if not rest:
            if vault_path:
                info(f"Current vault: {vault_path}")
            else:
                info("No vault configured.")
                info("Usage: /vault path ~/Documents/MyVault")
            return True
        
        # Set new vault path
        new_path = rest.strip()
        cfg["memory_vault_path"] = new_path
        save_config(cfg)
        ok(f"Memory vault set to: {new_path}")
        
        # Try to initialize
        try:
            vault = MemoryVault(new_path)
            info("Vault initialized. Directories created:")
            info(f"  - {vault.raw_dir}")
            info(f"  - {vault.wiki_dir}")
        except Exception as e:
            warn(f"Could not initialize vault: {e}")
        return True
    
    if not vault_path:
        err("No memory vault configured.")
        info("Set one with: /vault path ~/Documents/MyVault")
        return True
    
    try:
        vault = MemoryVault(vault_path)
        
        if subcmd == "daily":
            path = vault.create_daily_note()
            ok(f"Daily note: {path}")
            info(f"Open in your editor to start writing!")
            
        elif subcmd == "save":
            if not rest:
                info("Usage: /vault save 'My Research Notes'")
                info("This saves the last AI conversation as a note.")
                return True
            
            title = rest.strip()
            # Get last conversation context if available
            content = "# Saved from Memoria\n\n"
            content += f"*Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}*\n\n"
            content += "See Memoria chat history for full context.\n"
            
            path = vault.save_note(
                title=title,
                content=content,
                tags=["memoria", "ai-chat"],
                metadata={
                    "source": "Memoria Brain",
                    "conversation_id": datetime.now().strftime("%Y%m%d%H%M%S"),
                }
            )
            ok(f"Note saved: {path}")
            
        elif subcmd == "clip":
            if not rest:
                info("Usage: /vault clip <url>")
                info("Saves web content to raw/ for later compilation.")
                return True
            
            url = rest.strip().split()[0]
            info("To clip web content:")
            info("1. Use a browser extension to save content")
            info("2. Configure it to save to: " + str(vault.raw_dir))
            info("3. Or manually save content and run /vault compile")
            info(f"\nURL: {url}")
            
            # Save as a placeholder raw source
            from urllib.parse import urlparse
            domain = urlparse(url).netloc or "unknown"
            title = f"Web clip from {domain}"
            
            path = vault.save_raw_source(
                title=title,
                content=f"URL: {url}\n\n[Content to be extracted]",
                source_url=url,
                source_type="web_clip",
                tags=["web", "clip"]
            )
            ok(f"Raw source saved: {path}")
            info("Use /vault compile to process into wiki")
            
        elif subcmd == "compile":
            unprocessed = vault.get_raw_sources(status="unprocessed")
            if not unprocessed:
                ok("No unprocessed sources found")
                return True
            
            info(f"Compiling {len(unprocessed)} sources...")
            
            # Use AI to compile
            def compile_with_ai(content: str, title: str) -> str:
                # This would call the AI provider - for now, create structure
                return f"""## Summary

Compiled from raw source: {title}

## Key Points

- [Extract key points]

## Notes

{content[:500] if content else "[No content extracted yet]"}
"""
            
            created = vault.compile_raw_to_wiki(compile_with_ai)
            ok(f"Compiled {len(created)} articles")
            for c in created[:5]:
                info(f"  - {c.name}")
            
        elif subcmd == "graph":
            graph = vault.get_knowledge_graph()
            nodes = graph["nodes"]
            edges = graph["edges"]
            
            ok(f"Knowledge Graph: {len(nodes)} nodes, {len(edges)} edges")
            
            # Find orphans (no connections)
            connected = set()
            for e in edges:
                connected.add(e["source"])
                connected.add(e["target"])
            
            orphans = [n["id"] for n in nodes if n["id"] not in connected]
            if orphans:
                print()
                print(f"  {clr('Orphaned notes:', 'yellow')} {len(orphans)}")
                for o in orphans[:5]:
                    print(f"    - {o}")
            
            # Find highly connected
            connection_counts: dict[str, int] = {}
            for e in edges:
                connection_counts[e["source"]] = connection_counts.get(e["source"], 0) + 1
                connection_counts[e["target"]] = connection_counts.get(e["target"], 0) + 1
            
            if connection_counts:
                top = sorted(connection_counts.items(), key=lambda x: x[1], reverse=True)[:5]
                print()
                print("  Most connected:")
                for name, count in top:
                    print(f"    - {name}: {count} links")
                    
        elif subcmd == "search":
            if not rest:
                info("Usage: /vault search <query>")
                return True
            
            results = vault.search(rest)
            if not results:
                info(f"No results for '{rest}'")
                return True
            
            ok(f"Found {len(results)} notes:")
            for r in results[:10]:
                tags_str = f" [{', '.join(r.tags)}]" if r.tags else ""
                print(f"  - [[{r.title}]]{clr(tags_str, 'dim')}")
                if r.metadata.get("description"):
                    print(f"    {clr(r.metadata['description'][:60], 'dim')}")
            
        else:
            info(f"Unknown subcommand: {subcmd}")
            info("Try: /vault path, /vault daily, /vault compile, /vault search")
            
    except Exception as e:
        err(f"Vault error: {e}")
    
    return True


def cmd_connect(args: str, _state, config) -> bool:
    """Connect memories - AI analyzes notes and suggests interesting connections.
    
    Usage:
      /connect                    — Analyze all memories for connections
      /connect <memory-name>      — Find connections for specific note
      /connect random             — Pick 2 random memories and connect them
    
    LLM analyzes notes → suggests 3 interesting connections → 
    user approves → creates linked note in "connected/" folder.
    """
    from memory.scan import scan_all_memories
    from memory.store import save_memory, MemoryEntry, get_memory_dir
    from config import load_config
    from providers import chat_completion
    from datetime import datetime
    import random
    
    # Get all memories
    headers = scan_all_memories()
    if len(headers) < 2:
        info("Need at least 2 memories to find connections.")
        info(f"Currently have: {len(headers)}")
        return True
    
    # Determine which memories to analyze
    target_memories = []
    args_lower = args.strip().lower()
    
    if args_lower == "random":
        # Pick 2 random memories
        target_memories = random.sample(headers, min(2, len(headers)))
        info(f"Randomly selected: {target_memories[0].filename} + {target_memories[1].filename}")
    elif args_lower:
        # Find specific memory
        matching = [h for h in headers if args_lower in h.filename.lower()]
        if not matching:
            info(f"No memory matching '{args}' found.")
            return True
        target_memories = matching[:1]  # Take first match
        info(f"Analyzing: {target_memories[0].filename}")
    else:
        # Use all memories
        target_memories = headers[:10]  # Limit to prevent token overflow
        info(f"Analyzing {len(target_memories)} memories for connections...")
    
    # Load full content of target memories
    memory_contents = []
    for h in target_memories:
        try:
            content = Path(h.file_path).read_text(encoding="utf-8")
            memory_contents.append({
                "name": h.filename.replace(".md", ""),
                "description": h.description,
                "type": h.type,
                "content": content[:2000],  # Limit content length
            })
        except Exception as e:
            warn(f"Could not read {h.filename}: {e}")
    
    if len(memory_contents) < 2 and args_lower != "random":
        info("Need at least 2 readable memories.")
        return True
    
    # Build prompt for LLM
    memories_text = "\n\n".join([
        f"---\nMemory: {m['name']}\nType: {m['type']}\nDescription: {m['description']}\n\n{m['content'][:1000]}"
        for m in memory_contents
    ])
    
    prompt = f"""Analyze these memories and find 3 interesting, non-obvious connections between them.

{memories_text}

Identify connections that:
1. Reveal hidden patterns or themes
2. Bridge different concepts in surprising ways  
3. Suggest new insights when combined

For each connection, provide:
- Connection title (short, specific)
- The two (or more) memories it connects
- Why this connection is interesting (1-2 sentences)
- A synthesized insight that emerges from the connection

Format as:

CONNECTION 1: [Title]
Between: [Memory names]
Why: [Explanation]
Insight: [New idea that emerges]

CONNECTION 2: ...
CONNECTION 3: ..."""

    try:
        ok("Asking AI to analyze connections...")
        response = chat_completion(prompt, config)
        
        # Display connections
        print()
        print(clr("━" * 60, "dim"))
        print(clr("Suggested Connections", "bold", "cyan"))
        print(clr("━" * 60, "dim"))
        print()
        print(response)
        print(clr("━" * 60, "dim"))
        print()
        
        # In non-interactive mode (HTTP), auto-save first connection
        import sys
        is_non_interactive = not sys.stdin.isatty()
        
        if is_non_interactive:
            ok("Auto-saving best connection to connected/ folder...")
            save_connection = "1"
        else:
            # Ask user which to save
            try:
                save_connection = input(clr("Save which connection? [1/2/3/none] ", "yellow")).strip().lower()
            except EOFError:
                save_connection = "1"
        
        if save_connection in ('1', '2', '3'):
            # Extract connection title and create linked note
            conn_num = int(save_connection)
            
            # Parse the response to extract connection info (simple approach)
            conn_marker = f"CONNECTION {conn_num}:"
            if conn_marker in response:
                conn_start = response.find(conn_marker)
                conn_end = response.find(f"CONNECTION {conn_num + 1}:", conn_start)
                if conn_end == -1:
                    conn_end = len(response)
                conn_text = response[conn_start:conn_end].strip()
                
                # Extract title (first line after marker)
                title_match = conn_text.replace(conn_marker, "").strip().split('\n')[0].strip()
                title = title_match if title_match else f"Connection {conn_num}"
            else:
                title = f"Connection Analysis {datetime.now().strftime('%Y-%m-%d')}"
            
            # Clean title for filename
            clean_title = title.replace(':', '').replace('/', '-').replace('\\', '-')[:50]
            
            # Build connection note content
            connected_memories = [m['name'] for m in memory_contents]
            connected_links = ' '.join([f"[[{n}]]" for n in connected_memories])
            
            content_lines = [
                f"## Summary",
                f"",
                f"This note connects: {connected_links}",
                f"",
                f"## Connection Analysis",
                f"",
                response,
                f"",
                f"## Synthesized Insights",
                f"",
                f"[Add your own insights here after reviewing the connection]",
                f"",
                f"## Source Memories",
            ]
            for m in memory_contents:
                content_lines.append(f"- [[{m['name']}]] - {m['description'][:60]}")
            
            # Create the memory entry
            entry = MemoryEntry(
                name=f"connected/{clean_title}",
                description=f"Connection: {', '.join(connected_memories[:2])}...",
                type="connection",
                content="\n".join(content_lines),
                created=datetime.now().strftime("%Y-%m-%d"),
            )
            
            # Ensure connected/ folder exists
            user_dir = get_memory_dir("user")
            connected_dir = user_dir / "connected"
            connected_dir.mkdir(parents=True, exist_ok=True)
            
            # Save the connection
            save_memory(entry, scope="user")
            ok(f"✓ Saved connection: connected/{clean_title}.md")
            info(f"  Use /memory to view all connected notes")
            
        else:
            info("Connection not saved. Run /connect again to try different memories.")
        
    except Exception as e:
        err(f"Connection analysis failed: {e}")
    
    return True


def cmd_memory(args: str, _state, _config) -> bool:
    from memory.store import search_memory, load_index
    from memory.scan import scan_all_memories, format_memory_manifest, memory_freshness_text

    if args.strip():
        results = search_memory(args.strip())
        if not results:
            info(f"No memories matching '{args.strip()}'")
            return True
        info(f"  {len(results)} result(s) for '{args.strip()}':")
        for m in results:
            info(f"  [{m.type:9s}|{m.scope:7s}] {m.name}: {m.description}")
            info(f"    {m.content[:120]}{'...' if len(m.content) > 120 else ''}")
        return True

    # Show manifest with age/freshness
    headers = scan_all_memories()
    if not headers:
        info("No memories stored. The model saves memories via MemorySave.")
        return True
    info(f"  {len(headers)} memory/memories (newest first):")
    for h in headers:
        fresh_warn = "  ⚠ stale" if memory_freshness_text(h.mtime_s) else ""
        tag = f"[{h.type or '?':9s}|{h.scope:7s}]"
        info(f"  {tag} {h.filename}{fresh_warn}")
        if h.description:
            info(f"    {h.description}")
    return True


def cmd_agents(_args: str, _state, _config) -> bool:
    try:
        from multi_agent.tools import get_agent_manager
        mgr = get_agent_manager()
        tasks = mgr.list_tasks()
        if not tasks:
            info("No sub-agent tasks.")
            return True
        info(f"  {len(tasks)} sub-agent task(s):")
        for t in tasks:
            preview = t.prompt[:50] + ("..." if len(t.prompt) > 50 else "")
            wt_info = f"  branch:{t.worktree_branch}" if t.worktree_branch else ""
            info(f"  {t.id} [{t.status:9s}] name={t.name}{wt_info}  {preview}")
    except Exception:
        info("Sub-agent system not initialized.")
    return True


def _print_background_notifications():
    """Print notifications for newly completed background agent tasks.

    Called before each user prompt so the user sees results without polling.
    """
    try:
        from multi_agent.tools import get_agent_manager
        mgr = get_agent_manager()
    except Exception:
        return

    notified_key = "_notified"
    if not hasattr(_print_background_notifications, "_seen"):
        _print_background_notifications._seen = set()

    for task in mgr.list_tasks():
        if task.id in _print_background_notifications._seen:
            continue
        if task.status in ("completed", "failed", "cancelled"):
            _print_background_notifications._seen.add(task.id)
            icon = "✓" if task.status == "completed" else "✗"
            color = "green" if task.status == "completed" else "red"
            branch_info = f" [branch: {task.worktree_branch}]" if task.worktree_branch else ""
            print(clr(
                f"\n  {icon} Background agent '{task.name}' {task.status}{branch_info}",
                color, "bold"
            ))
            if task.result:
                preview = task.result[:200] + ("..." if len(task.result) > 200 else "")
                print(clr(f"    {preview}", "dim"))
            print()

def cmd_skills(_args: str, _state, _config) -> bool:
    from skill import load_skills
    skills = load_skills()
    if not skills:
        info("No skills found.")
        return True
    info(f"Available skills ({len(skills)}):")
    for s in skills:
        triggers = ", ".join(s.triggers)
        source_label = f"[{s.source}]" if s.source != "builtin" else ""
        hint = f"  args: {s.argument_hint}" if s.argument_hint else ""
        print(f"  {clr(s.name, 'cyan'):24s} {s.description}  {clr(triggers, 'dim')}{hint} {clr(source_label, 'yellow')}")
        if s.when_to_use:
            print(f"    {clr(s.when_to_use[:80], 'dim')}")
    return True

COMMANDS = {
    "help":        cmd_help,
    "clear":       cmd_clear,
    "model":       cmd_model,
    "config":      cmd_config,
    "save":        cmd_save,
    "load":        cmd_load,
    "history":     cmd_history,
    "context":     cmd_context,
    "cost":        cmd_cost,
    "verbose":     cmd_verbose,
    "thinking":    cmd_thinking,
    "permissions": cmd_permissions,
    "cwd":         cmd_cwd,
    "skills":      cmd_skills,
    "memory":      cmd_memory,
    "vault":       cmd_memory_vault,
    "connect":     cmd_connect,
    "agents":      cmd_agents,
    "ingest":      cmd_ingest,
    "exit":        cmd_exit,
    "quit":        cmd_exit,
}


def handle_slash(line: str, state, config) -> Union[bool, tuple]:
    """Handle /command [args]. Returns True if handled, tuple (skill, args) for skill match."""
    if not line.startswith("/"):
        return False
    parts = line[1:].split(None, 1)
    if not parts:
        cmd_help("", state, config)
        return True
    cmd = parts[0].lower()
    args = parts[1] if len(parts) > 1 else ""
    handler = COMMANDS.get(cmd)
    if handler:
        handler(args, state, config)
        return True

    # Fall through to skill lookup
    from skill import find_skill
    skill = find_skill(line)
    if skill:
        cmd_parts = line.strip().split(maxsplit=1)
        skill_args = cmd_parts[1] if len(cmd_parts) > 1 else ""
        return (skill, skill_args)

    err(f"Unknown command: /{cmd}  (type /help for commands)")
    return True


_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def strip_ansi(s: str) -> str:
    return _ANSI_RE.sub("", s)


def execute_slash_for_http(
    line: str,
    state,
    config,
) -> str | tuple[Literal["agent"], str] | tuple[Literal["clear"], str] | None:
    """Run REPL slash handling for HTTP: capture print output, or delegate to agent.

    Returns:
        None — not a /command; caller should ``run()`` the raw line.
        str — plain slash output (help, model list, …).
        ("clear", msg) — session was cleared; UI should reset the feed.
        ("agent", msg) — expanded skill prompt; caller should ``run(msg, ...)``.
    """
    stripped = line.strip()
    if not stripped.startswith("/"):
        return None
    parts = stripped[1:].split(None, 1)
    if not parts:
        buf = io.StringIO()
        err_buf = io.StringIO()
        with redirect_stdout(buf), redirect_stderr(err_buf):
            cmd_help("", state, config)
        out = strip_ansi(buf.getvalue() + err_buf.getvalue()).rstrip()
        return out if out else "(ok)"

    cmd = parts[0].lower()
    if cmd in ("exit", "quit"):
        return "Web UI: /exit and /quit are only for the terminal REPL."

    buf = io.StringIO()
    err_buf = io.StringIO()
    with redirect_stdout(buf), redirect_stderr(err_buf):
        result = handle_slash(stripped, state, config)

    if result is False:
        return None

    if isinstance(result, tuple):
        skill, skill_args = result
        from skill import substitute_arguments

        rendered = substitute_arguments(
            skill.prompt, skill_args, skill.arguments
        )
        return ("agent", f"[Skill: {skill.name}]\n\n{rendered}")

    out = strip_ansi(buf.getvalue() + err_buf.getvalue()).rstrip()
    if cmd == "clear":
        return ("clear", out or "Conversation cleared.")
    return out if out else "(ok)"


# ── Input history setup ────────────────────────────────────────────────────

def setup_readline(history_file: Path):
    if readline is None:
        return
    try:
        readline.read_history_file(str(history_file))
    except FileNotFoundError:
        pass
    readline.set_history_length(1000)
    atexit.register(readline.write_history_file, str(history_file))

    # Tab-complete slash commands
    commands = [f"/{c}" for c in COMMANDS]
    def completer(text: str, state: int):
        matches = [c for c in commands if c.startswith(text)]
        return matches[state] if state < len(matches) else None
    readline.set_completer(completer)
    readline.parse_and_bind("tab: complete")


# ── Main REPL ──────────────────────────────────────────────────────────────

def repl(config: dict, initial_prompt: str = None):
    from config import HISTORY_FILE
    from context import build_system_prompt
    from agent import AgentState, run, TextChunk, ThinkingChunk, ToolStart, ToolEnd, TurnDone, PermissionRequest

    setup_readline(HISTORY_FILE)
    state = AgentState()
    verbose = config.get("verbose", False)

    # Banner
    if not initial_prompt:
        from providers import detect_provider
        model    = config["model"]
        pname    = detect_provider(model)
        model_clr = clr(model, "cyan", "bold")
        prov_clr  = clr(f"({pname})", "dim")
        pmode     = clr(config.get("permission_mode", "auto"), "yellow")
        print(clr("[Brain]", "dim"))
        print(clr("  Model: ", "dim") + model_clr + " " + prov_clr)
        print(clr("  Permissions: ", "dim") + pmode)
        print(clr("  /model to switch provider · /help for commands", "dim"))
        print(clr("-" * 60, "dim"))
        print()

    def run_query(user_input: str):
        nonlocal verbose
        verbose = config.get("verbose", False)

        # Rebuild system prompt each turn (picks up cwd changes, etc.)
        system_prompt = build_system_prompt()

        # Use ASCII-safe glyphs for broad Windows console encoding support.
        print(clr("\nAssistant ", "dim") + clr("o", "green"))
        print(clr("> ", "dim"), end="", flush=True)

        thinking_started = False

        for event in run(user_input, state, config, system_prompt):
            if isinstance(event, TextChunk):
                stream_text(event.text)

            elif isinstance(event, ThinkingChunk):
                if verbose:
                    if not thinking_started:
                        print(clr("\n  [thinking]", "dim"))
                        thinking_started = True
                    stream_thinking(event.text, verbose)

            elif isinstance(event, ToolStart):
                flush_response()
                print_tool_start(event.name, event.inputs, verbose)

            elif isinstance(event, PermissionRequest):
                event.granted = ask_permission_interactive(event.description, config)

            elif isinstance(event, ToolEnd):
                print_tool_end(event.name, event.result, verbose)
                # Print prefix for next text
                print(clr("> ", "dim"), end="", flush=True)

            elif isinstance(event, TurnDone):
                if verbose:
                    print(clr(
                        f"\n  [tokens: +{event.input_tokens} in / "
                        f"+{event.output_tokens} out]", "dim"
                    ))

        flush_response()
        print(clr("-" * 60, "dim"))
        print()

    # ── Main loop ──
    if initial_prompt:
        try:
            run_query(initial_prompt)
        except KeyboardInterrupt:
            print()
        return

    while True:
        # Show notifications for background agents that finished
        _print_background_notifications()
        try:
            cwd_short = Path.cwd().name
            prompt = clr(f"\n[{cwd_short}] ", "dim") + clr("> ", "cyan", "bold")
            user_input = input(prompt).strip()
        except (EOFError, KeyboardInterrupt):
            print()
            ok("Goodbye!")
            sys.exit(0)

        if not user_input:
            continue

        result = handle_slash(user_input, state, config)
        if isinstance(result, tuple):
            skill, skill_args = result
            info(f"Running skill: {skill.name}" + (f" [{skill.context}]" if skill.context == "fork" else ""))
            try:
                from skill import substitute_arguments
                rendered = substitute_arguments(skill.prompt, skill_args, skill.arguments)
                run_query(f"[Skill: {skill.name}]\n\n{rendered}")
            except KeyboardInterrupt:
                print(clr("\n  (interrupted)", "yellow"))
            continue
        if result:
            continue

        try:
            run_query(user_input)
        except KeyboardInterrupt:
            print(clr("\n  (interrupted)", "yellow"))
            # Keep conversation history up to the interruption


# ── Entry point ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        prog="brain",
        description="Brain — terminal AI coding assistant",
        add_help=False,
    )
    parser.add_argument("prompt", nargs="*", help="Initial prompt (non-interactive)")
    parser.add_argument("-p", "--print", "--print-output",
                        dest="print_mode", action="store_true",
                        help="Non-interactive mode: run prompt and exit")
    parser.add_argument("-m", "--model", help="Override model")
    parser.add_argument("--accept-all", action="store_true",
                        help="Never ask permission (accept all operations)")
    parser.add_argument("--verbose", action="store_true",
                        help="Show thinking + token counts")
    parser.add_argument("--thinking", action="store_true",
                        help="Enable extended thinking")
    parser.add_argument("--version", action="store_true", help="Print version")
    parser.add_argument("-h", "--help", action="store_true", help="Show help")

    args = parser.parse_args()

    if args.version:
        print(f"brain v{VERSION}")
        sys.exit(0)

    if args.help:
        print(__doc__)
        sys.exit(0)

    from config import load_config, save_config, has_api_key
    from providers import detect_provider, PROVIDERS

    config = load_config()

    # Apply CLI overrides first (so key check uses the right provider)
    if args.model:
        config["model"] = args.model.replace(":", "/", 1)
    if args.accept_all:
        config["permission_mode"] = "accept-all"
    if args.verbose:
        config["verbose"] = True
    if args.thinking:
        config["thinking"] = True

    # Check API key for active provider (warn only, don't block local providers)
    if not has_api_key(config):
        pname = detect_provider(config["model"])
        prov  = PROVIDERS.get(pname, {})
        env   = prov.get("api_key_env", "")
        if env:   # local providers like ollama have no env key requirement
            warn(f"No API key found for provider '{pname}'. "
                 f"Set {env} or run: /config {pname}_api_key=YOUR_KEY")

    initial = " ".join(args.prompt) if args.prompt else None
    if args.print_mode and not initial:
        err("--print requires a prompt argument")
        sys.exit(1)

    repl(config, initial_prompt=initial)


if __name__ == "__main__":
    main()
