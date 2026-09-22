/** Mirrored from grading_server/utils/llm_registry.py — keep in sync. */

export type LlmProviderId =
  | 'openai'
  | 'gemini'
  | 'openrouter'
  | 'openrouter_claude'
  | 'nvidia'
  | 'deepseek'
  | 'kimi';

export interface LlmProviderOption {
  id: LlmProviderId;
  label: string;
  keyHint: string;
}

export const LLM_PROVIDERS: LlmProviderOption[] = [
  { id: 'openai', label: 'OpenAI', keyHint: 'Paste your OpenAI API key (sk-...)' },
  { id: 'gemini', label: 'Gemini', keyHint: 'Paste your Google AI Studio / Gemini API key' },
  { id: 'openrouter', label: 'OpenRouter', keyHint: 'Paste your OpenRouter API key' },
  {
    id: 'openrouter_claude',
    label: 'Claude (via OpenRouter)',
    keyHint: 'Requires an OpenRouter API key (Claude is routed through OpenRouter)',
  },
  { id: 'nvidia', label: 'NVIDIA', keyHint: 'Paste your NVIDIA NGC / NIM API key' },
  { id: 'deepseek', label: 'DeepSeek', keyHint: 'Paste your DeepSeek API key' },
  { id: 'kimi', label: 'Kimi', keyHint: 'Paste your Moonshot / Kimi API key' },
];

export const LLM_PROVIDER_STORAGE_KEY = 'llm_provider';
export const LLM_API_KEY_STORAGE_KEY = 'llm_api_key';
/** @deprecated migrated to llm_api_key */
export const LEGACY_GEMINI_KEY = 'custom_gemini_api_key';

export function getStoredLlmProvider(): LlmProviderId | '' {
  try {
    const p = localStorage.getItem(LLM_PROVIDER_STORAGE_KEY) || '';
    if (p && LLM_PROVIDERS.some((x) => x.id === p)) return p as LlmProviderId;
    // migrate: old gemini-only key
    if (localStorage.getItem(LEGACY_GEMINI_KEY)) return 'gemini';
  } catch (_) {}
  return '';
}

export function getStoredLlmApiKey(): string {
  try {
    return (
      localStorage.getItem(LLM_API_KEY_STORAGE_KEY) ||
      localStorage.getItem(LEGACY_GEMINI_KEY) ||
      ''
    );
  } catch (_) {
    return '';
  }
}

export function saveLlmCredentials(provider: LlmProviderId, apiKey: string) {
  localStorage.setItem(LLM_PROVIDER_STORAGE_KEY, provider);
  localStorage.setItem(LLM_API_KEY_STORAGE_KEY, apiKey);
  // Keep legacy key in sync for any remaining readers during migration
  if (provider === 'gemini') {
    localStorage.setItem(LEGACY_GEMINI_KEY, apiKey);
  } else {
    localStorage.removeItem(LEGACY_GEMINI_KEY);
  }
}

export function llmAuthHeaders(): Record<string, string> {
  const provider = getStoredLlmProvider();
  const apiKey = getStoredLlmApiKey();
  if (!provider || !apiKey) return {};
  return {
    'X-LLM-Provider': provider,
    'X-LLM-Api-Key': apiKey,
  };
}

export function requireLlmCredentials(): { provider: LlmProviderId; apiKey: string } {
  const provider = getStoredLlmProvider();
  const apiKey = getStoredLlmApiKey();
  if (!provider || !apiKey) {
    throw new Error(
      'Select an LLM provider and verify your API key (Course Selection → Verify & Save Keys) before grading.'
    );
  }
  return { provider, apiKey };
}

export function gradingApiBase(): string {
  // In Vite dev, proxy through same origin to avoid Brave/CORS "Failed to fetch".
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    return '/grading-api';
  }
  return (
    import.meta.env.VITE_GRADING_API_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    'http://127.0.0.1:5557'
  );
}
