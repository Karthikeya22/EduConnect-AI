
import React, { useState, useEffect } from 'react';
import { gsap } from 'gsap';
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';

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

  const mockWork = [
    { id: 1, title: "Hadoop Cluster Visualization", author: "Student_A92", description: "A D3.js force-directed graph showing node health across a 50-node cluster.", image: "📊" },
    { id: 2, title: "MapReduce Flow Logic", author: "Student_B14", description: "Interactive Sankey diagram tracing data from Input Split to Reduced Output.", image: "🧪" },
    { id: 3, title: "Zettabyte Scaling Model", author: "Student_C44", description: "Comparative bar charts showing scaling costs for cloud vs on-prem Hadoop.", image: "📈" },
  ];

  const handleReview = (type: 'up' | 'down') => {
    if (isAnimating) return;
    setIsAnimating(true);
    
    gsap.to(".review-card-active", {
      x: type === 'up' ? 500 : -500,
      rotation: type === 'up' ? 45 : -45,
      opacity: 0,
      duration: 0.6,
      ease: "power2.in",
      onComplete: () => {
        setActiveCard(prev => (prev + 1) % mockWork.length);
        setIsAnimating(false);
        gsap.set(".review-card-active", { x: 0, rotation: 0, opacity: 1 });
      }
    });
  };

  useEffect(() => {
    gsap.from(".stagger-item", { opacity: 0, y: 30, stagger: 0.1, duration: 0.8, ease: "power4.out" });
  }, []);

  return (
    <div className="flex h-screen bg-[#F8FAFC] overflow-hidden font-['Plus_Jakarta_Sans']">
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
            <div className="bg-white px-6 py-3 rounded-2xl border border-zinc-100 shadow-sm text-center">
              <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Points</div>
              <div className="text-2xl font-black text-cyan-600">+1,240</div>
            </div>
          </div>
        </header>

        <div className="relative w-full max-w-lg h-[500px] stagger-item">
          {mockWork.map((work, idx) => {
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
                  <p className="text-zinc-500 text-sm font-medium leading-relaxed">{work.description}</p>
                </div>
                <div className="flex gap-4 mt-8">
                  <button onClick={() => handleReview('down')} className="flex-1 h-14 border-2 border-red-100 text-red-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-50 transition-all">Reject Logic</button>
                  <button onClick={() => handleReview('up')} className="flex-1 h-14 bg-cyan-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-lg shadow-cyan-600/20">Great Data Flow</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-12 flex items-center space-x-4 stagger-item">
          <div className="flex -space-x-3">
            {[1,2,3,4].map(i => <div key={i} className="w-10 h-10 rounded-full border-4 border-white bg-zinc-200 overflow-hidden"><img src={`https://i.pravatar.cc/100?u=peer${i}`} alt="user" /></div>)}
          </div>
          <p className="text-zinc-400 font-bold text-sm tracking-tight"><span className="text-zinc-900">42 classmates</span> are reviewing right now</p>
        </div>
      </main>
    </div>
  );
};

export default PeerReviewHub;
