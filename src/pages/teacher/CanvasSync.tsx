import React, { useState } from 'react';
import AppSidebar from '@/src/components/layout/AppSidebar';
import { AppPath } from '@/src/App';
import * as Icons from '@/src/components/ui/Icons';
import ThemeToggle from '@/src/components/ui/ThemeToggle';
import { canvasAPI } from '@/src/services/canvasAPI';
import { supabase } from '@/src/lib/supabase';

interface CanvasSyncProps {
    onBack: () => void;
    onLogout: () => void;
    onNavigateTo: (path: AppPath, params?: any) => void;
    onOpenNotifs?: () => void;
    currentPath: AppPath;
}

const CanvasSync: React.FC<CanvasSyncProps> = (props) => {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [errorDetails, setErrorDetails] = useState<string | null>(null);
    const [token, setToken] = useState(localStorage.getItem('custom_canvas_token') || '');
    const [geminiKey, setGeminiKey] = useState(localStorage.getItem('custom_gemini_api_key') || '');
    const [saveSuccess, setSaveSuccess] = useState(false);

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
                        if (stored.gemini_api_key) {
                            setGeminiKey(stored.gemini_api_key);
                            localStorage.setItem('custom_gemini_api_key', stored.gemini_api_key);
                        }
                    }
                }
            } catch (err) {
                console.warn("Backend token fetch failed", err);
            }
        };
        fetchKeys();
    }, []);

    const saveToken = async () => {
        if (token.trim()) {
            localStorage.setItem('custom_canvas_token', token.trim());
        } else {
            localStorage.removeItem('custom_canvas_token');
        }

        if (geminiKey.trim()) {
            localStorage.setItem('custom_gemini_api_key', geminiKey.trim());
        } else {
            localStorage.removeItem('custom_gemini_api_key');
        }

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.email) {
                await canvasAPI.syncTokenWithBackend(user.email, token.trim(), "", geminiKey.trim());
            }
        } catch (err) {
            console.warn("Backend sync failed", err);
        }

        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
    };

    const clearToken = () => {
        localStorage.removeItem('custom_canvas_token');
        localStorage.removeItem('custom_gemini_api_key');
        setToken('');
        setGeminiKey('');
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
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">Canvas API Access Token</label>
                                    <input 
                                        type="password"
                                        value={token}
                                        onChange={(e) => setToken(e.target.value)}
                                        placeholder="Paste your Canvas API token here..."
                                        className="w-full bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1rem] px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--brand-primary)]/20 outline-none transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">Gemini API Key</label>
                                    <input 
                                        type="password"
                                        value={geminiKey}
                                        onChange={(e) => setGeminiKey(e.target.value)}
                                        placeholder="Paste your Gemini API key here..."
                                        className="w-full bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1rem] px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--brand-primary)]/20 outline-none transition-all"
                                    />
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={saveToken}
                                        className="px-6 py-3 bg-[var(--brand-primary)] text-white rounded-[1rem] text-xs font-black uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-95 shadow-[var(--shadow-lg)]"
                                    >
                                        {saveSuccess ? 'Settings Saved!' : 'Save Connection Settings'}
                                    </button>
                                    <button
                                        onClick={clearToken}
                                        className="px-6 py-3 bg-[var(--bg-nested)] text-[var(--text-secondary)] rounded-[1rem] text-xs font-black uppercase tracking-widest transition-all hover:bg-[var(--bg-main)] border-2 border-[var(--border-primary)]"
                                    >
                                        Clear Token
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



