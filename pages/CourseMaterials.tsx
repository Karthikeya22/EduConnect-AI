
import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { supabase } from '../lib/supabase';
import MaterialPreviewModal from '../components/MaterialPreviewModal';
import { MaterialGridSkeleton } from '../components/Skeleton';

interface CourseMaterialsProps {
  onBack: () => void;
  onNavigateDashboard: () => void;
  onNavigateMaterials: () => void;
  onNavigateProgress: () => void;
}

interface Material {
  id: string;
  title: string;
  topic: string;
  description: string;
  chapter_number: number;
  file_type: string;
  location_url: string;
  created_at: string;
  isViewed?: boolean;
}

const CourseMaterials: React.FC<CourseMaterialsProps> = ({ onBack, onNavigateDashboard, onNavigateMaterials, onNavigateProgress }) => {
  const [loading, setLoading] = useState(true);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [filteredMaterials, setFilteredMaterials] = useState<Material[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChapter, setSelectedChapter] = useState('All Chapters');
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [totalViewed, setTotalViewed] = useState(0);

  useEffect(() => {
    fetchMaterials();
  }, []);

  useEffect(() => {
    let filtered = materials;
    if (searchQuery) filtered = filtered.filter(m => m.title.toLowerCase().includes(searchQuery.toLowerCase()));
    if (selectedChapter !== 'All Chapters') filtered = filtered.filter(m => m.topic === selectedChapter);
    setFilteredMaterials(filtered);
  }, [searchQuery, selectedChapter, materials]);

  const fetchMaterials = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      // FIX: Specific columns
      const { data: mats } = await supabase.from('instructional_materials').select('id, title, topic, description, chapter_number, file_type, location_url, created_at').order('chapter_number', { ascending: true });
      const { data: viewed } = await supabase.from('student_learning_activities').select('target_id').eq('student_id', session.user.id);
      const viewedSet = new Set(viewed?.map(v => v.target_id));
      const enriched = (mats || []).map(m => ({ ...m, isViewed: viewedSet.has(m.id) }));
      setMaterials(enriched);
      setTotalViewed(enriched.filter(m => m.isViewed).length);
      if (enriched.length > 0) setExpandedChapters(new Set([enriched[0].topic]));
    } catch (err) { console.error(err); } finally { 
      setTimeout(() => setLoading(false), 800);
    }
  };

  const handleMaterialClick = async (m: Material) => {
    setSelectedMaterial(m);
    
    if (m.isViewed) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Log the interaction
      await supabase.from('student_learning_activities').insert({
        student_id: session.user.id,
        target_id: m.id,
        activity_type: 'VIEW_MATERIAL',
        timestamp: new Date().toISOString()
      });

      // Update local state
      setMaterials(prev => prev.map(item => 
        item.id === m.id ? { ...item, isViewed: true } : item
      ));
      setTotalViewed(prev => prev + 1);
    } catch (err) {
      console.error("Failed to log material interaction:", err);
    }
  };

  const chapters = Array.from(new Set(materials.map(m => m.topic))) as string[];

  return (
    <div className="flex h-screen bg-[#F8FAFC] overflow-hidden relative font-['Plus_Jakarta_Sans']">
      <aside className={`bg-[#0F172A] text-white transition-all duration-500 flex flex-col shadow-2xl relative z-50 ${sidebarCollapsed ? 'w-[72px]' : 'w-[260px]'}`}>
        <div className="h-16 flex items-center px-6 border-b border-white/10 shrink-0"><div className="w-8 h-8 bg-cyan-50 rounded-lg flex items-center justify-center font-bold text-navy-900 shrink-0 shadow-lg">USF</div>{!sidebarCollapsed && <span className="ml-3 font-bold text-lg truncate">BigData Student</span>}</div>
        <nav className="flex-1 py-6"><button onClick={onBack} className="w-full flex items-center px-6 py-4 transition-all hover:bg-white/5 border-l-4 border-transparent"><span className="text-xl">←</span>{!sidebarCollapsed && <span className="ml-4 font-bold text-sm">Dashboard Hub</span>}</button></nav>
        <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="h-14 border-t border-white/10 flex items-center justify-center text-zinc-400">{sidebarCollapsed ? '→' : '←'}</button>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="p-8 md:p-12 pb-6 border-b border-zinc-100 bg-white">
          <div className="max-w-[1200px] mx-auto">
            <button onClick={onBack} className="flex items-center space-x-2 text-zinc-400 hover:text-cyan-600 transition-colors mb-6 group">
               <span className="text-xl group-hover:-translate-x-1 transition-transform">←</span>
               <span className="font-bold text-sm">Return Home</span>
            </button>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
              <div>
                <h1 className="text-5xl font-black text-zinc-900 tracking-tighter bg-gradient-to-r from-cyan-600 to-purple-600 bg-clip-text text-transparent">Course Materials</h1>
                <p className="text-zinc-500 font-bold mt-1">Readings, slides, and academic assets.</p>
              </div>
              <div className="w-full md:w-80">
                <div className="flex justify-between text-[10px] font-black uppercase text-zinc-400">
                  <span>Materials Synced</span>
                  <span>{totalViewed}/{materials.length || '--'}</span>
                </div>
                <div className="h-3 bg-zinc-100 rounded-full overflow-hidden mt-2 relative">
                  <div className="h-full bg-cyan-500 rounded-full transition-all duration-1000" style={{ width: `${(totalViewed / (materials.length || 1)) * 100}%` }}></div>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="relative flex-1 max-w-md">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400">🔍</span>
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search course files..." className="w-full h-12 pl-12 pr-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:border-cyan-500 focus:outline-none font-bold text-xs" />
              </div>
              <select value={selectedChapter} onChange={(e) => setSelectedChapter(e.target.value)} className="h-12 px-6 bg-zinc-50 border border-zinc-200 rounded-2xl font-bold text-xs focus:outline-none">
                <option>All Chapters</option>
                {chapters.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
        </header>
        
        <main className="flex-1 overflow-y-auto p-8 md:p-12 bg-[#F8FAFC]/50 scroll-smooth">
           <div className="max-w-[1200px] mx-auto">
              {loading ? (
                <MaterialGridSkeleton />
              ) : (
                <div className="space-y-8">
                  {chapters.length > 0 ? chapters.map(chapter => (
                    <section key={chapter} className="bg-white rounded-[3.5rem] border border-zinc-100 shadow-xl overflow-hidden p-10 animate-fade-in">
                       <div className="flex items-center justify-between mb-8 border-b border-zinc-50 pb-6">
                         <h2 className="text-2xl font-black text-zinc-900 tracking-tight">{chapter}</h2>
                         <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest bg-zinc-50 px-4 py-2 rounded-full border border-zinc-100">
                           {filteredMaterials.filter(m => m.topic === chapter).length} Resources
                         </span>
                       </div>
                       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                          {filteredMaterials.filter(m => m.topic === chapter).map(m => (
                            <div key={m.id} onClick={() => handleMaterialClick(m)} className="bg-zinc-50/50 p-8 rounded-[2.5rem] border-2 border-transparent hover:border-cyan-400 hover:bg-white hover:shadow-2xl hover:translate-y-[-4px] cursor-pointer transition-all group">
                               <div className="flex justify-between items-start mb-6">
                                 <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-2xl shadow-sm border border-zinc-100 group-hover:scale-110 transition-transform">
                                   {m.file_type === 'pdf' ? '📕' : '📄'}
                                 </div>
                                 {m.isViewed && <span className="w-8 h-8 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-[10px] font-black">✓</span>}
                               </div>
                               <h3 className="font-black text-zinc-900 text-lg leading-tight mb-2 group-hover:text-cyan-600 transition-colors">{m.title}</h3>
                               <p className="text-xs text-zinc-500 font-medium leading-relaxed line-clamp-2">{m.description}</p>
                            </div>
                          ))}
                       </div>
                    </section>
                  )) : (
                    <div className="py-32 text-center bg-white rounded-[3.5rem] border border-dashed border-zinc-200">
                       <p className="text-xs font-bold text-zinc-400 uppercase tracking-[0.2em]">Repository empty for this filter</p>
                    </div>
                  )}
                </div>
              )}
           </div>
        </main>
      </div>
      {selectedMaterial && <MaterialPreviewModal material={selectedMaterial} onClose={() => setSelectedMaterial(null)} />}
      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
};

export default CourseMaterials;
