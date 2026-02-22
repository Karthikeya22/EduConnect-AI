
import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import AIAssistantModal from '../components/AIAssistantModal';
import AppSidebar from '../components/AppSidebar';
import { DashboardSkeleton } from '../components/Skeleton';
import { AppPath } from '../App';
import * as Icons from './Icons';

interface TeacherDashboardProps {
  onBack: () => void;
  onLogout: () => void;
  onNavigateTo: (path: AppPath) => void;
  currentPath: AppPath;
  onOpenNotifs: () => void;
}

const TeacherDashboard: React.FC<TeacherDashboardProps> = (props) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [stats, setStats] = useState({ students: 48, assignments: 12, pending: 18, discussions: 142 });
  const [profileOpen, setProfileOpen] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isOffline, setIsOffline] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  
  // Text cycling logic
  const [statusIdx, setStatusIdx] = useState(0);
  const statusPhrases = [
    "Monitoring class trajectory...",
    "Analyzing engagement patterns...",
    "Synchronizing course assets...",
    "Evaluating predictive risk nodes...",
    "Optimizing pedagogical flow...",
    "Auditing real-time activity..."
  ];
  const statusRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) { 
          props.onLogout(); 
          return; 
        }
        
        setUserProfile(session.user);
        setLoading(false);
        
        // Background sync for audit logs
        try {
          const { data: logs, error: logsError } = await supabase
            .from('platform_activity_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);
          
          if (logsError) throw logsError;
          if (logs) setAuditLogs(logs);
        } catch (logErr: any) {
          if (logErr.message?.includes('fetch')) {
            setIsOffline(true);
          }
          console.warn("Audit ledger sync delayed.");
        }
      } catch (err: any) {
        console.error("Dashboard Identity Failure:", err);
        if (err.message?.includes('fetch')) {
          setIsOffline(true);
        }
        setLoading(false);
      }
    };
    fetchData();
  }, [props]);

  useEffect(() => {
    if (!loading) {
      const ctx = gsap.context(() => {
        gsap.from(".dashboard-stagger", {
          y: 20,
          opacity: 0,
          stagger: 0.05,
          duration: 0.6,
          ease: "power2.out",
          clearProps: "all"
        });
      }, mainRef);
      return () => ctx.revert();
    }
  }, [loading]);

  useEffect(() => {
    if (loading || !statusRef.current) return;

    const interval = setInterval(() => {
      if (!statusRef.current) return;
      
      const tl = gsap.timeline();
      tl.to(statusRef.current, {
        y: -10,
        opacity: 0,
        duration: 0.4,
        ease: "power2.in",
        onComplete: () => {
          setStatusIdx((prev) => (prev + 1) % statusPhrases.length);
        }
      }).fromTo(statusRef.current, 
        { y: 10, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6, ease: "power2.out" }
      );
    }, 4000);

    return () => clearInterval(interval);
  }, [loading, statusPhrases.length]);

  const avatarUrl = userProfile?.user_metadata?.avatar_url || userProfile?.user_metadata?.picture;
  const initial = userProfile?.user_metadata?.full_name?.charAt(0) || 'P';

  return (
    <div className="flex h-screen bg-[#F9F8F3] overflow-hidden font-['Plus_Jakarta_Sans']">
      <AppSidebar 
        role="teacher" 
        currentPath={props.currentPath} 
        onNavigateTo={props.onNavigateTo} 
        collapsed={sidebarCollapsed} 
        setCollapsed={setSidebarCollapsed} 
        onLogout={props.onLogout} 
      />

      <AIAssistantModal 
        isOpen={aiAssistantOpen} 
        onClose={() => setAiAssistantOpen(false)} 
        teacherName={userProfile?.user_metadata?.full_name || 'Professor'} 
      />
      
      {/* Primary Floating AI Trigger */}
      <button 
        onClick={() => setAiAssistantOpen(true)}
        className="fixed bottom-8 right-8 z-[100] w-16 h-16 bg-[#18181B] text-white rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 group overflow-hidden border-2 border-white/10"
      >
        <div className="absolute inset-0 bg-gradient-to-tr from-purple-600/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
        <Icons.IconBot className="w-8 h-8 relative z-10" />
        <div className="absolute -top-12 right-0 bg-zinc-900 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl opacity-0 group-hover:opacity-100 transition-all pointer-events-none whitespace-nowrap translate-y-2 group-hover:translate-y-0">
          Open AI Assistant
        </div>
        <div className="absolute inset-0 rounded-full border-4 border-purple-500/30 animate-ping-slow"></div>
      </button>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="h-20 bg-white border-b border-zinc-200 flex items-center justify-between px-12 shrink-0 z-40">
          <div className="flex items-center space-x-6">
            <button onClick={props.onBack} className="w-10 h-10 rounded-full hover:bg-zinc-50 flex items-center justify-center text-zinc-400 transition-colors">←</button>
            <h1 className="text-3xl font-black text-zinc-900 tracking-tighter font-['Space_Grotesk'] uppercase">Course Hub</h1>
          </div>
          <div className="flex items-center space-x-8">
            {isOffline && (
              <div className="flex items-center px-4 py-2 bg-amber-50 border border-amber-200 rounded-full">
                <span className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Database Sync Delayed</span>
              </div>
            )}
            <button onClick={props.onOpenNotifs} className="relative p-2 text-zinc-400 hover:text-zinc-900 transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
            </button>
            
            <div className="relative">
              <button 
                onClick={() => setProfileOpen(!profileOpen)} 
                className="w-12 h-12 bg-[#18181B] rounded-2xl flex items-center justify-center text-white font-black shadow-xl hover:scale-105 transition-all overflow-hidden border-2 border-transparent hover:border-zinc-200"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <span>{initial}</span>
                )}
              </button>
              
              {profileOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)}></div>
                  <div className="absolute right-0 top-16 w-64 bg-white rounded-2xl shadow-2xl border border-zinc-100 p-2 z-50 animate-pop-in">
                    <div className="px-4 py-4 border-b border-zinc-50 mb-2 flex items-center space-x-3">
                      <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center text-white font-bold text-sm overflow-hidden shrink-0 shadow-sm">
                        {avatarUrl ? (
                          <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                        ) : (
                          <span>{initial}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-black text-zinc-900 truncate leading-tight">
                          {userProfile?.user_metadata?.full_name || 'Professor'}
                        </p>
                        <p className="text-[10px] text-zinc-400 font-bold truncate">
                          {userProfile?.email}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => { setProfileOpen(false); props.onNavigateTo('settings'); }} className="w-full px-4 py-3 text-left text-xs font-bold text-zinc-600 hover:bg-zinc-50 rounded-xl flex items-center space-x-4 transition-colors">
                      <Icons.IconSettings className="w-4 h-4" /> <span>Portal Settings</span>
                    </button>
                    <button onClick={props.onLogout} className="w-full px-4 py-3 text-left text-xs font-bold text-red-600 hover:bg-red-50 rounded-xl flex items-center space-x-4 mt-1 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      <span>Secure Logout</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {loading ? (
          <DashboardSkeleton role="teacher" />
        ) : (
          <main ref={mainRef} className="flex-1 overflow-y-auto p-12 scroll-smooth scrollbar-hide">
            <div className="dashboard-stagger mb-16">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-50 text-purple-600 text-[10px] font-black uppercase tracking-widest mb-6 border border-purple-100">
                <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse"></span>
                <span>Professor Portal • BIG_DATA_2026</span>
              </div>
              <h1 className="text-6xl font-black text-zinc-900 mb-4 tracking-tighter font-['Space_Grotesk'] leading-none">Academic Center</h1>
              <p className="text-xl text-zinc-500 font-bold flex items-center flex-wrap gap-2">
                <span>Welcome back, Professor {userProfile?.user_metadata?.full_name?.split(' ').pop()}.</span>
                <span className="inline-flex items-center px-4 py-1.5 rounded-xl bg-zinc-900 text-white shadow-xl relative overflow-hidden group">
                  <span ref={statusRef} className="relative z-10 inline-block font-black text-xs tracking-tight uppercase">{statusPhrases[statusIdx]}</span>
                </span>
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-20">
              {[
                { label: "Active Students", val: stats.students, Icon: Icons.IconUsers, color: "bg-blue-50 text-blue-600" },
                { label: "Assets Hosted", val: stats.assignments, Icon: Icons.IconBook, color: "bg-orange-50 text-orange-600" },
                { label: "Pending Grading", val: stats.pending, Icon: Icons.IconPen, color: "bg-pink-50 text-pink-600" },
                { label: "Discussion Load", val: stats.discussions, Icon: Icons.IconChat, color: "bg-green-50 text-green-600" },
              ].map((stat, i) => (
                <div key={i} className="dashboard-stagger p-10 bg-white rounded-[3rem] border border-zinc-100 shadow-xl flex flex-col justify-center h-52 relative overflow-hidden group hover:scale-[1.02] transition-transform">
                  <div className={`absolute -right-6 -bottom-6 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity`}>
                    <stat.Icon className="w-32 h-32" />
                  </div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">{stat.label}</div>
                  <div className="text-5xl font-black tracking-tighter text-zinc-900">{stat.val}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
              <div className="lg:col-span-8">
                <div className="flex justify-between items-center mb-10">
                  <h3 className="dashboard-stagger text-2xl font-black text-zinc-900 tracking-tight font-['Space_Grotesk'] uppercase">Control Matrix</h3>
                  <button onClick={() => setAiAssistantOpen(true)} className="dashboard-stagger flex items-center space-x-2 px-6 py-3 bg-purple-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg hover:bg-purple-700 transition-all active:scale-95">
                    <Icons.IconBot className="w-4 h-4" /> <span>Ask Faculty AI</span>
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                  {[
                    { id: "upload", Icon: Icons.IconUpload, title: "Asset Hub", sub: "Cloud Materials", color: "bg-cyan-600" },
                    { id: "assignments", Icon: Icons.IconDraft, title: "New Lab", sub: "Architect Mode", color: "bg-pink-600" },
                    { id: "predictor", Icon: Icons.IconTrending, title: "Sentinel", sub: "Risk Analysis", color: "bg-red-600" },
                    { id: "analytics", Icon: Icons.IconChart, title: "Insights", sub: "Student Growth", color: "bg-orange-600" },
                    { id: "persona", Icon: Icons.IconPalette, title: "AI Persona", sub: "Tutor Logic", color: "bg-purple-600" },
                    { id: "ai", Icon: Icons.IconBot, title: "AI Assistant", sub: "Global Query", color: "bg-[#18181B]" },
                  ].map((action) => (
                    <button key={action.id} onClick={() => action.id === 'ai' ? setAiAssistantOpen(true) : props.onNavigateTo(`teacher-${action.id}` as AppPath)} className={`dashboard-stagger ${action.color} text-white p-8 rounded-[2.5rem] flex flex-col items-start text-left justify-end h-48 hover:translate-y-[-4px] hover:shadow-2xl transition-all shadow-xl shadow-black/5 group relative overflow-hidden active:scale-95`}>
                      <div className="mb-8 group-hover:scale-110 transition-transform">
                        <action.Icon className="w-10 h-10" />
                      </div>
                      <div className="relative z-10"><p className="font-bold text-lg">{action.title}</p><p className="text-[10px] opacity-70 uppercase font-black tracking-widest">{action.sub}</p></div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="dashboard-stagger lg:col-span-4 bg-[#0F172A] rounded-[3rem] shadow-2xl flex flex-col text-white p-10 h-fit">
                <div className="flex items-center justify-between mb-10">
                  <h3 className="font-black text-lg tracking-tight uppercase">System Ledger</h3>
                  <div className={`w-2 h-2 rounded-full animate-pulse ${isOffline ? 'bg-amber-500' : 'bg-green-500'}`}></div>
                </div>
                <div className="space-y-6 overflow-y-auto max-h-[400px] scrollbar-hide pr-2">
                  {auditLogs.length > 0 ? auditLogs.map((log) => (
                    <div key={log.id} className="p-5 bg-white/5 rounded-2xl border border-white/10 text-xs hover:bg-white/10 transition-colors">
                      <div className="flex justify-between items-center mb-2">
                         <span className="text-[8px] font-black uppercase text-cyan-400">{log.action}</span>
                         <span className="text-[8px] text-zinc-500">{new Date(log.created_at).toLocaleTimeString()}</span>
                      </div>
                      <p className="font-bold text-zinc-300 leading-relaxed">{log.details}</p>
                    </div>
                  )) : (
                    <div className="py-12 text-center">
                      <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{isOffline ? 'Offline Data Access Active' : 'Awaiting system activity...'}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </main>
        )}
      </div>
      <style>{`
        @keyframes pop-in { from { transform: scale(0.9) opacity: 0; } to { transform: scale(1) opacity: 1; } }
        @keyframes ping-slow {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        .animate-pop-in { animation: pop-in 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
        .animate-ping-slow { animation: ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
};

export default TeacherDashboard;
