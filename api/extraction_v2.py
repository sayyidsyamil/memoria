"""Smart entity and relationship extraction service using LLM.

This module provides intelligent knowledge extraction with:
- Confidence scoring and quality filtering
- Semantic entity deduplication
- Relationship validation
- Smart entity normalization
"""

import os
import json
import re
import difflib
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
from openai import OpenAI


# ============================================================================
# ENTITY TAXONOMY - Structured entity types for better organization
# ============================================================================

class EntityType(str, Enum):
    """Standardized entity types for consistent knowledge graph structure."""
    PERSON = "person"
    ORGANIZATION = "organization"
    COMPANY = "company"
    PRODUCT = "product"
    TECHNOLOGY = "technology"
    CONCEPT = "concept"
    LOCATION = "location"
    EVENT = "event"
    FIELD = "field"  # Academic/professional field
    FRAMEWORK = "framework"
    PROTOCOL = "protocol"
    STANDARD = "standard"
    PLATFORM = "platform"
    SERVICE = "service"
    ROLE = "role"  # Job title, position
    CURRENCY = "currency"
    METRIC = "metric"
    INDUSTRY = "industry"
    COUNTRY = "country"
    CITY = "city"
    REGION = "region"
    CONTINENT = "continent"
    MISC = "misc"


# Entity type descriptions for the LLM
ENTITY_TYPE_DESCRIPTIONS = {
    EntityType.PERSON: "Individual people, historical figures, experts, authors",
    EntityType.ORGANIZATION: "Companies, institutions, government bodies, NGOs",
    EntityType.COMPANY: "Business entities, corporations, startups",
    EntityType.PRODUCT: "Physical or digital products, tools, applications",
    EntityType.TECHNOLOGY: "Technical methods, algorithms, techniques",
    EntityType.CONCEPT: "Abstract ideas, theories, principles, methodologies",
    EntityType.LOCATION: "Specific places, landmarks, facilities",
    EntityType.EVENT: "Conferences, historical events, product launches, periods",
    EntityType.FIELD: "Academic disciplines, industries, domains of study",
    EntityType.FRAMEWORK: "Software frameworks, development frameworks, models",
    EntityType.PROTOCOL: "Communication protocols, standards, procedures",
    EntityType.PLATFORM: "Operating systems, cloud platforms, infrastructure",
    EntityType.SERVICE: "Online services, APIs, cloud services",
    EntityType.ROLE: "Job titles, positions, professional roles",
    EntityType.COUNTRY: "Nations, states",
    EntityType.CITY: "Cities, towns, municipalities",
    EntityType.REGION: "Geographic regions, states, provinces",
    EntityType.MISC: "Other important entities that don't fit above categories"
}


# ============================================================================
# RELATIONSHIP TYPES - Semantically meaningful relationship categories
# ============================================================================

class RelationType(str, Enum):
    """Standardized relationship types for the knowledge graph."""
    IS_A = "is_a"                    # Generalization/specialization
    PART_OF = "part_of"              # Component relationship
    LOCATED_IN = "located_in"        # Geographic containment
    FOUNDED_BY = "founded_by"        # Creation/causation
    CREATED_BY = "created_by"        # Authorship/invention
    MANAGES = "manages"              # Leadership/governance
    OWNS = "owns"                    # Ownership
    USES = "uses"                    # Utilization
    DEPENDS_ON = "depends_on"        # Dependency
    RELATED_TO = "related_to"        # General association
    COMPETES_WITH = "competes_with"  # Opposition/competition
    COLLABORATES_WITH = "collaborates_with"  # Partnership
    PRODUCES = "produces"            # Output/generation
    IMPLEMENTS = "implements"        # Realization/implementation
    EXTENDS = "extends"              # Extension/inheritance
    PRECEDES = "precedes"            # Temporal ordering
    INFLUENCED_BY = "influenced_by"  # Causation/influence
    WORKS_AT = "works_at"            # Employment
    MEMBER_OF = "member_of"          # Membership
    SUBSET_OF = "subset_of"          # Set inclusion


