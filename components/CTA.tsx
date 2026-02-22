
import React from 'react';

interface CTAProps {
  onGetStarted?: () => void;
}

const CTA: React.FC<CTAProps> = ({ onGetStarted }) => {
  const handleConfetti = () => {
    const win = window as any;
    if (win.confetti) {
      win.confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#FFEDD5', '#DBEAFE', '#DCFCE7', '#18181B']
      });
    }
  };

  const handlePrimaryClick = () => {
    handleConfetti();
    if (onGetStarted) onGetStarted();
  };

  return (
    <section id="pricing" className="py-32 px-6">
      <div className="max-w-6xl mx-auto bg-zinc-900 rounded-[3rem] p-12 md:p-24 relative overflow-hidden shadow-2xl shadow-zinc-300">
        {/* Decorative blobs for dark CTA */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-zinc-800 rounded-full -translate-y-1/2 translate-x-1/2 opacity-50"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-zinc-800 rounded-full translate-y-1/2 -translate-x-1/2 opacity-50"></div>
        
        <div className="relative z-10 text-center max-w-3xl mx-auto">
          <h2 className="text-5xl md:text-7xl font-extrabold text-white mb-8 tracking-tight leading-none">Ready to Explore Big Data?</h2>
          <p className="text-xl md:text-2xl text-zinc-400 mb-12 font-medium">Access all resources for the Big Data & Data Visualization course today.</p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-6">
            <button 
              onClick={handlePrimaryClick}
              className="px-12 py-6 bg-white text-zinc-900 rounded-2xl font-bold text-xl transition-all hover:scale-105 active:scale-95 shadow-xl shadow-black/20"
            >
              Get Started
            </button>
            <button 
              onClick={onGetStarted}
              className="text-white font-bold text-lg hover:underline underline-offset-8"
            >
              Teacher Portal
            </button>
          </div>
          
          <div className="mt-12 flex items-center justify-center space-x-8 text-zinc-500 font-semibold text-sm">
            <div className="flex items-center space-x-2">
              <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>
              <span>USF Section 001</span>
            </div>
            <div className="flex items-center space-x-2">
              <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>
              <span>Spring 2024 Hub</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTA;
