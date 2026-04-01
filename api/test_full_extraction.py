"""Full end-to-end test of the smart extraction with actual LLM call."""
import os
import sys
sys.path.insert(0, 'api')

from dotenv import load_dotenv
load_dotenv()

from extraction_v2 import extract_entities_from_transcript

# Test transcript
test_transcript = """
Malaysia is a country in Southeast Asia. Kuala Lumpur is its capital city.
The KLCC (Kuala Lumpur City Centre) is a famous landmark featuring the Petronas Towers.
KLCC Property Holdings is a REIT (Real Estate Investment Trust) that manages properties
in the KLCC area. The Tun Razak Exchange (TRX) is another major development in Kuala Lumpur.

Machine learning is a subset of artificial intelligence. Deep learning is a type of
machine learning that uses neural networks. TensorFlow and PyTorch are popular
frameworks for building machine learning models. Natural Language Processing (NLP)
is a field of AI focused on language understanding.
"""

print("=" * 70)
print("FULL LLM EXTRACTION TEST")
print("=" * 70)
print("\nTest transcript preview:")
print(test_transcript[:200] + "...")
print()

try:
    result = extract_entities_from_transcript(test_transcript)
    
    print("-" * 70)
    print(f"QUALITY SCORE: {result.quality_score}")
    print("-" * 70)
    
    print(f"\nENTITIES ({len(result.entities)}):")
    print("-" * 70)
    for entity in result.entities:
        print(f"\n  • {entity.name}")
        print(f"    Type: {entity.type}")
        print(f"    Confidence: {entity.confidence:.2f}")
        print(f"    Description: {entity.description}")
    
    print(f"\n\nRELATIONSHIPS ({len(result.relationships)}):")
    print("-" * 70)
    for rel in result.relationships:
        print(f"\n  • {rel.source} --[{rel.type}]--> {rel.target}")
        print(f"    Confidence: {rel.confidence:.2f}")
        print(f"    Description: {rel.description}")
    
    print("\n" + "=" * 70)
    print("EXTRACTION SUCCESSFUL!")
    print("=" * 70)
    
except Exception as e:
    import traceback
    print(f"ERROR: {e}")
    print(traceback.format_exc())
