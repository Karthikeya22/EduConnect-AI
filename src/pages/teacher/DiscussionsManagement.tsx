import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '@/src/lib/supabase';
import { GoogleGenAI } from "@google/genai";
import AppSidebar from '@/src/components/layout/AppSidebar';
import { AppPath } from '@/src/App';
import * as Icons from '@/src/components/ui/Icons';
import { Skeleton } from '@/src/components/ui/Skeleton';
import ThemeToggle from '@/src/components/ui/ThemeToggle';
import { canvasAPI } from '@/src/services/canvasAPI';

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
  isRead: boolean;
  metadata?: any;
}

const DiscussionsManagement: React.FC<DiscussionsManagementProps> = (props) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  // Global active course handling
  const [activeCourse, setActiveCourse] = useState<{id: number, name: string, course_code: string} | null>(null);

  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [selectedDiscussion, setSelectedDiscussion] = useState<Discussion | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unread'>('all');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isPostingReply, setIsPostingReply] = useState(false);
  const [showFullPrompt, setShowFullPrompt] = useState(false);

  const mainRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const rawCourse = localStorage.getItem('active_canvas_course');
    if (!rawCourse) {
      props.onNavigateTo('teacher-select-course');
    } else {
      const parsed = JSON.parse(rawCourse);
      setActiveCourse(parsed);
      fetchDiscussions(parsed.id.toString());
    }
  }, []);

  const fetchDiscussions = async (courseId: string) => {
    setLoading(true);
    try {
      // Fetch Discussion Topics from Canvas
      const topics = await canvasAPI.getDiscussionTopics(courseId);

      if (topics && topics.length > 0) {
        const enriched = topics.map((t: any) => ({
          ...t,
          assignment_name: t.title,
          topic: t.discussion_type || 'General',
          content: t.message,
          points_possible: t.assignment?.points_possible || 0,
          due_date: t.assignment?.due_at || new Date().toISOString(),
          created_at: t.created_at,
          post_count: t.discussion_subentry_count || 0,
          sentiment_score: 100, // Placeholder
          canvasCourseId: courseId // Store for sub-fetches
        }));

        setDiscussions(enriched);
      } else {
        setDiscussions([]);
      }
    } catch (err) {
      console.error("Discussion topics sync failure:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPosts = async (discussionId: string) => {
    setPostsLoading(true);
    try {
      const currentDisc = discussions.find(d => d.id === discussionId);
      const courseId = (currentDisc as any)?.canvasCourseId || activeCourse?.id?.toString();

      const entries = await canvasAPI.getDiscussionEntries(courseId, discussionId);

      const stripHtml = (html: string) => {
        if (!html) return '';
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
      };

      let allEntries: any[] = [];
      (entries || []).forEach((e: any) => {
          allEntries.push(e);
          if (e.replies && Array.isArray(e.replies)) {
              allEntries = [...allEntries, ...e.replies];
          }
      });

      const formatted: Post[] = allEntries.map((e: any) => ({
        id: e.id.toString(),
        student_id: e.user_id?.toString() || 'unknown',
        student_name: e.user?.short_name || e.user?.display_name || 'Student',
        content: stripHtml(e.message || ''),
        timestamp: new Date(e.created_at).toLocaleString(),
        isRead: false,
        metadata: {}
      }));
      formatted.sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()); // Newest first
      setPosts(formatted);
    } catch (err) {
      console.error("Forum Post Retrieval Failure:", err);
    } finally {
      setPostsLoading(false);
    }
  };

  const toggleReadStatus = async (postId: string, currentStatus: boolean, metadata: any) => {
    try {
      const newMetadata = { ...(metadata || {}), read_by_faculty: !currentStatus };
      const { error } = await supabase
        .from('student_assignment_logs')
        .update({ metadata: newMetadata })
        .eq('id', postId);

      if (error) throw error;
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, isRead: !currentStatus, metadata: newMetadata } : p));
    } catch (err) {
      console.error("Read Status Toggle Failure:", err);
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
    fetchPosts(d.id);
    setReplyingTo(null);
    setReplyText('');
    setShowFullPrompt(false);
  };

  const handleReplyClick = (postId: string) => {
    if (replyingTo === postId) {
      setReplyingTo(null);
      setReplyText('');
    } else {
      setReplyingTo(postId);
      setReplyText('');
      setTimeout(() => replyInputRef.current?.focus(), 100);
    }
  };

  const handlePostReply = async (postId: string) => {
    if (!replyText.trim() || !selectedDiscussion || !activeCourse) return;
    setIsPostingReply(true);
    try {
      const courseId = (selectedDiscussion as any).canvasCourseId || activeCourse.id.toString();
      await canvasAPI.postDiscussionReply(
        courseId,
        selectedDiscussion.id,
        replyText.trim(),
        postId
      );
      const newPost: Post = {
        id: 'reply-' + Date.now(),
        student_id: 'instructor',
        student_name: 'Instructor (You)',
        content: replyText.trim(),
        timestamp: new Date().toLocaleString(),
        parent_id: postId,
        isRead: true,
        metadata: { is_instructor_reply: true }
      };
      setPosts(prev => {
        const postIndex = prev.findIndex(p => p.id === postId);
        const updated = [...prev];
        updated.splice(postIndex + 1, 0, newPost);
        return updated;
      });
      setReplyingTo(null);
      setReplyText('');
    } catch (err: any) {
      console.error('Failed to post reply:', err);
      alert('Failed to post reply: ' + err.message);
    } finally {
      setIsPostingReply(false);
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
    <div className="flex h-screen bg-[var(--bg-main)] overflow-hidden font-['Plus_Jakarta_Sans'] transition-colors">
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
        <header className="h-20 bg-[var(--bg-card)] border-b-2 border-[var(--border-primary)] flex items-center justify-between px-8 shrink-0 z-20 transition-colors">
          <div className="flex items-center space-x-4">
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter uppercase font-['Space_Grotesk']">Forum</h1>
            <div className="h-6 w-px bg-zinc-200 dark:bg-white/10"></div>
            <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Discussion Hub</span>
          </div>
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => props.onNavigateTo('teacher-select-course')}
              className="px-4 py-2 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl text-xs font-black uppercase tracking-widest transition-colors border border-indigo-200 dark:border-indigo-500/20 flex items-center gap-2"
            >
              <Icons.IconChart className="w-4 h-4" /> Switch Course
            </button>
            <ThemeToggle />
            <button onClick={() => props.onNavigateTo('teacher-assignments', { type: 'discussion' })} className="h-10 px-6 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-transform">
              + New Prompt
            </button>
            <button onClick={props.onBack} className="w-10 h-10 rounded-full hover:bg-zinc-50 dark:hover:bg-white/5 flex items-center justify-center text-zinc-400 dark:text-zinc-500 transition-colors">✕</button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex p-8 gap-6">
          {/* Left Column: Discussion Queue */}
          <div className="w-[380px] flex flex-col shrink-0 overflow-hidden h-full">
            <div className="flex-1 bg-white/80 dark:bg-black/40 backdrop-blur-xl rounded-3xl border border-zinc-200/50 dark:border-white/10 shadow-sm overflow-hidden flex flex-col stagger-card transition-colors">
              <div className="p-5 border-b border-zinc-200/50 dark:border-white/10 space-y-3 bg-zinc-50/50 dark:bg-white/5">
                <div className="flex justify-between items-center">
                  <h3 className="font-black text-zinc-900 dark:text-white text-xs uppercase tracking-widest flex items-center gap-1.5"><Icons.IconSparkles className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" /> Active Prompts</h3>
                  <button onClick={() => activeCourse && fetchDiscussions(activeCourse.id.toString())} className="w-8 h-8 rounded-full bg-zinc-200/50 dark:bg-white/5 flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-white/20 transition-colors"><Icons.IconRefresh className="w-4 h-4" /></button>
                </div>

                {/* Compact Overview Stats Grid */}
                <div className="grid grid-cols-2 gap-3 py-2 border-t border-b border-zinc-200/50 dark:border-white/10">
                  {loading ? (
                    <>
                      <Skeleton className="h-5 w-20 rounded" />
                      <Skeleton className="h-5 w-20 rounded" />
                    </>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-black text-zinc-900 dark:text-white">
                          {discussions.reduce((acc, d) => acc + d.post_count, 0)}
                        </span>
                        <span className="text-[8px] font-bold uppercase tracking-wider text-zinc-500">Posts</span>
                      </div>
                      <div className="flex items-baseline gap-1.5 border-l border-zinc-200/50 dark:border-white/10 pl-3">
                        <span className="text-sm font-black text-indigo-600 dark:text-indigo-400">
                          {discussions.length}
                        </span>
                        <span className="text-[8px] font-bold uppercase tracking-wider text-zinc-500">Prompts</span>
                      </div>
                    </>
                  )}
                </div>

                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs font-bold flex items-center">🔍</span>
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search discussions..."
                    className="w-full h-9 pl-9 pr-3 bg-white dark:bg-zinc-900/50 border border-zinc-200/50 dark:border-white/10 dark:text-white rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all placeholder:text-zinc-400 shadow-inner"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="p-5 rounded-2xl border border-zinc-100 dark:border-white/5 space-y-3">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-2 w-48" />
                    </div>
                  ))
                ) : filteredDiscussions.map(d => (
                  <div
                    key={d.id}
                    onClick={() => handleSelectDiscussion(d)}
                    className={`p-5 rounded-2xl border transition-all cursor-pointer group relative overflow-hidden ${selectedDiscussion?.id === d.id ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-transparent border-transparent hover:bg-zinc-100/50 dark:hover:bg-white/5 hover:border-zinc-200/50 dark:hover:border-white/10'}`}
                  >
                    <div className="flex justify-between items-start relative z-10">
                      <div className="space-y-1 min-w-0 pr-3">
                        <h4 className={`font-bold text-sm tracking-tight leading-snug truncate ${selectedDiscussion?.id === d.id ? 'text-white' : 'text-zinc-900 dark:text-zinc-100'}`}>{d.assignment_name}</h4>
                        <p className={`text-[10px] font-bold uppercase tracking-widest truncate ${selectedDiscussion?.id === d.id ? 'text-indigo-200' : 'text-zinc-500 dark:text-zinc-400'}`}>{d.topic}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-lg font-black ${selectedDiscussion?.id === d.id ? 'text-white' : 'text-zinc-900 dark:text-zinc-100'}`}>{d.post_count}</div>
                        <div className={`text-[8px] font-black uppercase tracking-widest ${selectedDiscussion?.id === d.id ? 'text-indigo-200' : 'text-zinc-400'}`}>Posts</div>
                      </div>
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
                <div className="bg-white/80 dark:bg-black/40 backdrop-blur-xl p-5 rounded-3xl border border-zinc-200/50 dark:border-white/10 shadow-sm relative overflow-hidden shrink-0 transition-colors">
                  <div className="relative z-10 flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                      <div className="min-w-0 flex-1 pr-4">
                        <h2 className="text-base font-black text-zinc-900 dark:text-white tracking-tight leading-tight truncate mb-1">{selectedDiscussion.assignment_name}</h2>
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-md text-[8px] font-black uppercase tracking-widest border border-indigo-100 dark:border-indigo-500/20">
                            {selectedDiscussion.topic}
                          </span>
                          <span className="text-zinc-400 dark:text-zinc-500 text-[8px] font-bold uppercase tracking-widest">
                            Created {new Date(selectedDiscussion.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2 shrink-0">
                        <button
                          onClick={() => setShowFullPrompt(!showFullPrompt)}
                          className={`px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1 ${
                            showFullPrompt 
                              ? 'bg-zinc-100 dark:bg-white/10 text-zinc-800 dark:text-zinc-200 border-zinc-300 dark:border-white/20' 
                              : 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-150 dark:border-indigo-500/20 hover:bg-indigo-100 dark:hover:bg-indigo-500/20'
                          }`}
                        >
                          {showFullPrompt ? 'Hide Prompt' : 'View Prompt'}
                        </button>
                        <button
                          onClick={() => props.onNavigateTo('teacher-assignments')}
                          className="w-8 h-8 rounded-lg bg-zinc-100/50 dark:bg-white/5 border border-zinc-200/50 dark:border-white/10 flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/50 transition-colors"
                        >
                          <Icons.IconSettings className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {showFullPrompt && (
                      <div className="bg-zinc-50/50 dark:bg-white/5 p-4 rounded-xl border border-zinc-200/50 dark:border-white/5 animate-in">
                        <h4 className="text-[8px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1.5">Prompt Details</h4>
                        <div 
                          className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed font-medium prose dark:prose-invert max-w-none" 
                          dangerouslySetInnerHTML={{ __html: selectedDiscussion.content }} 
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Thread & AI Insights */}
                <div className="flex-1 bg-white/80 dark:bg-black/40 backdrop-blur-xl rounded-3xl border border-zinc-200/50 dark:border-white/10 shadow-sm flex flex-col overflow-hidden transition-colors">
                  <div className="p-6 border-b border-zinc-200/50 dark:border-white/10 flex justify-between items-center bg-zinc-50/50 dark:bg-white/5">
                    <div className="flex items-center space-x-6">
                      <h3 className="font-black text-zinc-900 dark:text-white text-sm uppercase tracking-widest flex items-center gap-2"><Icons.IconSparkles className="w-4 h-4 text-zinc-400 dark:text-zinc-500" /> Thread</h3>
                      <div className="flex bg-zinc-200/50 dark:bg-white/5 p-1 rounded-lg">
                        <button onClick={() => setFilterMode('all')} className={`px-4 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${filterMode === 'all' ? 'bg-white dark:bg-zinc-800 dark:text-white text-zinc-900 shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'}`}>All</button>
                        <button onClick={() => setFilterMode('unread')} className={`px-4 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${filterMode === 'unread' ? 'bg-white dark:bg-zinc-800 dark:text-white text-zinc-900 shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'}`}>Unread {posts.filter(p => !p.isRead).length > 0 && <span className="w-4 h-4 rounded-full bg-zinc-800 text-white flex items-center justify-center text-[8px]">{posts.filter(p => !p.isRead).length}</span>}</button>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">{posts.length} Posts</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-8 custom-scrollbar flex flex-col gap-6">
                    {postsLoading ? (
                      <div className="space-y-6">
                        <Skeleton className="h-20 w-full rounded-2xl" />
                        <Skeleton className="h-20 w-3/4 rounded-2xl" />
                      </div>
                    ) : posts.filter(p => filterMode === 'all' || !p.isRead).length > 0 ? posts.filter(p => filterMode === 'all' || !p.isRead).map(post => {
                      const isInstructor = (post as any).metadata?.is_instructor_reply;
                      return (
                        <div key={post.id} className={`group relative flex gap-4 animate-in ${isInstructor ? 'flex-row-reverse' : ''}`}>
                          <div className="flex flex-col items-center gap-2">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-xs shrink-0 shadow-sm ring-4 ring-white dark:ring-[#0B1120] z-10 ${isInstructor ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900' : 'bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300'}`}>
                              {post.student_name.charAt(0)}
                            </div>
                          </div>
                          
                          <div className={`flex-1 min-w-0 flex flex-col ${isInstructor ? 'items-end' : 'items-start'}`}>
                            <div className={`flex items-baseline gap-2 mb-1 ${isInstructor ? 'flex-row-reverse' : ''}`}>
                              <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100">{post.student_name}</span>
                              <span className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">{post.timestamp}</span>
                            </div>
                            
                            <div className={`relative max-w-[85%] p-5 rounded-2xl shadow-sm text-sm leading-relaxed font-medium transition-all ${
                              isInstructor 
                                ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-tr-sm' 
                                : !post.isRead 
                                  ? 'bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border-2 border-zinc-300 dark:border-zinc-600 rounded-tl-sm'
                                  : 'bg-zinc-50 dark:bg-white/5 text-zinc-700 dark:text-zinc-300 border border-zinc-100 dark:border-white/5 rounded-tl-sm'
                            }`}>
                              {post.content}
                              
                              <div className={`absolute ${isInstructor ? '-left-12' : '-right-12'} top-2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2`}>
                                {!isInstructor && (
                                  <button
                                    onClick={() => toggleReadStatus(post.id, post.isRead, post.metadata)}
                                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${post.isRead ? 'bg-zinc-100 dark:bg-white/10 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-white/20' : 'bg-zinc-200 dark:bg-white/20 text-zinc-800 dark:text-white hover:bg-zinc-300 dark:hover:bg-white/30'}`}
                                    title={post.isRead ? 'Mark Unread' : 'Mark as Read'}
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                  </button>
                                )}
                                <button 
                                  onClick={() => handleReplyClick(post.id)}
                                  className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-white/10 flex items-center justify-center text-zinc-500 hover:bg-zinc-200 dark:hover:bg-white/20 transition-all"
                                  title="Reply"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                                </button>
                                <button 
                                  onClick={() => deletePost(post.id)} 
                                  className="w-8 h-8 rounded-full bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center text-rose-500 hover:bg-rose-500 hover:text-white transition-all"
                                  title="Delete"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>

                            {replyingTo === post.id && (
                              <div className={`mt-3 w-full max-w-[85%] bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/50 dark:border-white/10 p-3 shadow-lg animate-in`}>
                                <textarea
                                  ref={replyInputRef}
                                  value={replyText}
                                  onChange={e => setReplyText(e.target.value)}
                                  placeholder={`Reply to ${post.student_name}...`}
                                  rows={2}
                                  className="w-full bg-transparent border-none p-2 text-sm text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 focus:outline-none focus:ring-0 resize-none"
                                />
                                <div className="flex justify-between items-center mt-2 pt-2 border-t border-zinc-100 dark:border-white/5">
                                  <button onClick={() => setReplyingTo(null)} className="text-[10px] font-bold text-zinc-400 hover:text-zinc-600 px-3 py-1">Cancel</button>
                                  <button
                                    onClick={() => handlePostReply(post.id)}
                                    disabled={!replyText.trim() || isPostingReply}
                                    className="px-4 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 dark:text-zinc-900 disabled:bg-zinc-200 dark:disabled:bg-white/5 disabled:text-zinc-400 text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                                  >
                                    {isPostingReply ? 'Sending...' : 'Send'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }) : (
                      <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                        <div className="text-4xl opacity-20">💬</div>
                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{filterMode === 'unread' ? 'All caught up!' : 'No contributions recorded'}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full bg-white/80 dark:bg-black/40 backdrop-blur-xl rounded-3xl border border-zinc-200/50 dark:border-white/10 shadow-sm flex flex-col items-center justify-center text-center p-20 stagger-card transition-colors">
                <div className="w-32 h-32 bg-zinc-50 dark:bg-white/5 rounded-full flex items-center justify-center text-5xl mb-8 hover:scale-105 transition-transform duration-500 shadow-inner">💬</div>
                <h3 className="text-3xl font-black text-zinc-900 dark:text-white tracking-tight mb-3">Select a Discussion</h3>
                <p className="text-zinc-500 dark:text-zinc-400 font-medium max-w-xs text-sm leading-relaxed">Choose a prompt from the queue to moderate student contributions and analyze engagement.</p>
              </div>
            )}
          </div>
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(156, 163, 175, 0.25);
          border-radius: 9999px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(156, 163, 175, 0.45);
        }
        @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
};

export default DiscussionsManagement;



