
import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '@/src/lib/supabase';
import AppSidebar from '@/src/components/layout/AppSidebar';
import { DashboardSkeleton } from '@/src/components/ui/Skeleton';
import { AppPath } from '../../App';
import * as Icons from '../ui/Icons';

interface StudentDashboardProps {
  onBack: () => void;
  onLogout: () => void;
  onSelectAssignment: (id: string, type: string) => void;
  onNavigateMaterials: () => void;
  onNavigateProgress: () => void;
  onNavigateDashboard: () => void;
  onNavigateLab: () => void;
  onNavigatePeerReview: () => void;
  onOpenNotifs: () => void;
  onNavigateTo: (path: AppPath) => void;
}

const StudentDashboard: React.FC<StudentDashboardProps> = (props) => {
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [stats, setStats] = useState({ completionRate: 0, assignmentsDone: 0, totalAssignments: 0, materialsViewed: 0, totalMaterials: 0 });
  const [assignments, setAssignments] = useState<any[]>([]);
  const [badges, setBadges] = useState<any[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  const fetchAllData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { props.onLogout(); return; }
      setUserProfile(session.user);

      const { data: allMaterials } = await supabase.from('instructional_materials').select('*');
      const { data: viewedLogs } = await supabase.from('student_learning_activities').select('target_id, topic').eq('student_id', session.user.id);
      const { data: allAssignments } = await supabase.from('assignments').select('*').order('due_date', { ascending: true });
      const { data: submissionLogs } = await supabase.from('student_assignment_logs').select('assignment_id').eq('student_id', session.user.id);

      const viewedSet = new Set(viewedLogs?.map(l => l.target_id) || []);
      const submittedSet = new Set(submissionLogs?.map(l => l.assignment_id) || []);

      setAssignments(allAssignments?.map(a => ({ ...a, isSubmitted: submittedSet.has(a.id) })) || []);

      const totalItems = (allMaterials?.length || 0) + (allAssignments?.length || 0);
      const doneItems = viewedSet.size + submittedSet.size;

      setStats({
        completionRate: totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0,
        assignmentsDone: submittedSet.size,
        totalAssignments: allAssignments?.length || 0,
        materialsViewed: viewedSet.size,
        totalMaterials: allMaterials?.length || 0
      });

      // Calculate Real-Time Badges based on topic completion
      const topicProgress = (allMaterials || []).reduce((acc: any, curr) => {
        if (!acc[curr.topic]) acc[curr.topic] = { total: 0, viewed: 0 };
        acc[curr.topic].total++;
        if (viewedSet.has(curr.id)) acc[curr.topic].viewed++;
        return acc;
      }, {});

      const liveBadges = [
        { label: "MapReduce Master", Icon: Icons.IconBrain, color: "bg-purple-100", topic: "MapReduce", done: (topicProgress["MapReduce"]?.viewed >= topicProgress["MapReduce"]?.total) && topicProgress["MapReduce"]?.total > 0 },
        { label: "Visualization Guru", Icon: Icons.IconPalette, color: "bg-cyan-100", topic: "D3.js", done: (topicProgress["D3.js"]?.viewed >= topicProgress["D3.js"]?.total) && topicProgress["D3.js"]?.total > 0 },
        { label: "Data Janitor", Icon: Icons.IconLab, color: "bg-zinc-100", topic: "JSON", done: (topicProgress["JSON"]?.viewed >= topicProgress["JSON"]?.total) && topicProgress["JSON"]?.total > 0 },
      ];
      setBadges(liveBadges);

    } catch (err) {
      console.warn("Real-time ledger sync restricted.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();

    // Subscribe to student's own activity for instant dashboard feedback
    const channel = supabase.channel('student_dashboard_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'student_assignment_logs' }, () => fetchAllData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'student_learning_activities' }, () => fetchAllData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!loading) {
      const ctx = gsap.context(() => {
        gsap.from(".stagger-item", {
          opacity: 0,
          y: 40,
          stagger: { amount: 0.8, ease: "power2.out" },
          duration: 1.2,
          ease: "expo.out",
          clearProps: "all"
        });
      }, mainRef);
      return () => ctx.revert();
    }
  }, [loading]);

  return (
    <div className="flex h-screen bg-[var(--bg-main)] overflow-hidden relative font-['Plus_Jakarta_Sans'] transition-colors duration-500">
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--brand-primary)]/5 via-transparent to-[var(--brand-secondary)]/5 pointer-events-none"></div>

      <AppSidebar
        role="student"
        currentPath="student-dashboard"
        onNavigateTo={props.onNavigateTo}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        onLogout={props.onLogout}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="h-20 bg-[var(--bg-card)] border-b-2 border-[var(--border-primary)] flex items-center justify-between px-12 shrink-0 z-40 shadow-sm">
          <div className="flex items-center space-x-6">
            <button onClick={props.onBack} className="w-10 h-10 rounded-full hover:bg-zinc-50 flex items-center justify-center text-zinc-400 transition-colors">←</button>
            <div className="hidden md:flex items-center px-6 h-12 bg-zinc-50 rounded-2xl border border-zinc-100 w-80">
              <span className="text-zinc-400 mr-3">🔍</span>
              <input type="text" placeholder="Search system database..." className="bg-transparent border-none outline-none text-xs w-full font-bold text-zinc-600" />
            </div>
          </div>
          <div className="flex items-center space-x-8">
            <button onClick={props.onOpenNotifs} className="relative p-2 text-zinc-400 hover:text-cyan-600 transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
              <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-cyan-500 rounded-full border-2 border-white animate-pulse"></span>
            </button>
            <button onClick={() => setProfileOpen(!profileOpen)} className="w-13 h-13 bg-[var(--text-primary)] rounded-2xl flex items-center justify-center font-black text-white shadow-xl hover:scale-105 transition-all">{userProfile?.user_metadata?.full_name?.charAt(0) || 'S'}</button>
            {profileOpen && (
              <div className="absolute right-12 top-20 w-64 bg-[var(--bg-card)] rounded-[2rem] shadow-[var(--shadow-xl)] border-2 border-[var(--border-primary)] p-3 z-50 animate-pop-in">
                <button onClick={props.onLogout} className="w-full px-4 py-3 text-left text-[11px] font-bold text-red-600 hover:bg-red-50 rounded-xl flex items-center space-x-3 mt-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg><span>Sign Out</span></button>
              </div>
            )}
          </div>
        </header>

        {loading ? (
          <DashboardSkeleton role="student" />
        ) : (
          <main ref={mainRef} className="flex-1 overflow-y-auto p-12 scroll-smooth">
            <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12">
              <div className="lg:col-span-8 space-y-12">
                <div className="stagger-item">
                  <h1 className="text-5xl font-black text-zinc-900 mb-2 tracking-tighter font-['Space_Grotesk'] leading-none">Hello, {userProfile?.user_metadata?.full_name?.split(' ')[0] || 'Student'}!</h1>
                  <p className="text-xl text-zinc-500 font-bold">Your Big Data trajectory is looking sharp. All systems synchronized.</p>
                </div>

                <div className="stagger-item grid grid-cols-1 md:grid-cols-2 gap-8">
                  <button onClick={props.onNavigatePeerReview} className="ui-card p-10 group hover:border-[var(--brand-primary)] text-left flex flex-col">
                    <div className="w-16 h-16 bg-[var(--brand-primary)]/10 rounded-2.5xl flex items-center justify-center mb-10 group-hover:scale-110 transition-transform"><Icons.IconUsers className="w-10 h-10 text-[var(--brand-primary)]" /></div>
                    <h3 className="text-3xl font-black text-[var(--text-primary)] mb-3 tracking-tight font-['Space_Grotesk'] uppercase leading-none">Peer Review</h3>
                    <p className="text-[var(--text-muted)] font-bold leading-relaxed">Collaborate and critique peer visualizations to earn Hub points.</p>
                  </button>
                  <button onClick={props.onNavigateLab} className="bg-[#0F172A] p-10 rounded-[2.5rem] shadow-2xl group text-left border-4 border-white/5">
                    <div className="w-16 h-16 bg-white/10 rounded-2.5xl flex items-center justify-center mb-10 group-hover:scale-110 transition-transform"><Icons.IconLab className="w-10 h-10 text-cyan-400" /></div>
                    <h3 className="text-3xl font-black text-white mb-3 tracking-tight font-['Space_Grotesk'] uppercase leading-none">Data Sandbox</h3>
                    <p className="text-zinc-400 font-bold leading-relaxed">Test your JSON/CSV schema with AI-driven insights.</p>
                  </button>
                </div>

                <div className="stagger-item">
                  <h2 className="text-3xl font-black text-zinc-900 tracking-tight mb-8 font-['Space_Grotesk'] uppercase">Active Labs</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {assignments.length > 0 ? assignments.map((a) => (
                      <div key={a.id} onClick={() => props.onSelectAssignment(a.id, a.assignment_type)} className="ui-card p-8 hover:shadow-[var(--shadow-xl)] hover:-translate-y-1 transition-all cursor-pointer group flex flex-col justify-between h-72">
                        <div className="flex justify-between items-start">
                          <div className="p-4 bg-[var(--bg-nested)] border border-[var(--border-primary)] rounded-2xl">{a.assignment_type === 'discussion' ? <Icons.IconChat className="w-7 h-7 text-[var(--text-secondary)]" /> : <Icons.IconDraft className="w-7 h-7 text-[var(--text-secondary)]" />}</div>
                          <span className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.15em] border-2 ${a.isSubmitted ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>{a.isSubmitted ? 'Synchronized' : 'Required'}</span>
                        </div>
                        <div>
                          <h3 className="text-2xl font-black text-[var(--text-primary)] mb-2 tracking-tight font-['Space_Grotesk'] leading-none group-hover:text-[var(--brand-primary)] transition-colors line-clamp-2">{a.assignment_name}</h3>
                          <p className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Topic: {a.topic}</p>
                        </div>
                        <div className="pt-6 border-t-2 border-[var(--bg-nested)] flex items-center justify-between">
                          <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-wider">Due {a.due_date ? new Date(a.due_date).toLocaleDateString() : 'TBD'}</span>
                          <span className="text-[var(--brand-primary)] font-black text-[10px] uppercase tracking-widest">Open Hub →</span>
                        </div>
                      </div>
                    )) : (
                      <div className="col-span-full py-16 text-center bg-white rounded-[3rem] border border-dashed border-zinc-200"><p className="text-xs font-bold text-zinc-400 uppercase tracking-[0.2em]">No assignments detected in ledger</p></div>
                    )}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-4 space-y-12">
                <div className="stagger-item bg-white p-10 rounded-[3rem] border border-zinc-100 shadow-xl">
                  <h3 className="text-xl font-bold mb-8 flex items-center"><Icons.IconTrophy className="w-6 h-6 mr-3 text-cyan-600" /> Knowledge Ledger</h3>
                  <div className="space-y-6">
                    {badges.map((badge, i) => (
                      <div key={i} className={`flex items-center space-x-5 p-4 rounded-[2rem] border transition-all ${badge.done ? 'bg-white border-zinc-100' : 'bg-zinc-50 border-transparent opacity-50'}`}>
                        <div className={`w-14 h-14 ${badge.color} rounded-2xl flex items-center justify-center shadow-sm`}><badge.Icon className="w-6 h-6 text-zinc-900" /></div>
                        <div>
                          <div className="font-black text-zinc-900 text-sm tracking-tight">{badge.label}</div>
                          <div className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mt-1">{badge.done ? 'Requirement Met' : 'Topic Incomplete'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="stagger-item bg-cyan-600 p-10 rounded-[3rem] shadow-2xl text-white">
                  <h3 className="text-xl font-bold mb-4">Course Progress</h3>
                  <div className="text-6xl font-black tracking-tighter mb-4">{stats.completionRate}%</div>
                  <div className="h-3 bg-white/20 rounded-full overflow-hidden mb-6"><div className="h-full bg-white rounded-full transition-all duration-1000" style={{ width: `${stats.completionRate}%` }}></div></div>
                  <button onClick={props.onNavigateProgress} className="w-full h-14 bg-white text-cyan-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all">Audit My Data</button>
                </div>
              </div>
            </div>
          </main>
        )}
      </div>
      <style>{`
        @keyframes pop-in { from { transform: scale(0.9) opacity: 0; } to { transform: scale(1) opacity: 1; } }
        .animate-pop-in { animation: pop-in 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
};

export default StudentDashboard;



