
import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { GoogleGenAI } from "@google/genai";
import { supabase } from '../lib/supabase';

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
  
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded && messages.length === 0) {
      setMessages([{ 
        role: 'assistant', 
        content: `Hi ${studentName}! I'm your Big Data Tutor. I know all about Professor Pei's course materials and labs. What can I help you with today?` 
      }]);
    }
  }, [expanded, studentName]);

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
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [
          { role: 'user', parts: [{ text: `You are the AI Tutor for the Big Data & Data Visualization course at USF.
          Context: Student Name is ${studentName}.
          Instruction: Be encouraging, technical but clear, and refer to course materials like MapReduce, D3.js, and JSON data structures when relevant.
          Student Question: ${userMessage}` }] }
        ]
      });

      const assistantContent = response.text || "I'm having trouble connecting to my knowledge base right now.";
      setMessages(prev => [...prev, { role: 'assistant', content: assistantContent }]);

      // Log the interaction
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.from('student_assignment_logs').insert({
          student_id: session.user.id,
          assignment_id: 'AI_TUTOR_INTERACTION',
          interaction_type: 'question_asked',
          content: userMessage,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I hit a technical snag. Try asking again!" }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-8 right-8 z-[2000] font-['Plus_Jakarta_Sans']">
      {!expanded ? (
        <button 
          onClick={() => setExpanded(true)}
          className="w-16 h-16 bg-cyan-600 rounded-full shadow-2xl flex items-center justify-center text-3xl hover:scale-110 active:scale-95 transition-all animate-pulse-gentle relative group"
        >
          <div className="absolute -top-12 right-0 bg-zinc-900 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
             Ask AI Tutor
          </div>
          🤖
        </button>
      ) : (
        <div ref={containerRef} className="w-[400px] h-[600px] bg-white rounded-[2rem] shadow-2xl border border-zinc-100 overflow-hidden flex flex-col animate-pop-in">
           <header className="p-6 bg-[#0F172A] text-white flex items-center justify-between">
              <div className="flex items-center space-x-3">
                 <div className="w-10 h-10 bg-cyan-500 rounded-xl flex items-center justify-center text-xl shadow-lg shadow-cyan-500/20">🤖</div>
                 <div>
                    <h3 className="font-bold text-sm tracking-tight">AI Course Tutor</h3>
                    <p className="text-[9px] font-black text-cyan-400 uppercase tracking-widest flex items-center">
                       <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full mr-2 animate-pulse"></span> Active Knowledge
                    </p>
                 </div>
              </div>
              <button onClick={() => setExpanded(false)} className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-zinc-400 transition-colors">✕</button>
           </header>

           <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide bg-[#F8FAFC]/50">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-message-in`}>
                   <div className={`max-w-[85%] p-4 rounded-2xl text-[13px] font-medium leading-relaxed ${
                     msg.role === 'user' ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/10' : 'bg-white border border-zinc-100 text-zinc-800 shadow-sm'
                   }`}>
                      {msg.content}
                   </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                   <div className="p-4 bg-white border border-zinc-100 rounded-2xl flex space-x-1 items-center">
                      <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce"></div>
                      <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce delay-75"></div>
                      <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce delay-150"></div>
                   </div>
                </div>
              )}
              <div ref={messagesEndRef} />
           </div>

           <div className="p-6 bg-white border-t border-zinc-50 flex items-center space-x-3">
              <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask about a lab or concept..."
                className="flex-1 h-12 px-4 bg-zinc-50 border border-zinc-100 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all"
              />
              <button 
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="w-12 h-12 bg-cyan-600 text-white rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
              >
                 ➤
              </button>
           </div>
        </div>
      )}

      <style>{`
        @keyframes pulse-gentle { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
        .animate-pulse-gentle { animation: pulse-gentle 3s ease-in-out infinite; }
        @keyframes message-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-message-in { animation: message-in 0.3s ease-out forwards; }
        @keyframes pop-in { from { transform: scale(0.9) translateY(20px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
        .animate-pop-in { animation: pop-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
};

export default StudentAITutor;
