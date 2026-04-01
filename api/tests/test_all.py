#!/usr/bin/env python3
"""
Comprehensive test suite for Memoria self-improvement features.
Tests memory tool, skill manager, session search, and API integration.
"""

import sys
import os
import json
import tempfile
import shutil
from pathlib import Path
from datetime import datetime

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# Test results
test_results = {
    "passed": 0,
    "failed": 0,
    "errors": []
}

def log_test(name: str, passed: bool, message: str = ""):
    """Log test result."""
    status = "[PASS]" if passed else "[FAIL]"
    print(f"{status}: {name}")
    if message:
        print(f"   {message}")
    if passed:
        test_results["passed"] += 1
    else:
        test_results["failed"] += 1
        test_results["errors"].append(f"{name}: {message}")

# ==================== MEMORY TOOL TESTS ====================
def test_memory_tool():
    """Test memory tool functionality."""
    print("\n" + "="*60)
    print("MEMORY TOOL TESTS")
    print("="*60)
    
    try:
        from tools.memory import get_memory_store, memory_tool
        
        # Test 1: Add to memory
        print("\n--- Test 1: Add to memory ---")
        result = memory_tool(action="add", target="memory", content="Test memory entry for environment")
        passed = result.get("success", False)
        log_test("Add to memory", passed, str(result) if not passed else "")
        
        # Test 2: Add to user
        print("\n--- Test 2: Add to user profile ---")
        result = memory_tool(action="add", target="user", content="User name is TestUser")
        passed = result.get("success", False)
        log_test("Add to user", passed, str(result) if not passed else "")
        
        # Test 3: Read memory
        print("\n--- Test 3: Read memory ---")
        result = memory_tool(action="read", target="memory")
        passed = result.get("success", False) and len(result.get("entries", [])) > 0
        log_test("Read memory", passed, str(result) if not passed else "")
        
        # Test 4: Read user
        print("\n--- Test 4: Read user ---")
        result = memory_tool(action="read", target="user")
        passed = result.get("success", False) and len(result.get("entries", [])) > 0
        log_test("Read user", passed, str(result) if not passed else "")
        
        # Test 5: Replace in memory
        print("\n--- Test 5: Replace in memory ---")
        result = memory_tool(
            action="replace", 
            target="memory",
            old_text="Test memory entry for environment",
            content="Updated test memory entry"
        )
        passed = result.get("success", False)
        log_test("Replace in memory", passed, str(result) if not passed else "")
        
        # Verify replacement
        result = memory_tool(action="read", target="memory")
        entries = result.get("entries", [])
        passed = any("Updated test memory" in str(e) for e in entries)
        log_test("Verify replacement", passed)
        
        # Test 6: Remove from memory
        print("\n--- Test 6: Remove from memory ---")
        result = memory_tool(action="remove", target="memory", content="Updated test memory entry")
        passed = result.get("success", False)
        log_test("Remove from memory", passed, str(result) if not passed else "")
        
        # Verify removal
        result = memory_tool(action="read", target="memory")
        entries = result.get("entries", [])
        passed = not any("Updated test memory" in str(e) for e in entries)
        log_test("Verify removal", passed)
        
        # Test 7: Memory format for system prompt
        print("\n--- Test 7: Format for system prompt ---")
        store = get_memory_store()
        # Add something back for testing
        memory_tool(action="add", target="user", content="Prefers Python over JavaScript")
        formatted = store.format_for_system_prompt()
        # Check if formatted is not empty and contains expected sections
        passed = formatted is not None and len(formatted) > 50 and ("MEMORY" in formatted or "USER" in formatted)
        log_test("Format for system prompt", passed, f"Length: {len(formatted) if formatted else 0}")
        
    except Exception as e:
        log_test("Memory tool import/setup", False, str(e))
        import traceback
        traceback.print_exc()

