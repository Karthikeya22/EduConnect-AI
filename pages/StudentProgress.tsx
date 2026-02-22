
import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import { ProgressSkeleton } from '../components/Skeleton';

interface StudentProgressProps {
  onBack: () => void;
  onNavigateDashboard: () => void;
  onNavigateMaterials: () => void;
  onNavigateProgress: () => void;
}

interface PerformanceStats {
  overallProgress: number;
  assignmentsSubmitted: number;
  totalAssignments: number;
  discussionPosts: number;
  materialsViewed: number;
  totalMaterials: number;
  completedOnTime: number;
  completedLate: number;
  pending: number;
}

const StudentProgress: React.FC<StudentProgressProps> = ({ onBack, onNavigateDashboard, onNavigateMaterials, onNavigateProgress }) => {
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [stats, setStats] = useState<PerformanceStats>({ overallProgress: 0, assignmentsSubmitted: 0, totalAssignments: 0, discussionPosts: 0, materialsViewed: 0, totalMaterials: 0, completedOnTime: 0, completedLate: 0, pending: 0 });
  const [assignments, setAssignments] = useState<any[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserProfile(session.user);
      const { data: allMaterials } = await supabase.from('instructional_materials').select('*');
      const { data: views } = await supabase.from('student_learning_activities').select('target_id, topic').eq('student_id', session.user.id);
      const { data: allAssignments } = await supabase.from('assignments').select('*').order('due_date', { ascending: true });
      const { data: submissions } = await supabase.from('student_assignment_logs').select('*').eq('student_id', session.user.id);
      
      const doneA = (submissions || []).filter(s => s.interaction_type === 'submission').length;
      const totalA = allAssignments?.length || 0;
      const progress = totalA > 0 ? Math.round((doneA / totalA) * 100) : 0;
      
      setStats({
        ...stats, 
        overallProgress: progress, 
        assignmentsSubmitted: doneA, 
        totalAssignments: totalA,
        totalMaterials: allMaterials?.length || 0,
        materialsViewed: views?.length || 0,
      });

      setAssignments(allAssignments?.map(a => {
        const sub = submissions?.find(s => s.assignment_id === a.id);
        return { ...a, submission: sub };
      }) || []);

    } catch (err) { 
      console.error(err);
    } finally { 
      setTimeout(() => setLoading(false), 800);
    }
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] overflow-hidden relative font-['Plus_Jakarta_Sans']">
      <aside className={`bg-[#0F172A] text-white transition-all duration-300 flex flex-col shadow-2xl relative z-50 ${sidebarCollapsed ? 'w-[72px]' : 'w-[260px]'}`}>
        <div className="h-16 flex items-center px-6 border-b border-white/10 shrink-0"><div className="w-8 h-8 bg-cyan-50 rounded-lg flex items-center justify-center font-bold text-navy-900 shrink-0 shadow-lg">USF</div>{!sidebarCollapsed && <span className="ml-3 font-bold text-lg">Academic Node</span>}</div>
        <nav className="flex-1 py-6">
          <button onClick={onBack} className="w-full flex items-center px-6 py-4 transition-all hover:bg-white/5 border-l-4 border-transparent group">
            <span className="text-xl group-hover:scale-110 transition-transform">←</span>
            {!sidebarCollapsed && <span className="ml-4 font-bold text-sm">Dashboard</span>}
          </button>
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="h-20 bg-white border-b flex items-center justify-between px-12 shrink-0 z-10">
          <div className="flex items-center space-x-4">
             <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-zinc-50 flex items-center justify-center text-zinc-400 transition-colors">←</button>
             <h1 className="text-2xl font-black text-zinc-900 tracking-tighter bg-gradient-to-r from-cyan-600 to-purple-600 bg-clip-text text-transparent uppercase font-['Space_Grotesk']">Learning Ledger</h1>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-12 bg-[#F8FAFC] scroll-smooth">
           {loading ? (
             <ProgressSkeleton />
           ) : (
             <div className="max-w-[1200px] mx-auto space-y-12 animate-fade-in">
                <div className="bg-white p-12 rounded-[3.5rem] border shadow-2xl shadow-cyan-900/5 flex flex-col md:flex-row items-center gap-12 relative overflow-hidden">
                   <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-50 rounded-full blur-[100px] opacity-50 -translate-y-1/2 translate-x-1/2"></div>
                   <div className="relative w-40 h-40 shrink-0">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="40" fill="none" stroke="#F1F5F9" strokeWidth="10" />
                        <circle cx="50" cy="50" r="40" fill="none" stroke="#06B6D4" strokeWidth="10" strokeDasharray="251.2" strokeDashoffset={251.2 * (1 - stats.overallProgress / 100)} strokeLinecap="round" className="transition-all duration-1000 ease-out" />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center font-black text-4xl tracking-tighter text-zinc-900">{stats.overallProgress}%</div>
                   </div>
                   <div className="flex-1 relative z-10 text-center md:text-left">
                      <h2 className="text-4xl font-black text-zinc-900 mb-2 tracking-tight font-['Space_Grotesk']">Academic Mastery</h2>
                      <p className="text-zinc-500 font-bold text-lg mb-6">Comprehensive course participation audit for BIG_DATA_2026.</p>
                      <div className="flex flex-wrap justify-center md:justify-start gap-4">
                        <div className="px-5 py-2.5 bg-zinc-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest">Active Participant</div>
                        <div className="px-5 py-2.5 bg-cyan-50 text-cyan-600 border border-cyan-100 rounded-2xl text-[10px] font-black uppercase tracking-widest">On Track</div>
                      </div>
                   </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                   {[
                     { label: 'Labs Submitted', val: stats.assignmentsSubmitted, total: stats.totalAssignments, icon: '🧪', color: 'card-blue' },
                     { label: 'Materials Read', val: stats.materialsViewed, total: stats.totalMaterials, icon: '📚', color: 'card-orange' },
                     { label: 'Forum Velocity', val: 'High', total: '', icon: '💬', color: 'card-green' },
                   ].map((item, i) => (
                     <div key={i} className={`p-10 rounded-[3rem] border border-black/5 shadow-xl flex flex-col justify-center h-52 relative overflow-hidden group ${item.color}`}>
                        <div className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-4">{item.label}</div>
                        <div className="text-6xl font-black tracking-tighter">{item.val}{item.total && <span className="text-xl opacity-40 ml-1">/ {item.total}</span>}</div>
                        <div className="absolute -right-4 -bottom-4 text-8xl opacity-10 group-hover:scale-110 transition-transform duration-500">{item.icon}</div>
                     </div>
                   ))}
                </div>

                <div className="bg-white rounded-[3.5rem] border border-zinc-100 shadow-xl overflow-hidden">
                   <div className="p-10 border-b border-zinc-50 flex justify-between items-center">
                     <h3 className="text-xl font-black tracking-tight font-['Space_Grotesk'] uppercase">Assignment Ledger</h3>
                     <span className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">{assignments.length} Records</span>
                   </div>
                   <div className="divide-y divide-zinc-50">
                      {assignments.map((a, i) => (
                        <div key={i} className="p-8 hover:bg-zinc-50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-6">
                           <div className="flex items-center space-x-6">
                              <div className="w-14 h-14 bg-zinc-50 rounded-2xl flex items-center justify-center text-2xl shadow-sm border border-zinc-100">{a.assignment_type === 'discussion' ? '💬' : '🧪'}</div>
                              <div>
                                 <h4 className="font-black text-zinc-900 leading-tight">{a.assignment_name}</h4>
                                 <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mt-1">{a.topic}</p>
                              </div>
                           </div>
                           <div className="flex items-center gap-8">
                              <div className="text-right">
                                 <div className="text-[10px] font-black text-zinc-400 uppercase mb-1">Status</div>
                                 <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${a.submission ? 'bg-green-100 text-green-600' : 'bg-zinc-100 text-zinc-400'}`}>
                                    {a.submission ? 'Synchronized' : 'Pending'}
                                 </span>
                              </div>
                              <button className="h-12 px-6 border-2 border-zinc-100 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:border-zinc-900 hover:text-zinc-900 transition-all">Audit Data</button>
                           </div>
                        </div>
                      ))}
                   </div>
                </div>
             </div>
           )}
        </main>
      </div>
      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        @keyframes shimmer { 100% { transform: translateX(100%); } }
      `}</style>
    </div>
  );
};

export default StudentProgress;
