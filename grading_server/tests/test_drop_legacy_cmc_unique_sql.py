from pathlib import Path

SQL = Path("grading_server/migrations/2026_11_01_drop_legacy_cmc_assignment_chunk.sql").read_text(
    encoding="utf-8"
)


def test_migration_drops_legacy_assignment_chunk_unique():
    assert "DROP CONSTRAINT IF EXISTS uq_cmc_assignment_chunk" in SQL
    assert "DROP INDEX IF EXISTS public.uq_cmc_assignment_chunk" in SQL
    assert "uq_cmc_course_file_chunk" in SQL
    assert "uq_cmc_course_assignment_desc_chunk" in SQL
