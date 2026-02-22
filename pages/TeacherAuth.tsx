
import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';

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

  const containerRef = useRef<HTMLDivElement>(null);
  const leftSideRef = useRef<HTMLDivElement>(null);
  const rightSideRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const savedEmail = localStorage.getItem('remembered_teacher_email');
      if (savedEmail) {
        setEmail(savedEmail);
        setRememberMe(true);
      }
    } catch (e) {}

    const ctx = gsap.context(() => {
      if (leftSideRef.current) gsap.from(leftSideRef.current, { xPercent: -100, duration: 0.8, ease: "power4.out" });
      if (rightSideRef.current) gsap.from(rightSideRef.current, { xPercent: 100, duration: 0.8, ease: "power4.out" });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

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
          try { localStorage.setItem('remembered_teacher_email', email); } catch (e) {}
        } else {
          try { localStorage.removeItem('remembered_teacher_email'); } catch (e) {}
        }

        onSuccess?.();
      } else {
        if (password !== confirmPassword) throw new Error("Passwords do not match");
        if (!agreeTerms) throw new Error("Accept instructor terms to proceed");
        
        const { error } = await supabase.auth.signUp({
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
        setToast({ message: "Faculty identity record created. Please verify your email.", type: 'success' });
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
    <div ref={containerRef} className="fixed inset-0 z-[1000] flex flex-col md:flex-row bg-white overflow-hidden font-['Plus_Jakarta_Sans']">
      {toast && (
        <div className={`fixed top-6 right-6 z-[2000] max-w-[420px] px-6 py-5 rounded-2xl shadow-2xl animate-slide-in-right text-white font-bold flex items-start space-x-3 transition-colors ${toast.type === 'success' ? 'bg-zinc-900' : 'bg-red-500'}`}>
          <span className="text-xl mt-0.5">{toast.type === 'success' ? '🛡️' : '⚠️'}</span>
          <div className="flex-1">
            <p className="text-[11px] font-black uppercase tracking-widest leading-relaxed">{toast.message}</p>
          </div>
        </div>
      )}

      <div ref={leftSideRef} className="hidden md:flex flex-col md:w-1/2 h-full bg-[#0F172A] relative p-12 justify-center overflow-hidden">
        <div className="relative z-10 text-white">
          <button onClick={onBack} className="absolute -top-32 left-0 flex items-center space-x-2 text-white/80 hover:text-white transition-all group">
            <svg className="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            <span className="font-black text-[10px] uppercase tracking-[0.2em]">Return to Hub</span>
          </button>
          <div className="text-6xl mb-8">🏫</div>
          <h1 className="text-5xl lg:text-[64px] font-extrabold leading-[1.1] mb-6 tracking-tighter font-['Space_Grotesk'] uppercase text-white">Professor Portal</h1>
          <p className="text-xl lg:text-2xl text-white/60 max-w-lg mb-12 font-medium leading-relaxed">Secure gateway for USF faculty engaged in BIG_DATA_2026 instruction.</p>
        </div>
      </div>

      <div ref={rightSideRef} className="w-full md:w-1/2 h-full bg-white flex flex-col p-8 md:p-12 overflow-y-auto scrollbar-hide">
        <div className="w-full max-w-[440px] mx-auto flex-1 flex flex-col justify-center py-12">
          <div className="flex justify-between items-center mb-12">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center text-white font-bold text-sm">USF</div>
              <span className="font-bold text-zinc-900 tracking-tight font-['Space_Grotesk'] uppercase text-xs">Instructor Auth</span>
            </div>
          </div>
          
          <div className="bg-zinc-100 p-1.5 rounded-[1.5rem] flex mb-12 relative overflow-hidden">
            <div className="absolute h-[calc(100%-12px)] top-1.5 w-[calc(50%-9px)] bg-white rounded-xl transition-transform duration-500 shadow-sm" style={{ transform: `translateX(${isLogin ? '3px' : 'calc(100% + 3px)'})` }}></div>
            <button onClick={() => setIsLogin(true)} className={`relative z-10 w-1/2 py-3 text-[10px] font-black uppercase tracking-widest ${isLogin ? 'text-zinc-900' : 'text-zinc-400'}`}>Course Access</button>
            <button onClick={() => setIsLogin(false)} className={`relative z-10 w-1/2 py-3 text-[10px] font-black uppercase tracking-widest ${!isLogin ? 'text-zinc-900' : 'text-zinc-400'}`}>New Instructor</button>
          </div>
          
          <h2 className="text-4xl font-black text-zinc-900 mb-2 tracking-tighter font-['Space_Grotesk'] leading-none">{isLogin ? 'Synchronize' : 'Register'}</h2>
          <p className="text-zinc-500 font-bold text-sm mb-10">{isLogin ? 'Establish a secure session for course management.' : 'Initialize your official faculty credentials.'}</p>
          
          <form onSubmit={handleAuth} className="space-y-5">
            {!isLogin && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Academic Name</label>
                <input required type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full Name" className="w-full h-14 px-6 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-zinc-900 focus:outline-none transition-all font-bold text-sm shadow-sm" />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Email Address</label>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="instructor@usf.edu" className="w-full h-14 px-6 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-zinc-900 focus:outline-none transition-all font-bold text-sm shadow-sm" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Secure Faculty Key</label>
              <div className="relative">
                <input required type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full h-14 px-6 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-zinc-900 focus:outline-none transition-all font-bold text-sm shadow-sm" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-300 hover:text-zinc-900 transition-colors">{showPassword ? '👁️' : '👁️‍🗨️'}</button>
              </div>
            </div>
            {isLogin && (
               <label className="flex items-center space-x-3 cursor-pointer group mt-2">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${rememberMe ? 'bg-zinc-900 border-zinc-900' : 'bg-white border-zinc-200 group-hover:border-zinc-400'}`}>
                    {rememberMe && <span className="text-white text-[10px] font-black">✓</span>}
                    <input type="checkbox" className="hidden" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
                  </div>
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Persist Academic Session</span>
                </label>
            )}
            {!isLogin && (
              <>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Verify Faculty Key</label>
                  <input required type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" className={`w-full h-14 px-6 bg-zinc-50 border-2 rounded-2xl focus:outline-none transition-all font-bold text-sm ${confirmPassword && confirmPassword !== password ? 'border-red-500' : 'border-zinc-100 focus:border-zinc-900'}`} />
                </div>
                <label className="flex items-center space-x-3 cursor-pointer group">
                  <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${agreeTerms ? 'bg-zinc-900 border-zinc-900' : 'bg-white border-zinc-200'}`}>
                    {agreeTerms && <span className="text-white text-xs font-black">✓</span>}
                    <input type="checkbox" className="hidden" checked={agreeTerms} onChange={e => setAgreeTerms(e.target.checked)} />
                  </div>
                  <span className="text-xs font-bold text-zinc-500">Agree to <span className="underline">Course Security Protocol</span></span>
                </label>
              </>
            )}
            <button disabled={loading} type="submit" className="w-full h-16 bg-zinc-900 text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.25em] shadow-xl hover:translate-y-[-2px] active:scale-[0.98] transition-all flex items-center justify-center space-x-3 disabled:opacity-50 mt-4">
              {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <span>{isLogin ? 'Access Course Hub' : 'Register Profile'}</span>}
            </button>
          </form>
        </div>
      </div>
      <style>{`
        @keyframes slide-in-right { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .animate-slide-in-right { animation: slide-in-right 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
};

export default TeacherAuth;
