
import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';

interface StudentAuthProps {
  onBack: () => void;
  onSuccess?: () => void;
}

const StudentAuth: React.FC<StudentAuthProps> = ({ onBack, onSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const visualSideRef = useRef<HTMLDivElement>(null);
  const formSideRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(visualSideRef.current, { xPercent: -100, duration: 1, ease: "power4.out" });
      gsap.from(formSideRef.current, { xPercent: 100, duration: 1, ease: "power4.out" });
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

    if (!isLogin) {
      if (password !== confirmPassword) { showToast("Passwords mismatch", "error"); return; }
      if (!agreeTerms) { showToast("Agree to terms required", "error"); return; }
    }

    setLoading(true);

    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        
        // If they log in as a student but don't have a role, set it. 
        // DO NOT overwrite if it's already 'teacher'.
        if (data.user && !data.user.user_metadata?.role) {
          await supabase.auth.updateUser({
            data: { role: 'student' }
          });
        }

        showToast("Synchronizing Student Profile...", "success");
        setTimeout(() => onSuccess?.(), 400);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { 
              full_name: fullName,
              role: 'student'
            }
          }
        });
        if (error) throw error;

        if (data.user) {
          await supabase.from('students').upsert({
            id: data.user.id,
            student_name: fullName,
            student_email: email,
            enrolled_courses: ['BIG_DATA_2026'],
            created_at: new Date().toISOString()
          });
        }
        
        showToast("Welcome to Section 001!", "success");
        setTimeout(() => onSuccess?.(), 400);
      }
    } catch (error: any) {
      console.error("Student Auth Exception:", error);
      let errorMsg = error.message || "Credential verification failed";
      
      if (errorMsg.includes("Failed to fetch") || error.name === 'TypeError') {
        errorMsg = "Network Connectivity Error: The hub is currently unreachable. Please check your internet connection.";
      }
      
      showToast(errorMsg, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({ 
        provider: 'google',
        options: {
          data: { role: 'student' },
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
    } catch (error: any) {
      showToast(error.message, "error");
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  };

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { showToast("Provide email address", "error"); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      showToast("Reset instructions dispatched", "success");
      setShowResetModal(false);
    } catch (error: any) {
      showToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={containerRef} className="fixed inset-0 z-[10000] flex flex-col md:flex-row bg-white overflow-hidden font-['Plus_Jakarta_Sans']">
      
      {toast && (
        <div className={`fixed top-6 right-6 z-[10001] max-w-[420px] px-6 py-5 rounded-2xl shadow-2xl animate-slide-in-right text-white font-bold flex items-start space-x-3 transition-colors ${toast.type === 'success' ? 'bg-cyan-600' : 'bg-red-500'}`}>
          <span className="text-xl mt-0.5">{toast.type === 'success' ? '🛡️' : '⚠️'}</span>
          <div className="flex-1">
            <p className="text-[11px] font-black uppercase tracking-widest leading-relaxed">{toast.message}</p>
          </div>
        </div>
      )}

      {showResetModal && (
        <div className="fixed inset-0 z-[10002] bg-[#0F172A]/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[2rem] p-10 shadow-2xl animate-pop-in relative">
            <button onClick={() => setShowResetModal(false)} className="absolute top-6 right-6 text-zinc-400 hover:text-zinc-900 transition-colors">✕</button>
            <h3 className="text-2xl font-black text-zinc-900 mb-2 font-['Space_Grotesk']">Reset Sync</h3>
            <p className="text-zinc-500 text-sm mb-8 font-medium">Verify your email to receive recovery link.</p>
            <form onSubmit={resetPassword} className="space-y-4">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@mail.usf.edu" className="w-full h-14 px-6 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-cyan-500 focus:outline-none font-bold text-sm" />
              <button disabled={loading} className="w-full h-14 bg-cyan-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-cyan-700 transition-all shadow-lg">Dispatched Link</button>
            </form>
          </div>
        </div>
      )}

      <div ref={visualSideRef} className="hidden md:flex flex-col md:w-1/2 h-full bg-cyan-600 relative p-16 justify-center overflow-hidden">
        <div className="relative z-10 text-white">
          <button onClick={onBack} className="absolute -top-32 left-0 flex items-center space-x-2 text-white/80 hover:text-white transition-all group">
            <svg className="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            <span className="font-bold">Home</span>
          </button>
          <div className="text-7xl mb-8">🎓</div>
          <h1 className="text-5xl lg:text-[72px] font-black leading-[1] mb-6 tracking-tighter font-['Space_Grotesk'] text-white">Student Hub</h1>
          <p className="text-xl lg:text-2xl text-white/80 max-w-lg mb-12 font-medium leading-relaxed">Engage with Big Data modules, labs, and your AI study companion.</p>
          <div className="space-y-4">
             {["Official Section 001 Hub", "Digital Course Materials", "Predictive Analytics"].map((feature, i) => (
               <div key={i} className="flex items-center space-x-3 bg-white/10 backdrop-blur-xl p-4 rounded-2xl border border-white/20 w-fit">
                  <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center text-sm">✓</div>
                  <span className="font-bold text-sm tracking-tight">{feature}</span>
               </div>
             ))}
          </div>
        </div>
      </div>

      <div ref={formSideRef} className="w-full md:w-1/2 h-full bg-white flex flex-col p-8 md:p-16 overflow-y-auto">
        <div className="w-full max-w-[440px] mx-auto flex-1 flex flex-col justify-center">
          <div className="flex justify-between items-center mb-12">
            <div className="flex items-center space-x-2">
              <div className="w-10 h-10 bg-cyan-600 rounded-xl flex items-center justify-center text-white font-black text-lg shadow-lg">USF</div>
              <span className="font-bold text-zinc-900 tracking-tight font-['Space_Grotesk'] text-xl uppercase">Student Auth</span>
            </div>
          </div>
          <div className="bg-zinc-100 p-1.5 rounded-[1.5rem] flex mb-12 relative overflow-hidden">
            <div className="absolute h-[calc(100%-12px)] top-1.5 w-[calc(50%-9px)] bg-white rounded-xl transition-transform duration-500 shadow-sm" style={{ transform: `translateX(${isLogin ? '3px' : 'calc(100% + 3px)'})` }}></div>
            <button onClick={() => setIsLogin(true)} className={`relative z-10 w-1/2 py-3.5 text-xs font-black uppercase tracking-widest ${isLogin ? 'text-cyan-600' : 'text-zinc-400'}`}>Sign In</button>
            <button onClick={() => setIsLogin(false)} className={`relative z-10 w-1/2 py-3.5 text-xs font-black uppercase tracking-widest ${!isLogin ? 'text-cyan-600' : 'text-zinc-400'}`}>New Account</button>
          </div>
          <div className="mb-10">
            <h2 className="text-4xl font-black text-zinc-900 mb-2 tracking-tighter font-['Space_Grotesk'] leading-none">{isLogin ? 'Welcome Back' : 'Create Identity'}</h2>
            <p className="text-zinc-500 font-bold text-sm">{isLogin ? 'Sync with your course environment.' : 'Initialize your student record.'}</p>
          </div>
          <form onSubmit={handleAuth} className="space-y-5">
            {!isLogin && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Student Name</label>
                <input required type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full legal name" className="w-full h-14 px-6 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-cyan-500 focus:outline-none transition-all font-bold text-sm" />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Email Address</label>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@mail.usf.edu" className="w-full h-14 px-6 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-cyan-500 focus:outline-none transition-all font-bold text-sm" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Password</label>
                {isLogin && <button type="button" onClick={() => setShowResetModal(true)} className="text-[10px] font-black text-cyan-500 hover:text-cyan-700 uppercase tracking-widest">Forgot?</button>}
              </div>
              <div className="relative">
                <input required type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full h-14 px-6 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-cyan-500 focus:outline-none transition-all font-bold text-sm" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-300 hover:text-cyan-600">{showPassword ? '👁️' : '👁️‍🗨️'}</button>
              </div>
            </div>
            {!isLogin && (
               <>
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Verify Password</label>
                    <input required type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={`w-full h-14 px-6 bg-zinc-50 border-2 rounded-2xl focus:outline-none transition-all font-bold text-sm ${confirmPassword && confirmPassword !== password ? 'border-red-500' : 'border-zinc-100 focus:border-cyan-500'}`} />
                </div>
                <label className="flex items-center space-x-3 cursor-pointer group px-1">
                    <div className={`w-6 h-6 rounded-lg border-2 transition-all flex items-center justify-center ${agreeTerms ? 'bg-cyan-600 border-cyan-600' : 'bg-white border-zinc-200'}`}>
                        {agreeTerms && <span className="text-white text-xs font-black">✓</span>}
                        <input type="checkbox" className="hidden" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                    </div>
                    <span className="text-xs font-bold text-zinc-500">Agree to <span className="text-cyan-600 underline">System Terms</span></span>
                </label>
               </>
            )}
            <button disabled={loading} type="submit" className="w-full h-16 bg-cyan-600 text-white rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-xl hover:translate-y-[-2px] active:scale-[0.98] transition-all flex items-center justify-center space-x-3">
              {loading ? <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <span>{isLogin ? 'Access Hub' : 'Register Identity'}</span>}
            </button>
          </form>
          <div className="relative py-8"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-100"></div></div><div className="relative flex justify-center text-[10px] font-black uppercase tracking-widest"><span className="bg-white px-4 text-zinc-400">or continue with</span></div></div>
          <button onClick={handleGoogleAuth} className="w-full h-14 border-2 border-zinc-100 bg-white hover:bg-zinc-50 text-zinc-900 font-bold rounded-2xl transition-all flex items-center justify-center space-x-4 text-xs uppercase tracking-widest">
            <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#EA4335" d="M5.266 9.765A7.077 7.077 0 0 1 12 4.909c1.69 0 3.218.6 4.418 1.582L19.91 3C17.782 1.145 15.055 0 12 0 7.27 0 3.198 2.698 1.24 6.65l4.026 3.115Z"/><path fill="#FBBC05" d="M16.04 18.013c-1.09.61-2.398.987-3.84.987-3.32 0-6.142-2.286-7.118-5.385l-4.025 3.115A11.964 11.964 0 0 0 12 24c3.273 0 6.273-1.09 8.564-2.95l-4.524-3.037Z"/><path fill="#4285F4" d="M12 4.909c1.69 0 3.218.6 4.418 1.582L19.91 3C17.782 1.145 15.055 0 12 0 7.27 0 3.198 2.698 1.24 6.65l4.026 3.115Z"/><path fill="#34A853" d="M23.64 12.218c0-.825-.073-1.618-.21-2.382H12v4.51h6.54c-.282 1.486-1.123 2.745-2.382 3.59l4.524 3.037c2.645-2.436 4.167-6.023 4.167-10.755Z"/></svg>
            <span>SSO Student Auth</span>
          </button>
        </div>
      </div>
      <style>{`
        @keyframes slide-in-right { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes pop-in { from { transform: scale(0.9) opacity: 0; } to { transform: scale(1) opacity: 1; } }
        .animate-slide-in-right { animation: slide-in-right 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
        .animate-pop-in { animation: pop-in 0.34s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
      `}</style>
    </div>
  );
};

export default StudentAuth;
