
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';
import AppSidebar from '@/src/components/layout/AppSidebar';
import { AppPath } from '@/src/App';
import ThemeToggle from '@/src/components/ui/ThemeToggle';
import * as Icons from '@/src/components/ui/Icons';
import { GoogleGenAI, Type } from "@google/genai";
import WeeklyQuizModal from '@/src/components/modals/WeeklyQuizModal';
import { canvasAPI } from '@/src/services/canvasAPI';

interface ModuleItem {
    id: string;
    type: 'text' | 'file' | 'assignment' | 'discussion' | 'quiz';
    title: string;
    content?: string;
    linkId?: string; // ID of the file, assignment, or discussion
    points?: number; // Optional points display
    dueDate?: string; // Optional due date display
}

interface Module {
    id: string;
    title: string;
    description: string;
    is_visible: boolean;
    items: ModuleItem[];
    created_at: string;
    start_date?: string; // Weekly bound start
    end_date?: string;   // Weekly bound end
}

interface CourseModulesProps {
    onBack: () => void;
    onLogout: () => void;
    onNavigateTo: (path: AppPath, params?: { assignmentId?: string }) => void;
    currentPath: AppPath;
    role: 'teacher' | 'student';
}

const CourseModules: React.FC<CourseModulesProps> = ({ onBack, onLogout, onNavigateTo, currentPath, role }) => {
    const [modules, setModules] = useState<Module[]>([]);
    const [loading, setLoading] = useState(true);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [editingModule, setEditingModule] = useState<string | null>(null);
    const [stats, setStats] = useState<Record<string, { submitted: number; total: number }>>({});
    const [availableMaterials, setAvailableMaterials] = useState<any[]>([]);
    const [availableAssignments, setAvailableAssignments] = useState<any[]>([]);
    const [activeSelector, setActiveSelector] = useState<{ moduleId: string; itemId: string } | null>(null);
    const [quizArchitect, setQuizArchitect] = useState<{ moduleId: string; content: string } | null>(null);
    const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});

    const getStorageKey = () => {
        const courseStr = localStorage.getItem('active_canvas_course');
        if (courseStr) {
            try {
                const course = JSON.parse(courseStr);
                return `educonnect_modules_course_${course.id}`;
            } catch (e) {
                // ignore
            }
        }
        return 'educonnect_modules_v1';
    };

    const fetchDataForLinking = useCallback(async () => {
        try {
            const { data: materials } = await supabase.from('instructional_materials').select('id, title, topic');
            const { data: assignments } = await supabase.from('assignments').select('id, title, type');
            setAvailableMaterials(materials || []);
            setAvailableAssignments(assignments || []);
        } catch (err) {
            console.error("Linking data fetch failed", err);
        }
    }, []);

    const fetchStats = useCallback(async (ids: string[]) => {
        try {
            if (ids.length === 0) return;
            const { data: students } = await supabase.from('students').select('id');
            const totalStudents = students?.length || 0;

            const { data: logs } = await supabase
                .from('student_assignment_logs')
                .select('assignment_id, student_id, interaction_type')
                .in('assignment_id', ids);

            const statsMap: Record<string, { submitted: number; total: number }> = {};
            ids.forEach(id => {
                const uniqueSubmissions = new Set(
                    logs?.filter(l => l.assignment_id === id && (l.interaction_type === 'submission' || l.interaction_type === 'discussion_post'))
                        .map(l => l.student_id)
                ).size;
                statsMap[id] = { submitted: uniqueSubmissions, total: totalStudents };
            });
            setStats(prev => ({ ...prev, ...statsMap }));
        } catch (err) {
            console.error("Stats fetch failed", err);
        }
    }, []);

    const loadModules = useCallback(async () => {
        setLoading(true);
        
        let courseId = '';
        const courseStr = localStorage.getItem('active_canvas_course');
        if (courseStr) {
            try {
                courseId = JSON.parse(courseStr).id.toString();
            } catch (e) {}
        }

        try {
            if (courseId) {
                console.log("[Modules Sync] Fetching modules from Canvas API for course:", courseId);
                const canvasModules = await canvasAPI.getModules(courseId);
                
                if (canvasModules && Array.isArray(canvasModules) && canvasModules.length > 0) {
                    // Map Canvas Modules to internal format
                    const mapped: Module[] = canvasModules.map((m: any) => ({
                        id: m.id.toString(),
                        title: m.name,
                        description: m.description || 'Canvas curriculum module.',
                        is_visible: m.published !== false,
                        created_at: m.created_at || new Date().toISOString(),
                        items: (m.items || []).map((item: any) => {
                            let type: ModuleItem['type'] = 'text';
                            if (item.type === 'File') type = 'file';
                            else if (item.type === 'Assignment') type = 'assignment';
                            else if (item.type === 'Discussion') type = 'discussion';
                            else if (item.type === 'Quiz') type = 'quiz';
                            else if (item.type === 'SubHeader') type = 'text';

                            return {
                                id: item.id.toString(),
                                type,
                                title: item.title,
                                linkId: item.content_id ? item.content_id.toString() : undefined,
                                points: item.points_possible || undefined,
                                dueDate: item.due_at || undefined
                            };
                        })
                    }));

                    setModules(mapped);
                    localStorage.setItem(getStorageKey(), JSON.stringify(mapped));

                    // Auto expand all
                    const initialExpanded: Record<string, boolean> = {};
                    mapped.forEach((m: Module) => initialExpanded[m.id] = true);
                    setExpandedModules(initialExpanded);

                    const ids = mapped.flatMap((m: Module) =>
                        m.items.filter(i => (i.type === 'assignment' || i.type === 'discussion') && i.linkId).map(i => i.linkId as string)
                    );
                    if (ids.length > 0 && role === 'teacher') fetchStats(ids);
                    
                    setLoading(false);
                    return;
                }
            }
        } catch (err) {
            console.warn("[Modules Sync] Failed to sync live Canvas modules, falling back to local cache:", err);
        }

        const saved = localStorage.getItem(getStorageKey());
        if (saved) {
            const parsed = JSON.parse(saved);
            setModules(parsed);

            // Auto expand all by default initially
            const initialExpanded: Record<string, boolean> = {};
            parsed.forEach((m: Module) => initialExpanded[m.id] = true);
            setExpandedModules(initialExpanded);

            const ids = parsed.flatMap((m: Module) =>
                m.items.filter(i => (i.type === 'assignment' || i.type === 'discussion') && i.linkId).map(i => i.linkId as string)
            );
            if (ids.length > 0 && role === 'teacher') fetchStats(ids);
        } else {
            // Default initial modules matching current date
            const today = new Date();
            const nextWeek = new Date(today);
            nextWeek.setDate(nextWeek.getDate() + 7);

            const initial: Module[] = [
                {
                    id: 'mod-1',
                    title: 'Module 1 - Week 1: Introduction to Big Data',
                    description: 'Welcome to the course! This module covers the basics of Big Data and its ecosystem.',
                    is_visible: true,
                    created_at: today.toISOString(),
                    start_date: today.toISOString(),
                    end_date: nextWeek.toISOString(),
                    items: [
                        { id: 'item-1', type: 'text', title: 'Welcome Message', content: 'Please review the syllabus and introductory slides before our first lab.' },
                        { id: 'item-2', type: 'file', title: 'Course Syllabus', linkId: 'syllabus-pdf' },
                        { id: 'item-3', type: 'discussion', title: 'Icebreaker: Introduce Yourself', linkId: 'disc-1', points: 5, dueDate: new Date(today.getTime() + 86400000 * 3).toISOString() }
                    ]
                }
            ];
            setModules(initial);
            setExpandedModules({ 'mod-1': true });
            localStorage.setItem(getStorageKey(), JSON.stringify(initial));
        }
        setLoading(false);
    }, [fetchStats, role]);

    useEffect(() => {
        loadModules();
        if (role === 'teacher') {
            fetchDataForLinking();
        }
    }, [loadModules, fetchDataForLinking, role]);

    const saveModules = (updated: Module[]) => {
        setModules(updated);
        localStorage.setItem(getStorageKey(), JSON.stringify(updated));
    };

    const addModule = () => {
        const today = new Date();
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);

        const newMod: Module = {
            id: `mod-${Date.now()}`,
            title: `Module ${modules.length + 1} - Week ${modules.length + 1}`,
            description: 'Enter module objectives here...',
            is_visible: false,
            created_at: today.toISOString(),
            start_date: today.toISOString(),
            end_date: nextWeek.toISOString(),
            items: []
        };
        saveModules([...modules, newMod]);
        setExpandedModules(prev => ({ ...prev, [newMod.id]: true }));
        setEditingModule(newMod.id);
    };

    const deleteModule = (id: string) => {
        if (window.confirm("Delete this module and all its contents?")) {
            saveModules(modules.filter(m => m.id !== id));
        }
    };

    const toggleVisibility = (id: string) => {
        saveModules(modules.map(m => m.id === id ? { ...m, is_visible: !m.is_visible } : m));
    };

    const toggleExpand = (id: string) => {
        setExpandedModules(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const updateModule = (id: string, field: keyof Module, value: any) => {
        saveModules(modules.map(m => m.id === id ? { ...m, [field]: value } : m));
    };

    const addItem = (moduleId: string, type: ModuleItem['type']) => {
        const newItem: ModuleItem = {
            id: `item-${Date.now()}`,
            type,
            title: type === 'text' ? 'New Instruction' : `Link to ${type}`,
            content: type === 'text' ? 'Type your content here...' : ''
        };
        saveModules(modules.map(m => m.id === moduleId ? { ...m, items: [...m.items, newItem] } : m));
        if (type !== 'text') setActiveSelector({ moduleId, itemId: newItem.id });
    };

    const removeItem = (moduleId: string, itemId: string) => {
        saveModules(modules.map(m => m.id === moduleId ? { ...m, items: m.items.filter(i => i.id !== itemId) } : m));
    };

    const linkItem = (moduleId: string, itemId: string, itemData: any) => {
        saveModules(modules.map(m => m.id === moduleId ? {
            ...m,
            items: m.items.map(i => i.id === itemId ? { ...i, title: itemData.title, linkId: itemData.id } : i)
        } : m));
        setActiveSelector(null);
        if (itemData.id) fetchStats([itemData.id]);
    };

    const handleItemClick = (item: ModuleItem) => {
        if (editingModule) return;
        if (!item.linkId) return;

        if (role === 'teacher') {
            switch (item.type) {
                case 'file': onNavigateTo('teacher-dashboard'); break;
                case 'assignment': onNavigateTo('teacher-assignments'); break;
                case 'discussion': onNavigateTo('teacher-discussions'); break;
            }
        } else {
            switch (item.type) {
                case 'file': onNavigateTo('student-materials'); break;
                case 'assignment': onNavigateTo('student-assignment', { assignmentId: item.linkId }); break;
                case 'discussion': onNavigateTo('student-discussion', { assignmentId: item.linkId }); break;
                case 'quiz': onNavigateTo('student-assignment', { assignmentId: item.linkId }); break;
            }
        }
    };

    const startQuizArchitect = async (module: Module) => {
        let contentStr = `Module: ${module.title}\nDescription: ${module.description}\n\n`;
        module.items.forEach(item => {
            if (item.type === 'text') contentStr += `Instructional Text: ${item.title}\n${item.content}\n\n`;
            if (item.type === 'file' && item.linkId) {
                const asset = availableMaterials.find(a => a.id === item.linkId);
                if (asset) contentStr += `Reference Asset: ${asset.title}\nDescription: ${asset.description}\n\n`;
            }
        });
        setQuizArchitect({ moduleId: module.id, content: contentStr });
    };

    return (
        <div className="flex h-screen bg-[var(--bg-main)] overflow-hidden font-['Plus_Jakarta_Sans'] transition-colors">
            <AppSidebar
                role={role}
                currentPath={currentPath}
                onNavigateTo={onNavigateTo}
                collapsed={sidebarCollapsed}
                setCollapsed={setSidebarCollapsed}
                onLogout={onLogout}
            />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                {/* Header */}
                <header className="h-20 bg-[var(--bg-card)] border-b-2 border-[var(--border-primary)] flex items-center justify-between px-8 shrink-0 z-20 shadow-sm transition-all bg-white/50 backdrop-blur-md">
                    <div className="flex items-center space-x-4">
                        <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tighter uppercase font-['Space_Grotesk']">Course Modules</h1>
                        <div className="h-6 w-px bg-[var(--border-primary)]"></div>
                        <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Curriculum Builder</span>
                    </div>
                    <div className="flex items-center space-x-6">
                        <ThemeToggle />
                        {role === 'teacher' && (
                            <button
                                onClick={addModule}
                                className="flex items-center space-x-2 px-6 py-3 bg-[var(--brand-primary)] hover:scale-[1.02] text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-lg active:scale-95"
                            >
                                <Icons.IconPlus className="w-4 h-4" />
                                <span>Add Module</span>
                            </button>
                        )}
                    </div>
                </header>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scroll-smooth scrollbar-hide">
                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <div className="w-10 h-10 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
                        </div>
                    ) : modules.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-96 text-center">
                            <div className="w-20 h-20 bg-[var(--bg-card)] rounded-3xl flex items-center justify-center text-4xl mb-6 shadow-xl border-2 border-[var(--border-primary)]">📦</div>
                            <h2 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight mb-2">Curriculum Interface Ready</h2>
                            <p className="text-[var(--text-muted)] font-medium max-w-sm">
                                {role === 'teacher'
                                    ? "Start building your weekly modules by clicking the button above."
                                    : "Scanning for published curriculum modules..."}
                            </p>
                        </div>
                    ) : (
                        <div className="max-w-5xl mx-auto space-y-4">
                            {modules.filter(m => role === 'teacher' || m.is_visible).length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-64 text-center mt-12 bg-white/50 backdrop-blur-md rounded-3xl border border-zinc-200 shadow-sm p-8">
                                    <div className="w-16 h-16 bg-[var(--bg-muted)] rounded-2xl flex items-center justify-center text-3xl mb-4 shadow-sm border border-zinc-300">⏳</div>
                                    <h3 className="text-lg font-black text-zinc-800 uppercase tracking-tight mb-2">No Content Available</h3>
                                    <p className="text-zinc-500 font-medium max-w-sm text-sm">
                                        Your instructor has not published any modules for this course yet. Check back later!
                                    </p>
                                </div>
                            ) : (
                                modules.filter(m => role === 'teacher' || m.is_visible).map((module) => {
                                    const isExpanded = expandedModules[module.id];
                                    return (
                                        <div
                                            key={module.id}
                                            className={`bg-white dark:bg-[#0B1120] border border-zinc-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm transition-all duration-300 ${editingModule === module.id ? 'ring-2 ring-indigo-500 shadow-lg' : ''}`}
                                        >
                                            {/* Accordion Header */}
                                            <div className="bg-zinc-50 dark:bg-white/5 border-b border-zinc-200 dark:border-white/10 flex items-center pr-4">
                                                <button
                                                    onClick={() => toggleExpand(module.id)}
                                                    className="p-4 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
                                                >
                                                    <Icons.IconChevronDown className={`w-5 h-5 transition-transform duration-300 ${isExpanded ? '' : '-rotate-90'}`} />
                                                </button>

                                                <div className="flex-1 py-3 flex items-center">
                                                    {editingModule === module.id ? (
                                                        <input
                                                            value={module.title}
                                                            onChange={(e) => updateModule(module.id, 'title', e.target.value)}
                                                            className="w-full max-w-md text-base font-black bg-white dark:bg-[#0B1120] px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-white/20 focus:ring-2 focus:ring-indigo-500 text-zinc-900 dark:text-white placeholder-zinc-400"
                                                            placeholder="Module Title..."
                                                            autoFocus
                                                        />
                                                    ) : (
                                                        <h2 className="text-base font-black text-zinc-900 dark:text-white tracking-tight">{module.title}</h2>
                                                    )}
                                                </div>

                                                {role === 'teacher' && (
                                                    <div className="flex items-center space-x-2">
                                                        <button
                                                            onClick={() => toggleVisibility(module.id)}
                                                            className="p-2 transition-colors hover:bg-zinc-200 dark:hover:bg-white/10 rounded-full"
                                                            title={module.is_visible ? "Published" : "Draft"}
                                                        >
                                                            {module.is_visible ? <Icons.IconCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-500" /> : <Icons.IconEyeOff className="w-5 h-5 text-zinc-400" />}
                                                        </button>
                                                        <button onClick={() => addItem(module.id, 'text')} className="p-2 transition-colors hover:bg-zinc-200 dark:hover:bg-white/10 rounded-full text-zinc-500 hover:text-zinc-900 dark:hover:text-white" title="Add Item">
                                                            <Icons.IconPlus className="w-5 h-5" />
                                                        </button>
                                                        <div className="relative group/menu">
                                                            <button className="p-2 transition-colors hover:bg-zinc-200 dark:hover:bg-white/10 rounded-full text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                                                                <Icons.IconList className="w-5 h-5" />
                                                            </button>
                                                            <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-[#0B1120] border border-zinc-200 dark:border-white/10 rounded-xl shadow-xl opacity-0 invisible group-hover/menu:opacity-100 group-hover/menu:visible transition-all z-50 py-1">
                                                                <button onClick={() => setEditingModule(editingModule === module.id ? null : module.id)} className="w-full text-left px-4 py-2 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5">
                                                                    {editingModule === module.id ? 'Save Edits' : 'Edit Title/Dates'}
                                                                </button>
                                                                <button onClick={() => startQuizArchitect(module)} className="w-full text-left px-4 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10">
                                                                    Architect Quiz
                                                                </button>
                                                                <div className="h-px bg-zinc-200 dark:bg-white/10 my-1"></div>
                                                                <button onClick={() => deleteModule(module.id)} className="w-full text-left px-4 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                                                                    Delete Module
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Accordion Content */}
                                            {isExpanded && (
                                                <div className="bg-white dark:bg-[#0B1120]">
                                                    {/* Date Editor visible only in edit mode */}
                                                    {editingModule === module.id && (
                                                        <div className="p-4 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5 flex flex-wrap gap-4 text-xs font-medium">
                                                            <div>
                                                                <label className="text-[10px] uppercase tracking-widest text-zinc-500 block mb-1">Start Date</label>
                                                                <input
                                                                    type="date"
                                                                    value={module.start_date ? new Date(module.start_date).toISOString().split('T')[0] : ''}
                                                                    onChange={(e) => updateModule(module.id, 'start_date', new Date(e.target.value).toISOString())}
                                                                    className="bg-white dark:bg-[#0B1120] border border-zinc-200 dark:border-white/10 rounded px-2 py-1"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="text-[10px] uppercase tracking-widest text-zinc-500 block mb-1">End Date</label>
                                                                <input
                                                                    type="date"
                                                                    value={module.end_date ? new Date(module.end_date).toISOString().split('T')[0] : ''}
                                                                    onChange={(e) => updateModule(module.id, 'end_date', new Date(e.target.value).toISOString())}
                                                                    className="bg-white dark:bg-[#0B1120] border border-zinc-200 dark:border-white/10 rounded px-2 py-1"
                                                                />
                                                            </div>
                                                            <div className="w-full mt-2">
                                                                <label className="text-[10px] uppercase tracking-widest text-zinc-500 block mb-1">Description</label>
                                                                <textarea
                                                                    value={module.description}
                                                                    onChange={(e) => updateModule(module.id, 'description', e.target.value)}
                                                                    className="w-full bg-white dark:bg-[#0B1120] border border-zinc-200 dark:border-white/10 rounded p-2 resize-none"
                                                                    rows={2}
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                    {module.items.length === 0 ? (
                                                        <div className="py-6 px-12">
                                                            <div className="text-[11px] font-black text-zinc-400 uppercase tracking-widest border-2 border-dashed border-zinc-200 dark:border-white/10 rounded-xl p-4 text-center">
                                                                Drop items here to add to module
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col">
                                                            {module.items.map((item) => (
                                                                <div key={item.id} className="group/item relative flex items-center border-b border-zinc-100 dark:border-white/5 last:border-b-0 pl-12 pr-4 py-3 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors">

                                                                    {/* Left indent indicators (Optional visual cue) */}
                                                                    <div className="absolute left-10 top-0 bottom-0 w-0.5 bg-emerald-500"></div>

                                                                    {/* Drag handle */}
                                                                    <div className="absolute left-3 text-zinc-300 dark:text-zinc-600 cursor-move">
                                                                        <Icons.IconList className="w-4 h-4 opacity-0 group-hover/item:opacity-100 transition-opacity" />
                                                                    </div>

                                                                    {/* Icon Type */}
                                                                    <div className="mr-3 text-emerald-600 dark:text-emerald-500">
                                                                        {item.type === 'file' || item.type === 'text' ? <Icons.IconUpload className="w-5 h-5" /> :
                                                                            item.type === 'discussion' ? <Icons.IconChat className="w-5 h-5" /> :
                                                                                <Icons.IconCheck className="w-5 h-5" />}
                                                                    </div>

                                                                    <div className="flex-1 min-w-0" onClick={() => handleItemClick(item)} style={{ cursor: item.linkId ? 'pointer' : 'default' }}>
                                                                        {editingModule === module.id ? (
                                                                            <div className="flex flex-col w-full">
                                                                                <input
                                                                                    value={item.title}
                                                                                    onChange={(e) => {
                                                                                        const updatedItems = module.items.map(i => i.id === item.id ? { ...i, title: e.target.value } : i);
                                                                                        updateModule(module.id, 'items', updatedItems);
                                                                                    }}
                                                                                    className="text-sm font-medium text-zinc-900 dark:text-white bg-transparent border-b border-zinc-300 dark:border-zinc-700 focus:outline-none focus:border-indigo-500 py-1 w-full max-w-sm"
                                                                                    placeholder="Item Title"
                                                                                />
                                                                                {item.type === 'text' && (
                                                                                    <input
                                                                                        value={item.content || ''}
                                                                                        onChange={(e) => {
                                                                                            const updatedItems = module.items.map(i => i.id === item.id ? { ...i, content: e.target.value } : i);
                                                                                            updateModule(module.id, 'items', updatedItems);
                                                                                        }}
                                                                                        className="text-[10px] text-zinc-500 bg-transparent border-b border-zinc-200 mt-1 focus:outline-none w-full max-w-lg"
                                                                                        placeholder="Sub-text content"
                                                                                    />
                                                                                )}
                                                                            </div>
                                                                        ) : (
                                                                            <>
                                                                                <div className={`text-sm font-medium text-zinc-900 dark:text-white ${item.linkId ? 'hover:underline text-indigo-600 dark:text-indigo-400' : ''}`}>
                                                                                    {item.title}
                                                                                </div>
                                                                                {(item.dueDate || item.points || item.content) && (
                                                                                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 font-medium flex items-center space-x-2">
                                                                                        {item.dueDate && <span>{new Date(item.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                                                                                        {item.dueDate && item.points && <span>|</span>}
                                                                                        {item.points && <span>{item.points} pts</span>}
                                                                                        {!item.dueDate && !item.points && item.content && <span>{item.content}</span>}
                                                                                    </div>
                                                                                )}
                                                                            </>
                                                                        )}
                                                                    </div>

                                                                    {/* Right Icons: Checkmark and Options */}
                                                                    <div className="flex items-center space-x-4 pl-4 shrink-0">
                                                                        {role === 'teacher' && item.linkId && stats[item.linkId] && (
                                                                            <span className="text-[10px] font-black text-indigo-500 hidden md:block">
                                                                                {stats[item.linkId].submitted}/{stats[item.linkId].total} SUBS
                                                                            </span>
                                                                        )}
                                                                        <Icons.IconCheck className="w-5 h-5 text-emerald-500" />
                                                                        {role === 'teacher' && (
                                                                            <div className="relative group/edit">
                                                                                <button className="text-zinc-400 hover:text-zinc-600 p-1">
                                                                                    <Icons.IconList className="w-5 h-5" />
                                                                                </button>
                                                                                <div className="absolute right-0 top-full mt-1 w-32 bg-white dark:bg-[#0B1120] border border-zinc-200 dark:border-white/10 rounded-lg shadow-lg opacity-0 invisible group-hover/edit:opacity-100 group-hover/edit:visible transition-all z-20">
                                                                                    <button onClick={(e) => { e.stopPropagation(); setActiveSelector({ moduleId: module.id, itemId: item.id }); }} className="w-full text-left px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50">Link Asset</button>
                                                                                    <button onClick={(e) => { e.stopPropagation(); removeItem(module.id, item.id); }} className="w-full text-left px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50">Remove</button>
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    {/* Relinking Modal Popup for this Item */}
                                                                    {activeSelector?.itemId === item.id && (
                                                                        <div className="absolute inset-x-12 top-0 bottom-0 bg-white/95 dark:bg-navy-900/95 z-20 flex items-center space-x-2 animate-fade-in px-4">
                                                                            <span className="text-[10px] font-black uppercase text-zinc-400 whitespace-nowrap">Link to:</span>
                                                                            <div className="flex-1 overflow-x-auto flex space-x-2 scrollbar-hide py-1">
                                                                                {(item.type === 'file' ? availableMaterials : availableAssignments)
                                                                                    .filter(a => item.type !== 'discussion' || a.type === 'discussion')
                                                                                    .filter(a => item.type !== 'assignment' || a.type !== 'discussion')
                                                                                    .map(asset => (
                                                                                        <button
                                                                                            key={asset.id}
                                                                                            onClick={(e) => { e.stopPropagation(); linkItem(module.id, item.id, asset); }}
                                                                                            className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-[10px] font-bold rounded-full whitespace-nowrap"
                                                                                        >
                                                                                            {asset.title}
                                                                                        </button>
                                                                                    ))}
                                                                                {(item.type === 'file' ? availableMaterials : availableAssignments).length === 0 && (
                                                                                    <span className="text-[10px] font-bold text-rose-400 italic mt-1">No items found</span>
                                                                                )}
                                                                            </div>
                                                                            <button onClick={(e) => { e.stopPropagation(); setActiveSelector(null); }} className="text-[10px] font-black text-rose-500 hover:text-rose-600 px-2">Cancel</button>
                                                                        </div>
                                                                    )}

                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {editingModule === module.id && (
                                                        <div className="p-4 bg-zinc-50 dark:bg-white/5 border-t border-zinc-100 dark:border-white/5 flex gap-2">
                                                            <button onClick={() => addItem(module.id, 'text')} className="p-2 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-lg text-[10px] font-black uppercase text-zinc-600 dark:text-zinc-400 transition-colors flex items-center gap-1">+ Text</button>
                                                            <button onClick={() => addItem(module.id, 'file')} className="p-2 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-lg text-[10px] font-black uppercase text-zinc-600 dark:text-zinc-400 transition-colors flex items-center gap-1">+ Material</button>
                                                            <button onClick={() => addItem(module.id, 'assignment')} className="p-2 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-lg text-[10px] font-black uppercase text-zinc-600 dark:text-zinc-400 transition-colors flex items-center gap-1">+ Assgn</button>
                                                            <button onClick={() => addItem(module.id, 'discussion')} className="p-2 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-lg text-[10px] font-black uppercase text-zinc-600 dark:text-zinc-400 transition-colors flex items-center gap-1">+ Discus</button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }))}
                        </div>
                    )}
                </div>
            </main>

            {quizArchitect && (
                <WeeklyQuizModal
                    moduleId={quizArchitect.moduleId}
                    moduleContent={quizArchitect.content}
                    courseId={(()=>{
                        const str = localStorage.getItem('active_canvas_course');
                        return str ? JSON.parse(str).id : 'BIG_DATA_2026';
                    })()}
                    onClose={() => setQuizArchitect(null)}
                    onApproved={(quizData) => {
                        const updated = modules.map(m => {
                            if (m.id === quizArchitect.moduleId) {
                                return {
                                    ...m,
                                    items: [...m.items, {
                                        id: `item-${Date.now()}`,
                                        type: 'quiz' as const,
                                        title: quizData.title,
                                        linkId: quizData.id
                                    }]
                                };
                            }
                            return m;
                        });
                        saveModules(updated);
                        setQuizArchitect(null);
                    }}
                />
            )}
            {/* Global CSS for some effects */}
            <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        @keyframes fade-in-right {
          from { opacity: 0; transform: translateX(10px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in-right {
          animation: fade-in-right 0.3s ease-out forwards;
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-out forwards;
        }
      `}</style>
        </div>
    );
};

export default CourseModules;



