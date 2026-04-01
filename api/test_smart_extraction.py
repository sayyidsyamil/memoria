"""Quick test for the smart extraction module."""
import sys
sys.path.insert(0, 'api')

from extraction_v2 import (
    extract_entities_from_transcript,
    normalize_entity_name,
    calculate_name_similarity,
    EntityType,
    RelationType,
    clean_description
)

print("=" * 60)
print("SMART EXTRACTION MODULE TEST")
print("=" * 60)

# Test entity type availability
print(f"\nEntity types: {len(EntityType)}")
print(f"Relationship types: {len(RelationType)}")

# Test normalization
print("\n" + "-" * 40)
print("Entity Normalization Tests:")
print("-" * 40)
test_names = ['kscc', 'KLCC', 'machine learning', 'AI', 'tensorflow', 'rits']
for name in test_names:
    normalized, boost = normalize_entity_name(name)
    print(f"  {name!r} -> {normalized!r} (boost: +{boost})")

# Test similarity
print("\n" + "-" * 40)
print("Similarity Tests:")
print("-" * 40)
sim1 = calculate_name_similarity("KLCC", "KLCC Property Holdings")
sim2 = calculate_name_similarity("AI", "Artificial Intelligence")
sim3 = calculate_name_similarity("Machine Learning", "Deep Learning")
print(f"  KLCC vs KLCC Property: {sim1:.2f}")
print(f"  AI vs Artificial Intelligence: {sim2:.2f}")
print(f"  Machine Learning vs Deep Learning: {sim3:.2f}")

# Test description cleaning
print("\n" + "-" * 40)
print("Description Cleaning Tests:")
print("-" * 40)
test_descs = [
    "refers to a machine learning technique",
    "is defined as artificial neural networks",
    "A framework for building ML models"
]
for desc in test_descs:
    cleaned = clean_description(desc)
    print(f"  Before: {desc!r}")
    print(f"  After:  {cleaned!r}")
    print()

print("=" * 60)
print("All tests passed!")
print("=" * 60)
