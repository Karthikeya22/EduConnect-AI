# EduConnect AI (EduGenie)

EduConnect AI is a Canvas-integrated grading assistant that helps instructors generate **evidence-grounded draft grades and feedback** using rubric-aware retrieval and LLM reasoning.

> This system is designed for instructor decision support. Final grading decisions should always remain with educators.

## What this repository contains

- **Frontend (`src/`)**: React + TypeScript app for educator workflows
- **Grading server (`grading_server/`)**: Flask-based AI grading and ingestion pipeline
- **Documentation (`docs/`)**: run guides and model/provider notes
- **Deployment config**: Procfile, Vercel config, Supabase SQL setup scripts

## Tech stack

- React 19 + TypeScript + Vite
- Python Flask grading service
- Supabase (Postgres + auth/data)
- Google Gemini and provider-based BYOK model access

## Prerequisites

- Node.js 18+
- npm
- Python 3.11+
- pip

## Setup

1. Clone and install frontend dependencies:

   ```bash
   git clone https://github.com/Karthikeya22/EduConnect-AI.git
   cd EduConnect-AI
   npm install
   ```

2. Create and activate a Python virtual environment, then install backend dependencies:

   ```bash
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\Scripts\activate
   pip install -r grading_server/requirements.txt
   ```

3. Create a local env file from `.env.example` and replace values with your own:

   ```bash
   cp .env.example .env
   ```

   Required variables include:
   - `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
   - `SUPABASE_KEY` (or `VITE_SUPABASE_ANON_KEY`)
   - `CANVAS_BASE_URL` (or `VITE_CANVAS_BASE_URL`)
   - LLM credentials provided at request-time (BYOK flow)

## Run locally

### Option A: run services separately (recommended)

Terminal 1 (frontend):

```bash
npm run dev:frontend
```

Terminal 2 (grading server):

```bash
python -m grading_server.app
```

### Option B: run combined dev script

```bash
npm run dev
```

> `npm run dev` uses `py -m grading_server.app` for the backend command, which is mainly Windows-friendly.

## Useful scripts

- `npm run dev` – frontend + backend together
- `npm run dev:frontend` – frontend only
- `npm run dev:backend` – backend only (Windows-oriented command)
- `npm run build` – production frontend build
- `npm run lint` – TypeScript type-check

## Testing and validation

- Frontend checks: `npm run lint`
- Backend tests: `pytest grading_server/tests` (if test dependencies are installed)

## Documentation index

- `docs/README.md`
- `docs/RUN_GUIDE.md`
- `grading_server/README.md`

## Contributing

1. Create a feature branch
2. Keep changes focused and small
3. Run relevant checks before submitting
4. Open a pull request with a clear summary

## Contact

- Project lead: Dr. Bo Pei
- Developer: [Karthikeya Moturi](https://github.com/Karthikeya22)
