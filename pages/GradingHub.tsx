import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import { GoogleGenAI } from "@google/genai";
import { logActivity } from '../lib/logger';
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';
import * as Icons from '../components/Icons';

interface GradingHubProps {
  onBack: () => void;
  onNavigateTo: (path: AppPath) => void;
  onLogout: () => void;
  currentPath?: AppPath;
}

interface Submission {
  id: string;
  student_id: string;
  assignment_id: string;
  content: string;
  timestamp: string;
  student_name?: string;
  assignment_name?: string;
  grade?: number;
  feedback?: string;
  ai_suggested_grade?: number;
  ai_suggested_feedback?: string;
  assignment_rubric?: any;
}

const GradingHub: React.FC<GradingHubProps> = ({ onBack, onNavigateTo, onLogout, currentPath = 'teacher-grading' }) => {
  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [gradingLoading, setGradingLoading] = useState<string | null>(null);
  const [persona, setPersona] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
    fetchPersona();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch submissions
      const { data: logs, error: logsError } = await supabase
        .from('student_assignment_logs')
        .select(`
          *,
          assignments (assignment_name, rubric)
        `)
        .eq('interaction_type', 'submission')
        .order('timestamp', { ascending: false });

      if (logsError) throw logsError;

      // Fetch student names from activity logs (as a proxy for a users table)
      const { data: activityLogs } = await supabase
        .from('platform_activity_logs')
        .select('user_id, user_email');

      const userMap = new Map();
      activityLogs?.forEach(log => {
        if (!userMap.has(log.user_id)) {
          userMap.set(log.user_id, log.user_email?.split('@')[0].replace('.', ' ') || 'Student');
        }
      });

      const formattedSubmissions: Submission[] = (logs || []).map(log => ({
        id: log.id,
        student_id: log.student_id,
        assignment_id: log.assignment_id,
        content: log.content,
        timestamp: log.timestamp,
        assignment_name: log.assignments?.assignment_name || 'Unknown Assignment',
        student_name: userMap.get(log.student_id) || 'Unknown Student',
        grade: log.metadata?.grade,
        feedback: log.metadata?.feedback,
        ai_suggested_grade: log.metadata?.ai_suggested_grade,
        ai_suggested_feedback: log.metadata?.ai_suggested_feedback,
        assignment_rubric: log.assignments?.rubric
      }));

      setSubmissions(formattedSubmissions);
    } catch (err) {
      console.error("Error fetching submissions:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPersona = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data } = await supabase
        .from('teacher_preferences')
        .select('persona_settings')
        .eq('teacher_email', session.user.email)
        .eq('course_id', 'BIG_DATA_2026')
        .single();

      if (data?.persona_settings) {
        setPersona(data.persona_settings);
      }
    } catch (err) {
      console.error("Error fetching persona:", err);
    }
  };

  const runAIGrade = async (submission: Submission) => {
    setGradingLoading(submission.id);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const personaContext = persona ? `
        Act as a teacher with this persona:
        - Tone: ${persona.tone}/100 (0: cold, 100: warm)
        - Detail: ${persona.detail}/100 (0: concise, 100: verbose)
        - Strictness: ${persona.strictness}/100 (0: lenient, 100: rigorous)
        - Socratic: ${persona.socratic ? "Yes, ask questions to guide the student." : "No, provide direct feedback."}
        - Philosophy: ${persona.philosophy}
        
        ${persona.gradingSamples?.length > 0 ? `
        Here are some examples of how you have graded similar work in the past:
        ${persona.gradingSamples.map((s: any) => `
        ---
        Example Submission: ${s.input}
        Example Feedback: ${s.output}
        Example Grade: ${s.grade || 'N/A'}
        `).join('\n')}
        ` : ''}
      ` : "Act as a professional and fair teacher.";

      const rubricContext = submission.assignment_rubric ? `
        Use the following rubric for grading:
        ${JSON.stringify(submission.assignment_rubric, null, 2)}
      ` : '';

      const prompt = `
        ${personaContext}
        
        Assignment: ${submission.assignment_name}
        ${rubricContext}
        Student Submission: ${submission.content}
        
        Please provide encouraging and constructive feedback. Start by acknowledging the student's effort. Then, provide specific, actionable advice tied to the grading rubric.
        Grade this submission on a scale of 0-100.
        Return ONLY a JSON object with "grade" (number) and "feedback" (string).
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(response.text || "{}");
      
      // Update local state
      const updatedSubmissions = submissions.map(s => 
        s.id === submission.id ? { ...s, ai_suggested_grade: result.grade, ai_suggested_feedback: result.feedback } : s
      );
      setSubmissions(updatedSubmissions);
      
      // Update Supabase metadata
      await supabase.from('student_assignment_logs').update({
        metadata: { 
          ...submission, 
          ai_suggested_grade: result.grade, 
          ai_suggested_feedback: result.feedback 
        }
      }).eq('id', submission.id);

      if (selectedSubmission?.id === submission.id) {
        setSelectedSubmission({ ...selectedSubmission, ai_suggested_grade: result.grade, ai_suggested_feedback: result.feedback });
      }

    } catch (err) {
      console.error("AI Grading failed:", err);
    } finally {
      setGradingLoading(null);
    }
  };

  const finalizeGrade = async (submission: Submission, finalGrade: number, finalFeedback: string) => {
    try {
      const { error } = await supabase.from('student_assignment_logs').update({
        metadata: {
          grade: finalGrade,
          feedback: finalFeedback,
          graded_at: new Date().toISOString()
        }
      }).eq('id', submission.id);

      if (error) throw error;

      setSubmissions(submissions.map(s => 
        s.id === submission.id ? { ...s, grade: finalGrade, feedback: finalFeedback } : s
      ));
      
      if (selectedSubmission?.id === submission.id) {
        setSelectedSubmission({ ...selectedSubmission, grade: finalGrade, feedback: finalFeedback });
      }

      setToast({ message: "Grade Finalized", type: 'success' });
      await logActivity('GRADE_ASSIGNMENT', `Graded ${submission.assignment_name} for ${submission.student_name}`);
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' });
    } finally {
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

      <main ref={mainRef} className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-20 bg-white border-b border-zinc-200 flex items-center justify-between px-8 shrink-0 z-20">
          <div className="flex items-center space-x-4">
             <h1 className="text-2xl font-black text-zinc-900 tracking-tighter uppercase font-['Space_Grotesk']">Grading Hub</h1>
             <div className="h-6 w-px bg-zinc-200"></div>
             <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">AI-Assisted Evaluation</span>
          </div>
          <div className="flex items-center space-x-4">
             <button onClick={onBack} className="px-6 h-11 bg-zinc-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all">Dashboard</button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* List Column */}
          <div className="w-full lg:w-[450px] border-r border-zinc-200 bg-white flex flex-col shrink-0">
             <div className="p-6 border-b border-zinc-100">
                <div className="relative">
                   <Icons.IconCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                   <input placeholder="Search submissions..." className="w-full h-12 pl-12 pr-4 bg-zinc-50 border border-zinc-100 rounded-xl text-xs font-bold focus:border-indigo-500 outline-none transition-all" />
                </div>
             </div>
             <div className="flex-1 overflow-y-auto divide-y divide-zinc-50">
                {loading ? (
                  <div className="p-10 text-center space-y-4">
                    <div className="w-10 h-10 border-4 border-zinc-100 border-t-indigo-600 rounded-full animate-spin mx-auto"></div>
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Syncing Submissions...</p>
                  </div>
                ) : submissions.length === 0 ? (
                  <div className="p-20 text-center opacity-30">
                    <div className="text-4xl mb-4">📥</div>
                    <p className="text-xs font-black uppercase tracking-widest">No pending submissions</p>
                  </div>
                ) : (
                  submissions.map(sub => (
                    <button 
                      key={sub.id} 
                      onClick={() => setSelectedSubmission(sub)}
                      className={`w-full p-6 text-left transition-all hover:bg-zinc-50 flex flex-col space-y-3 ${selectedSubmission?.id === sub.id ? 'bg-indigo-50/50 border-l-4 border-indigo-600' : 'border-l-4 border-transparent'}`}
                    >
                      <div className="flex justify-between items-start">
                         <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">{sub.assignment_name}</span>
                         <span className="text-[8px] font-bold text-zinc-400">{new Date(sub.timestamp).toLocaleDateString()}</span>
                      </div>
                      <h4 className="font-black text-zinc-900 tracking-tight">{sub.student_name}</h4>
                      <div className="flex items-center space-x-3">
                         {sub.grade !== undefined ? (
                           <span className="px-2 py-0.5 bg-emerald-100 text-emerald-600 rounded text-[9px] font-black uppercase">Graded: {sub.grade}</span>
                         ) : sub.ai_suggested_grade !== undefined ? (
                           <span className="px-2 py-0.5 bg-amber-100 text-amber-600 rounded text-[9px] font-black uppercase">AI Draft Ready</span>
                         ) : (
                           <span className="px-2 py-0.5 bg-zinc-100 text-zinc-500 rounded text-[9px] font-black uppercase tracking-widest">Pending</span>
                         )}
                      </div>
                    </button>
                  ))
                )}
             </div>
          </div>

          {/* Detail Column */}
          <div className="flex-1 bg-[#F8FAFC] overflow-y-auto p-8 lg:p-12">
             {selectedSubmission ? (
               <div className="max-w-4xl mx-auto space-y-8 animate-fade-up">
                  <div className="flex justify-between items-end">
                     <div>
                        <h2 className="text-4xl font-black text-zinc-900 tracking-tighter mb-2">{selectedSubmission.student_name}</h2>
                        <p className="text-zinc-500 font-bold uppercase text-xs tracking-widest">{selectedSubmission.assignment_name}</p>
                     </div>
                     <div className="flex space-x-4">
                        <button 
                          onClick={() => runAIGrade(selectedSubmission)}
                          disabled={gradingLoading === selectedSubmission.id}
                          className="px-6 h-12 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-indigo-600/20 hover:scale-105 transition-all disabled:opacity-50 flex items-center space-x-3"
                        >
                           {gradingLoading === selectedSubmission.id ? (
                             <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                           ) : (
                             <>
                               <Icons.IconBot className="w-4 h-4" />
                               <span>AI Auto-Grade</span>
                             </>
                           )}
                        </button>
                     </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                     {/* Submission Content */}
                     <div className="space-y-6">
                        <div className="bg-white rounded-[2.5rem] p-10 shadow-xl border border-zinc-100 min-h-[400px]">
                           <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-6">Student Submission</h3>
                           <div className="prose prose-sm max-w-none text-zinc-700 font-medium leading-relaxed whitespace-pre-wrap">
                              {selectedSubmission.content}
                           </div>
                        </div>
                     </div>

                     {/* Grading Panel */}
                     <div className="space-y-8">
                        {/* AI Suggestion */}
                        {(selectedSubmission.ai_suggested_grade !== undefined || gradingLoading === selectedSubmission.id) && (
                          <div className="bg-[#0F172A] rounded-[2.5rem] p-10 text-white shadow-2xl relative overflow-hidden">
                             <div className="absolute top-0 right-0 p-6 opacity-10"><Icons.IconBot className="w-20 h-20" /></div>
                             <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-6">AI Persona Suggestion</h3>
                             
                             {gradingLoading === selectedSubmission.id ? (
                               <div className="py-10 text-center space-y-4">
                                  <div className="w-10 h-10 border-4 border-white/10 border-t-indigo-500 rounded-full animate-spin mx-auto"></div>
                                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest animate-pulse">Consulting Persona Architect...</p>
                               </div>
                             ) : (
                               <div className="space-y-6">
                                  <div className="flex items-center space-x-4">
                                     <div className="text-5xl font-black text-indigo-400">{selectedSubmission.ai_suggested_grade}</div>
                                     <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Suggested<br/>Score</div>
                                  </div>
                                  <p className="text-sm text-zinc-300 leading-relaxed italic font-medium">"{selectedSubmission.ai_suggested_feedback}"</p>
                                  <button 
                                    onClick={() => finalizeGrade(selectedSubmission, selectedSubmission.ai_suggested_grade!, selectedSubmission.ai_suggested_feedback!)}
                                    className="w-full py-4 bg-white text-black rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-400 hover:text-white transition-all"
                                  >
                                    Accept AI Evaluation
                                  </button>
                               </div>
                             )}
                          </div>
                        )}

                        {/* Final Grade Form */}
                        <div className="bg-white rounded-[2.5rem] p-10 shadow-xl border border-zinc-100 space-y-8">
                           <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Final Evaluation</h3>
                           <div className="space-y-6">
                              <div className="space-y-3">
                                 <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Final Score (0-100)</label>
                                 <input 
                                    type="number" 
                                    value={selectedSubmission.grade || ''} 
                                    onChange={(e) => setSelectedSubmission({...selectedSubmission, grade: parseInt(e.target.value)})}
                                    className="w-full h-16 px-6 bg-zinc-50 border-2 border-zinc-100 rounded-2xl font-black text-2xl text-zinc-900 focus:border-indigo-500 outline-none transition-all" 
                                 />
                              </div>
                              <div className="space-y-3">
                                 <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Feedback for Student</label>
                                 <textarea 
                                    value={selectedSubmission.feedback || ''} 
                                    onChange={(e) => setSelectedSubmission({...selectedSubmission, feedback: e.target.value})}
                                    rows={5}
                                    className="w-full p-6 bg-zinc-50 border-2 border-zinc-100 rounded-[2rem] font-medium text-sm text-zinc-900 focus:border-indigo-500 outline-none transition-all resize-none leading-relaxed" 
                                 />
                              </div>
                              <button 
                                onClick={() => finalizeGrade(selectedSubmission, selectedSubmission.grade || 0, selectedSubmission.feedback || '')}
                                className="w-full h-16 bg-zinc-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-[1.02] transition-all"
                              >
                                Finalize & Release Grade
                              </button>
                           </div>
                        </div>
                     </div>
                  </div>
               </div>
             ) : (
               <div className="h-full flex flex-col items-center justify-center text-center opacity-20">
                  <div className="text-8xl mb-8">🔭</div>
                  <h2 className="text-2xl font-black uppercase tracking-widest">Select a submission to begin</h2>
                  <p className="mt-4 font-bold">The AI Persona is ready to assist with evaluations.</p>
               </div>
             )}
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
        @keyframes fade-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-up { animation: fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
};

export default GradingHub;
