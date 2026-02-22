
import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

interface GlobalNotificationsProps {
  isOpen: boolean;
  onClose: () => void;
}

const GlobalNotifications: React.FC<GlobalNotificationsProps> = ({ isOpen, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      const ctx = gsap.context(() => {
        gsap.to(overlayRef.current, { opacity: 1, duration: 0.3 });
        gsap.to(panelRef.current, { x: 0, duration: 0.5, ease: "power4.out" });
      });
      return () => ctx.revert();
    } else {
      gsap.to(panelRef.current, { x: "100%", duration: 0.4, ease: "power4.in" });
      gsap.to(overlayRef.current, { opacity: 0, duration: 0.4 });
    }
  }, [isOpen]);

  const notifications = [
    { id: 1, type: 'assignment', title: 'New Lab Published', desc: 'Lab 05: Hadoop Eco-System is now available.', time: '2 mins ago', unread: true },
    { id: 2, type: 'grade', title: 'Grade Released', desc: 'Your response to "Data Ethics" has been graded.', time: '1 hour ago', unread: true },
    { id: 3, type: 'system', title: 'Database Sync', desc: 'Instructional assets successfully updated for Section 001.', time: '4 hours ago', unread: false },
    { id: 4, type: 'persona', title: 'AI Brain Update', desc: 'The Course AI has indexed new documentation on D3.js v7.', time: 'Yesterday', unread: false },
  ];

  return (
    <div className={`fixed inset-0 z-[2000] pointer-events-none ${isOpen ? 'pointer-events-auto' : ''}`}>
      <div ref={overlayRef} onClick={onClose} className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm opacity-0 transition-opacity" />
      <div 
        ref={panelRef} 
        className="absolute top-0 right-0 w-full max-w-md h-full bg-white shadow-2xl translate-x-full flex flex-col font-['Plus_Jakarta_Sans']"
      >
        <header className="p-8 border-b border-zinc-100 flex items-center justify-between">
          <h2 className="text-xl font-black text-zinc-900 tracking-tighter uppercase font-['Space_Grotesk']">System Heartbeat</h2>
          <button onClick={onClose} className="w-10 h-10 rounded-full hover:bg-zinc-50 flex items-center justify-center text-zinc-400">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide bg-zinc-50/30">
          {notifications.map((n) => (
            <div key={n.id} className={`p-6 rounded-[2rem] border transition-all cursor-default ${n.unread ? 'bg-white border-cyan-100 shadow-xl shadow-cyan-900/5' : 'bg-transparent border-zinc-100 opacity-60'}`}>
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center space-x-3">
                  <div className={`w-2 h-2 rounded-full ${n.unread ? 'bg-cyan-500' : 'bg-transparent'}`}></div>
                  <h4 className="font-black text-zinc-900 text-sm">{n.title}</h4>
                </div>
                <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">{n.time}</span>
              </div>
              <p className="text-xs text-zinc-500 font-medium leading-relaxed">{n.desc}</p>
            </div>
          ))}
        </div>

        <footer className="p-8 border-t border-zinc-100">
          <button className="w-full py-4 border-2 border-zinc-200 rounded-2xl text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] hover:border-zinc-900 hover:text-zinc-900 transition-all">Mark all as read</button>
        </footer>
      </div>
    </div>
  );
};

export default GlobalNotifications;
