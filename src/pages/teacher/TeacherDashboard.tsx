
import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '@/src/lib/supabase';
import AIAssistantModal from '@/src/components/modals/AIAssistantModal';
import AppSidebar from '@/src/components/layout/AppSidebar';
import { DashboardSkeleton } from '@/src/components/ui/Skeleton';
import { AppPath } from '@/src/App';
import * as Icons from '@/src/components/ui/Icons';
import ThemeToggle from '@/src/components/ui/ThemeToggle';
import { canvasAPI } from '@/src/services/canvasAPI';

interface Course {
  id: number;
  name: string;
  course_code: string;
}

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
  const [snoozedTasks, setSnoozedTasks] = useState<Set<string>>(new Set());

  // Global active course handling
  const [activeCourse, setActiveCourse] = useState<Course | null>(null);

  useEffect(() => {
    const rawCourse = localStorage.getItem('active_canvas_course');
    if (!rawCourse) {
      props.onNavigateTo('teacher-select-course');
    } else {
      const parsed = JSON.parse(rawCourse);
      setActiveCourse(parsed);
      fetchRealTimeStats(parsed.id.toString());
    }
  }, []);

  const [stats, setStats] = useState({
    materialsCount: 0,
    assignmentsCount: 0,
    discussionsCount: 0,
    activeStudentsCount: 0,
    noSubmissionCount: 0,
    below70Count: 0,
    upcomingTasks: [] as any[],
  });

  const [platformContext, setPlatformContext] = useState<string>('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString());
  const [canvasStats, setCanvasStats] = useState<{
    pendingGrades: number;
    ungradedAssignments: number;
    ungradedDiscussions: number;
    recentSubmissions: any[];
  }>({
    pendingGrades: 0,
    ungradedAssignments: 0,
    ungradedDiscussions: 0,
    recentSubmissions: []
  });
  const mainRef = useRef<HTMLElement>(null);

  const fetchRealTimeStats = async (courseId: string) => {
    try {
      // Fetch Canvas Dashboard Data strictly for the active course
      try {
        const data = await canvasAPI.getDashboardStats(courseId);

        const todoArray = Array.isArray(data.todo) ? data.todo : [];
        const recentArray = Array.isArray(data.recentSubmissions) ? data.recentSubmissions : [];

        let totalTodo = todoArray.map((t: any) => ({ ...t, courseName: activeCourse?.name || 'Canvas Course' }));
        let totalRecent = recentArray.map((s: any) => ({ ...s, courseName: activeCourse?.name || 'Canvas Course' }));

        totalRecent.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
        const topRecent = totalRecent.slice(0, 10);

        setCanvasStats({
          pendingGrades: totalTodo.length,
          ungradedAssignments: totalTodo.filter((t: any) => t.assignment?.submission_types?.includes('online_upload')).length,
          ungradedDiscussions: totalTodo.filter((t: any) => t.assignment?.submission_types?.includes('discussion_topic')).length,
          recentSubmissions: topRecent.map((s: any) => ({
            name: s.user?.short_name || 'Student',
            item: s.assignment?.name || 'Assignment',
            time: s.submitted_at ? new Date(s.submitted_at).toLocaleString() : 'Recent',
            courseName: s.courseName
          }))
        });

      } catch (e) {
        console.warn("Canvas stats fetch failed", e);
      }

      // We still query Supabase for materials/assignments built within the platform,
      // but later we should link these to Canvas IDs natively.
      const SUPABASE_DB_COURSE_ID = 'BIG_DATA_2026';

      const [
        { data: allStudents },
        { data: materials },
        { data: interactions },
        { data: assignments }
      ] = await Promise.all([
        supabase.from('students').select('*'),
        supabase.from('instructional_materials').select('*').eq('course_id', SUPABASE_DB_COURSE_ID),
        supabase.from('student_assignment_logs').select('*').eq('course_id', SUPABASE_DB_COURSE_ID),
        supabase.from('assignments').select('*').eq('course_id', SUPABASE_DB_COURSE_ID)
      ]);

      const validStudents = (allStudents || []).filter(s => {
        const n = (s.student_name || '').toLowerCase();
        const e = (s.student_email || '').toLowerCase();
        const isTest = n.includes('test') || e.includes('test') || e.includes('example.com') || e.includes('university.edu') || n.includes('student user') || n === 'ada lovelace' || n === 'alex johnson' || n.includes('phil cooper');
        return !isTest;
      });
      const validStudentIds = new Set(validStudents.map(s => s.id));

      const totalStudents = validStudents.length;

      const realMaterials = (materials || []).filter(m => m.file_type !== 'folder_meta');
      const allAssignments = assignments || [];
      const discussions = allAssignments.filter(a => a.assignment_type === 'discussion');
      const regularAssignments = allAssignments.filter(a => a.assignment_type !== 'discussion');

      const allInteractions = (interactions || []).filter(i => validStudentIds.has(i.student_id));

      // SECTION C: Student Engagement Snapshot
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const activeStudentIds = new Set(
        allInteractions
          .filter(i => new Date(i.timestamp) >= sevenDaysAgo)
          .map(i => i.student_id)
      );

      const submissionLogs = allInteractions.filter(i => i.interaction_type === 'submission');
      const studentsWithSubs = new Set(submissionLogs.map(i => i.student_id));
      const noSubmissionCount = Math.max(0, totalStudents - studentsWithSubs.size);

      // Compute Below 70% Overalls
      const studentGrades = new Map<string, number[]>();
      submissionLogs.forEach(sub => {
        if (sub.grade !== null && sub.grade !== undefined) {
          if (!studentGrades.has(sub.student_id)) studentGrades.set(sub.student_id, []);
          studentGrades.get(sub.student_id)!.push(sub.grade);
        }
      });

      let below70Count = 0;
      studentGrades.forEach(grades => {
        if (grades.length > 0) {
          const avg = grades.reduce((a, b) => a + b, 0) / grades.length;
          if (avg < 70) below70Count++;
        }
      });

      // SECTION B: This Week's Tasks
      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const upcomingTasks = [];

      // 1. Assignment Tasks directly from DB
      allAssignments.forEach(a => {
        if (a.due_date && new Date(a.due_date) <= nextWeek && new Date(a.due_date) >= now) {
          const subCount = submissionLogs.filter(s => s.assignment_id === a.id).length;
          const uniqueSubCount = new Set(submissionLogs.filter(s => s.assignment_id === a.id).map(s => s.student_id)).size;
          upcomingTasks.push({
            type: 'assignment',
            title: `${a.assignment_name} due ${new Date(a.due_date).toLocaleDateString()}`,
            detail: `${uniqueSubCount}/${totalStudents} students submitted`,
            action: 'View Submissions',
            path: 'teacher-grading',
            assignmentId: a.id
          });
        }
      });

      setStats({
        materialsCount: realMaterials.length,
        assignmentsCount: regularAssignments.length,
        discussionsCount: discussions.length,
        activeStudentsCount: activeStudentIds.size,
        noSubmissionCount,
        below70Count,
        upcomingTasks
      });

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
        setLoading(false);
      } catch (err) {
        setLoading(false);
      }
    };
    initData();

    const channel = supabase.channel('dashboard_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'student_assignment_logs' }, () => {
        if (activeCourse) fetchRealTimeStats(activeCourse.id.toString());
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'instructional_materials' }, () => {
        if (activeCourse) fetchRealTimeStats(activeCourse.id.toString());
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, () => {
        if (activeCourse) fetchRealTimeStats(activeCourse.id.toString());
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!loading) {
      const ctx = gsap.context(() => {
        const targets = document.querySelectorAll(".dashboard-stagger");
        if (targets.length > 0) {
          gsap.from(targets, {
            y: 30,
            opacity: 0,
            stagger: 0.08,
            duration: 0.8,
            ease: "expo.out",
            clearProps: "all"
          });
        }
      }, mainRef);
      return () => ctx.revert();
    }
  }, [loading]);

  const avatarUrl = userProfile?.user_metadata?.avatar_url || userProfile?.user_metadata?.picture;
  const rawName = userProfile?.user_metadata?.full_name?.split(' ')[0];
  const displayFirstName = (!rawName || rawName.toLowerCase() === 'student' || rawName.toLowerCase() === 'test') ? 'Professor' : rawName;
  const initial = displayFirstName.charAt(0).toUpperCase();

  return (
    <div className="flex h-screen bg-[var(--bg-main)] overflow-hidden font-['Plus_Jakarta_Sans'] transition-colors duration-500 relative">
      <AppSidebar
        role="teacher"
        onNavigateTo={props.onNavigateTo}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        onLogout={props.onLogout}
        currentPath={props.currentPath}
      />

      <AIAssistantModal
        isOpen={aiAssistantOpen}
        onClose={() => setAiAssistantOpen(false)}
        teacherName={userProfile?.user_metadata?.full_name || 'Professor'}
        platformContext={platformContext}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="h-20 bg-[var(--bg-card)] border-b-2 border-[var(--border-primary)] flex items-center justify-between px-12 shrink-0 z-40 shadow-[var(--shadow-sm)]">
          <div className="flex items-center space-x-6">
            <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tighter font-['Space_Grotesk'] uppercase">Educator Hub</h1>
          </div>
          <div className="flex items-center space-x-6">
            <button 
              onClick={() => props.onNavigateTo('teacher-select-course')}
              aria-label="Switch Course"
              className="px-4 py-2 bg-[var(--color-success-bg)] hover:brightness-95 text-[var(--color-success)] rounded-[1rem] text-[10px] font-black uppercase tracking-widest transition-colors border-2 border-[var(--color-success)]/20 flex items-center gap-2"
            >
              <Icons.IconChart className="w-4 h-4" /> Switch Course
            </button>
            <ThemeToggle />
            <div className="hidden md:flex items-center px-5 py-2.5 bg-[var(--color-success-bg)] border-2 border-[var(--color-success)]/20 rounded-[1rem]">
              <span className="w-2 h-2 bg-[var(--color-success)] rounded-full animate-pulse mr-3"></span>
              <span className="text-[10px] font-black text-[var(--color-success)] uppercase tracking-widest">System Operational • Sync: {lastSyncTime}</span>
            </div>
            <button onClick={() => setProfileOpen(!profileOpen)} aria-label="Toggle user profile menu" className="w-12 h-12 bg-[var(--brand-primary)] rounded-[1rem] flex items-center justify-center text-white font-black shadow-[var(--shadow-xl)] overflow-hidden hover:scale-105 active:scale-95 transition-all">
              {avatarUrl ? <img src={avatarUrl} alt="User Avatar" className="w-full h-full object-cover" /> : <span className="text-lg">{initial}</span>}
            </button>
          </div>
        </header>

        {loading ? (
          <DashboardSkeleton role="teacher" />
        ) : (
          <main ref={mainRef} className="flex-1 overflow-y-auto p-8 lg:p-12 xl:p-16 scroll-smooth scrollbar-hide relative z-10">
            <div className="max-w-[1400px] mx-auto space-y-10">
            
              {/* Welcome & Quick Actions */}
              <div className="dashboard-stagger flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-zinc-200 dark:border-white/10 pb-6">
                <div>
                  <h2 className="text-3xl lg:text-4xl font-black tracking-tighter text-zinc-900 dark:text-white mb-2">Welcome back, {displayFirstName}</h2>
                  <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Here's what needs your attention today.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => props.onNavigateTo('teacher-grading')} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[1rem] font-black tracking-widest text-[10px] uppercase transition-all shadow-[var(--shadow-md)]">
                    Go to Evaluation Nexus
                  </button>
                  <button onClick={() => props.onNavigateTo('teacher-grades')} className="px-5 py-2.5 bg-[var(--bg-card)] border-2 border-[var(--border-primary)] hover:border-[var(--brand-primary)] text-[var(--text-primary)] rounded-[1rem] font-black tracking-widest text-[10px] uppercase transition-all shadow-[var(--shadow-sm)]">
                    Review Ledger
                  </button>
                </div>
              </div>

              {/* Main Two-Column Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 xl:gap-12">
                {/* Left Column: Core Workflow (Needs Grading & Activity) */}
                <div className="lg:col-span-2 space-y-8">
                  
                  {/* Needs Grading Hero */}
                  <div className="dashboard-stagger">
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="w-2 h-2 bg-rose-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.6)]"></div>
                      <h3 className="text-xs font-black uppercase tracking-widest text-zinc-900 dark:text-white">Needs Grading</h3>
                    </div>
                    <div className="bg-[var(--bg-card)] rounded-[2.5rem] p-8 md:p-10 border-2 border-[var(--border-primary)] shadow-[var(--shadow-xl)] flex flex-col md:flex-row md:items-center justify-between gap-8 hover:-translate-y-1 transition-all">
                      <div>
                        <div className="flex items-end space-x-2 mb-2">
                          <span className="text-7xl font-black tracking-tighter text-rose-600 dark:text-rose-500 leading-none">{canvasStats.pendingGrades}</span>
                        </div>
                        <p className="text-lg font-bold text-zinc-900 dark:text-white mb-1">Submissions waiting for evaluation</p>
                        <div className="flex space-x-4">
                          <div className="text-xs font-bold text-zinc-600 dark:text-zinc-400"><span className="text-zinc-900 dark:text-white">{canvasStats.ungradedAssignments}</span> assignments</div>
                          <div className="text-xs font-bold text-zinc-600 dark:text-zinc-400"><span className="text-zinc-900 dark:text-white">{canvasStats.ungradedDiscussions}</span> discussions</div>
                        </div>
                      </div>
                      <div className="shrink-0 w-full md:w-auto">
                        <button onClick={() => props.onNavigateTo('teacher-grading')} className="w-full md:w-auto px-8 py-4 bg-[var(--color-danger)] hover:brightness-110 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-rose-500/20">
                          Start Grading →
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Activity Stream */}
                  <div className="dashboard-stagger">
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
                      <h3 className="text-xs font-black uppercase tracking-widest text-zinc-900 dark:text-white">Recent Activity</h3>
                    </div>
                    <div className="bg-[var(--bg-card)] rounded-[2.5rem] p-8 border-2 border-[var(--border-primary)] shadow-[var(--shadow-xl)] flex flex-col hover:-translate-y-1 transition-all">
                      <div className="space-y-4 flex-1 overflow-y-auto pr-2 min-h-[300px]">
                        {canvasStats.recentSubmissions.length > 0 ? canvasStats.recentSubmissions.map((sub, i) => (
                          <div key={i} className="flex justify-between items-center p-4 bg-zinc-50 dark:bg-white/5 rounded-2xl">
                            <div className="flex items-center space-x-4 min-w-0 pr-4">
                              <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-sm shrink-0">
                                {sub.name.split(' ').map((n: string) => n[0]).join('')}
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-sm text-zinc-900 dark:text-white truncate">{sub.name}</p>
                                <div className="flex items-center space-x-2 mt-1">
                                  <span className="text-[10px] font-black px-2 py-1 bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-md truncate max-w-[120px]">{sub.courseName || 'Canvas'}</span>
                                  <p className="text-xs text-zinc-500 truncate">{sub.item}</p>
                                </div>
                              </div>
                            </div>
                            <span className="text-xs font-bold text-zinc-400 shrink-0 bg-white dark:bg-black/20 px-3 py-1 rounded-lg border border-zinc-200 dark:border-white/5">{sub.time}</span>
                          </div>
                        )) : (
                          <div className="flex flex-col items-center justify-center h-[250px] text-zinc-400">
                            <Icons.IconChart className="w-10 h-10 opacity-20 mb-3" />
                            <p className="text-[10px] font-bold uppercase tracking-widest">No recent submissions</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                </div>

                {/* Right Column: Class Insights */}
                <div className="space-y-8">
                  
                  {/* At Risk Students - Elevated to Top of side column */}
                  <div className="dashboard-stagger">
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.6)]"></div>
                      <h3 className="text-xs font-black uppercase tracking-widest text-zinc-900 dark:text-white">Class Insights</h3>
                    </div>

                    {stats.below70Count > 0 ? (
                      <div className="bg-rose-50 dark:bg-rose-500/10 rounded-[2.5rem] border-2 border-rose-200 dark:border-rose-500/20 p-8 shadow-[var(--shadow-xl)] hover:-translate-y-1 transition-all mb-6">
                        <div className="flex items-center justify-between mb-4">
                          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-white dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 shadow-sm">
                            <Icons.IconTrending className="w-6 h-6" />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-widest text-rose-600 bg-rose-100 dark:bg-rose-900/50 dark:text-rose-300 px-3 py-1 rounded-full">Attention Needed</span>
                        </div>
                        <h4 className="text-3xl font-black text-rose-900 dark:text-rose-300 mb-1">{stats.below70Count} Students</h4>
                        <p className="text-xs font-bold text-rose-700/70 dark:text-rose-400/70 mb-6">Currently below 70% overall average</p>
                        
                        <div className="flex flex-col gap-2">
                          <button onClick={() => props.onNavigateTo('teacher-grades')} className="w-full px-5 py-3 bg-rose-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-500 transition-all text-center shadow-lg shadow-rose-600/20">
                            Review Ledger
                          </button>
                          <button onClick={() => props.onNavigateTo('teacher-analytics')} className="w-full px-5 py-3 bg-white dark:bg-rose-900/40 text-rose-600 dark:text-rose-300 rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all text-center shadow-sm">
                            Intervene
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-emerald-50 dark:bg-emerald-500/10 rounded-[2.5rem] border-2 border-emerald-200 dark:border-emerald-500/20 p-8 shadow-[var(--shadow-xl)] hover:-translate-y-1 transition-all mb-6 text-center">
                        <div className="w-12 h-12 mx-auto rounded-2xl flex items-center justify-center shrink-0 bg-white dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 shadow-sm mb-4">
                            <Icons.IconCheck className="w-6 h-6" />
                          </div>
                          <h4 className="text-lg font-black text-emerald-900 dark:text-emerald-300 mb-1">All Students on Track</h4>
                          <p className="text-xs font-bold text-emerald-700/70 dark:text-emerald-400/70">No students are currently below a 70% average.</p>
                      </div>
                    )}

                    {/* Small Data Cards */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-[var(--bg-card)] rounded-[2.5rem] border-2 border-[var(--border-primary)] p-6 shadow-[var(--shadow-xl)] flex flex-col justify-center items-center text-center hover:-translate-y-1 transition-all">
                        <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-500/10 rounded-full flex items-center justify-center mb-3">
                          <Icons.IconUsers className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div className="text-3xl font-black text-zinc-900 dark:text-white tracking-tighter">{stats.activeStudentsCount}</div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mt-1">Active (7d)</p>
                      </div>
                      <div className="bg-[var(--bg-card)] rounded-[2.5rem] border-2 border-[var(--border-primary)] p-6 shadow-[var(--shadow-xl)] flex flex-col justify-center items-center text-center hover:-translate-y-1 transition-all">
                        <div className="w-10 h-10 bg-amber-50 dark:bg-amber-500/10 rounded-full flex items-center justify-center mb-3">
                          <Icons.IconDraft className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div className="text-3xl font-black text-zinc-900 dark:text-white tracking-tighter">{stats.noSubmissionCount}</div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mt-1">0 Submissions</p>
                      </div>
                    </div>
                    
                    {/* Upcoming Tasks list fallback if any DB tasks remain */}
                    {stats.upcomingTasks.length > 0 && (
                      <div className="mt-8">
                        <div className="flex items-center space-x-3 mb-4">
                          <div className="w-2 h-2 bg-zinc-300 dark:bg-zinc-600 rounded-full"></div>
                          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-900 dark:text-white">Other Platform Tasks</h3>
                        </div>
                        <div className="space-y-3">
                          {stats.upcomingTasks.filter(t => !snoozedTasks.has(t.title)).slice(0,3).map((task, idx) => (
                            <div key={idx} className="bg-[var(--bg-card)] border border-[var(--border-primary)] rounded-2xl p-4 flex justify-between items-center group">
                                <div className="min-w-0 pr-2">
                                  <p className="text-xs font-black text-zinc-900 dark:text-white truncate">{task.title}</p>
                                  <p className="text-[10px] text-zinc-500 truncate mt-0.5">{task.detail}</p>
                                </div>
                                <button onClick={() => props.onNavigateTo(task.path as AppPath, task.assignmentId ? { assignmentId: task.assignmentId } : undefined)} className="opacity-0 group-hover:opacity-100 bg-zinc-100 dark:bg-white/10 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all text-zinc-900 dark:text-white">
                                  <Icons.IconCheck className="w-4 h-4" />
                                </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              </div>
            </div>
          </main>
        )}
      </div>
    </div>
  );
};

export default TeacherDashboard;



