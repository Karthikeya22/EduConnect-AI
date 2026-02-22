
import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import { GoogleGenAI } from "@google/genai";
import { logActivity } from '../lib/logger';
import StudentProfileModal from '../components/StudentProfileModal';
import { Skeleton } from '../components/Skeleton';

interface StudentsAnalyticsProps {
  onBack: () => void;
}

interface Student {
  id: string;
  student_name: string;
  student_email: string;
  enrolled_date: string;
  avatar?: string;
  stats?: {
    materialsViewed: number;
    assignmentsCompleted: number;
    discussionPosts: number;
    completionPercent: number;
    isActive: boolean;
  };
}

const StudentsAnalytics: React.FC<StudentsAnalyticsProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<'students' | 'analytics'>('students');
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [aiInsights, setAiInsights] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  
  const chartRefs = {
    engagement: useRef<HTMLCanvasElement>(null),
    materials: useRef<HTMLCanvasElement>(null),
    completion: useRef<HTMLCanvasElement>(null),
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (activeTab === 'analytics' && !loading) {
      renderCharts();
      generateAIInsights();
    }
  }, [activeTab, loading]);

  useEffect(() => {
    if (!loading) {
      const ctx = gsap.context(() => {
        gsap.from(".animate-fade-up", {
          y: 30,
          opacity: 0,
          stagger: 0.05,
          duration: 0.8,
          ease: "power3.out",
          clearProps: "all"
        });
      }, mainRef);
      return () => ctx.revert();
    }
  }, [loading, activeTab]);

  useEffect(() => {
    const query = searchQuery.toLowerCase();
    const filtered = students.filter(s => 
      s.student_name.toLowerCase().includes(query) || 
      s.student_email.toLowerCase().includes(query)
    );
    setFilteredStudents(filtered);
  }, [searchQuery, students]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: studentsData } = await supabase.from('platform_activity_logs').select('user_email, user_id').neq('user_id', 'anonymous');
      const uniqueIds = Array.from(new Set(studentsData?.map(s => s.user_id)));
      const mockStudents: Student[] = uniqueIds.map(id => {
        const found = studentsData?.find(s => s.user_id === id);
        return {
          id: id as string,
          student_name: found?.user_email?.split('@')[0].replace('.', ' ') || 'Student',
          student_email: found?.user_email || '',
          enrolled_date: '2026-01-15',
          stats: {
            materialsViewed: Math.floor(Math.random() * 45),
            assignmentsCompleted: Math.floor(Math.random() * 8),
            discussionPosts: Math.floor(Math.random() * 20),
            completionPercent: Math.floor(Math.random() * 100),
            isActive: Math.random() > 0.2
          }
        };
      });

      setStudents(mockStudents);
      setFilteredStudents(mockStudents);
      setTimeout(() => setLoading(false), 800);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const renderCharts = () => {
    const win = window as any;
    if (!win.Chart) return;
    if (chartRefs.engagement.current) {
      new win.Chart(chartRefs.engagement.current, {
        type: 'line',
        data: {
          labels: ['Feb 1', 'Feb 5', 'Feb 10', 'Feb 15', 'Feb 20', 'Feb 25'],
          datasets: [{
            label: 'Active Students',
            data: [12, 19, 34, 25, 38, 42],
            borderColor: '#8B5CF6',
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            fill: true,
            tension: 0.4
          }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
    }
    if (chartRefs.materials.current) {
      new win.Chart(chartRefs.materials.current, {
        type: 'bar',
        data: {
          labels: ['Intro', 'MapReduce', 'Viz Ethics', 'SQL vs NoSQL', 'D3.js Labs'],
          datasets: [{
            label: 'Views',
            data: [45, 42, 38, 12, 30],
            backgroundColor: ['#06B6D4', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981'],
            borderRadius: 8
          }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
    }
    if (chartRefs.completion.current) {
      new win.Chart(chartRefs.completion.current, {
        type: 'doughnut',
        data: {
          labels: ['Completed', 'Pending', 'Not Started'],
          datasets: [{
            data: [67, 23, 10],
            backgroundColor: ['#10B981', '#F59E0B', '#EF4444'],
            borderWidth: 0
          }]
        },
        options: { cutout: '70%', plugins: { legend: { position: 'bottom' } } }
      });
    }
  };

  const generateAIInsights = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: "Analyze this Big Data course context: 45 students, 67% material completion, MapReduce assignment avg 72%. Provide 4 bullet point insights for the professor."
      });
      const lines = response.text?.split('\n').filter(l => l.trim().length > 0).slice(0, 4) || [];
      setAiInsights(lines);
    } catch (err) {
      setAiInsights(["🎯 Chapter 3 engagement is lower than expected.", "⚠️ 5 students scored below 70% on recent labs.", "✨ Discussion participation is up 15% this week.", "📊 D3.js modules have 95% perfect completion rate."]);
    }
  };

  const exportCSV = () => {
    const headers = ["Name", "Email", "Completion %", "Materials", "Assignments"];
    const rows = students.map(s => [s.student_name, s.student_email, s.stats?.completionPercent, s.stats?.materialsViewed, s.stats?.assignmentsCompleted]);
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EduConnect_BigData_Students.csv`;
    a.click();
    logActivity('DATABASE_UPDATE', 'Student directory exported to CSV');
  };

  return (
    <div className="flex h-screen bg-[#F9F8F3] overflow-hidden relative font-['Plus_Jakarta_Sans']">
      <aside className={`bg-[#0F172A] text-white transition-all duration-300 flex flex-col shadow-2xl ${sidebarCollapsed ? 'w-[72px]' : 'w-[260px]'}`}>
        <div className="h-16 flex items-center px-6 border-b border-white/10 shrink-0">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center font-bold text-zinc-900 shrink-0">USF</div>
          {!sidebarCollapsed && <span className="ml-3 font-bold text-lg tracking-tight truncate font-['Space_Grotesk']">BigData AI</span>}
        </div>
        <nav className="flex-1 py-6">
          <button onClick={onBack} className="w-full flex items-center px-6 py-3 transition-all text-zinc-400 hover:text-white hover:bg-white/5 border-l-4 border-transparent group">
            <span className="text-xl">←</span>
            {!sidebarCollapsed && <span className="ml-4 font-bold text-sm">Dashboard</span>}
          </button>
          <button className="w-full flex items-center px-6 py-3 transition-all text-white bg-white/10 border-l-4 border-white">
            <span className="text-xl">👥</span>
            {!sidebarCollapsed && <span className="ml-4 font-bold text-sm">Analytics</span>}
          </button>
        </nav>
        <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="h-14 border-t border-white/10 flex items-center justify-center text-zinc-400 hover:text-white">{sidebarCollapsed ? '→' : '← Collapse'}</button>
      </aside>

      <main ref={mainRef} className="flex-1 flex flex-col min-w-0 overflow-y-auto relative z-10 scroll-smooth">
        <header className="p-8 md:p-12 pb-4 animate-fade-up">
          <button onClick={onBack} className="flex items-center space-x-2 text-zinc-400 hover:text-zinc-900 transition-colors mb-6 group">
             <span className="text-xl group-hover:-translate-x-1 transition-transform">←</span>
             <span className="font-bold text-sm">Go Back</span>
          </button>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
            <div>
              <h1 className="text-4xl md:text-5xl font-black text-zinc-900 mb-2 tracking-tighter font-['Space_Grotesk'] bg-gradient-to-r from-purple-600 to-cyan-500 bg-clip-text text-transparent">
                Insights & Directory
              </h1>
              <p className="text-zinc-500 font-bold">Track student growth and resource engagement for BIG_DATA_2026.</p>
            </div>
            <button onClick={exportCSV} className="h-14 px-8 border-2 border-zinc-200 bg-white rounded-2xl font-black text-xs uppercase tracking-widest hover:border-zinc-900 transition-all active:scale-95 shadow-sm">
              Export to CSV
            </button>
          </div>

          <div className="bg-zinc-100 p-1.5 rounded-[1.8rem] flex w-full max-w-md border border-zinc-200/50 mb-12">
            <button onClick={() => setActiveTab('students')} className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'students' ? 'bg-white text-zinc-900 shadow-md' : 'text-zinc-400 hover:text-zinc-600'}`}>Students Directory</button>
            <button onClick={() => setActiveTab('analytics')} className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'analytics' ? 'bg-white text-zinc-900 shadow-md' : 'text-zinc-400 hover:text-zinc-600'}`}>Course Analytics</button>
          </div>
        </header>

        <section className="px-8 md:px-12 pb-12">
          {activeTab === 'students' ? (
            <div className="space-y-10">
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between animate-fade-up">
                    <div className="relative w-full md:w-96">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400">🔍</span>
                        <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by name or email..." className="w-full h-14 pl-12 pr-6 bg-white border-2 border-zinc-100 rounded-2xl focus:border-zinc-900 focus:outline-none font-bold text-sm shadow-sm" />
                    </div>
                    <div className="flex items-center space-x-2 bg-zinc-100 p-1 rounded-xl border border-zinc-200">
                        <button onClick={() => setViewMode('grid')} className={`p-3 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400'}`}>📇</button>
                        <button onClick={() => setViewMode('table')} className={`p-3 rounded-lg transition-all ${viewMode === 'table' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400'}`}>📋</button>
                    </div>
                </div>

                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[1,2,3,4,5,6].map(i => (
                          <div key={i} className="bg-white p-8 rounded-[2.5rem] border border-zinc-100 shadow-sm space-y-6">
                            <div className="flex items-center space-x-4">
                              <Skeleton className="w-16 h-16 rounded-2xl" />
                              <div className="space-y-2">
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-2 w-24" />
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <Skeleton className="h-10 rounded-xl" />
                              <Skeleton className="h-10 rounded-xl" />
                              <Skeleton className="h-10 rounded-xl" />
                            </div>
                            <Skeleton className="h-2 w-full rounded-full" />
                          </div>
                        ))}
                    </div>
                ) : (
                    viewMode === 'grid' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {filteredStudents.map((s, idx) => (
                                <div key={s.id} onClick={() => setSelectedStudent(s)} className="bg-white p-8 rounded-[2.5rem] border border-zinc-100 shadow-xl shadow-zinc-200/20 hover:translate-y-[-4px] hover:shadow-2xl transition-all group cursor-pointer animate-fade-up">
                                    <div className="flex items-center space-x-4 mb-6">
                                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white font-black text-xl shadow-lg group-hover:rotate-6 transition-transform">{s.student_name.charAt(0)}</div>
                                        <div>
                                            <h3 className="font-black text-zinc-900 tracking-tight">{s.student_name}</h3>
                                            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">{s.student_email}</p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 mb-6">
                                        <div className="text-center p-3 bg-zinc-50 rounded-2xl border border-zinc-100"><div className="text-xs font-black text-zinc-900">{s.stats?.materialsViewed}</div><div className="text-[8px] font-black text-zinc-400 uppercase tracking-widest mt-1">Reads</div></div>
                                        <div className="text-center p-3 bg-zinc-50 rounded-2xl border border-zinc-100"><div className="text-xs font-black text-zinc-900">{s.stats?.assignmentsCompleted}</div><div className="text-[8px] font-black text-zinc-400 uppercase tracking-widest mt-1">Labs</div></div>
                                        <div className="text-center p-3 bg-zinc-50 rounded-2xl border border-zinc-100"><div className="text-xs font-black text-zinc-900">{s.stats?.discussionPosts}</div><div className="text-[8px] font-black text-zinc-400 uppercase tracking-widest mt-1">Posts</div></div>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest"><span className="text-zinc-400">Course Progress</span><span className="text-purple-600">{s.stats?.completionPercent}%</span></div>
                                        <div className="h-2 bg-zinc-100 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-purple-500 to-indigo-600 rounded-full" style={{ width: `${s.stats?.completionPercent}%` }}></div></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="bg-white rounded-[2.5rem] border border-zinc-100 shadow-xl overflow-hidden animate-fade-up">
                            <table className="w-full text-left">
                                <thead className="bg-[#0F172A] text-white">
                                    <tr><th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest">Student</th><th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest">Materials</th><th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest">Assignments</th><th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest">Status</th><th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest">Actions</th></tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-50">
                                    {filteredStudents.map(s => (
                                        <tr key={s.id} className="hover:bg-zinc-50 transition-colors">
                                            <td className="px-8 py-6"><div className="flex items-center space-x-3"><div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center font-bold text-xs text-zinc-500">{s.student_name.charAt(0)}</div><div><div className="font-bold text-zinc-900 text-sm">{s.student_name}</div><div className="text-[10px] text-zinc-400 font-bold">{s.student_email}</div></div></div></td>
                                            <td className="px-8 py-6 text-sm font-bold text-zinc-500">{s.stats?.materialsViewed} viewed</td>
                                            <td className="px-8 py-6 text-sm font-bold text-zinc-500">{s.stats?.assignmentsCompleted}/8</td>
                                            <td className="px-8 py-6"><span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${s.stats?.isActive ? 'bg-green-100 text-green-600' : 'bg-zinc-100 text-zinc-400'}`}>{s.stats?.isActive ? 'Active' : 'Inactive'}</span></td>
                                            <td className="px-8 py-6"><button onClick={() => setSelectedStudent(s)} className="text-[10px] font-black uppercase tracking-widest text-purple-600 hover:text-purple-800 underline underline-offset-4">Profile</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )
                )}
            </div>
          ) : (
            <div className="space-y-12">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {[
                        { label: 'Avg Engagement', val: '78%', sub: '↑ 5% this week', color: 'card-blue' },
                        { label: 'Material Completion', val: '67%', sub: '45 Students total', color: 'card-orange' },
                        { label: 'On-Time Rate', val: '89%', sub: 'Good Standing', color: 'card-green' },
                        { label: 'Weekly Posts', val: '127', sub: 'Discussion Hub', color: 'card-pink' },
                    ].map((m, i) => (
                        <div key={i} className={`animate-fade-up p-8 rounded-[2.5rem] shadow-sm border border-black/5 flex flex-col justify-center h-44 ${m.color}`}>
                            <div className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-2">{m.label}</div>
                            <div className="text-5xl font-black tracking-tighter text-zinc-900">{m.val}</div>
                            <div className="text-[10px] font-bold mt-2 opacity-70">{m.sub}</div>
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                    <div className="animate-fade-up bg-white p-10 rounded-[3rem] border border-zinc-100 shadow-xl shadow-zinc-200/20"><div className="flex justify-between items-center mb-8"><h3 className="text-xl font-bold tracking-tight">Active Engagement</h3><div className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Active Students</div></div><div className="h-64 flex items-center justify-center"><canvas ref={chartRefs.engagement}></canvas></div></div>
                    <div className="animate-fade-up bg-white p-10 rounded-[3rem] border border-zinc-100 shadow-xl shadow-zinc-200/20"><div className="flex justify-between items-center mb-8"><h3 className="text-xl font-bold tracking-tight">Popular Materials</h3><div className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">View Counts</div></div><div className="h-64 flex items-center justify-center"><canvas ref={chartRefs.materials}></canvas></div></div>
                    <div className="animate-fade-up bg-white p-10 rounded-[3rem] border border-zinc-100 shadow-xl shadow-zinc-200/20"><div className="flex justify-between items-center mb-8"><h3 className="text-xl font-bold tracking-tight">Lab Completion</h3><div className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Global Status</div></div><div className="h-64 flex items-center justify-center"><canvas ref={chartRefs.completion}></canvas></div></div>
                    <div className="animate-fade-up bg-[#18181B] p-10 rounded-[3rem] shadow-2xl flex flex-col text-white"><div className="flex items-center space-x-3 mb-8"><div className="w-10 h-10 bg-purple-500 rounded-xl flex items-center justify-center text-xl">✨</div><h3 className="text-xl font-bold tracking-tight">AI Pedagogical Insights</h3></div><div className="space-y-4 flex-1">{aiInsights.map((insight, i) => (<div key={i} className="flex items-start space-x-3 p-4 bg-white/5 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors animate-fade-up" style={{ animationDelay: `${i * 100}ms` }}><div className="w-1.5 h-1.5 bg-purple-400 rounded-full mt-2 shrink-0"></div><p className="text-xs font-bold leading-relaxed text-zinc-300">{insight}</p></div>))}</div><div className="mt-8 pt-8 border-t border-white/10"><button className="text-[10px] font-black uppercase tracking-widest text-purple-400 hover:text-white transition-colors">Generate Weekly Report →</button></div></div>
                </div>
            </div>
          )}
        </section>
      </main>

      {selectedStudent && <StudentProfileModal student={selectedStudent} onClose={() => setSelectedStudent(null)} />}
    </div>
  );
};

export default StudentsAnalytics;
