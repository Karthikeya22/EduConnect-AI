import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import { GoogleGenAI } from "@google/genai";
import { logActivity } from '../lib/logger';
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';
import * as Icons from '../components/Icons';
import ThemeToggle from '../components/ThemeToggle';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLocation } from 'react-router-dom';

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
  submission_content: string;
  content?: string; // for backward compatibility in code
  timestamp: string;
  student_name?: string;
  assignment_name?: string;
  grade?: number;
  feedback?: string;
  ai_suggested_grade?: number;
  ai_suggested_feedback?: string;
  assignment_rubric?: any;
  assignment_type?: 'assignment' | 'quiz' | 'discussion';
  isRead?: boolean;
  metadata?: any;
}

interface StudentRiskProfile {
  id: string;
  name: string;
  email: string;
  riskScore: number;
  attendance: number;
  predictedGrade: string;
  trend: 'up' | 'down' | 'stable';
  riskFactors: string[];
  sentiment: number;
}

const GradingHub: React.FC<GradingHubProps> = ({ onBack, onNavigateTo, onLogout, currentPath = 'teacher-grading' }) => {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [riskProfiles, setRiskProfiles] = useState<Map<string, StudentRiskProfile>>(new Map());
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'lab' | 'quiz' | 'discussion'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'graded' | 'pending' | 'struggling'>(
    (location.state?.filter as any) || 'all'
  );
  const [allAssignments, setAllAssignments] = useState<any[]>([]);
  const [expandedAssignments, setExpandedAssignments] = useState<Set<string>>(new Set());

  const [gradingLoading, setGradingLoading] = useState<string | null>(null);
  const [interventionLoading, setInterventionLoading] = useState(false);
  const [aiInterventionDraft, setAiInterventionDraft] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [persona, setPersona] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [showPublishModal, setShowPublishModal] = useState(false);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<Set<string>>(new Set());
  const [publishLoading, setPublishLoading] = useState(false);

  const mainRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetchData();
    fetchPersona();
  }, []);

  useEffect(() => {
    // Auto-select first visible submission
    const visibleSubs = submissions
      .filter(s => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'graded') return s.grade !== null && s.grade !== undefined;
        if (statusFilter === 'pending') return s.grade === null || s.grade === undefined;
        if (statusFilter === 'struggling') return (riskProfiles.get(s.student_id)?.riskScore || 0) > 60;
        return true;
      })
      .filter(s => typeFilter === 'all' ? true : s.assignment_type?.toLowerCase() === typeFilter.toLowerCase())
      .filter(s => s.student_name?.toLowerCase().includes(searchQuery.toLowerCase()) || s.assignment_name?.toLowerCase().includes(searchQuery.toLowerCase()));

    if (visibleSubs.length > 0 && (!selectedSubmission || !visibleSubs.find(v => v.id === selectedSubmission.id))) {
      setSelectedSubmission(visibleSubs[0]);
    } else if (visibleSubs.length === 0) {
      setSelectedSubmission(null);
    }
  }, [submissions, statusFilter, typeFilter, searchQuery]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [{ data: subsRes }, { data: studentsRaw }, { data: assignmentsRaw }] = await Promise.all([
        supabase.from('student_assignment_logs')
          .select(`*`)
          .in('interaction_type', ['submission', 'discussion_post'])
          .order('timestamp', { ascending: false }),
        supabase.from('students').select('id, student_email, student_name'),
        supabase.from('assignments').select('id, assignment_name, assignment_type, rubric, content, points_possible')
      ]);

      if (!subsRes) throw new Error("No submissions found");

      // Extract Assignments Map
      const assignmentsMap = new Map();
      (assignmentsRaw || []).forEach((a: any) => {
        assignmentsMap.set(a.id, a);
      });
      setAllAssignments(assignmentsRaw || []);

      // Auto-expand the first assignment
      if (assignmentsRaw && assignmentsRaw.length > 0) {
        setExpandedAssignments(new Set([assignmentsRaw[0].id]));
      }

      // Extract Risk Profiles
      const studentMap = new Map();
      const profilesMap = new Map<string, StudentRiskProfile>();

      (studentsRaw || []).forEach((s: any) => {
        studentMap.set(s.id, { name: s.student_name, email: s.student_email });
      });

      let formattedSubmissions: Submission[] = (subsRes || []).map(log => {
        const matchingAssignment = assignmentsMap.get(log.assignment_id);
        return {
          id: log.id,
          student_id: log.student_id,
          assignment_id: log.assignment_id,
          submission_content: log.submission_content || '',
          content: log.submission_content || '',
          timestamp: log.timestamp,
          assignment_name: matchingAssignment?.assignment_name || 'Discussion Post',
          assignment_type: matchingAssignment?.assignment_type || 'discussion',
          assignment_instructions: matchingAssignment?.content || '',
          student_name: studentMap.get(log.student_id)?.name || 'Unknown Student',
          grade: log.grade,
          feedback: log.feedback,
          ai_suggested_grade: undefined,
          ai_suggested_feedback: undefined,
          assignment_rubric: matchingAssignment?.rubric,
          isRead: !!log.metadata?.read_by_faculty,
          metadata: log.metadata
        };
      });

      // Sort pending items to top, then timestamp descending
      formattedSubmissions.sort((a, b) => {
        const aPending = (a.grade === null || a.grade === undefined) ? 1 : 0;
        const bPending = (b.grade === null || b.grade === undefined) ? 1 : 0;
        if (aPending !== bPending) return bPending - aPending;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

      setSubmissions(formattedSubmissions);
    } catch (err) {
      console.error("Error fetching nexus data:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleReadStatus = async (sub: Submission) => {
    try {
      const newStatus = !sub.isRead;
      const newMetadata = { ...(sub.metadata || {}), read_by_faculty: newStatus };

      const { error } = await supabase
        .from('student_assignment_logs')
        .update({ metadata: newMetadata })
        .eq('id', sub.id);

      if (error) throw error;

      setSubmissions(prev => prev.map(s => s.id === sub.id ? { ...s, isRead: newStatus, metadata: newMetadata } : s));
      if (selectedSubmission?.id === sub.id) {
        setSelectedSubmission(prev => prev ? { ...prev, isRead: newStatus, metadata: newMetadata } : null);
      }
    } catch (err) {
      console.error("Read Status Sync failure:", err);
    }
  };

  const fetchPersona = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase.from('teacher_preferences').select('persona_settings').eq('teacher_email', session.user.email).eq('course_id', 'BIG_DATA_2026').single();
      if (data?.persona_settings) setPersona(data.persona_settings);
    } catch (err) { }
  };

  const getGenAIClient = () => {
    const apiKey = (import.meta as any).env.VITE_GEMINI_API_KEY || (process as any).env?.GEMINI_API_KEY || (process as any).env?.API_KEY || '';
    if (!apiKey) throw new Error("API Key missing");
    return new GoogleGenAI({ apiKey } as any);
  };

  const runAIGrade = async (submission: any) => {
    setGradingLoading(submission.id);
    try {
      const ai = getGenAIClient();
      const personaContext = persona
        ? `Act as a teacher with this persona: 
           - Tone Score: ${persona.tone}/100 
           - Strictness: ${persona.strictness}/100 
           - Philosophy: ${persona.philosophy}
           - Greeting Style: ${persona.greeting}`
        : "Act as a professional and fair teacher.";

      const prompt = `
        ${personaContext}
        
        ### ASSIGNMENT CONTEXT:
        Title: ${submission.assignment_name}
        Instructions for Student: ${submission.assignment_instructions || 'N/A'}
        Rubric/Criteria: ${JSON.stringify(submission.assignment_rubric || {})}

        ### STUDENT SUBMISSION:
        ${submission.content}

        ### GRADING PROTOCOL:
        1. Evaluate based strictly on the provided Instructions and Rubric.
        2. Use the Teacher Persona for the tone of the feedback.
        3. BREVITY IS PARAMOUNT. Under 150 words.
        4. Format as Markdown:
           - ### 📋 Summary: (2 sentences)
           - ### ✅ Strengths: (3 bullets)
           - ### ❌ Issues: (3 bullets)
           - ### 🚀 Next Step: (1 instruction)
        
        Return valid JSON in this exact structure: {"grade": number, "feedback": "markdown_string"}
      `;

      const response = await (ai as any).models.generateContent({
        model: "gemini-3-flash-preview",
        systemInstruction: "You are a specialized grading intelligence node.",
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(response.text || "{}");
      const updatedSubmissions = submissions.map(s => s.id === submission.id ? { ...s, ai_suggested_grade: result.grade, ai_suggested_feedback: result.feedback } : s);
      setSubmissions(updatedSubmissions);

      if (selectedSubmission?.id === submission.id) {
        setSelectedSubmission({
          ...selectedSubmission,
          ai_suggested_grade: result.grade,
          ai_suggested_feedback: result.feedback,
          grade: result.grade, // Automatically populate for professor review
          feedback: result.feedback
        });
      }
    } catch (err) { } finally { setGradingLoading(null); }
  };

  const finalizeGrade = async (submission: Submission, finalGrade: number, finalFeedback: string) => {
    try {
      await supabase.from('student_assignment_logs').update({
        grade: finalGrade,
        feedback: finalFeedback,
        timestamp: new Date().toISOString() // update timestamp as last activity
      }).eq('id', submission.id);
      setSubmissions(submissions.map(s => s.id === submission.id ? { ...s, grade: finalGrade, feedback: finalFeedback } : s));
      if (selectedSubmission?.id === submission.id) setSelectedSubmission({ ...selectedSubmission, grade: finalGrade, feedback: finalFeedback });
      setToast({ message: "Grade Finalized", type: 'success' });
      await logActivity('GRADE_ASSIGNMENT', `Graded ${submission.assignment_name}`);
    } catch (err: any) { setToast({ message: err.message, type: 'error' }); } finally { setTimeout(() => setToast(null), 3000); }
  };

  const generateIntervention = async (profile: StudentRiskProfile) => {
    setInterventionLoading(true);
    setAiInterventionDraft(null);
    try {
      const ai = getGenAIClient();
      const prompt = `Act as an academic advisor. Write a short intervention email for ${profile.name}. Risk Score: ${profile.riskScore}/100. Trend is ${profile.trend}. Predicted grade: ${profile.predictedGrade}. Keep it short, empathetic, and actionable. Offer office hours.`;
      const response = await (ai as any).models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
      setAiInterventionDraft(response.text || "Failed to generate draft.");
    } catch (err) { setToast({ message: "Failed to generate", type: 'error' }); } finally { setInterventionLoading(false); }
  };

  const toggleRecipient = (id: string) => {
    const next = new Set(selectedRecipientIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedRecipientIds(next);
  };

  const publishToSelected = async () => {
    setPublishLoading(true);
    try {
      const selectedSubmissions = submissions.filter(s => selectedRecipientIds.has(s.id));
      await Promise.all(selectedSubmissions.map(s =>
        supabase.from('student_assignment_logs').update({
          grade: s.grade,
          feedback: s.feedback,
          timestamp: new Date().toISOString()
        }).eq('id', s.id)
      ));

      setToast({ message: `Successfully published to ${selectedRecipientIds.size} students`, type: 'success' });
      setShowPublishModal(false);
      setSelectedRecipientIds(new Set());
      await logActivity('BULK_GRADE_PUBLISH', `Published grades to ${selectedRecipientIds.size} students`);
    } catch (err) {
      setToast({ message: "Publication failed", type: 'error' });
    } finally {
      setPublishLoading(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#020617] overflow-hidden font-['Plus_Jakarta_Sans'] transition-colors duration-500">
      <AppSidebar role="teacher" currentPath={currentPath} onNavigateTo={onNavigateTo} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} onLogout={onLogout} />

      <main ref={mainRef} className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="h-20 bg-white/40 dark:bg-[#0B1120]/80 backdrop-blur-2xl border-b border-zinc-200 dark:border-white/5 flex items-center justify-between px-8 shrink-0 z-20 shadow-sm transition-colors duration-500">
          <div className="flex items-center space-x-4">
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter uppercase font-['Space_Grotesk']">Evaluation Nexus</h1>
            <div className="h-6 w-px bg-zinc-200 dark:bg-white/10"></div>
            <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Unified Grading & Analytics</span>
          </div>
          <div className="flex items-center space-x-6">
            <ThemeToggle />
            <button
              onClick={() => {
                const pendingIds = new Set(submissions.filter(s => s.grade !== undefined && !s.id.includes('published')).map(s => s.id));
                setSelectedRecipientIds(pendingIds);
                setShowPublishModal(true);
              }}
              className="px-6 h-11 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-indigo-600/20"
            >
              Publish Results
            </button>
            <button onClick={onBack} className="px-6 h-11 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all">Dashboard</button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* Submissions List Column */}
          <div className="w-full lg:w-[400px] border-r border-zinc-200 dark:border-white/5 bg-white dark:bg-[#0B1120] transition-colors duration-500 flex flex-col shrink-0">
            <div className="p-6 border-b border-zinc-100 dark:border-white/5 bg-zinc-50/50 dark:bg-[#0B1120] space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xs font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Submission Queue</h2>
                <div className="flex bg-white dark:bg-white/5 p-1 rounded-lg border border-zinc-100 dark:border-white/10">
                  {(['all', 'pending', 'graded'] as const).map(s => (
                    <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1 rounded-md text-[8px] font-black uppercase tracking-widest transition-all ${statusFilter === s ? 'bg-indigo-600 text-white' : 'text-zinc-400'}`}>{s}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1 p-1 bg-zinc-100 dark:bg-white/5 rounded-xl">
                {(['all', 'lab', 'quiz', 'discussion'] as const).map(t => (
                  <button key={t} onClick={() => setTypeFilter(t)} className={`py-2 rounded-lg text-[7px] font-black uppercase tracking-widest text-center transition-all ${typeFilter === t ? 'bg-white dark:bg-white/10 text-indigo-600 dark:text-white shadow-sm' : 'text-zinc-400'}`}>{t}</button>
                ))}
              </div>
              <div className="relative">
                <Icons.IconCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search queue..."
                  className="w-full h-10 pl-10 pr-4 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 dark:text-white rounded-xl text-[10px] font-bold focus:border-indigo-500 outline-none transition-all shadow-sm"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-hide">
              {loading ? (
                <div className="p-10 text-center"><div className="w-8 h-8 border-4 border-zinc-100 dark:border-white/10 border-t-indigo-600 rounded-full animate-spin mx-auto"></div></div>
              ) : allAssignments
                .filter(a => typeFilter === 'all' ? true : a.assignment_type?.toLowerCase() === typeFilter.toLowerCase())
                .filter(a => a.assignment_name?.toLowerCase().includes(searchQuery.toLowerCase()))
                .map(assignment => {
                  const assignmentSubs = submissions.filter(s => s.assignment_id === assignment.id)
                    .filter(s => {
                      if (statusFilter === 'all') return true;
                      if (statusFilter === 'graded') return s.grade !== null && s.grade !== undefined;
                      if (statusFilter === 'pending') return s.grade === null || s.grade === undefined;
                      return true;
                    })
                    .filter(s => s.student_name?.toLowerCase().includes(searchQuery.toLowerCase()) || assignment.assignment_name?.toLowerCase().includes(searchQuery.toLowerCase()));

                  const isExpanded = expandedAssignments.has(assignment.id);

                  return (
                    <div key={assignment.id} className="border-b border-zinc-200 dark:border-white/5 flex flex-col">
                      <button
                        onClick={() => {
                          setExpandedAssignments(prev => {
                            const next = new Set(prev);
                            if (next.has(assignment.id)) next.delete(assignment.id); else next.add(assignment.id);
                            return next;
                          });
                        }}
                        className="w-full p-5 flex justify-between items-center hover:bg-zinc-50 dark:hover:bg-white/5 transition-all text-left group"
                      >
                        <div className="flex flex-col">
                          <span className="text-[11px] font-black text-zinc-900 dark:text-white uppercase tracking-widest leading-snug">{assignment.assignment_name}</span>
                          <div className="flex items-center space-x-2 mt-1.5">
                            <span className="text-[8px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">{assignment.assignment_type}</span>
                            <span className="text-[8px] font-bold text-zinc-300 dark:text-zinc-600">•</span>
                            <span className="text-[8px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest bg-indigo-50 dark:bg-indigo-500/10 px-1.5 py-0.5 rounded-sm">{assignmentSubs.length} Submissions</span>
                          </div>
                        </div>
                        <span className={`text-zinc-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}><Icons.IconChevronDown className="w-4 h-4" /></span>
                      </button>

                      {isExpanded && (
                        <div className="bg-zinc-50/50 dark:bg-black/20 flex flex-col border-t border-zinc-100 dark:border-white/5">
                          {assignmentSubs.length === 0 ? (
                            <div className="p-6 text-[10px] text-zinc-400 dark:text-zinc-600 text-center font-bold uppercase tracking-widest italic flex items-center justify-center space-x-2">
                              <span>No matching submissions</span>
                            </div>
                          ) : assignmentSubs.map(sub => (
                            <button key={sub.id} onClick={() => { setSelectedSubmission(sub); setAiInterventionDraft(null); }} className={`w-full p-4 pl-6 text-left transition-all border-b border-zinc-100 dark:border-white/5 hover:bg-white dark:hover:bg-white/5 flex flex-col space-y-3 ${selectedSubmission?.id === sub.id ? 'bg-white dark:bg-[#0F172A] border-l-4 border-l-indigo-600 shadow-sm' : 'border-l-4 border-l-transparent'}`}>
                              <div className="flex justify-between items-center w-full">
                                <h4 className="text-[11px] font-black text-zinc-800 dark:text-zinc-200 tracking-tight">{sub.student_name}</h4>
                                <span className="text-[8px] font-bold text-zinc-400 dark:text-zinc-500">{new Date(sub.timestamp).toLocaleDateString()}</span>
                              </div>
                              <div className="flex items-center space-x-3">
                                {sub.grade !== undefined
                                  ? <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded text-[9px] font-black uppercase">Graded: {sub.grade}</span>
                                  : sub.ai_suggested_grade !== undefined
                                    ? <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded text-[9px] font-black uppercase">AI Draft Ready</span>
                                    : <div className="flex space-x-2 items-center"><span className="px-2 py-0.5 bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-zinc-400 rounded text-[9px] font-black uppercase tracking-widest">Pending</span>{!sub.isRead && sub.assignment_type === 'discussion' && <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-pulse shadow-[0_0_8px_rgba(79,70,229,0.5)]"></span>}</div>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Unified Detail Area */}
          <div className="flex-1 bg-zinc-50/50 dark:bg-[#020617] overflow-y-auto scrollbar-hide p-8 lg:p-10 transition-colors duration-500">
            {selectedSubmission ? (
              <div className="max-w-6xl mx-auto space-y-6 animate-fade-up">

                {/* Top Header Row */}
                <div className="flex flex-col lg:flex-row gap-6 mb-8">
                  {/* Student Identity & Stats Header */}
                  <div className="flex-1 bg-white dark:bg-[#0B1120] p-8 rounded-[2rem] border border-zinc-200 dark:border-white/5 shadow-xl shadow-zinc-200/40 dark:shadow-none flex justify-between items-center">
                    <div>
                      <h2 className="text-4xl font-black text-zinc-900 dark:text-white tracking-tighter mb-1">{selectedSubmission.student_name}</h2>
                      <p className="text-zinc-500 dark:text-zinc-400 font-bold uppercase text-xs tracking-widest">{selectedSubmission.assignment_name}</p>
                    </div>
                  </div>
                </div>

                {/* Top-Bottom Layout */}
                <div className="space-y-6">

                  {/* Top Block: Submission Content */}
                  <div className="bg-white dark:bg-[#0B1120] rounded-[2rem] p-8 border border-zinc-200 dark:border-white/5 shadow-sm flex flex-col max-h-[600px]">
                    <h3 className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-4">Original Submission</h3>
                    <div className="flex-1 overflow-y-auto scrollbar-hide pr-4 prose prose-sm dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300 font-medium leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {selectedSubmission.content || ''}
                      </ReactMarkdown>
                    </div>
                  </div>

                  {/* Bottom Block: Grading Action */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[400px]">
                    <div className="bg-[#0F172A] dark:bg-white/5 rounded-[2rem] p-8 text-white shadow-2xl dark:shadow-none dark:border dark:border-white/10 relative overflow-hidden flex-shrink-0">
                      <div className="absolute top-0 right-0 p-8 opacity-5 dark:opacity-10 pointer-events-none"><Icons.IconBot className="w-32 h-32" /></div>
                      <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-6 relative z-10">AI Evaluation Engine</h3>
                      <button onClick={() => runAIGrade(selectedSubmission)} disabled={gradingLoading === selectedSubmission.id} className="w-full h-14 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all mb-6 flex justify-center items-center relative z-10 shadow-[0_0_20px_rgba(79,70,229,0.3)]">
                        {gradingLoading === selectedSubmission.id ? 'Synchronizing Nexus...' : 'Initialize AI Nexus'}
                      </button>

                      {selectedSubmission.ai_suggested_grade !== undefined && (
                        <div className="p-6 bg-white/5 dark:bg-black/20 rounded-xl border border-indigo-500/30 relative z-10 animate-fade-up">
                          <div className="flex items-center justify-between mb-4">
                            <div className="text-4xl font-black text-indigo-300 dark:text-indigo-400">{selectedSubmission.ai_suggested_grade}/100</div>
                            <span className="px-3 py-1 bg-indigo-500/20 text-indigo-300 rounded-full text-[8px] font-black uppercase tracking-widest border border-indigo-500/30">AI Draft</span>
                          </div>
                          <div className="prose prose-invert prose-xs max-w-none text-zinc-300 leading-relaxed border-l-2 border-indigo-500/50 pl-4 max-h-[200px] overflow-y-auto scrollbar-hide">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {selectedSubmission.ai_suggested_feedback || ''}
                            </ReactMarkdown>
                          </div>
                          <p className="text-[7px] text-zinc-500 uppercase font-black tracking-widest mt-4">Draft synchronized to editor below ↓</p>
                        </div>
                      )}
                    </div>

                    <div className="bg-white dark:bg-[#0B1120] rounded-[2rem] p-8 border border-zinc-200 dark:border-white/5 shadow-sm flex-1 flex flex-col min-h-0">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Professor Review & Feedback</h3>
                        <div className="flex items-center space-x-3">
                          {selectedSubmission.assignment_type === 'discussion' && (
                            <button
                              onClick={() => toggleReadStatus(selectedSubmission)}
                              className={`px-4 py-1.5 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all ${selectedSubmission.isRead ? 'bg-zinc-100 text-zinc-400 dark:bg-white/5 border border-zinc-200 dark:border-white/10' : 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'}`}
                            >
                              {selectedSubmission.isRead ? 'Already Read' : 'Mark as Read'}
                            </button>
                          )}
                          {selectedSubmission.ai_suggested_grade !== undefined && <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest flex items-center"><span className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse mr-1"></span> AI Sync Active</span>}
                        </div>
                      </div>
                      <input type="number" placeholder="Override Score" value={selectedSubmission.grade || ''} onChange={e => setSelectedSubmission({ ...selectedSubmission, grade: parseInt(e.target.value) })} className="w-full h-14 px-4 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl mb-4 font-black dark:text-white focus:border-indigo-500 outline-none transition-all" />
                      <textarea placeholder="Final Feedback... (Markdown Supported)" value={selectedSubmission.feedback || ''} onChange={e => setSelectedSubmission({ ...selectedSubmission, feedback: e.target.value })} className="w-full p-4 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl mb-6 text-sm resize-none dark:text-white focus:border-indigo-500 outline-none transition-all flex-1 min-h-[150px]"></textarea>
                      <button onClick={() => finalizeGrade(selectedSubmission, selectedSubmission.grade || 0, selectedSubmission.feedback || '')} className="w-full h-14 bg-zinc-900 dark:bg-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all mt-auto">Submit Evaluation</button>
                    </div>
                  </div>

                </div>

              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center opacity-30">
                <div className="text-8xl mb-8 dark:invert opacity-80">⚡</div>
                <h2 className="text-3xl font-black uppercase tracking-widest dark:text-white">Nexus Ready</h2>
                <p className="mt-4 font-bold text-zinc-600 dark:text-zinc-400">Select a submission to view unified analytics & grading.</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {showPublishModal && (
        <div className="fixed inset-0 z-[6000] flex items-center justify-center p-6 sm:p-12">
          <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-md" onClick={() => setShowPublishModal(false)}></div>
          <div className="relative w-full max-w-xl bg-white dark:bg-[#0B1120] rounded-[3rem] shadow-2xl border border-zinc-100 dark:border-white/5 overflow-hidden flex flex-col max-h-[80vh] animate-fade-up">
            <div className="p-10 border-b border-zinc-50 dark:border-white/5">
              <h3 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter mb-2 uppercase font-['Space_Grotesk']">Publication Registry</h3>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Select recipients for the drafted evaluations</p>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-3">
              {submissions.filter(s => s.grade !== undefined).map(sub => (
                <button
                  key={sub.id}
                  onClick={() => toggleRecipient(sub.id)}
                  className={`w-full p-5 rounded-2xl border-2 flex items-center justify-between transition-all ${selectedRecipientIds.has(sub.id) ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-500/10' : 'border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/5 opacity-60'}`}
                >
                  <div className="text-left">
                    <div className="text-xs font-black text-zinc-900 dark:text-white">{sub.student_name}</div>
                    <div className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">{sub.assignment_name}</div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <span className="text-[10px] font-black text-indigo-600">{sub.grade}%</span>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${selectedRecipientIds.has(sub.id) ? 'bg-indigo-600 border-indigo-600' : 'border-zinc-300'}`}>
                      {selectedRecipientIds.has(sub.id) && <span className="text-white text-[10px]">✓</span>}
                    </div>
                  </div>
                </button>
              ))}
              {submissions.filter(s => s.grade !== undefined).length === 0 && (
                <div className="py-20 text-center opacity-30 italic font-bold text-zinc-500 uppercase tracking-widest text-xs">No grades ready for publication</div>
              )}
            </div>

            <div className="p-8 bg-zinc-50 dark:bg-black/20 border-t border-zinc-100 dark:border-white/5 flex space-x-4">
              <button
                onClick={() => setShowPublishModal(false)}
                className="flex-1 h-16 rounded-2xl font-black text-[10px] uppercase tracking-widest text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5 transition-all"
              >
                Cancel
              </button>
              <button
                disabled={selectedRecipientIds.size === 0 || publishLoading}
                onClick={publishToSelected}
                className="flex-[2] h-16 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-indigo-600/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
              >
                {publishLoading ? 'Transmitting...' : `Transmit to ${selectedRecipientIds.size} Students →`}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`fixed bottom-12 left-1/2 -translate-x-1/2 px-8 py-4 rounded-2xl shadow-2xl font-black text-[11px] uppercase tracking-widest z-[7000] animate-fade-up flex items-center space-x-3 ${toast.type === 'success' ? 'bg-[#18181B] text-white' : 'bg-red-600 text-white'}`}>
        <span>{toast.type === 'success' ? '✓' : '!'}</span>
        <span>{toast.message}</span>
      </div>}
      <style>{`@keyframes fade-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } } .animate-fade-up { animation: fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }`}</style>
    </div>
  );
};

export default GradingHub;
