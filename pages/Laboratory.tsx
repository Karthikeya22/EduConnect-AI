
import React, { useState, useEffect } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import { GoogleGenAI } from "@google/genai";
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';

interface LaboratoryProps {
  onBack: () => void;
  onNavigateTo: (path: AppPath) => void;
  currentPath: AppPath;
  onLogout: () => void;
}

const Laboratory: React.FC<LaboratoryProps> = (props) => {
  const [dataInput, setDataInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [visualizationType, setVisualizationType] = useState<'table' | 'json' | 'stats'>('table');

  const handleAnalyze = async () => {
    if (!dataInput.trim()) return;
    setAnalyzing(true);
    setInsight(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `You are a Data Visualization Assistant. Analyze this sample data (JSON or CSV format) and:
        1. Explain the schema.
        2. Suggest the 3 best D3.js visualization types for this data.
        3. Identify any potential outliers or anomalies.
        Data: ${dataInput.substring(0, 2000)}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      setInsight(response.text || "Could not generate technical insights.");
    } catch (err) {
      console.error("Laboratory Analysis Error:", err);
      setInsight("Error connecting to the AI Knowledge Hub. Please verify network connectivity.");
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    gsap.from(".stagger-in", { opacity: 0, y: 15, stagger: 0.1, duration: 0.5 });
  }, []);

  const parseData = () => { try { return JSON.parse(dataInput); } catch { return null; } };
  const parsedData = parseData();

  return (
    <div className="flex h-screen bg-[#F8FAFC] overflow-hidden font-['Plus_Jakarta_Sans']">
      <AppSidebar 
        role="student" 
        currentPath={props.currentPath} 
        onNavigateTo={props.onNavigateTo} 
        collapsed={sidebarCollapsed} 
        setCollapsed={setSidebarCollapsed} 
        onLogout={props.onLogout} 
      />
      
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-20 bg-white border-b border-zinc-200 flex items-center justify-between px-12 shrink-0">
          <div className="flex items-center space-x-6">
            <button onClick={props.onBack} className="w-10 h-10 rounded-full hover:bg-zinc-50 flex items-center justify-center text-zinc-400 transition-colors">←</button>
            <h1 className="text-2xl font-black text-zinc-900 tracking-tighter uppercase font-['Space_Grotesk']">Laboratory</h1>
          </div>
          <div className="flex bg-zinc-100 p-1.5 rounded-2xl border border-zinc-200 space-x-1">
            <button onClick={() => setVisualizationType('table')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${visualizationType === 'table' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'}`}>Table</button>
            <button onClick={() => setVisualizationType('json')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${visualizationType === 'json' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'}`}>JSON</button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col p-12 border-r border-zinc-200 bg-white shadow-inner stagger-in">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Input Raw Big Data</h3>
              <button onClick={() => setDataInput('[\n  {"name": "Cluster A", "load": 85, "active": true},\n  {"name": "Cluster B", "load": 12, "active": true},\n  {"name": "Cluster C", "load": 45, "active": false}\n]')} className="text-[10px] font-black text-cyan-600 uppercase hover:underline">Insert Sample JSON</button>
            </div>
            <textarea 
              value={dataInput} 
              onChange={(e) => setDataInput(e.target.value)}
              placeholder="Paste JSON or CSV data here..."
              className="flex-1 w-full p-8 bg-[#0F172A] text-cyan-400 font-mono text-sm rounded-[2.5rem] border-none focus:ring-8 focus:ring-cyan-500/5 resize-none shadow-2xl transition-all"
            />
            <button 
              onClick={handleAnalyze}
              disabled={analyzing || !dataInput.trim()}
              className="mt-8 h-16 bg-[#18181B] text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center disabled:opacity-50 shadow-2xl shadow-black/20"
            >
              {analyzing ? <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin"></div> : "✨ Run Predictive Schema Analysis"}
            </button>
          </div>

          <div className="w-[500px] bg-[#F8FAFC] flex flex-col overflow-y-auto scrollbar-hide stagger-in">
            <div className="p-12">
              <div className="bg-[#18181B] p-10 rounded-[3rem] text-white shadow-2xl mb-12 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-48 h-48 bg-purple-500 rounded-full blur-[100px] opacity-20 group-hover:scale-150 transition-transform duration-1000"></div>
                <h4 className="text-xl font-bold mb-6 flex items-center"><span className="mr-3">🤖</span> AI Intelligence Hub</h4>
                {analyzing ? (
                  <div className="space-y-6 py-12">
                    <div className="h-2.5 bg-white/10 rounded-full animate-pulse"></div>
                    <div className="h-2.5 bg-white/10 rounded-full animate-pulse delay-150 w-3/4"></div>
                    <div className="h-2.5 bg-white/10 rounded-full animate-pulse delay-300 w-5/6"></div>
                  </div>
                ) : insight ? (
                  <div className="text-xs font-medium leading-relaxed text-zinc-300 whitespace-pre-wrap animate-fade-in">{insight}</div>
                ) : (
                  <p className="text-xs text-zinc-500 italic leading-relaxed">Provide course data and initiate the sentinel analysis to unlock pedagogical and technical visualization structures.</p>
                )}
              </div>

              <div className="bg-white p-10 rounded-[3rem] border border-zinc-100 shadow-xl">
                 <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-8">Data Explorer Preview</h4>
                 {parsedData ? (
                   visualizationType === 'table' ? (
                     <div className="overflow-x-auto max-h-[400px]">
                       <table className="w-full text-[10px]">
                         <thead className="bg-zinc-50 text-zinc-400 font-black uppercase">
                           <tr>{Object.keys(Array.isArray(parsedData) ? parsedData[0] || {} : parsedData).map(k => <th key={k} className="p-3 text-left">{k}</th>)}</tr>
                         </thead>
                         <tbody className="divide-y divide-zinc-50">
                           {(Array.isArray(parsedData) ? parsedData : [parsedData]).slice(0, 15).map((row, i) => (
                             <tr key={i} className="hover:bg-zinc-50 transition-colors">
                               {Object.values(row).map((v: any, j) => <td key={j} className="p-3 font-bold text-zinc-600 truncate max-w-[120px]">{JSON.stringify(v)}</td>)}
                             </tr>
                           ))}
                         </tbody>
                       </table>
                     </div>
                   ) : (
                     <div className="bg-zinc-50 p-6 rounded-2xl font-mono text-[11px] overflow-auto max-h-[400px] border border-zinc-100 shadow-inner">
                        <pre className="text-zinc-600">{JSON.stringify(parsedData, null, 2)}</pre>
                     </div>
                   )
                 ) : (
                   <div className="py-20 text-center border-4 border-dashed border-zinc-50 rounded-[2.5rem]">
                     <p className="text-[10px] font-black text-zinc-200 uppercase tracking-widest leading-relaxed">System awaiting data input</p>
                   </div>
                 )}
              </div>
            </div>
          </div>
        </div>
      </main>
      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
      `}</style>
    </div>
  );
};

export default Laboratory;
