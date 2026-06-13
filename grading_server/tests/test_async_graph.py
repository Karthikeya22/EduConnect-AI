import asyncio
from flask import Flask
from grading_server.graph import get_compiled_graph

initial_state = {
    "assignment_id": "test_assignment_001",
    "student_id": "test_student_42",
    "submission_text": "Machine learning is the study of computer algorithms that improve automatically through experience.",
}

async def test_run():
    print("🚀 Starting Internal Async Pipeline Test")
    graph = get_compiled_graph()
    try:
        final_state = await graph.ainvoke(initial_state)
        print("✅ SUCCESS")
        print(final_state.get("final_output"))
    except Exception as e:
        import traceback
        print("❌ CRASH")
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_run())
