"""Entity and relationship extraction service using LLM."""

import os
import json
from typing import List, Dict, Any
from openai import OpenAI


EXTRACTION_PROMPT = """You are an expert knowledge graph builder. Analyze this transcript and extract:

1. KEY ENTITIES: Important people, organizations, concepts, products, locations, events
   - Include obvious aliases as separate mentions (e.g., "REIT" and "Real Estate Investment Trust")
   - Each entity should have: name, type, description, confidence score

2. RELATIONSHIPS: How entities connect to each other
   - Types: is_a, part_of, located_in, founded_by, manages, related_to, type_of, depends_on
   - Each relationship: source entity name, target entity name, relationship type, description

Return ONLY valid JSON in this exact format:
{
  "entities": [
    {
      "name": "Entity Name",
      "type": "Person|Organization|Concept|Product|Location|Event",
      "description": "Brief description of what this entity is",
      "confidence": 0.95
    }
  ],
  "relationships": [
    {
      "source": "Source Entity Name",
      "target": "Target Entity Name",
      "type": "is_a|part_of|located_in|founded_by|manages|related_to|type_of|depends_on",
      "description": "Brief description of the relationship"
    }
  ]
}

IMPORTANT:
- Only extract entities that are clearly mentioned in the text
- Ensure high quality - better to extract fewer high-confidence entities than many low-quality ones
- Confidence should be 0.0-1.0 based on how clearly the entity is defined in the text
- Make sure relationship source/target names match entity names exactly

TRANSCRIPT:
{transcript}
"""


def extract_entities_from_transcript(transcript: str) -> Dict[str, Any]:
    """Use LLM to extract entities and relationships from transcript."""
    api_key = os.getenv("FIREWORKS_API_KEY")
    base_url = os.getenv("FIREWORKS_BASE_URL", "https://api.fireworks.ai/inference/v1")
    model = os.getenv("FIREWORKS_MODEL", "accounts/fireworks/routers/kimi-k2p5-turbo")
    
    if not api_key:
        raise ValueError("FIREWORKS_API_KEY not set")
    
    client = OpenAI(api_key=api_key, base_url=base_url)
    
    # Truncate very long transcripts to avoid token limits
    max_chars = 8000
    truncated_transcript = transcript[:max_chars]
    if len(transcript) > max_chars:
        truncated_transcript += "... [truncated]"
    
    prompt = EXTRACTION_PROMPT.format(transcript=truncated_transcript)
    
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a precise knowledge extraction assistant. Return only valid JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.1,
        max_tokens=2000
    )
    
    content = response.choices[0].message.content
    
    # Extract JSON from the response
    try:
        # Try to find JSON in the content
        json_start = content.find('{')
        json_end = content.rfind('}')
        
        if json_start != -1 and json_end != -1:
            json_str = content[json_start:json_end + 1]
            result = json.loads(json_str)
        else:
            result = json.loads(content)
        
        # Validate structure
        if "entities" not in result:
            result["entities"] = []
        if "relationships" not in result:
            result["relationships"] = []
        
        # Add IDs to entities and relationships for tracking
        for i, entity in enumerate(result["entities"]):
            entity["id"] = f"entity_{i}"
        
        for i, rel in enumerate(result["relationships"]):
            rel["id"] = f"rel_{i}"
        
        return result
        
    except json.JSONDecodeError as e:
        print(f"Failed to parse extraction JSON: {e}")
        print(f"Raw content: {content}")
        return {"entities": [], "relationships": []}


def find_duplicate_entities(
    proposed_entities: List[Dict[str, Any]],
    existing_entities: List[Dict[str, Any]]
) -> Dict[str, str]:
    """Find potential duplicates between proposed and existing entities.
    
    Returns: {proposed_name -> existing_name} mappings
    """
    duplicates = {}
    
    for proposed in proposed_entities:
        prop_name = proposed["name"].lower()
        
        for existing in existing_entities:
            existing_name = existing["name"].lower()
            
            # Exact match
            if prop_name == existing_name:
                duplicates[proposed["name"]] = existing["name"]
                break
            
            # Substring match (e.g., "REIT" vs "Real Estate Investment Trust (REIT)")
            if prop_name in existing_name or existing_name in prop_name:
                if len(prop_name) >= 4:  # Only if substantial
                    duplicates[proposed["name"]] = existing["name"]
                    break
    
    return duplicates
