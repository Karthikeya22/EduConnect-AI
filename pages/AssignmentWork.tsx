import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { GoogleGenAI } from "@google/genai";
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';
import ThemeToggle from '../components/ThemeToggle';

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

  // States for Lab/Discussion (Raw string submission)
  const [submission, setSubmission] = useState('');

  // States for Quiz
  const [isQuiz, setIsQuiz] = useState(false);
  const [quizData, setQuizData] = useState<any>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<'not_started' | 'submitted'>('not_started');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiThinking, setAiThinking] = useState(false);

  // Use refs to access current state in event listeners
  const statusRef = useRef(status);
  const timeLeftRef = useRef(timeLeft);
  const quizAnswersRef = useRef(quizAnswers);
  const isQuizRef = useRef(isQuiz);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { timeLeftRef.current = timeLeft; }, [timeLeft]);
  useEffect(() => { quizAnswersRef.current = quizAnswers; }, [quizAnswers]);
  useEffect(() => { isQuizRef.current = isQuiz; }, [isQuiz]);

  useEffect(() => {
    const fetchAssignment = async () => {
      setLoading(true);
      try {
        const { data } = await supabase.from('assignments').select('*').eq('id', props.assignmentId).single();
        if (data) {
          setAssignment(data);
          let parsedQuiz = null;
          let quizMode = false;

          if (data.assignment_type === 'quiz') {
            try {
              parsedQuiz = JSON.parse(data.content);
              setQuizData(parsedQuiz);
              setIsQuiz(true);
              quizMode = true;
            } catch (e) {
              console.error("Failed to parse quiz json");
            }
          }

          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            const { data: logs } = await supabase.from('student_assignment_logs')
              .select('*')
              .eq('assignment_id', props.assignmentId)
              .eq('student_id', session.user.id)
              .eq('interaction_type', 'submission')
              .single();

            if (logs) {
              setStatus('submitted');
              if (quizMode) {
                try {
                  const savedAnswers = JSON.parse(logs.submission_content);
                  setQuizAnswers(savedAnswers);
                } catch {
                  setSubmission(logs.submission_content || '');
                }
              } else {
                setSubmission(logs.submission_content || '');
              }
            } else if (quizMode && parsedQuiz && parsedQuiz.timeLimitMinutes) {
              // Not submitted yet, start timer
              setTimeLeft(parsedQuiz.timeLimitMinutes * 60);
              timeLeftRef.current = parsedQuiz.timeLimitMinutes * 60;
            }

            setAiMessages([{ role: 'assistant', content: `Hello! I'm your AI tutor for the "${data.assignment_name}" assignment. How can I help you architect your solution?` }]);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchAssignment();
  }, [props.assignmentId]);

  // Timer Effect
  useEffect(() => {
    if (status !== 'not_started' || timeLeft === null) return;

    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev && prev <= 1) {
          clearInterval(interval);
          // Auto submit
          console.log("Time up! Auto-submitting...");
          handlePerformSubmit(true);
          return 0;
        }
        return prev ? prev - 1 : 0;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [status, timeLeft]);

  // Anti-cheat / Tab out effect
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.hidden && statusRef.current === 'not_started') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        // Log a warning in the database
        await supabase.from('student_assignment_logs').insert({
          student_id: session.user.id,
          assignment_id: props.assignmentId,
          course_id: 'BIG_DATA_2026',
          interaction_type: 'warning',
          submission_content: 'User navigated away from the tab during an active assignment session.',
          timestamp: new Date().toISOString(),
          metadata: { warning_type: 'tab_switch' }
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [props.assignmentId]);

  const handlePerformSubmit = async (isAutoSubmit = false) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      let finalContent = '';
      let calculatedGrade: number | null = null;
      let gradedMetadata: any = {};

      if (isQuizRef.current && quizData) {
        finalContent = JSON.stringify(quizAnswersRef.current);

        // Auto-grade logic for quizzes
        let correctCount = 0;
        const totalQs = Array.isArray(quizData.questions) ? quizData.questions.length : 0;

        if (totalQs > 0) {
          quizData.questions.forEach((q: any, idx: number) => {
            const studentAns = (quizAnswersRef.current[idx] || '').toString().trim().toLowerCase();
            const correctAns = (q.answer || '').toString().trim().toLowerCase();
            if (studentAns === correctAns) {
              correctCount++;
            }
          });

          calculatedGrade = Math.round((correctCount / totalQs) * (assignment?.points_possible || 100));
          gradedMetadata = { auto_graded: true, correctCount, totalQs };
        }
      } else {
        if (!submission.trim() && !isAutoSubmit) {
          setIsSubmitting(false);
          return;
        }
        finalContent = submission;
      }

      await supabase.from('student_assignment_logs').insert({
        student_id: session.user.id,
        assignment_id: props.assignmentId,
        course_id: 'BIG_DATA_2026',
        interaction_type: 'submission',
        submission_content: finalContent,
        grade: calculatedGrade, // Immediately inject grade if quiz
        timestamp: new Date().toISOString(),
        metadata: gradedMetadata
      });

      const win = window as any;
      if (win.confetti) win.confetti({ particleCount: 200, spread: 90, origin: { y: 0.6 } });
      setStatus('submitted');
      setTimeLeft(null);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitClick = () => {
    handlePerformSubmit(false);
  };

  const handleAISend = async () => {
    if (!aiInput.trim() || aiThinking) return;
    const msg = aiInput.trim();
    setAiInput('');
    setAiMessages(prev => [...prev, { role: 'user', content: msg }]);
    setAiThinking(true);
    try {
      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
      let contextContent = assignment?.content;
      if (isQuiz && quizData) contextContent = JSON.stringify(quizData.instruction); // Don't feed questions/answers directly to avoid cheating

      const res = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `Help for assignment "${assignment?.assignment_name}". Context: ${contextContent}. Student query: ${msg}. Provide a helpful, Socratic hint without giving the direct answer.`
      });
      setAiMessages(prev => [...prev, { role: 'assistant', content: res.text || "Snag in my knowledge hub. Try again?" }]);
    } catch (err) {
      setAiMessages(prev => [...prev, { role: 'assistant', content: "Database connection lost. Please retry." }]);
    } finally { setAiThinking(false); }
  };

  if (loading) return (
    <div className="h-screen w-full flex items-center justify-center bg-cyan-50">
      <div className="w-12 h-12 border-4 border-cyan-200 border-t-cyan-600 rounded-full animate-spin"></div>
    </div>
  );

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const isPastDue = assignment?.due_date && new Date() > new Date(assignment.due_date);
  const isLocked = status === 'submitted' || isPastDue;

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#020617] overflow-hidden font-['Plus_Jakarta_Sans'] transition-colors">
      <AppSidebar role="student" currentPath={props.currentPath} onNavigateTo={props.onNavigateTo} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} onLogout={props.onLogout} />
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        <div className="flex-[6] flex flex-col h-full overflow-y-auto p-10 md:p-14 relative">

          <header className="mb-8 flex justify-between items-center bg-white dark:bg-white/5 p-4 rounded-3xl shadow-sm border border-zinc-100 dark:border-white/10 sticky top-0 z-50">
            <button onClick={props.onBack} className="px-4 py-2 text-zinc-400 dark:text-zinc-500 font-bold hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors uppercase tracking-widest text-xs">← Hub</button>
            <div className="flex items-center space-x-6">
              {timeLeft !== null && (
                <div className={`px-4 py-2 rounded-xl font-['Space_Grotesk'] font-black text-lg ${timeLeft < 60 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-cyan-50 text-cyan-700'}`}>
                  ⏳ {formatTime(timeLeft)}
                </div>
              )}
              <ThemeToggle />
              <div className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 ${status === 'submitted' ? 'border-green-200 bg-green-50 text-green-700' : isPastDue ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-yellow-200 bg-yellow-50 text-yellow-700'}`}>
                {status === 'submitted' ? 'Sync Complete / Graded' : isPastDue ? 'Locked / Past Due' : 'Active Session'}
              </div>
            </div>
          </header>

          <h1 className="text-4xl font-black text-zinc-900 tracking-tighter mb-4 pr-12">{assignment?.assignment_name}</h1>
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-8">Points Available: <span className="text-cyan-600">{assignment?.points_possible}</span></p>

          <div className="bg-white p-10 rounded-[3rem] border border-zinc-100 shadow-xl mb-12 relative overflow-hidden">
            <h3 className="text-xs font-black text-cyan-600 uppercase tracking-widest mb-4">Instructions</h3>
            <p className="text-sm text-zinc-700 leading-relaxed font-medium whitespace-pre-wrap">
              {isQuiz ? quizData?.instruction : assignment?.content}
            </p>
          </div>

          {/* Render Quiz vs Text Area */}
          {isQuiz && quizData?.questions ? (
            <div className="space-y-8 mb-12">
              {quizData.questions.map((q: any, idx: number) => (
                <div key={idx} className="bg-white border-2 border-zinc-100 rounded-[2.5rem] p-8 shadow-sm focus-within:border-cyan-500 focus-within:ring-4 focus-within:ring-cyan-500/10 transition-all">
                  <div className="flex space-x-4 mb-4">
                    <span className="w-8 h-8 rounded-xl bg-cyan-100 text-cyan-700 flex items-center justify-center font-black text-xs shrink-0">{idx + 1}</span>
                    <p className="text-sm font-bold text-zinc-800 pt-1 leading-relaxed">{q.question}</p>
                  </div>
                  <div className="pl-12">
                    <input
                      type="text"
                      className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-2xl h-14 px-6 font-bold text-sm text-zinc-800 uppercase focus:outline-none focus:border-cyan-500 focus:bg-white transition-colors"
                      placeholder="Enter your answer..."
                      value={quizAnswers[idx] || ''}
                      onChange={(e) => setQuizAnswers(prev => ({ ...prev, [idx]: e.target.value }))}
                      disabled={isLocked}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <textarea
              value={submission}
              onChange={(e) => setSubmission(e.target.value)}
              disabled={isLocked}
              placeholder={isLocked ? "Submission is locked." : "Write your response here..."}
              className="w-full flex-1 min-h-[300px] p-10 bg-white border-2 border-zinc-100 rounded-[3rem] focus:border-cyan-500 focus:outline-none transition-all font-medium text-sm shadow-xl mb-8 resize-vertical text-zinc-800 disabled:bg-zinc-50 disabled:text-zinc-500"
            />
          )}

          <div className="flex justify-end sticky bottom-8 items-center space-x-4 mix-blend-normal">
            {isLocked && <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{status === 'submitted' ? 'Already Submitted' : 'Past Due Date'}</span>}
            <button
              onClick={handleSubmitClick}
              disabled={isLocked || isSubmitting || (!isQuiz && !submission.trim())}
              className="px-12 h-16 bg-zinc-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-2xl disabled:opacity-50 transition-transform hover:-translate-y-1 active:scale-95 flex items-center space-x-3"
            >
              {isSubmitting ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <>
                  <span>{isLocked ? 'Locked' : 'Commit Payload'}</span>
                  <span>→</span>
                </>
              )}
            </button>
          </div>
        </div>

        <aside className="flex-[4] bg-white border-l border-zinc-100 flex flex-col shadow-[-20px_0_40px_rgba(0,0,0,0.01)] h-full">
          <header className="h-24 border-b border-zinc-100 flex items-center px-10 shrink-0 bg-zinc-50/50">
            <span className="text-2xl mr-4 p-3 bg-white rounded-2xl shadow-sm border border-zinc-100">🤖</span>
            <div>
              <h3 className="font-black text-sm font-['Space_Grotesk'] uppercase tracking-tight text-zinc-900">Virtual TA</h3>
              <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Socratic AI Assistant</p>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-10 space-y-8 scrollbar-hide bg-zinc-50/30">
            {aiMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-up`}>
                <div className={`max-w-[85%] p-6 rounded-3xl text-sm font-medium leading-relaxed shadow-sm ${m.role === 'user' ? 'bg-cyan-600 text-white rounded-br-sm' : 'bg-white border text-zinc-800 rounded-bl-sm'}`}>{m.content}</div>
              </div>
            ))}
            {aiThinking && (
              <div className="flex justify-start animate-fade-up">
                <div className="px-6 py-4 bg-white border border-zinc-100 rounded-3xl rounded-bl-sm flex space-x-2 shadow-sm">
                  <div className="w-2 h-2 bg-zinc-300 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-zinc-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-zinc-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            )}
          </div>
          <div className="p-8 border-t border-zinc-100 bg-white">
            <div className="flex items-center space-x-3 bg-zinc-50 p-2 rounded-2xl border border-zinc-100 focus-within:border-cyan-500 transition-colors">
              <input
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAISend()}
                placeholder="Ask your TA for a hint..."
                className="flex-1 h-12 px-4 bg-transparent text-xs font-bold outline-none text-zinc-800"
              />
              <button onClick={handleAISend} className="w-12 h-12 bg-zinc-900 hover:bg-cyan-600 text-white rounded-xl shadow-lg transition-colors flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
              </button>
            </div>
          </div>
        </aside>
      </div>
      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        @keyframes fade-up { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-up { animation: fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
};

export default AssignmentWork;
