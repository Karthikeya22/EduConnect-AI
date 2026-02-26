
import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { logActivity } from '../lib/logger';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface AIAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  teacherName: string;
  platformContext?: string;
}

const AIAssistantModal: React.FC<AIAssistantModalProps> = ({ isOpen, onClose, teacherName, platformContext }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRendered, setIsRendered] = useState(isOpen);

  const modalRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Improved name logic to avoid "Professor Professor"
  const getCleanName = (name: string) => {
    if (!name || name.toLowerCase() === 'professor') return 'Instructor';
    const prefixes = ['Professor', 'Dr.', 'Dr', 'Mr.', 'Mr', 'Ms.', 'Ms', 'Mrs.', 'Mrs'];
    let clean = name.trim();
    for (const p of prefixes) {
      if (clean.toLowerCase().startsWith(p.toLowerCase())) {
        clean = clean.substring(p.length).trim();
      }
    }
    return clean || 'Instructor';
  };

  useEffect(() => {
    const saved = localStorage.getItem('faculty_ai_history');
    if (saved) {
      setMessages(JSON.parse(saved));
    } else {
      const cleanName = getCleanName(teacherName);
      setMessages([
        {
          role: 'assistant',
          content: `Nexus Intelligence active. Hello Professor ${cleanName}. I have indexed the course ledger.\n\nHow shall we optimize the curriculum today?`,
          timestamp: Date.now()
        }
      ]);
    }
  }, [teacherName]);

  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem('faculty_ai_history', JSON.stringify(messages));
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      const ctx = gsap.context(() => {
        gsap.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3 });
        gsap.fromTo(modalRef.current, { scale: 0.96, opacity: 0, y: 20 }, { scale: 1, opacity: 1, y: 0, duration: 0.5, ease: "power3.out" });
      });
      return () => ctx.revert();
    } else {
      const ctx = gsap.context(() => {
        gsap.to(modalRef.current, { scale: 0.96, opacity: 0, y: 20, duration: 0.3, ease: "power3.in" });
        gsap.to(overlayRef.current, { opacity: 0, duration: 0.3, onComplete: () => setIsRendered(false) });
      });
      return () => ctx.revert();
    }
  }, [isOpen]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    const newMsg: Message = { role: 'user', content: userMessage, timestamp: Date.now() };
    setMessages(prev => [...prev, newMsg]);
    setIsLoading(true);

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.API_KEY ||
        '';

      if (!apiKey) throw new Error("CRITICAL_ERROR: Gemini API Key missing from environment.");

      console.log("Oracle Ledger Sync [LIVE]:", platformContext);

      const client = new GoogleGenAI({ apiKey } as any);

      const response = await (client as any).models.generateContent({
        model: "gemini-3-flash-preview",
        systemInstruction: `
          # IDENTITY
          You are the "EduConnect Oracle", a high-precision pedagogical intelligence hub.
          You MUST ONLY use data from the [LIVE_LEDGER] provided in the Instructor Query.
          If data is missing, admit it. NEVER hallucinate student names or metrics.
        `,
        contents: [
          ...messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          {
            role: 'user',
            parts: [{ text: `[LIVE_LEDGER_CONTEXT]\n${platformContext || 'EMPTY_LEDGER'}\n\nInstructor Query: ${userMessage}` }]
          }
        ]
      });

      const assistantContent = response.text || "Ledger sync interrupted.";
      setMessages(prev => [...prev, { role: 'assistant', content: assistantContent, timestamp: Date.now() }]);

      try {
        await logActivity('AI_QUERY', `Oracle queried by Instructor: "${userMessage.substring(0, 50)}..."`);
      } catch (error: any) {
        console.debug('Activity logging deferred: platform_activity_logs is not provisioned.');
      }
    } catch (error: any) {
      console.error("Oracle Generation Error:", error);
      setMessages(prev => [...prev, { role: 'assistant', content: "Protocol error: Hub connection failed or model restricted.", timestamp: Date.now() }]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearHistory = () => {
    localStorage.removeItem('faculty_ai_history');
    const cleanName = getCleanName(teacherName);
    setMessages([{ role: 'assistant', content: `Nexus Intelligence reset. System ready, Professor ${cleanName}.`, timestamp: Date.now() }]);
  };

  if (!isRendered) return null;

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[2000] flex items-center justify-center p-6 bg-zinc-950/70 dark:bg-black/85 backdrop-blur-md" onClick={(e) => {
      if (e.target === overlayRef.current) {
        e.stopPropagation();
        onClose();
      }
    }}>
      <div ref={modalRef} className="w-full max-w-4xl bg-white dark:bg-navy-900 rounded-[2.5rem] shadow-2xl overflow-hidden border border-zinc-200 dark:border-white/10 flex flex-col h-[85vh] transition-all duration-300">

        <header className="px-8 py-5 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between shrink-0 bg-white/80 dark:bg-white/5 backdrop-blur-sm">
          <div className="flex items-center space-x-4">
            <div className="w-11 h-11 bg-zinc-900 dark:bg-white rounded-2xl flex items-center justify-center text-2xl shadow-lg relative shrink-0">
              <span className="relative z-10">🤖</span>
              <div className="absolute inset-0 bg-cyan-500/20 rounded-2xl animate-pulse"></div>
            </div>
            <div>
              <h3 className="font-black text-lg text-zinc-900 dark:text-white tracking-tight uppercase font-['Space_Grotesk'] leading-none">Intelligence Command</h3>
              <div className="flex items-center space-x-3 mt-1.5">
                <div className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full ${platformContext ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${platformContext ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                  <p className={`text-[9px] font-black uppercase tracking-widest ${platformContext ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {platformContext ? `Ledger Indexed (${platformContext.length} chars)` : 'Syncing Ledger'}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearHistory();
                  }}
                  className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-[10px] font-black uppercase tracking-widest rounded-lg border border-rose-500/20 transition-all hover:scale-105 active:scale-95 ml-2"
                >
                  Purge Sync
                </button>
              </div>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="w-10 h-10 rounded-xl hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center transition-all text-zinc-400 hover:text-rose-500 hover:rotate-90"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </header>

        <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-8 py-6 space-y-4 scroll-smooth bg-zinc-50/30 dark:bg-navy-900/50 scrollbar-hide">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-message-in`}>
              <div className={`max-w-[85%] px-5 py-4 rounded-3xl text-[13px] font-medium leading-relaxed shadow-sm ${msg.role === 'user'
                ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-tr-none'
                : 'bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-800 dark:text-zinc-200 rounded-tl-none'
                }`}>
                <div className={`text-[8px] font-black uppercase tracking-[0.15em] opacity-40 mb-1.5 ${msg.role === 'user' ? 'text-white' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  {msg.role === 'user' ? 'Instructor' : 'Nexus Intelligence'}
                </div>
                <div className="markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
                <div className={`text-[8px] font-bold opacity-30 mt-3 text-right ${msg.role === 'user' ? 'text-white' : ''}`}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start animate-message-in">
              <div className="bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 px-4 py-3 rounded-2xl rounded-tl-none flex space-x-1.5 items-center">
                <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce"></div>
                <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce delay-100"></div>
                <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce delay-200"></div>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 bg-white dark:bg-navy-950 border-t border-zinc-100 dark:border-white/5 shrink-0">
          <div className="relative flex items-center gap-3 bg-zinc-100/50 dark:bg-white/5 p-2 rounded-[1.8rem] border border-zinc-200 dark:border-white/10 focus-within:border-zinc-400 dark:focus-within:border-white/30 transition-all duration-300">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Inquire about course metrics, students, or materials..."
              className="flex-1 h-12 pl-6 bg-transparent focus:outline-none font-bold text-zinc-900 dark:text-white text-xs placeholder:text-zinc-400"
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="w-12 h-12 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-[1.2rem] flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-50 shadow-md"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19l7-7-7-7M5 12h14" /></svg>
            </button>
          </div>
          <div className="mt-4 flex items-center justify-center opacity-30">
            <p className="text-[8px] font-black text-zinc-500 dark:text-zinc-600 uppercase tracking-[0.2em]">Restricted Faculty Intelligence Hub</p>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes message-in { 
          from { opacity: 0; transform: translateY(10px) scale(0.98); } 
          to { opacity: 1; transform: translateY(0) scale(1); } 
        }
        .animate-message-in { animation: message-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        
        .markdown-content h1, .markdown-content h2, .markdown-content h3 { font-weight: 800; margin-top: 1rem; margin-bottom: 0.5rem; text-transform: uppercase; font-size: 0.85rem; letter-spacing: 0.05em; }
        .markdown-content p { margin-bottom: 0.75rem; }
        .markdown-content ul, .markdown-content ol { margin-bottom: 0.75rem; padding-left: 1.25rem; }
        .markdown-content li { margin-bottom: 0.25rem; list-style-type: square; }
        .markdown-content strong { font-weight: 800; color: inherit; }
        .markdown-content code { background: rgba(0,0,0,0.05); padding: 0.1rem 0.3rem; rounded: 0.25rem; font-family: monospace; font-size: 0.75rem; }
      `}</style>
    </div>
  );
};

export default AIAssistantModal;
