
import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import AIAssistantModal from '../components/AIAssistantModal';
import AppSidebar from '../components/AppSidebar';
import { DashboardSkeleton } from '../components/Skeleton';
import { AppPath } from '../App';
import * as Icons from '../components/Icons';
import ThemeToggle from '../components/ThemeToggle';

interface TeacherDashboardProps {
  onBack: () => void;
  onLogout: () => void;
  onNavigateTo: (path: AppPath, params?: any) => void;
  currentPath: AppPath;
  onOpenNotifs: () => void;
}

const TeacherDashboard: React.FC<TeacherDashboardProps> = (props) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [stats, setStats] = useState({ atRisk: 0, pendingGrading: 0, classAverage: 'N/A', activeDiscussions: 0 });
  const [platformContext, setPlatformContext] = useState<string>('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString());
  const mainRef = useRef<HTMLElement>(null);
  const cardsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const fetchRealTimeStats = async () => {
    try {
      const [
        { count: studentCount },
        { data: materials },
        { data: interactions },
        { data: allStudents },
        { data: assignments }
      ] = await Promise.all([
        supabase.from('students').select('*', { count: 'exact', head: true }),
        supabase.from('instructional_materials').select('title, topic, location_url, created_at, file_type'),
        supabase.from('student_assignment_logs').select('student_id, assignment_id, interaction_type, submission_content, timestamp, grade, feedback'),
        supabase.from('students').select('id, student_name, student_email, created_at'),
        supabase.from('assignments').select('id, assignment_name, rubric, due_date')
      ]);

      const submissions = (interactions || []).filter(i => i.interaction_type === 'submission');
      const discussionsCount = (interactions || []).filter(i => i.interaction_type === 'discussion_post').length;

      let atRiskCount = 0;
      let pendingGradingCount = submissions.filter(sub => sub.grade === null || sub.grade === undefined).length;

      let totalGrades = 0;
      let gradedCount = 0;

      // Compute Detailed Student Standing Knowledge
      const studentMap = (allStudents || []).map(s => {
        const studentSubs = submissions.filter(sub => sub.student_id === s.id);
        const grades = studentSubs.map(sub => sub.grade).filter(g => g !== null && g !== undefined);
        const avgGrade = grades.length > 0 ? (grades.reduce((a, b: any) => a + b, 0) / grades.length) : null;

        if (avgGrade !== null) {
          totalGrades += avgGrade;
          gradedCount++;
        }

        if (avgGrade !== null && avgGrade < 70) atRiskCount++;

        const activeLogs = (interactions || []).filter(i => i.student_id === s.id).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const lastActivityMatch = activeLogs[0];

        return {
          name: s.student_name,
          email: s.student_email,
          submission_count: studentSubs.length,
          average_grade: avgGrade !== null ? avgGrade.toFixed(1) : 'N/A',
          last_activity: lastActivityMatch?.timestamp || 'Never'
        };
      });

      const globalAverage = gradedCount > 0 ? (totalGrades / gradedCount).toFixed(1) + '%' : 'N/A';

      setStats({
        atRisk: atRiskCount,
        pendingGrading: pendingGradingCount,
        classAverage: globalAverage,
        activeDiscussions: discussionsCount
      });

      // Compute Course Content Knowledge
      const courseInventory = {
        materials: (materials || []).filter(m => m.file_type !== 'folder_meta').map(m => ({ title: m.title, topic: m.topic, added: m.created_at })),
        assignments: (assignments || []).map(a => ({ name: a.assignment_name, rubric: a.rubric, due: a.due_date }))
      };

      setPlatformContext(`
        # EDUCONNECT_AI_TRUTH_SOURCE
        # HUB_SYNC_TIME: ${new Date().toISOString()}
        # DATA_CURRENCY: REAL_TIME
        
        ## ENVIRONMENT_METRICS
        - TOTAL_ENROLLED_STUDENTS: ${studentCount || 0}
        - ASSETS_IN_HUB: ${materials?.length || 0}
        - TOTAL_SUBMISSIONS_RECORDED: ${submissions.length || 0}

        ## STUDENT_REGISTRY_AND_STANDING (Schema: Name, Email, Avg_Grade, Status)
        ${JSON.stringify(studentMap, null, 2)}

        ## CURRICULUM_INVENTORY
        ${JSON.stringify(courseInventory, null, 2)}
        
        ## LATEST_TELEMETRY (Interaction Stream)
        ${JSON.stringify((interactions || []).slice(0, 20), null, 2)}
      `);

      setLastSyncTime(new Date().toLocaleTimeString());

    } catch (err) {
      console.warn("Comprehensive stats sync failed:", err);
    }
  };

  useEffect(() => {
    const initData = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { props.onLogout(); return; }
        setUserProfile(session.user);
        await fetchRealTimeStats();
        setLoading(false);
      } catch (err) {
        setLoading(false);
      }
    };
    initData();

    const channel = supabase.channel('dashboard_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'student_assignment_logs' }, fetchRealTimeStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'instructional_materials' }, fetchRealTimeStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, fetchRealTimeStats)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!loading) {
      const ctx = gsap.context(() => {
        gsap.from(".dashboard-stagger", {
          y: 30,
          opacity: 0,
          stagger: 0.08,
          duration: 0.8,
          ease: "expo.out",
          clearProps: "all"
        });

        cardsRef.current.forEach((card) => {
          if (!card) return;
          card.addEventListener('mouseenter', () => {
            gsap.to(card, { scale: 1.03, y: -10, duration: 0.5, ease: "power4.out" });
            gsap.to(card.querySelector('.card-glow'), { opacity: 1, scale: 1.2, duration: 0.6 });
            gsap.to(card.querySelector('.card-icon-container'), { rotate: -5, duration: 0.4 });
          });
          card.addEventListener('mouseleave', () => {
            gsap.to(card, { scale: 1, y: 0, duration: 0.6, ease: "power4.inOut" });
            gsap.to(card.querySelector('.card-glow'), { opacity: 0, scale: 1, duration: 0.6 });
            gsap.to(card.querySelector('.card-icon-container'), { rotate: 0, duration: 0.4 });
          });
        });
      }, mainRef);
      return () => ctx.revert();
    }
  }, [loading]);

  const avatarUrl = userProfile?.user_metadata?.avatar_url || userProfile?.user_metadata?.picture;
  const initial = userProfile?.user_metadata?.full_name?.charAt(0) || 'P';

  return (
    <div className="flex h-screen bg-[var(--bg-main)] overflow-hidden font-['Plus_Jakarta_Sans'] transition-colors duration-500 relative">
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--brand-primary)]/5 via-transparent to-[var(--brand-secondary)]/5 pointer-events-none"></div>

      <AppSidebar
        role="teacher"
        onNavigateTo={props.onNavigateTo}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        onLogout={props.onLogout}
      />

      <AIAssistantModal
        isOpen={aiAssistantOpen}
        onClose={() => setAiAssistantOpen(false)}
        teacherName={userProfile?.user_metadata?.full_name || 'Professor'}
        platformContext={platformContext}
      />

      <button
        onClick={() => setAiAssistantOpen(true)}
        className="fixed bottom-12 right-12 z-[100] w-20 h-20 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-[2.2rem] shadow-[0_20px_50px_rgba(0,0,0,0.2)] dark:shadow-[0_20px_50px_rgba(255,255,255,0.1)] flex items-center justify-center transition-all hover:scale-110 active:scale-95 group overflow-hidden border-4 border-white/20"
      >
        <div className="absolute inset-0 bg-gradient-to-tr from-cyan-400/20 to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
        <Icons.IconBot className="w-10 h-10 relative z-10" />
        <div className="absolute -top-14 right-0 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[10px] font-black uppercase tracking-widest px-5 py-2 rounded-2xl opacity-0 group-hover:opacity-100 transition-all pointer-events-none whitespace-nowrap translate-y-2 group-hover:translate-y-0 shadow-2xl">
          Global Command Center
        </div>
      </button>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="h-20 bg-[var(--bg-card)] border-b-2 border-[var(--border-primary)] flex items-center justify-between px-12 shrink-0 z-40 shadow-sm">
          <div className="flex items-center space-x-6">
            <button onClick={props.onBack} className="w-11 h-11 rounded-2xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center text-zinc-500 transition-all">←</button>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter font-['Space_Grotesk'] uppercase">Control Nexus</h1>
          </div>
          <div className="flex items-center space-x-6">
            <ThemeToggle />
            <div className="hidden md:flex items-center px-5 py-2.5 bg-emerald-500/[0.08] dark:bg-emerald-500/10 border border-emerald-500/10 dark:border-emerald-500/20 rounded-2xl">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse mr-3"></span>
              <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">System Operational • Sync: {lastSyncTime}</span>
            </div>
            <button onClick={props.onOpenNotifs} className="relative p-2.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
              <svg className="w-6.5 h-6.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
              <span className="absolute top-2 right-2 w-3 h-3 bg-red-500 rounded-full border-2 border-white dark:border-navy-900"></span>
            </button>
            <button onClick={() => setProfileOpen(!profileOpen)} className="w-13 h-13 bg-zinc-900 dark:bg-white rounded-2.5xl flex items-center justify-center text-white dark:text-zinc-900 font-black shadow-xl border-2 border-transparent dark:border-white/10 overflow-hidden hover:scale-105 active:scale-95 transition-all">
              {avatarUrl ? <img src={avatarUrl} alt="P" className="w-full h-full object-cover" /> : <span className="text-lg">{initial}</span>}
            </button>
          </div>
        </header>

        {loading ? (
          <DashboardSkeleton role="teacher" />
        ) : (
          <main ref={mainRef} className="flex-1 overflow-y-auto p-12 lg:p-20 scroll-smooth scrollbar-hide relative z-10">
            <div className="dashboard-stagger mb-20">
              <div className="inline-flex items-center space-x-3 px-4 py-1.5 rounded-full bg-indigo-500/[0.08] dark:bg-white/5 text-indigo-600 dark:text-indigo-400 text-[11px] font-black uppercase tracking-[0.15em] mb-8 border border-indigo-500/10 dark:border-white/10">
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-ping"></span>
                <span>Section 001 • Spring 2026</span>
              </div>
              <h1 className="text-7xl lg:text-8xl font-black mb-6 tracking-tighter font-['Space_Grotesk'] leading-[0.9] bg-gradient-to-r from-indigo-600 via-violet-600 to-pink-500 bg-clip-text text-transparent dark:from-indigo-400 dark:to-cyan-400">Hub Intelligence</h1>
              <p className="text-2xl text-slate-500 dark:text-zinc-400 font-medium max-w-3xl leading-relaxed">Central orchestration for course materials, student growth trajectories, and predictive pedagogical analysis.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-24">
              {[
                { label: "Struggling Students", val: stats.atRisk, Icon: Icons.IconTrending, path: "teacher-grading", filter: 'struggling', color: 'var(--color-danger)', bg: 'var(--color-danger-bg)' },
                { label: "Assessments to Grade", val: stats.pendingGrading, Icon: Icons.IconCheck, path: "teacher-grading", filter: 'pending', color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
                { label: "Class Average", val: stats.classAverage, Icon: Icons.IconChart, path: "teacher-analytics", color: 'var(--color-info)', bg: 'var(--color-info-bg)' },
                { label: "Unread Discussions", val: stats.activeDiscussions, Icon: Icons.IconChat, path: "teacher-discussions", color: 'var(--color-success)', bg: 'var(--color-success-bg)' },
              ].map((stat, i) => (
                <button
                  key={i}
                  onClick={() => props.onNavigateTo(stat.path as AppPath, { filter: stat.filter })}
                  className="dashboard-stagger ui-card text-left p-10 flex flex-col justify-center h-64 relative group hover:-translate-y-2 !rounded-[3rem] transition-all border-none"
                  style={{ backgroundColor: stat.bg }}
                >
                  <div className="absolute top-8 right-8 flex items-center space-x-2 px-3 py-1 bg-white/50 dark:bg-black/20 backdrop-blur-md rounded-full border border-black/5 dark:border-white/5">
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse shadow-sm" style={{ backgroundColor: stat.color }}></span>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: stat.color }}>Live</span>
                  </div>

                  <div className="card-icon-container w-16 h-16 rounded-3xl mb-8 flex items-center justify-center bg-white dark:bg-white/10 shadow-lg shadow-black/[0.03] border border-black/[0.04]">
                    <stat.Icon className="w-8 h-8" style={{ color: stat.color }} />
                  </div>
                  <div className={`absolute -right-6 -bottom-6 opacity-[0.06] dark:opacity-[0.08] group-hover:opacity-[0.15] transition-opacity duration-700`}>
                    <stat.Icon className="w-36 h-36" />
                  </div>
                  <h3 className="text-[11px] font-black text-slate-500 dark:text-zinc-500 uppercase tracking-[0.25em] mb-3">{stat.label}</h3>
                  <div className="flex items-baseline space-x-4">
                    <span className="text-6xl font-black text-slate-900 dark:text-white tracking-tighter" style={{ color: stat.color }}>{stat.val}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="dashboard-stagger space-y-12 pb-32">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-black/[0.04] dark:border-white/5 pb-8">
                <div>
                  <h3 className="text-4xl font-black text-[var(--text-primary)] tracking-tight font-['Space_Grotesk'] uppercase">Nexus System</h3>
                  <p className="text-[var(--text-muted)] text-lg font-bold mt-2">Operational modules for advanced instruction.</p>
                </div>
                <button onClick={() => setAiAssistantOpen(true)} className="flex items-center space-x-4 px-10 py-5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-[2rem] font-black text-[11px] uppercase tracking-[0.2em] shadow-[0_15px_40px_rgba(0,0,0,0.2)] hover:scale-[1.03] active:scale-[0.97] transition-all">
                  <Icons.IconBot className="w-5 h-5" /> <span>Invoke Intelligence</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {[
                  { id: "upload", Icon: Icons.IconUpload, title: "Asset Hub", desc: "Manage instructional repository and cloud lecture sync.", style: "card-macaron-blue", glow: "bg-blue-400" },
                  { id: "assignments", Icon: Icons.IconDraft, title: "Lab Architect", desc: "Design high-fidelity technical data assignments.", style: "card-macaron-purple", glow: "bg-purple-400" },
                  { id: "grading", Icon: Icons.IconCheck, title: "Evaluation Nexus", desc: "Predictive analysis, AI grading, and risk trajectory.", style: "card-macaron-orange", glow: "bg-amber-400" },
                  { id: "analytics", Icon: Icons.IconChart, title: "Insights Hub", desc: "Global behavioral analytics and engagement trends.", style: "card-macaron-green", glow: "bg-emerald-400" },
                  { id: "persona", Icon: Icons.IconPalette, title: "AI Persona", desc: "Fine-tune behavioral logic for student assistants.", style: "card-macaron-blue", glow: "bg-cyan-400" },
                  { id: "discussions", Icon: Icons.IconChat, title: "Forum Matrix", desc: "Moderate student peer discussions and forums.", style: "card-macaron-pink", glow: "bg-pink-400" },
                ].map((action, idx) => (
                  <button
                    key={action.id}
                    ref={el => { cardsRef.current[idx] = el; }}
                    onClick={() => props.onNavigateTo(`teacher-${action.id}` as AppPath)}
                    className={`relative p-12 ${action.style} rounded-[4rem] border-2 text-left overflow-hidden group h-80 flex flex-col justify-between shadow-sm dark:shadow-none transition-all duration-500`}
                  >
                    <div className={`card-glow absolute -top-32 -right-32 w-64 h-64 ${action.glow} rounded-full blur-[110px] opacity-0 transition-all duration-700`}></div>

                    <div className="card-icon-container w-20 h-20 bg-white/60 dark:bg-white/10 rounded-[2.2rem] flex items-center justify-center text-current transition-all shadow-sm border border-white/20">
                      <action.Icon className="w-10 h-10" />
                    </div>

                    <div>
                      <h4 className="text-3xl font-black tracking-tight mb-3 uppercase font-['Space_Grotesk'] leading-none">{action.title}</h4>
                      <p className="opacity-70 dark:text-zinc-400 text-sm font-bold leading-relaxed max-w-[90%]">{action.desc}</p>
                    </div>

                    <div className="absolute bottom-12 right-12 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 translate-x-8 transition-all duration-500">
                      <span className="text-3xl">→</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </main>
        )}
      </div>
    </div>
  );
};

export default TeacherDashboard;
