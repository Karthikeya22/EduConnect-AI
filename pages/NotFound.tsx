
import React from 'react';

interface NotFoundProps {
  onBack: () => void;
}

const NotFound: React.FC<NotFoundProps> = ({ onBack }) => {
  return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-[#F9F8F3] px-6 text-center font-['Plus_Jakarta_Sans']">
      <div className="text-[12rem] font-black text-zinc-900/5 leading-none absolute select-none">404</div>
      <div className="relative z-10">
        <div className="text-8xl mb-8">🧭</div>
        <h1 className="text-5xl md:text-6xl font-black text-zinc-900 tracking-tighter font-['Space_Grotesk'] mb-4">Lost in Data</h1>
        <p className="text-lg text-zinc-500 font-bold max-w-md mx-auto mb-12 leading-relaxed">
          The requested module or directory could not be located in our Big Data ecosystem.
        </p>
        <button 
          onClick={onBack}
          className="px-12 py-5 bg-zinc-900 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-sm shadow-2xl hover:scale-105 active:scale-95 transition-all"
        >
          Return to Hub
        </button>
      </div>
      <div className="absolute bottom-12 text-[10px] font-black text-zinc-300 uppercase tracking-widest">
        EDUCONNECT AI • ERROR_NODE_NOT_FOUND
      </div>
    </div>
  );
};

export default NotFound;
