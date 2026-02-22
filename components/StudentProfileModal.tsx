
import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';

interface StudentProfileModalProps {
  student: any;
  onClose: () => void;
}

const StudentProfileModal: React.FC<StudentProfileModalProps> = ({ student, onClose }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'activity' | 'assignments'>('overview');
  const [isRendered, setIsRendered] = useState(true);
  const modalRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const [activities, setActivities] = useState<any[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);

  useEffect(() => {
    const ctx = gsap.context(() => {
        gsap.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3 });
        gsap.fromTo(modalRef.current, { scale: 0.9, opacity: 0, y: 30 }, { scale: 1, opacity: 1, y: 0, duration: 0.4, ease: "back.out(1.5)" });
    });
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    if (activeTab === 'activity') {
      fetchStudentActivities();
    }
  }, [activeTab, student.id]);

  const fetchStudentActivities = async () => {
    setLoadingActivities(true);
    try {
      // Fetch platform logs
      const { data: platformLogs } = await supabase
        .from('platform_activity_logs')
        .select('*')
        .eq('user_id', student.id)
        .order('created_at', { ascending: false })
        .limit(10);

      // Fetch assignment logs
      const { data: assignmentLogs } = await supabase
        .from('student_assignment_logs')
        .select('*')
        .eq('student_id', student.id)
        .order('timestamp', { ascending: false })
        .limit(10);

      const combined = [
        ...(platformLogs || []).map(l => ({
          id: l.id,
          type: l.action_type.includes('VIEW') ? 'read' : 'system',
          text: l.action_type.replace(/_/g, ' '),
          date: new Date(l.created_at).toLocaleString(),
          timestamp: new Date(l.created_at).getTime()
        })),
        ...(assignmentLogs || []).map(l => ({
          id: l.id,
          type: l.interaction_type.includes('post') ? 'post' : 'lab',
          text: `${l.interaction_type.replace(/_/g, ' ')}: ${l.content.substring(0, 50)}${l.content.length > 50 ? '...' : ''}`,
          date: new Date(l.timestamp).toLocaleString(),
          timestamp: new Date(l.timestamp).getTime()
        }))
      ].sort((a, b) => b.timestamp - a.timestamp).slice(0, 15);

      setActivities(combined);
    } catch (err) {
      console.error("Error fetching student activities:", err);
    } finally {
      setLoadingActivities(false);
    }
  };

  const handleClose = () => {
    gsap.to(modalRef.current, { scale: 0.9, opacity: 0, y: 30, duration: 0.3 });
    gsap.to(overlayRef.current, { opacity: 0, duration: 0.3, onComplete: onClose });
  };

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[3000] bg-[#0F172A]/80 backdrop-blur-xl flex items-center justify-center p-6" onClick={handleClose}>
        <div ref={modalRef} className="w-full max-w-4xl bg-white rounded-[3rem] shadow-2xl overflow-hidden flex flex-col h-[85vh]" onClick={e => e.stopPropagation()}>
            <header className="p-10 border-b border-zinc-100 flex flex-col md:flex-row md:items-center gap-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-purple-50 rounded-full blur-3xl opacity-50 -translate-y-1/2 translate-x-1/2"></div>
                <div className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-3xl font-black shadow-2xl z-10">
                    {student.student_name.charAt(0)}
                </div>
                <div className="z-10 flex-1">
                    <h2 className="text-3xl font-black text-zinc-900 tracking-tighter font-['Space_Grotesk']">{student.student_name}</h2>
                    <p className="text-zinc-400 font-bold uppercase tracking-widest text-xs mt-1">{student.student_email}</p>
                    <div className="flex space-x-4 mt-6">
                        <a href={`mailto:${student.student_email}`} className="px-5 py-2.5 bg-[#18181B] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all">📧 Contact Student</a>
                        <button className="px-5 py-2.5 border-2 border-zinc-100 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:border-zinc-900 hover:text-zinc-900 transition-all">📋 Internal Notes</button>
                    </div>
                </div>
                <button onClick={handleClose} className="absolute top-8 right-8 w-12 h-12 rounded-full hover:bg-zinc-100 flex items-center justify-center text-zinc-400 transition-all z-20">×</button>
            </header>

            <div className="flex-1 overflow-y-auto scrollbar-hide">
                <div className="bg-zinc-50/50 p-6 border-b border-zinc-100 flex space-x-2">
                    {['overview', 'activity', 'assignments'].map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab as any)} className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-white text-zinc-900 shadow-sm border border-zinc-200' : 'text-zinc-400 hover:text-zinc-600'}`}>
                            {tab}
                        </button>
                    ))}
                </div>

                <div className="p-10">
                    {activeTab === 'overview' && (
                        <div className="space-y-10 animate-fade-in">
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                                {[
                                    { label: 'Materials Read', val: student.stats.materialsViewed, icon: '📚' },
                                    { label: 'Labs Done', val: student.stats.assignmentsCompleted, icon: '✍️' },
                                    { label: 'Forum Posts', val: student.stats.discussionPosts, icon: '💬' },
                                    { label: 'Last Active', val: 'Today', icon: '🕒' },
                                ].map((s, i) => (
                                    <div key={i} className="p-6 bg-white border border-zinc-100 rounded-[2rem] shadow-sm flex flex-col items-center text-center">
                                        <div className="text-2xl mb-2">{s.icon}</div>
                                        <div className="text-2xl font-black text-zinc-900">{s.val}</div>
                                        <div className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mt-1">{s.label}</div>
                                    </div>
                                ))}
                            </div>
                            <div className="bg-[#18181B] p-10 rounded-[3rem] text-white flex flex-col md:flex-row items-center gap-10">
                                <div className="w-32 h-32 relative shrink-0">
                                    <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                                        <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
                                        <circle cx="50" cy="50" r="40" fill="none" stroke="#8B5CF6" strokeWidth="12" strokeDasharray="251.2" strokeDashoffset={251.2 * (1 - student.stats.completionPercent / 100)} strokeLinecap="round" className="transition-all duration-1000" />
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center font-black text-2xl tracking-tighter">{student.stats.completionPercent}%</div>
                                </div>
                                <div>
                                    <h4 className="text-xl font-bold mb-2">Completion Mastered</h4>
                                    <p className="text-zinc-400 text-sm font-medium leading-relaxed">This student has interacted with over {student.stats.completionPercent}% of the available instructional materials. They are currently in the top decile of the class.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'activity' && (
                        <div className="space-y-8 animate-fade-in">
                            {loadingActivities ? (
                                <div className="flex flex-col items-center justify-center py-20 space-y-4">
                                    <div className="w-10 h-10 border-4 border-zinc-200 border-t-purple-500 rounded-full animate-spin"></div>
                                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Retrieving Telemetry...</p>
                                </div>
                            ) : activities.length > 0 ? (
                                activities.map((item, i) => (
                                    <div key={i} className="flex space-x-6 relative">
                                        {i < activities.length - 1 && <div className="absolute left-[23px] top-10 w-0.5 h-full bg-zinc-100"></div>}
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl z-10 shrink-0 ${
                                            item.type === 'read' ? 'bg-blue-50 text-blue-500' :
                                            item.type === 'lab' ? 'bg-green-50 text-green-500' :
                                            item.type === 'post' ? 'bg-purple-50 text-purple-500' :
                                            'bg-zinc-50 text-zinc-500'
                                        }`}>
                                            {item.type === 'read' ? '📚' : item.type === 'lab' ? '✍️' : item.type === 'post' ? '💬' : '⚙️'}
                                        </div>
                                        <div className="flex-1 pb-8">
                                            <div className="flex justify-between items-start mb-1">
                                                <h5 className="font-bold text-zinc-900 text-sm capitalize">{item.text.toLowerCase()}</h5>
                                                <span className="text-[10px] font-bold text-zinc-400">{item.date}</span>
                                            </div>
                                            <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Platform Interaction</div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-20">
                                    <div className="text-4xl mb-4 opacity-20">📡</div>
                                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">No recent activity detected</p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'assignments' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in">
                            {[
                                { name: 'Lab 01: Intro to Big Data', score: '95/100', status: 'graded', color: 'bg-green-100 text-green-600' },
                                { name: 'Discussion: Data Ethics', score: '10/10', status: 'graded', color: 'bg-green-100 text-green-600' },
                                { name: 'Lab 02: MapReduce Concepts', score: '-', status: 'pending', color: 'bg-yellow-100 text-yellow-600' },
                                { name: 'Midterm Research Paper', score: '-', status: 'not started', color: 'bg-zinc-100 text-zinc-400' },
                            ].map((a, i) => (
                                <div key={i} className="p-6 bg-white border border-zinc-100 rounded-[2rem] shadow-sm flex items-center justify-between group hover:border-zinc-900 transition-colors">
                                    <div>
                                        <div className="text-xs font-black text-zinc-900 mb-1">{a.name}</div>
                                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${a.color}`}>{a.status}</span>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm font-black text-zinc-900">{a.score}</div>
                                        <button className="text-[9px] font-black uppercase text-zinc-400 hover:text-zinc-900">View →</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
        <style>{`
          @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
          .animate-fade-in { animation: fade-in 0.3s ease-out; }
        `}</style>
    </div>
  );
};

export default StudentProfileModal;
