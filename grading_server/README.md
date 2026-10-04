# Grading Server

This directory contains the Python backend for EduConnect AI's rubric-based grading pipeline.

## Responsibilities

- Accept grading requests from the frontend
- Parse and normalize student submission files (PDF, DOCX, PPTX, text)
- Retrieve assignment/course context
- Run criterion-level evaluation and critique passes
- Return instructor-reviewable draft scores and feedback

## Requirements

- Python 3.11+
- Environment variables for Supabase and Canvas

Install dependencies:

```bash
pip install -r grading_server/requirements.txt
```

## Run

From repository root:

```bash
python -m grading_server.app
```

Alternative wrapper (mostly for local Windows workflows):

```bash
python grading_server/run.py
```

Default port: `5557`

## Key files

- `app.py` - Flask app, API routes, grading workflow logic
- `graph.py` / `all_nodes_async.py` - workflow orchestration components
- `ingest_service.py` - ingestion helpers
- `config.py` - environment loading and runtime config
- `utils/` - provider clients, parsers, helpers
- `tests/` - backend test coverage

## Environment notes

`config.py` accepts either primary or fallback env variable names:

- Supabase URL: `SUPABASE_URL` or `VITE_SUPABASE_URL`
- Supabase key: `SUPABASE_KEY` or `VITE_SUPABASE_ANON_KEY`
- Canvas URL: `CANVAS_BASE_URL` or `VITE_CANVAS_BASE_URL`

Model/provider credentials are resolved through BYOK request flows.
