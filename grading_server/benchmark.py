import time
import requests

API_URL = "http://localhost:5050/api/grade"
data = {
    "assignment_id": "test_assignment_001",
    "student_id": "student_timer",
    "submission_text": "Machine learning is the study of computer algorithms that improve automatically through experience. It is seen as a subset of artificial intelligence."
}

print(f"🚀 Calling {API_URL}...")
start = time.time()
try:
    r = requests.post(API_URL, json=data, timeout=120)
    elapsed = round(time.time() - start, 2)
    if r.status_code == 200:
        print(f"✅ SUCCESS in {elapsed}s")
        print(f"Pipeline reported duration: {r.json().get('_pipeline_duration_seconds')}s")
        print("\nStructure Validation:")
        keys = ["total", "rubric_walkthrough", "topic_mastery_radar", "critiques"]
        for k in keys:
            print(f"  {k}: {'Found' if k in r.json() else 'MISSING'}")
    else:
        print(f"❌ FAILED ({r.status_code}): {r.text[:500]}")
except Exception as e:
    print(f"❌ ERROR: {e}")