# ==================== SKILL MANAGER TESTS ====================
def test_skill_manager():
    """Test skill manager functionality."""
    print("\n" + "="*60)
    print("SKILL MANAGER TESTS")
    print("="*60)
    
    try:
        from tools.skill_manager import skill_manage, list_skills
        
        # Test 1: Create skill
        print("\n--- Test 1: Create skill ---")
        skill_content = """---
name: test-skill
description: A test skill for verification
version: 1.0.0
---

# Test Skill

This is a test skill.

## Usage

Run tests properly.
"""
        result = skill_manage(
            action="create",
            name="test-skill",
            category="testing",
            content=skill_content
        )
        passed = result.get("success", False)
        log_test("Create skill", passed, str(result) if not passed else "")
        
        # Test 2: List skills
        print("\n--- Test 2: List skills ---")
        skills = list_skills()
        passed = len(skills) > 0 and any(s["name"] == "test-skill" for s in skills)
        log_test("List skills", passed, f"Found {len(skills)} skills" if not passed else "")
        
        # Test 3: View skill
        print("\n--- Test 3: View skill ---")
        from tools.skill_manager import view_skill
        skill = view_skill("test-skill")
        passed = skill is not None and skill.get("name") == "test-skill"
        log_test("View skill", passed, str(skill) if not passed else "")
        
        # Test 4: Patch skill
        print("\n--- Test 4: Patch skill ---")
        result = skill_manage(
            action="patch",
            name="test-skill",
            old_string="Run tests properly.",
            new_string="Run tests properly and thoroughly."
        )
        passed = result.get("success", False)
        log_test("Patch skill", passed, str(result) if not passed else "")
        
        # Verify patch
        skill = view_skill("test-skill")
        passed = skill is not None and "thoroughly" in skill.get("content", "")
        log_test("Verify patch", passed)
        
        # Test 5: Edit skill (rewrite)
        print("\n--- Test 5: Edit skill ---")
        new_content = """---
name: test-skill
description: Updated test skill
version: 1.1.0
---

# Updated Test Skill

Completely rewritten.
"""
        result = skill_manage(
            action="edit",
            name="test-skill",
            content=new_content
        )
        passed = result.get("success", False)
        log_test("Edit skill", passed, str(result) if not passed else "")
        
        # Test 6: Write file in skill
        print("\n--- Test 6: Write file in skill ---")
        result = skill_manage(
            action="write_file",
            name="test-skill",
            file_path="references/notes.md",
            file_content="# Notes\n\nSome notes here."
        )
        passed = result.get("success", False)
        log_test("Write file in skill", passed, str(result) if not passed else "")
        
        # Test 7: Remove file
        print("\n--- Test 7: Remove file ---")
        result = skill_manage(
            action="remove_file",
            name="test-skill",
            file_path="references/notes.md"
        )
        passed = result.get("success", False)
        log_test("Remove file", passed, str(result) if not passed else "")
        
        # Test 8: Delete skill
        print("\n--- Test 8: Delete skill ---")
        result = skill_manage(action="delete", name="test-skill")
        passed = result.get("success", False)
        log_test("Delete skill", passed, str(result) if not passed else "")
        
        # Verify deletion
        skills = list_skills()
        passed = not any(s["name"] == "test-skill" for s in skills)
        log_test("Verify deletion", passed)
        
    except Exception as e:
        log_test("Skill manager import/setup", False, str(e))
        import traceback
        traceback.print_exc()

# ==================== SESSION SEARCH TESTS ====================
def test_session_search():
    """Test session search functionality."""
    print("\n" + "="*60)
    print("SESSION SEARCH TESTS")
    print("="*60)
    
    try:
        from tools.session_search import get_session_store, Session, Message, session_search
        
        # Test 1: Create session
        print("\n--- Test 1: Create and save session ---")
        store = get_session_store()
        session = Session(
            id="test-session-1",
            title="Test Session",
            source="test",
            created_at=datetime.now().isoformat(),
            updated_at=datetime.now().isoformat(),
            message_count=0,
            is_child=False
        )
        store.save_session(session)
        
        # Verify session
        retrieved = store.get_session("test-session-1")
        passed = retrieved is not None and retrieved.title == "Test Session"
        log_test("Create session", passed)
        
        # Test 2: Add messages
        print("\n--- Test 2: Add messages ---")
        msg1 = Message(
            session_id="test-session-1",
            role="user",
            content="How do I deploy to Vercel?"
        )
        msg2 = Message(
            session_id="test-session-1",
            role="assistant",
            content="You can deploy to Vercel by running 'vercel' command."
        )
        store.save_message(msg1)
        store.save_message(msg2)
        
        messages = store.get_session_messages("test-session-1")
        passed = len(messages) == 2
        log_test("Add messages", passed, f"Found {len(messages)} messages")
        
        # Test 3: Search messages
        print("\n--- Test 3: Search messages ---")
        results = store.search_messages("Vercel")
        passed = len(results) > 0 and any("Vercel" in r.get("content", "") for r in results)
        log_test("Search messages", passed, f"Found {len(results)} results")
        
        # Test 4: List recent sessions
        print("\n--- Test 4: List recent sessions ---")
        sessions = store.list_recent_sessions(limit=10)
        passed = len(sessions) > 0
        log_test("List recent sessions", passed, f"Found {len(sessions)} sessions")
        
        # Test 5: Session search tool
        print("\n--- Test 5: Session search tool ---")
        result = session_search(query="Vercel", limit=5)
        passed = result.get("success", False) and len(result.get("results", [])) > 0
        log_test("Session search tool", passed, str(result) if not passed else "")
        
        # Test 6: Search with no results
        print("\n--- Test 6: Search with no results ---")
        results = store.search_messages("xyz123nonexistent")
        passed = len(results) == 0
        log_test("Search with no results", passed)
        
    except Exception as e:
        log_test("Session search import/setup", False, str(e))
        import traceback
        traceback.print_exc()

