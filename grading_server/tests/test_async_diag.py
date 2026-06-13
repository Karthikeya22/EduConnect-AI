import asyncio
from grading_server.utils.gemini_client import async_call_gemini

async def main():
    print("Test 1: Single async call")
    r = await async_call_gemini("Say 'ping' in JSON", model="gemini-2.5-flash")
    print(f"Result 1: {r}")

    print("\nTest 2: Parallel async calls (3x)")
    tasks = [
        async_call_gemini("Say 'red' in JSON", model="gemini-2.5-flash"),
        async_call_gemini("Say 'green' in JSON", model="gemini-2.5-flash"),
        async_call_gemini("Say 'blue' in JSON", model="gemini-2.5-flash"),
    ]
    results = await asyncio.gather(*tasks)
    print(f"Results: {results}")

if __name__ == "__main__":
    asyncio.run(main())
