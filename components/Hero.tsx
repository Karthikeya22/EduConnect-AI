
import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import * as Icons from './Icons';

interface HeroProps {
  onGetStarted?: () => void;
}

const Hero: React.FC<HeroProps> = ({ onGetStarted }) => {
  const heroRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const magneticRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const luminousCoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Entrance Animations
      gsap.to(badgeRef.current, { y: 6, duration: 2, repeat: -1, yoyo: true, ease: "power1.inOut" });

      if (headlineRef.current) {
        const text = headlineRef.current.innerText;
        headlineRef.current.innerHTML = text.split(' ').map(word => `<span class="inline-block opacity-0 translate-y-12 blur-sm">${word}</span>`).join(' ');
        gsap.to(headlineRef.current.querySelectorAll('span'), {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          stagger: 0.1,
          duration: 1.2,
          ease: "expo.out",
          delay: 0.3
        });
      }

      gsap.from(".hero-content > *:not(h1)", { 
        opacity: 0, 
        y: 30, 
        stagger: 0.15, 
        duration: 1.2, 
        delay: 1, 
        ease: "power4.out" 
      });

      // Luminous Core Pulse
      gsap.to(luminousCoreRef.current, {
        scale: 1.1,
        opacity: 0.8,
        duration: 4,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut"
      });

      // Animate floating knowledge nodes with custom trajectories
      nodeRefs.current.forEach((node, i) => {
        if (!node) return;
        gsap.to(node, {
          y: `random(-40, 40)`,
          x: `random(-30, 30)`,
          rotation: `random(-10, 10)`,
          duration: `random(4, 7)`,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
          delay: i * 0.4
        });
      });

      // Deep Parallax Effect
      const handleMouseMove = (e: MouseEvent) => {
        const { clientX, clientY } = e;
        const xPos = (clientX / window.innerWidth - 0.5);
        const yPos = (clientY / window.innerHeight - 0.5);
        
        gsap.to(".parallax-bg", { x: xPos * 20, y: yPos * 20, duration: 1.5, ease: "power2.out" });
        gsap.to(luminousCoreRef.current, { x: xPos * 60, y: yPos * 60, duration: 1, ease: "power3.out" });
        
        nodeRefs.current.forEach((node, i) => {
          if (!node) return;
          const factor = (i + 1) * 25;
          gsap.to(node, { 
            x: xPos * factor, 
            y: yPos * factor, 
            overwrite: "auto",
            duration: 1.2, 
            ease: "power2.out" 
          });
        });

        // 3D Tilt for visual mockup
        if (visualRef.current) {
          const tiltX = yPos * 10;
          const tiltY = -xPos * 10;
          gsap.to(visualRef.current, {
            rotateX: tiltX,
            rotateY: tiltY,
            duration: 1,
            ease: "power2.out",
            transformPerspective: 1000
          });
        }
      };

      window.addEventListener('mousemove', handleMouseMove);

      // Magnetic Buttons
      magneticRefs.current.forEach(btn => {
        if (!btn) return;
        btn.addEventListener('mousemove', (e) => {
          const rect = btn.getBoundingClientRect();
          const x = e.clientX - rect.left - rect.width / 2;
          const y = e.clientY - rect.top - rect.height / 2;
          gsap.to(btn, { x: x * 0.4, y: y * 0.4, scale: 1.05, duration: 0.3, ease: "power2.out" });
        });
        btn.addEventListener('mouseleave', () => {
          gsap.to(btn, { x: 0, y: 0, scale: 1, duration: 0.6, ease: "elastic.out(1, 0.3)" });
        });
      });

      return () => window.removeEventListener('mousemove', handleMouseMove);
    }, heroRef);

    return () => ctx.revert();
  }, []);

  const knowledgeNodes = [
    { label: "JSON SCHEMA", Icon: Icons.IconFile, color: "bg-orange-500/10 border-orange-500/20 text-orange-600", pos: "top-[0%] left-[-10%]" },
    { label: "MAPREDUCE", Icon: Icons.IconBrain, color: "bg-purple-500/10 border-purple-500/20 text-purple-600", pos: "bottom-[20%] left-[-15%]" },
    { label: "D3.js ENGINE", Icon: Icons.IconPalette, color: "bg-cyan-500/10 border-cyan-500/20 text-cyan-600", pos: "top-[10%] right-[-15%]" },
    { label: "BIG DATA", Icon: Icons.IconChart, color: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600", pos: "bottom-[5%] right-[-10%]" },
  ];

  return (
    <section ref={heroRef} className="relative min-h-screen flex items-center pt-24 pb-20 overflow-hidden bg-[#FDFCF8]">
      {/* Code Stream Background Component */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.03] overflow-hidden select-none">
        <div className="code-stream-column">
          {Array.from({ length: 50 }).map((_, i) => (
            <div key={i} className="text-[10px] font-mono whitespace-nowrap leading-none mb-1">
              {Math.random().toString(36).substring(2, 15)} {Math.random().toString(36).substring(2, 15)}
            </div>
          ))}
        </div>
      </div>

      {/* Stunning Luminous Core */}
      <div 
        ref={luminousCoreRef}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-radial from-cyan-200/20 via-transparent to-transparent rounded-full blur-[120px] pointer-events-none z-0 opacity-40"
      ></div>
      
      {/* Mesh Gradients */}
      <div className="parallax-bg absolute bottom-0 right-0 w-[60%] h-[60%] bg-blue-100/20 rounded-full blur-[150px] pointer-events-none z-0"></div>
      <div className="parallax-bg absolute top-0 left-0 w-[40%] h-[40%] bg-purple-100/20 rounded-full blur-[150px] pointer-events-none z-0"></div>

      <div className="container mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-16 items-center relative z-10">
        <div className="lg:col-span-7 hero-content">
          <div 
            ref={badgeRef}
            className="inline-flex items-center space-x-3 px-4 py-2 rounded-2xl bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.2em] mb-10 shadow-2xl shadow-zinc-300"
          >
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
            <span>Official USF Course Portal: BIG DATA 2026</span>
          </div>
          
          <h1 
            ref={headlineRef}
            className="text-6xl md:text-[6.5rem] font-black leading-[0.95] mb-10 text-zinc-900 tracking-tighter font-['Space_Grotesk']"
          >
            Smarter Teaching Through AI.
          </h1>
          
          <p className="text-xl md:text-2xl text-zinc-500 mb-14 max-w-2xl leading-relaxed font-medium">
            Elevating Professor Bo Pei's curriculum with an intelligent orchestration layer for Big Data and visualization.
          </p>

          <div className="flex flex-col sm:flex-row items-center space-y-5 sm:space-y-0 sm:space-x-6">
            <button 
              ref={el => { magneticRefs.current[0] = el; }}
              onClick={onGetStarted}
              className="w-full sm:w-auto px-12 py-6 bg-zinc-900 text-white rounded-[1.8rem] font-black text-xs uppercase tracking-[0.25em] shadow-2xl shadow-zinc-300 active:scale-95 transition-transform group relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-purple-500 opacity-0 group-hover:opacity-10 transition-opacity"></div>
              <span>Enter Academy</span>
            </button>
            <button 
              ref={el => { magneticRefs.current[1] = el; }}
              className="w-full sm:w-auto px-12 py-6 bg-white border-2 border-zinc-100 text-zinc-900 hover:border-zinc-900 rounded-[1.8rem] font-black text-xs uppercase tracking-[0.25em] active:scale-95 transition-all shadow-sm"
            >
              Curriculum Data
            </button>
          </div>

          <div className="mt-16 flex items-center space-x-6 text-zinc-400">
              <div className="flex -space-x-3">
                {[1,2,3,4,5].map(i => <div key={i} className="w-12 h-12 rounded-2xl border-4 border-white bg-zinc-100 overflow-hidden shadow-lg transform hover:translate-y-[-4px] transition-transform"><img src={`https://i.pravatar.cc/150?u=stu${i+20}`} alt="user" loading="lazy" /></div>)}
              </div>
             <div>
                <p className="text-xs font-black text-zinc-900 uppercase tracking-widest leading-none mb-1">Authenticated Students</p>
                <p className="text-[10px] font-bold text-zinc-400">Synchronized with official USF ledger</p>
             </div>
          </div>
        </div>

        <div className="lg:col-span-5 relative hidden lg:block h-[600px]">
          {/* Floating Course Work Nodes */}
          <div className="absolute inset-0 z-20 pointer-events-none">
            {knowledgeNodes.map((node, i) => (
              <div 
                key={i}
                ref={el => { nodeRefs.current[i] = el; }}
                className={`absolute ${node.pos} px-5 py-3 ${node.color} rounded-2xl shadow-2xl border backdrop-blur-xl flex items-center space-x-3 font-black text-[10px] uppercase tracking-[0.2em]`}
              >
                <node.Icon className="w-5 h-5" />
                <span>{node.label}</span>
              </div>
            ))}
          </div>

          <div ref={visualRef} className="relative z-10 h-full flex items-center justify-center">
            <div className="w-full aspect-[1/1] bg-white rounded-[4rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.1)] border border-zinc-100 p-10 flex flex-col relative overflow-hidden group">
               {/* Animated "Code Pulse" background */}
               <div className="absolute inset-0 bg-gradient-to-br from-transparent via-cyan-500/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
               
               <div className="flex items-center justify-between mb-12">
                  <div className="flex space-x-2">
                    <div className="w-3 h-3 rounded-full bg-rose-400/20"></div>
                    <div className="w-3 h-3 rounded-full bg-amber-400/20"></div>
                    <div className="w-3 h-3 rounded-full bg-emerald-400/20"></div>
                  </div>
                  <div className="w-12 h-12 rounded-[1.2rem] bg-zinc-900 text-white flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform duration-500">
                    <Icons.IconBot className="w-6 h-6" />
                  </div>
               </div>
               
               <div className="space-y-6 flex-1">
                  <div className="h-20 bg-zinc-50 rounded-[1.8rem] border border-zinc-100 p-6 flex items-center space-x-4 animate-pulse-slow">
                    <div className="w-10 h-10 bg-cyan-100 rounded-xl flex items-center justify-center"><Icons.IconBook className="w-5 h-5 text-cyan-600" /></div>
                    <div className="flex-1 space-y-2">
                      <div className="w-2/3 h-2 bg-zinc-200 rounded-full"></div>
                      <div className="w-1/2 h-2 bg-zinc-100 rounded-full"></div>
                    </div>
                  </div>
                  <div className="h-20 bg-zinc-900 rounded-[1.8rem] p-6 flex items-center space-x-4 shadow-xl translate-x-4">
                    <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center"><Icons.IconDraft className="w-5 h-5 text-white" /></div>
                    <div className="flex-1 space-y-2">
                      <div className="w-3/4 h-2 bg-white/20 rounded-full"></div>
                      <div className="w-1/3 h-2 bg-white/10 rounded-full"></div>
                    </div>
                  </div>
                  <div className="h-20 bg-zinc-50 rounded-[1.8rem] border border-zinc-100 p-6 flex items-center space-x-4 animate-pulse-slow delay-150">
                    <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center"><Icons.IconChart className="w-5 h-5 text-purple-600" /></div>
                    <div className="flex-1 space-y-2">
                      <div className="w-1/2 h-2 bg-zinc-200 rounded-full"></div>
                      <div className="w-2/3 h-2 bg-zinc-100 rounded-full"></div>
                    </div>
                  </div>
               </div>

               <div className="mt-10 pt-10 border-t border-zinc-50 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">System Ready</span>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-900">EduConnect AI v2.6</span>
               </div>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        .bg-gradient-radial {
          background-image: radial-gradient(circle at center, var(--tw-gradient-from) 0%, var(--tw-gradient-to) 100%);
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.02); }
        }
        .animate-pulse-slow {
          animation: pulse-slow 4s ease-in-out infinite;
        }
        .code-stream-column {
          display: flex;
          flex-direction: column;
          animation: slide-up 60s linear infinite;
        }
        @keyframes slide-up {
          from { transform: translateY(0); }
          to { transform: translateY(-50%); }
        }
      `}</style>
    </section>
  );
};

export default Hero;
