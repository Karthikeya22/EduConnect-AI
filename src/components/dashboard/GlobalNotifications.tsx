import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { supabase } from '@/src/lib/supabase';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

interface GlobalNotificationsProps {
  isOpen: boolean;
  onClose: () => void;
  user?: any;
}

const GlobalNotifications: React.FC<GlobalNotificationsProps> = ({ isOpen, onClose, user }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const ctx = gsap.context(() => {
        gsap.to(overlayRef.current, { opacity: 1, duration: 0.3 });
        gsap.to(panelRef.current, { x: 0, duration: 0.5, ease: "power4.out" });
      });
      fetchNotifications();
      return () => ctx.revert();
    } else {
      gsap.to(panelRef.current, { x: "100%", duration: 0.4, ease: "power4.in" });
      gsap.to(overlayRef.current, { opacity: 0, duration: 0.4 });
    }
  }, [isOpen, user]);

  const fetchNotifications = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('platform_activity_logs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error("Error fetching notifications:", error);
      } else {
        setNotifications(data || []);
      }
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setLoading(false);
    }
  };

  const getIconForType = (actionType: string) => {
    if (actionType.includes('ASSIGNMENT') || actionType.includes('GRAD')) return 'bg-amber-500';
    if (actionType.includes('MATERIAL')) return 'bg-cyan-500';
    if (actionType.includes('LOGIN')) return 'bg-emerald-500';
    return 'bg-indigo-500';
  };

  const getTitleForType = (actionType: string, details: string) => {
    if (actionType === 'LOGIN_EVENT') return 'System Access';
    if (actionType === 'DATABASE_UPDATE') return 'System Update';
    if (actionType === 'AI_TUTOR_INTERACTION') return 'AI Interaction';
    return actionType.replace(/_/g, ' ');
  };

  return (
    <div className={`fixed inset-0 z-[2000] pointer-events-none ${isOpen ? 'pointer-events-auto' : ''}`}>
      <div ref={overlayRef} onClick={onClose} className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm opacity-0 transition-opacity" />
      <div
        ref={panelRef}
        className="absolute top-0 right-0 w-full max-w-md h-full bg-white shadow-2xl translate-x-full grid grid-rows-[auto_1fr_auto] font-['Plus_Jakarta_Sans']"
      >
        <header className="p-8 border-b border-zinc-100 flex items-center justify-between">
          <h2 className="text-xl font-black text-zinc-900 tracking-tighter uppercase font-['Space_Grotesk']">System Heartbeat</h2>
          <button onClick={onClose} className="w-10 h-10 rounded-full hover:bg-zinc-50 flex items-center justify-center text-zinc-500">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide bg-zinc-50/30">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
              <div className="w-6 h-6 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin mb-4"></div>
              <div className="text-[10px] font-black uppercase tracking-widest text-zinc-600">SYNCING LOGS...</div>
            </div>
          ) : notifications.length > 0 ? (
            notifications.map((n) => (
              <div key={n.id} className={`p-6 rounded-[2rem] border transition-all cursor-default bg-white border-zinc-100 shadow-sm`}>
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center space-x-3">
                    <div className={`w-2 h-2 rounded-full ${getIconForType(n.action_type)}`}></div>
                    <h4 className="font-black text-zinc-900 text-sm capitalize">{getTitleForType(n.action_type, n.details)}</h4>
                  </div>
                  <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest min-w-fit">{dayjs(n.created_at).fromNow(true)}</span>
                </div>
                <p className="text-xs text-zinc-500 font-medium leading-relaxed">{n.details}</p>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
              <span className="text-3xl mb-4 opacity-50">📡</span>
              <div className="text-[10px] font-black uppercase tracking-widest text-zinc-600">NO RECENT SYSTEM ACTIVITY</div>
            </div>
          )}
        </div>

        <footer className="p-8 border-t border-zinc-100">
          <button onClick={fetchNotifications} className="w-full py-4 border-2 border-zinc-200 rounded-2xl text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] hover:border-zinc-900 hover:text-zinc-900 transition-all">REFRESH LOGS</button>
        </footer>
      </div>
    </div>
  );
};

export default GlobalNotifications;



