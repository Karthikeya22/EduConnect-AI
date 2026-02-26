
import React, { useState, useEffect } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';
import ThemeToggle from '../components/ThemeToggle';

interface PeerReviewHubProps {
  onBack: () => void;
  onNavigateTo: (path: AppPath) => void;
  currentPath: AppPath;
  onLogout: () => void;
}

const PeerReviewHub: React.FC<PeerReviewHubProps> = (props) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeCard, setActiveCard] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [works, setWorks] = useState<any[]>([]);

  useEffect(() => {
    const fetchWorks = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const currentUserId = session?.user?.id;

        const [subsRes, studentsRes] = await Promise.all([
          supabase.from('student_assignment_logs')
            .select(`*, assignments (assignment_name)`)
            .eq('interaction_type', 'submission')
            .order('timestamp', { ascending: false }),
          supabase.from('students')
            .select('id, student_email')
        ]);

        if (subsRes.error) throw subsRes.error;

        const uniqueUsers = new Map();
        (studentsRes.data || []).forEach((s: any) => {
          if (!uniqueUsers.has(s.id)) {
            uniqueUsers.set(s.id, s.student_email);
          }
        });

        const formattedWorks = (subsRes.data || [])
          .filter(log => log.student_id !== currentUserId)
          .map((log: any) => {
            const authorEmail = uniqueUsers.get(log.student_id);
            const author = authorEmail ? authorEmail.split('@')[0].replace('.', ' ') : 'Student';
            return {
              id: log.id,
              title: log.assignments?.assignment_name || 'Assignment Submission',
              author: author,
              description: log.submission_content || '',
              image: "📝",
            };
          });

        setWorks(formattedWorks);

      } catch (err) {
        console.error("Error fetching peer works:", err);
        setWorks([]);
      }
    };
    fetchWorks();
  }, []);

  const handleReview = (type: 'up' | 'down') => {
    if (isAnimating || works.length === 0) return;
    setIsAnimating(true);

    gsap.to(".review-card-active", {
      x: type === 'up' ? 500 : -500,
      rotation: type === 'up' ? 45 : -45,
      opacity: 0,
      duration: 0.6,
      ease: "power2.in",
      onComplete: () => {
        setActiveCard(prev => (prev + 1) % works.length);
        setIsAnimating(false);
        gsap.set(".review-card-active", { x: 0, rotation: 0, opacity: 1 });
      }
    });
  };

  useEffect(() => {
    gsap.from(".stagger-item", { opacity: 0, y: 30, stagger: 0.1, duration: 0.8, ease: "power4.out" });
  }, []);

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#020617] overflow-hidden font-['Plus_Jakarta_Sans'] transition-colors">
      <AppSidebar
        role="student"
        currentPath={props.currentPath}
        onNavigateTo={props.onNavigateTo}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        onLogout={props.onLogout}
      />

      <main className="flex-1 overflow-y-auto p-12 relative flex flex-col items-center">
        <header className="w-full max-w-4xl mb-12 stagger-item">
          <div className="flex justify-between items-end">
            <div className="flex items-center space-x-6">
              <button onClick={props.onBack} className="w-10 h-10 rounded-full hover:bg-zinc-50 flex items-center justify-center text-zinc-400 transition-colors">←</button>
              <div>
                <h1 className="text-5xl font-black text-zinc-900 tracking-tighter font-['Space_Grotesk'] uppercase">Peer Insight</h1>
                <p className="text-zinc-500 font-bold mt-2">Critique peer visualizations to earn contribution points.</p>
              </div>
            </div>
            <div className="flex items-center space-x-6">
              <ThemeToggle />
              <div className="bg-white dark:bg-white/5 px-6 py-3 rounded-2xl border border-zinc-100 dark:border-white/10 shadow-sm text-center">
                <div className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Points</div>
                <div className="text-2xl font-black text-cyan-600 dark:text-cyan-400">+1,240</div>
              </div>
            </div>
          </div>
        </header>

        <div className="relative w-full max-w-lg h-[500px] stagger-item">
          {works.length === 0 ? (
            <div className="absolute inset-0 bg-white rounded-[3rem] border-2 border-zinc-100 shadow-xl p-10 flex flex-col items-center justify-center text-center">
              <div className="text-7xl mb-6 opacity-50">📭</div>
              <h3 className="text-2xl font-black text-zinc-900 tracking-tight mb-2">No Peer Work</h3>
              <p className="text-zinc-500 font-medium">There are currently no peer submissions available for review.</p>
            </div>
          ) : (
            works.map((work, idx) => {
              if (idx !== activeCard) return null;
              return (
                <div key={work.id} className="review-card-active absolute inset-0 bg-white rounded-[3rem] border-2 border-zinc-100 shadow-2xl p-10 flex flex-col">
                  <div className="h-48 bg-zinc-50 rounded-[2rem] flex items-center justify-center text-7xl mb-8 border border-zinc-100">
                    {work.image}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-2xl font-black text-zinc-900 tracking-tight">{work.title}</h3>
                      <span className="text-[10px] font-black text-zinc-400 uppercase bg-zinc-100 px-3 py-1 rounded-full">{work.author}</span>
                    </div>
                    <p className="text-zinc-500 text-sm font-medium leading-relaxed max-h-[150px] overflow-y-auto">{work.description}</p>
                  </div>
                  <div className="flex gap-4 mt-8">
                    <button onClick={() => handleReview('down')} className="flex-1 h-14 border-2 border-red-100 text-red-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-50 transition-all">Reject Logic</button>
                    <button onClick={() => handleReview('up')} className="flex-1 h-14 bg-cyan-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-lg shadow-cyan-600/20">Great Data Flow</button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-12 flex items-center space-x-4 stagger-item">
          <div className="flex -space-x-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="w-10 h-10 rounded-full border-4 border-white bg-zinc-200 overflow-hidden"><img src={`https://i.pravatar.cc/100?u=peer${i}`} alt="user" /></div>)}
          </div>
          <p className="text-zinc-400 font-bold text-sm tracking-tight"><span className="text-zinc-900">42 classmates</span> are reviewing right now</p>
        </div>
      </main>
    </div>
  );
};

export default PeerReviewHub;