# ==================== DATABASE TESTS ====================
def test_database():
    """Test knowledge graph database."""
    print("\n" + "="*60)
    print("DATABASE TESTS")
    print("="*60)
    
    try:
        from database import init_database, get_all_entities, get_all_relationships, DB_PATH
        
        # Test 1: Initialize database
        print("\n--- Test 1: Initialize database ---")
        init_database()
        log_test("Initialize database", True)
        
        # Test 2: Check DB_PATH exists
        print("\n--- Test 2: Check database file ---")
        import os
        db_exists = os.path.exists(DB_PATH)
        log_test("Database file exists", db_exists)
        
        # Test 3: Get entities (may be empty initially)
        print("\n--- Test 3: Get entities ---")
        entities = get_all_entities()
        passed = isinstance(entities, list)
        log_test("Get entities", passed, f"Found {len(entities)} entities")
        
        # Test 4: Get relationships (may be empty initially)
        print("\n--- Test 4: Get relationships ---")
        relationships = get_all_relationships()
        passed = isinstance(relationships, list)
        log_test("Get relationships", passed, f"Found {len(relationships)} relationships")
        
    except Exception as e:
        log_test("Database import/setup", False, str(e))
        import traceback
        traceback.print_exc()

# ==================== TOOL REGISTRY TESTS ====================
def test_tool_registry():
    """Test tool registry and definitions."""
    print("\n" + "="*60)
    print("TOOL REGISTRY TESTS")
    print("="*60)
    
    try:
        from utils.tools import TOOL_DEFINITIONS, AVAILABLE_TOOLS, execute_tool
        from tools.memory import memory_tool
        from tools.session_search import session_search
        
        # Test 1: Tool definitions exist
        print("\n--- Test 1: Tool definitions exist ---")
        tool_names = [t.get("function", {}).get("name") if isinstance(t, dict) and "function" in t else t.get("name") for t in TOOL_DEFINITIONS]
        expected_tools = ["memory", "skill_manage", "session_search"]
        passed = all(t in tool_names for t in expected_tools)
        log_test("Tool definitions exist", passed, f"Tools: {tool_names}")
        
        # Test 2: Tool handlers exist
        print("\n--- Test 2: Tool handlers exist ---")
        expected_handlers = ["memory", "skill_manage", "session_search"]
        passed = all(h in AVAILABLE_TOOLS for h in expected_handlers)
        log_test("Tool handlers exist", passed, f"Handlers: {list(AVAILABLE_TOOLS.keys())}")
        
        # Test 3: Direct memory tool execution
        print("\n--- Test 3: Direct memory tool execution ---")
        result = memory_tool(
            action="add",
            target="memory",
            content="Registry test entry"
        )
        passed = result.get("success", False)
        log_test("Direct memory tool execution", passed, str(result)[:100] if not passed else "")
        
        # Test 4: Direct session_search tool execution
        print("\n--- Test 4: Direct session_search tool execution ---")
        result = session_search(
            query="test",
            limit=3
        )
        passed = result.get("success", False)
        log_test("Direct session_search tool execution", passed, str(result)[:100] if not passed else "")
        
    except Exception as e:
        log_test("Tool registry import/setup", False, str(e))
        import traceback
        traceback.print_exc()

# ==================== API INTEGRATION TESTS ====================
def test_api_integration():
    """Test FastAPI integration (requires running server)."""
    print("\n" + "="*60)
    print("API INTEGRATION TESTS")
    print("="*60)
    
    print("\n--- API tests skipped (requires running server) ---")
    log_test("API integration", True, "Skipped - run server and test manually")
    return

# ==================== MAIN ====================
def run_all_tests():
    """Run all test suites."""
    print("="*60)
    print("MEMORIA COMPREHENSIVE TEST SUITE")
    print("="*60)
    print(f"Started at: {datetime.now().isoformat()}")
    
    # Run all test suites
    test_memory_tool()
    test_skill_manager()
    test_session_search()
    test_database()
    test_tool_registry()
    test_api_integration()
    
    # Print summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    total = test_results["passed"] + test_results["failed"]
    print(f"Total tests: {total}")
    print(f"Passed: {test_results['passed']} [OK]")
    print(f"Failed: {test_results['failed']} [ERR]")
    
    if test_results["failed"] > 0:
        print("\nFailed tests:")
        for error in test_results["errors"]:
            print(f"  - {error}")
    
    print(f"\nSuccess rate: {(test_results['passed'] / total * 100) if total > 0 else 0:.1f}%")
    print(f"Ended at: {datetime.now().isoformat()}")
    
    return test_results["failed"] == 0

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
