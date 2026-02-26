import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import { GoogleGenAI } from "@google/genai";
import { logActivity } from '../lib/logger';
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';
import * as Icons from '../components/Icons';
import ThemeToggle from '../components/ThemeToggle';

interface PersonaSetupProps {
  onBack: () => void;
  onNavigateTo: (path: AppPath) => void;
  onLogout: () => void;
  currentPath?: AppPath;
}

interface PersonaSettings {
  tone: number; // 0 (Professional) to 100 (Friendly)
  detail: number; // 0 (Concise) to 100 (Verbose)
  strictness: number; // 0 (Lenient) to 100 (Rigorous)
  socratic: boolean;
  originalityCheck: boolean;
  philosophy: string;
  greeting: string;
  gradingSamples: { id: string; input: string; output: string; grade?: string }[];
  trainingMaterials: { id: string; name: string; content: string; synced: boolean }[];
  name?: string;
}

const PERSONA_PRESETS = [
  {
    name: "The Sentinel",
    description: "Rigorous, professional, and highly detailed. Best for final projects.",
    settings: {
      tone: 10,
      detail: 60,
      strictness: 95,
      socratic: false,
      originalityCheck: true,
      philosophy: "I prioritize logical accuracy and architectural efficiency. Feedback should be surgical—identifying the exact point of failure without unnecessary verbosity.",
      greeting: "Evaluation commencing. I have audited your logic.",
      gradingSamples: [],
      trainingMaterials: []
    }
  },
  {
    name: "The Socratic Mentor",
    description: "Friendly and guiding. Uses questions to lead students to the answer.",
    settings: {
      tone: 70,
      detail: 60,
      strictness: 60,
      socratic: true,
      originalityCheck: false,
      philosophy: "Learning is a journey of discovery. I guide students by pointing out logic gaps and asking them to justify their design choices.",
      greeting: "Hello! I've been looking over your work. It's an interesting approach—have you considered how this might scale?",
      gradingSamples: [],
      trainingMaterials: []
    }
  },
  {
    name: "The Encourager",
    description: "Warm, supportive, and focused on growth rather than perfection.",
    settings: {
      tone: 95,
      detail: 80,
      strictness: 40,
      socratic: false,
      originalityCheck: false,
      philosophy: "Every student has potential. I focus on what they did right while gently suggesting areas for improvement to maintain momentum.",
      greeting: "Great job on getting this submitted! I really liked how you handled the data ingestion part. Here are some thoughts for next time.",
      gradingSamples: [],
      trainingMaterials: []
    }
  }
];