# Relationship type descriptions for the LLM
RELATION_TYPE_DESCRIPTIONS = {
    RelationType.IS_A: "Generalization - X is a type of Y",
    RelationType.PART_OF: "Composition - X is a component/part of Y",
    RelationType.LOCATED_IN: "Geographic - X is physically located within Y",
    RelationType.FOUNDED_BY: "Creation - X was founded/established by Y",
    RelationType.CREATED_BY: "Authorship - X was created/authored by Y",
    RelationType.MANAGES: "Leadership - X is managed/led by Y",
    RelationType.OWNS: "Ownership - X is owned by Y",
    RelationType.USES: "Utilization - X uses/utilizes Y",
    RelationType.DEPENDS_ON: "Dependency - X depends on/requires Y",
    RelationType.RELATED_TO: "Association - X is related to Y (use sparingly)",
    RelationType.COMPETES_WITH: "Competition - X competes with Y",
    RelationType.COLLABORATES_WITH: "Partnership - X collaborates with Y",
    RelationType.PRODUCES: "Output - X produces/generates Y",
    RelationType.IMPLEMENTS: "Realization - X implements/realizes Y",
    RelationType.EXTENDS: "Extension - X extends/builds upon Y",
    RelationType.PRECEDES: "Sequence - X comes before/precedes Y",
    RelationType.INFLUENCED_BY: "Influence - X is influenced by Y",
    RelationType.WORKS_AT: "Employment - X works at/employed by Y",
    RelationType.MEMBER_OF: "Membership - X is a member of Y",
    RelationType.SUBSET_OF: "Inclusion - X is a subset of Y"
}


# ============================================================================
# DATA MODELS
# ============================================================================

@dataclass
class ExtractedEntity:
    """Represents an entity extracted from text."""
    name: str
    type: str
    description: str
    confidence: float = 0.0
    sources: List[str] = field(default_factory=list)
    id: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "description": self.description,
            "confidence": self.confidence,
            "sources": self.sources
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExtractedEntity":
        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            type=data.get("type", ""),
            description=data.get("description", ""),
            confidence=data.get("confidence", 0.0),
            sources=data.get("sources", [])
        )


@dataclass
class ExtractedRelationship:
    """Represents a relationship between entities."""
    source: str
    target: str
    type: str
    description: str
    confidence: float = 0.0
    id: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source,
            "target": self.target,
            "type": self.type,
            "description": self.description,
            "confidence": self.confidence
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExtractedRelationship":
        return cls(
            id=data.get("id", ""),
            source=data.get("source", ""),
            target=data.get("target", ""),
            type=data.get("type", ""),
            description=data.get("description", ""),
            confidence=data.get("confidence", 0.0)
        )


@dataclass
class ExtractionResult:
    """Complete extraction result from a transcript."""
    entities: List[ExtractedEntity]
    relationships: List[ExtractedRelationship]
    quality_score: float = 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "entities": [e.to_dict() for e in self.entities],
            "relationships": [r.to_dict() for r in self.relationships],
            "quality_score": self.quality_score
        }


# ============================================================================
# ENTITY NORMALIZATION
# ============================================================================

# Common entity name corrections and normalizations
ENTITY_NORMALIZATIONS = {
    # Acronyms and their standard forms
    "kscc": "KLCC",
    "klcc": "KLCC",
    "klcc property holdings": "KLCC Property Holdings",
    "menara berkembar": "Petronas Towers",
    "petronas twin towers": "Petronas Towers",
    "petronas towers": "Petronas Towers",
    "trx": "Tun Razak Exchange",
    "tun razak exchange": "Tun Razak Exchange",
    
    # Common misspellings
    "rits": "REIT",
    "ritz": "Ritz-Carlton",
    "reit": "REIT",
    "real estate investment trust": "REIT",
    "jamsat": "Webinar",
    "bioml studio": "BioML Studio",
    
    # Technology terms
    "machine learning": "Machine Learning",
    "deep learning": "Deep Learning",
    "artificial intelligence": "Artificial Intelligence",
    "ai": "Artificial Intelligence",
    "neural network": "Neural Network",
    "neural networks": "Neural Networks",
    "natural language processing": "Natural Language Processing",
    "nlp": "Natural Language Processing",
    
    # Companies and products
    "tensorflow": "TensorFlow",
    "pytorch": "PyTorch",
    "openai": "OpenAI",
    "chatgpt": "ChatGPT",
    "github": "GitHub",
    "aws": "Amazon Web Services",
    "amazon web services": "Amazon Web Services",
    "gcp": "Google Cloud Platform",
    "azure": "Microsoft Azure",
}


