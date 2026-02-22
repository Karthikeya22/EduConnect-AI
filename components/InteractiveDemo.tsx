
import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';

const steps = [
  {
    number: "01",
    title: "Professor Uploads Content",
    desc: "Professor Pei uploads the syllabus, lecture slides, and Big Data readings. The AI organizes them into a clean module structure.",
    mockup: "upload"
  },
  {
    number: "02",
    title: "Smart Course Generation",
    desc: "The platform generates specific assignments, discussion prompts, and lesson plans for each visualization topic.",
    mockup: "learn"
  },
  {
    number: "03",
    title: "Student Exploration",
    desc: "Students explore modules, interact with the AI assistant for complex concepts, and submit their visualization labs.",
    mockup: "student"
  },
  {
    number: "04",
    title: "Analytics & Adjustments",
    desc: "Professor Pei reviews engagement analytics to identify struggle points and adjust teaching for the next session.",
    mockup: "track"
  }
];

const InteractiveDemo: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const ctx = gsap.context(() => {
      steps.forEach((_, i) => {
        gsap.to(`.step-${i}`, {
          scrollTrigger: {
            trigger: `.step-${i}`,
            start: "top center",
            end: "bottom center",
            onEnter: () => setActiveStep(i),
            onEnterBack: () => setActiveStep(i),
          }
        });
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  const renderMockupContent = () => {
    switch(activeStep) {
      case 0:
        return (
          <div className="flex flex-col h-full items-center justify-center space-y-6 p-8">
             <div className="w-24 h-24 bg-orange-100 border border-orange-200 rounded-[2rem] flex items-center justify-center animate-bounce shadow-sm">
                <span className="text-5xl">📊</span>
             </div>
             <div className="text-center w-full">
                <div className="w-3/4 h-3 bg-zinc-100 rounded-full mx-auto mb-3"></div>
                <div className="w-1/2 h-3 bg-zinc-50 rounded-full mx-auto"></div>
             </div>
             <div className="grid grid-cols-2 gap-4 w-full">
                <div className="h-16 bg-blue-50/50 rounded-2xl border border-blue-100 animate-pulse"></div>
                <div className="h-16 bg-green-50/50 rounded-2xl border border-green-100 animate-pulse delay-75"></div>
             </div>
          </div>
        );
      case 1:
        return (
          <div className="flex flex-col h-full items-center justify-center p-10">
             <div className="w-32 h-32 bg-zinc-900 rounded-[2.5rem] flex items-center justify-center relative shadow-xl">
                <div className="absolute inset-0 bg-zinc-900/10 rounded-[2.5rem] animate-ping"></div>
                <span className="text-5xl z-10">🧠</span>
             </div>
             <div className="mt-10 space-y-3 w-full">
                <div className="h-3 bg-zinc-100 rounded-full w-full"></div>
                <div className="h-3 bg-zinc-100 rounded-full w-5/6"></div>
                <div className="h-3 bg-zinc-100 rounded-full w-2/3"></div>
             </div>
          </div>
        );
      case 2:
        return (
          <div className="p-8 h-full flex flex-col">
            <div className="flex items-center space-x-4 mb-10">
              <div className="w-12 h-12 rounded-full bg-zinc-100 border border-zinc-200"></div>
              <div className="flex-1 space-y-2">
                <div className="w-32 h-3 bg-zinc-100 rounded"></div>
                <div className="w-20 h-2 bg-zinc-50 rounded"></div>
              </div>
            </div>
            <div className="flex-1 bg-zinc-50/50 rounded-[2rem] p-6 flex flex-col justify-end space-y-4 border border-zinc-100">
               <div className="bg-zinc-900 self-start p-4 rounded-2xl rounded-bl-none max-w-[85%] text-xs text-white font-medium shadow-sm">
                 I've highlighted the key trends in Dataset 04-A for your visualization lab.
               </div>
               <div className="bg-white border border-zinc-200 self-end p-4 rounded-2xl rounded-br-none max-w-[85%] text-xs text-zinc-900 font-bold shadow-sm">
                 Thanks! How do I filter this in D3.js?
               </div>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="p-10 h-full flex flex-col">
            <div className="flex justify-between items-center mb-8">
               <div className="font-bold text-zinc-400 text-xs tracking-widest uppercase">Student Analytics</div>
               <div className="w-8 h-8 rounded-lg bg-zinc-50"></div>
            </div>
            <div className="flex-1 grid grid-cols-4 gap-3 items-end">
              <div className="h-[40%] bg-orange-200 rounded-xl border border-orange-300 shadow-sm animate-grow-height"></div>
              <div className="h-[70%] bg-blue-200 rounded-xl border border-blue-300 shadow-sm animate-grow-height delay-100"></div>
              <div className="h-[55%] bg-green-200 rounded-xl border border-green-300 shadow-sm animate-grow-height delay-200"></div>
              <div className="h-[85%] bg-pink-200 rounded-xl border border-pink-300 shadow-sm animate-grow-height delay-300"></div>
            </div>
          </div>
        );
      default: return null;
    }
  };

  return (
    <section id="demo" ref={containerRef} className="py-24 bg-white/40">
      <div className="container mx-auto px-6">
        <div className="flex flex-col lg:flex-row gap-12 lg:gap-24 relative">
          
          {/* Left: Sticky Visual */}
          <div className="lg:w-1/2 lg:sticky lg:top-32 h-[400px] lg:h-[600px] flex items-center justify-center">
            <div className="w-full h-full max-w-lg bg-white rounded-[3rem] border border-zinc-100 shadow-2xl shadow-zinc-200 overflow-hidden relative group">
              <div className="absolute top-0 left-0 w-full h-10 bg-zinc-50/50 flex items-center px-8 space-x-2 border-b border-zinc-100/50">
                <div className="w-2.5 h-2.5 bg-zinc-200 rounded-full"></div>
                <div className="w-2.5 h-2.5 bg-zinc-200 rounded-full"></div>
                <div className="w-2.5 h-2.5 bg-zinc-200 rounded-full"></div>
              </div>
              <div className="pt-10 h-full transition-all duration-500">
                {renderMockupContent()}
              </div>
            </div>
          </div>

          {/* Right: Scrolling Steps */}
          <div className="lg:w-1/2 py-20">
            {steps.map((step, idx) => (
              <div 
                key={idx} 
                className={`step-${idx} mb-32 last:mb-0 transition-opacity duration-500 ${activeStep === idx ? 'opacity-100' : 'opacity-20'}`}
              >
                <div className="text-7xl font-black text-zinc-100 mb-6 tracking-tighter">{step.number}</div>
                <h3 className="text-4xl font-extrabold mb-6 text-zinc-900 tracking-tight">{step.title}</h3>
                <p className="text-lg text-zinc-500 font-medium leading-relaxed">{step.desc}</p>
                <div className="mt-8 flex items-center text-zinc-900 font-bold group cursor-pointer text-sm uppercase tracking-widest">
                  <span>View Process</span>
                  <svg className="w-4 h-4 ml-2 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M17 8l4 4m0 0l-4 4m4-4H3"></path></svg>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
      <style>{`
        @keyframes grow-height {
          from { height: 0; }
        }
        .animate-grow-height {
          animation: grow-height 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
      `}</style>
    </section>
  );
};

export default InteractiveDemo;
