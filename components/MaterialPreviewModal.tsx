
import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { GoogleGenAI } from "@google/genai";

interface Material {
  id: string;
  title: string;
  topic: string;
  description: string;
  file_type: string;
  location_url: string;
}

interface MaterialPreviewModalProps {
  material: Material;
  onClose: () => void;
}

const MaterialPreviewModal: React.FC<MaterialPreviewModalProps> = ({ material, onClose }) => {
  const [activeTab, setActiveTab] = useState<'content' | 'summary'>('content');
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  
  const modalRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3 });
      gsap.fromTo(modalRef.current, { scale: 0.9, opacity: 0, y: 30 }, { scale: 1, opacity: 1, y: 0, duration: 0.4, ease: "back.out(1.5)" });
    });
    return () => ctx.revert();
  }, []);

  const handleClose = () => {
    gsap.to(modalRef.current, { scale: 0.9, opacity: 0, y: 30, duration: 0.3 });
    gsap.to(overlayRef.current, { opacity: 0, duration: 0.3, onComplete: onClose });
  };

  const generateSummary = async () => {
    if (aiSummary || isAiLoading) return;
    setIsAiLoading(true);
    setActiveTab('summary');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `You are an AI teaching assistant. Summarize this course material:
        Title: ${material.title}
        Topic: ${material.topic}
        Description: ${material.description}
        
        Please provide:
        - 3 key takeaways
        - Main technical concepts covered
        - Why this is important for Big Data students.
        Keep it academic but concise.`
      });

      setAiSummary(response.text || "I'm sorry, I couldn't summarize this material at the moment.");
    } catch (err) {
      setAiSummary("AI Summary failed. Please try again later.");
    } finally {
      setIsAiLoading(false);
    }
  };

  // Construct Preview URL (Using Google Docs viewer for PDF/Docx)
  const isEmbeddable = ['pdf', 'doc', 'docx', 'document'].includes(material.file_type.toLowerCase());
  const previewUrl = isEmbeddable 
    ? `https://docs.google.com/viewer?url=${encodeURIComponent(material.location_url)}&embedded=true`
    : material.location_url;

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[3000] bg-[#0F172A]/85 backdrop-blur-xl flex items-center justify-center p-6" onClick={handleClose}>
       <div ref={modalRef} className="w-full max-w-6xl bg-white rounded-[3rem] shadow-2xl overflow-hidden flex flex-col h-[90vh]" onClick={e => e.stopPropagation()}>
          
          <header className="p-8 md:p-10 border-b border-zinc-100 flex flex-col md:flex-row md:items-center justify-between gap-6 shrink-0">
             <div className="flex items-center space-x-6">
                <div className="w-14 h-14 bg-zinc-50 rounded-2xl flex items-center justify-center text-3xl shadow-sm border">
                   {material.file_type === 'pdf' ? '📕' : '📄'}
                </div>
                <div>
                   <h2 className="text-2xl font-black text-zinc-900 tracking-tight">{material.title}</h2>
                   <p className="text-[10px] font-black text-cyan-600 uppercase tracking-widest mt-1">{material.topic}</p>
                </div>
             </div>
             <div className="flex items-center space-x-3">
                <button 
                  onClick={() => window.open(material.location_url, '_blank')}
                  className="h-12 px-6 border-2 border-zinc-100 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:border-zinc-900 hover:text-zinc-900 transition-all"
                >
                   Download File
                </button>
                <button onClick={handleClose} className="w-12 h-12 rounded-full hover:bg-zinc-100 flex items-center justify-center text-zinc-400 transition-all">✕</button>
             </div>
          </header>

          <div className="bg-zinc-50/50 p-4 border-b border-zinc-100 flex justify-center space-x-2 shrink-0">
             <button 
               onClick={() => setActiveTab('content')}
               className={`px-8 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'content' ? 'bg-white text-zinc-900 shadow-sm border border-zinc-200' : 'text-zinc-400'}`}
             >
                Content Preview
             </button>
             <button 
               onClick={generateSummary}
               className={`px-8 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all flex items-center space-x-2 ${activeTab === 'summary' ? 'bg-white text-zinc-900 shadow-sm border border-zinc-200' : 'text-zinc-400'}`}
             >
                <span>✨ AI Summary</span>
                {isAiLoading && <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>}
             </button>
          </div>

          <div className="flex-1 relative overflow-hidden bg-zinc-100">
             {activeTab === 'content' ? (
                <div className="w-full h-full">
                   {isEmbeddable ? (
                     <iframe src={previewUrl} className="w-full h-full" frameBorder="0"></iframe>
                   ) : (
                     <div className="w-full h-full flex flex-col items-center justify-center p-20 text-center">
                        <div className="text-6xl mb-6">🔗</div>
                        <h3 className="text-xl font-bold text-zinc-900 mb-4">Direct Access Required</h3>
                        <p className="text-zinc-500 max-w-md mb-8">This material is best viewed in its original format. Please use the button below to open it.</p>
                        <a href={material.location_url} target="_blank" className="px-10 py-4 bg-cyan-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-cyan-500/20 hover:scale-105 transition-all">Launch Resource</a>
                     </div>
                   )}
                </div>
             ) : (
                <div className="w-full h-full p-12 md:p-20 overflow-y-auto scrollbar-hide bg-white">
                   <div className="max-w-3xl mx-auto">
                      <h3 className="text-3xl font-black text-zinc-900 mb-8 flex items-center">
                         <span className="mr-4">✨</span> Pedagogical Summary
                      </h3>
                      {isAiLoading ? (
                        <div className="space-y-6">
                           {[1,2,3,4,5].map(i => <div key={i} className="h-4 bg-zinc-100 rounded-full animate-pulse" style={{ width: `${100 - (i * 10)}%` }}></div>)}
                        </div>
                      ) : (
                        <div className="text-sm text-zinc-600 leading-loose space-y-6 font-medium whitespace-pre-wrap animate-fade-in">
                           {aiSummary}
                        </div>
                      )}
                      <div className="mt-12 p-8 bg-cyan-50 rounded-[2rem] border border-cyan-100">
                         <p className="text-xs font-bold text-cyan-800 italic">"This summary is AI-generated based on the document's metadata. For full details, always refer to the original material in the Content Preview tab."</p>
                      </div>
                   </div>
                </div>
             )}
          </div>

          <footer className="p-6 bg-zinc-50 border-t border-zinc-100 text-center shrink-0">
             <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Authorized Educational Asset • USF BIG DATA 2026</p>
          </footer>
       </div>
       <style>{`
         .scrollbar-hide::-webkit-scrollbar { display: none; }
         @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
         .animate-fade-in { animation: fade-in 0.5s ease-out; }
       `}</style>
    </div>
  );
};

export default MaterialPreviewModal;
