import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import * as Icons from './Icons';

gsap.registerPlugin(ScrollTrigger);

const AITutorSection: React.FC<{ onGetStarted: () => void }> = ({ onGetStarted }) => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const atmosphereRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Atmospheric background animation
      gsap.to(".atmosphere-blob", {
        x: "random(-100, 100)",
        y: "random(-100, 100)",
        duration: 10,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        stagger: 2
      });

      // Text reveal
      gsap.from(".reveal-text", {
        y: 100,
        opacity: 0,
        duration: 1,
        stagger: 0.2,
        ease: "power4.out",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 70%",
        }
      });

      // Hardware card entrance
      gsap.from(cardRef.current, {
        scale: 0.8,
        opacity: 0,
        rotateY: 20,
        duration: 1.5,
        ease: "expo.out",
        scrollTrigger: {
          trigger: cardRef.current,
          start: "top 80%",
        }
      });

      // Features stagger
      gsap.from(".feature-item", {
        x: -30,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: "power2.out",
        scrollTrigger: {
          trigger: ".features-list",
          start: "top 85%",
        }
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="relative py-40 bg-[#050505] text-white overflow-hidden">
      {/* Atmospheric Background (Recipe 7) */}
      <div ref={atmosphereRef} className="absolute inset-0 pointer-events-none overflow-hidden opacity-40">
        <div className="atmosphere-blob absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-cyan-500/20 rounded-full blur-[120px]"></div>
        <div className="atmosphere-blob absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-purple-500/20 rounded-full blur-[100px]"></div>
        <div className="atmosphere-blob absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-indigo-500/10 rounded-full blur-[150px]"></div>
      </div>

      <div className="container mx-auto px-6 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center">
          
          {/* Left: Editorial Content */}
          <div className="space-y-12">
            <div className="reveal-text inline-flex items-center space-x-3 px-5 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-md">
              <div className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse"></div>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-400">Neural Pedagogical Node</span>
            </div>
            
            <div className="space-y-6">
              <h2 className="reveal-text text-6xl md:text-8xl font-black tracking-tighter leading-[0.85] font-['Space_Grotesk'] uppercase">
                Meet your <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">Digital Twin</span> <br />
                Tutor.
              </h2>
              <p className="reveal-text text-xl text-zinc-400 font-medium leading-relaxed max-w-xl">
                Beyond simple chat. Our AI Tutor is a high-fidelity cognitive layer synchronized with your specific course syllabus, lab requirements, and Professor Pei's unique teaching style.
              </p>
            </div>

            <div className="features-list space-y-8">
              {[
                { 
                  icon: <Icons.IconBook className="w-5 h-5" />, 
                  title: "Syllabus Synchronization", 
                  desc: "Every lecture slide, reading assignment, and lab manual is indexed for instant retrieval." 
                },
                { 
                  icon: <Icons.IconCode className="w-5 h-5" />, 
                  title: "Real-time Debugging", 
                  desc: "Paste your MapReduce or D3.js code for instant logic verification and optimization tips." 
                },
                { 
                  icon: <Icons.IconTrending className="w-5 h-5" />, 
                  title: "Predictive Guidance", 
                  desc: "Identifies conceptual gaps before they become grade-threatening obstacles." 
                }
              ].map((item, i) => (
                <div key={i} className="feature-item flex items-start space-x-6 group">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 group-hover:bg-cyan-500/20 group-hover:border-cyan-500/50 transition-all duration-500">
                    <div className="text-cyan-400 group-hover:scale-110 transition-transform">{item.icon}</div>
                  </div>
                  <div>
                    <h4 className="font-black text-lg tracking-tight uppercase font-['Space_Grotesk'] mb-1">{item.title}</h4>
                    <p className="text-zinc-500 text-sm font-medium leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="reveal-text pt-6">
              <button 
                onClick={onGetStarted}
                className="group relative px-12 py-6 bg-white text-black font-black text-xs uppercase tracking-[0.2em] rounded-2xl overflow-hidden transition-all hover:scale-105 active:scale-95 shadow-2xl shadow-white/10"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <span className="relative z-10 group-hover:text-white transition-colors">Initialize AI Session</span>
              </button>
            </div>
          </div>

          {/* Right: Hardware Widget (Recipe 3) */}
          <div ref={cardRef} className="perspective-1000">
            <div className="relative bg-[#0A0A0A] border border-white/10 rounded-[3.5rem] p-10 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] overflow-hidden group">
              {/* Glass Morphism Overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none"></div>
              
              {/* Hardware Header */}
              <div className="flex items-center justify-between mb-12 relative z-10">
                <div className="flex items-center space-x-5">
                  <div className="w-14 h-14 bg-cyan-500 rounded-2xl flex items-center justify-center text-black shadow-[0_0_30px_rgba(6,182,212,0.4)]">
                    <Icons.IconBot className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="font-black text-sm uppercase tracking-widest">Sentinel-1</h3>
                    <div className="flex items-center space-x-2 mt-1">
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                      <span className="text-[8px] font-black text-zinc-500 uppercase tracking-[0.3em]">Core Online</span>
                    </div>
                  </div>
                </div>
                <div className="flex space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-500">
                    <Icons.IconSettings className="w-4 h-4" />
                  </div>
                </div>
              </div>

              {/* Chat Visualization */}
              <div className="space-y-8 min-h-[350px] relative z-10">
                <div className="space-y-2">
                  <div className="text-[8px] font-black text-zinc-600 uppercase tracking-widest ml-4">Student_4921</div>
                  <div className="max-w-[85%] p-6 bg-white/5 border border-white/10 rounded-[2rem] rounded-tl-none">
                    <p className="text-sm font-medium text-zinc-300 leading-relaxed">
                      How do I optimize the <span className="text-white font-bold">shuffle phase</span> in my MapReduce job for the Module 4 lab?
                    </p>
                  </div>
                </div>
                
                <div className="space-y-2 flex flex-col items-end">
                  <div className="text-[8px] font-black text-cyan-500/50 uppercase tracking-widest mr-4">Sentinel_AI</div>
                  <div className="max-w-[85%] p-6 bg-cyan-500 text-black rounded-[2rem] rounded-tr-none shadow-[0_20px_40px_rgba(6,182,212,0.2)]">
                    <p className="text-sm font-bold leading-relaxed">
                      Focus on your <span className="underline decoration-2">Combiner</span> logic. By aggregating data locally before the shuffle, you reduce network I/O significantly. Want to see a code example?
                    </p>
                  </div>
                </div>
              </div>

              {/* Hardware Controls */}
              <div className="mt-12 pt-8 border-t border-white/5 relative z-10">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex space-x-4">
                    <div className="h-2 w-12 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-500 w-2/3"></div>
                    </div>
                    <div className="h-2 w-12 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-50 w-1/2"></div>
                    </div>
                  </div>
                  <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Telemetry: Active</span>
                </div>
                
                <div className="flex items-center space-x-4">
                  <div className="flex-1 h-14 bg-white/5 border border-white/10 rounded-2xl px-6 flex items-center text-zinc-500 text-xs font-bold">
                    Ask a technical question...
                  </div>
                  <button className="w-14 h-14 bg-white text-black rounded-2xl flex items-center justify-center hover:bg-cyan-500 hover:text-white transition-all">
                    <Icons.IconTrending className="w-5 h-5 rotate-90" />
                  </button>
                </div>
              </div>

              {/* Decorative Grid */}
              <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
            </div>
          </div>

        </div>
      </div>
      
      <style>{`
        .perspective-1000 { perspective: 1000px; }
      `}</style>
    </section>
  );
};

export default AITutorSection;
