
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { gsap } from 'gsap';
import { GoogleGenAI } from "@google/genai";
import { supabase } from '../lib/supabase';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface StudentAITutorProps {
  studentName: string;
}

const StudentAITutor: React.FC<StudentAITutorProps> = ({ studentName }) => {
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [platformKnowledge, setPlatformKnowledge] = useState<string>('');

  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const syncPlatformKnowledge = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const [
        { data: assignments },
        { data: materials },
        { data: submissionLogs },
        { data: studentActivity }
      ] = await Promise.all([
        supabase.from('assignments').select('id, assignment_name, due_date, points_possible, assignment_type, topic'),
        supabase.from('instructional_materials').select('title, topic, file_type'),
        supabase.from('student_assignment_logs').select('assignment_id, interaction_type, grade, timestamp').eq('student_id', session.user.id),
        supabase.from('student_learning_activities').select('target_id, interaction_type').eq('student_id', session.user.id)
      ]);

      const submittedIds = new Set(submissionLogs?.filter(l => l.interaction_type === 'submission').map(l => l.assignment_id) || []);
      const viewedMaterialIds = new Set(studentActivity?.map(a => a.target_id) || []);

      const pendingAssignments = assignments?.filter(a => !submittedIds.has(a.id)) || [];
      const completedAssignments = assignments?.filter(a => submittedIds.has(a.id)) || [];

      const knowledgeString = `
# PLATFORM_PROOF_OF_TRUTH (Current Session: ${new Date().toISOString()})
# COURSE: CMPT 732 - Big Data Systems
# STUDENT_NAME: ${studentName}

## ASSIGNMENT_LEDGER
- TOTAL_ASSIGNMENTS_POSTED: ${assignments?.length || 0}
- PENDING_TASKS: ${pendingAssignments.length}
  * ${pendingAssignments.map(p => `${p.assignment_name} (Topic: ${p.topic}) | Deadline: ${p.due_date}`).join('\n  * ')}
- COMPLETED_TASKS: ${completedAssignments.length}
  * ${completedAssignments.map(c => {
        const log = submissionLogs?.find(l => l.assignment_id === c.id);
        return `${c.assignment_name} | Grade: ${log?.grade || 'Grading Pending'} | Submitted: ${log?.timestamp}`;
      }).join('\n  * ')}

## COURSE_MATERIALS_INVENTORY
- TOTAL_RESOURCES: ${materials?.length || 0}
- VIEWED_BY_STUDENT: ${viewedMaterialIds.size}
- INVENTORY_LIST:
  * ${materials?.map(m => `${m.title} (Topic: ${m.topic})`).join('\n  * ')}

## SYSTEM_STATE
- REAL_TIME_SYNC: ENABLED
- ACCESS_LEVEL: FULL_STUDENT_HUB_CONTEXT
`;
      setPlatformKnowledge(knowledgeString);
    } catch (err) {
      console.warn("Nexus Knowledge Sync deferred.");
    }
  }, [studentName]);

  useEffect(() => {
    if (expanded) {
      syncPlatformKnowledge();
      if (messages.length === 0) {
        setMessages([{
          role: 'assistant',
          content: `Hello ${studentName}. I have synchronized with the Faculty Hub. All your assignments, materials, and submission records are currently loaded into my active memory. How can I assist your trajectory today?`
        }]);
      }
    }
  }, [expanded, studentName, syncPlatformKnowledge]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const apiKey = process.env.GEMINI_API_KEY ||
        process.env.API_KEY ||
        (import.meta as any).env.VITE_GEMINI_API_KEY ||
        '';

      if (!apiKey) throw new Error("API Key Missing");

      const client = new GoogleGenAI({ apiKey } as any);

      const response = await (client as any).models.generateContent({
        model: "gemini-3-flash-preview",
        systemInstruction: `You are the ADVANCED AI TUTOR (NEXUS UNIT) for the Big Data Systems course at USF.
        
### CORE DIRECTIVES:
1. **ABSOLUTE ACCURACY**: You have direct access to the PLATFORM_PROOF_OF_TRUTH. Never guess assignment counts, names, or deadlines.
2. **ZERO ASSUMPTIONS**: If a student asks "how many are pending," look ONLY at the PENDING_TASKS list in the provided context.
3. **FORMATTING**: Use RICH MARKDOWN (Tables, Bold, Bullets, code blocks).
4. **ROLE**: You are a Faculty Assistant. Be technical, helpful, and data-driven.
5. **IDENTITY**: You are the NEXUS UNIT. You are synchronized with the university database. You ALREADY HAVE access to the ledger. Never ask the student to upload a syllabus or screenshot.`,
        contents: [
          ...messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          {
            role: 'user',
            parts: [{ text: `[PLATFORM_PROOF_OF_TRUTH]\n${platformKnowledge || 'EMPTY_LEDGER'}\n\nStudent Query: ${userMessage}` }]
          }
        ]
      });

      const assistantContent = response.text || "I'm having trouble connecting to my knowledge base right now.";
      setMessages(prev => [...prev, { role: 'assistant', content: assistantContent }]);

      // Log the interaction
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        try {
          await supabase.from('student_assignment_logs').insert({
            student_id: session.user.id,
            assignment_id: 'AI_TUTOR_GLOBAL_CHAT',
            interaction_type: 'nexus_query',
            content: userMessage,
            timestamp: new Date().toISOString()
          });
        } catch (e) {
          console.debug("Logging deferred.");
        }
      }

    } catch (error) {
      console.error("Nexus Unit Error:", error);
      setMessages(prev => [...prev, { role: 'assistant', content: "SYSTEM_ERROR: Neural links decoupled. Please retry query." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-8 right-8 z-[2000] font-['Plus_Jakarta_Sans']">
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="w-16 h-16 bg-indigo-600 rounded-full shadow-[0_0_30px_rgba(79,70,229,0.4)] flex items-center justify-center text-3xl hover:scale-110 active:scale-95 transition-all animate-pulse-gentle relative group"
        >
          <div className="absolute -top-12 right-0 bg-zinc-900 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl opacity-0 group-hover:opacity-100 transition-all pointer-events-none whitespace-nowrap">
            Launch Nexus Unit
          </div>
          <span className="animate-float">🤖</span>
        </button>
      ) : (
        <div ref={containerRef} className="w-[450px] h-[700px] bg-white dark:bg-[#0B1120] rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] border border-zinc-100 dark:border-white/5 overflow-hidden flex flex-col animate-pop-in">
          <header className="p-8 bg-[#0F172A] text-white flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-indigo-500 rounded-2xl flex items-center justify-center text-2xl shadow-lg shadow-indigo-500/30">🤖</div>
              <div>
                <h3 className="font-black text-sm tracking-tight uppercase font-['Space_Grotesk']">Nexus AI Assistant</h3>
                <p className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center mt-0.5">
                  <span className="w-2 h-2 bg-indigo-400 rounded-full mr-2 animate-pulse"></span> Context Sync: Active
                </p>
              </div>
            </div>
            <button onClick={() => setExpanded(false)} className="w-10 h-10 rounded-xl hover:bg-white/10 flex items-center justify-center text-zinc-400 transition-colors text-xl">✕</button>
          </header>

          <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-hide bg-[#F8FAFC]/50 dark:bg-transparent">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-message-in`}>
                <div className={`max-w-[90%] p-5 rounded-[2rem] text-[13px] leading-relaxed shadow-sm ${msg.role === 'user'
                  ? 'bg-indigo-600 text-white shadow-indigo-600/20'
                  : 'bg-white dark:bg-white/5 dark:text-zinc-100 border border-zinc-100 dark:border-white/5'
                  }`}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ node, ...props }) => <p className="mb-3 last:mb-0" {...props} />,
                      ul: ({ node, ...props }) => <ul className="list-disc ml-4 mb-3 space-y-1" {...props} />,
                      table: ({ node, ...props }) => <div className="overflow-x-auto my-4"><table className="min-w-full border-collapse border border-zinc-200" {...props} /></div>,
                      th: ({ node, ...props }) => <th className="border border-zinc-200 px-3 py-2 bg-zinc-50 dark:bg-white/5 font-black text-xs uppercase" {...props} />,
                      td: ({ node, ...props }) => <td className="border border-zinc-200 px-3 py-2 text-[11px]" {...props} />,
                      code: ({ node, ...props }) => <code className="bg-zinc-100 dark:bg-white/10 px-1 rounded text-indigo-500 font-bold" {...props} />
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="p-5 bg-white dark:bg-white/5 border border-zinc-100 dark:border-white/5 rounded-[2rem] flex space-x-2 items-center">
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-75"></div>
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-150"></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-8 bg-white dark:bg-[#0B1120] border-t border-zinc-50 dark:border-white/5 flex items-center space-x-4">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Query the academic ledger..."
              className="flex-1 h-14 px-6 bg-[#F8FAFC] dark:bg-white/5 border border-zinc-100 dark:border-white/10 rounded-2xl text-xs font-bold focus:outline-none focus:ring-4 focus:ring-indigo-600/10 transition-all dark:text-white"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="w-14 h-14 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-600/30 hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
            >
              <svg className="w-6 h-6 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse-gentle { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
        .animate-pulse-gentle { animation: pulse-gentle 4s ease-in-out infinite; }
        @keyframes message-in { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        .animate-message-in { animation: message-in 0.4s ease-out forwards; }
        @keyframes pop-in { from { transform: scale(0.95) translateY(30px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
        .animate-pop-in { animation: pop-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        .animate-float { display: inline-block; animation: float 3s ease-in-out infinite; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
};

export default StudentAITutor;
