import React, { useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import { AppPath } from '../App';
import * as Icons from './Icons';

interface AppSidebarProps {
  role: 'teacher' | 'student';
  currentPath?: AppPath;
  onNavigateTo: (path: AppPath) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  onLogout: () => void;
}

const AppSidebar: React.FC<AppSidebarProps> = ({ role, onNavigateTo, collapsed, setCollapsed, onLogout }) => {
  const iconRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const location = useLocation();
  const navigate = useNavigate();

  const teacherItems = [
    { Icon: Icons.IconHome, label: "Dashboard", id: 'teacher-dashboard', path: '/teacher/dashboard' },
    { Icon: Icons.IconCheck, label: "Evaluation Nexus", id: 'teacher-grading', path: '/teacher/grading' },
    { Icon: Icons.IconUpload, label: "Asset Hub", id: 'teacher-upload', path: '/teacher/upload' },
    { Icon: Icons.IconDraft, label: "Architect", id: 'teacher-assignments', path: '/teacher/assignments' },
    { Icon: Icons.IconList, label: "Modules", id: 'teacher-modules', path: '/teacher/modules' },
    { Icon: Icons.IconChat, label: "Discussions", id: 'teacher-discussions', path: '/teacher/discussions' },
    { Icon: Icons.IconUsers, label: "Students", id: 'teacher-analytics', path: '/teacher/analytics' },
    { Icon: Icons.IconPalette, label: "AI Persona", id: 'teacher-persona', path: '/teacher/persona' },
    { Icon: Icons.IconSettings, label: "Settings", id: 'settings', path: '/settings' },
  ];

  const studentItems = [
    { Icon: Icons.IconHome, label: "Dashboard", id: 'student-dashboard', path: '/student/dashboard' },
    { Icon: Icons.IconPen, label: "Assignments", id: 'student-assignments', path: '/student/assignments' },
    { Icon: Icons.IconBook, label: "Materials", id: 'student-materials', path: '/student/materials' },
    { Icon: Icons.IconList, label: "Modules", id: 'student-modules', path: '/student/modules' },
    { Icon: Icons.IconChart, label: "Progress", id: 'student-progress', path: '/student/progress' },
    { Icon: Icons.IconSettings, label: "Settings", id: 'settings', path: '/settings' },
  ];

  const items = role === 'teacher' ? teacherItems : studentItems;

  const isItemActive = (itemPath: string, itemId: string) => {
    if (location.pathname === itemPath) return true;
    if (itemId === 'student-dashboard' && (location.pathname.startsWith('/student/assignment') || location.pathname.startsWith('/student/discussion'))) return true;
    return false;
  };

  useEffect(() => {
    iconRefs.current.forEach((icon, i) => {
      if (!icon) return;
      const btn = icon.parentElement;
      if (!btn) return;

      const handleMove = (e: MouseEvent) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        gsap.to(icon, { x: x * 0.4, y: y * 0.4, scale: 1.1, duration: 0.3 });
      };

      const handleLeave = () => {
        gsap.to(icon, { x: 0, y: 0, scale: 1, duration: 0.5, ease: "elastic.out(1, 0.3)" });
      };

      btn.addEventListener('mousemove', handleMove as any);
      btn.addEventListener('mouseleave', handleLeave);
      return () => {
        btn.removeEventListener('mousemove', handleMove as any);
        btn.removeEventListener('mouseleave', handleLeave);
      };
    });
  }, [items, collapsed]);

  return (
    <aside className={`bg-[var(--bg-card)] border-r-2 border-[var(--border-primary)] shadow-[var(--shadow-xl)] transition-all duration-500 flex flex-col z-[100] relative h-full shrink-0 ${collapsed ? 'w-[100px]' : 'w-[280px]'}`}>

      {/* Header Area */}
      <div className="h-24 flex items-center px-6 border-b-2 border-[var(--border-primary)] shrink-0 overflow-hidden bg-white/50 backdrop-blur-md">
        <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-xl flex items-center justify-center font-black text-white shrink-0 shadow-lg shadow-indigo-600/30">
          USF
        </div>
        {!collapsed && (
          <span className="ml-4 font-black text-sm tracking-tight truncate font-['Space_Grotesk'] uppercase text-zinc-900 dark:text-white/95 whitespace-nowrap">
            {role === 'teacher' ? 'Faculty Nexus' : 'Student Hub'}
          </span>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 py-8 overflow-y-auto scrollbar-hide space-y-2 px-4">
        {items.map((item, i) => {
          const active = isItemActive(item.path, item.id);
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center px-5 py-4 rounded-2xl transition-all group relative font-black text-[11px] uppercase tracking-[0.15em] ${active
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/25 scale-[1.02]'
                : 'text-[var(--text-muted)] hover:bg-indigo-50/50 dark:hover:bg-white/5 hover:text-indigo-600'
                }`}
            >
              <span
                ref={el => { iconRefs.current[i] = el; }}
                className={`shrink-0 inline-block transition-colors ${active ? 'text-white' : 'text-zinc-400 group-hover:text-indigo-600 dark:group-hover:text-zinc-300'
                  }`}
              >
                <item.Icon className="w-6 h-6" />
              </span>

              {!collapsed && (
                <span className="ml-4 tracking-tight whitespace-nowrap">
                  {item.label}
                </span>
              )}

              {active && !collapsed && (
                <div className="absolute right-4 w-1.5 h-1.5 bg-white rounded-full animate-pulse shadow-[0_0_8px_rgba(255,255,255,1)]"></div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="mt-auto border-t border-zinc-100 dark:border-white/5 p-4 flex flex-col gap-2">
        <button
          onClick={onLogout}
          className={`w-full flex items-center px-4 py-3.5 transition-all text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-2xl group overflow-hidden font-black text-[11px] uppercase tracking-widest`}
        >
          <span className="shrink-0 transition-transform group-hover:rotate-12">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </span>
          {!collapsed && <span className="ml-4 whitespace-nowrap">Terminate Hub</span>}
        </button>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full h-12 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white bg-zinc-50 dark:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-xl transition-colors font-medium text-sm"
        >
          {collapsed ? '→' : '← Collapse Interface'}
        </button>
      </div>

      <style>{`
        .shadow-glow { box-shadow: 0 0 10px rgba(99, 102, 241, 0.5); }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </aside>
  );
};

export default AppSidebar;
