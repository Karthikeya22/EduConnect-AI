# Running EduConnect AI with All Flows

To ensure the full application (Frontend + AI Grading Pipeline) is functional, you need to run two separate processes.

## 1. Start the Frontend (Vite)
The frontend handles the UI, authentication, and communication with Supabase and the Grading Server.

- **Command:** `npm run dev`
- **Access URL:** Usually [http://localhost:5173](http://localhost:5173)
- **What it does:** Hot-reloads the UI as you make changes.

## 2. Start the AI Grading Server (Python/Flask)
The grading server handles the Mixture of Experts (MoE) consensus and RAG-based grading logic.

- **Command:** `python grading_server/run.py`
- **Port:** 5557
- **What it does:** Listens for grading requests from the frontend and processes them using Gemini/OpenAI/Anthropic models.

## 3. Environment Check
Ensure your `.env` file contains the following (currently already set up in the workspace):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `GEMINI_API_KEY` (and `VITE_GEMINI_API_KEY`)
- `VITE_OPENAI_API_KEY`
- `VITE_ANTHROPIC_API_KEY`

---

## Verifying the Flows
1.  **Open the Frontend**: Navigate to the "Grading Hub".
2.  **Select a Submission**: Choose a student submission with attachments.
3.  **Click "Grade with AI"**: This will send a request to `localhost:5557`.
4.  **Monitor Logs**: Check the terminal running `grading_server/run.py` for progress.