const PersonaSetup: React.FC<PersonaSetupProps> = ({ onBack, onNavigateTo, onLogout, currentPath = 'teacher-persona' }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [settings, setSettings] = useState<PersonaSettings>({
    tone: 30,
    detail: 60,
    strictness: 80,
    socratic: false,
    originalityCheck: false,
    philosophy: "I believe in rigorous technical standards while providing constructive, actionable feedback that encourages students to think critically about data structures.",
    greeting: "Hello student. I've analyzed your submission against the course benchmarks. Here is my evaluation.",
    gradingSamples: [],
    trainingMaterials: []
  });

  const [simulationFile, setSimulationFile] = useState<{ name: string; content: string } | null>(null);
  const [simulationPrompt, setSimulationPrompt] = useState("Correct this thing based on my style.");
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);

  const [previewInput, setPreviewInput] = useState("Student submitted a MapReduce job that works but has inefficient shuffle logic. How would you grade and comment?");
  const [previewResponse, setPreviewResponse] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSettings();
    const ctx = gsap.context(() => {
      gsap.from(".animate-in", {
        y: 20,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: "power4.out"
      });
    }, mainRef);
    return () => ctx.revert();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('teacher_preferences')
        .select('persona_settings')
        .eq('teacher_email', session.user.email)
        .eq('course_id', 'BIG_DATA_2026')
        .single();

      if (data?.persona_settings) {
        setSettings(data.persona_settings as PersonaSettings);
      }
    } catch (err) {
      console.error("Error fetching settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = async () => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { error } = await supabase
        .from('teacher_preferences')
        .upsert({
          teacher_email: session.user.email,
          course_id: 'BIG_DATA_2026',
          persona_settings: settings,
          updated_at: new Date().toISOString()
        }, { onConflict: 'teacher_email,course_id' });

      if (error) throw error;

      await logActivity('DATABASE_UPDATE', 'Updated AI Persona configuration');
      setToast({ message: "Persona Architected Successfully", type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const generatePreview = async () => {
    if (!previewInput.trim() && !simulationFile) return;
    setPreviewLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const contextInput = simulationFile
        ? `File Content: ${simulationFile.content}\nUser Instruction: ${simulationPrompt}`
        : previewInput;

      const prompt = `
        You are an AI Grading Assistant. Act as a teacher with the following persona:
        - Tone: ${settings.tone}/100 (0 is cold/professional, 100 is warm/friendly)
        - Detail: ${settings.detail}/100 (0 is concise, 100 is verbose)
        - Strictness: ${settings.strictness}/100 (0 is lenient, 100 is rigorous)
        - Socratic Method: ${settings.socratic ? "Yes (lead with questions)" : "No (direct feedback)"}
        - Originality Check: ${settings.originalityCheck ? "Enabled (flag potential plagiarism or AI usage)" : "Disabled"}
        - Teaching Philosophy: ${settings.philosophy}
        - Greeting: ${settings.greeting}

        Constraints:
        1. BREVITY IS PARAMOUNT. Keep the total response under 150 words. Prioritize high-impact feedback over volume.
        2. Detail Level: ${settings.detail}/100. (Lower means fewer words, more direct).
        3. Structure:
           - ### 📋 Summary: (Max 2 sentences)
           - ### ✅ Strengths: (Max 3 bullet points)
           - ### ❌ Issues: (Max 3 high-impact logical errors)
           - ### 🚀 Next Step: (Single actionable instruction)
        4. Focus on core logic. Do not perform meta-analysis on file headers, document producers (e.g. MS Word), or fonts unless they are the assignment's topic.

        Task/Input: ${contextInput}
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });

      setPreviewResponse(response.text || "No response generated.");
    } catch (err) {
      console.error("Preview failed:", err);
      setPreviewResponse("Simulation failed. Check API configuration.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, isSim: boolean = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (isSim) {
        setSimulationFile({ name: file.name, content });
      } else {
        const newMaterial = {
          id: Date.now().toString(),
          name: file.name,
          content,
          synced: true
        };
        setSettings({
          ...settings,
          trainingMaterials: [...(settings.trainingMaterials || []), newMaterial]
        });

        // Simulated "learning" - adjust bars based on content keywords
        const lowerContent = content.toLowerCase();
        let newTone = settings.tone;
        let newStrict = settings.strictness;

        if (lowerContent.includes('strict') || lowerContent.includes('fail')) newStrict = Math.min(100, newStrict + 15);
        if (lowerContent.includes('good') || lowerContent.includes('great')) newTone = Math.min(100, newTone + 15);

        setSettings(s => ({ ...s, tone: newTone, strictness: newStrict }));
        setToast({ message: "AI has learned from the sample", type: 'success' });
        setTimeout(() => setToast(null), 2000);
      }
    };
    reader.readAsText(file);
  };

  const addSample = () => {
    const newSample = { id: Date.now().toString(), input: "", output: "" };
    setSettings({ ...settings, gradingSamples: [...settings.gradingSamples, newSample] });
  };

  const updateSample = (id: string, field: 'input' | 'output' | 'grade', value: string) => {
    setSettings({
      ...settings,
      gradingSamples: settings.gradingSamples.map(s => s.id === id ? { ...s, [field]: value } : s)
    });
  };

  const removeSample = (id: string) => {
    setSettings({
      ...settings,
      gradingSamples: settings.gradingSamples.filter(s => s.id !== id)
    });
  };

  const applyPreset = (preset: typeof PERSONA_PRESETS[0]) => {
    setSettings({
      ...(preset.settings as PersonaSettings),
      gradingSamples: settings.gradingSamples,
      trainingMaterials: settings.trainingMaterials
    });
    setToast({ message: `${preset.name} logic applied`, type: 'success' });
    setTimeout(() => setToast(null), 2000);
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] overflow-hidden font-['Plus_Jakarta_Sans']">
      <AppSidebar
        role="teacher"
        currentPath={currentPath}
        onNavigateTo={onNavigateTo}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        onLogout={onLogout}
      />

      <main ref={mainRef} className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-20 bg-white dark:bg-[#0B1120] border-b border-zinc-200 dark:border-white/5 flex items-center justify-between px-8 shrink-0 z-20 transition-colors">
          <div className="flex items-center space-x-4">
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter uppercase font-['Space_Grotesk']">Persona Architect</h1>
            <div className="h-6 w-px bg-zinc-200 dark:bg-white/10"></div>
            <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">AI Behavioral Logic</span>
          </div>
          <div className="flex items-center space-x-4">
            <ThemeToggle />
            <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-zinc-50 dark:hover:bg-white/5 flex items-center justify-center text-zinc-400 dark:text-zinc-500 transition-colors">✕</button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 lg:p-12 scroll-smooth bg-[#F8FAFC] dark:bg-[#020617] transition-colors">
          <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10">

            {/* Left Column: Configuration */}
            <div className="lg:col-span-7 space-y-8 pb-20">
              <div className="animate-in bg-gradient-to-r from-indigo-600 to-purple-600 rounded-[2.5rem] p-10 text-white shadow-2xl shadow-indigo-900/20 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                <h2 className="text-4xl font-black tracking-tighter mb-4 relative z-10">Pedagogical Architect.</h2>
                <p className="text-indigo-100 font-medium max-w-xl relative z-10">Define the behavioral DNA of your AI grading assistant. Select a preset or fine-tune the parameters to match your teaching style.</p>
              </div>

              {/* Presets */}
              <div className="animate-in grid grid-cols-1 md:grid-cols-3 gap-4">
                {PERSONA_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => applyPreset(preset)}
                    className="bg-white p-6 rounded-3xl border border-zinc-100 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all text-left group"
                  >
                    <h4 className="font-black text-zinc-900 text-sm mb-2 group-hover:text-indigo-600 transition-colors">{preset.name}</h4>
                    <p className="text-[10px] text-zinc-500 font-medium leading-relaxed">{preset.description}</p>
                  </button>
                ))}
              </div>

              {/* Behavioral Sliders */}
              {/* High-Level behavioral Summary Cards */}
              <div className="animate-in grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-[#0B1120] rounded-[2.5rem] p-8 shadow-xl border border-zinc-100 dark:border-white/5 flex flex-col justify-between">
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-widest">Core Behavioral DNA</h3>
                        <p className="text-[7px] font-bold text-zinc-400 uppercase tracking-[0.2em] mt-1">Active Profile Summary</p>
                      </div>
                      <span className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-xs">🧬</span>
                    </div>
                    <div className="space-y-4">
                      {['tone', 'detail', 'strictness'].map((k) => (
                        <div key={k} className="flex justify-between items-center text-[10px] font-bold text-zinc-500">
                          <span className="capitalize">{k}</span>
                          <span className="text-indigo-600">{(settings as any)[k]}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="bg-zinc-900 rounded-[2.5rem] p-8 shadow-2xl text-white flex flex-col justify-between relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10"><Icons.IconBot className="w-20 h-20" /></div>
                  <div className="relative z-10">
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Methodology</h3>
                      <div className="group relative">
                        <span className="text-[10px] text-zinc-500 cursor-help">ⓘ</span>
                        <div className="absolute top-0 right-full mr-3 w-48 p-3 bg-white text-zinc-900 rounded-2xl text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-2xl border border-zinc-100">
                          Configure how the AI interacts with students and verifies content.
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="group relative">
                        <button
                          onClick={() => setSettings({ ...settings, socratic: !settings.socratic })}
                          className={`w-full p-4 rounded-2xl border-2 transition-all text-center ${settings.socratic ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 bg-white/5 hover:border-white/20'}`}
                        >
                          <div className="text-lg mb-1">🤔</div>
                          <div className="text-[8px] font-black uppercase tracking-widest">Socratic</div>
                        </button>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-32 p-2 bg-indigo-600 text-white rounded-lg text-[7px] font-bold opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-center">
                          Guides students through questions instead of giving direct answers.
                        </div>
                      </div>
                      <div className="group relative">
                        <button
                          onClick={() => setSettings({ ...settings, originalityCheck: !settings.originalityCheck })}
                          className={`w-full p-4 rounded-2xl border-2 transition-all text-center ${settings.originalityCheck ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 bg-white/5 hover:border-white/20'}`}
                        >
                          <div className="text-lg mb-1">🛡️</div>
                          <div className="text-[8px] font-black uppercase tracking-widest">Originality</div>
                        </button>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-32 p-2 bg-indigo-600 text-white rounded-lg text-[7px] font-bold opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-center">
                          Scans for plagiarism and typical AI patterns in submissions.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Behavior Grids Side-by-Side */}
              <div className="animate-in grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Behavioral Sliders */}
                <div className="bg-white dark:bg-[#0B1120] rounded-[2.5rem] p-8 shadow-xl border border-zinc-100 dark:border-white/5 space-y-10">
                  <div className="flex items-center space-x-3 mb-2">
                    <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest">Fine-Tuning</h3>
                  </div>

                  <div className="grid grid-cols-1 gap-12">
                    {[
                      { label: 'Tone', left: 'Professional', right: 'Friendly', val: settings.tone, key: 'tone' },
                      { label: 'Detail', left: 'Concise', right: 'Verbose', val: settings.detail, key: 'detail' },
                      { label: 'Strictness', left: 'Lenient', right: 'Rigorous', val: settings.strictness, key: 'strictness' },
                    ].map((slider) => (
                      <div key={slider.key} className="space-y-4">
                        <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-widest px-1">
                          <span className="text-zinc-400">{slider.label}</span>
                          <span className="text-indigo-600">{slider.val}%</span>
                        </div>
                        <div className="relative h-1.5 bg-zinc-100 dark:bg-white/5 rounded-full">
                          <input
                            type="range" min="0" max="100" step="5" value={slider.val}
                            onChange={(e) => setSettings({ ...settings, [slider.key]: parseInt(e.target.value) })}
                            className="absolute inset-0 w-full h-full appearance-none bg-transparent cursor-pointer accent-indigo-600 z-10"
                          />
                          <div className="absolute top-0 left-0 h-full bg-indigo-600 rounded-full" style={{ width: `${slider.val}%` }}></div>
                        </div>
                        <div className="flex justify-between items-center text-[7px] font-bold text-zinc-300 dark:text-zinc-600 uppercase tracking-widest px-1">
                          <span>{slider.left}</span>
                          <span>{slider.right}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Training Materials Compact */}
                <div className="bg-white dark:bg-[#0B1120] rounded-[2.5rem] p-8 shadow-xl border border-zinc-100 dark:border-white/5 flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest">Style Training Lab</h3>
                    <label className="cursor-pointer text-[8px] font-black text-indigo-600 uppercase tracking-widest hover:underline">
                      + Upload
                      <input type="file" className="hidden" accept=".txt,.md,.pdf" onChange={(e) => handleFileUpload(e, false)} />
                    </label>
                  </div>
                  <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mb-4">Upload Professor Materials (Syllabi, past feedback)</p>
                  <div className="flex-1 space-y-3 overflow-y-auto max-h-[180px] scrollbar-hide">
                    {settings.trainingMaterials?.map(mat => (
                      <div key={mat.id} className="p-3 bg-zinc-50 dark:bg-white/5 rounded-xl border border-zinc-100 dark:border-white/10 flex items-center justify-between group">
                        <span className="text-[9px] font-bold text-zinc-600 dark:text-zinc-400 truncate max-w-[120px]">{mat.name}</span>
                        <button onClick={() => setSettings({ ...settings, trainingMaterials: settings.trainingMaterials.filter(m => m.id !== mat.id) })} className="text-rose-400 opacity-0 group-hover:opacity-100">✕</button>
                      </div>
                    ))}
                    {(settings.trainingMaterials?.length || 0) === 0 && <div className="h-full flex items-center justify-center text-zinc-300 text-[9px] uppercase font-black tracking-widest italic py-10">Empty Lab</div>}
                  </div>
                </div>
              </div>

              {/* Evaluation Ledger (Redo/Audit capability) */}
              <div className="animate-in bg-white dark:bg-[#0B1120] rounded-[2.5rem] p-8 shadow-xl border border-zinc-100 dark:border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest">Evaluation Ledger</h3>
                  <button onClick={addSample} className="text-xs font-black text-indigo-600 uppercase tracking-widest hover:scale-105 active:scale-95 transition-all">+ New Entry</button>
                </div>
                <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mb-6">Archive of AI evaluations. Redo or verify logic here.</p>
                <div className="grid grid-cols-1 gap-4 overflow-y-auto max-h-[300px] pr-2 scrollbar-hide">
                  {settings.gradingSamples.map((sample, idx) => (
                    <div key={sample.id} className="p-6 bg-zinc-50 dark:bg-white/5 rounded-2xl border border-zinc-100 dark:border-white/10 flex space-y-0 space-x-6 items-center group relative">
                      <div className="flex-1 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[8px] font-black text-indigo-500 uppercase tracking-widest">Entry #{idx + 1}</span>
                          <span className="text-[9px] font-black text-amber-500">{sample.grade || 'Pending'}</span>
                        </div>
                        <p className="text-[10px] text-zinc-600 dark:text-zinc-400 truncate max-w-[400px]">{sample.input || 'Waiting for submission...'}</p>
                      </div>
                      <div className="flex items-center space-x-3 opacity-0 group-hover:opacity-100 transition-all">
                        <button onClick={() => updateSample(sample.id, 'input', 'Manual Override Active')} className="w-8 h-8 rounded-full bg-white dark:bg-white/5 flex items-center justify-center shadow-sm text-[10px]">🔄</button>
                        <button onClick={() => removeSample(sample.id)} className="w-8 h-8 rounded-full bg-white dark:bg-white/5 flex items-center justify-center shadow-sm text-[8px] text-rose-500">✕</button>
                      </div>
                    </div>
                  ))}
                  {settings.gradingSamples.length === 0 && (
                    <div className="py-10 text-center border-2 border-dashed border-zinc-100 rounded-3xl text-zinc-300 text-[8px] font-black uppercase tracking-widest">No Grade Entries</div>
                  )}
                </div>
              </div>

              <div className="animate-in grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <label className="text-[9px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest ml-1">Philosophy</label>
                  <textarea
                    value={settings.philosophy}
                    onChange={(e) => setSettings({ ...settings, philosophy: e.target.value })}
                    rows={2}
                    className="w-full p-6 bg-white dark:bg-[#0B1120] border-2 border-zinc-100 dark:border-white/10 rounded-[2rem] font-medium text-[11px] text-zinc-900 dark:text-white focus:border-indigo-500 focus:outline-none transition-all resize-none shadow-sm"
                  />
                </div>
                <div className="space-y-4">
                  <label className="text-[9px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest ml-1">Greeting</label>
                  <input
                    value={settings.greeting}
                    onChange={(e) => setSettings({ ...settings, greeting: e.target.value })}
                    className="w-full h-16 px-6 bg-white dark:bg-[#0B1120] border-2 border-zinc-100 dark:border-white/10 rounded-2xl font-bold text-xs text-zinc-900 dark:text-white focus:border-indigo-500 focus:outline-none transition-all shadow-sm"
                  />
                </div>
              </div>

              {/* Redundant training samples section removed */}

              <button
                onClick={savePreferences}
                disabled={saving}
                className="animate-in w-full h-20 bg-[#18181B] text-white rounded-[2.5rem] font-black text-xs uppercase tracking-[0.3em] shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center space-x-4"
              >
                {saving ? (
                  <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <>
                    <span>Deploy Behavioral Logic</span>
                    <span className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">→</span>
                  </>
                )}
              </button>
            </div>

            {/* Right Column: Live Simulation */}
            <div className="lg:col-span-5 relative">
              <div className="sticky top-8 space-y-8 animate-in" style={{ animationDelay: '0.2s' }}>
                <div className="bg-[#0F172A] rounded-[3.5rem] p-10 shadow-2xl text-white relative overflow-hidden flex flex-col min-h-[700px]">
                  <div className="absolute -top-20 -right-20 w-80 h-80 bg-indigo-500 rounded-full blur-[120px] opacity-20 pointer-events-none"></div>

                  <div className="flex items-center justify-between mb-10 relative z-10">
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 bg-indigo-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
                        <Icons.IconBot className="w-7 h-7" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold tracking-tight">Live Simulation</h3>
                        <div className="flex items-center space-x-2 mt-1">
                          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                          <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Neural Engine Ready</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col space-y-6 relative z-10">
                    <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-5">
                      <div className="flex items-center justify-between">
                        <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Simulation Input</label>
                        <label className="cursor-pointer text-[8px] font-black text-indigo-400 uppercase tracking-widest hover:text-indigo-300">
                          {simulationFile ? `📄 ${simulationFile.name}` : 'Upload Test File'}
                          <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, true)} />
                        </label>
                      </div>

                      {simulationFile ? (
                        <div className="bg-black/40 rounded-2xl p-4 border border-white/10 animate-fade-up">
                          <label className="text-[7px] font-black text-zinc-600 uppercase tracking-widest block mb-1">Behavioral Instruction</label>
                          <textarea
                            value={simulationPrompt}
                            onChange={(e) => setSimulationPrompt(e.target.value)}
                            className="w-full bg-transparent border-none focus:ring-0 text-[11px] font-medium text-zinc-300 resize-none"
                            placeholder="e.g. Correct this thing based on my style..."
                          />
                        </div>
                      ) : (
                        <textarea
                          value={previewInput}
                          onChange={(e) => setPreviewInput(e.target.value)}
                          rows={4}
                          className="w-full bg-transparent border-none focus:ring-0 text-sm font-medium text-zinc-300 resize-none placeholder:text-zinc-600"
                          placeholder="Paste student work or describe a scenario..."
                        />
                      )}

                      <button
                        onClick={generatePreview}
                        disabled={previewLoading}
                        className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500 transition-colors disabled:opacity-50 flex items-center justify-center space-x-3 shadow-lg shadow-indigo-600/20"
                      >
                        {previewLoading ? (
                          <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                        ) : (
                          <>
                            <span>Run Behavioral Simulation</span>
                            <Icons.IconTrending className="w-4 h-4 rotate-90" />
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex-1 bg-white/5 border border-white/10 rounded-3xl p-8 relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500/30"></div>
                      <label className="text-[8px] font-black text-indigo-400 uppercase tracking-widest mb-4 block">AI Response Output</label>
                      <div className="prose prose-invert prose-sm max-w-none">
                        {previewResponse ? (
                          <p className="text-zinc-300 leading-relaxed italic">"{previewResponse}"</p>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
                            <div className="text-4xl mb-4 opacity-20">📡</div>
                            <p className="text-[10px] font-black uppercase tracking-widest">Waiting for simulation...</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 pt-8 border-t border-white/5 flex items-center justify-between text-[8px] font-black uppercase tracking-[0.2em] text-zinc-600 relative z-10">
                    <span>Latency: 12ms</span>
                    <span>Model: Gemini 3 Flash</span>
                    <span>Persona: Active</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {toast && (
        <div className={`fixed bottom-12 left-1/2 -translate-x-1/2 px-8 py-4 rounded-2xl shadow-2xl text-white font-black text-[11px] uppercase tracking-widest z-[5000] animate-fade-up flex items-center space-x-3 ${toast.type === 'success' ? 'bg-[#18181B]' : 'bg-red-600'}`}>
          <span>{toast.type === 'success' ? '✓' : '!'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-up { animation: fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .perspective-1000 { perspective: 1000px; }
      `}</style>
    </div>
  );
};

export default PersonaSetup;
