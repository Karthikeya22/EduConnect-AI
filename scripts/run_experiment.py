import os
import json
import time
import requests
import google.genai as genai
from google.genai import types

# Setup API Key for Vanilla Gemini
API_KEY = os.environ.get("GEMINI_API_KEY", "AIzaSyD3dbTxDZQFqxFTSPcEPSnIaJAtUPk77SE")
client = genai.Client(api_key=API_KEY)

# Assignment / Course setup
assignment_id = "ai-ed-101"
student_id = "stu_experiment"

# Define the submissions
submissions = {
    "Research Paper": """
# The Impact of Intelligent Tutoring Systems on Cognitive Load
By Student 123

## Introduction
Intelligent Tutoring Systems (ITS) adapt to student learning paces. This paper explores how ITS reduces cognitive load.

## Method
We analyzed 500 students using an ITS compared to traditional learning. Cognitive load was measured via self-reporting and pupil dilation.

## Results
Students using ITS showed a 30% reduction in extraneous cognitive load. They also scored 15% higher on post-tests.

## Conclusion
ITS is effective because it sequences information properly.
""",
    "Poster": """
[HEADER: ITS and Cognitive Load]
[IMAGE: Bar chart showing 30% drop in load]
- Intelligent Tutors adapt step-by-step
- Reduces working memory strain
- Key finding: 15% higher post-test scores
- Future work: Analyze physiological markers like pupil dilation in real-time.
""",
    "PowerPoint Presentation": """
=== Slide 1 ===
Intelligent Tutoring Systems
A Cognitive Load Perspective

=== Slide 2 ===
The Problem
- Traditional classrooms overwhelm students
- Extraneous cognitive load is high

=== Slide 3 ===
The Solution
- ITS provides scaffolding
- Step-by-step reveals
- Reduced strain on working memory

=== Slide 4 ===
Results
- 30% less cognitive load reported
- 15% improvement in scores
""",
    "Regular Assignment": """
Question 1: Explain the primary benefit of an ITS according to cognitive load theory.
Answer: An ITS primarily helps by reducing extraneous cognitive load. It does this by breaking down complex problems into smaller, manageable steps, providing scaffolding, and adapting to the learner's current knowledge level so their working memory isn't overwhelmed.
""",
    "Discussion Post": """
I found the reading on ITS really interesting. I think the biggest advantage is definitely how it manages cognitive load. In a regular class, if you miss a step, you're lost and your working memory gets flooded trying to catch up. But with an ITS, it literally stops and waits for you to master the current step. Has anyone else noticed this when using platforms like Duolingo or Khan Academy?
"""
}

# The grading rubric
rubric = [
    {
        "id": "content_mastery",
        "description": "Content Mastery",
        "dimension": "content",
        "max_score": 40,
        "criteria": "Evaluates the depth of understanding of ITS and Cognitive Load Theory."
    },
    {
        "id": "evidence_usage",
        "description": "Use of Evidence",
        "dimension": "content",
        "max_score": 40,
        "criteria": "Evaluates whether the student supports their claims with specific data or concepts (e.g., 30% reduction, scaffolding)."
    },
    {
        "id": "organization",
        "description": "Organization and Clarity",
        "dimension": "structure",
        "max_score": 20,
        "criteria": "Evaluates if the response is well-structured, clear, and easy to follow."
    }
]

# Ingest rubric
print("Ingesting rubric to backend...", flush=True)
requests.post(f"http://localhost:5557/api/ingest", json={
    "assignment_id": assignment_id,
    "course_material_text": "Cognitive Load Theory states that working memory is limited. ITS reduces extraneous load through scaffolding and step-by-step problem solving. A key study showed 30% reduction in extraneous load.",
    "rubric_criteria": rubric
})
time.sleep(2)

def run_method_a(sub_text):
    payload = {
        "assignment_id": assignment_id,
        "student_id": student_id,
        "submission_text": sub_text
    }
    resp = requests.post("http://localhost:5557/api/grade", json=payload, timeout=300)
    return resp.json()

def run_method_b(sub_text):
    prompt = f"""
    You are an AI Grader. Grade this student submission based ONLY on the provided rubric.
    
    Rubric: {json.dumps(rubric)}
    
    Submission: {sub_text}
    
    Return your response as a JSON object with the following structure:
    {{
        "total": <number>,
        "content_score": <number>,
        "structure_score": <number>,
        "confidence": <number between 0 and 1>,
        "misconception_hint": <string or null>,
        "flag_for_human": <boolean>,
        "rubric_walkthrough": [
            {{
                "criterion_id": <string>,
                "score": <number>,
                "status": <"full", "partial", "zero">,
                "justification": <string>,
                "evidence_anchor": <string quote from submission or "not found">,
                "missing_keywords": [<string>]
            }}
        ]
    }}
    Make sure the response is valid JSON.
    """
    
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.2
        )
    )
    return json.loads(response.text)

results = {}

for name, text in submissions.items():
    print(f"Running evaluation for: {name}...", flush=True)
    try:
        res_a = run_method_a(text)
    except Exception as e:
        print("Error in Method A:", e)
        res_a = {"error": str(e)}
        
    try:
        res_b = run_method_b(text)
    except Exception as e:
        print("Error in Method B:", e)
        res_b = {"error": str(e)}
        
    results[name] = {"Method_A": res_a, "Method_B": res_b}

with open("evaluation_results.json", "w") as f:
    json.dump(results, f, indent=2)

print("Evaluation complete! Results saved to evaluation_results.json")
