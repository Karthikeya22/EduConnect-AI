import React, { useState, useEffect, useRef } from 'react';
import { canvasAPI } from '@/src/services/canvasAPI';
import AppSidebar from '@/src/components/layout/AppSidebar';
import ThemeToggle from '@/src/components/ui/ThemeToggle';
import { AppPath } from '../../App';
import { gsap } from 'gsap';
import { supabase } from '@/src/lib/supabase';

interface ClickstreamAnalyticsProps {
  onBack: () => void;
  onNavigateTo: (path: AppPath) => void;
  onLogout: () => void;
  currentPath?: AppPath;
}

// ─── Helper: format seconds to human-readable ───
const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

// ─── Helper: parse controller from page view ───
const getResourceLabel = (controller: string): string => {
  const map: Record<string, string> = {
    modules: 'Modules', assignments: 'Assignments', quizzes: 'Quizzes',
    files: 'Files', pages: 'Pages', courses: 'Course Home',
    discussion_topics: 'Discussions', submissions: 'Submissions',
    gradebooks: 'Gradebook', announcements: 'Announcements',
    users: 'People', conferences: 'Conferences', collaborations: 'Collaborations',
    wiki_pages: 'Wiki Pages', context_modules: 'Modules',
  };
  return map[controller] || controller || 'Other';
};

const LEVEL_COLORS: Record<string, string> = {
  high: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30',
  moderate: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200 dark:border-blue-500/30',
  low: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
  'no activity': 'bg-zinc-100 text-zinc-500 dark:bg-white/10 dark:text-zinc-500 border-zinc-200 dark:border-white/10',
};

// Canvas returns participations_level/page_views_level as numbers (0-3) or sometimes strings
const getActivityLevel = (raw: any): string => {
  if (typeof raw === 'string') return raw.toLowerCase();
  if (typeof raw === 'number') {
    if (raw >= 3) return 'high';
    if (raw >= 2) return 'moderate';
    if (raw >= 1) return 'low';
    return 'no activity';
  }
  return 'no activity';
};

