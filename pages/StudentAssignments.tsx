
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';
import ThemeToggle from '../components/ThemeToggle';
import * as Icons from '../components/Icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { DashboardSkeleton } from '../components/Skeleton';

dayjs.extend(relativeTime);

interface StudentAssignmentsProps {
    onBack: () => void;
    onLogout: () => void;
    onNavigateTo: (path: AppPath, params?: { assignmentId?: string }) => void;
    currentPath: AppPath;
    user?: any;
}

interface Assignment {
    id: string;
    assignment_name: string;
    assignment_type: 'quiz' | 'discussion' | 'assignment';
    topic: string;
    due_date: string;
    points_possible: number;
    isSubmitted: boolean;
    submissionDate?: string;
}

const StudentAssignments: React.FC<StudentAssignmentsProps> = ({ onBack, onLogout, onNavigateTo, currentPath, user }) => {
    const [loading, setLoading] = useState(true);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [filterType, setFilterType] = useState<'all' | 'quiz' | 'discussion' | 'assignment'>('all');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            let userId = user?.id;
            if (!userId) {
                const { data: { session } } = await supabase.auth.getSession();
                userId = session?.user?.id;
            }
            if (!userId) return;

            const { data: allAssignments } = await supabase
                .from('assignments')
                .select('*')
                .eq('course_id', 'BIG_DATA_2026')
                .order('due_date', { ascending: true });

            const { data: submissions } = await supabase
                .from('student_assignment_logs')
                .select('assignment_id, timestamp, grade')
                .eq('student_id', userId);

            const submissionMap = new Map(submissions?.map(s => [s.assignment_id, { timestamp: s.timestamp, grade: s.grade }]));

            const enriched = (allAssignments || []).map(a => {
                const sub = submissionMap.get(a.id);
                return {
                    id: a.id,
                    assignment_name: a.assignment_name,
                    assignment_type: a.assignment_type,
                    topic: a.topic,
                    due_date: a.due_date,
                    points_possible: a.points_possible,
                    isSubmitted: !!sub,
                    submissionDate: sub?.timestamp,
                    grade: sub?.grade
                };
            }) as Assignment[];

            setAssignments(enriched);
        } catch (err) {
            console.error("Failed to sync assignment ledger:", err);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        fetchData();
        const channel = supabase.channel('student_assignments_realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'student_assignment_logs' }, () => fetchData())
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [fetchData]);

    const filtered = assignments.filter(a => {
        const matchesSearch = a.assignment_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            a.topic.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesType = filterType === 'all' || a.assignment_type === filterType;
        return matchesSearch && matchesType;
    });

    const now = dayjs();
    const categories = {
        overdue: filtered.filter(a => !a.isSubmitted && dayjs(a.due_date).isBefore(now)),
        impending: filtered.filter(a => !a.isSubmitted && dayjs(a.due_date).isAfter(now) && dayjs(a.due_date).diff(now, 'hour') <= 72),
        future: filtered.filter(a => !a.isSubmitted && dayjs(a.due_date).isAfter(now) && dayjs(a.due_date).diff(now, 'hour') > 72),
        completed: filtered.filter(a => a.isSubmitted).sort((a, b) => dayjs(b.submissionDate).diff(dayjs(a.submissionDate)))
    };

    const renderAssignmentCard = (a: Assignment, status: 'overdue' | 'impending' | 'future' | 'completed') => {
        const isCritical = status === 'overdue' || status === 'impending';
        const dueDate = dayjs(a.due_date);
        const hoursLeft = dueDate.diff(now, 'hour');
        const progressPercent = Math.max(0, Math.min(100, (hoursLeft / 72) * 100)); // Visual gauge for next 72 hours

        const statusStyles = {
            overdue: "border-rose-500/30 bg-rose-50/30 dark:bg-rose-500/5 shadow-rose-200/20",
            impending: "border-amber-500/30 bg-amber-50/30 dark:bg-amber-500/5 shadow-amber-200/20",
            future: "border-indigo-500/20 bg-white dark:bg-[#0B1120] shadow-indigo-100/20",
            completed: "border-emerald-500/20 bg-emerald-50/20 dark:bg-emerald-500/5 opacity-80 hover:opacity-100 shadow-emerald-100/20"
        };

        const iconColors = {
            overdue: "text-rose-600 bg-rose-100 dark:bg-rose-500/20",
            impending: "text-amber-600 bg-amber-100 dark:bg-amber-500/20",
            future: "text-indigo-600 bg-indigo-100 dark:bg-indigo-500/20",
            completed: "text-emerald-600 bg-emerald-100 dark:bg-emerald-500/20"
        };

        return (
            <div
                key={a.id}
                onClick={() => onNavigateTo(a.assignment_type === 'discussion' ? 'student-discussion' : 'student-assignment', { assignmentId: a.id })}
                className={`group relative flex flex-col p-8 rounded-[2.5rem] border-2 transition-all cursor-pointer hover:scale-[1.02] hover:shadow-2xl ${statusStyles[status]}`}
            >
                {/* Survival Gauge (Personal Touch) */}
                {!a.isSubmitted && status !== 'future' && (
                    <div className="absolute top-0 left-0 right-0 h-1.5 overflow-hidden rounded-t-[2.5rem]">
                        <div
                            className={`h-full transition-all duration-1000 ${status === 'overdue' ? 'bg-rose-500 animate-pulse' : 'bg-amber-500'}`}
                            style={{ width: status === 'overdue' ? '100%' : `${100 - progressPercent}%` }}
                        />
                    </div>
                )}

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-center space-x-6">
                        <div className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center text-3xl shadow-inner ${iconColors[status]}`}>
                            {a.assignment_type === 'quiz' ? '🧠' : a.assignment_type === 'discussion' ? '💬' : '🧪'}
                        </div>
                        <div>
                            <div className="flex items-center space-x-3 mb-1">
                                <h4 className="text-xl font-black text-zinc-900 dark:text-white leading-tight uppercase tracking-tight group-hover:text-indigo-600 transition-colors">{a.assignment_name}</h4>
                                {a.points_possible >= 50 && (
                                    <span className="px-2 py-0.5 bg-indigo-600 text-white text-[8px] font-black rounded-md uppercase tracking-widest">High Stakes</span>
                                )}
                            </div>
                            <div className="flex items-center space-x-4">
                                <span className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest flex items-center">
                                    <span className="w-2 h-2 rounded-full bg-zinc-300 mr-2"></span>
                                    {a.topic}
                                </span>
                                <span className="text-[10px] font-black text-indigo-500/80 dark:text-indigo-400 uppercase tracking-widest">{a.points_possible} pts</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col md:items-end justify-center">
                        {status === 'completed' ? (
                            <div className="bg-emerald-500 text-white px-6 py-3 rounded-2xl shadow-lg shadow-emerald-500/20 flex items-center space-x-3">
                                <div className="text-right border-r border-white/20 pr-3 mr-1">
                                    <p className="text-[8px] font-black uppercase opacity-60">Score</p>
                                    <p className="text-lg font-black leading-none">{(a as any).grade !== null && (a as any).grade !== undefined ? (a as any).grade : '--'}</p>
                                </div>
                                <div className="text-left">
                                    <p className="text-[10px] font-black uppercase tracking-widest leading-none">Verified</p>
                                    <p className="text-[9px] font-bold opacity-80">{dayjs(a.submissionDate).fromNow()}</p>
                                </div>
                            </div>
                        ) : (
                            <div className={`text-right ${status === 'overdue' ? 'text-rose-600' : status === 'impending' ? 'text-amber-600' : 'text-zinc-500'}`}>
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] mb-1">
                                    {status === 'overdue' ? 'Critical Miss' : status === 'impending' ? 'Action Required' : 'Target Window'}
                                </p>
                                <p className="text-lg font-black tracking-tighter leading-none">
                                    {status === 'overdue' ? 'Expired' : status === 'impending' ? dueDate.fromNow() : dueDate.format('MMM DD')}
                                </p>
                                <p className="text-[9px] font-bold opacity-60 mt-1 uppercase tracking-widest">
                                    Due {dueDate.format('h:mm A')}
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Card Footer Integration */}
                <div className="mt-8 pt-6 border-t border-zinc-100 dark:border-white/5 flex items-center justify-between">
                    <div className="flex -space-x-2">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="w-6 h-6 rounded-full border-2 border-white dark:border-[#0B1120] bg-zinc-100 dark:bg-white/10 flex items-center justify-center text-[8px] font-bold text-zinc-400">
                                {String.fromCharCode(64 + i)}
                            </div>
                        ))}
                        <span className="ml-4 text-[9px] font-bold text-zinc-400 uppercase tracking-widest flex items-center">+12 peers tracking</span>
                    </div>
                    <button className="flex items-center space-x-2 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600 group-hover:translate-x-2 transition-transform">
                        <span>Access Lab</span>
                        <span className="text-lg">→</span>
                    </button>
                </div>
            </div>
        );
    };

    const renderEmptyState = (msg: string) => (
        <div className="py-20 px-8 text-center bg-white dark:bg-white/5 rounded-[3rem] border-4 border-dashed border-zinc-50 dark:border-white/5 shadow-inner">
            <div className="text-5xl mb-6 opacity-30">✨</div>
            <p className="text-[11px] font-black text-zinc-300 dark:text-zinc-600 uppercase tracking-[0.5em]">{msg}</p>
        </div>
    );

    return (
        <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#020617] overflow-hidden relative font-['Plus_Jakarta_Sans'] transition-colors">
            {/* Background Polish */}
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-600/5 blur-[120px] rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-emerald-600/5 blur-[120px] rounded-full translate-y-1/2 -translate-x-1/2" />

            <AppSidebar
                role="student"
                currentPath={currentPath}
                onNavigateTo={onNavigateTo}
                collapsed={sidebarCollapsed}
                setCollapsed={setSidebarCollapsed}
                onLogout={onLogout}
            />

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative backdrop-blur-3xl">
                <header className="h-24 bg-white/80 dark:bg-[#0B1120]/80 backdrop-blur-xl border-b border-zinc-100 dark:border-white/5 flex items-center justify-between px-12 shrink-0 z-40 transition-colors">
                    <div className="flex items-center space-x-8">
                        <button onClick={onBack} className="w-12 h-12 rounded-2xl bg-zinc-50 dark:bg-white/5 border border-zinc-100 dark:border-white/10 flex items-center justify-center text-zinc-400 hover:text-indigo-600 hover:border-indigo-500/30 transition-all">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                        </button>
                        <div>
                            <h1 className="text-3xl font-black text-zinc-900 dark:text-white tracking-tight uppercase font-['Space_Grotesk'] leading-none">Evaluation Ledger</h1>
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.3em] mt-1">Real-Time Synchronization: BIG_DATA_2026</p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-8">
                        <ThemeToggle />
                        <div className="h-12 w-12 bg-indigo-600 rounded-2xl flex items-center justify-center font-black text-white shadow-xl shadow-indigo-600/20">
                            {user?.user_metadata?.full_name?.charAt(0) || 'S'}
                        </div>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto p-12 scroll-smooth">
                    <div className="max-w-[1400px] mx-auto space-y-16">
                        {/* High-Impact Stat Ledger */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                            {[
                                { label: 'System Progress', val: `${assignments.length > 0 ? Math.round((assignments.filter(a => a.isSubmitted).length / assignments.length) * 100) : 0}%`, icon: '📈', color: 'text-indigo-600' },
                                { label: 'Target Misses', val: categories.overdue.length, icon: '🚨', color: 'text-rose-500' },
                                { label: 'Upcoming Tasks', val: categories.impending.length + categories.future.length, icon: '⏳', color: 'text-amber-500' },
                                { label: 'Verified Nodes', val: categories.completed.length, icon: '💎', color: 'text-emerald-500' }
                            ].map((stat, i) => (
                                <div key={i} className="bg-white dark:bg-[#0B1120] p-8 rounded-[2.5rem] border-2 border-zinc-100 dark:border-white/5 shadow-sm">
                                    <div className="flex items-center justify-between mb-4">
                                        <span className="text-2xl">{stat.icon}</span>
                                        <span className={`text-3xl font-black ${stat.color}`}>{stat.val}</span>
                                    </div>
                                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{stat.label}</p>
                                </div>
                            ))}
                        </div>

                        {/* Search & Global Filter */}
                        <div className="flex flex-col lg:flex-row gap-8 items-stretch lg:items-center bg-white dark:bg-[#0B1120] p-4 rounded-[2.5rem] border-2 border-zinc-100 dark:border-white/5 shadow-xl">
                            <div className="relative flex-1">
                                <span className="absolute left-6 top-1/2 -translate-y-1/2 text-2xl">🔍</span>
                                <input
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    placeholder="Query ledger records..."
                                    className="w-full h-16 pl-16 pr-8 bg-zinc-50 dark:bg-white/5 border-none rounded-3xl outline-none text-md font-bold text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                                />
                            </div>
                            <div className="flex bg-zinc-50 dark:bg-white/5 p-2 rounded-3xl gap-2">
                                {(['all', 'quiz', 'assignment', 'discussion'] as const).map(type => (
                                    <button
                                        key={type}
                                        onClick={() => setFilterType(type)}
                                        className={`px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${filterType === type ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'text-zinc-400 hover:text-zinc-600'
                                            }`}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {loading ? (
                            <DashboardSkeleton role="student" />
                        ) : (
                            <div className="space-y-24 animate-in fade-in slide-in-from-bottom-8 duration-1000">
                                {/* OVERDUE: HIGH CONTRAST */}
                                {(categories.overdue.length > 0 || categories.impending.length > 0) && (
                                    <section className="space-y-10">
                                        <div className="flex items-center space-x-6 pb-4 border-b-4 border-rose-500/10">
                                            <div className="w-4 h-12 bg-rose-500 rounded-full shadow-[0_0_20px_rgba(244,63,94,0.4)] animate-pulse" />
                                            <div>
                                                <h3 className="text-4xl font-black text-zinc-900 dark:text-white tracking-tighter uppercase font-['Space_Grotesk'] leading-none">Critical Operations</h3>
                                                <p className="text-[10px] font-black text-rose-500 uppercase tracking-[0.4em] mt-2">Priority levels: MAXIMUM</p>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                            {categories.overdue.map(a => renderAssignmentCard(a, 'overdue'))}
                                            {categories.impending.map(a => renderAssignmentCard(a, 'impending'))}
                                        </div>
                                    </section>
                                )}

                                {/* UPCOMING: TIMELINE VIEW */}
                                <section className="space-y-10">
                                    <div className="flex items-center space-x-6 pb-4 border-b-4 border-indigo-500/10">
                                        <div className="w-4 h-12 bg-indigo-500 rounded-full shadow-[0_0_20px_rgba(99,102,241,0.4)]" />
                                        <div>
                                            <h3 className="text-4xl font-black text-zinc-900 dark:text-white tracking-tighter uppercase font-['Space_Grotesk'] leading-none">Future Trajectory</h3>
                                            <p className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.4em] mt-2">Active Roadmap: Following 7 Days</p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                        {categories.future.length > 0 ? categories.future.map(a => renderAssignmentCard(a, 'future')) : renderEmptyState("Clear skies ahead.")}
                                    </div>
                                </section>

                                {/* COMPLETED: THE VAULT */}
                                <section className="space-y-10 bg-emerald-500/5 p-12 rounded-[4rem] border-2 border-emerald-500/10 shadow-inner">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-6">
                                            <div className="w-4 h-12 bg-emerald-500 rounded-full shadow-[0_0_20px_rgba(16,185,129,0.4)]" />
                                            <div>
                                                <h3 className="text-4xl font-black text-zinc-900 dark:text-white tracking-tighter uppercase font-['Space_Grotesk'] leading-none">The Vault</h3>
                                                <p className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.4em] mt-2">Verified Synchronization History</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-5xl font-black text-emerald-600 tracking-tighter leading-none">{categories.completed.length}</p>
                                            <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Nodes Verified</p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                        {categories.completed.length > 0 ? categories.completed.map(a => renderAssignmentCard(a, 'completed')) : renderEmptyState("No verified nodes recorded.")}
                                    </div>
                                </section>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
};

export default StudentAssignments;
