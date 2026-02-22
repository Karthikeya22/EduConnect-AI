import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import { GoogleGenAI } from "@google/genai";
import { logActivity } from '../lib/logger';
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';
import * as Icons from '../components/Icons';

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
  philosophy: string;
  greeting: string;
  gradingSamples: { id: string; input: string; output: string; grade?: string }[];
  name?: string;
}

const PERSONA_PRESETS = [
  {
    name: "The Sentinel",
    description: "Rigorous, professional, and highly detailed. Best for final projects.",
    settings: {
      tone: 10,
      detail: 90,
      strictness: 95,
      socratic: false,
      philosophy: "Technical excellence is non-negotiable. I provide exhaustive feedback on optimization, scalability, and code quality.",
      greeting: "Evaluation commencing. I have audited your submission against the architectural benchmarks.",
      gradingSamples: []
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
      philosophy: "Learning is a journey of discovery. I guide students by pointing out inconsistencies and asking them to justify their design choices.",
      greeting: "Hello! I've been looking over your work. It's an interesting approach—have you considered how this might scale?",
      gradingSamples: []
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
      philosophy: "Every student has potential. I focus on what they did right while gently suggesting areas for improvement to keep morale high.",
      greeting: "Great job on getting this submitted! I really liked how you handled the data ingestion part. Here are some thoughts for next time.",
      gradingSamples: []
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
    philosophy: "I believe in rigorous technical standards while providing constructive, actionable feedback that encourages students to think critically about data structures.",
    greeting: "Hello student. I've analyzed your submission against the course benchmarks. Here is my evaluation.",
    gradingSamples: []
  });

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
    if (!previewInput.trim()) return;
    setPreviewLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `
        You are an AI Grading Assistant. Act as a teacher with the following persona:
        - Tone: ${settings.tone}/100 (0 is cold/professional, 100 is warm/friendly)
        - Detail: ${settings.detail}/100 (0 is concise, 100 is verbose)
        - Strictness: ${settings.strictness}/100 (0 is lenient, 100 is rigorous)
        - Socratic Method: ${settings.socratic ? "Yes (ask questions to lead them to the answer)" : "No (give direct feedback)"}
        - Teaching Philosophy: ${settings.philosophy}
        - Standard Greeting: ${settings.greeting}

        Task: ${previewInput}
        
        Provide a sample grading response.
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
    setSettings({ ...preset.settings, gradingSamples: settings.gradingSamples });
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
        <header className="h-20 bg-white border-b border-zinc-200 flex items-center justify-between px-8 shrink-0 z-20">
          <div className="flex items-center space-x-4">
             <h1 className="text-2xl font-black text-zinc-900 tracking-tighter uppercase font-['Space_Grotesk']">Persona Architect</h1>
             <div className="h-6 w-px bg-zinc-200"></div>
             <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">AI Behavioral Logic</span>
          </div>
          <div className="flex items-center space-x-4">
             <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-zinc-50 flex items-center justify-center text-zinc-400 transition-colors">✕</button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 lg:p-12 scroll-smooth bg-[#F8FAFC]">
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
               <div className="animate-in bg-white rounded-[3rem] p-10 shadow-xl border border-zinc-100 space-y-10">
                  <div className="flex items-center space-x-4 mb-2">
                     <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-xl shadow-sm">⚙️</div>
                     <h3 className="text-xl font-black text-zinc-900 tracking-tight">Behavioral Parameters</h3>
                  </div>

                  <div className="grid grid-cols-1 gap-12">
                     {[
                        { label: 'Tone', min: 'Professional', max: 'Friendly', val: settings.tone, key: 'tone' },
                        { label: 'Technical Detail', min: 'Concise', max: 'Verbose', val: settings.detail, key: 'detail' },
                        { label: 'Strictness', min: 'Lenient', max: 'Rigorous', val: settings.strictness, key: 'strictness' },
                     ].map((slider) => (
                        <div key={slider.key} className="space-y-6">
                           <div className="flex justify-between items-center">
                              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{slider.label}</label>
                              <span className="text-xs font-black text-indigo-600">{slider.val}%</span>
                           </div>
                           <div className="relative h-2 bg-zinc-100 rounded-full">
                              <input 
                                 type="range" 
                                 min="0" 
                                 max="100" 
                                 value={slider.val} 
                                 onChange={(e) => setSettings({ ...settings, [slider.key]: parseInt(e.target.value) })}
                                 className="absolute inset-0 w-full h-full appearance-none bg-transparent cursor-pointer accent-indigo-600 z-10"
                              />
                              <div className="absolute top-0 left-0 h-full bg-indigo-600 rounded-full transition-all" style={{ width: `${slider.val}%` }}></div>
                           </div>
                           <div className="flex justify-between text-[8px] font-black text-zinc-300 uppercase tracking-widest">
                              <span>{slider.min}</span>
                              <span>{slider.max}</span>
                           </div>
                        </div>
                     ))}
                  </div>

                  <div className="pt-6 border-t border-zinc-50 flex items-center justify-between">
                     <div className="flex items-center space-x-3">
                        <div className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer ${settings.socratic ? 'bg-indigo-600' : 'bg-zinc-200'}`} onClick={() => setSettings({...settings, socratic: !settings.socratic})}>
                           <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings.socratic ? 'left-7' : 'left-1'}`}></div>
                        </div>
                        <span className="text-xs font-bold text-zinc-700">Socratic Method (Ask questions instead of giving answers)</span>
                     </div>
                  </div>
               </div>

               {/* Philosophy & Greeting */}
               <div className="animate-in bg-white rounded-[3rem] p-10 shadow-xl border border-zinc-100 space-y-8">
                  <div className="space-y-4">
                     <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Teaching Philosophy</label>
                     <textarea 
                        value={settings.philosophy}
                        onChange={(e) => setSettings({...settings, philosophy: e.target.value})}
                        rows={4}
                        placeholder="What are your core values as an educator?"
                        className="w-full p-6 bg-zinc-50 border-2 border-zinc-100 rounded-[2rem] font-medium text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none transition-all resize-none leading-relaxed"
                     />
                  </div>
                  <div className="space-y-4">
                     <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Standard Greeting</label>
                     <input 
                        value={settings.greeting}
                        onChange={(e) => setSettings({...settings, greeting: e.target.value})}
                        placeholder="How should the AI introduce itself?"
                        className="w-full h-16 px-6 bg-zinc-50 border-2 border-zinc-100 rounded-2xl font-bold text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none transition-all"
                     />
                  </div>
               </div>

               {/* Training Samples */}
               <div className="animate-in bg-white rounded-[3rem] p-10 shadow-xl border border-zinc-100 space-y-8">
                  <div className="flex items-center justify-between">
                     <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-xl shadow-sm">📚</div>
                        <h3 className="text-xl font-black text-zinc-900 tracking-tight">Grading Samples</h3>
                     </div>
                     <button onClick={addSample} className="px-4 py-2 bg-zinc-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-transform">+ Add Sample</button>
                  </div>
                  
                  <p className="text-xs text-zinc-500 font-medium">Provide examples of student work and how you would grade them to train the AI on your specific style.</p>

                  <div className="space-y-6">
                     {settings.gradingSamples.map((sample, idx) => (
                        <div key={sample.id} className="p-8 bg-zinc-50 rounded-[2.5rem] border border-zinc-100 relative group">
                           <button onClick={() => removeSample(sample.id)} className="absolute top-6 right-6 text-rose-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Icons.IconCheck className="w-5 h-5 rotate-45" />
                           </button>
                           <div className="space-y-6">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                 <div className="space-y-3">
                                    <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Student Submission</label>
                                    <textarea 
                                       value={sample.input}
                                       onChange={(e) => updateSample(sample.id, 'input', e.target.value)}
                                       rows={4}
                                       placeholder="Paste student work here..."
                                       className="w-full p-4 bg-white border border-zinc-200 rounded-xl text-xs font-medium focus:border-indigo-500 outline-none transition-all"
                                    />
                                 </div>
                                 <div className="space-y-3">
                                    <label className="text-[8px] font-black text-indigo-400 uppercase tracking-widest">Desired Feedback</label>
                                    <textarea 
                                       value={sample.output}
                                       onChange={(e) => updateSample(sample.id, 'output', e.target.value)}
                                       rows={4}
                                       placeholder="How would you respond?"
                                       className="w-full p-4 bg-white border border-zinc-200 rounded-xl text-xs font-medium focus:border-indigo-500 outline-none transition-all"
                                    />
                                 </div>
                              </div>
                              <div className="space-y-3 max-w-[200px]">
                                 <label className="text-[8px] font-black text-amber-500 uppercase tracking-widest">Desired Grade</label>
                                 <input 
                                    type="text"
                                    value={sample.grade || ''}
                                    onChange={(e) => updateSample(sample.id, 'grade', e.target.value)}
                                    placeholder="e.g. 85/100"
                                    className="w-full h-10 px-4 bg-white border border-zinc-200 rounded-xl text-xs font-bold focus:border-indigo-500 outline-none transition-all"
                                 />
                              </div>
                           </div>
                        </div>
                     ))}
                  </div>
               </div>

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
                        <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4">
                           <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Simulation Input</label>
                           <textarea 
                              value={previewInput}
                              onChange={(e) => setPreviewInput(e.target.value)}
                              rows={4}
                              className="w-full bg-transparent border-none focus:ring-0 text-sm font-medium text-zinc-300 resize-none placeholder:text-zinc-600"
                              placeholder="Describe a student scenario..."
                           />
                           <button 
                              onClick={generatePreview}
                              disabled={previewLoading}
                              className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500 transition-colors disabled:opacity-50 flex items-center justify-center space-x-3"
                           >
                              {previewLoading ? (
                                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                              ) : (
                                <>
                                  <span>Run Behavioral Test</span>
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
