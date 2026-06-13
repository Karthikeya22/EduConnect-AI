"""
End-to-end test: call POST /api/grade on the running Flask server.
Expected: Pipeline will execute Node 1 (Ingest) successfully, then Node 2
(Retrieve) will return empty rubric/chunks since tables don't exist.
Nodes 3-5 will handle gracefully. We verify the response structure.
"""
import urllib.request
import json

FLASK_URL = "http://localhost:5557/api/grade"

payload = {
    "assignment_id": "test_assignment_001",
    "student_id": "test_student_42",
    "submission_text": (
        "Machine learning is a subset of artificial intelligence that focuses on "
        "building systems that learn from data. Supervised learning uses labeled "
        "datasets to train models, while unsupervised learning discovers hidden "
        "patterns. Key algorithms include linear regression for continuous outputs, "
        "logistic regression for classification, and neural networks for complex "
        "pattern recognition. Gradient descent is the primary optimization algorithm "
        "used to minimize loss functions during training. Overfitting occurs when a "
        "model learns noise in the training data rather than the underlying pattern, "
        "and regularization techniques like L1 and L2 help prevent this."
    ),
}

print(f"Sending POST to {FLASK_URL}")
print(f"Assignment: {payload['assignment_id']}")
print(f"Student: {payload['student_id']}")
print(f"Submission length: {len(payload['submission_text'])} chars")
print("=" * 60)

req = urllib.request.Request(
    FLASK_URL,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)

try:
    resp = urllib.request.urlopen(req, timeout=120)
    data = json.loads(resp.read().decode())
    print(f"\nHTTP {resp.status} — SUCCESS")
    print(json.dumps(data, indent=2)[:3000])

    # Validate response structure
    print("\n" + "=" * 60)
    print("STRUCTURE VALIDATION:")
    required_keys = [
        "assignment_id", "student_id",
        "content_score", "content_max",
        "structure_score", "structure_max",
        "total", "total_max",
        "rubric_walkthrough", "topic_mastery_radar",
        "misconception_hint", "flag_for_human",
        "overall_confidence", "critiques",
    ]
    for key in required_keys:
        present = key in data
        print(f"  {key}: {'PRESENT' if present else 'MISSING'}")

    missing = [k for k in required_keys if k not in data]
    if not missing:
        print("\nALL REQUIRED FIELDS PRESENT IN RESPONSE")
    else:
        print(f"\nMISSING FIELDS: {missing}")

except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"\nHTTP {e.code} — {e.reason}")
    print(body[:2000])
except Exception as e:
    print(f"\nERROR: {e}")
