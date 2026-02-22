
import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';

interface RoleSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (path: 'home' | 'teacher-login' | 'student-login') => void;
}

const RoleSelectionModal: React.FC<RoleSelectionModalProps> = ({ isOpen, onClose, onNavigate }) => {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isActive, setIsActive] = useState(false);
  
  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement[]>([]);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      // Small delay to trigger CSS transitions after mount
      const timer = setTimeout(() => {
        setIsActive(true);
        document.body.style.overflow = 'hidden';
        
        // GSAP for internal card staggering
        gsap.fromTo(cardsRef.current,
          { y: 20, opacity: 0 },
          { 
            y: 0, 
            opacity: 1, 
            stagger: 0.1, 
            duration: 0.5, 
            delay: 0.15, 
            ease: "power2.out" 
          }
        );
        
        // Accessibility: Focus the first button
        setTimeout(() => firstButtonRef.current?.focus(), 200);
      }, 20);

      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', handleEsc);
      return () => {
        window.removeEventListener('keydown', handleEsc);
        clearTimeout(timer);
      };
    } else {
      setIsActive(false);
      document.body.style.overflow = '';
      const timer = setTimeout(() => setIsRendered(false), 400);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose]);

  if (!isRendered) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleRoleSelection = (role: 'teacher' | 'student') => {
    if (role === 'teacher' && onNavigate) {
      onNavigate('teacher-login');
    } else if (role === 'student' && onNavigate) {
      onNavigate('student-login');
    } else {
      onClose();
    }
  };

  return (
    <div 
      ref={overlayRef}
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 md:p-6 transition-all duration-400 ease-[cubic-bezier(0.4,0,0.2,1)] ${
        isActive ? 'bg-black/70 backdrop-blur-sm opacity-100' : 'bg-black/0 backdrop-blur-0 opacity-0 pointer-events-none'
      }`}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div 
        ref={modalRef}
        className={`relative w-full max-w-[600px] bg-white rounded-[24px] shadow-2xl p-8 md:p-12 overflow-hidden transition-all duration-400 ease-[cubic-bezier(0.4,0,0.2,1)] transform ${
          isActive ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-4'
        }`}
      >
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 w-10 h-10 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-all active:scale-90"
          aria-label="Close modal"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-4xl mb-4">🎓</div>
          <h2 id="modal-title" className="text-2xl md:text-[32px] font-bold text-zinc-900 leading-tight mb-2">
            Welcome to Big Data Course
          </h2>
          <p className="text-zinc-500 text-base md:text-[16px]">Choose how you'd like to continue</p>
        </div>

        {/* Role Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* Teacher Card */}
          <div 
            ref={(el) => { if (el) cardsRef.current[0] = el; }}
            className="role-card group bg-[#F8FAFC] rounded-2xl p-8 text-center border-2 border-transparent hover:border-purple-400 hover:-translate-y-1 hover:shadow-xl transition-all duration-300"
          >
            <div className="text-[48px] md:text-[64px] mb-4">👨‍🏫</div>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">I'm a Teacher</h3>
            <p className="text-sm text-zinc-500 leading-snug mb-8 min-h-[40px]">
              Upload materials, create assignments, track student progress
            </p>
            <button 
              ref={firstButtonRef}
              onClick={() => handleRoleSelection('teacher')}
              className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-all active:scale-95 ripple-effect"
            >
              Continue as Teacher
            </button>
          </div>

          {/* Student Card */}
          <div 
            ref={(el) => { if (el) cardsRef.current[1] = el; }}
            className="role-card group bg-[#F8FAFC] rounded-2xl p-8 text-center border-2 border-transparent hover:border-cyan-400 hover:-translate-y-1 hover:shadow-xl transition-all duration-300"
          >
            <div className="text-[48px] md:text-[64px] mb-4">👨‍🎓</div>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">I'm a Student</h3>
            <p className="text-sm text-zinc-500 leading-snug mb-8 min-h-[40px]">
              Access course materials, complete assignments, ask AI questions
            </p>
            <button 
              onClick={() => handleRoleSelection('student')}
              className="w-full py-4 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-xl transition-all active:scale-95 ripple-effect"
            >
              Continue as Student
            </button>
          </div>

        </div>
      </div>

      <style>{`
        .role-card {
          perspective: 1000px;
        }
        .ripple-effect {
          position: relative;
          overflow: hidden;
        }
        .ripple-effect:after {
          content: "";
          display: block;
          position: absolute;
          width: 100%;
          height: 100%;
          top: 0;
          left: 0;
          pointer-events: none;
          background-image: radial-gradient(circle, #fff 10%, transparent 10.01%);
          background-repeat: no-repeat;
          background-position: 50%;
          transform: scale(10, 10);
          opacity: 0;
          transition: transform .5s, opacity 1s;
        }
        .ripple-effect:active:after {
          transform: scale(0, 0);
          opacity: .3;
          transition: 0s;
        }
      `}</style>
    </div>
  );
};

export default RoleSelectionModal;
