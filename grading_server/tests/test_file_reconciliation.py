from grading_server.ingest_service import plan_removed_file_reconciliation as plan

REG = [
    {"course_id": "11", "canvas_file_id": "1"},
    {"course_id": "11", "canvas_file_id": "2"},
    {"course_id": "22", "canvas_file_id": "3"},
]


def test_failed_listing_is_unknown_not_deletion():
    assert plan("11", REG, None, listing_complete=False) == {"status": "unknown", "course_id": "11", "removed_candidates": []}


def test_partial_or_permission_limited_listing_is_unknown():
    assert plan("11", REG, ["1"], listing_complete=False)["status"] == "unknown"
    assert plan("11", REG, [], listing_complete=False)["removed_candidates"] == []


def test_complete_listing_reports_only_this_courses_missing_files():
    assert plan("11", REG, ["1"], listing_complete=True) == {"status": "complete", "course_id": "11", "removed_candidates": ["2"]}


def test_empty_complete_listing_still_scoped_to_course():
    assert plan("11", REG, [], listing_complete=True)["removed_candidates"] == ["1", "2"]
