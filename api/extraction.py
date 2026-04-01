"""Entity and relationship extraction service using LLM.

This module re-exports the smart extraction functionality from extraction_v2.
"""

from typing import List, Dict, Any
from .extraction_v2 import (
    extract_entities_from_transcript,
    find_duplicate_entities,
    find_semantic_duplicates,
    normalize_entity_name,
    calculate_entity_confidence,
    ExtractionResult,
    ExtractedEntity,
    ExtractedRelationship,
    EntityType,
    RelationType
)


__all__ = [
    "extract_entities_from_transcript",
    "find_duplicate_entities",
    "find_semantic_duplicates",
    "normalize_entity_name",
    "calculate_entity_confidence",
    "ExtractionResult",
    "ExtractedEntity",
    "ExtractedRelationship",
    "EntityType",
    "RelationType"
]
