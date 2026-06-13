
import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '@/src/lib/supabase';
import BackgroundParticles from '@/src/components/layout/BackgroundParticles';
import * as Icons from '@/src/components/ui/Icons';

interface TeacherAuthProps {
  onBack: () => void;
  onSuccess?: () => void;
}

const TeacherAuth: React.FC<TeacherAuthProps> = ({ onBack, onSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);

  const [showTermsModal, setShowTermsModal] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const leftSideRef = useRef<HTMLDivElement>(null);
  const rightSideRef = useRef<HTMLDivElement>(null);
  const formElementsRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    try {
      const savedEmail = localStorage.getItem('remembered_teacher_email');
      if (savedEmail) {
        setEmail(savedEmail);
        setRememberMe(true);
      }
    } catch (e) { }

    const ctx = gsap.context(() => {
      if (leftSideRef.current) gsap.from(leftSideRef.current, { xPercent: -100, duration: 0.8, ease: "power4.out" });
      if (rightSideRef.current) {
        gsap.from(rightSideRef.current, { xPercent: 100, duration: 0.8, ease: "power4.out" });
      }
    }, containerRef);

    return () => ctx.revert();
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    if (!showTermsModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowTermsModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showTermsModal]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    try {
      if (isLogin) {


        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Ensure user is marked as teacher if logging in here
        if (data.user && data.user.user_metadata?.role !== 'teacher') {
          await supabase.auth.updateUser({
            data: { role: 'teacher' }
          });
        }

        if (rememberMe) {
          try { localStorage.setItem('remembered_teacher_email', email); } catch (e) { console.warn('Failed to save to localStorage', e); }
        } else {
          try { localStorage.removeItem('remembered_teacher_email'); } catch (e) { console.warn('Failed to remove from localStorage', e); }
        }

        onSuccess?.();
      } else {
        if (password.length < 8) throw new Error("Password must be at least 8 characters long");
        if (password !== confirmPassword) throw new Error("Passwords do not match");
        if (!agreeTerms) throw new Error("Accept instructor terms to proceed");

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              role: 'teacher'
            }
          }
        });
        if (error) throw error;

        if (!data.session) {
          setToast({ message: "Faculty identity record created! Check your email to verify.", type: 'success' });
          setPassword('');
          setConfirmPassword('');
          setIsLogin(true);
        } else {
          setToast({ message: "Faculty identity record created.", type: 'success' });
          setTimeout(() => onSuccess?.(), 400);
        }
      }
    } catch (error: any) {
      console.error("Auth Exception:", error);
      let errorMsg = error.message || "Credential verification error";

      if (errorMsg.includes("Failed to fetch") || error.name === 'TypeError') {
        errorMsg = "Network Connectivity Error: The login server is unreachable. Please verify your internet connection.";
      } else if (errorMsg.includes("Invalid login credentials")) {
        errorMsg = "Identity Mismatch: These credentials do not correspond with our faculty ledger.";
      }

      setToast({ message: errorMsg, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={containerRef} className="fixed inset-0 z-[1000] flex flex-col md:flex-row bg-[var(--bg-main)] overflow-hidden font-['Plus_Jakarta_Sans']">
      {toast && (
        <div className={`fixed top-6 right-6 z-[2000] max-w-[420px] px-6 py-5 rounded-[1.25rem] shadow-[var(--shadow-xl)] animate-slide-in-right text-white font-bold flex items-start space-x-3 transition-colors ${toast.type === 'success' ? 'bg-[var(--text-primary)]' : 'bg-[var(--color-danger)]'}`}>
          <span className="text-xl mt-0.5">{toast.type === 'success' ? '🛡️' : '⚠️'}</span>
          <div className="flex-1">
            <p className="text-[11px] font-black uppercase tracking-widest leading-relaxed">{toast.message}</p>
          </div>
        </div>
      )}

      <div ref={leftSideRef} className="hidden md:flex flex-col md:w-1/2 h-full bg-[var(--text-primary)] relative p-12 justify-center overflow-hidden">
        <BackgroundParticles />
        <div className="relative z-10 text-white">
          <div className="text-6xl mb-8 flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-[var(--brand-primary)] flex items-center justify-center text-white shadow-[var(--shadow-xl)]">
              <Icons.IconChart className="w-8 h-8" />
            </div>
          </div>
          <h1 className="text-4xl lg:text-5xl font-extrabold leading-[1.1] mb-6 tracking-tighter font-['Space_Grotesk'] uppercase text-white">EduConnect AI</h1>
          <p className="text-xl lg:text-2xl text-white/60 max-w-lg mb-12 font-medium leading-relaxed">Secure gateway for faculty engaging across all Canvas learning environments.</p>
        </div>
      </div>

      <div ref={rightSideRef} className="w-full md:w-1/2 h-full bg-[var(--bg-card)] p-6 md:p-10 overflow-y-auto">
        <div className="w-full max-w-[440px] mx-auto py-4">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-[var(--brand-primary)] rounded-[0.625rem] flex items-center justify-center text-white font-bold text-sm">
                <Icons.IconTarget className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest font-['Space_Grotesk']">Instructor Auth</span>
            </div>
          </div>

          <div className="bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] p-1.5 rounded-[1.5rem] flex mb-6 relative overflow-hidden">
            <div className="absolute h-[calc(100%-12px)] top-1.5 w-[calc(50%-9px)] bg-[var(--bg-card)] rounded-[0.75rem] transition-transform duration-500 shadow-[var(--shadow-sm)]" style={{ transform: `translateX(${isLogin ? '3px' : 'calc(100% + 3px)'})` }}></div>
            <button onClick={() => setIsLogin(true)} className={`relative z-10 w-1/2 py-3 text-[10px] font-black uppercase tracking-widest ${isLogin ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>Course Access</button>
            <button onClick={() => setIsLogin(false)} className={`relative z-10 w-1/2 py-3 text-[10px] font-black uppercase tracking-widest ${!isLogin ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>New Instructor</button>
          </div>

          <h2 className="text-4xl font-black text-[var(--text-primary)] mb-2 tracking-tighter font-['Space_Grotesk'] leading-none">{isLogin ? 'Synchronize' : 'Register'}</h2>
          <p className="text-[var(--text-muted)] font-bold text-sm mb-6">{isLogin ? 'Establish a secure session for course management.' : 'Initialize your official faculty credentials.'}</p>

          <form onSubmit={handleAuth} className="space-y-4" ref={formElementsRef}>
            {!isLogin && (
              <div className="space-y-2">
                <label htmlFor="auth-fullname" className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Academic Name</label>
                <input id="auth-fullname" required type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full Name" className="w-full h-14 px-6 bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1.25rem] focus:border-[var(--brand-primary)] focus:outline-none transition-all font-bold text-sm shadow-[var(--shadow-sm)]" />
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor="auth-email" className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Email Address</label>
              <input id="auth-email" required type="email" autoComplete="username email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="instructor@usf.edu" className="w-full h-14 px-6 bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1.25rem] focus:border-[var(--brand-primary)] focus:outline-none transition-all font-bold text-sm shadow-[var(--shadow-sm)]" />
            </div>
            <div className="space-y-2">
              <label htmlFor="auth-password" className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Secure Faculty Key</label>
              <div className="relative">
                <input id="auth-password" required type={showPassword ? "text" : "password"} autoComplete={isLogin ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full h-14 px-6 bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1.25rem] focus:border-[var(--brand-primary)] focus:outline-none transition-all font-bold text-sm shadow-[var(--shadow-sm)] pr-12" />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)} className="absolute right-5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] rounded">
                  {showPassword ? <Icons.IconCheck className="w-4 h-4 opacity-50" /> : <Icons.IconTarget className="w-4 h-4 opacity-50" />}
                </button>
              </div>
            </div>
            {isLogin && (
              <label htmlFor="auth-remember" className="flex items-center space-x-3 cursor-pointer group mt-2">
                <div className="relative">
                  <input id="auth-remember" type="checkbox" className="peer sr-only" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-[var(--brand-primary)] ${rememberMe ? 'bg-[var(--brand-primary)] border-[var(--brand-primary)]' : 'bg-[var(--bg-card)] border-[var(--border-primary)] group-hover:border-[var(--border-strong)]'}`}>
                    {rememberMe && <span className="text-white text-[10px] font-black">✓</span>}
                  </div>
                </div>
                <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Persist Academic Session</span>
              </label>
            )}
            {!isLogin && (
              <>
                <div className="space-y-2">
                  <label htmlFor="auth-confirm-password" className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Verify Faculty Key</label>
                  <input id="auth-confirm-password" required type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" className={`w-full h-14 px-6 bg-[var(--bg-nested)] border-2 rounded-[1.25rem] focus:outline-none transition-all font-bold text-sm ${confirmPassword && confirmPassword !== password ? 'border-[var(--color-danger)]' : 'border-[var(--border-primary)] focus:border-[var(--brand-primary)]'}`} />
                </div>
                <label htmlFor="auth-agree" className="flex items-center space-x-3 cursor-pointer group">
                  <div className="relative">
                    <input id="auth-agree" type="checkbox" className="peer sr-only" checked={agreeTerms} onChange={e => setAgreeTerms(e.target.checked)} />
                    <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-[var(--brand-primary)] ${agreeTerms ? 'bg-[var(--brand-primary)] border-[var(--brand-primary)]' : 'bg-[var(--bg-card)] border-[var(--border-primary)]'}`}>
                      {agreeTerms && <span className="text-white text-xs font-black">✓</span>}
                    </div>
                  </div>
                  <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Agree to <button type="button" onClick={() => setShowTermsModal(true)} className="underline hover:text-[var(--brand-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] rounded">Course Security Protocol</button></span>
                </label>
              </>
            )}
            <button disabled={loading} type="submit" className="w-full h-16 bg-[var(--brand-primary)] text-white rounded-[1.25rem] font-black text-[11px] uppercase tracking-[0.25em] shadow-[var(--shadow-xl)] hover:translate-y-[-2px] active:scale-[0.98] transition-all flex items-center justify-center space-x-3 disabled:opacity-50 mt-4">
              {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <span>{isLogin ? 'Access Course Hub' : 'Register Profile'}</span>}
            </button>
          </form>
        </div>
      </div>

      {showTermsModal && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] max-w-lg w-full rounded-[2rem] shadow-[var(--shadow-xl)] border-2 border-[var(--border-primary)] overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b-2 border-[var(--border-primary)] flex justify-between items-center">
              <h3 className="text-sm font-black uppercase tracking-widest text-[var(--text-primary)] flex items-center gap-2">
                <Icons.IconLock className="w-4 h-4 text-indigo-500" />
                Course Security Protocol
              </h3>
              <button onClick={() => setShowTermsModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                <Icons.IconX className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto text-sm text-[var(--text-secondary)] space-y-4 font-medium leading-relaxed">
              <p>Welcome to EduConnect AI. By accessing this platform, you agree to the following terms regarding the handling of academic data:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>Data Isolation:</strong> You agree not to intermix data between isolated Canvas course environments.</li>
                <li><strong>FERPA Compliance:</strong> You acknowledge your responsibility to adhere to FERPA guidelines when viewing or processing student submissions and grades.</li>
                <li><strong>AI Evaluation:</strong> You understand that the AI grading tools are assistive. Final academic judgments remain the responsibility of the instructor.</li>
                <li><strong>Key Security:</strong> You will securely manage your personal Canvas API tokens and Gemini API keys, refraining from sharing them.</li>
              </ul>
              <p>These protocols ensure a safe, private, and rigorous environment for both faculty and students.</p>
            </div>
            <div className="p-6 border-t-2 border-[var(--border-primary)] flex justify-end">
              <button onClick={() => { setAgreeTerms(true); setShowTermsModal(false); }} className="px-6 py-3 bg-[var(--brand-primary)] text-white text-xs font-black uppercase tracking-widest rounded-xl hover:brightness-110 transition-colors">
                Accept & Continue
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slide-in-right { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .animate-slide-in-right { animation: slide-in-right 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
};

export default TeacherAuth;