def normalize_entity_name(name: str) -> Tuple[str, float]:
    """Normalize an entity name and return confidence adjustment.
    
    Returns: (normalized_name, confidence_adjustment)
    """
    original = name
    name_lower = name.lower().strip()
    
    # Check for exact match in normalizations
    if name_lower in ENTITY_NORMALIZATIONS:
        return ENTITY_NORMALIZATIONS[name_lower], 0.1  # Boost confidence
    
    # Check for partial match (for longer names)
    for key, value in ENTITY_NORMALIZATIONS.items():
        if key in name_lower or name_lower in key:
            return value, 0.05
    
    return original, 0.0


def clean_description(desc: str) -> str:
    """Clean and improve entity descriptions."""
    # Remove filler phrases
    fillers = [
        "refers to ", "is defined as ", "can be described as ",
        "is a term for ", "means ", "is essentially ",
        "basically ", "essentially ", "in simple terms "
    ]
    desc_lower = desc.lower()
    for filler in fillers:
        if desc_lower.startswith(filler):
            desc = desc[len(filler):]
            desc_lower = desc.lower()
    
    # Capitalize first letter
    if desc:
        desc = desc[0].upper() + desc[1:]
    
    # Remove trailing period if present (we add it later)
    desc = desc.rstrip(". ")
    
    return desc


# ============================================================================
# SMART DEDUPLICATION
# ============================================================================

def calculate_name_similarity(name1: str, name2: str) -> float:
    """Calculate similarity between two entity names."""
    # Normalize for comparison
    n1 = name1.lower().strip()
    n2 = name2.lower().strip()
    
    # Exact match
    if n1 == n2:
        return 1.0
    
    # One contains the other
    if n1 in n2 or n2 in n1:
        # Length ratio determines similarity
        ratio = min(len(n1), len(n2)) / max(len(n1), len(n2))
        return 0.7 + (0.3 * ratio)
    
    # Use difflib for fuzzy matching
    return difflib.SequenceMatcher(None, n1, n2).ratio()


def find_semantic_duplicates(
    entities: List[ExtractedEntity],
    existing_entities: List[Dict[str, Any]],
    similarity_threshold: float = 0.85
) -> Dict[str, str]:
    """Find semantically duplicate entities.
    
    Returns: {proposed_entity_id -> existing_entity_name} mapping
    """
    duplicates = {}
    
    for proposed in entities:
        prop_name = proposed.name
        prop_name_lower = prop_name.lower()
        
        for existing in existing_entities:
            existing_name = existing.get("name", "")
            existing_name_lower = existing_name.lower()
            
            # Calculate similarity
            similarity = calculate_name_similarity(prop_name, existing_name)
            
            if similarity >= similarity_threshold:
                duplicates[proposed.id] = existing_name
                break
            
            # Check for substring match on substantial terms
            if len(prop_name_lower) >= 4:
                if prop_name_lower in existing_name_lower or existing_name_lower in prop_name_lower:
                    # Additional check: ensure it's not just a partial word
                    if (existing_name_lower.startswith(prop_name_lower + " ") or
                        existing_name_lower.endswith(" " + prop_name_lower) or
                        existing_name_lower.startswith(prop_name_lower) or
                        existing_name_lower.endswith(prop_name_lower)):
                        duplicates[proposed.id] = existing_name
                        break
    
    return duplicates


