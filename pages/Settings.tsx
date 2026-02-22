
import React, { useState, useEffect } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';

interface SettingsProps {
  onBack: () => void;
  onNavigateTo: (path: AppPath) => void;
  onLogout: () => void;
}

const Settings: React.FC<SettingsProps> = (props) => {
  const [user, setUser] = useState<any>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        setFullName(session.user.user_metadata?.full_name || '');
        setEmail(session.user.email || '');
      }
    };
    fetchUser();
    
    gsap.from(".settings-card", {
      opacity: 0,
      y: 20,
      stagger: 0.1,
      duration: 0.8,
      ease: "power3.out"
    });
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: fullName }
      });
      if (error) throw error;
      setToast({ msg: "Profile updated successfully!", type: 'success' });
    } catch (err: any) {
      setToast({ msg: err.message, type: 'error' });
    } finally {
      setLoading(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const role = user?.user_metadata?.role || 'student';

  return (
    <div className={`flex h-screen overflow-hidden font-['Plus_Jakarta_Sans'] ${role === 'teacher' ? 'bg-[#F9F8F3]' : 'bg-[#F8FAFC]'}`}>
      <AppSidebar 
        role={role} 
        currentPath="settings" 
        onNavigateTo={props.onNavigateTo} 
        collapsed={collapsed} 
        setCollapsed={setCollapsed} 
        onLogout={props.onLogout}
      />

      <main className="flex-1 overflow-y-auto p-8 md:p-12 scroll-smooth relative">
        {toast && (
          <div className={`fixed top-8 right-8 z-50 px-6 py-4 rounded-2xl shadow-2xl text-white font-bold animate-slide-in ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
            {toast.msg}
          </div>
        )}

        <div className="max-w-4xl mx-auto">
          <header className="mb-12">
            <button onClick={props.onBack} className="text-zinc-400 font-bold hover:text-zinc-900 mb-4 flex items-center transition-colors group">
              <span className="mr-2 group-hover:-translate-x-1 transition-transform">←</span> Back to Hub
            </button>
            <h1 className={`text-4xl md:text-5xl font-black mb-2 tracking-tighter font-['Space_Grotesk'] bg-clip-text text-transparent ${role === 'teacher' ? 'bg-gradient-to-r from-zinc-900 to-zinc-500' : 'bg-gradient-to-r from-cyan-600 to-purple-600'}`}>
              Account Settings
            </h1>
            <p className="text-zinc-500 font-bold">Manage your academic identity and portal preferences.</p>
          </header>

          <div className="space-y-8">
            <section className="settings-card bg-white p-10 rounded-[2.5rem] border border-zinc-100 shadow-xl shadow-zinc-200/50">
              <h3 className="text-xl font-bold mb-8 flex items-center">
                <span className="mr-3">👤</span> Profile Information
              </h3>
              <form onSubmit={handleUpdate} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Full Display Name</label>
                    <input 
                      value={fullName} 
                      onChange={e => setFullName(e.target.value)}
                      className={`w-full h-14 px-6 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:outline-none transition-all font-bold text-sm ${role === 'teacher' ? 'focus:border-zinc-900' : 'focus:border-cyan-500'}`} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Email Address (Read Only)</label>
                    <input 
                      value={email} 
                      disabled
                      className="w-full h-14 px-6 bg-zinc-100 border-2 border-zinc-200 rounded-2xl text-zinc-400 font-bold text-sm cursor-not-allowed" 
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-4">
                  <button 
                    disabled={loading}
                    type="submit"
                    className={`px-10 h-14 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-xl ${role === 'teacher' ? 'bg-zinc-900' : 'bg-cyan-600'}`}
                  >
                    {loading ? "Saving..." : "Save Profile"}
                  </button>
                </div>
              </form>
            </section>

            <section className="settings-card bg-white p-10 rounded-[2.5rem] border border-zinc-100 shadow-xl shadow-zinc-200/50">
              <h3 className="text-xl font-bold mb-8 flex items-center">
                <span className="mr-3">🔒</span> Security
              </h3>
              <div className="flex items-center justify-between p-6 bg-zinc-50 rounded-2xl border border-zinc-100">
                <div>
                  <p className="font-bold text-zinc-900">Portal Password</p>
                  <p className="text-xs text-zinc-500 font-medium">Last synced: Today</p>
                </div>
                <button className="px-6 h-10 border-2 border-zinc-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:border-zinc-900 hover:text-zinc-900 transition-all">Update Key</button>
              </div>
            </section>

            <section className={`settings-card p-10 rounded-[2.5rem] shadow-2xl text-white ${role === 'teacher' ? 'bg-[#18181B]' : 'bg-[#0F172A]'}`}>
              <h3 className="text-xl font-bold mb-4">Portal Intelligence</h3>
              <p className="text-zinc-400 text-sm mb-8">Choose how the system intelligence interacts with your profile.</p>
              <div className="space-y-4">
                {['Direct AI Feedback', 'Anonymized Data Contribution', 'Activity Tracking'].map(pref => (
                  <label key={pref} className="flex items-center justify-between cursor-pointer group">
                    <span className="font-bold text-sm">{pref}</span>
                    <div className="w-12 h-6 bg-white/5 rounded-full p-1 group-hover:bg-white/10 transition-colors">
                      <div className={`w-4 h-4 bg-white rounded-full transition-transform translate-x-6`}></div>
                    </div>
                  </label>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
      <style>{`
        @keyframes slide-in { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .animate-slide-in { animation: slide-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
      `}</style>
    </div>
  );
};

export default Settings;
