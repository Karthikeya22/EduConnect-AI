import React, { useState, useEffect } from 'react';
import { supabase } from '@/src/lib/supabase';
import AppSidebar from '@/src/components/layout/AppSidebar';
import { AppPath } from '@/src/App';
import * as Icons from '@/src/components/ui/Icons';
import ThemeToggle from '@/src/components/ui/ThemeToggle';
import { DashboardSkeleton } from '@/src/components/ui/Skeleton';

import { canvasAPI } from '@/src/services/canvasAPI';

interface GradebookProps {
    onBack: () => void;
    onLogout: () => void;
    onNavigateTo: (path: AppPath, params?: any) => void;
    currentPath: AppPath;
    onOpenNotifs: () => void;
}

const Gradebook: React.FC<GradebookProps> = (props) => {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [profileOpen, setProfileOpen] = useState(false);

    const [activeAssignmentId, setActiveAssignmentId] = useState<string>('all');
    const [activeStudentId, setActiveStudentId] = useState<string>('all');
    const [activeCourse, setActiveCourse] = useState<{id: string, name: string} | null>(null);

    // Data States
    const [assignments, setAssignments] = useState<any[]>([]);
    const [students, setStudents] = useState<any[]>([]);
    const [submissions, setSubmissions] = useState<any[]>([]);
    const [stats, setStats] = useState({
        published: 0,
        classAverage: 0,
        atRisk: 0,
        safeExcel: 0,
    });

    const fetchGradesData = async (courseId: string) => {
        try {
            // 2. Fetch Assignments from Canvas
            const assns = await canvasAPI.getAssignments(courseId);
            const canvasAssignments = Array.isArray(assns) ? assns : [];
            
            // 3. Fetch Submissions for each Assignment from Canvas to gather grades and derive the student roster
            const submissionsPromises = canvasAssignments.map((a: any) => 
                canvasAPI.getSubmissions(courseId, a.id.toString()).catch(() => [])
            );
            
            const submissionsResults = await Promise.all(submissionsPromises);
            let canvasSubmissions: any[] = [];
            submissionsResults.forEach(res => {
                canvasSubmissions = [...canvasSubmissions, ...(res || [])];
            });

            // 4. Derive students list from the submission users
            const studentMap = new Map<string, any>();
            canvasSubmissions.forEach(sub => {
                if (sub.user && sub.user_id) {
                    studentMap.set(sub.user_id.toString(), {
                        id: sub.user_id.toString(),
                        full_name: sub.user.short_name || sub.user.name || 'Student',
                        email: sub.user.login_id || ''
                    });
                }
            });
            const studentsLoaded = Array.from(studentMap.values());

            const assignmentsLoaded = canvasAssignments;

            // Map Canvas submissions to match our internal schema roughly
            const subsLoaded = (canvasSubmissions || []).map((s: any) => {
                const assign = canvasAssignments.find((a: any) => a.id.toString() === s.assignment_id.toString());
                const maxPoints = assign?.points_possible || 100;
                let pct = s.score;
                if (s.score !== null && maxPoints > 0) {
                    pct = Math.round((s.score / maxPoints) * 100);
                }
                return {
                    id: s.id,
                    assignment_id: s.assignment_id.toString(),
                    student_id: s.user_id.toString(),
                    grade: pct,
                    rawScore: s.score,
                    maxPoints,
                    submission_content: s.body || '',
                    timestamp: s.submitted_at || s.graded_at,
                    student_name: s.user?.short_name || 'Student'
                };
            });

            setAssignments(assignmentsLoaded.map((a: any) => ({
                ...a,
                id: a.id.toString(),
                assignment_name: a.name,
                assignment_type: a.submission_types?.includes('discussion_topic') ? 'discussion' : 'assignment'
            })));
            setStudents(studentsLoaded);
            setSubmissions(subsLoaded);

            calculateStats(assignmentsLoaded, studentsLoaded, subsLoaded, 'all', 'all');
            setLoading(false);
        } catch (err) {
            console.error("Gradebook sync failed:", err);
            setLoading(false);
        }
    };

    const calculateStats = (assigns: any[], studs: any[], subs: any[], assignmentFilter: string, studentFilter: string) => {
        let filteredSubs = subs;
        if (assignmentFilter !== 'all') {
            filteredSubs = filteredSubs.filter(s => s.assignment_id === assignmentFilter);
        }
        if (studentFilter !== 'all') {
            filteredSubs = filteredSubs.filter(s => s.student_id === studentFilter);
        }

        const gradedSubs = filteredSubs.filter(s => s.grade !== null && s.grade !== undefined);
        const avg = gradedSubs.length > 0 ? gradedSubs.reduce((acc, sub) => acc + sub.grade, 0) / gradedSubs.length : 0;

        // Simplistic risk breakdown based on current filtered average if student is isolated, or overall risk per student
        let atRisk = 0;
        let safe = 0;

        if (studentFilter === 'all') {
            const studentMap = new Map<string, number[]>();
            gradedSubs.forEach(s => {
                if (!studentMap.has(s.student_id)) studentMap.set(s.student_id, []);
                studentMap.get(s.student_id)!.push(s.grade);
            });
            studentMap.forEach(grades => {
                const studAvg = grades.reduce((acc, val) => acc + val, 0) / grades.length;
                if (studAvg < 70) atRisk++;
                else safe++;
            });
        }

        setStats({
            published: assigns.length,
            classAverage: Math.round(avg),
            atRisk: studentFilter === 'all' ? atRisk : (avg < 70 ? 1 : 0),
            safeExcel: studentFilter === 'all' ? safe : (avg >= 70 ? 1 : 0),
        });
    };

    useEffect(() => {
        const rawCourse = localStorage.getItem('active_canvas_course');
        if (!rawCourse) {
            props.onNavigateTo('teacher-select-course');
        } else {
            const parsed = JSON.parse(rawCourse);
            setActiveCourse({ id: parsed.id.toString(), name: parsed.name });
            fetchGradesData(parsed.id.toString());
        }
    }, []);

    useEffect(() => {
        if (!loading) {
            calculateStats(assignments, students, submissions, activeAssignmentId, activeStudentId);
        }
    }, [activeAssignmentId, activeStudentId]);

    return (
        <div className="flex h-screen bg-[var(--bg-main)] overflow-hidden font-['Plus_Jakarta_Sans'] transition-colors duration-500">
            <AppSidebar
                role="teacher"
                onNavigateTo={props.onNavigateTo}
                collapsed={sidebarCollapsed}
                setCollapsed={setSidebarCollapsed}
                onLogout={props.onLogout}
                currentPath={props.currentPath}
            />


            <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                <header className="h-20 bg-[var(--bg-card)] border-b-2 border-[var(--border-primary)] flex items-center justify-between px-8 shrink-0 z-40 shadow-[var(--shadow-sm)] transition-colors duration-500">
                    <div className="flex items-center space-x-6">
                        <h1 className="text-xl font-black text-zinc-900 dark:text-white tracking-tighter font-['Space_Grotesk'] uppercase flex items-center gap-3">
                            <Icons.IconChart className="w-6 h-6 text-emerald-500" />
                            Class Ledger
                        </h1>
                    </div>
                    <div className="flex items-center space-x-6">
                        <button 
                            onClick={() => props.onNavigateTo('teacher-select-course')}
                            className="px-4 py-2 bg-[var(--color-success-bg)] hover:brightness-95 text-[var(--color-success)] rounded-[1rem] text-xs font-black uppercase tracking-widest transition-colors border-2 border-[var(--color-success)]/20 flex items-center gap-2"
                        >
                            <Icons.IconChart className="w-4 h-4" /> Switch Course
                        </button>
                        <ThemeToggle />
                        <button className="w-10 h-10 bg-[var(--brand-primary)] rounded-[1rem] flex items-center justify-center text-white font-bold hover:scale-105 transition-transform shadow-[var(--shadow-md)]">
                            P
                        </button>
                    </div>
                </header>

                {loading ? (
                    <DashboardSkeleton role="teacher" />
                ) : (
                    <main className="flex-1 flex overflow-hidden">
                        {/* Left Panel: Assignments Selector */}
                        <div className="w-72 lg:w-80 border-r-2 border-[var(--border-primary)] bg-[var(--bg-card)] flex flex-col shrink-0 transition-colors duration-500 shadow-[var(--shadow-sm)] z-30">
                            <div className="p-5 lg:p-6 border-b-2 border-[var(--border-primary)] shrink-0">
                                <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Context</h2>
                            </div>
                            <div className="flex-1 overflow-y-auto scrollbar-hide p-4 space-y-2">
                                <button
                                    onClick={() => { setActiveAssignmentId('all'); setActiveStudentId('all'); }}
                                    className={`w-full p-4 rounded-2xl flex flex-col text-left transition-all ${activeAssignmentId === 'all' ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-500 shadow-sm' : 'hover:bg-zinc-50 dark:hover:bg-white/5'}`}
                                >
                                    <h4 className={`text-xs font-black uppercase tracking-widest leading-snug mb-1 ${activeAssignmentId === 'all' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-900 dark:text-zinc-300'}`}>Course Overview</h4>
                                    <span className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500">{assignments.length} Total Assignments</span>
                                </button>

                                {assignments.map(a => {
                                    const isSelected = activeAssignmentId === a.id;
                                    return (
                                        <button
                                            key={a.id}
                                            onClick={() => setActiveAssignmentId(a.id)}
                                            className={`w-full p-4 rounded-2xl flex flex-col text-left transition-all ${isSelected ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500 shadow-sm' : 'hover:bg-zinc-50 dark:hover:bg-white/5'}`}
                                        >
                                            <h4 className={`text-xs font-black uppercase tracking-widest leading-snug mb-1 ${isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-900 dark:text-zinc-300'}`}>{a.assignment_name}</h4>
                                            <div className="flex space-x-2 items-center">
                                                <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">{a.assignment_type}</span>
                                                <span className="text-[9px] font-bold text-zinc-300 dark:text-zinc-600">•</span>
                                                <span className="text-[9px] font-black uppercase tracking-widest text-indigo-500">{submissions.filter(s => s.assignment_id === a.id).length} Subs</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Right Panel: Workspace */}
                        <div className="flex-1 overflow-y-auto scrollbar-hide p-6 lg:p-10 bg-[var(--bg-main)]">
                            <div className="max-w-6xl mx-auto space-y-6 animate-fade-up">

                                {/* Top Isolation Dropdown */}
                                <div className="flex flex-col md:flex-row bg-[var(--bg-card)] p-4 lg:p-5 rounded-[2.5rem] border-2 border-[var(--border-primary)] shadow-[var(--shadow-xl)] md:items-center gap-4">
                                    <div className="flex-1 max-w-sm w-full min-w-0">
                                        <p className="text-zinc-500 font-bold uppercase text-[10px] tracking-widest mb-2 px-2">Isolate Student Data</p>
                                        <div className="relative">
                                            <select
                                                value={activeStudentId}
                                                onChange={(e) => setActiveStudentId(e.target.value)}
                                                className="appearance-none bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1rem] px-4 py-2.5 font-bold text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20 transition-all w-full cursor-pointer pr-10 truncate"
                                            >
                                                <option value="all" className="font-bold text-zinc-900">All Students</option>
                                                {students.map(s => (
                                                    <option key={s.id} value={s.id} className="text-sm font-medium text-zinc-900">{s.full_name || s.email?.split('@')[0] || 'Student'}</option>
                                                ))}
                                            </select>
                                            <Icons.IconChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400 pointer-events-none" />
                                        </div>
                                    </div>
                                    <div className="flex-1 md:pl-6 pt-2 md:pt-6">
                                        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                                            Currently viewing: <strong className="text-zinc-900 dark:text-white truncate max-w-[150px] inline-block align-bottom">{activeAssignmentId === 'all' ? 'All Assignments' : assignments.find(a => a.id === activeAssignmentId)?.assignment_name}</strong>
                                            &nbsp;&nbsp;→&nbsp;&nbsp;
                                            <strong className="text-zinc-900 dark:text-emerald-400">{activeStudentId === 'all' ? 'Entire Class' : (students.find(s => s.id === activeStudentId)?.student_name?.split(' ')[0] || 'Selected')}</strong>
                                        </p>
                                    </div>
                                </div>

                                {/* Stats Row */}
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
                                    <div className="bg-[var(--bg-card)] p-6 lg:p-8 rounded-[2.5rem] border-2 border-[var(--border-primary)] flex flex-col justify-center items-center text-center shadow-[var(--shadow-xl)]">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">Average Score</span>
                                        <div className="text-4xl lg:text-5xl font-black tracking-tighter text-emerald-500">{stats.classAverage}%</div>
                                    </div>
                                    <div className="bg-white dark:bg-[#0B1120] p-6 lg:p-8 rounded-3xl border border-zinc-200 dark:border-white/5 flex flex-col justify-center items-center text-center shadow-sm">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">Assessed</span>
                                        <div className="text-4xl lg:text-5xl font-black tracking-tighter text-zinc-900 dark:text-white">{activeStudentId === 'all' ? submissions.filter(s => s.grade !== null).length : submissions.filter(s => s.grade !== null && s.student_id === activeStudentId).length}</div>
                                        <span className="text-[9px] font-bold text-zinc-400 mt-2">Submissions</span>
                                    </div>
                                    <div className="bg-[var(--bg-card)] p-6 lg:p-8 rounded-[2.5rem] border-2 border-[var(--border-primary)] flex flex-col justify-center items-center text-center shadow-[var(--shadow-xl)] relative overflow-hidden">
                                        <div className="absolute top-0 w-full h-1.5 bg-rose-500/80"></div>
                                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">At Risk (&lt;70%)</span>
                                        <div className="text-4xl lg:text-5xl font-black tracking-tighter text-rose-500">{stats.atRisk}</div>
                                        {activeStudentId === 'all' && <span className="text-[9px] font-bold text-zinc-400 mt-2">Students</span>}
                                    </div>
                                    <div className="bg-[var(--bg-card)] p-6 lg:p-8 rounded-[2.5rem] border-2 border-[var(--border-primary)] flex flex-col justify-center items-center text-center shadow-[var(--shadow-xl)] relative overflow-hidden">
                                        <div className="absolute top-0 w-full h-1.5 bg-emerald-500/80"></div>
                                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">Excelling (70%+)</span>
                                        <div className="text-4xl lg:text-5xl font-black tracking-tighter text-emerald-500">{stats.safeExcel}</div>
                                        {activeStudentId === 'all' && <span className="text-[9px] font-bold text-zinc-400 mt-2">Students</span>}
                                    </div>
                                </div>

                                {/* Table View */}
                                <div className="bg-[var(--bg-card)] rounded-[2.5rem] border-2 border-[var(--border-primary)] shadow-[var(--shadow-xl)] overflow-hidden flex flex-col">
                                    <div className="p-6 border-b-2 border-[var(--border-primary)]">
                                        <h3 className="text-sm font-black uppercase tracking-widest text-zinc-900 dark:text-white">Record Ledger</h3>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-zinc-50 dark:bg-white/5 text-[9px] font-black uppercase tracking-widest text-zinc-500 border-b border-zinc-200 dark:border-white/5">
                                                    <th className="py-4 px-6">Student</th>
                                                    <th className="py-4 px-6">Assignment</th>
                                                    <th className="py-4 px-6">Submission Status</th>
                                                    <th className="py-4 px-6">Score</th>
                                                </tr>
                                            </thead>
                                            <tbody className="text-sm font-medium">
                                                {submissions
                                                    .filter(s => activeAssignmentId === 'all' || s.assignment_id === activeAssignmentId)
                                                    .filter(s => activeStudentId === 'all' || s.student_id === activeStudentId)
                                                    .map(sub => {
                                                        const stud = students.find(s => s.id === sub.student_id);
                                                        const assign = assignments.find(a => a.id === sub.assignment_id);
                                                        const isGraded = sub.grade !== null && sub.grade !== undefined;

                                                        return (
                                                            <tr key={sub.id} className="border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors">
                                                                <td className="py-4 px-6 text-zinc-900 dark:text-white">
                                                                    {sub.student_name || 'Unknown'}
                                                                </td>
                                                                <td className="py-4 px-6 text-zinc-600 dark:text-zinc-300">
                                                                    {assign?.assignment_name || assign?.name || 'Unknown'}
                                                                </td>
                                                                <td className="py-4 px-6">
                                                                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${isGraded ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'}`}>
                                                                        {isGraded ? 'Evaluated' : 'Pending'}
                                                                    </span>
                                                                </td>
                                                                <td className="py-4 px-6">
                                                                    {isGraded ? (
                                                                        <span className="font-black text-zinc-900 dark:text-white">
                                                                            {sub.grade}% <span className="text-[10px] text-zinc-400 font-medium ml-1">({sub.rawScore}/{sub.maxPoints})</span>
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-zinc-400 italic">—</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                            </tbody>
                                        </table>
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

export default Gradebook;



