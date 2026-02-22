
import React, { useState, useEffect } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/logger';
import { Skeleton } from '../components/Skeleton';
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';
import * as Icons from '../components/Icons';
import { GoogleGenAI, Type } from "@google/genai";

interface CreateAssignmentProps {
  onBack: () => void;
  onNavigateTo: (path: AppPath) => void;
  onLogout: () => void;
  currentPath?: AppPath;
}

interface Assignment {
  id: string;
  assignment_name: string;
  assignment_type: string;
  topic: string;
  points_possible: number;
  due_date?: string;
  created_at: string;
}

interface Question {
  id: number;
  question: string;
  answer: string;
}

const CreateAssignment: React.FC<CreateAssignmentProps> = ({ onBack, onNavigateTo, onLogout, currentPath = 'teacher-assignments' }) => {
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [formData, setFormData] = useState({
    type: 'discussion',
    topic: '',
    customTopic: '',
    title: '',
    content: '',
    rubric: '',
    points: 100,
    dueDate: '',
    timeLimit: 60,
    questions: [] as Question[],
  });

  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiTopic, setAiTopic] = useState('');

  const DRAFT_KEY = 'EDUCONNECT_ASSIGNMENT_DRAFT';

  useEffect(() => {
    const savedDraft = localStorage.getItem(DRAFT_KEY);
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        setFormData(parsed);
        setToast({ message: "Draft restored from previous session.", type: 'success' });
        setTimeout(() => setToast(null), 3000);
      } catch (e) {
        console.error("Failed to load draft", e);
      }
    }
  }, []);

  // Auto-save logic
  useEffect(() => {
    const timer = setTimeout(() => {
      if (formData.title || formData.content || formData.topic) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(formData));
        setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      }
    }, 2000); // Debounce save
    return () => clearTimeout(timer);
  }, [formData]);

  const handleManualSave = () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(formData));
    setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    setToast({ message: "Draft saved manually.", type: 'success' });
    setTimeout(() => setToast(null), 3000);
  };

  const discardDraft = () => {
    if (window.confirm("Are you sure you want to discard this draft? This cannot be undone.")) {
      localStorage.removeItem(DRAFT_KEY);
      setFormData({
        type: 'discussion',
        topic: '',
        customTopic: '',
        title: '',
        content: '',
        rubric: '',
        points: 100,
        dueDate: '',
        timeLimit: 60,
        questions: []
      });
      setLastSaved(null);
      setToast({ message: "Draft discarded.", type: 'success' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const predefinedTopics = [
    "Chapter 1: Intro to Big Data",
    "Chapter 2: MapReduce Fundamentals",
    "Chapter 3: HDFS Architecture",
    "Chapter 4: Spark Ecosystem",
    "Chapter 5: Data Visualization (D3.js)",
    "Chapter 6: NoSQL Databases",
    "Custom"
  ];

  useEffect(() => {
    fetchInitialData();
    gsap.from(".animate-in", { opacity: 0, y: 20, stagger: 0.1, duration: 0.6, ease: "power2.out" });
  }, []);

  const fetchInitialData = async () => {
    setInitialLoading(true);
    try {
      const { data: assignData } = await supabase.from('assignments').select('*').order('created_at', { ascending: false });
      setAssignments(assignData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => setInitialLoading(false), 800);
    }
  };

  const handlePublish = async () => {
    // 1. Determine Final Topic
    const finalTopic = formData.topic === 'Custom' ? formData.customTopic : formData.topic;

    // 2. Validation
    if (!formData.title) {
      setToast({ message: "Asset Title is required.", type: 'error' });
      return;
    }
    if (!finalTopic) {
      setToast({ message: "Please select or enter a topic.", type: 'error' });
      return;
    }
    if (!formData.dueDate) {
      setToast({ message: "Due Date is required.", type: 'error' });
      return;
    }

    // Type-specific validation
    if (formData.type === 'quiz') {
      if (formData.questions.length === 0) {
        setToast({ message: "Quizzes must have at least one question.", type: 'error' });
        return;
      }
      const invalidQuestions = formData.questions.some(q => !q.question || !q.answer);
      if (invalidQuestions) {
        setToast({ message: "All quiz questions must have text and an answer key.", type: 'error' });
        return;
      }
    } else {
      if (!formData.content) {
        setToast({ message: "Instructions/Content is required.", type: 'error' });
        return;
      }
    }

    setLoading(true);
    try {
      // 3. Construct Payload
      let finalContent = formData.content;
      
      // If quiz, we serialize the questions and time limit into the content field (or a separate jsonb field if schema allows, assuming content text for now)
      if (formData.type === 'quiz') {
        finalContent = JSON.stringify({
          instruction: "Complete the following quiz within the time limit.",
          timeLimitMinutes: formData.timeLimit,
          questions: formData.questions
        });
      }

      const { error } = await supabase.from('assignments').insert({ 
        course_id: 'BIG_DATA_2026', 
        assignment_name: formData.title, 
        assignment_type: formData.type, 
        topic: finalTopic, 
        content: finalContent, 
        grading_criteria: formData.rubric, 
        points_possible: formData.points, 
        due_date: formData.dueDate 
      });
      if (error) throw error;
      
      await logActivity('DATABASE_UPDATE', `Published new assignment: ${formData.title}`);
      localStorage.removeItem(DRAFT_KEY);
      setLastSaved(null);
      fetchInitialData();
      
      // Reset Form
      setFormData({ 
        type: 'discussion', 
        topic: '', 
        customTopic: '', 
        title: '', 
        content: '', 
        rubric: '', 
        points: 100, 
        dueDate: '', 
        timeLimit: 60, 
        questions: [] 
      });
      
      setToast({ message: "Assignment Published Successfully!", type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setLoading(false);
      setTimeout(() => setToast(null), 5000);
    }
  };

  const addQuestion = () => {
    setFormData(prev => ({
      ...prev,
      questions: [...prev.questions, { id: Date.now(), question: '', answer: '' }]
    }));
  };

  const updateQuestion = (id: number, field: 'question' | 'answer', value: string) => {
    setFormData(prev => ({
      ...prev,
      questions: prev.questions.map(q => q.id === id ? { ...q, [field]: value } : q)
    }));
  };

  const removeQuestion = (id: number) => {
    setFormData(prev => ({
      ...prev,
      questions: prev.questions.filter(q => q.id !== id)
    }));
  };

  const generateAssignmentContent = async () => {
    if (!aiTopic.trim()) {
      setToast({ message: "Please provide a topic or learning objective for the AI.", type: 'error' });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    setAiLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      let prompt = "";
      let responseSchema: any = null;

      if (formData.type === 'quiz') {
        prompt = `Generate a quiz with 5 questions about "${aiTopic}". Return a JSON array of objects with "question" and "answer" fields.`;
        responseSchema = {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              answer: { type: Type.STRING }
            },
            required: ["question", "answer"]
          }
        };
      } else if (formData.type === 'discussion') {
        prompt = `Generate a discussion prompt and grading rubric for the topic: "${aiTopic}". Return a JSON object with "content" (the prompt) and "rubric" (the grading criteria).`;
        responseSchema = {
          type: Type.OBJECT,
          properties: {
            content: { type: Type.STRING },
            rubric: { type: Type.STRING }
          },
          required: ["content", "rubric"]
        };
      } else {
        prompt = `Generate technical lab instructions and grading rubric for the topic: "${aiTopic}". Return a JSON object with "content" (the instructions) and "rubric" (the grading criteria).`;
        responseSchema = {
          type: Type.OBJECT,
          properties: {
            content: { type: Type.STRING },
            rubric: { type: Type.STRING }
          },
          required: ["content", "rubric"]
        };
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema
        }
      });

      const result = JSON.parse(response.text || "{}");

      if (formData.type === 'quiz') {
        const newQuestions = (result as any[]).map((q, i) => ({
          id: Date.now() + i,
          question: q.question,
          answer: q.answer
        }));
        setFormData(prev => ({
          ...prev,
          questions: [...prev.questions, ...newQuestions]
        }));
      } else {
        setFormData(prev => ({
          ...prev,
          content: result.content || prev.content,
          rubric: result.rubric || prev.rubric
        }));
      }

      setToast({ message: "Content generated by AI!", type: 'success' });
    } catch (err: any) {
      console.error(err);
      setToast({ message: "AI generation failed. Please try again.", type: 'error' });
    } finally {
      setAiLoading(false);
      setTimeout(() => setToast(null), 3000);
    }
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

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header matched to Asset Hub */}
        <header className="h-20 bg-white border-b border-zinc-200 flex items-center justify-between px-8 shrink-0 z-20">
          <div className="flex items-center space-x-4">
             <h1 className="text-2xl font-black text-zinc-900 tracking-tighter uppercase font-['Space_Grotesk']">Architect</h1>
             <div className="h-6 w-px bg-zinc-200"></div>
             <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Lab Builder</span>
          </div>
          <div className="flex items-center space-x-4">
             <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-zinc-50 flex items-center justify-center text-zinc-400 transition-colors">✕</button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 lg:p-12 scroll-smooth bg-[#F8FAFC]">
          <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 h-full">
            
            {/* Left Column: Builder Form */}
            <div className="lg:col-span-7 space-y-8 animate-in pb-20">
               {/* Banner */}
               <div className="bg-gradient-to-r from-blue-600 to-cyan-500 rounded-[2rem] p-8 shadow-lg shadow-blue-900/10 text-white relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                  <button onClick={onBack} className="flex items-center space-x-2 text-white/80 hover:text-white transition-colors mb-4 text-xs font-bold uppercase tracking-widest">
                     <span>← Go Back</span>
                  </button>
                  <h2 className="text-3xl font-black tracking-tight relative z-10">Design and publish course-specific data labs.</h2>
               </div>

               {/* Form Card */}
               <div className="bg-white rounded-[3rem] p-10 shadow-xl border border-zinc-100 relative">
                  <div className="flex items-center justify-between mb-10">
                     <div className="flex items-center space-x-4">
                        <div className="w-14 h-14 bg-purple-50 rounded-2xl flex items-center justify-center text-2xl shadow-sm">📐</div>
                        <h3 className="text-2xl font-black text-zinc-900 tracking-tight">Build New Lab</h3>
                     </div>
                     {lastSaved && (
                        <div className="flex items-center space-x-3">
                           <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Saved at {lastSaved}</span>
                           <button onClick={discardDraft} className="text-[10px] font-black text-rose-500 uppercase tracking-widest hover:underline">Discard</button>
                        </div>
                     )}
                  </div>

                  <div className="space-y-8">
                     {/* AI Assistant Section */}
                     <div className="p-6 bg-purple-50 rounded-3xl border-2 border-purple-100 space-y-4">
                        <div className="flex items-center space-x-3">
                           <div className="w-8 h-8 bg-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg">✨</div>
                           <h4 className="text-sm font-black text-purple-900 uppercase tracking-widest">AI Content Architect</h4>
                        </div>
                        <p className="text-xs font-medium text-purple-700 leading-relaxed">Provide a topic or learning objective, and I'll draft the {formData.type === 'quiz' ? 'questions' : 'instructions and rubric'} for you.</p>
                        <div className="flex gap-3">
                           <input 
                              value={aiTopic}
                              onChange={e => setAiTopic(e.target.value)}
                              placeholder="e.g., MapReduce Shuffle Phase or D3.js Scales"
                              className="flex-1 h-12 px-5 bg-white border-2 border-purple-200 rounded-xl text-xs font-bold text-zinc-900 focus:border-purple-500 focus:outline-none transition-all"
                           />
                           <button 
                              onClick={generateAssignmentContent}
                              disabled={aiLoading}
                              className="h-12 px-6 bg-purple-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-50 flex items-center space-x-2"
                           >
                              {aiLoading ? (
                                 <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                              ) : (
                                 <><span>Draft Content</span></>
                              )}
                           </button>
                        </div>
                     </div>

                     {/* Row 1: Type & Topic */}
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-3">
                           <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Modality</label>
                           <div className="relative">
                             <select 
                               value={formData.type} 
                               onChange={e => setFormData({...formData, type: e.target.value})} 
                               className="w-full h-16 px-6 bg-white border-2 border-purple-500/30 rounded-2xl font-bold text-sm focus:border-purple-500 focus:outline-none focus:ring-4 focus:ring-purple-500/10 transition-all text-zinc-900 appearance-none"
                             >
                                <option value="discussion">Discussion Thread</option>
                                <option value="lab">Technical Lab</option>
                                <option value="quiz">Data Quiz</option>
                             </select>
                             <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none">
                                <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                             </div>
                           </div>
                        </div>
                        <div className="space-y-3">
                           <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Topic Group</label>
                           <div className="relative">
                             <select 
                               value={formData.topic} 
                               onChange={e => setFormData({...formData, topic: e.target.value})} 
                               className="w-full h-16 px-6 bg-zinc-50 border-2 border-zinc-100 rounded-2xl font-bold text-sm text-zinc-900 focus:border-purple-500 focus:outline-none transition-all appearance-none"
                             >
                                <option value="">Select Category</option>
                                {predefinedTopics.map(t => <option key={t} value={t}>{t}</option>)}
                             </select>
                             <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none">
                                <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                             </div>
                           </div>
                           {formData.topic === 'Custom' && (
                             <input 
                               value={formData.customTopic}
                               onChange={e => setFormData({...formData, customTopic: e.target.value})}
                               placeholder="Enter custom topic name"
                               className="w-full h-14 px-6 mt-2 bg-white border-2 border-zinc-200 rounded-2xl font-bold text-sm text-zinc-900 focus:border-purple-500 focus:outline-none transition-all"
                             />
                           )}
                        </div>
                     </div>

                     {/* Row 2: Title */}
                     <div className="space-y-3">
                        <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Asset Title</label>
                        <input 
                          value={formData.title} 
                          onChange={e => setFormData({...formData, title: e.target.value})} 
                          placeholder="e.g., Module 4: JSON Parsing Structures" 
                          className="w-full h-16 px-6 bg-zinc-50 border-2 border-zinc-100 rounded-2xl font-bold text-sm text-zinc-900 focus:border-purple-500 focus:outline-none transition-all placeholder:text-zinc-300" 
                        />
                     </div>

                     {/* Row 3: Meta Data */}
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-3">
                           <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Due Date</label>
                           <input 
                             type="datetime-local"
                             value={formData.dueDate} 
                             onChange={e => setFormData({...formData, dueDate: e.target.value})} 
                             className="w-full h-14 px-4 bg-zinc-50 border-2 border-zinc-100 rounded-2xl font-bold text-sm text-zinc-900 focus:border-purple-500 focus:outline-none transition-all" 
                           />
                        </div>
                        <div className="space-y-3">
                           <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Points</label>
                           <input 
                             type="number"
                             value={formData.points} 
                             onChange={e => setFormData({...formData, points: parseInt(e.target.value)})} 
                             className="w-full h-14 px-6 bg-zinc-50 border-2 border-zinc-100 rounded-2xl font-bold text-sm text-zinc-900 focus:border-purple-500 focus:outline-none transition-all" 
                           />
                        </div>
                        {formData.type === 'quiz' && (
                          <div className="space-y-3">
                             <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Time Limit (Min)</label>
                             <input 
                               type="number"
                               value={formData.timeLimit} 
                               onChange={e => setFormData({...formData, timeLimit: parseInt(e.target.value)})} 
                               className="w-full h-14 px-6 bg-zinc-50 border-2 border-zinc-100 rounded-2xl font-bold text-sm text-zinc-900 focus:border-purple-500 focus:outline-none transition-all" 
                             />
                          </div>
                        )}
                     </div>

                     {/* Conditional: Quiz Editor vs Text Editor */}
                     {formData.type === 'quiz' ? (
                        <div className="space-y-6 pt-6 border-t border-zinc-100">
                           <div className="flex items-center justify-between">
                              <h4 className="font-black text-lg text-zinc-900">Quiz Questions</h4>
                              <button onClick={addQuestion} className="px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:scale-105 transition-transform">+ Add Question</button>
                           </div>
                           
                           {formData.questions.length === 0 ? (
                             <div className="p-8 border-2 border-dashed border-zinc-200 rounded-2xl text-center text-zinc-400 font-bold text-xs">
                               No questions added yet.
                             </div>
                           ) : (
                             <div className="space-y-4">
                               {formData.questions.map((q, idx) => (
                                 <div key={q.id} className="p-6 bg-zinc-50 rounded-2xl border border-zinc-100 relative group">
                                    <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                       <button onClick={() => removeQuestion(q.id)} className="text-red-400 hover:text-red-600 font-bold text-xs">Remove</button>
                                    </div>
                                    <div className="space-y-4">
                                       <div className="flex items-center space-x-3">
                                          <span className="w-6 h-6 rounded-full bg-zinc-200 flex items-center justify-center text-xs font-black text-zinc-600">{idx + 1}</span>
                                          <input 
                                            value={q.question} 
                                            onChange={e => updateQuestion(q.id, 'question', e.target.value)} 
                                            placeholder="Question text..." 
                                            className="flex-1 bg-transparent border-b-2 border-zinc-200 focus:border-purple-500 outline-none font-bold text-sm py-1 text-zinc-900"
                                          />
                                       </div>
                                       <div className="pl-9">
                                          <input 
                                            value={q.answer} 
                                            onChange={e => updateQuestion(q.id, 'answer', e.target.value)} 
                                            placeholder="Correct Answer / Key..." 
                                            className="w-full bg-white px-4 py-2 rounded-lg border border-zinc-200 focus:border-purple-500 outline-none text-xs font-medium text-zinc-900"
                                          />
                                       </div>
                                    </div>
                                 </div>
                               ))}
                             </div>
                           )}
                        </div>
                     ) : (
                        <>
                          <div className="space-y-3">
                             <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Instructions / Content</label>
                             <textarea 
                               value={formData.content} 
                               onChange={e => setFormData({...formData, content: e.target.value})} 
                               rows={8} 
                               placeholder="Define objectives and methodology..." 
                               className="w-full p-6 bg-zinc-50 border-2 border-zinc-100 rounded-[2rem] font-medium text-sm text-zinc-900 focus:border-purple-500 focus:outline-none transition-all resize-none leading-relaxed placeholder:text-zinc-300" 
                             />
                          </div>
                          
                          <div className="space-y-3">
                             <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Grading Rubric</label>
                             <textarea 
                               value={formData.rubric} 
                               onChange={e => setFormData({...formData, rubric: e.target.value})} 
                               rows={4} 
                               placeholder="Outline criteria for full points..." 
                               className="w-full p-6 bg-zinc-50 border-2 border-zinc-100 rounded-[2rem] font-medium text-sm text-zinc-900 focus:border-purple-500 focus:outline-none transition-all resize-none leading-relaxed placeholder:text-zinc-300" 
                             />
                          </div>
                        </>
                     )}

                     <div className="pt-8 flex flex-col md:flex-row gap-4">
                        <button 
                          onClick={handleManualSave}
                          className="flex-1 h-20 bg-white border-2 border-zinc-100 text-zinc-500 rounded-[2rem] font-black text-xs uppercase tracking-widest hover:bg-zinc-50 hover:border-zinc-200 transition-all"
                        >
                           Save Draft
                        </button>
                        <button 
                          onClick={handlePublish} 
                          disabled={loading} 
                          className="flex-[2] h-20 bg-[#18181B] text-white rounded-[2rem] font-black text-xs uppercase tracking-[0.25em] shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center space-x-4 group"
                        >
                           {loading ? (
                             <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                           ) : (
                             <>
                               <span>Publish to Section Ledger</span>
                               <span className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">→</span>
                             </>
                           )}
                        </button>
                     </div>
                  </div>
               </div>
            </div>

            {/* Right Column: Published History (Sticky Hub) */}
            <div className="lg:col-span-5 relative animate-in" style={{ animationDelay: '0.1s' }}>
                <div className="sticky top-0 space-y-8">
                    <div className="bg-[#18181B] rounded-[3.5rem] p-10 shadow-2xl text-white relative overflow-hidden min-h-[600px] flex flex-col">
                        {/* Decorative Background Element */}
                        <div className="absolute -top-20 -right-20 w-80 h-80 bg-purple-500 rounded-full blur-[100px] opacity-20 pointer-events-none"></div>
                        
                        <div className="flex items-center justify-between mb-10 relative z-10">
                           <div className="flex items-center space-x-4">
                              <Icons.IconBook className="w-6 h-6 text-purple-400" />
                              <h3 className="text-xl font-bold tracking-tight">Published History</h3>
                           </div>
                           <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
                              <span className="text-xs font-bold text-purple-400">{assignments.length}</span>
                           </div>
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-4 scrollbar-hide pr-2 relative z-10 max-h-[calc(100vh-300px)]">
                           {initialLoading ? (
                             [1, 2, 3].map(i => (
                               <div key={i} className="p-6 bg-white/5 rounded-[2rem] border border-white/5 space-y-3">
                                  <Skeleton className="h-4 w-32 bg-white/10" />
                                  <Skeleton className="h-2 w-20 bg-white/5" />
                               </div>
                             ))
                           ) : assignments.length > 0 ? assignments.map((a) => (
                             <div key={a.id} className="p-6 bg-white/5 rounded-[2rem] border border-white/5 hover:bg-white/10 transition-all group cursor-default relative overflow-hidden">
                                <div className="absolute right-0 top-0 p-6 opacity-0 group-hover:opacity-100 transition-opacity">
                                   <span className="text-[10px] font-black uppercase text-white/50 tracking-widest">Edit</span>
                                </div>
                                <div className="flex justify-between items-start mb-2 pr-8">
                                   <h4 className="font-bold text-sm tracking-tight leading-snug">{a.assignment_name}</h4>
                                </div>
                                <div className="flex items-center space-x-3 mb-4">
                                   <span className="text-[8px] font-black uppercase bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-lg border border-purple-500/20">{a.assignment_type}</span>
                                   <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest truncate max-w-[120px]">{a.topic}</span>
                                </div>
                                <div className="pt-4 border-t border-white/5 flex justify-between items-center">
                                   <span className="text-[8px] text-zinc-500 font-bold">SYNCED {new Date(a.created_at).toLocaleDateString()}</span>
                                   <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] group-hover:bg-purple-500 group-hover:text-white transition-colors">→</div>
                                </div>
                             </div>
                           )) : (
                             <div className="py-20 text-center border-2 border-dashed border-white/10 rounded-[2.5rem]">
                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Repository Empty</p>
                             </div>
                           )}
                        </div>
                        
                        <div className="mt-8 pt-8 border-t border-white/10 relative z-10">
                           <button className="w-full py-4 rounded-2xl border border-white/10 hover:bg-white/5 text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center space-x-3">
                              <span>View Full Ledger</span>
                           </button>
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
        .animate-in { animation: fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
};

export default CreateAssignment;
