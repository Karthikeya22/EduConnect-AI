
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';
import ThemeToggle from '../components/ThemeToggle';
import * as Icons from '../components/Icons';
import { GoogleGenAI, Type } from "@google/genai";
import WeeklyQuizModal from '../components/WeeklyQuizModal';

interface ModuleItem {
    id: string;
    type: 'text' | 'file' | 'assignment' | 'discussion' | 'quiz';
    title: string;
    content?: string;
    linkId?: string; // ID of the file, assignment, or discussion
}

interface Module {
    id: string;
    title: string;
    description: string;
    is_visible: boolean;
    items: ModuleItem[];
    created_at: string;
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

    const LOCAL_STORAGE_KEY = 'educonnect_modules_v1';

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

    const loadModules = useCallback(() => {
        setLoading(true);
        const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            setModules(parsed);

            const ids = parsed.flatMap((m: Module) =>
                m.items.filter(i => (i.type === 'assignment' || i.type === 'discussion') && i.linkId).map(i => i.linkId as string)
            );
            if (ids.length > 0 && role === 'teacher') fetchStats(ids);
        } else {
            // Default initial module
            const initial: Module[] = [
                {
                    id: 'mod-1',
                    title: 'Module 1 - Week 1: Introduction to Big Data',
                    description: 'Welcome to the course! This module covers the basics of Big Data and its ecosystem.',
                    is_visible: true,
                    created_at: new Date().toISOString(),
                    items: [
                        { id: 'item-1', type: 'text', title: 'Welcome Message', content: 'Please review the syllabus and introductory slides before our first lab.' },
                        { id: 'item-2', type: 'file', title: 'Course Syllabus', linkId: 'syllabus-pdf' }
                    ]
                }
            ];
            setModules(initial);
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(initial));
        }
        setLoading(false);
    }, [fetchStats]);

    useEffect(() => {
        loadModules();
        if (role === 'teacher') {
            fetchDataForLinking();
        }
    }, [loadModules, fetchDataForLinking, role]);

    const saveModules = (updated: Module[]) => {
        setModules(updated);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
    };

    const addModule = () => {
        const newMod: Module = {
            id: `mod-${Date.now()}`,
            title: `Module ${modules.length + 1} - Week ${modules.length + 1}`,
            description: 'Enter module objectives here...',
            is_visible: false,
            created_at: new Date().toISOString(),
            items: []
        };
        saveModules([...modules, newMod]);
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
                case 'file': onNavigateTo('teacher-upload'); break;
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
                        <h1 className="text-2xl font-black bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent tracking-tighter uppercase font-['Space_Grotesk']">Course Modules</h1>
                        <div className="h-6 w-px bg-[var(--border-primary)]"></div>
                        <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Curriculum Builder</span>
                    </div>
                    <div className="flex items-center space-x-6">
                        <ThemeToggle />
                        {role === 'teacher' && (
                            <button
                                onClick={addModule}
                                className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:scale-[1.02] text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
                            >
                                <Icons.IconPlus className="w-4 h-4" />
                                <span>Add Module</span>
                            </button>
                        )}
                    </div>
                </header>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8 space-y-8 scroll-smooth scrollbar-hide">
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
                        modules.filter(m => role === 'teacher' || m.is_visible).map((module) => (
                            <div
                                key={module.id}
                                className={`ui-card group transition-all duration-500 overflow-hidden ${editingModule === module.id ? 'ring-2 ring-indigo-500 shadow-2xl scale-[1.01]' : ''}`}
                            >
                                <div className="p-8 border-b-2 border-dashed border-[var(--border-primary)] flex items-start justify-between bg-[var(--bg-card)]">
                                    <div className="flex-1 mr-8">
                                        {editingModule === module.id ? (
                                            <input
                                                value={module.title}
                                                onChange={(e) => updateModule(module.id, 'title', e.target.value)}
                                                className="w-full text-2xl font-black bg-[var(--bg-nested)] p-3 rounded-xl border-2 border-[var(--border-primary)] focus:ring-0 text-[var(--text-primary)] placeholder-zinc-400 capitalize"
                                                placeholder="Module Title..."
                                                autoFocus
                                            />
                                        ) : (
                                            <h2 className="text-2xl font-black text-[var(--text-primary)] tracking-tight mb-2 uppercase">{module.title}</h2>
                                        )}

                                        {editingModule === module.id ? (
                                            <textarea
                                                value={module.description}
                                                onChange={(e) => updateModule(module.id, 'description', e.target.value)}
                                                className="w-full mt-4 text-sm font-medium bg-[var(--bg-nested)] p-3 rounded-xl border-2 border-[var(--border-primary)] focus:ring-0 text-[var(--text-muted)] resize-none"
                                                rows={2}
                                                placeholder="Describe what students will learn..."
                                            />
                                        ) : (
                                            <p className="text-[var(--text-muted)] font-medium text-sm leading-relaxed max-w-2xl">{module.description}</p>
                                        )}
                                    </div>

                                    {role === 'teacher' && (
                                        <div className="flex items-center space-x-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => toggleVisibility(module.id)}
                                                className={`p-3 rounded-xl border-2 transition-all ${module.is_visible ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}
                                                title={module.is_visible ? "Publishing: Visible to Students" : "Draft: Hidden from Students"}
                                            >
                                                {module.is_visible ? <Icons.IconCheck className="w-5 h-5" /> : <Icons.IconEyeOff className="w-5 h-5" />}
                                            </button>
                                            <button
                                                onClick={() => setEditingModule(editingModule === module.id ? null : module.id)}
                                                className={`p-3 rounded-xl border-2 transition-all ${editingModule === module.id ? 'bg-indigo-600 text-white border-indigo-400' : 'bg-zinc-50 dark:bg-white/5 text-[var(--text-primary)] border-[var(--border-primary)]'}`}
                                            >
                                                {editingModule === module.id ? <span className="text-[10px] font-black uppercase px-2">Save</span> : <Icons.IconEdit className="w-5 h-5" />}
                                            </button>
                                            <button
                                                onClick={() => startQuizArchitect(module)}
                                                className="p-3 bg-indigo-50 text-indigo-600 border-2 border-indigo-100 rounded-xl hover:bg-indigo-100 transition-all shadow-sm flex items-center space-x-2"
                                                title="Weekly Quiz Architect"
                                            >
                                                <Icons.IconBot className="w-5 h-5" />
                                                <span className="text-[9px] font-black uppercase">Architect Quiz</span>
                                            </button>
                                            <button
                                                onClick={() => deleteModule(module.id)}
                                                className="p-3 bg-rose-50 text-rose-600 border-2 border-rose-100 rounded-xl hover:bg-rose-100 transition-all shadow-sm"
                                            >
                                                <Icons.IconTrash className="w-5 h-5" />
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="p-8 bg-[var(--bg-nested)] space-y-4">
                                    {module.items.length === 0 ? (
                                        <div className="py-12 text-center border-2 border-dashed border-[var(--border-primary)] rounded-3xl bg-[var(--bg-main)]/50">
                                            <p className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">No curriculum items defined</p>
                                            {role === 'teacher' && (
                                                <div className="mt-4 flex justify-center space-x-3">
                                                    <button onClick={() => addItem(module.id, 'text')} className="px-4 py-2 bg-white text-[9px] font-black text-indigo-600 uppercase border border-indigo-100 rounded-lg hover:bg-indigo-50 transition-all">+ Add Text</button>
                                                    <button onClick={() => addItem(module.id, 'file')} className="px-4 py-2 bg-white text-[9px] font-black text-indigo-600 uppercase border border-indigo-100 rounded-lg hover:bg-indigo-50 transition-all">+ Link Asset</button>
                                                    <button onClick={() => addItem(module.id, 'assignment')} className="px-4 py-2 bg-white text-[9px] font-black text-indigo-600 uppercase border border-indigo-100 rounded-lg hover:bg-indigo-50 transition-all">+ Link Lab</button>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        module.items.map((item) => (
                                            <div key={item.id} className="relative group/item">
                                                {item.type === 'text' ? (
                                                    <div className="bg-[var(--bg-card)] p-6 rounded-2xl border-2 border-[var(--border-primary)] shadow-sm">
                                                        <div className="flex items-center space-x-3 mb-2">
                                                            <span className="text-xl">📝</span>
                                                            {editingModule === module.id ? (
                                                                <input
                                                                    value={item.title}
                                                                    onChange={(e) => {
                                                                        const updatedItems = module.items.map(i => i.id === item.id ? { ...i, title: e.target.value } : i);
                                                                        updateModule(module.id, 'items', updatedItems);
                                                                    }}
                                                                    className="font-black text-xs uppercase tracking-widest bg-[var(--bg-nested)] p-2 rounded-lg border border-[var(--border-primary)] focus:ring-0 text-[var(--text-primary)] w-full max-w-xs"
                                                                />
                                                            ) : (
                                                                <h4 className="font-black text-xs uppercase tracking-widest text-[var(--text-primary)]">{item.title}</h4>
                                                            )}
                                                        </div>
                                                        {editingModule === module.id ? (
                                                            <textarea
                                                                value={item.content}
                                                                onChange={(e) => {
                                                                    const updatedItems = module.items.map(i => i.id === item.id ? { ...i, content: e.target.value } : i);
                                                                    updateModule(module.id, 'items', updatedItems);
                                                                }}
                                                                className="w-full text-sm font-medium bg-[var(--bg-nested)] p-4 rounded-xl border border-[var(--border-primary)] focus:ring-1 focus:ring-indigo-500 text-[var(--text-primary)] mt-2"
                                                                rows={3}
                                                            />
                                                        ) : (
                                                            <p className="text-sm font-medium text-[var(--text-muted)] leading-relaxed mt-2">{item.content}</p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div
                                                        onClick={() => handleItemClick(item)}
                                                        className="flex items-center justify-between bg-[var(--bg-card)] p-6 rounded-2xl border-2 border-[var(--border-primary)] shadow-sm hover:translate-x-1 hover:border-indigo-400 transition-all cursor-pointer overflow-hidden relative"
                                                    >
                                                        <div className="flex items-center space-x-4 z-10">
                                                            <div className="w-12 h-12 rounded-xl bg-[var(--bg-nested)] flex items-center justify-center text-xl border-2 border-[var(--border-primary)]">
                                                                {item.type === 'file' ? '📁' : item.type === 'assignment' ? '🧪' : item.type === 'quiz' ? '🧠' : '💬'}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <h4 className="font-black text-sm text-[var(--text-primary)] tracking-tight truncate">{item.title}</h4>
                                                                <div className="flex items-center space-x-3 mt-1">
                                                                    <span className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">
                                                                        {item.type.toUpperCase()} • {item.linkId ? 'SECURED LINK' : 'UNLINKED DRAFT'}
                                                                    </span>
                                                                    {role === 'teacher' && item.linkId && stats[item.linkId] && (
                                                                        <div className="flex items-center space-x-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-md text-[8px] font-black uppercase">
                                                                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse mr-1"></span>
                                                                            {stats[item.linkId].submitted}/{stats[item.linkId].total} SUBMITTED
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {activeSelector?.itemId === item.id && (
                                                            <div className="absolute inset-0 bg-white/95 dark:bg-navy-900/95 z-20 p-2 flex items-center space-x-2 animate-fade-in">
                                                                <span className="text-[10px] font-black uppercase text-zinc-400 px-4 whitespace-nowrap">Link to:</span>
                                                                <div className="flex-1 overflow-x-auto flex space-x-2 scrollbar-hide">
                                                                    {(item.type === 'file' ? availableMaterials : availableAssignments)
                                                                        .filter(a => item.type !== 'discussion' || a.type === 'discussion')
                                                                        .filter(a => item.type !== 'assignment' || a.type !== 'discussion')
                                                                        .map(asset => (
                                                                            <button
                                                                                key={asset.id}
                                                                                onClick={(e) => { e.stopPropagation(); linkItem(module.id, item.id, asset); }}
                                                                                className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-[10px] font-bold rounded-lg whitespace-nowrap border border-indigo-200"
                                                                            >
                                                                                {asset.title}
                                                                            </button>
                                                                        ))}
                                                                    {(item.type === 'file' ? availableMaterials : availableAssignments).length === 0 && (
                                                                        <span className="text-[10px] font-bold text-rose-400 italic">No items found in {item.type === 'file' ? 'Asset Hub' : 'Architect'}</span>
                                                                    )}
                                                                </div>
                                                                <button onClick={(e) => { e.stopPropagation(); setActiveSelector(null); }} className="text-[10px] font-black text-zinc-400 hover:text-zinc-900 px-4">✕</button>
                                                            </div>
                                                        )}

                                                        <div className="hidden group-hover/item:flex items-center space-x-3 z-10 transition-all animate-fade-in-right">
                                                            {editingModule === module.id && (
                                                                <>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); setActiveSelector({ moduleId: module.id, itemId: item.id }); }}
                                                                        className="w-10 h-10 flex items-center justify-center bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100 hover:bg-indigo-100"
                                                                        title="Relink Asset"
                                                                    >
                                                                        🔗
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); removeItem(module.id, item.id); }}
                                                                        className="w-10 h-10 flex items-center justify-center bg-rose-50 text-rose-500 rounded-lg border border-rose-100 hover:bg-rose-100"
                                                                    >
                                                                        ✕
                                                                    </button>
                                                                </>
                                                            )}
                                                            {!editingModule && <span className="text-indigo-400 font-black text-xl">→</span>}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}

                                    {editingModule === module.id && (
                                        <div className="pt-8 flex justify-center items-center gap-4">
                                            <div className="h-[2px] flex-1 bg-gradient-to-r from-transparent to-[var(--border-primary)]"></div>
                                            <div className="flex bg-[var(--bg-card)] p-2 rounded-[1.5rem] border-2 border-[var(--border-primary)] shadow-xl">
                                                <button onClick={() => addItem(module.id, 'text')} className="px-5 py-3 hover:bg-zinc-50 dark:hover:bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)] transition-all flex items-center space-x-3"><span>📝</span> <span>Add Guidance</span></button>
                                                <button onClick={() => addItem(module.id, 'file')} className="px-5 py-3 hover:bg-zinc-50 dark:hover:bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)] transition-all flex items-center space-x-3"><span>📁</span> <span>Link Asset</span></button>
                                                <button onClick={() => addItem(module.id, 'assignment')} className="px-5 py-3 hover:bg-zinc-50 dark:hover:bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)] transition-all flex items-center space-x-3"><span>🧪</span> <span>Link Lab</span></button>
                                                <button onClick={() => addItem(module.id, 'discussion')} className="px-5 py-3 hover:bg-zinc-50 dark:hover:bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)] transition-all flex items-center space-x-3"><span>💬</span> <span>Link Chat</span></button>
                                            </div>
                                            <div className="h-[2px] flex-1 bg-gradient-to-l from-transparent to-[var(--border-primary)]"></div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </main>

            {quizArchitect && (
                <WeeklyQuizModal
                    moduleId={quizArchitect.moduleId}
                    moduleContent={quizArchitect.content}
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