def deduplicate_within_extraction(entities: List[ExtractedEntity]) -> List[ExtractedEntity]:
    """Remove duplicates within a single extraction result."""
    if not entities:
        return []
    
    # Sort by confidence (keep higher confidence ones)
    sorted_entities = sorted(entities, key=lambda e: e.confidence, reverse=True)
    
    unique = []
    seen_names = set()
    
    for entity in sorted_entities:
        name_lower = entity.name.lower()
        
        # Check for duplicates
        is_duplicate = False
        for seen in seen_names:
            similarity = calculate_name_similarity(entity.name, seen)
            if similarity >= 0.9:  # Very high threshold for same extraction
                is_duplicate = True
                break
        
        if not is_duplicate:
            unique.append(entity)
            seen_names.add(name_lower)
    
    return unique


# ============================================================================
# RELATIONSHIP VALIDATION
# ============================================================================

def validate_relationship(
    rel: ExtractedRelationship,
    entities: List[ExtractedEntity]
) -> Tuple[bool, float]:
    """Validate a relationship and return (is_valid, confidence_adjustment).
    
    Checks:
    - Source and target entities exist
    - Not a self-referential relationship (usually)
    - Not a duplicate of another relationship
    - Type is semantically appropriate
    """
    entity_names = {e.name.lower() for e in entities}
    
    # Check entities exist
    source_exists = rel.source.lower() in entity_names
    target_exists = rel.target.lower() in entity_names
    
    if not source_exists or not target_exists:
        return False, -0.5  # Major penalty
    
    # Avoid self-relationships (usually noise)
    if rel.source.lower() == rel.target.lower():
        return False, -0.3
    
    # Check relationship type is valid
    valid_types = {t.value for t in RelationType}
    if rel.type not in valid_types:
        return True, -0.1  # Minor penalty for non-standard types
    
    return True, 0.0


def deduplicate_relationships(
    relationships: List[ExtractedRelationship]
) -> List[ExtractedRelationship]:
    """Remove duplicate relationships."""
    if not relationships:
        return []
    
    # Sort by confidence
    sorted_rels = sorted(relationships, key=lambda r: r.confidence, reverse=True)
    
    unique = []
    seen = set()
    
    for rel in sorted_rels:
        # Create normalized key
        key = (
            rel.source.lower(),
            rel.target.lower(),
            rel.type.lower()
        )
        
        if key not in seen:
            unique.append(rel)
            seen.add(key)
    
    return unique


# ============================================================================
# CONFIDENCE SCORING
# ============================================================================

def calculate_entity_confidence(entity: ExtractedEntity, transcript: str) -> float:
    """Calculate confidence score for an entity based on multiple factors."""
    confidence = entity.confidence
    
    # Base confidence from LLM
    base_score = min(1.0, max(0.0, confidence))
    
    # Name length factor (prefer medium-length, meaningful names)
    name_len = len(entity.name)
    if name_len < 2:
        base_score *= 0.3
    elif name_len < 4:
        base_score *= 0.7
    elif name_len > 50:
        base_score *= 0.8
    
    # Description quality
    desc = entity.description.strip()
    desc_words = len(desc.split())
    if desc_words < 3:
        base_score *= 0.8
    elif desc_words > 50:
        base_score *= 0.9
    
    # Check if name appears in transcript (direct mention)
    transcript_lower = transcript.lower()
    name_parts = entity.name.lower().split()
    matches = sum(1 for part in name_parts if part in transcript_lower)
    if matches >= len(name_parts):
        base_score = min(1.0, base_score + 0.1)
    
    return round(base_score, 2)


def filter_by_confidence(
    entities: List[ExtractedEntity],
    relationships: List[ExtractedRelationship],
    entity_threshold: float = 0.4,
    relationship_threshold: float = 0.5
) -> Tuple[List[ExtractedEntity], List[ExtractedRelationship]]:
    """Filter entities and relationships by confidence threshold."""
    filtered_entities = [e for e in entities if e.confidence >= entity_threshold]
    filtered_rels = [r for r in relationships if r.confidence >= relationship_threshold]
    
    return filtered_entities, filtered_rels


