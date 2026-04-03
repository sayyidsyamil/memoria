"""Unified frontmatter parsing utilities for Brain.

Provides a single, consistent way to parse YAML-style frontmatter from markdown files.
"""
from __future__ import annotations

import json
import re
from typing import Tuple


def parse_frontmatter(text: str) -> Tuple[dict, str]:
    """Parse ---\nkey: value\n---\nbody format from markdown files.

    Args:
        text: The full markdown text to parse

    Returns:
        Tuple of (metadata_dict, body_content)
    """
    if not text.startswith("---"):
        return {}, text

    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text

    meta: dict = {}
    for line in parts[1].strip().splitlines():
        if ":" in line:
            key, _, val = line.partition(":")
            meta[key.strip()] = val.strip()

    return meta, parts[2].strip()


def parse_frontmatter_advanced(text: str) -> Tuple[dict, str]:
    """Parse frontmatter with support for lists and more complex types.

    Args:
        text: The full markdown text to parse

    Returns:
        Tuple of (metadata_dict, body_content)
    """
    if not text.startswith("---"):
        return {}, text

    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text

    yaml_text = parts[1].strip()
    body = parts[2].strip()

    result: dict = {}
    current_key = None
    current_list = None

    for line in yaml_text.split("\n"):
        line = line.rstrip()
        if not line:
            continue

        # Check for list item (indented with "  - ")
        if line.startswith("  - "):
            if current_list is not None:
                current_list.append(line[4:].strip())
            continue

        # Regular key: value
        if ":" in line:
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip() if val else ""

            current_key = key

            # Check if it's a list start (value is empty)
            if not val:
                current_list = []
                result[key] = current_list
            else:
                # Strip quotes if present
                if val.startswith('"') and val.endswith('"'):
                    val = val[1:-1]
                elif val.startswith("'") and val.endswith("'"):
                    val = val[1:-1]

                # Try to parse as list if looks like one
                if val.startswith("[") and val.endswith("]"):
                    try:
                        result[key] = json.loads(val)
                    except (json.JSONDecodeError, ValueError):
                        result[key] = val
                else:
                    result[key] = val
                current_list = None

    return result, body


def parse_yaml_list(value: str) -> list[str]:
    """Parse YAML-like list: ``[a, b, c]`` or ``"a, b, c"``.

    Args:
        value: String representation of a list

    Returns:
        List of parsed string items
    """
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
    return [item.strip().strip('"').strip("'") for item in value.split(",") if item.strip()]
