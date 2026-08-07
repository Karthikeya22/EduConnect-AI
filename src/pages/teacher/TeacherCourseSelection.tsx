import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import { canvasAPI } from '@/src/services/canvasAPI';
import * as Icons from '@/src/components/ui/Icons';
import ThemeToggle from '@/src/components/ui/ThemeToggle';
import BackgroundParticles from '@/src/components/layout/BackgroundParticles';

import { supabase } from '@/src/lib/supabase';
import { GoogleGenAI } from "@google/genai";

interface Course {
  id: number;
  name: string;
  course_code: string;
  total_students?: number;
  course_image?: string;
  image_download_url?: string;
  public_description?: string;
  teachers?: { id: number; display_name: string; avatar_image_url?: string }[];
  term?: {
    id: number;
    name: string;
    start_at: string | null;
    end_at: string | null;
  };
}

export default function TeacherCourseSelection({ onLogout }: { onLogout?: () => void }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [availableTerms, setAvailableTerms] = useState<{ id: number; name: string }[]>([]);
  const [selectedTermId, setSelectedTermId] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [customToken, setCustomToken] = useState(localStorage.getItem('custom_canvas_token') || '');
  const [customTokenExpiry, setCustomTokenExpiry] = useState(localStorage.getItem('custom_canvas_token_expiry') || '');
  const [customGeminiKey, setCustomGeminiKey] = useState(localStorage.getItem('custom_gemini_api_key') || '');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticsData, setDiagnosticsData] = useState<any>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState('');
  
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  const runDiagnostics = async () => {
    setDiagnosticsLoading(true);
    setDiagnosticsError('');
    setDiagnosticsData(null);
    try {
      const token = localStorage.getItem('custom_canvas_token');
      if (!token) {
        setDiagnosticsError('No custom Canvas API token is active. Please enter and save one first.');
        setDiagnosticsLoading(false);
        return;
      }

      // Query 1: The standard courses endpoint used by the app (with enrollment_type=teacher)
      const resTeacher = await fetch(`/canvas-api/api/v1/courses?enrollment_type=teacher&state[]=available&per_page=100`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const dataTeacher = resTeacher.ok ? await resTeacher.json() : { error: `HTTP ${resTeacher.status}` };

      // Query 2: Unfiltered courses endpoint
      const resAll = await fetch(`/canvas-api/api/v1/courses?per_page=100`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const dataAll = resAll.ok ? await resAll.json() : { error: `HTTP ${resAll.status}` };

      setDiagnosticsData({
        teacherEndpoint: {
          url: '/api/v1/courses?enrollment_type=teacher&state[]=available',
          status: resTeacher.status,
          ok: resTeacher.ok,
          count: Array.isArray(dataTeacher) ? dataTeacher.length : 0,
          raw: dataTeacher
        },
        allEndpoint: {
          url: '/api/v1/courses',
          status: resAll.status,
          ok: resAll.ok,
          count: Array.isArray(dataAll) ? dataAll.length : 0,
          raw: dataAll
        }
      });
    } catch (err: any) {
      setDiagnosticsError(err.message || 'Failed to communicate with Canvas API proxy.');
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const fetchCourses = () => {
    setLoading(true);
    setError('');
    canvasAPI.getCourses()
      .then(fetchedCourses => {
        if (!fetchedCourses || fetchedCourses.length === 0) {
          setError("No Canvas courses found or Canvas API token missing.");
        } else {
          setCourses(fetchedCourses);
          
          const termsMap = new Map<number, { id: number; name: string }>();
          fetchedCourses.forEach((c: Course) => {
            if (c.term) {
              termsMap.set(c.term.id, { id: c.term.id, name: c.term.name });
            }
          });
          
          const terms = Array.from(termsMap.values()).sort((a, b) => b.id - a.id);
          setAvailableTerms(terms);
        }
      })
      .catch(err => {
        const errorMsg = err.message || "Failed to fetch Canvas courses. Make sure the Edge Functions and Secrets are configured correctly.";
        setError(errorMsg);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const handleVerifyAndSave = async () => {
    setIsVerifying(true);
    setVerifyResult(null);

    // Save token temporarily to local storage to use it in the Canvas API test
    if (customToken.trim()) localStorage.setItem('custom_canvas_token', customToken.trim());
    else localStorage.removeItem('custom_canvas_token');

    // 1. Verify Canvas
    try {
      await canvasAPI.getCourses(); // This uses the newly set local storage token
    } catch (e: any) {
      setVerifyResult({ type: 'error', message: `Canvas Verification Failed: ${e.message}` });
      setIsVerifying(false);
      return;
    }

    // 2. Verify Gemini
    try {
      const apiKey = customGeminiKey.trim();
      if (!apiKey) throw new Error("No Gemini API key provided and no default available.");
      
      const client = new GoogleGenAI({ apiKey } as any);
      const res = await (client as any).models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Respond with exactly the word 'OK'."
      });
      if (!res.text) throw new Error("No response received from Gemini.");
    } catch (e: any) {
      setVerifyResult({ type: 'error', message: `Gemini Verification Failed: ${e.message}` });
      setIsVerifying(false);
      return;
    }

    // Finalize save if both passed
    if (customTokenExpiry) {
      localStorage.setItem('custom_canvas_token_expiry', customTokenExpiry);
    } else {
      localStorage.removeItem('custom_canvas_token_expiry');
    }

    if (customGeminiKey.trim()) {
      localStorage.setItem('custom_gemini_api_key', customGeminiKey.trim());
    } else {
      localStorage.removeItem('custom_gemini_api_key');
    }

    // Persist to backend if user is logged in
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        await canvasAPI.syncTokenWithBackend(user.email, customToken.trim(), customTokenExpiry, customGeminiKey.trim());
      }
    } catch (err) {
      console.warn("Backend sync failed, still stored locally", err);
    }
    
    setVerifyResult({ type: 'success', message: "Both keys verified and saved successfully!" });
    fetchCourses();
    setIsVerifying(false);
  };

  useEffect(() => {
    const init = async () => {
      // First, try to fetch from backend to see if we have a newer/stored one
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email) {
          const stored = await canvasAPI.fetchTokenFromBackend(user.email);
          if (stored) {
            if (stored.canvas_token) {
              setCustomToken(stored.canvas_token);
              localStorage.setItem('custom_canvas_token', stored.canvas_token);
              if (stored.canvas_token_expiry) {
                 // convert to standard text if needed, handling potential PG timestamp format
                 const expiry = stored.canvas_token_expiry.split('T')[0];
                 setCustomTokenExpiry(expiry);
                 localStorage.setItem('custom_canvas_token_expiry', expiry);
              }
            }
            if (stored.gemini_api_key) {
              setCustomGeminiKey(stored.gemini_api_key);
              localStorage.setItem('custom_gemini_api_key', stored.gemini_api_key);
            }
          }
        }
      } catch (err) {
        console.warn("Backend token fetch failed", err);
      }
      fetchCourses();
    };
    init();
  }, []);

  useEffect(() => {
    if (!loading && courses.length > 0 && containerRef.current) {
      gsap.fromTo(containerRef.current.children, 
        { y: 50, opacity: 0 }, 
        { y: 0, opacity: 1, stagger: 0.1, duration: 0.8, ease: "power3.out" }
      );
    }
  }, [loading, courses]);

  const handleSelectCourse = (course: Course) => {
    localStorage.setItem('active_canvas_course', JSON.stringify({
      id: course.id,
      name: course.name,
      course_code: course.course_code,
      total_students: course.total_students,
      public_description: course.public_description,
      teachers: course.teachers,
      term: course.term,
    }));
    navigate('/teacher/dashboard');
  };

  const filteredCourses = courses.filter(c => selectedTermId === 'all' || (c.term && c.term.id === selectedTermId));

  return (
    <div className="min-h-screen bg-[var(--bg-main)] font-['Plus_Jakarta_Sans'] flex flex-col relative overflow-hidden transition-colors duration-500">
      <BackgroundParticles />

      {/* Header */}
      <header className="absolute top-0 w-full h-24 flex items-center justify-between px-10 md:px-20 z-20">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-[var(--brand-primary)] flex items-center justify-center text-white shadow-lg">
            <Icons.IconChart className="w-6 h-6" />
          </div>
          <h1 className="text-3xl font-black text-zinc-900 dark:text-white tracking-tighter uppercase font-['Space_Grotesk']">
            EduConnect <span className="bg-clip-text text-transparent bg-gradient-to-r from-[var(--brand-primary)] to-[var(--brand-accent)] animate-pulse inline-block">AI</span>
          </h1>
        </div>
        <div className="flex items-center space-x-6">
          <ThemeToggle />
          {onLogout && (
            <button onClick={onLogout} className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
              Sign Out
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center relative z-10 px-6 py-32">
        <div className="max-w-4xl w-full text-center mb-16 relative">
           <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/20 rounded-full blur-[120px] pointer-events-none -z-10"></div>
          
          <h2 className="text-[10px] md:text-xs font-black uppercase tracking-[0.3em] text-zinc-900 dark:text-white mb-6 flex items-center justify-center gap-3">
            <Icons.IconCheck className="w-4 h-4" /> Secure Canvas Integration
          </h2>
          <h1 className="text-5xl md:text-7xl font-black text-zinc-900 dark:text-white tracking-tighter leading-tight mb-6">
            Select Your <span className="text-[var(--brand-primary)]">Course Context</span>
          </h1>
          <p className="text-lg text-[var(--text-secondary)] font-medium max-w-2xl mx-auto">
            Your dashboard will automatically isolate data, assignments, and analytics strictly to the active course you select below.
          </p>

          {/* API Key Configurator */}
          <div className="mt-12 bg-[var(--bg-card)] border-2 border-[var(--border-primary)] rounded-[2.5rem] p-6 text-left max-w-2xl mx-auto shadow-[var(--shadow-xl)]">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <Icons.IconTarget className="w-4 h-4 text-indigo-500" />
              Canvas API Connection
            </h3>
            <div className="flex flex-col md:flex-row gap-4 mb-4">
              <div className="flex-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] mb-1.5 block">Canvas API Key</label>
                <input 
                  type="password" 
                  value={customToken}
                  onChange={(e) => setCustomToken(e.target.value)}
                  placeholder="Enter your Canvas API Key"
                  className="w-full bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1rem] px-4 py-3 text-sm font-medium text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]"
                />
              </div>
              <div className="md:w-48">
                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] mb-1.5 block">Expiration Date</label>
                <input 
                  type="date"
                  value={customTokenExpiry}
                  onChange={(e) => setCustomTokenExpiry(e.target.value)}
                  className="w-full bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1rem] px-4 py-3 text-sm font-medium text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)] styling-date"
                />
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4 mb-4">
              <div className="flex-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] mb-1.5 block">Gemini API Key</label>
                <input 
                  type="password" 
                  value={customGeminiKey}
                  onChange={(e) => setCustomGeminiKey(e.target.value)}
                  placeholder="Enter your Gemini API Key"
                  className="w-full bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1rem] px-4 py-3 text-sm font-medium text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]"
                />
              </div>
            </div>
            
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">
                  Status: {localStorage.getItem('custom_canvas_token') ? <span className="text-emerald-500">Custom Key Active</span> : <span className="text-red-500">Missing Key</span>}
                  {localStorage.getItem('custom_canvas_token_expiry') && <span className="ml-2 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded-md">Expires: {new Date(localStorage.getItem('custom_canvas_token_expiry')!).toLocaleDateString()}</span>}
                </p>
                <button 
                  onClick={handleVerifyAndSave}
                  disabled={isVerifying}
                  className="px-6 py-2.5 bg-[var(--brand-primary)] text-white text-xs font-black uppercase tracking-widest rounded-[1rem] hover:brightness-110 transition-colors shadow-[var(--shadow-lg)] disabled:opacity-50 flex items-center gap-2"
                >
                  {isVerifying ? <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div> : <Icons.IconCheck className="w-4 h-4" />}
                  {isVerifying ? 'Verifying...' : 'Verify & Save Keys'}
                </button>
              </div>

              {verifyResult && (
                <div className={`p-4 rounded-[1rem] text-xs font-bold ${verifyResult.type === 'success' ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-600 border border-rose-500/20'}`}>
                  {verifyResult.message}
                </div>
              )}
            </div>
          </div>

          {/* API Key Configurator Diagnostics Trigger */}
          {localStorage.getItem('custom_canvas_token') && (
            <div className="mt-4 max-w-2xl mx-auto w-full text-center">
              <button
                onClick={() => {
                  setShowDiagnostics(!showDiagnostics);
                  if (!showDiagnostics && !diagnosticsData) {
                    runDiagnostics();
                  }
                }}
                className="text-[10px] font-black text-[var(--brand-primary)] hover:brightness-110 underline transition-colors uppercase tracking-widest"
              >
                {showDiagnostics ? "Hide Connection Diagnostics" : "Troubleshoot: Test Canvas API Connection & View All Courses"}
              </button>
            </div>
          )}

          {/* Diagnostics Panel */}
          {showDiagnostics && (
            <div className="mt-6 bg-[var(--bg-card)] border-2 border-dashed border-[var(--brand-primary)]/30 rounded-[2.5rem] p-6 text-left max-w-2xl mx-auto shadow-[var(--shadow-xl)] relative z-20">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-100 dark:border-white/5">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--brand-primary)] flex items-center gap-2">
                  <Icons.IconChart className="w-4 h-4" />
                  Canvas API Connection Diagnostics
                </h4>
                <button
                  onClick={runDiagnostics}
                  disabled={diagnosticsLoading}
                  className="px-3 py-1 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-wider rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-all disabled:opacity-50"
                >
                  {diagnosticsLoading ? "Testing..." : "Run Diagnostic Tests"}
                </button>
              </div>

              {diagnosticsLoading && (
                <div className="py-8 text-center">
                  <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3"></div>
                  <p className="text-[10px] font-black text-[var(--text-muted)] animate-pulse uppercase tracking-widest">Fetching live data from Canvas API proxy...</p>
                </div>
              )}

              {diagnosticsError && (
                <div className="bg-[var(--color-danger-bg)] border-2 border-[var(--color-danger)]/20 rounded-[1rem] p-4 text-[10px] font-black uppercase tracking-widest text-[var(--color-danger)] mb-4">
                  <strong>Diagnostic Error:</strong> {diagnosticsError}
                </div>
              )}

              {diagnosticsData && (
                <div className="space-y-4 text-xs text-zinc-600 dark:text-zinc-400">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-[var(--bg-nested)] rounded-[1rem] p-4 border-2 border-[var(--border-primary)] md:col-span-2">
                      <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1 font-black">Active Token Verification</span>
                      <div className="text-zinc-900 dark:text-white font-mono text-xs mt-1">
                        {localStorage.getItem('custom_canvas_token') ? (
                          <>
                            <span className="text-emerald-500 font-bold">✓ Token Loaded:</span> Length is{" "}
                            <span className="font-bold text-indigo-500">{localStorage.getItem('custom_canvas_token')?.length}</span> characters. Starts with:{" "}
                            <span className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-indigo-500 font-bold">
                              {localStorage.getItem('custom_canvas_token')?.substring(0, 6)}...
                            </span>
                          </>
                        ) : (
                          <span className="text-red-500">✗ No custom token found in local storage.</span>
                        )}
                      </div>
                    </div>

                    <div className="bg-[var(--bg-nested)] rounded-[1rem] p-4 border-2 border-[var(--border-primary)]">
                      <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1 font-black">Teacher-Filtered API</span>
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-black text-zinc-900 dark:text-white">
                          {diagnosticsData.teacherEndpoint.count}
                        </span>
                        <span className="text-[10px] text-zinc-400 font-bold">courses found</span>
                      </div>
                      <span className={`inline-block mt-2 text-[9px] font-black px-2 py-0.5 rounded-full ${diagnosticsData.teacherEndpoint.ok ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                        HTTP {diagnosticsData.teacherEndpoint.status}
                      </span>
                    </div>

                    <div className="bg-[var(--bg-nested)] rounded-[1rem] p-4 border-2 border-[var(--border-primary)]">
                      <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1 font-black">Unfiltered API (All)</span>
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-black text-zinc-900 dark:text-white">
                          {diagnosticsData.allEndpoint.count}
                        </span>
                        <span className="text-[10px] text-zinc-400 font-bold">courses found</span>
                      </div>
                      <span className={`inline-block mt-2 text-[9px] font-black px-2 py-0.5 rounded-full ${diagnosticsData.allEndpoint.ok ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                        HTTP {diagnosticsData.allEndpoint.status}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h5 className="font-black text-zinc-900 dark:text-white uppercase tracking-wider mb-2">Detailed Course Inspection (From Canvas Response):</h5>
                    <div className="max-h-[250px] overflow-y-auto space-y-2 border-2 border-[var(--border-primary)] rounded-[1rem] p-3 bg-[var(--bg-nested)]">
                      {Array.isArray(diagnosticsData.allEndpoint.raw) && diagnosticsData.allEndpoint.raw.length > 0 ? (
                        diagnosticsData.allEndpoint.raw.map((c: any) => {
                          const hasName = !!c.name;
                          const hasCode = !!c.course_code;
                          const matchesFilter = hasName && hasCode;
                          
                          // Check if they are in the teacher endpoint
                          const inTeacherEndpoint = Array.isArray(diagnosticsData.teacherEndpoint.raw) &&
                            diagnosticsData.teacherEndpoint.raw.some((tc: any) => tc.id === c.id);

                          let statusMessage = "Visible";
                          let statusColor = "text-emerald-500";

                          if (!matchesFilter) {
                            statusMessage = "Hidden (Missing course name or code)";
                            statusColor = "text-red-500";
                          } else if (!inTeacherEndpoint) {
                            statusMessage = "Filtered out (Not enrolled as Teacher in this course)";
                            statusColor = "text-amber-500";
                          }

                          return (
                            <div key={c.id} className="p-3 bg-[var(--bg-card)] rounded-[1rem] border-2 border-[var(--border-primary)] shadow-[var(--shadow-sm)] space-y-1">
                              <div className="flex justify-between items-start">
                                <span className="font-bold text-zinc-900 dark:text-white text-xs">{c.name || "Unnamed Course"}</span>
                                <span className="text-[10px] text-zinc-400 font-mono">ID: {c.id}</span>
                              </div>
                              <div className="text-[10px] text-zinc-500 flex justify-between">
                                <span>Code: {c.course_code || "N/A"}</span>
                                <span className={`font-semibold ${statusColor}`}>{statusMessage}</span>
                              </div>
                              {c.enrollments && c.enrollments.length > 0 && (
                                <div className="text-[9px] text-zinc-400">
                                  Roles in course: {c.enrollments.map((e: any) => e.type).join(', ')}
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-zinc-400 italic text-center py-4">No raw courses returned by the API key.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center space-y-6">
            <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
            <p className="text-[var(--text-muted)] font-bold uppercase tracking-widest text-sm animate-pulse">Syncing with Canvas...</p>
          </div>
        ) : error ? (
           <div className="bg-[var(--color-danger-bg)] border-2 border-[var(--color-danger)]/20 rounded-[2.5rem] p-10 max-w-2xl text-center">
             <div className="w-16 h-16 bg-[var(--color-danger-bg)] text-[var(--color-danger)] rounded-[1.25rem] flex items-center justify-center mx-auto mb-6">
                <Icons.IconCheck className="w-8 h-8" />
             </div>
             <h3 className="text-2xl font-black text-[var(--color-danger)] mb-4 tracking-tight">Sync Error</h3>
             <p className="text-[var(--text-secondary)] font-bold mb-8">{error}</p>
             <button onClick={() => window.location.reload()} className="px-8 py-4 bg-[var(--color-danger)] text-white font-black uppercase tracking-widest text-sm rounded-[1rem] hover:brightness-110 transition-colors shadow-[var(--shadow-lg)]">
               Retry Connection
             </button>
           </div>
        ) : (
          <div className="w-full flex justify-center flex-col items-center">
            {availableTerms.length > 0 && (
              <div className="w-full max-w-6xl mx-auto mb-6 px-4 flex justify-between items-center group relative z-20">
                <div className="flex items-center space-x-3 bg-[var(--bg-card)] border-2 border-[var(--border-primary)] rounded-[1.25rem] p-2 px-5 shadow-[var(--shadow-sm)] transition-all hover:border-[var(--brand-primary)]/50">
                  <Icons.IconFilter className="w-4 h-4 text-indigo-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Semester:</span>
                  <select 
                    value={selectedTermId} 
                    onChange={(e) => setSelectedTermId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                    className="bg-transparent text-zinc-900 dark:text-white font-black text-sm outline-none cursor-pointer appearance-none pr-6 styling-select"
                    style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right center', backgroundSize: '1em' }}
                  >
                    <option value="all" className="bg-[var(--bg-card)] text-[var(--text-primary)]">All Semesters</option>
                    {availableTerms.map(term => (
                      <option key={term.id} value={term.id} className="bg-[var(--bg-card)] text-[var(--text-primary)]">{term.name}</option>
                    ))}
                  </select>
                </div>
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
                  Showing {filteredCourses.length} {filteredCourses.length === 1 ? 'Course' : 'Courses'}
                </div>
              </div>
            )}
            
            <div ref={containerRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-6xl mx-auto">
              {filteredCourses.map((course, i) => {
                const courseImg = course.image_download_url || course.course_image;
                const teacherNames = course.teachers?.map(t => t.display_name).join(', ');
                return (
              <button
                key={course.id}
                onClick={() => handleSelectCourse(course)}
                className="group relative bg-[var(--bg-card)] border-2 border-[var(--border-primary)] rounded-[2.5rem] p-8 text-left transition-all hover:-translate-y-2 hover:border-[var(--brand-primary)] hover:shadow-[var(--shadow-xl)] overflow-hidden flex flex-col"
                style={{ minHeight: '300px' }}
              >
                {/* Course Image Background */}
                {courseImg && (
                  <div className="absolute inset-0 z-0">
                    <img src={courseImg} alt="" className="w-full h-full object-cover opacity-[0.07] dark:opacity-[0.04] group-hover:opacity-[0.12] transition-opacity duration-500" />
                  </div>
                )}
                {/* Visual Flair */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--brand-primary)]/10 rounded-bl-full z-[1] transition-transform group-hover:scale-150"></div>
                
                <div className="relative z-10 flex-1">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 rounded-2xl flex items-center justify-center border border-indigo-100 dark:border-indigo-500/20 group-hover:scale-110 transition-transform">
                      <Icons.IconChart className="w-6 h-6" />
                    </div>
                    {typeof course.total_students === 'number' && (
                      <span className="text-[10px] font-black uppercase tracking-widest bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-3 py-1.5 rounded-full border border-indigo-100 dark:border-indigo-500/20">
                        {course.total_students} Student{course.total_students !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  <div className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-2">
                    {course.course_code}
                  </div>
                  <h3 className="text-xl md:text-2xl font-black text-zinc-900 dark:text-white tracking-tight leading-snug line-clamp-2 mb-3">
                    {course.name}
                  </h3>

                  {course.public_description && (
                    <p className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest line-clamp-2 mb-3 leading-relaxed">
                      {course.public_description.replace(/<[^>]*>/g, '')}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {course.term && (
                      <span className="text-[9px] font-bold uppercase tracking-widest bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 px-2.5 py-1 rounded-full border border-purple-100 dark:border-purple-500/20">
                        {course.term.name}
                      </span>
                    )}
                    {teacherNames && (
                      <span className="text-[9px] font-semibold text-zinc-400 dark:text-zinc-500 truncate max-w-[180px]">
                        {teacherNames}
                      </span>
                    )}
                  </div>
                </div>

                <div className="relative z-10 pt-4 border-t-2 border-[var(--border-primary)] flex items-center justify-between text-[var(--text-muted)] group-hover:text-[var(--brand-primary)] transition-colors">
                  <span className="text-[10px] font-black uppercase tracking-widest">Enter Hub</span>
                  <Icons.IconChevronDown className="w-5 h-5 -rotate-90 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
                );
            })}
          </div>
            
            {filteredCourses.length === 0 && (
              <div className="w-full text-center py-20 flex flex-col items-center justify-center">
                 <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800/50 text-zinc-400 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Icons.IconChart className="w-8 h-8 opacity-50" />
                 </div>
                 <h3 className="text-xl font-black text-zinc-500 dark:text-zinc-600 mb-2 tracking-tight">No Courses Found</h3>
                 <p className="text-zinc-400 dark:text-zinc-500 font-medium text-sm">Try selecting a different semester from the filter above.</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}



