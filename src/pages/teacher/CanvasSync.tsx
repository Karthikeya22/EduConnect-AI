import { authErrorMessage, gradingAuthHeaders, syncCanvasMemberships } from '../../lib/gradingApi';
import React, { useState } from 'react';
import AppSidebar from '@/src/components/layout/AppSidebar';
import { AppPath } from '@/src/App';
import * as Icons from '@/src/components/ui/Icons';
import ThemeToggle from '@/src/components/ui/ThemeToggle';
import { canvasAPI } from '@/src/services/canvasAPI';
import { supabase } from '@/src/lib/supabase';
import {
    LLM_PROVIDERS,
    LlmProviderId,
    getStoredLlmApiKey,
    getStoredLlmProvider,
    gradingApiBase,
    saveLlmCredentials,
} from '@/src/lib/llmProviders';

interface CanvasSyncProps {
    onBack: () => void;
    onLogout: () => void;
    onNavigateTo: (path: AppPath, params?: any) => void;
    onOpenNotifs?: () => void;
    currentPath: AppPath;
}

const DEFAULT_CANVAS_BASE_URL =
    import.meta.env.VITE_CANVAS_BASE_URL || 'https://usflearn.instructure.com';

const CanvasSync: React.FC<CanvasSyncProps> = (props) => {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [errorDetails, setErrorDetails] = useState<string | null>(null);
    const [token, setToken] = useState(localStorage.getItem('custom_canvas_token') || '');
    const [canvasBaseUrl, setCanvasBaseUrl] = useState(
        localStorage.getItem('canvas_base_url') || DEFAULT_CANVAS_BASE_URL,
    );
    const [llmProvider, setLlmProvider] = useState<LlmProviderId | ''>(getStoredLlmProvider());
    const [llmApiKey, setLlmApiKey] = useState(getStoredLlmApiKey());
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [canvasMsg, setCanvasMsg] = useState<string | null>(null);
    const [llmMsg, setLlmMsg] = useState<string | null>(null);
    const [isVerifyingCanvas, setIsVerifyingCanvas] = useState(false);
    const [isVerifyingLlm, setIsVerifyingLlm] = useState(false);

    React.useEffect(() => {
        const fetchKeys = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (user?.email) {
                    const stored = await canvasAPI.fetchTokenFromBackend(user.email);
                    if (stored) {
                        if (stored.canvas_token) {
                            setToken(stored.canvas_token);
                            localStorage.setItem('custom_canvas_token', stored.canvas_token);
                        }
                        if (stored.llm_api_key || stored.gemini_api_key) {
                            const provider = (stored.llm_provider || 'gemini') as LlmProviderId;
                            const key = stored.llm_api_key || stored.gemini_api_key || '';
                            setLlmProvider(provider);
                            setLlmApiKey(key);
                            saveLlmCredentials(provider, key);
                        }
                    }
                }
            } catch (err) {
                console.warn("Backend token fetch failed", err);
            }
        };
        fetchKeys();
    }, []);

    const verifyCanvas = async () => {
        setCanvasMsg(null);
        setIsVerifyingCanvas(true);
        if (token.trim()) localStorage.setItem('custom_canvas_token', token.trim());
        else localStorage.removeItem('custom_canvas_token');

        try {
            const normalizedCanvasBaseUrl = canvasBaseUrl.trim();
            if (!normalizedCanvasBaseUrl) throw new Error('Enter your Canvas base URL.');
            localStorage.setItem('canvas_base_url', normalizedCanvasBaseUrl);
            const membershipSync = await syncCanvasMemberships(normalizedCanvasBaseUrl);
            await canvasAPI.getCourses();
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.email) {
                await canvasAPI.syncPreferences(user.email, {
                    canvas_token: token.trim(),
                    canvas_token_expiry: "",
                });
            }
            setCanvasMsg(`Connected — ${membershipSync.count} courses where Canvas lists you as teacher/TA.`);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (err: any) {
            setCanvasMsg(err.message || 'Canvas verification failed');
        } finally {
            setIsVerifyingCanvas(false);
        }
    };

    const verifyLlm = async () => {
        setLlmMsg(null);
        setIsVerifyingLlm(true);
        try {
            if (!llmProvider || !llmApiKey.trim()) {
                throw new Error('Select an LLM provider and paste your API key.');
            }
            const res = await fetch(`${gradingApiBase()}/api/verify-llm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await gradingAuthHeaders()) },
                body: JSON.stringify({ provider: llmProvider, api_key: llmApiKey.trim() }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.ok) {
                throw new Error(authErrorMessage(body) || body.error || `LLM verify failed (HTTP ${res.status})`);
            }
            saveLlmCredentials(llmProvider as LlmProviderId, llmApiKey.trim());
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.email) {
                await canvasAPI.syncPreferences(user.email, {
                    llm_api_key: llmApiKey.trim(),
                    llm_provider: llmProvider as string,
                });
            }
            setLlmMsg('LLM key verified and saved.');
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (err: any) {
            setLlmMsg(err.message || 'LLM verification failed');
        } finally {
            setIsVerifyingLlm(false);
        }
    };

    const clearToken = () => {
        localStorage.removeItem('custom_canvas_token');
        localStorage.removeItem('custom_gemini_api_key');
        localStorage.removeItem('llm_api_key');
        localStorage.removeItem('llm_provider');
        setToken('');
        setLlmApiKey('');
        setLlmProvider('');
        setCanvasMsg(null);
        setLlmMsg(null);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
    };

    const performTest = async () => {
        setLoading(true);
        setErrorDetails(null);
        setResult(null);

        try {
            const courses = await canvasAPI.getCourses();
            setResult(courses);
        } catch (err: any) {
            setErrorDetails(err.message || 'Unknown error occurred.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex w-full h-screen bg-[var(--bg-main)] text-[var(--text-primary)] font-['Plus_Jakarta_Sans'] overflow-hidden">
            <AppSidebar
                role="teacher"
                onNavigateTo={props.onNavigateTo}
                collapsed={sidebarCollapsed}
                setCollapsed={setSidebarCollapsed}
                onLogout={props.onLogout}
                currentPath={props.currentPath}
            />

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                <header className="h-20 bg-[var(--bg-card)] border-b-2 border-[var(--border-primary)] flex items-center justify-between px-8 shrink-0 z-40">
                    <div className="flex items-center space-x-4">
                        <h1 className="text-xl font-black text-zinc-900 dark:text-white tracking-tighter uppercase font-['Space_Grotesk']">
                            Canvas Diagnostic Terminal
                        </h1>
                    </div>
                    <div className="flex items-center space-x-6">
                        <ThemeToggle />
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto p-10 bg-[var(--bg-main)]">
                    <div className="max-w-4xl mx-auto space-y-6">

                        <div className="bg-[var(--bg-card)] border-2 border-[var(--border-primary)] rounded-[2.5rem] p-8 shadow-[var(--shadow-xl)]">
                            <h2 className="text-lg font-black uppercase text-[var(--text-primary)] mb-2">Canvas Configuration</h2>
                            <p className="text-sm font-medium text-[var(--text-muted)] mb-6">
                                You must provide your API keys here to use the features. These keys are stored securely in your profile.
                            </p>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">Canvas Base URL</label>
                                    <input
                                        type="url"
                                        value={canvasBaseUrl}
                                        onChange={(e) => setCanvasBaseUrl(e.target.value)}
                                        placeholder={DEFAULT_CANVAS_BASE_URL}
                                        className="w-full bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1rem] px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--brand-primary)]/20 outline-none transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">Canvas API Access Token</label>
                                    <input 
                                        type="password"
                                        value={token}
                                        onChange={(e) => setToken(e.target.value)}
                                        placeholder="Paste your Canvas API token here..."
                                        className="w-full bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1rem] px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--brand-primary)]/20 outline-none transition-all"
                                    />
                                    <button
                                        onClick={verifyCanvas}
                                        disabled={isVerifyingCanvas}
                                        className="mt-3 px-5 py-2.5 bg-[var(--text-primary)] text-[var(--bg-card)] rounded-[1rem] text-xs font-black uppercase tracking-widest disabled:opacity-50"
                                    >
                                        {isVerifyingCanvas ? 'Checking…' : 'Verify Canvas'}
                                    </button>
                                    {canvasMsg && (
                                        <p className={`mt-2 text-xs font-bold ${canvasMsg.startsWith('Connected') ? 'text-emerald-600' : 'text-[var(--color-danger)]'}`}>
                                            {canvasMsg}
                                        </p>
                                    )}
                                </div>
                                <div className="border-t-2 border-[var(--border-primary)] pt-4">
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">LLM Provider</label>
                                    <select
                                        value={llmProvider}
                                        onChange={(e) => setLlmProvider(e.target.value as LlmProviderId)}
                                        className="w-full bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1rem] px-4 py-3 text-sm outline-none"
                                    >
                                        <option value="">Select provider…</option>
                                        {LLM_PROVIDERS.map((p) => (
                                            <option key={p.id} value={p.id}>{p.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">LLM API Key</label>
                                    <input 
                                        type="password"
                                        value={llmApiKey}
                                        onChange={(e) => setLlmApiKey(e.target.value)}
                                        placeholder={
                                            LLM_PROVIDERS.find((p) => p.id === llmProvider)?.keyHint
                                            || 'Paste your provider API key...'
                                        }
                                        className="w-full bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1rem] px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--brand-primary)]/20 outline-none transition-all"
                                    />
                                    {llmProvider === 'openrouter_claude' && (
                                        <p className="mt-2 text-[10px] font-bold text-[var(--text-muted)]">
                                            Claude via OpenRouter — use an OpenRouter API key.
                                        </p>
                                    )}
                                    <button
                                        onClick={verifyLlm}
                                        disabled={isVerifyingLlm}
                                        className="mt-3 px-5 py-2.5 bg-[var(--brand-primary)] text-white rounded-[1rem] text-xs font-black uppercase tracking-widest disabled:opacity-50"
                                    >
                                        {isVerifyingLlm ? 'Checking…' : saveSuccess ? 'Saved!' : 'Verify LLM'}
                                    </button>
                                    {llmMsg && (
                                        <p className={`mt-2 text-xs font-bold ${llmMsg.includes('verified') ? 'text-emerald-600' : 'text-[var(--color-danger)]'}`}>
                                            {llmMsg}
                                        </p>
                                    )}
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={clearToken}
                                        className="px-6 py-3 bg-[var(--bg-nested)] text-[var(--text-secondary)] rounded-[1rem] text-xs font-black uppercase tracking-widest transition-all hover:bg-[var(--bg-main)] border-2 border-[var(--border-primary)]"
                                    >
                                        Clear Saved Keys
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="bg-[var(--bg-card)] border-2 border-[var(--border-primary)] rounded-[2.5rem] p-8 shadow-[var(--shadow-xl)]">
                            <h2 className="text-lg font-black uppercase text-[var(--text-primary)] mb-2">Connection Tester</h2>
                            <p className="text-sm font-medium text-[var(--text-muted)] mb-6">
                                Click the button below to invoke the `canvas-get-courses` Edge Function and verify your API keys and configuration.
                            </p>

                            <button
                                onClick={performTest}
                                disabled={loading}
                                className="px-6 py-3 bg-[var(--brand-primary)] hover:brightness-110 disabled:opacity-50 text-white rounded-[1rem] text-xs font-black uppercase tracking-widest transition-colors flex items-center gap-3 shadow-[var(--shadow-lg)]"
                            >
                                {loading ? <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div> : <Icons.IconCheck className="w-4 h-4" />}
                                {loading ? 'Bypassing Node...' : 'Initialize Connection'}
                            </button>
                        </div>

                        {errorDetails && (
                            <div className="bg-[var(--color-danger-bg)] border-2 border-[var(--color-danger)]/20 p-6 rounded-[1.25rem] shadow-[var(--shadow-sm)]">
                                <div className="flex items-start gap-4">
                                    <Icons.IconTarget className="w-6 h-6 text-[var(--color-danger)] shrink-0 mt-0.5" />
                                    <div>
                                        <h3 className="text-[10px] font-black text-[var(--color-danger)] uppercase tracking-widest mb-2">Connection Failure Trace</h3>
                                        <p className="font-mono text-[10px] text-[var(--color-danger)] break-all bg-[var(--bg-nested)] p-4 rounded-[1rem] border-2 border-[var(--border-primary)]">
                                            {errorDetails}
                                        </p>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] mt-4">
                                            <strong>Checklist:</strong><br />
                                            1. Is Docker running? (Windows tray icon)<br />
                                            2. Did you set the secret? (`npx supabase secrets set CANVAS_API_TOKEN=...`)<br />
                                            3. Did you deploy the function? (`npx supabase functions deploy canvas-get-courses`)
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {result && (
                            <div className="bg-[var(--color-success-bg)] border-2 border-[var(--color-success)]/20 p-6 rounded-[1.25rem] shadow-[var(--shadow-sm)]">
                                <div className="flex items-start gap-4">
                                    <Icons.IconCheck className="w-6 h-6 text-[var(--color-success)] shrink-0 mt-0.5" />
                                    <div className="w-full min-w-0">
                                        <h3 className="text-[10px] font-black text-[var(--color-success)] uppercase tracking-widest mb-2">Connection Established</h3>
                                        <p className="text-sm font-medium text-[var(--text-secondary)] mb-4">
                                            Successfully authenticated and routed data. Found {result.length} objects.
                                        </p>
                                        <div className="bg-[var(--text-primary)] p-4 rounded-[1rem] max-h-96 overflow-y-auto">
                                            <pre className="font-mono text-[10px] text-[var(--color-success)]">
                                                {JSON.stringify(result, null, 2)}
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                    </div>
                </main>
            </div>
        </div>
    );
};

export default CanvasSync;