# ============================================================================
# EXTRACTION PROMPT
# ============================================================================

EXTRACTION_PROMPT_V2 = """You are an expert knowledge graph builder. Analyze this transcript and extract high-quality entities and relationships.

## ENTITY TYPES (use these exact values for the "type" field):
{entity_types}

## RELATIONSHIP TYPES (use these exact values for the "type" field):
{relation_types}

## EXTRACTION INSTRUCTIONS:

1. **EXTRACT KEY ENTITIES** (people, organizations, products, concepts, locations, technologies)
   - Only extract entities that are clearly defined and important to the content
   - Better to extract fewer high-quality entities than many low-quality ones
   - For each entity, provide:
     * "name": The canonical name (use proper English, fix obvious transcription errors)
     * "type": One of the entity types listed above
     * "description": Clear, concise definition (10-30 words)
     * "confidence": 0.0-1.0 based on clarity and importance in text
     * "sources": Array of text snippets where this entity is mentioned

2. **EXTRACT RELATIONSHIPS** between entities
   - Only extract relationships that are explicitly stated or strongly implied
   - For each relationship, provide:
     * "source": Name of the source entity (must match an entity name exactly)
     * "target": Name of the target entity (must match an entity name exactly)
     * "type": One of the relationship types listed above
     * "description": Brief explanation of the relationship
     * "confidence": 0.0-1.0 based on clarity in text

3. **QUALITY GUIDELINES**:
   - Entity names should be proper nouns or well-known terms
   - Fix obvious transcription errors (e.g., "kecam" → "criticize", "KSCC" → "KLCC")
   - Use English names for international entities (e.g., "KLCC" not "Menara Berkembar")
   - Confidence 0.8+: Explicitly defined entities
   - Confidence 0.5-0.8: Implied or moderately clear entities
   - Confidence < 0.5: Weak or unclear entities (avoid these)

## OUTPUT FORMAT:
Return ONLY a JSON object with this structure:
{{
  "entities": [
    {{
      "id": "entity_0",
      "name": "Entity Name",
      "type": "concept",
      "description": "Clear description of the entity",
      "confidence": 0.85,
      "sources": ["Text snippet where mentioned"]
    }}
  ],
  "relationships": [
    {{
      "id": "rel_0",
      "source": "Source Entity Name",
      "target": "Target Entity Name",
      "type": "is_a",
      "description": "Relationship description",
      "confidence": 0.75
    }}
  ]
}}

## TRANSCRIPT TO ANALYZE:
{transcript}
"""


def build_extraction_prompt(transcript: str) -> str:
    """Build the extraction prompt with entity and relationship type descriptions."""
    entity_types = "\n".join([f"- {t.value}: {desc}" for t, desc in ENTITY_TYPE_DESCRIPTIONS.items()])
    relation_types = "\n".join([f"- {t.value}: {desc}" for t, desc in RELATION_TYPE_DESCRIPTIONS.items()])
    
    return EXTRACTION_PROMPT_V2.format(
        entity_types=entity_types,
        relation_types=relation_types,
        transcript=transcript
    )


# ============================================================================
# JSON EXTRACTION
# ============================================================================

