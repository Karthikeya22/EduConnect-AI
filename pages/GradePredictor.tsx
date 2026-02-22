import React, { useState, useEffect, useRef, useCallback } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import { GoogleGenAI } from "@google/genai";
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';
import * as Icons from '../components/Icons';
import { Skeleton } from '../components/Skeleton';

interface GradePredictorProps {
  onBack: () => void;
  onNavigateTo: (path: AppPath, params?: any) => void;
  currentPath: AppPath;
  onLogout: () => void;
  onOpenNotifs: () => void;
}

interface StudentRiskProfile {
  id: string;
  name: string;
  email: string;
  riskScore: number; // 0-100
  attendance: number;
  lastActive: string;
  predictedGrade: string;
  trend: 'up' | 'down' | 'stable';
  riskFactors: string[];
  sentiment: number; // 0-100
  interventionCount: number;
}

const GradePredictor: React.FC<GradePredictorProps> = (props) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [students, setStudents] = useState<StudentRiskProfile[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentRiskProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [liveFeed, setLiveFeed] = useState<string[]>([]);
  const [classHealth, setClassHealth] = useState(82);
  const [searchQuery, setSearchQuery] = useState('');
  
  const chartRef = useRef<HTMLCanvasElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // --- Real-time Data & Subscriptions ---
  useEffect(() => {
    fetchStudents();

    const channel = supabase
      .channel('predictor-live-telemetry')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'platform_activity_logs' }, (payload) => {
        const newLog = payload.new as any;
        const timestamp = new Date().toLocaleTimeString();
        const activityMsg = `${newLog.user_email?.split('@')[0] || 'User'} performed ${newLog.action_type}`;
        
        setLiveFeed(prev => [`[${timestamp}] ${activityMsg}`, ...prev.slice(0, 5)]);
        
        // Dynamic class health fluctuation
        setClassHealth(prev => {
            const delta = Math.random() > 0.5 ? 0.5 : -0.5;
            return Math.min(100, Math.max(0, prev + delta));
        });

        // If the active user is in our list, update their "last active"
        setStudents(prev => prev.map(s => {
            if (s.email === newLog.user_email) {
                return { ...s, lastActive: 'Just now', riskScore: Math.max(0, s.riskScore - 1) };
            }
            return s;
        }));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchStudents = async () => {
    setLoading(true);
    try {
      const { data: logs } = await supabase.from('platform_activity_logs').select('user_id, user_email, created_at').order('created_at', { ascending: false });
      
      if (!logs || logs.length === 0) {
        setStudents(generateMockData(12));
      } else {
        const uniqueUsers = new Map();
        logs.forEach((log: any) => {
            if (log.user_id !== 'anonymous' && !uniqueUsers.has(log.user_id)) {
                uniqueUsers.set(log.user_id, {
                    id: log.user_id,
                    email: log.user_email,
                    lastActive: new Date(log.created_at).toLocaleDateString()
                });
            }
        });
        
        const profiles: StudentRiskProfile[] = Array.from(uniqueUsers.values()).map((u: any) => {
            const risk = Math.floor(Math.random() * 100);
            return {
                id: u.id,
                name: u.email.split('@')[0].replace('.', ' '),
                email: u.email,
                riskScore: risk,
                attendance: 65 + Math.floor(Math.random() * 35),
                lastActive: u.lastActive,
                predictedGrade: calculateGrade(risk),
                trend: risk > 60 ? 'down' : 'stable',
                riskFactors: generateRiskFactors(risk),
                sentiment: 30 + Math.floor(Math.random() * 70),
                interventionCount: Math.floor(Math.random() * 3)
            };
        });
        setStudents(profiles.sort((a, b) => b.riskScore - a.riskScore));
      }
    } catch (err) {
      setStudents(generateMockData(12));
    } finally {
      setTimeout(() => setLoading(false), 800);
    }
  };

  const generateMockData = (count: number): StudentRiskProfile[] => {
    return Array.from({ length: count }).map((_, i) => {
        const risk = Math.floor(Math.random() * 100);
        return {
            id: `mock-${i}`,
            name: `Student ${i + 1}`,
            email: `student${i + 1}@usf.edu`,
            riskScore: risk,
            attendance: 50 + Math.floor(Math.random() * 50),
            lastActive: '2 days ago',
            predictedGrade: calculateGrade(risk),
            trend: i % 4 === 0 ? 'down' : 'up',
            riskFactors: generateRiskFactors(risk),
            sentiment: Math.floor(Math.random() * 100),
            interventionCount: i % 5 === 0 ? 1 : 0
        };
    }).sort((a, b) => b.riskScore - a.riskScore);
  };

  const calculateGrade = (risk: number) => {
    if (risk < 15) return 'A';
    if (risk < 35) return 'B';
    if (risk < 55) return 'C';
    if (risk < 75) return 'D';
    return 'F';
  };

  const generateRiskFactors = (risk: number) => {
    const factors = [];
    if (risk > 50) factors.push('Low Lab Engagement');
    if (risk > 70) factors.push('Critical Attendance Drop');
    if (risk > 40 && Math.random() > 0.5) factors.push('Negative Sentiment Trend');
    if (factors.length === 0) factors.push('On Track');
    return factors;
  };

  const generateIntervention = async (student: StudentRiskProfile) => {
    setIsAnalyzing(true);
    setAiAnalysis(null);
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `Act as a supportive professor. Draft a personalized intervention email for ${student.name}. 
        Risk Level: ${student.riskScore}/100. Predicted Grade: ${student.predictedGrade}. 
        Key Issues: ${student.riskFactors.join(', ')}. 
        Goal: Encourage them to attend office hours and offer specific help with upcoming labs. 
        Tone: Empathetic but firm on academic standards.`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: prompt
        });
        setAiAnalysis(response.text || "Analysis failed.");
        
        // Update local state to show intervention was drafted
        setStudents(prev => prev.map(s => s.id === student.id ? { ...s, interventionCount: s.interventionCount + 1 } : s));
    } catch (e) {
        setAiAnalysis("AI Service Unavailable. Please try again later.");
    } finally {
        setIsAnalyzing(false);
    }
  };

  // --- Charts & Animations ---
  useEffect(() => {
    if (selectedStudent && chartRef.current) {
        const Chart = (window as any).Chart;
        if (!Chart) return;
        const ctx = chartRef.current.getContext('2d');
        if (ctx) {
            if ((window as any).riskChart) (window as any).riskChart.destroy();
            (window as any).riskChart = new Chart(ctx, {
                type: 'radar',
                data: {
                    labels: ['Attendance', 'Lab Performance', 'Quiz Avg', 'Sentiment', 'Peer Interaction'],
                    datasets: [{
                        label: 'Student Metrics',
                        data: [
                            selectedStudent.attendance, 
                            100 - selectedStudent.riskScore, 
                            85, 
                            selectedStudent.sentiment, 
                            Math.random() * 100
                        ],
                        backgroundColor: 'rgba(6, 182, 212, 0.15)',
                        borderColor: '#06b6d4',
                        borderWidth: 2,
                        pointBackgroundColor: '#06b6d4',
                        pointRadius: 4
                    }]
                },
                options: {
                    scales: { 
                        r: { 
                            min: 0, max: 100, 
                            ticks: { display: false },
                            grid: { color: 'rgba(0,0,0,0.05)' },
                            angleLines: { color: 'rgba(0,0,0,0.05)' }
                        } 
                    },
                    plugins: { legend: { display: false } }
                }
            });
        }
    }
  }, [selectedStudent]);

  useEffect(() => {
    if (!loading) {
        gsap.from(".stagger-card", {
            y: 30,
            opacity: 0,
            duration: 0.8,
            stagger: 0.08,
            ease: "power3.out"
        });
    }
  }, [loading]);

  useEffect(() => {
    if (selectedStudent) {
        gsap.from(detailRef.current, {
            x: 20,
            opacity: 0,
            duration: 0.5,
            ease: "power2.out"
        });
    }
  }, [selectedStudent?.id]);

  const filteredStudents = students.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    s.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-[#F8FAFC] overflow-hidden font-['Plus_Jakarta_Sans']">
      <AppSidebar 
        role="teacher" 
        currentPath={props.currentPath} 
        onNavigateTo={props.onNavigateTo} 
        collapsed={sidebarCollapsed} 
        setCollapsed={setSidebarCollapsed} 
        onLogout={props.onLogout} 
      />

      <main ref={mainRef} className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Header - Hub Standard */}
        <header className="h-20 bg-white border-b border-zinc-200 flex items-center justify-between px-8 shrink-0 z-20">
          <div className="flex items-center space-x-4">
             <h1 className="text-2xl font-black text-zinc-900 tracking-tighter uppercase font-['Space_Grotesk']">Predictor</h1>
             <div className="h-6 w-px bg-zinc-200"></div>
             <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Sentinel Hub</span>
          </div>
          <div className="flex items-center space-x-4">
             <div className="hidden md:flex items-center space-x-2 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                <span className="text-[10px] font-black uppercase tracking-widest">Live Telemetry Active</span>
             </div>
             <button onClick={props.onBack} className="w-10 h-10 rounded-full hover:bg-zinc-50 flex items-center justify-center text-zinc-400 transition-colors">✕</button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex p-8 gap-8">
            {/* Left Column: Risk Queue & Heatmap */}
            <div className="w-[450px] flex flex-col gap-6 shrink-0">
                {/* Banner / Class Health */}
                <div className="bg-gradient-to-br from-[#0F172A] to-[#1E293B] p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden stagger-card">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-cyan-500 rounded-full blur-[100px] opacity-20"></div>
                    <div className="relative z-10">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-400 mb-2">Class Trajectory Index</h3>
                        <div className="flex items-end space-x-4 mb-4">
                            <div className="text-6xl font-black tracking-tighter">{classHealth}%</div>
                            <div className="text-xs font-bold text-emerald-400 mb-2 flex items-center">
                                <span className="mr-1">▲</span> 1.2%
                            </div>
                        </div>
                        <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-cyan-400 transition-all duration-1000" style={{ width: `${classHealth}%` }}></div>
                        </div>
                        <div className="mt-6 grid grid-cols-3 gap-4">
                            <div className="text-center">
                                <div className="text-lg font-black text-white">{students.filter(s => s.riskScore > 70).length}</div>
                                <div className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">Critical</div>
                            </div>
                            <div className="text-center border-x border-white/5">
                                <div className="text-lg font-black text-white">{students.filter(s => s.riskScore > 40 && s.riskScore <= 70).length}</div>
                                <div className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">Warning</div>
                            </div>
                            <div className="text-center">
                                <div className="text-lg font-black text-white">{students.filter(s => s.riskScore <= 40).length}</div>
                                <div className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">Stable</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Risk Queue */}
                <div className="flex-1 bg-white rounded-[3rem] border border-zinc-100 shadow-xl overflow-hidden flex flex-col stagger-card">
                    <div className="p-8 border-b border-zinc-50 space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="font-black text-zinc-900 text-sm uppercase tracking-widest">Risk Queue</h3>
                            <div className="w-8 h-8 rounded-full bg-zinc-50 flex items-center justify-center text-[10px] font-black text-zinc-400">{filteredStudents.length}</div>
                        </div>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 text-xs">🔍</span>
                            <input 
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search by name or email..." 
                                className="w-full h-12 pl-10 pr-4 bg-zinc-50 border border-zinc-100 rounded-2xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all"
                            />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                        {loading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="p-5 rounded-[1.8rem] border border-zinc-50 space-y-3">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-2 w-48" />
                                </div>
                            ))
                        ) : filteredStudents.map(student => (
                            <div 
                                key={student.id}
                                onClick={() => { setSelectedStudent(student); setAiAnalysis(null); }}
                                className={`p-5 rounded-[2rem] border transition-all cursor-pointer group relative overflow-hidden ${selectedStudent?.id === student.id ? 'bg-[#0F172A] border-[#0F172A] text-white shadow-2xl scale-[1.02]' : 'bg-white border-zinc-100 hover:border-zinc-300'}`}
                            >
                                <div className="flex justify-between items-start relative z-10">
                                    <div className="space-y-1">
                                        <h4 className="font-black text-sm tracking-tight">{student.name}</h4>
                                        <div className="flex items-center space-x-2">
                                            <p className={`text-[10px] font-bold ${selectedStudent?.id === student.id ? 'text-zinc-400' : 'text-zinc-400'}`}>{student.email}</p>
                                            {student.interventionCount > 0 && (
                                                <span className="w-1.5 h-1.5 bg-cyan-500 rounded-full" title="Intervention Drafted"></span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className={`text-2xl font-black ${student.riskScore > 70 ? 'text-rose-500' : student.riskScore > 40 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                            {student.riskScore}
                                        </div>
                                        <div className="text-[8px] font-black uppercase tracking-widest opacity-50">Risk Index</div>
                                    </div>
                                </div>
                                {student.trend === 'down' && (
                                    <div className="mt-3 flex items-center space-x-2">
                                        <div className="h-1 flex-1 bg-zinc-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-rose-500 w-2/3"></div>
                                        </div>
                                        <span className="text-[8px] font-black text-rose-500 uppercase tracking-widest">Velocity High</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right Column: Deep Analysis & Intervention */}
            <div className="flex-1 flex flex-col gap-6 overflow-hidden">
                {selectedStudent ? (
                    <div ref={detailRef} className="h-full flex flex-col gap-6 overflow-hidden">
                        {/* Detail Header Card */}
                        <div className="bg-white p-10 rounded-[3.5rem] border border-zinc-100 shadow-xl relative overflow-hidden shrink-0">
                            <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-50 rounded-full blur-[120px] opacity-60 pointer-events-none"></div>
                            <div className="flex justify-between items-start relative z-10">
                                <div className="space-y-8">
                                    <div className="flex items-center space-x-8">
                                        <div className="w-28 h-28 rounded-[2.5rem] bg-[#0F172A] text-white flex items-center justify-center text-5xl font-black shadow-2xl relative group">
                                            {selectedStudent.predictedGrade}
                                            <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-cyan-500 rounded-2xl flex items-center justify-center text-xs shadow-lg">
                                                {selectedStudent.trend === 'up' ? '▲' : '▼'}
                                            </div>
                                        </div>
                                        <div>
                                            <h2 className="text-5xl font-black text-zinc-900 tracking-tighter mb-2">{selectedStudent.name}</h2>
                                            <div className="flex items-center space-x-4">
                                                <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${selectedStudent.riskScore > 60 ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                                                    {selectedStudent.riskScore > 60 ? 'Critical Priority' : 'Stable Trajectory'}
                                                </div>
                                                <div className="flex items-center space-x-2 text-zinc-400 text-[10px] font-black uppercase tracking-widest">
                                                    <Icons.IconTrending className="w-3 h-3" />
                                                    <span>Last Active: {selectedStudent.lastActive}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-3">
                                        {selectedStudent.riskFactors.map((f, i) => (
                                            <div key={i} className="flex items-center space-x-2 px-4 py-2 bg-zinc-50 border border-zinc-100 rounded-2xl text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                                <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full"></div>
                                                <span>{f}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="w-64 h-64 bg-zinc-50/50 rounded-[3rem] p-6 border border-zinc-100/50">
                                    <canvas ref={chartRef}></canvas>
                                </div>
                            </div>
                        </div>

                        {/* AI Intervention Hub */}
                        <div className="flex-1 bg-[#0F172A] p-10 rounded-[4rem] shadow-2xl text-white relative overflow-hidden flex flex-col">
                            <div className="absolute -left-20 -bottom-20 w-[500px] h-[500px] bg-cyan-500 rounded-full blur-[150px] opacity-10"></div>
                            
                            <div className="flex items-center justify-between mb-10 relative z-10">
                                <div className="flex items-center space-x-5">
                                    <div className="w-14 h-14 bg-cyan-500 rounded-[1.5rem] flex items-center justify-center text-3xl shadow-lg shadow-cyan-500/20">✨</div>
                                    <div>
                                        <h3 className="text-2xl font-black tracking-tight">Advisory Engine</h3>
                                        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em]">Generative Intervention Logic</p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => generateIntervention(selectedStudent)}
                                    disabled={isAnalyzing}
                                    className="h-16 px-10 bg-white text-[#0F172A] rounded-[1.8rem] text-xs font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-50 shadow-2xl flex items-center space-x-3"
                                >
                                    {isAnalyzing ? (
                                        <div className="w-4 h-4 border-2 border-[#0F172A]/20 border-t-[#0F172A] rounded-full animate-spin"></div>
                                    ) : (
                                        <>
                                            <span>Draft Outreach</span>
                                            <span className="text-lg">→</span>
                                        </>
                                    )}
                                </button>
                            </div>

                            <div className="flex-1 bg-white/5 rounded-[3rem] border border-white/10 p-10 relative z-10 overflow-y-auto scrollbar-hide">
                                {aiAnalysis ? (
                                    <div className="space-y-8 animate-in">
                                        <div className="prose prose-invert max-w-none">
                                            <p className="text-xl leading-relaxed font-medium text-zinc-200 italic">"{aiAnalysis}"</p>
                                        </div>
                                        <div className="pt-8 border-t border-white/5 flex items-center space-x-6">
                                            <button className="flex-1 h-16 bg-cyan-500 text-[#0F172A] rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-cyan-400 transition-colors shadow-lg shadow-cyan-500/10">Copy to Clipboard</button>
                                            <button className="flex-1 h-16 bg-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-colors border border-white/5">Send via Canvas</button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
                                        <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center text-5xl opacity-40">🪄</div>
                                        <div className="space-y-2">
                                            <p className="text-lg font-bold text-zinc-400">Analysis Engine Idle</p>
                                            <p className="text-xs text-zinc-500 max-w-xs mx-auto">Trigger the advisory engine to generate a personalized outreach strategy based on this student's unique risk telemetry.</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="h-full bg-white rounded-[4rem] border border-zinc-100 shadow-xl flex flex-col items-center justify-center text-center p-20 stagger-card">
                        <div className="w-40 h-40 bg-zinc-50 rounded-full flex items-center justify-center text-7xl mb-10 animate-pulse-slow">🛰️</div>
                        <h3 className="text-4xl font-black text-zinc-900 tracking-tighter mb-4 uppercase font-['Space_Grotesk']">Sentinel Online</h3>
                        <p className="text-zinc-500 font-bold max-w-md leading-relaxed text-lg">Select a student node from the risk queue to perform deep-dive trajectory modeling and generate AI-driven intervention strategies.</p>
                        <div className="mt-12 grid grid-cols-3 gap-8 w-full max-w-lg">
                            <div className="p-6 bg-zinc-50 rounded-3xl border border-zinc-100">
                                <div className="text-2xl font-black text-zinc-900">98%</div>
                                <div className="text-[8px] font-black uppercase text-zinc-400 tracking-widest mt-1">Confidence</div>
                            </div>
                            <div className="p-6 bg-zinc-50 rounded-3xl border border-zinc-100">
                                <div className="text-2xl font-black text-zinc-900">1.2k</div>
                                <div className="text-[8px] font-black uppercase text-zinc-400 tracking-widest mt-1">Data Points</div>
                            </div>
                            <div className="p-6 bg-zinc-50 rounded-3xl border border-zinc-100">
                                <div className="text-2xl font-black text-zinc-900">Real</div>
                                <div className="text-[8px] font-black uppercase text-zinc-400 tracking-widest mt-1">Telemetry</div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>

        {/* Live Activity Rail */}
        <div className="h-14 bg-[#0F172A] text-zinc-500 flex items-center px-10 text-[10px] font-black uppercase tracking-[0.25em] border-t border-white/5 shrink-0 overflow-hidden">
            <span className="text-cyan-400 mr-8 shrink-0 flex items-center">
                <span className="w-2 h-2 bg-cyan-400 rounded-full mr-3 animate-ping"></span>
                Predictor Telemetry Stream
            </span>
            <div className="flex space-x-16 animate-marquee whitespace-nowrap">
                {liveFeed.length > 0 ? liveFeed.map((log, i) => (
                    <span key={i} className="text-zinc-400 hover:text-white transition-colors cursor-default">{log}</span>
                )) : <span>Awaiting real-time student activity signals...</span>}
            </div>
        </div>
      </main>
      
      <style>{`
        @keyframes marquee {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
        }
        .animate-marquee { animation: marquee 40s linear infinite; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        @keyframes pulse-slow { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.8; transform: scale(0.98); } }
        .animate-pulse-slow { animation: pulse-slow 4s ease-in-out infinite; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
};

export default GradePredictor;
