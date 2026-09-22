# BYOK Multi-Provider — Manual Smoke Checklist

Run after `npm run dev` (frontend :3000 + backend :5557).

## Setup
1. Apply `grading_server/setup_embedding_meta.sql` in Supabase SQL editor (once).
2. Open Course Selection → provider + API key panel.

## Per provider
For each: OpenAI, Gemini, OpenRouter, Claude (via OpenRouter), NVIDIA, DeepSeek, Kimi:

1. Select provider, paste key, click **Verify & Save Keys**.
2. Expect success toast (Canvas must also be valid).
3. Confirm localStorage has `llm_provider` + `llm_api_key`.
4. Ingest one short Canvas file / assignment text from Grading Hub.
5. Grade one student submission.
6. Switch to a *different* provider, verify, then try grade again without re-ingest → expect `REINGEST_REQUIRED` (409).
7. Re-ingest, then grade again → success.

## Notes
- **Claude (via OpenRouter)** requires an OpenRouter key, not Anthropic.
- DeepSeek vision may fail verify if the account has no multimodal model — use OpenRouter for multimodal DeepSeek if needed.
- Embeddings are always coerced to 768 dims for pgvector.