def extract_json_from_text(text: str) -> Dict[str, Any]:
    """Robustly extract JSON from LLM response text."""
    # Remove markdown code blocks
    text = re.sub(r'```(?:json)?\s*', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\s*```', '', text, flags=re.IGNORECASE)
    
    # Remove common thinking/reasoning prefixes
    thinking_patterns = [
        r'^(?:Here(?:\'s| is) (?:the |a )?(?:JSON )?extraction[.:]\s*)?',
        r'^(?:I\'ll extract the entities and relationships[.:]\s*)?',
        r'^(?:Based on the transcript[,:]\s*)?',
        r'^(?:Analyzing the transcript[.:]\s*)?',
        r'Here are the extracted entities.*?\{',
        r'The user wants me to extract.*?\{',
        r'Key entities to extract.*?\{',
        r'Let me analyze.*?\{',
    ]
    
    for pattern in thinking_patterns:
        text = re.sub(pattern, '{', text, flags=re.IGNORECASE | re.DOTALL)
    
    # Find JSON object boundaries
    # Match outermost braces with proper nesting
    brace_count = 0
    start_idx = None
    
    for i, char in enumerate(text):
        if char == '{':
            if brace_count == 0:
                start_idx = i
            brace_count += 1
        elif char == '}':
            brace_count -= 1
            if brace_count == 0 and start_idx is not None:
                json_str = text[start_idx:i+1]
                try:
                    # Clean up before parsing
                    json_str = re.sub(r',\s*([}\]])', r'\1', json_str)  # Remove trailing commas
                    return json.loads(json_str)
                except json.JSONDecodeError:
                    continue
    
    # Fallback: simple regex extraction
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        json_str = match.group()
        json_str = re.sub(r',\s*([}\]])', r'\1', json_str)
        return json.loads(json_str)
    
    # Final fallback
    return json.loads(text.strip())


# ============================================================================
# MAIN EXTRACTION FUNCTION
# ============================================================================

def extract_entities_from_transcript(
    transcript: str,
    min_entity_confidence: float = 0.4,
    min_relationship_confidence: float = 0.5
) -> ExtractionResult:
    """Extract entities and relationships from transcript with smart filtering.
    
    Args:
        transcript: The text to analyze
        min_entity_confidence: Minimum confidence to include an entity
        min_relationship_confidence: Minimum confidence to include a relationship
        
    Returns:
        ExtractionResult with filtered, validated entities and relationships
    """
    api_key = os.getenv("FIREWORKS_API_KEY")
    base_url = os.getenv("FIREWORKS_BASE_URL", "https://api.fireworks.ai/inference/v1")
    model = os.getenv("FIREWORKS_MODEL", "accounts/fireworks/routers/kimi-k2p5-turbo")
    
    if not api_key:
        raise ValueError("FIREWORKS_API_KEY not set")
    
    client = OpenAI(api_key=api_key, base_url=base_url)
    
    # Truncate very long transcripts
    max_chars = 8000
    truncated = transcript[:max_chars]
    if len(transcript) > max_chars:
        truncated += "\n\n[Content truncated for length...]"
    
    prompt = build_extraction_prompt(truncated)
    
    # Try extraction with JSON mode
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system", 
                    "content": "You are a precise knowledge extraction assistant. Extract entities and relationships accurately. Return ONLY valid JSON."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            max_tokens=3000,
            response_format={"type": "json_object"}
        )
        
        content = response.choices[0].message.content
        raw_data = extract_json_from_text(content)
        
    except Exception as e:
        print(f"Primary extraction failed: {e}")
        # Fallback without JSON mode
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": "Extract entities and relationships. Return ONLY valid JSON, no markdown."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1,
                max_tokens=3000
            )
            content = response.choices[0].message.content
            raw_data = extract_json_from_text(content)
        except Exception as e2:
            print(f"Fallback extraction also failed: {e2}")
            return ExtractionResult(entities=[], relationships=[], quality_score=0.0)
    
    # Parse entities
    raw_entities = raw_data.get("entities", [])
    entities = []
    for i, e in enumerate(raw_entities):
        entity = ExtractedEntity.from_dict({
            "id": e.get("id", f"entity_{i}"),
            "name": e.get("name", ""),
            "type": e.get("type", "misc"),
            "description": e.get("description", ""),
            "confidence": e.get("confidence", 0.5),
            "sources": e.get("sources", [])
        })
        entities.append(entity)
    
    # Parse relationships
    raw_relationships = raw_data.get("relationships", [])
    relationships = []
    for i, r in enumerate(raw_relationships):
        rel = ExtractedRelationship.from_dict({
            "id": r.get("id", f"rel_{i}"),
            "source": r.get("source", ""),
            "target": r.get("target", ""),
            "type": r.get("type", "related_to"),
            "description": r.get("description", ""),
            "confidence": r.get("confidence", 0.5)
        })
        relationships.append(rel)
    
    # ============================================
    # POST-PROCESSING PIPELINE
    # ============================================
    
    # 1. Normalize entity names
    for entity in entities:
        normalized, confidence_boost = normalize_entity_name(entity.name)
        entity.name = normalized
        entity.confidence = min(1.0, entity.confidence + confidence_boost)
    
    # 2. Clean descriptions
    for entity in entities:
        entity.description = clean_description(entity.description)
    
    # 3. Calculate refined confidence scores
    for entity in entities:
        entity.confidence = calculate_entity_confidence(entity, transcript)
    
    # 4. Deduplicate within extraction
    entities = deduplicate_within_extraction(entities)
    
    # 5. Validate and filter entities
    entities = [e for e in entities if e.confidence >= min_entity_confidence]
    
    # 6. Validate relationships
    valid_relationships = []
    for rel in relationships:
        is_valid, confidence_adj = validate_relationship(rel, entities)
        rel.confidence = min(1.0, max(0.0, rel.confidence + confidence_adj))
        if is_valid and rel.confidence >= min_relationship_confidence:
            valid_relationships.append(rel)
    relationships = valid_relationships
    
    # 7. Deduplicate relationships
    relationships = deduplicate_relationships(relationships)
    
    # 8. Calculate overall quality score
    if entities:
        avg_entity_conf = sum(e.confidence for e in entities) / len(entities)
        avg_rel_conf = sum(r.confidence for r in relationships) / len(relationships) if relationships else 0
        quality_score = (avg_entity_conf * 0.6 + avg_rel_conf * 0.4)
    else:
        quality_score = 0.0
    
    print(f"Smart extraction: {len(entities)} entities, {len(relationships)} relationships (quality: {quality_score:.2f})")
    
    return ExtractionResult(
        entities=entities,
        relationships=relationships,
        quality_score=round(quality_score, 2)
    )


# Legacy compatibility function
def find_duplicate_entities(
    proposed_entities: List[Dict[str, Any]],
    existing_entities: List[Dict[str, Any]]
) -> Dict[str, str]:
    """Legacy wrapper for semantic duplicate detection.
    
    Returns: {proposed_name -> existing_name} mappings
    """
    # Convert to ExtractedEntity objects
    proposed_objs = [
        ExtractedEntity.from_dict({
            "id": e.get("id", f"entity_{i}"),
            "name": e.get("name", ""),
            "type": e.get("type", ""),
            "description": e.get("description", ""),
            "confidence": e.get("confidence", 0.5)
        })
        for i, e in enumerate(proposed_entities)
    ]
    
    return find_semantic_duplicates(proposed_objs, existing_entities)


# ============================================================================
# TEST
# ============================================================================

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    test_transcript = """
    Malaysia is a country in Southeast Asia. Kuala Lumpur is its capital city.
    The KLCC (Kuala Lumpur City Centre) is a famous landmark featuring the Petronas Towers.
    KLCC Property Holdings is a REIT (Real Estate Investment Trust) that manages properties
    in the KLCC area. The Tun Razak Exchange (TRX) is another major development in Kuala Lumpur.
    
    Machine learning is a subset of artificial intelligence. Deep learning is a type of
    machine learning that uses neural networks. TensorFlow and PyTorch are popular
    frameworks for building machine learning models.
    """
    
    result = extract_entities_from_transcript(test_transcript)
    print(f"\n{'='*60}")
    print(f"Extraction Quality Score: {result.quality_score}")
    print(f"{'='*60}")
    print(f"\nExtracted Entities ({len(result.entities)}):")
    for entity in result.entities:
        print(f"  • {entity.name} ({entity.type}) - confidence: {entity.confidence}")
        print(f"    {entity.description}")
    
    print(f"\nExtracted Relationships ({len(result.relationships)}):")
    for rel in result.relationships:
        print(f"  • {rel.source} --[{rel.type}]--> {rel.target} (confidence: {rel.confidence})")
        print(f"    {rel.description}")
