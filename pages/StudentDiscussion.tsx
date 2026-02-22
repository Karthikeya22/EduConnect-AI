import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import { GoogleGenAI } from "@google/genai";
import { DiscussionSkeleton } from '../components/Skeleton';
import * as Icons from '../components/Icons';

interface StudentDiscussionProps {
  assignmentId: string;
  onBack: () => void;
  onNavigateDashboard: () => void;
  onNavigateMaterials: () => void;
  onNavigateProgress: () => void;
}

interface Discussion {
  id: string;
  assignment_name: string;
  topic: string;
  content: string;
  due_date: string;
  points_possible: number;
  grading_criteria: string;
}

interface Post {
  id: string;
  student_id: string;
  student_name: string;
  content: string;
  timestamp: string;
  parent_id?: string;
}

const StudentDiscussion: React.FC<StudentDiscussionProps> = ({ assignmentId, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [discussion, setDiscussion] = useState<Discussion | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [userPost, setUserPost] = useState<string>('');
  const [isPosting, setIsPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<Post | null>(null);
  const [replyText, setReplyText] = useState('');
  
  // AI State
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiMessages, setAiMessages] = useState<{role: 'user' | 'ai', text: string}[]>([]);

  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
    
    // Real-time subscription for new posts
    const channel = supabase
      .channel(`discussion-${assignmentId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'student_assignment_logs', filter: `assignment_id=eq.${assignmentId}` }, () => {
        fetchData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [assignmentId]);

  const fetchData = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return;
      const session = sessionData.session;

      const { data: disc } = await supabase.from('assignments').select('*').eq('id', assignmentId).single();
      if (disc) setDiscussion(disc);

      const { data: logs } = await supabase.from('student_assignment_logs').select('*').eq('assignment_id', assignmentId).order('timestamp', { ascending: true });
      
      const formattedPosts: Post[] = (logs || []).map(l => ({
        id: l.id,
        student_id: l.student_id,
        student_name: l.student_id === session.user.id ? 'You' : `Student_${l.student_id.substring(0,4)}`,
        content: l.content,
        timestamp: new Date(l.timestamp).toLocaleString(),
        parent_id: l.metadata?.parent_id
      }));
      setPosts(formattedPosts);
      
      if (aiMessages.length === 0 && disc) {
        setAiMessages([{ role: 'ai', text: `Hi! I'm your Discussion Assistant. I've analyzed "${disc.assignment_name}". How can I help you formulate your response?` }]);
      }
    } catch (err) {
      console.error("Discussion Data Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePost = async () => {
    if (!userPost.trim() || isPosting) return;
    setIsPosting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await supabase.from('student_assignment_logs').insert({
        student_id: session.user.id,
        assignment_id: assignmentId,
        course_id: 'BIG_DATA_2026',
        interaction_type: 'discussion_post',
        content: userPost,
        timestamp: new Date().toISOString()
      });
      setUserPost('');
    } catch (err) {
      console.error("Post Submission Error:", err);
    } finally {
      setIsPosting(false);
    }
  };

  const handleReply = async () => {
    if (!replyText.trim() || !replyTo || isPosting) return;
    setIsPosting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await supabase.from('student_assignment_logs').insert({
        student_id: session.user.id,
        assignment_id: assignmentId,
        course_id: 'BIG_DATA_2026',
        interaction_type: 'discussion_post',
        content: replyText,
        timestamp: new Date().toISOString(),
        metadata: { parent_id: replyTo.id }
      });
      setReplyText('');
      setReplyTo(null);
    } catch (err) {
      console.error("Reply Submission Error:", err);
    } finally {
      setIsPosting(false);
    }
  };

  const askAi = async (q: string) => {
    if (aiThinking || !q.trim()) return;
    setAiMessages(prev => [...prev, {role: 'user', text: q}]);
    setAiThinking(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [{ role: 'user', parts: [{ text: `You are an AI teaching assistant. Student question for discussion "${discussion?.assignment_name}": ${q}` }] }]
      });
      setAiMessages(prev => [...prev, {role: 'ai', text: response.text || "I'm sorry, I'm unable to process that query right now."}]);
    } catch (err) {
      console.error("AI TA Inquiry Error:", err);
      setAiMessages(prev => [...prev, {role: 'ai', text: "Pedagogical node connection failed. Please retry."}]);
    } finally {
      setAiThinking(false);
    }
  };

  useEffect(() => {
    if (!loading) {
      gsap.from(".animate-in", {
        y: 20,
        opacity: 0,
        duration: 0.6,
        stagger: 0.1,
        ease: "power2.out"
      });
    }
  }, [loading]);

  const mainPosts = posts.filter(p => !p.parent_id);
  const replies = posts.filter(p => p.parent_id);
  const hasPosted = posts.some(p => p.student_name === 'You');

  return (
    <div className="flex h-screen bg-[#F8FAFC] overflow-hidden relative font-['Plus_Jakarta_Sans']">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Header */}
        <header className="h-20 bg-white border-b border-zinc-200 flex items-center justify-between px-8 shrink-0 z-20">
          <div className="flex items-center space-x-4">
             <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-zinc-50 flex items-center justify-center text-zinc-400 transition-colors">←</button>
             <h1 className="text-xl font-black text-zinc-900 tracking-tighter uppercase font-['Space_Grotesk']">Discussion Hub</h1>
          </div>
          <div className="flex items-center space-x-4">
             <div className="hidden md:flex items-center space-x-2 px-3 py-1.5 bg-cyan-50 text-cyan-600 rounded-full border border-cyan-100">
                <span className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse"></span>
                <span className="text-[10px] font-black uppercase tracking-widest">Live Sync Active</span>
             </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 md:p-12 scroll-smooth bg-[#F8FAFC]">
          <div className="max-w-5xl mx-auto space-y-12 pb-20">
             {loading ? (
               <DiscussionSkeleton />
             ) : (
               <>
                {/* Prompt Card */}
                <div className="bg-white p-10 rounded-[3rem] border border-zinc-100 shadow-xl animate-in relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-50 rounded-full blur-[100px] opacity-50 pointer-events-none"></div>
                    <div className="relative z-10">
                        <div className="flex items-center space-x-3 mb-6">
                            <span className="px-3 py-1 bg-cyan-50 text-cyan-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-cyan-100">{discussion?.topic}</span>
                            <span className="text-zinc-400 text-[10px] font-black uppercase tracking-widest">Due {discussion?.due_date ? new Date(discussion.due_date).toLocaleDateString() : 'N/A'}</span>
                        </div>
                        <h2 className="text-4xl font-black text-zinc-900 tracking-tighter mb-6">{discussion?.assignment_name}</h2>
                        <div className="text-lg text-zinc-600 whitespace-pre-wrap font-medium leading-relaxed">{discussion?.content}</div>
                    </div>
                </div>

                {/* Contribution Area */}
                {!hasPosted && (
                  <div className="bg-[#0F172A] p-10 rounded-[3.5rem] shadow-2xl text-white relative overflow-hidden animate-in">
                      <div className="absolute -left-20 -bottom-20 w-96 h-96 bg-cyan-500 rounded-full blur-[120px] opacity-10"></div>
                      <div className="relative z-10">
                        <div className="flex items-center space-x-4 mb-8">
                            <div className="w-12 h-12 bg-cyan-500 rounded-2xl flex items-center justify-center text-2xl shadow-lg shadow-cyan-500/20">✍️</div>
                            <div>
                                <h3 className="text-2xl font-black tracking-tight">Your Contribution</h3>
                                <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Share your insights with the class</p>
                            </div>
                        </div>
                        <textarea 
                            value={userPost} 
                            onChange={(e) => setUserPost(e.target.value)} 
                            placeholder="Type your response here..." 
                            className="w-full h-48 px-8 py-8 bg-white/5 border border-white/10 rounded-[2.5rem] focus:border-cyan-500 focus:outline-none transition-all font-medium text-lg leading-relaxed resize-none mb-8 text-white placeholder-zinc-600" 
                        />
                        <div className="flex justify-end">
                            <button 
                                onClick={handlePost} 
                                disabled={!userPost.trim() || isPosting} 
                                className="h-16 px-12 bg-cyan-500 text-[#0F172A] rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
                            >
                                {isPosting ? 'Posting...' : 'Submit Post'}
                            </button>
                        </div>
                      </div>
                  </div>
                )}

                {/* Discussion Thread */}
                <div className="space-y-10 animate-in">
                    <div className="flex items-center justify-between">
                        <h3 className="text-3xl font-black text-zinc-900 tracking-tighter">Class Discussion</h3>
                        <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{mainPosts.length} Contributions</div>
                    </div>
                    
                    <div className="space-y-8">
                      {mainPosts.length > 0 ? mainPosts.map((post) => (
                        <div key={post.id} className="animate-in">
                            <div className={`p-10 rounded-[3.5rem] border shadow-xl relative overflow-hidden ${post.student_name === 'You' ? 'bg-cyan-50/30 border-cyan-200' : 'bg-white border-zinc-100'}`}>
                              <div className="flex justify-between items-start mb-8">
                                  <div className="flex items-center space-x-5">
                                      <div className="w-14 h-14 rounded-[1.5rem] flex items-center justify-center font-black text-white bg-[#0F172A] shadow-lg text-xl">
                                          {post.student_name.charAt(0)}
                                      </div>
                                      <div>
                                          <h4 className="text-lg font-black text-zinc-900">{post.student_name}</h4>
                                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{post.timestamp}</p>
                                      </div>
                                  </div>
                                  <button onClick={() => setReplyTo(post)} className="px-6 py-2 bg-zinc-50 border border-zinc-100 rounded-xl text-[10px] font-black text-zinc-500 uppercase tracking-widest hover:bg-zinc-100 transition-colors">Reply</button>
                              </div>
                              <div className="text-lg text-zinc-600 whitespace-pre-wrap font-medium leading-relaxed pl-2 border-l-4 border-zinc-100">{post.content}</div>
                            </div>

                            {/* Replies */}
                            <div className="ml-16 md:ml-24 mt-6 space-y-6">
                              {replies.filter(r => r.parent_id === post.id).map(reply => (
                                <div key={reply.id} className="p-8 rounded-[2.5rem] border bg-zinc-50 border-zinc-100 shadow-sm animate-in">
                                    <div className="flex items-center space-x-4 mb-4">
                                        <div className="w-10 h-10 rounded-xl bg-zinc-200 flex items-center justify-center text-xs font-black text-zinc-500">
                                            {reply.student_name.charAt(0)}
                                        </div>
                                        <div>
                                            <span className="font-black text-sm text-zinc-900">{reply.student_name}</span>
                                            <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">{reply.timestamp}</p>
                                        </div>
                                    </div>
                                    <p className="text-sm text-zinc-600 leading-relaxed font-medium">{reply.content}</p>
                                </div>
                              ))}
                              
                              {replyTo?.id === post.id && (
                                <div className="bg-white p-8 rounded-[2.5rem] border-2 border-cyan-400 shadow-2xl animate-in">
                                    <h4 className="text-[10px] font-black text-cyan-600 uppercase tracking-widest mb-4">Replying to {post.student_name}</h4>
                                    <textarea 
                                        value={replyText} 
                                        onChange={(e) => setReplyText(e.target.value)} 
                                        placeholder="Add to the conversation..." 
                                        className="w-full h-32 px-6 py-6 bg-zinc-50 border border-zinc-100 rounded-2xl focus:outline-none focus:border-cyan-500 text-sm font-medium resize-none mb-6" 
                                    />
                                    <div className="flex justify-end space-x-4">
                                        <button onClick={() => setReplyTo(null)} className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Cancel</button>
                                        <button onClick={handleReply} className="px-8 h-12 bg-cyan-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg">Post Reply</button>
                                    </div>
                                </div>
                              )}
                            </div>
                        </div>
                      )) : (
                        <div className="py-32 text-center bg-white rounded-[4rem] border border-dashed border-zinc-200">
                          <div className="text-6xl mb-6 opacity-20">💬</div>
                          <p className="text-xs font-black text-zinc-400 uppercase tracking-[0.3em]">No contributions yet. Start the conversation!</p>
                        </div>
                      )}
                    </div>
                </div>
               </>
             )}
          </div>
        </div>
      </div>

      {/* AI Sidebar */}
      <aside className={`${aiPanelOpen ? 'w-full md:w-[450px]' : 'w-0'} bg-white border-l border-zinc-100 transition-all duration-500 flex flex-col relative z-30`}>
          <button 
            onClick={() => setAiPanelOpen(!aiPanelOpen)} 
            className="absolute left-[-40px] top-1/2 -translate-y-1/2 w-10 h-24 bg-white border border-r-0 border-zinc-100 rounded-l-3xl shadow-xl flex items-center justify-center text-zinc-400 hover:text-cyan-500 transition-colors"
          >
            {aiPanelOpen ? '→' : '🤖'}
          </button>
          
          <header className="h-20 border-b flex items-center px-10 shrink-0 bg-white">
            <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-[#0F172A] rounded-2xl flex items-center justify-center text-2xl shadow-lg">🤖</div>
                <div>
                    <h3 className="font-black text-sm text-zinc-900">Discussion Tutor</h3>
                    <p className="text-[9px] font-black text-cyan-500 uppercase tracking-widest">AI Pedagogical Node</p>
                </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-10 space-y-8 bg-zinc-50/30 scrollbar-hide">
             {aiMessages.map((msg, i) => (
               <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in`}>
                 <div className={`max-w-[90%] p-6 rounded-[2rem] text-[13px] font-medium leading-relaxed ${msg.role === 'user' ? 'bg-cyan-600 text-white shadow-xl rounded-tr-none' : 'bg-white border border-zinc-100 text-zinc-800 shadow-sm rounded-tl-none'}`}>
                    {msg.text}
                 </div>
               </div>
             ))}
             {aiThinking && (
                <div className="flex justify-start animate-in">
                    <div className="p-6 bg-white border border-zinc-100 rounded-[2rem] rounded-tl-none shadow-sm flex items-center space-x-3">
                        <div className="flex space-x-1">
                            <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce"></div>
                            <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                            <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                        </div>
                        <span className="text-[11px] font-black text-zinc-400 uppercase tracking-widest">Analyzing Prompt...</span>
                    </div>
                </div>
             )}
          </div>

          <div className="p-10 border-t bg-white shrink-0">
            <div className="relative">
                <input 
                    onKeyPress={(e) => e.key === 'Enter' && askAi((e.target as HTMLInputElement).value)} 
                    placeholder="Ask for clarification or insights..." 
                    className="w-full h-16 pl-6 pr-16 bg-zinc-50 border border-zinc-200 rounded-2xl text-[12px] font-bold focus:border-cyan-500 focus:outline-none transition-all shadow-inner" 
                />
                <button className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-[#0F172A] text-white rounded-xl flex items-center justify-center">
                    <Icons.IconTrending className="w-4 h-4 rotate-90" />
                </button>
            </div>
          </div>
      </aside>

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
};

export default StudentDiscussion;
