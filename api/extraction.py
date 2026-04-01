"""Entity and relationship extraction service using LLM."""

import os
import json
import re
from typing import List, Dict, Any
from openai import OpenAI


EXTRACTION_PROMPT = """You are an expert knowledge graph builder. Analyze this transcript and extract:

1. KEY ENTITIES: Important people, organizations, concepts, products, locations, events
   - Each entity should have: name, type, description, confidence score

2. RELATIONSHIPS: How entities connect to each other
   - Types: is_a, part_of, located_in, founded_by, manages, related_to, type_of, depends_on
   - Each relationship: source entity name, target entity name, relationship type, description

IMPORTANT:
- Only extract entities that are clearly mentioned in the text
- Ensure high quality - better to extract fewer high-confidence entities than many low-quality ones
- Confidence should be 0.0-1.0 based on how clearly the entity is defined in the text
- Make sure relationship source/target names match entity names exactly
- Return ONLY a JSON object, no markdown formatting, no explanations

TRANSCRIPT:
{transcript}
"""


def extract_json_from_text(text: str) -> Dict[str, Any]:
    """Extract JSON object from text using regex to find outermost braces."""
    # Remove markdown code blocks
    text = re.sub(r'```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```', '', text)
    
    # Find the outermost JSON object
    # Match from first { to last } with proper nesting
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        json_str = match.group()
        # Clean common JSON issues
        json_str = re.sub(r',\s*([}\]])', r'\1', json_str)  # Remove trailing commas
        return json.loads(json_str)
    
    # Try direct parse as fallback
    return json.loads(text.strip())


def extract_entities_from_transcript(transcript: str) -> Dict[str, Any]:
    """Use LLM to extract entities and relationships from transcript."""
    api_key = os.getenv("FIREWORKS_API_KEY")
    base_url = os.getenv("FIREWORKS_BASE_URL", "https://api.fireworks.ai/inference/v1")
    model = os.getenv("FIREWORKS_MODEL", "accounts/fireworks/routers/kimi-k2p5-turbo")
    
    if not api_key:
        raise ValueError("FIREWORKS_API_KEY not set")
    
    client = OpenAI(api_key=api_key, base_url=base_url)
    
    # Truncate very long transcripts to avoid token limits
    max_chars = 6000
    truncated_transcript = transcript[:max_chars]
    if len(transcript) > max_chars:
        truncated_transcript += "... [truncated for length]"
    
    prompt = EXTRACTION_PROMPT.format(transcript=truncated_transcript)
    
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a precise knowledge extraction assistant. Return ONLY valid JSON with no markdown formatting."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            max_tokens=2000,
            response_format={"type": "json_object"}  # Force JSON mode
        )
        
        content = response.choices[0].message.content
        
        # Parse the JSON response
        result = extract_json_from_text(content)
        
        # Validate structure
        if "entities" not in result or not isinstance(result["entities"], list):
            result["entities"] = []
        if "relationships" not in result or not isinstance(result["relationships"], list):
            result["relationships"] = []
        
        # Add IDs to entities and relationships for tracking
        for i, entity in enumerate(result["entities"]):
            entity["id"] = f"entity_{i}"
        
        for i, rel in enumerate(result["relationships"]):
            rel["id"] = f"rel_{i}"
        
        print(f"Extraction successful: {len(result['entities'])} entities, {len(result['relationships'])} relationships")
        return result
        
    except Exception as e:
        print(f"Extraction failed with JSON mode, trying fallback: {e}")
        return extract_entities_fallback(client, model, prompt)


def extract_entities_fallback(client, model: str, prompt: str) -> Dict[str, Any]:
    """Fallback extraction without JSON mode."""
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a precise knowledge extraction assistant. Return ONLY valid JSON with no markdown formatting, no code blocks."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            max_tokens=2000
        )
        
        content = response.choices[0].message.content
        
        # Try multiple parsing strategies
        try:
            result = extract_json_from_text(content)
        except json.JSONDecodeError:
            # Last resort: try to fix common issues
            fixed_content = content.replace('\n', ' ').replace('\t', ' ')
            result = extract_json_from_text(fixed_content)
        
        # Validate structure
        if "entities" not in result or not isinstance(result["entities"], list):
            result["entities"] = []
        if "relationships" not in result or not isinstance(result["relationships"], list):
            result["relationships"] = []
        
        # Add IDs
        for i, entity in enumerate(result["entities"]):
            entity["id"] = f"entity_{i}"
        for i, rel in enumerate(result["relationships"]):
            rel["id"] = f"rel_{i}"
        
        print(f"Fallback extraction successful: {len(result['entities'])} entities, {len(result['relationships'])} relationships")
        return result
        
    except Exception as e:
        print(f"Extraction failed completely: {e}")
        print(f"Content was: {repr(content[:500])}")
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


# Simple test when run directly
if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    test_transcript = """
    This is a test about machine learning. Machine learning is a subset of artificial intelligence.
    Deep learning is a type of machine learning that uses neural networks.
    TensorFlow is a popular framework for building machine learning models.
    """
    
    result = extract_entities_from_transcript(test_transcript)
    print("\nExtracted entities:")
    for entity in result["entities"]:
        print(f"  - {entity['name']} ({entity['type']}): {entity['description']}")
    print("\nExtracted relationships:")
    for rel in result["relationships"]:
        print(f"  - {rel['source']} -> {rel['target']} ({rel['type']})")
