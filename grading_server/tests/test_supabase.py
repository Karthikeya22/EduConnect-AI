"""Test Supabase client connection and basic query."""
from grading_server.utils.supabase_client import get_supabase

sb = get_supabase()
print(f"Supabase client created: {type(sb)}")

# Test: query a table we know exists (student_knowledge_graph from setup_graphrag.sql)
try:
    resp = sb.table("student_knowledge_graph").select("*").limit(1).execute()
    print(f"student_knowledge_graph: {len(resp.data)} rows (query OK)")
except Exception as e:
    print(f"student_knowledge_graph query: {e}")

# Test: check if our NEW tables exist yet
for table_name in ["rubric_criteria", "course_material_chunks", "exemplars", "grading_results"]:
    try:
        resp = sb.table(table_name).select("*").limit(1).execute()
        print(f"  {table_name}: EXISTS ({len(resp.data)} rows)")
    except Exception as e:
        err_msg = str(e)
        if "does not exist" in err_msg or "relation" in err_msg or "42P01" in err_msg:
            print(f"  {table_name}: NOT YET CREATED (expected — run setup_tables.sql)")
        else:
            print(f"  {table_name}: ERROR: {err_msg[:100]}")

print("\nSUPABASE CONNECTION TEST DONE")
