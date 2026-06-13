"""Full smoke test for grading_server Gemini client with corrected models."""
from grading_server.utils.gemini_client import call_gemini, call_gemini_text, embed_text, embed_texts
from grading_server.config import GEMINI_LITE_MODEL, GEMINI_GRADING_MODEL

print(f"LITE model:    {GEMINI_LITE_MODEL}")
print(f"GRADING model: {GEMINI_GRADING_MODEL}")

# Test 1: Gemini JSON call (concept extraction)
print("\n=== Test 1: Gemini JSON call ===")
prompt = (
    'Extract concept keywords. Return JSON: {"concepts": ["keyword1", "keyword2"]}\n\n'
    "Text: Machine learning uses gradient descent to minimize a loss function. "
    "Neural networks consist of layers with ReLU and sigmoid activations."
)
result = call_gemini(prompt, model=GEMINI_LITE_MODEL, temperature=0.1)
print(f"Concepts: {result}")
assert "concepts" in result, "Missing concepts key"
assert len(result["concepts"]) > 0, "No concepts extracted"
print("PASS")

# Test 2: Gemini text call
print("\n=== Test 2: Gemini text call ===")
text = call_gemini_text("Say 'hello world' in one sentence.", model=GEMINI_LITE_MODEL)
print(f"Text response: {text[:100]}")
assert len(text) > 0, "Empty text response"
print("PASS")

# Test 3: Single embedding
print("\n=== Test 3: Single embedding ===")
vec = embed_text("Machine learning and neural networks")
print(f"Embedding dim: {len(vec)}")
assert len(vec) == 3072, f"Expected 3072-dim, got {len(vec)}"
print("PASS")

# Test 4: Batch embeddings
print("\n=== Test 4: Batch embeddings ===")
vecs = embed_texts(["Hello world", "Deep learning", "Statistics"])
print(f"Batch count: {len(vecs)}, dims: {[len(v) for v in vecs]}")
assert len(vecs) == 3
assert all(len(v) == 3072 for v in vecs)
print("PASS")

print("\n ALL GEMINI CLIENT TESTS PASS")
