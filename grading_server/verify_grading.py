import json
from grading_server.utils.supabase_client import get_supabase

def print_all():
    sb = get_supabase()
    response = sb.table("grading_results").select("*").execute()
    data = getattr(response, 'data', [])
    print(f"Total rows: {len(data)}")
    for i, row in enumerate(data[-5:]):
        print(f"Row {i}: id={row.get('id')} assignment_id={row.get('assignment_id')} student_id={row.get('student_id')}")
        result = row.get("result", {})
        print(f"  keys in result: {list(result.keys())}")
        if 'criteria_verdicts' in result:
            print(f"  num criteria_verdicts: {len(result.get('criteria_verdicts', []))}")

if __name__ == "__main__":
    print_all()
