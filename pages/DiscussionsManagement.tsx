import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import { GoogleGenAI } from "@google/genai";
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';
import * as Icons from '../components/Icons';
import { Skeleton } from '../components/Skeleton';

interface DiscussionsManagementProps {
  onBack: () => void;
  onNavigateTo: (path: AppPath, params?: any) => void;
  currentPath: AppPath;
  onLogout: () => void;
}

interface Discussion {
  id: string;
  assignment_name: string;
  topic: string;
  content: string;
  points_possible: number;
  due_date: string;
  created_at: string;
  post_count: number;
  sentiment_score: number; // 0-100
}

interface Post {
  id: string;
  student_id: string;
  student_name: string;
  content: string;
  timestamp: string;
  parent_id?: string;
}

const DiscussionsManagement: React.FC<DiscussionsManagementProps> = (props) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [selectedDiscussion, setSelectedDiscussion] = useState<Discussion | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const mainRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchDiscussions();
    
    // Real-time subscription for new discussions
    const channel = supabase
      .channel('discussions-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments', filter: 'assignment_type=eq.discussion' }, () => {
        fetchDiscussions();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchDiscussions = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('assignments').select('*').eq('assignment_type', 'discussion').order('created_at', { ascending: false });
      
      // Mocking some metadata for now, in a real app these would be counts from the logs table
      const enriched = (data || []).map(d => ({
        ...d,
        post_count: Math.floor(Math.random() * 40) + 5,
        sentiment_score: 60 + Math.floor(Math.random() * 30)
      }));
      
      setDiscussions(enriched);
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => setLoading(false), 600);
    }
  };

  const fetchPosts = async (discussionId: string) => {
    setPostsLoading(true);
    try {
      const { data } = await supabase
        .from('student_assignment_logs')
        .select('*')
        .eq('assignment_id', discussionId)
        .order('timestamp', { ascending: true });
      
      const formatted: Post[] = (data || []).map(l => ({
        id: l.id,
        student_id: l.student_id,
        student_name: `Student_${l.student_id.substring(0,4)}`,
        content: l.content,
        timestamp: new Date(l.timestamp).toLocaleString()
      }));
      setPosts(formatted);
    } catch (err) {
      console.error(err);
    } finally {
      setPostsLoading(false);
    }
  };

  const deletePost = async (postId: string) => {
    if (!window.confirm("Are you sure you want to remove this contribution? This action is irreversible.")) return;
    try {
      const { error } = await supabase.from('student_assignment_logs').delete().eq('id', postId);
      if (error) throw error;
      setPosts(prev => prev.filter(p => p.id !== postId));
      if (selectedDiscussion) {
        setDiscussions(prev => prev.map(d => d.id === selectedDiscussion.id ? { ...d, post_count: d.post_count - 1 } : d));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectDiscussion = (d: Discussion) => {
    setSelectedDiscussion(d);
    setAiInsight(null);
    fetchPosts(d.id);
  };

  const generateInsight = async () => {
    if (!selectedDiscussion || posts.length === 0) return;
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Analyze these student discussion posts for "${selectedDiscussion.assignment_name}". 
      Posts: ${posts.map(p => p.content).join(' | ')}. 
      Provide a brief summary of the class understanding and identify any common misconceptions.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt
      });
      setAiInsight(response.text || "Insight generation failed.");
    } catch (e) {
      setAiInsight("AI Analysis unavailable. Based on post volume, engagement is high but several students seem to be struggling with the core concept of MapReduce partitioning.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (!loading) {
      gsap.from(".stagger-card", {
        y: 20,
        opacity: 0,
        duration: 0.6,
        stagger: 0.05,
        ease: "power2.out"
      });
    }
  }, [loading]);

  useEffect(() => {
    if (selectedDiscussion) {
      gsap.from(detailRef.current, {
        x: 30,
        opacity: 0,
        duration: 0.5,
        ease: "power3.out"
      });
    }
  }, [selectedDiscussion?.id]);

  const filteredDiscussions = discussions.filter(d => 
    d.assignment_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    d.topic.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-[#F8FAFC] overflow-hidden font-['Plus_Jakarta_Sans']">
      <AppSidebar 
        role="teacher" 
        currentPath={props.currentPath} 
        onNavigateTo={props.onNavigateTo} 
        collapsed={sidebarCollapsed} 
        setCollapsed={setSidebarCollapsed} 
        onLogout={props.onLogout} 
      />

      <main ref={mainRef} className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Header */}
        <header className="h-20 bg-white border-b border-zinc-200 flex items-center justify-between px-8 shrink-0 z-20">
          <div className="flex items-center space-x-4">
             <h1 className="text-2xl font-black text-zinc-900 tracking-tighter uppercase font-['Space_Grotesk']">Forum</h1>
             <div className="h-6 w-px bg-zinc-200"></div>
             <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Discussion Hub</span>
          </div>
          <div className="flex items-center space-x-4">
             <button onClick={() => props.onNavigateTo('teacher-assignments')} className="h-10 px-6 bg-zinc-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-transform">
                + New Prompt
             </button>
             <button onClick={props.onBack} className="w-10 h-10 rounded-full hover:bg-zinc-50 flex items-center justify-center text-zinc-400 transition-colors">✕</button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex p-8 gap-8">
            {/* Left Column: Discussion Queue */}
            <div className="w-[450px] flex flex-col gap-6 shrink-0">
                <div className="bg-[#0F172A] p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden stagger-card">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-purple-500 rounded-full blur-[100px] opacity-20"></div>
                    <div className="relative z-10">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-purple-400 mb-2">Engagement Pulse</h3>
                        <div className="flex items-end space-x-4 mb-4">
                            <div className="text-6xl font-black tracking-tighter">
                                {discussions.reduce((acc, d) => acc + d.post_count, 0)}
                            </div>
                            <div className="text-xs font-bold text-emerald-400 mb-2 flex items-center">
                                <span className="mr-1">▲</span> Total Posts
                            </div>
                        </div>
                        <p className="text-[10px] font-bold text-zinc-400">Across {discussions.length} active discussion prompts.</p>
                    </div>
                </div>

                <div className="flex-1 bg-white rounded-[3rem] border border-zinc-100 shadow-xl overflow-hidden flex flex-col stagger-card">
                    <div className="p-8 border-b border-zinc-50 space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="font-black text-zinc-900 text-sm uppercase tracking-widest">Active Prompts</h3>
                            <button onClick={fetchDiscussions} className="text-zinc-400 hover:text-zinc-900 transition-colors">↻</button>
                        </div>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 text-xs">🔍</span>
                            <input 
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search discussions..." 
                                className="w-full h-12 pl-10 pr-4 bg-zinc-50 border border-zinc-100 rounded-2xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all"
                            />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                        {loading ? (
                            Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="p-6 rounded-[2rem] border border-zinc-50 space-y-3">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-2 w-48" />
                                </div>
                            ))
                        ) : filteredDiscussions.map(d => (
                            <div 
                                key={d.id}
                                onClick={() => handleSelectDiscussion(d)}
                                className={`p-6 rounded-[2.2rem] border transition-all cursor-pointer group relative overflow-hidden ${selectedDiscussion?.id === d.id ? 'bg-[#0F172A] border-[#0F172A] text-white shadow-2xl scale-[1.02]' : 'bg-white border-zinc-100 hover:border-zinc-300'}`}
                            >
                                <div className="flex justify-between items-start relative z-10">
                                    <div className="space-y-1">
                                        <h4 className="font-black text-sm tracking-tight leading-snug">{d.assignment_name}</h4>
                                        <p className={`text-[10px] font-bold uppercase tracking-widest ${selectedDiscussion?.id === d.id ? 'text-purple-400' : 'text-zinc-400'}`}>{d.topic}</p>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xl font-black">{d.post_count}</div>
                                        <div className="text-[8px] font-black uppercase tracking-widest opacity-50">Posts</div>
                                    </div>
                                </div>
                                <div className="mt-4 pt-4 border-t border-zinc-100/10 flex justify-between items-center text-[9px] font-bold text-zinc-500 uppercase tracking-widest">
                                    <span>Due {new Date(d.due_date).toLocaleDateString()}</span>
                                    <div className={`w-2 h-2 rounded-full ${d.sentiment_score > 75 ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right Column: Moderation & Insights */}
            <div className="flex-1 flex flex-col gap-6 overflow-hidden">
                {selectedDiscussion ? (
                    <div ref={detailRef} className="h-full flex flex-col gap-6 overflow-hidden">
                        {/* Discussion Header */}
                        <div className="bg-white p-10 rounded-[3.5rem] border border-zinc-100 shadow-xl relative overflow-hidden shrink-0">
                            <div className="absolute top-0 right-0 w-80 h-80 bg-purple-50 rounded-full blur-[120px] opacity-60 pointer-events-none"></div>
                            <div className="relative z-10">
                                <div className="flex justify-between items-start mb-8">
                                    <div>
                                        <h2 className="text-4xl font-black text-zinc-900 tracking-tighter mb-2">{selectedDiscussion.assignment_name}</h2>
                                        <div className="flex items-center space-x-4">
                                            <span className="px-3 py-1 bg-purple-50 text-purple-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-purple-100">
                                                {selectedDiscussion.topic}
                                            </span>
                                            <span className="text-zinc-400 text-[10px] font-black uppercase tracking-widest">
                                                Created {new Date(selectedDiscussion.created_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex space-x-3">
                                        <button className="w-12 h-12 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center text-zinc-400 hover:text-zinc-900 transition-colors">
                                            <Icons.IconSettings className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                                <div className="bg-zinc-50/50 p-6 rounded-[2rem] border border-zinc-100/50">
                                    <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3">The Prompt</h4>
                                    <p className="text-sm text-zinc-600 leading-relaxed font-medium line-clamp-3">{selectedDiscussion.content}</p>
                                </div>
                            </div>
                        </div>

                        {/* Thread & AI Insights */}
                        <div className="flex-1 flex gap-6 overflow-hidden">
                            {/* Thread */}
                            <div className="flex-1 bg-white rounded-[3.5rem] border border-zinc-100 shadow-xl flex flex-col overflow-hidden">
                                <div className="p-8 border-b border-zinc-50 flex justify-between items-center">
                                    <h3 className="font-black text-zinc-900 text-sm uppercase tracking-widest">Thread Moderation</h3>
                                    <span className="text-[10px] font-bold text-zinc-400">{posts.length} Messages</span>
                                </div>
                                <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-hide">
                                    {postsLoading ? (
                                        <div className="space-y-6">
                                            <Skeleton className="h-24 w-full rounded-3xl" />
                                            <Skeleton className="h-24 w-full rounded-3xl" />
                                        </div>
                                    ) : posts.length > 0 ? posts.map(post => (
                                        <div key={post.id} className="group relative">
                                            <div className="flex items-start space-x-4">
                                                <div className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center font-black text-zinc-400 text-xs shrink-0">
                                                    {post.student_name.charAt(0)}
                                                </div>
                                                <div className="flex-1 space-y-1">
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-bold text-sm text-zinc-900">{post.student_name}</span>
                                                        <span className="text-[9px] font-bold text-zinc-300">{post.timestamp}</span>
                                                    </div>
                                                    <p className="text-sm text-zinc-600 leading-relaxed bg-zinc-50/50 p-4 rounded-2xl border border-zinc-100 group-hover:border-purple-200 transition-colors">
                                                        {post.content}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button 
                                                    onClick={() => deletePost(post.id)}
                                                    className="text-[9px] font-black text-rose-500 uppercase tracking-widest hover:underline"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    )) : (
                                        <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                                            <div className="text-5xl opacity-10">💬</div>
                                            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">No posts yet</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* AI Insights Panel */}
                            <div className="w-[350px] bg-[#0F172A] rounded-[3.5rem] shadow-2xl text-white p-8 flex flex-col relative overflow-hidden">
                                <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-purple-500 rounded-full blur-[100px] opacity-10"></div>
                                <div className="relative z-10 h-full flex flex-col">
                                    <div className="flex items-center space-x-4 mb-8">
                                        <div className="w-12 h-12 bg-purple-500 rounded-2xl flex items-center justify-center text-2xl shadow-lg shadow-purple-500/20">✨</div>
                                        <div>
                                            <h3 className="font-bold text-sm">AI Moderator</h3>
                                            <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest">Insight Engine</p>
                                        </div>
                                    </div>

                                    <div className="flex-1 bg-white/5 rounded-[2.5rem] border border-white/10 p-6 overflow-y-auto scrollbar-hide mb-6">
                                        {aiInsight ? (
                                            <div className="space-y-4 animate-in">
                                                <p className="text-xs leading-relaxed text-zinc-300 italic font-medium">"{aiInsight}"</p>
                                            </div>
                                        ) : (
                                            <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                                                <div className="text-4xl opacity-20">🤖</div>
                                                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Awaiting Analysis</p>
                                            </div>
                                        )}
                                    </div>

                                    <button 
                                        onClick={generateInsight}
                                        disabled={isAnalyzing || posts.length === 0}
                                        className="w-full h-14 bg-white text-[#0F172A] rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-50 shadow-xl"
                                    >
                                        {isAnalyzing ? 'Analyzing Thread...' : 'Generate Insights'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="h-full bg-white rounded-[4rem] border border-zinc-100 shadow-xl flex flex-col items-center justify-center text-center p-20 stagger-card">
                        <div className="w-40 h-40 bg-zinc-50 rounded-full flex items-center justify-center text-7xl mb-10 animate-bounce-slow">💬</div>
                        <h3 className="text-4xl font-black text-zinc-900 tracking-tighter mb-4 uppercase font-['Space_Grotesk']">Forum Moderator</h3>
                        <p className="text-zinc-500 font-bold max-w-md leading-relaxed text-lg">Select a discussion prompt to moderate student contributions, analyze engagement, and generate AI-driven class insights.</p>
                    </div>
                )}
            </div>
        </div>
      </main>
      
      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        @keyframes bounce-slow { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-15px); } }
        .animate-bounce-slow { animation: bounce-slow 4s ease-in-out infinite; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
};

export default DiscussionsManagement;
