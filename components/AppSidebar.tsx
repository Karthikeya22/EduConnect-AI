
import React, { useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { AppPath } from '../App';
import * as Icons from './Icons';

interface AppSidebarProps {
  role: 'teacher' | 'student';
  currentPath: AppPath;
  onNavigateTo: (path: AppPath) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  onLogout: () => void;
}

const AppSidebar: React.FC<AppSidebarProps> = ({ role, currentPath, onNavigateTo, collapsed, setCollapsed, onLogout }) => {
  const iconRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const teacherItems = [
    { Icon: Icons.IconHome, label: "Dashboard", id: 'teacher-dashboard' },
    { Icon: Icons.IconCheck, label: "Grading Hub", id: 'teacher-grading' },
    { Icon: Icons.IconUpload, label: "Asset Hub", id: 'teacher-upload' },
    { Icon: Icons.IconDraft, label: "Architect", id: 'teacher-assignments' },
    { Icon: Icons.IconChat, label: "Discussions", id: 'teacher-discussions' },
    { Icon: Icons.IconUsers, label: "Students", id: 'teacher-analytics' },
    { Icon: Icons.IconTrending, label: "Predictor", id: 'teacher-predictor' },
    { Icon: Icons.IconPalette, label: "AI Persona", id: 'teacher-persona' },
    { Icon: Icons.IconSettings, label: "Settings", id: 'settings' },
  ];

  const studentItems = [
    { Icon: Icons.IconHome, label: "Dashboard", id: 'student-dashboard' },
    { Icon: Icons.IconBook, label: "Materials", id: 'student-materials' },
    { Icon: Icons.IconLab, label: "Data Lab", id: 'student-lab' },
    { Icon: Icons.IconUsers, label: "Peer Review", id: 'student-peer-review' },
    { Icon: Icons.IconChart, label: "Progress", id: 'student-progress' },
    { Icon: Icons.IconSettings, label: "Settings", id: 'settings' },
  ];

  const items = role === 'teacher' ? teacherItems : studentItems;

  const isItemActive = (id: string) => {
    if (currentPath === id) return true;
    if (id === 'student-dashboard' && (currentPath === 'student-assignment' || currentPath === 'student-discussion')) return true;
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
    <aside className={`bg-[#0F172A] text-white transition-all duration-500 flex flex-col shadow-2xl z-[100] relative h-full shrink-0 ${collapsed ? 'w-[80px]' : 'w-[280px]'}`}>
      <div className="h-24 flex items-center px-7 border-b border-white/10 shrink-0 overflow-hidden">
        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-black text-[#0F172A] shrink-0 shadow-xl border border-white/10">USF</div>
        {!collapsed && (
          <span className="ml-5 font-black text-sm tracking-tight truncate font-['Space_Grotesk'] uppercase text-white/95 whitespace-nowrap">
            {role === 'teacher' ? 'Faculty Nexus' : 'Student Hub'}
          </span>
        )}
      </div>
      
      <nav className="flex-1 py-10 overflow-y-auto scrollbar-hide space-y-1">
        {items.map((item, i) => (
          <button 
            key={item.id}
            onClick={() => onNavigateTo(item.id as AppPath)}
            className={`w-full flex items-center px-7 py-4.5 transition-all group relative border-l-4 ${isItemActive(item.id) ? 'bg-white/10 border-white text-white' : 'text-zinc-500 hover:text-white hover:bg-white/5 border-transparent'}`}
          >
            <span 
              ref={el => { iconRefs.current[i] = el; }}
              className={`shrink-0 inline-block transition-colors ${isItemActive(item.id) ? 'text-white' : 'text-zinc-500 group-hover:text-white'}`}
            >
              <item.Icon className="w-6 h-6" />
            </span>
            {!collapsed && <span className="ml-5 font-bold text-sm tracking-tight">{item.label}</span>}
            {isItemActive(item.id) && !collapsed && <div className="absolute right-6 w-1.5 h-1.5 bg-white rounded-full animate-pulse shadow-glow"></div>}
          </button>
        ))}
      </nav>

      <div className="mt-auto border-t border-white/10">
        <button 
          onClick={onLogout}
          className={`w-full flex items-center px-7 py-6 transition-all text-red-400 hover:bg-red-500/10 border-l-4 border-transparent group overflow-hidden`}
        >
          <span className="shrink-0 transition-transform group-hover:rotate-12">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </span>
          {!collapsed && <span className="ml-5 font-bold text-sm">Terminate Hub</span>}
        </button>
        <button 
          onClick={() => setCollapsed(!collapsed)} 
          className="w-full h-16 flex items-center justify-center text-zinc-500 hover:text-white transition-colors bg-black/20"
        >
          {collapsed ? '→' : '← Collapse Interface'}
        </button>
      </div>
      <style>{`
        .shadow-glow { box-shadow: 0 0 10px rgba(255,255,255,0.5); }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </aside>
  );
};

export default AppSidebar;