// ─── Error Boundary ───
class ClickstreamErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean; error: string}> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: '' }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, error: error?.message || 'Unknown error' }; }
  componentDidCatch(error: any, info: any) { console.error('ClickstreamErrorBoundary:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex items-center justify-center bg-[var(--bg-main)] font-['Plus_Jakarta_Sans']">
          <div className="text-center p-12 bg-white dark:bg-[#0F172A] rounded-3xl shadow-xl border border-zinc-100 dark:border-white/5 max-w-md">
            <p className="text-5xl mb-4">⚠️</p>
            <h2 className="text-xl font-black text-zinc-900 dark:text-white mb-2">Something went wrong</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">{this.state.error}</p>
            <button onClick={() => { this.setState({ hasError: false, error: '' }); window.location.reload(); }}
              className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors">
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ClickstreamAnalyticsInner({ onBack, onNavigateTo, onLogout, currentPath = 'teacher-clickstream' }: ClickstreamAnalyticsProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeCourse, setActiveCourse] = useState<{ id: string; name: string } | null>(null);
  const [courses, setCourses] = useState<any[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);

  // ─── Student List State ───
  const [students, setStudents] = useState<any[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'views' | 'participations'>('views');

  // ─── Detail View State ───
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [pageViews, setPageViews] = useState<any[]>([]);
  const [courseActivity, setCourseActivity] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<'timeline' | 'submissions' | 'resources'>('timeline');

  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // ─── Init: load active course ───
  useEffect(() => {
    const fetchCourses = async () => {
      setLoadingCourses(true);
      try {
        const fetchedCourses = await canvasAPI.getCourses();
        if (Array.isArray(fetchedCourses) && fetchedCourses.length > 0) {
          setCourses(fetchedCourses);
          
          const raw = localStorage.getItem('active_canvas_course');
          let defaultCourse = fetchedCourses[0];
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              const matched = fetchedCourses.find((c: any) => String(c.id) === String(parsed.id));
              if (matched) defaultCourse = matched;
            } catch (e) {}
          }
          setActiveCourse({ id: String(defaultCourse.id), name: defaultCourse.name || 'Course' });
        } else {
          onNavigateTo('teacher-select-course');
        }
      } catch (err) {
        console.error("Failed to load courses", err);
        onNavigateTo('teacher-select-course');
      } finally {
        setLoadingCourses(false);
      }
    };
    fetchCourses();
  }, [onNavigateTo]);

  // ─── Fetch student summaries when course changes ───
  useEffect(() => {
    if (!activeCourse) return;
    const fetchStudents = async () => {
      setLoadingStudents(true);
      setErrorMsg(null);
      try {
        const summaries = await canvasAPI.getAnalyticsSummaries(activeCourse.id);
        if (Array.isArray(summaries)) {
          // Validate the data shape — filter out non-student objects (e.g. error objects)
          let validStudents = summaries.filter((s: any) =>
            s && typeof s === 'object' && (s.id || s.user_id) && (typeof s.page_views === 'number' || typeof s.participations === 'number')
          );
          if (validStudents.length > 0) {
            // Fetch real student names from Supabase database to map numeric Canvas IDs
            try {
              const { data: dbStudents } = await supabase.from('students').select('id, student_name');
              if (dbStudents && dbStudents.length > 0) {
                const nameMap = new Map();
                // Map both string and number representations of the ID just in case
                dbStudents.forEach(dbS => {
                  nameMap.set(String(dbS.id), dbS.student_name);
                  nameMap.set(Number(dbS.id), dbS.student_name);
                });
                
                validStudents = validStudents.map((vs: any) => ({
                  ...vs,
                  student_name: nameMap.get(vs.id) || nameMap.get(vs.user_id) || vs.student_name || vs.sortable_name || vs.name || `Student ${vs.id || vs.user_id}`
                }));
              }
            } catch (dbErr) {
              console.error('Failed to fetch student names from db:', dbErr);
            }
            
            setStudents(validStudents);
          } else if (summaries.length > 0 && validStudents.length === 0) {
            // Data returned but didn't match expected schema - might be errors array
            const firstItem = summaries[0];
            if (firstItem?.message) {
              setErrorMsg(`Canvas API: ${firstItem.message}`);
            } else {
              setErrorMsg('Analytics data format not recognized.');
            }
            setStudents([]);
          } else {
            setStudents([]);
            setErrorMsg('No student analytics data found for this course.');
          }
        } else if (summaries && typeof summaries === 'object') {
          // Might be an error object like { errors: [...] } or { error: '...' }
          const msg = summaries.error || summaries.errors?.[0]?.message || 'Analytics returned non-array data.';
          setErrorMsg(String(msg));
          setStudents([]);
        } else {
          setStudents([]);
          setErrorMsg('Analytics API returned unexpected format.');
        }
      } catch (err: any) {
        setErrorMsg(err.message || 'Failed to load student analytics.');
        setStudents([]);
        console.error(err);
      } finally {
        setLoadingStudents(false);
      }
    };
    fetchStudents();
  }, [activeCourse]);

  // ─── Animate student list rows (disabled - was causing crash with stale refs) ───
  // Animations are now handled via CSS transitions on the cards

  // ─── Detail: fetch page views + course activity ───
  const handleSelectStudent = async (student: any) => {
    setSelectedStudent(student);
    setDetailTab('timeline');
    setLoadingDetail(true);
    setPageViews([]);
    setCourseActivity(null);

    const studentId = student.id || student.user_id;

    try {
      const [views, activity] = await Promise.allSettled([
        canvasAPI.getPageViews(studentId),
        activeCourse ? canvasAPI.getStudentCourseActivity(activeCourse.id, studentId) : Promise.resolve(null),
      ]);

      if (views.status === 'fulfilled' && Array.isArray(views.value)) {
        setPageViews(views.value);
      }
      if (activity.status === 'fulfilled' && activity.value) {
        setCourseActivity(activity.value);
      }
    } catch (err) {
      console.error('Detail fetch error:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  // ─── Animate detail view ───
  useEffect(() => {
    if (selectedStudent && detailRef.current && !loadingDetail) {
      try {
        gsap.from(detailRef.current, { x: 40, opacity: 0, duration: 0.4, ease: 'power2.out' });
      } catch (_) { /* ignore GSAP errors */ }
    }
  }, [selectedStudent, loadingDetail]);

  // ─── Computed: filtered + sorted students ───
  const safeStudents = students.filter((s: any) => s && (s.id || s.user_id));
  const maxViewsGlobal = safeStudents.length > 0 ? Math.max(1, ...safeStudents.map((s: any) => Number(s.page_views) || 0)) : 1;

  const visibleStudents = safeStudents
    .filter((s: any) => {
      if (!search) return true;
      const name = (s.sortable_name || s.name || String(s.id) || '').toLowerCase();
      return name.includes(search.toLowerCase());
    })
    .sort((a: any, b: any) => {
      if (sortBy === 'name') return (a.sortable_name || '').localeCompare(b.sortable_name || '');
      if (sortBy === 'views') return (Number(b.page_views) || 0) - (Number(a.page_views) || 0);
      return (Number(b.participations) || 0) - (Number(a.participations) || 0);
    });

  // ─── Computed: aggregate page view stats for detail view ───
  const resourceBreakdown = (() => {
    const map: Record<string, { count: number; totalTime: number }> = {};
    pageViews.forEach((v: any) => {
      const label = getResourceLabel(v.controller);
      if (!map[label]) map[label] = { count: 0, totalTime: 0 };
      map[label].count++;
      map[label].totalTime += v.interaction_seconds || 0;
    });
    return Object.entries(map)
      .map(([label, stats]) => ({ label, ...stats }))
      .sort((a, b) => b.totalTime - a.totalTime);
  })();

  const totalTimeSpent = pageViews.reduce((acc: number, v: any) => acc + (v.interaction_seconds || 0), 0);

  // ─── Computed: submission stats from courseActivity ───
  const submissionStats = (() => {
    if (!courseActivity?.assignments || !Array.isArray(courseActivity.assignments)) return { onTime: 0, late: 0, missing: 0, total: 0, totalDue: 0, items: [] };
    const items = courseActivity.assignments;
    let onTime = 0, late = 0, missing = 0, totalDue = 0;
    items.forEach((a: any) => {
      if (a.status === 'on_time') { onTime++; totalDue++; }
      else if (a.status === 'late') { late++; totalDue++; }
      else if (a.status === 'missing') { missing++; totalDue++; }
      else if (a.submission?.submitted_at) { onTime++; totalDue++; } 
    });
    return { onTime, late, missing, total: items.length, totalDue, items };
  })();

  // ─── RENDER ───
  return (
    <div className="flex h-screen bg-[var(--bg-main)] overflow-hidden font-['Plus_Jakarta_Sans'] transition-colors">
      <AppSidebar
        role="teacher"
        currentPath={currentPath}
        onNavigateTo={onNavigateTo}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        onLogout={onLogout}
      />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10">
        {/* ─── HEADER ─── */}
        <header className="px-8 md:px-12 pt-8 pb-4 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-4">
              {selectedStudent && (
                <button
                  onClick={() => setSelectedStudent(null)}
                  className="w-10 h-10 rounded-xl bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:border-indigo-500 transition-all shadow-sm"
                >
                  ←
                </button>
              )}
              <div>
                <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[var(--text-primary)]">
                  {selectedStudent ? (selectedStudent.student_name || selectedStudent.sortable_name || selectedStudent.name || `Student ${selectedStudent.id || selectedStudent.user_id}`) : 'Clickstream Activity Hub'}
                </h1>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 font-bold mt-1">
                  {selectedStudent
                    ? `Detailed activity sheet for this student in ${activeCourse?.name || 'course'}`
                    : `Monitoring student interactions across ${activeCourse?.name || 'your course'}`
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
            </div>
          </div>

          {/* Course Badge */}
          <div className="inline-flex items-center space-x-2 px-4 py-2 bg-white dark:bg-white/5 rounded-xl border border-zinc-200 dark:border-white/10 mt-2 relative min-w-[200px]">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shrink-0"></span>
            {loadingCourses ? (
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 pr-4">Loading Courses...</span>
            ) : (
              <select 
                className="w-full text-[10px] font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-300 bg-transparent border-none outline-none appearance-none cursor-pointer pr-4 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                value={activeCourse?.id || ''}
                onChange={(e) => {
                  const selected = courses.find((c: any) => String(c.id) === e.target.value);
                  if (selected) {
                    const newCourse = { id: String(selected.id), name: selected.name || 'Course' };
                    setActiveCourse(newCourse);
                    localStorage.setItem('active_canvas_course', JSON.stringify(newCourse));
                    setSelectedStudent(null);
                  }
                }}
              >
                {courses.map((c: any) => (
                  <option key={c.id} value={c.id} className="bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white">
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
          </div>
        </header>

        {/* ─── CONTENT ─── */}
        <div className="flex-1 overflow-y-auto px-8 md:px-12 pb-12">
          {errorMsg && (
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 p-4 rounded-2xl text-sm font-bold mb-6">
              {errorMsg} <button onClick={() => window.location.reload()} className="underline ml-2">Retry</button>
            </div>
          )}

          {!selectedStudent ? (
            /* ════════════════════════════════════════════════════════
               VIEW 1: STUDENT LIST
               ════════════════════════════════════════════════════════ */
            <>
              {/* Controls Bar */}
              <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
                <div className="relative flex-1 max-w-md">
                  <input
                    type="text"
                    placeholder="Search students..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                  />
                  <svg className="absolute left-3.5 top-3.5 w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Sort:</span>
                  {(['views', 'participations', 'name'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setSortBy(s)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                        sortBy === s
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'bg-white dark:bg-white/5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/10 border border-zinc-200 dark:border-white/10'
                      }`}
                    >
                      {s === 'views' ? 'Page Views' : s === 'participations' ? 'Participations' : 'Name'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Summary Bar */}
              {!loadingStudents && students.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                  {[
                    { label: 'Total Students', value: safeStudents.length, color: 'text-indigo-600 dark:text-indigo-400' },
                    { label: 'Avg Page Views', value: safeStudents.length > 0 ? Math.round(safeStudents.reduce((a: number, s: any) => a + (Number(s.page_views) || 0), 0) / safeStudents.length) : 0, color: 'text-cyan-600 dark:text-cyan-400' },
                    { label: 'Avg Participations', value: safeStudents.length > 0 ? Math.round(safeStudents.reduce((a: number, s: any) => a + (Number(s.participations) || 0), 0) / safeStudents.length) : 0, color: 'text-emerald-600 dark:text-emerald-400' },
                    { label: 'Max Page Views', value: maxViewsGlobal, color: 'text-purple-600 dark:text-purple-400' },
                  ].map(stat => (
                    <div key={stat.label} className="bg-white dark:bg-[#0F172A] rounded-2xl border border-zinc-100 dark:border-white/5 p-5 shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mb-1">{stat.label}</p>
                      <p className={`text-3xl font-black ${stat.color}`}>{stat.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Student Cards */}
              {loadingStudents ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="bg-white dark:bg-[#0F172A] rounded-2xl border border-zinc-100 dark:border-white/5 p-6 animate-pulse">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 rounded-full bg-zinc-200 dark:bg-white/10"></div>
                        <div className="flex-1 space-y-2">
                          <div className="h-4 bg-zinc-200 dark:bg-white/10 rounded w-48"></div>
                          <div className="h-3 bg-zinc-200 dark:bg-white/10 rounded w-32"></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3" ref={listRef}>
                  {visibleStudents.map((student: any, idx: number) => {
                    const name = student.student_name || student.sortable_name || student.name || `Student ${student.id || student.user_id || idx}`;
                    let initials = 'ST';
                    try {
                      initials = name.includes(',')
                        ? ((name.split(',')[1] || '').trim()[0] || '') + (name.split(',')[0][0] || '')
                        : name.substring(0, 2).toUpperCase();
                    } catch (_) { /* fallback */ }
                    const level = getActivityLevel(student.participations_level);
                    const viewsPercent = Math.min(100, Math.round(((Number(student.page_views) || 0) / maxViewsGlobal) * 100));

                    return (
                      <button
                        key={student.id || idx}
                        onClick={() => handleSelectStudent(student)}
                        className="w-full text-left bg-white dark:bg-[#0F172A] rounded-2xl border border-zinc-100 dark:border-white/5 p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all group flex items-center justify-between"
                      >
                        <div className="flex items-center space-x-4 min-w-0 flex-1">
                          <div className="w-12 h-12 rounded-full bg-indigo-500 flex items-center justify-center text-white font-black text-sm shrink-0 shadow-md">
                            {initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-sm text-zinc-900 dark:text-white truncate">{name}</p>
                            <div className="flex items-center space-x-3 mt-1.5">
                              <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border ${LEVEL_COLORS[level] || LEVEL_COLORS['no activity']}`}>
                                {level}
                              </span>
                              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500">
                                {student.page_views || 0} views • {student.participations || 0} participations
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-6 shrink-0 pl-4">
                          {/* Mini bar chart */}
                          <div className="hidden md:flex flex-col items-end w-32">
                            <div className="w-full h-2 bg-zinc-100 dark:bg-white/5 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-indigo-500 rounded-full transition-all duration-700"
                                style={{ width: `${viewsPercent}%` }}
                              ></div>
                            </div>
                            <span className="text-[8px] font-bold text-zinc-400 mt-1">{viewsPercent}% of max</span>
                          </div>

                          <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-500 group-hover:bg-indigo-500 group-hover:text-white transition-all">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {visibleStudents.length === 0 && (
                    <div className="text-center py-20 text-zinc-500 font-bold">
                      {search ? 'No students match your search.' : 'No activity data found for this course.'}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* ════════════════════════════════════════════════════════
               VIEW 2: STUDENT DETAIL (DRILL-DOWN)
               ════════════════════════════════════════════════════════ */
            <div ref={detailRef}>
              {loadingDetail ? (
                <div className="flex flex-col items-center justify-center py-32">
                  <div className="w-12 h-12 border-4 border-zinc-200 dark:border-white/10 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 animate-pulse">Loading student activity data...</p>
                </div>
              ) : (
                <>
                  {/* ─── Stat Cards Row ─── */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                    {[
                      { label: 'Total Page Views', value: selectedStudent.page_views || pageViews.length || 0, icon: '👁️', color: 'bg-indigo-500' },
                      { label: 'Participations', value: selectedStudent.participations || 0, icon: '🤝', color: 'bg-emerald-500' },
                      { label: 'Time on Materials', value: formatDuration(totalTimeSpent), icon: '⏱️', color: 'bg-cyan-500' },
                      { label: 'Submissions', value: `${submissionStats.onTime + submissionStats.late}/${submissionStats.totalDue}`, icon: '📄', color: 'bg-purple-500' },
                      { label: 'On-Time Rate', value: submissionStats.totalDue > 0 ? `${Math.round((submissionStats.onTime / submissionStats.totalDue) * 100)}%` : 'N/A', icon: '✅', color: 'bg-amber-500' },
                    ].map(stat => (
                      <div key={stat.label} className="bg-white dark:bg-[#0F172A] rounded-2xl border border-zinc-100 dark:border-white/5 p-5 shadow-sm relative overflow-hidden">
                        <div className={`absolute top-0 right-0 w-16 h-16 ${stat.color} opacity-5 rounded-bl-[3rem]`}></div>
                        <span className="text-lg mb-1 block">{stat.icon}</span>
                        <p className="text-2xl font-black text-zinc-900 dark:text-white">{stat.value}</p>
                        <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mt-1">{stat.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* ─── Time on Materials Breakdown ─── */}
                  {resourceBreakdown.length > 0 && (
                    <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-zinc-100 dark:border-white/5 p-6 shadow-sm mb-8">
                      <h3 className="text-[11px] font-black uppercase tracking-widest text-zinc-900 dark:text-white mb-4">⏱️ Time Spent by Resource</h3>
                      <div className="space-y-3">
                        {resourceBreakdown.map(r => {
                          const maxTime = resourceBreakdown[0]?.totalTime || 1;
                          const pct = Math.round((r.totalTime / maxTime) * 100);
                          return (
                            <div key={r.label} className="flex items-center space-x-4">
                              <span className="w-28 text-xs font-bold text-zinc-600 dark:text-zinc-300 truncate shrink-0">{r.label}</span>
                              <div className="flex-1 h-3 bg-zinc-100 dark:bg-white/5 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-indigo-500 rounded-full transition-all duration-700"
                                  style={{ width: `${pct}%` }}
                                ></div>
                              </div>
                              <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 w-20 text-right shrink-0">{formatDuration(r.totalTime)}</span>
                              <span className="text-[10px] text-zinc-400 w-16 text-right shrink-0">{r.count} hits</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ─── Tabs ─── */}
                  <div className="flex space-x-2 mb-6">
                    {([
                      { id: 'timeline' as const, label: 'Page View Timeline', icon: '📜' },
                      { id: 'submissions' as const, label: 'Submission History', icon: '📋' },
                      { id: 'resources' as const, label: 'Activity by URL', icon: '🔗' },
                    ]).map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setDetailTab(tab.id)}
                        className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
                          detailTab === tab.id
                            ? 'bg-indigo-600 text-white shadow-lg'
                            : 'bg-white dark:bg-white/5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/10 border border-zinc-200 dark:border-white/10'
                        }`}
                      >
                        <span>{tab.icon}</span>
                        <span>{tab.label}</span>
                        {tab.id === 'timeline' && <span className="ml-1 px-1.5 py-0.5 rounded text-[8px] font-black bg-white/20">{pageViews.length}</span>}
                        {tab.id === 'submissions' && <span className="ml-1 px-1.5 py-0.5 rounded text-[8px] font-black bg-white/20">{submissionStats.total}</span>}
                      </button>
                    ))}
                  </div>

                  {/* ─── Tab Content ─── */}
                  <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-zinc-100 dark:border-white/5 shadow-sm overflow-hidden">
                    
                    {/* TIMELINE TAB */}
                    {detailTab === 'timeline' && (
                      <div className="divide-y divide-zinc-50 dark:divide-white/5">
                        {pageViews.length > 0 ? (
                          <>
                            <div className="grid grid-cols-12 gap-2 px-6 py-3 bg-zinc-50 dark:bg-white/5 text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
                              <span className="col-span-3">Timestamp</span>
                              <span className="col-span-4">URL / Page</span>
                              <span className="col-span-2">Controller</span>
                              <span className="col-span-1">Action</span>
                              <span className="col-span-1 text-right">Duration</span>
                              <span className="col-span-1 text-right">User Req</span>
                            </div>
                            {pageViews.slice(0, 200).map((v: any, i: number) => (
                              <div key={v.id || i} className="grid grid-cols-12 gap-2 px-6 py-3 text-xs hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors items-center">
                                <span className="col-span-3 font-bold text-indigo-600 dark:text-indigo-400 text-[11px]">
                                  {new Date(v.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span className="col-span-4 text-zinc-700 dark:text-zinc-300 truncate font-medium" title={v.url}>
                                  {v.url ? v.url.replace(/https?:\/\/[^/]+/, '') : 'N/A'}
                                </span>
                                <span className="col-span-2">
                                  <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-400 text-[10px] font-bold">
                                    {getResourceLabel(v.controller)}
                                  </span>
                                </span>
                                <span className="col-span-1 text-zinc-500 font-medium">{v.action || '—'}</span>
                                <span className="col-span-1 text-right font-bold text-zinc-700 dark:text-zinc-300">
                                  {v.interaction_seconds ? formatDuration(v.interaction_seconds) : '—'}
                                </span>
                                <span className="col-span-1 text-right">
                                  {v.user_request ? (
                                    <span className="w-5 h-5 inline-flex items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[8px] font-black">✓</span>
                                  ) : (
                                    <span className="text-zinc-300 dark:text-zinc-700">—</span>
                                  )}
                                </span>
                              </div>
                            ))}
                            {pageViews.length > 200 && (
                              <div className="px-6 py-4 text-center text-xs text-zinc-400 font-bold">
                                Showing 200 of {pageViews.length} records. Canvas API returns the most recent activity.
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="py-20 text-center text-zinc-500 dark:text-zinc-400">
                            <p className="font-bold mb-1">No page view data available</p>
                            <p className="text-xs opacity-70">Canvas may restrict data to the last 30 days or to users you have admin access over.</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* SUBMISSIONS TAB */}
                    {detailTab === 'submissions' && (
                      <div className="divide-y divide-zinc-50 dark:divide-white/5">
                        {submissionStats.items.length > 0 ? (
                          <>
                            {/* Summary row */}
                            <div className="px-6 py-4 bg-zinc-50 dark:bg-white/5 flex items-center space-x-6">
                              <div className="flex items-center space-x-2">
                                <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                                <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300">{submissionStats.onTime} On Time</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                                <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300">{submissionStats.late} Late</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <span className="w-3 h-3 rounded-full bg-red-500"></span>
                                <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300">{submissionStats.missing} Missing</span>
                              </div>
                            </div>
                            <div className="grid grid-cols-12 gap-2 px-6 py-3 bg-zinc-50 dark:bg-white/5 text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-500 border-b border-zinc-100 dark:border-white/5">
                              <span className="col-span-5">Assignment</span>
                              <span className="col-span-2">Submitted</span>
                              <span className="col-span-2">Score</span>
                              <span className="col-span-2">Status</span>
                              <span className="col-span-1 text-right">Points</span>
                            </div>
                            {submissionStats.items.map((a: any, i: number) => {
                              const statusColor = a.status === 'on_time'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                                : a.status === 'late'
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
                                  : a.status === 'missing'
                                    ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'
                                    : 'bg-zinc-100 text-zinc-500 dark:bg-white/10 dark:text-zinc-400';
                              return (
                                <div key={a.assignment_id || i} className="grid grid-cols-12 gap-2 px-6 py-3.5 text-xs hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors items-center">
                                  <span className="col-span-5 font-bold text-zinc-800 dark:text-zinc-200 truncate">{a.title || `Assignment ${a.assignment_id}`}</span>
                                  <span className="col-span-2 text-zinc-500 font-medium">
                                    {a.submission?.submitted_at
                                      ? new Date(a.submission.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                      : '—'
                                    }
                                  </span>
                                  <span className="col-span-2 font-bold text-zinc-700 dark:text-zinc-300">
                                    {a.submission?.score !== null && a.submission?.score !== undefined ? a.submission.score : '—'}
                                  </span>
                                  <span className="col-span-2">
                                    <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${statusColor}`}>
                                      {(a.status || 'unknown').replace('_', ' ')}
                                    </span>
                                  </span>
                                  <span className="col-span-1 text-right text-zinc-500 font-medium">
                                    {a.points_possible || '—'}
                                  </span>
                                </div>
                              );
                            })}
                          </>
                        ) : (
                          <div className="py-20 text-center text-zinc-500 dark:text-zinc-400">
                            <p className="font-bold mb-1">No submission data available</p>
                            <p className="text-xs opacity-70">Assignment analytics may not be accessible for this student.</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* RESOURCES TAB */}
                    {detailTab === 'resources' && (
                      <div className="divide-y divide-zinc-50 dark:divide-white/5">
                        {pageViews.length > 0 ? (
                          (() => {
                            const urlMap: Record<string, { count: number; totalTime: number; lastAccess: string }> = {};
                            pageViews.forEach((v: any) => {
                              const shortUrl = v.url ? v.url.replace(/https?:\/\/[^/]+/, '') : 'unknown';
                              if (!urlMap[shortUrl]) urlMap[shortUrl] = { count: 0, totalTime: 0, lastAccess: '' };
                              urlMap[shortUrl].count++;
                              urlMap[shortUrl].totalTime += v.interaction_seconds || 0;
                              if (!urlMap[shortUrl].lastAccess || v.created_at > urlMap[shortUrl].lastAccess) {
                                urlMap[shortUrl].lastAccess = v.created_at;
                              }
                            });
                            const sorted = Object.entries(urlMap)
                              .map(([url, stats]) => ({ url, ...stats }))
                              .sort((a, b) => b.count - a.count);

                            return (
                              <>
                                <div className="grid grid-cols-12 gap-2 px-6 py-3 bg-zinc-50 dark:bg-white/5 text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
                                  <span className="col-span-6">URL Path</span>
                                  <span className="col-span-2 text-center">Visits</span>
                                  <span className="col-span-2 text-right">Total Time</span>
                                  <span className="col-span-2 text-right">Last Accessed</span>
                                </div>
                                {sorted.slice(0, 100).map((entry, i) => (
                                  <div key={i} className="grid grid-cols-12 gap-2 px-6 py-3 text-xs hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors items-center">
                                    <span className="col-span-6 text-zinc-700 dark:text-zinc-300 truncate font-medium" title={entry.url}>{entry.url}</span>
                                    <span className="col-span-2 text-center">
                                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-black text-[10px]">{entry.count}×</span>
                                    </span>
                                    <span className="col-span-2 text-right font-bold text-zinc-700 dark:text-zinc-300">{formatDuration(entry.totalTime)}</span>
                                    <span className="col-span-2 text-right text-zinc-500 font-medium">
                                      {new Date(entry.lastAccess).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </span>
                                  </div>
                                ))}
                              </>
                            );
                          })()
                        ) : (
                          <div className="py-20 text-center text-zinc-500 dark:text-zinc-400">
                            <p className="font-bold mb-1">No URL activity data available</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function ClickstreamAnalytics(props: ClickstreamAnalyticsProps) {
  return (
    <ClickstreamErrorBoundary>
      <ClickstreamAnalyticsInner {...props} />
    </ClickstreamErrorBoundary>
  );
}



