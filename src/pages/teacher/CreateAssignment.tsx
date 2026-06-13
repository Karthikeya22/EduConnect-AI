import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { gsap } from 'gsap';
import AppSidebar from '@/src/components/layout/AppSidebar';
import { AppPath } from '@/src/App';
import * as Icons from '@/src/components/ui/Icons';
import { Skeleton } from '@/src/components/ui/Skeleton';
import ThemeToggle from '@/src/components/ui/ThemeToggle';
import { canvasAPI } from '@/src/services/canvasAPI';

interface CreateAssignmentProps {
  onBack: () => void;
  onNavigateTo: (path: AppPath) => void;
  onLogout: () => void;
  currentPath?: AppPath;
}

interface Course {
  id: number;
  name: string;
  course_code: string;
}

interface Assignment {
  id: number;
  name: string;
  description: string;
  due_at: string;
  points_possible: number;
  submission_types: string[];
  html_url: string;
  published: boolean;
}

const CreateAssignment: React.FC<CreateAssignmentProps> = ({ onBack, onNavigateTo, onLogout, currentPath = 'teacher-assignments' }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeCourse, setActiveCourse] = useState<Course | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);

  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const rawCourse = localStorage.getItem('active_canvas_course');
    if (!rawCourse) {
      onNavigateTo('teacher-select-course');
    } else {
      const parsed = JSON.parse(rawCourse);
      setActiveCourse(parsed);
      fetchAssignments(parsed.id.toString());
    }
    gsap.from(".animate-in", { opacity: 0, y: 20, stagger: 0.1, duration: 0.6, ease: "power2.out" });
  }, []);

  const fetchAssignments = async (courseId: string) => {
    setAssignmentsLoading(true);
    try {
      const data = await canvasAPI.getAssignments(courseId);
      setAssignments(data || []);
    } catch (e) {
      console.warn("Could not fetch Canvas assignments", e);
      setAssignments([]);
    } finally {
      setAssignmentsLoading(false);
      setLoading(false);
    }
  };

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

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header matched to Asset Hub */}
        <header className="h-20 bg-[var(--bg-card)] border-b-2 border-[var(--border-primary)] flex items-center justify-between px-8 shrink-0 z-20 shadow-sm relative">
          <div className="flex items-center space-x-4">
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter uppercase font-['Space_Grotesk']">Classroom</h1>
            <div className="h-6 w-px bg-zinc-200 dark:bg-white/10"></div>
            <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Canvas Assignments</span>
          </div>
          
          {/* Read Only Badge */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-500/10 px-4 py-1.5 rounded-full border-2 border-indigo-100 dark:border-indigo-500/20">
            <Icons.IconCheck className="w-4 h-4 text-indigo-500" />
            <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">Read-Only Canvas Sync</span>
          </div>

          <div className="flex items-center space-x-4">
            <ThemeToggle />
            <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-zinc-50 dark:hover:bg-white/5 flex items-center justify-center text-zinc-400 dark:text-zinc-500 transition-colors">✕</button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 lg:p-12 scroll-smooth bg-[var(--bg-main)]">
          <div className="max-w-[1400px] mx-auto flex flex-col space-y-8 animate-in pb-20">
            
            {/* Banner & Course Selector */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 bg-gradient-to-r from-blue-700 to-indigo-800 rounded-[2.5rem] p-10 shadow-xl text-white relative overflow-visible">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
              
              <div className="relative z-10 space-y-4">
                <button onClick={onBack} className="flex items-center space-x-2 text-white font-black text-[10px] uppercase tracking-[0.2em] hover:opacity-80 transition-all">
                  <span>← ARCHIVE HUB</span>
                </button>
                <div>
                  <h2 className="text-4xl font-black tracking-tighter leading-[1.1]">Assignments Explorer</h2>
                  <p className="text-blue-200 font-bold mt-2 text-sm max-w-lg">
                    This module strictly reflects your live Canvas assignments. Creation and editing must be performed directly in the Canvas LMS.
                  </p>
                </div>
              </div>
              {/* Course Selector inside Banner (Now just Switch Course) */}
              <div className="relative z-50 min-w-[300px]">
                <button 
                  onClick={() => onNavigateTo('teacher-select-course')}
                  className="w-full flex items-center justify-between px-5 py-4 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl hover:bg-white/20 transition-all shadow-sm group"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                      <Icons.IconChart className="w-4 h-4 text-white" />
                    </div>
                    <div className="text-left">
                      <div className="text-[10px] font-black uppercase tracking-widest text-white/70">Filtering By Course</div>
                      <div className="text-sm font-bold text-white tracking-tight">
                        {activeCourse?.name || 'Select Course'}
                      </div>
                    </div>
                  </div>
                  <div className="px-3 py-1.5 rounded-lg bg-white/10 text-[10px] font-black tracking-widest uppercase">Switch</div>
                </button>
              </div>
            </div>

            {/* Assignments Grid */}
            <div className="ui-card p-10 flex flex-col relative z-10">
              <div className="flex items-center justify-between mb-8 border-b border-[var(--border-primary)] pb-6">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-500">
                    <Icons.IconBook className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight">Active Assignments</h3>
                    <p className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Live from Canvas via API</p>
                  </div>
                </div>
                <div className="bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 px-4 py-2 rounded-xl text-xs font-bold border border-green-200 dark:border-green-500/20">
                  {assignments.length} assignments synced
                </div>
              </div>

              {loading || assignmentsLoading ? (
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="p-6 bg-[var(--bg-nested)] rounded-3xl border border-[var(--border-strong)] space-y-4">
                      <Skeleton className="h-6 w-3/4 rounded-lg bg-[var(--border-primary)]" />
                      <Skeleton className="h-4 w-1/2 rounded-lg bg-[var(--border-primary)]" />
                      <div className="pt-4 flex justify-between">
                        <Skeleton className="h-8 w-16 rounded-lg bg-[var(--border-primary)]" />
                        <Skeleton className="h-8 w-16 rounded-lg bg-[var(--border-primary)]" />
                      </div>
                    </div>
                  ))}
                 </div>
              ) : assignments.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pr-2 pb-10">
                  {assignments.map(assignment => (
                    <div 
                      key={assignment.id} 
                      className="group p-6 bg-[var(--bg-nested)] rounded-3xl border-2 border-transparent hover:border-indigo-500 transition-all cursor-default relative overflow-hidden flex flex-col h-[240px] justify-between shadow-sm"
                    >
                      {/* Published Status Ribbon */}
                      <div className={`absolute top-0 right-0 px-4 py-1 text-[9px] font-black uppercase tracking-widest rounded-bl-xl ${assignment.published ? 'bg-green-500 text-white' : 'bg-amber-500 text-white'}`}>
                        {assignment.published ? 'Published' : 'Draft in Canvas'}
                      </div>

                      <div className="flex-1 mt-4">
                         <h4 className="font-bold text-lg text-[var(--text-primary)] tracking-tight leading-snug line-clamp-2" title={assignment.name}>{assignment.name}</h4>
                         <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mt-2">
                           {assignment.submission_types.join(', ').replace(/_/g, ' ')}
                         </p>
                      </div>

                      <div className="pt-4 border-t border-[var(--border-primary)] flex justify-between items-end mt-4">
                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Due Date</p>
                          <p className="text-xs font-bold text-[var(--text-primary)]">
                            {assignment.due_at ? new Date(assignment.due_at).toLocaleDateString() : 'No Due Date'}
                          </p>
                        </div>
                        <div className="text-right space-y-1">
                          <p className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Points</p>
                          <p className="text-xl font-black text-[var(--brand-primary)] leading-none">{assignment.points_possible || 0}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center py-20 bg-[var(--bg-nested)] border-2 border-dashed border-[var(--border-strong)] rounded-3xl">
                  <Icons.IconBook className="w-12 h-12 text-[var(--text-muted)] mb-4" />
                  <h4 className="text-xl font-black text-[var(--text-primary)] tracking-tight">No Assignments Found</h4>
                  <p className="text-[var(--text-muted)] text-sm font-bold mt-2">There are no assignments for this course in Canvas.</p>
                </div>
              )}
            </div>

          </div>
        </div>
      </main>

      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fade-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-fade-up { animation: fade-up 0.2s ease-out forwards; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
};

export default CreateAssignment;



