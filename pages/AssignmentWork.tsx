
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { GoogleGenAI } from "@google/genai";
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';

interface AssignmentWorkProps {
  assignmentId: string;
  onBack: () => void;
  onNavigateTo: (path: AppPath) => void;
  currentPath: AppPath;
  onLogout: () => void;
}

interface Assignment {
  id: string;
  assignment_name: string;
  content: string;
  assignment_type: string;
  topic: string;
  points_possible: number;
  due_date: string;
}

const AssignmentWork: React.FC<AssignmentWorkProps> = (props) => {
  const [loading, setLoading] = useState(true);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [submission, setSubmission] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<'not_started' | 'submitted'>('not_started');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiThinking, setAiThinking] = useState(false);

  useEffect(() => {
    const fetchAssignment = async () => {
      setLoading(true);
      try {
        const { data } = await supabase.from('assignments').select('*').eq('id', props.assignmentId).single();
        setAssignment(data);
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          // Fixed: Removed metadata from select
          const { data: logs } = await supabase.from('student_assignment_logs').select('*').eq('assignment_id', props.assignmentId).eq('student_id', session.user.id).eq('interaction_type', 'submission').single();
          if (data) { setAiMessages([{ role: 'assistant', content: `Hello! I'm your AI tutor for the "${data.assignment_name}" assignment. How can I help you architect your solution?` }]); }
          if (logs) { setSubmission(logs.content); setStatus('submitted'); }
        }
      } catch (err) { console.error(err); } finally { setLoading(false); }
    };
    fetchAssignment();
  }, [props.assignmentId]);

  const handleSubmit = async () => {
    if (!submission.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await supabase.from('student_assignment_logs').insert({
        student_id: session.user.id,
        assignment_id: props.assignmentId,
        interaction_type: 'submission',
        content: submission,
        timestamp: new Date().toISOString()
      });
      const win = window as any;
      if (win.confetti) win.confetti({ particleCount: 200, spread: 90, origin: { y: 0.6 } });
      setStatus('submitted');
    } catch (err) { console.error(err); } finally { setIsSubmitting(false); }
  };

  const handleAISend = async () => {
    if (!aiInput.trim() || aiThinking) return;
    const msg = aiInput.trim();
    setAiInput('');
    setAiMessages(prev => [...prev, { role: 'user', content: msg }]);
    setAiThinking(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const res = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `Help for assignment "${assignment?.assignment_name}". Context: ${assignment?.content}. Student query: ${msg}`
      });
      setAiMessages(prev => [...prev, { role: 'assistant', content: res.text || "Snag in my knowledge hub. Try again?" }]);
    } catch (err) { setAiMessages(prev => [...prev, { role: 'assistant', content: "Database connection lost. Please retry." }]);
    } finally { setAiThinking(false); }
  };

  if (loading) return (
    <div className="h-screen w-full flex items-center justify-center bg-cyan-50">
      <div className="w-12 h-12 border-4 border-cyan-200 border-t-cyan-600 rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#F8FAFC] overflow-hidden font-['Plus_Jakarta_Sans']">
      <AppSidebar role="student" currentPath={props.currentPath} onNavigateTo={props.onNavigateTo} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} onLogout={props.onLogout} />
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="flex-[6] flex flex-col h-full overflow-y-auto p-10 md:p-14">
           <header className="mb-12 flex justify-between items-center">
              <button onClick={props.onBack} className="text-zinc-400 font-bold hover:text-cyan-600 transition-colors">← Back</button>
              <div className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest ${status === 'submitted' ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'}`}>
                {status === 'submitted' ? 'Grading in Progress' : 'Drafting Mode'}
              </div>
           </header>
           <h1 className="text-4xl font-black text-zinc-900 tracking-tighter mb-4">{assignment?.assignment_name}</h1>
           <div className="bg-white p-10 rounded-[3rem] border border-zinc-100 shadow-xl mb-12">
              <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-4">Instructions</h3>
              <p className="text-sm text-zinc-600 leading-relaxed font-medium whitespace-pre-wrap">{assignment?.content}</p>
           </div>
           <textarea value={submission} onChange={(e) => setSubmission(e.target.value)} disabled={status === 'submitted'} placeholder="Write your response here..." className="w-full flex-1 min-h-[300px] p-8 bg-white border-2 border-zinc-100 rounded-[3rem] focus:border-cyan-500 focus:outline-none transition-all font-medium text-sm shadow-xl shadow-cyan-900/5 mb-8 resize-none" />
           <div className="flex justify-end"><button onClick={handleSubmit} disabled={status === 'submitted' || isSubmitting || !submission.trim()} className="px-12 h-14 bg-zinc-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl disabled:opacity-50 transition-all hover:scale-105 active:scale-95">{isSubmitting ? 'Syncing...' : status === 'submitted' ? 'Submitted' : 'Turn In'}</button></div>
        </div>
        <aside className="flex-[4] bg-white border-l border-zinc-100 flex flex-col shadow-[-20px_0_40px_rgba(0,0,0,0.01)]">
           <header className="h-20 border-b flex items-center px-8 shrink-0"><span className="text-xl mr-3">🤖</span><h3 className="font-bold text-sm">Assignment TA</h3></header>
           <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-hide">
              {aiMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-up`}><div className={`max-w-[85%] p-5 rounded-3xl text-xs font-medium leading-relaxed ${m.role === 'user' ? 'bg-cyan-600 text-white' : 'bg-zinc-50 border text-zinc-800'}`}>{m.content}</div></div>
              ))}
              {aiThinking && <div className="p-5 bg-zinc-50 border rounded-3xl text-xs animate-pulse">Consulting the slides...</div>}
           </div>
           <div className="p-8 border-t bg-white flex items-center space-x-2"><input value={aiInput} onChange={(e) => setAiInput(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleAISend()} placeholder="Ask for a hint..." className="flex-1 h-12 px-6 bg-zinc-50 rounded-xl text-xs font-bold outline-none" /><button onClick={handleAISend} className="w-12 h-12 bg-cyan-600 text-white rounded-xl shadow-lg">➤</button></div>
        </aside>
      </div>
      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        @keyframes fade-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-up { animation: fade-up 0.4s ease-out forwards; }
      `}</style>
    </div>
  );
};

export default AssignmentWork;
