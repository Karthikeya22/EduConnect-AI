
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/logger';
import AppSidebar from '../components/AppSidebar';
import { AppPath } from '../App';

interface AssetHubProps {
  onBack: () => void;
  onLogout: () => void;
  onNavigateTo: (path: AppPath) => void;
  currentPath: AppPath;
}

interface HubItem {
  id: string;
  title: string;
  topic: string | null;
  description: string;
  file_type: string;
  location_url?: string;
  created_at: string;
  size?: string; // Mocked for display
  modified_by?: string; // Mocked for display
  is_visible?: boolean; // New field for visibility
}

// Icons
const IconSearch = () => <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>;
const IconFolder = () => <svg className="w-5 h-5 text-zinc-700 fill-zinc-700" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" /></svg>;
const IconFile = ({ type }: { type: string }) => {
  if (['jpg', 'png', 'jpeg', 'gif'].includes(type.toLowerCase())) return <svg className="w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
  return <svg className="w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
};
const IconCheck = () => <svg className="w-4 h-4 text-green-600 bg-green-100 rounded-full p-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>;
const IconDots = () => <svg className="w-5 h-5 text-zinc-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" /></svg>;
const IconDownload = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>;
const IconPlus = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>;
const IconUpload = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>;
const IconChevronDown = () => <svg className="w-3 h-3 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>;
const IconTrash = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>;
const IconEye = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>;
const IconEyeOff = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>;

const AssetHub: React.FC<AssetHubProps> = ({ onBack, onLogout, onNavigateTo, currentPath }) => {
  const [items, setItems] = useState<HubItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentFolder, setCurrentFolder] = useState<string | null>(null); // Null = Root
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null); // ID of item with open menu
  
  // Folder Creation State
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("New Folder");
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchItems = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('instructional_materials')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      
      const enriched = (data || []).map(d => ({
        ...d,
        size: Math.floor(Math.random() * 500 + 50) + ' KB',
        modified_by: 'Bo Pei',
        is_visible: true // Default to visible since column is missing
      }));
      setItems(enriched);
    } catch (err: any) {
      console.error(err);
      showToast("Sync failed", 'error');
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  useEffect(() => {
    const handleClickOutside = () => setActiveMenu(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  // --- Filtering & View Logic ---
  const allFolders: string[] = Array.from(new Set(items.map(i => i.topic).filter((t): t is string => !!t))).sort();

  let displayedFolders: string[] = [];
  let displayedFiles: HubItem[] = [];

  if (currentFolder) {
    displayedFolders = []; 
    displayedFiles = items.filter(i => 
      i.topic === currentFolder && 
      i.file_type !== 'folder_meta' && 
      i.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  } else {
    displayedFolders = allFolders.filter(f => f.toLowerCase().includes(searchQuery.toLowerCase()));
    displayedFiles = items.filter(i => 
      !i.topic && 
      i.file_type !== 'folder_meta' && 
      i.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }

  const handleSelection = (id: string, multi: boolean) => {
    const newSet = new Set(multi ? selectedIds : []);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const allIds = [...displayedFolders, ...displayedFiles.map(i => i.id)];
      setSelectedIds(new Set(allIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleToggleVisibility = async (id: string, isFolder: boolean, currentVisibility: boolean) => {
    showToast("Visibility toggling is currently disabled.", 'error');
  };

  const handleSingleDelete = async (id: string, isFolder: boolean) => {
    if (!window.confirm(`Are you sure you want to delete this ${isFolder ? 'folder' : 'file'}? This action cannot be undone.`)) return;
    
    setActiveMenu(null);

    try {
        if (isFolder) {
             // Delete records with this topic
             await supabase.from('instructional_materials').delete().eq('topic', id);
             // Note: Storage files are hard to batch delete without IDs/paths. 
             // Ideally we'd fetch all items in folder first, extract paths, then delete from storage.
             // For now, we clean the database which hides them from UI.
        } else {
             const item = items.find(i => i.id === id);
             // Attempt to delete from storage if URL indicates it's an upload
             if (item && item.location_url && item.location_url.includes('uploads/')) {
                 try {
                     // Extract path from public URL. 
                     // Standard Supabase URL: .../storage/v1/object/public/bucket-name/folder/file
                     const urlParts = item.location_url.split('/course-materials/');
                     if (urlParts.length > 1) {
                         const storagePath = urlParts[1]; // e.g. "uploads/abc-file.pdf"
                         await supabase.storage.from('course-materials').remove([storagePath]);
                     }
                 } catch (e) {
                     console.warn("Storage cleanup warning:", e);
                 }
             }

             // Delete DB record
             const { error } = await supabase.from('instructional_materials').delete().eq('id', id);
             if (error) throw error;
        }

        await fetchItems(true); 
        showToast(`${isFolder ? 'Folder' : 'Item'} deleted successfully.`);
    } catch (err: any) {
        console.error(err);
        showToast("Delete failed: " + err.message, 'error');
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    showToast(`Uploading ${files.length} items...`);
    setShowUploadMenu(false);
    const targetTopic = currentFolder || null;
    await performUpload(files, targetTopic, "Uploaded File");
  };

  const handleFolderUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    showToast(`Importing folder structure... (${files.length} files)`);
    setShowUploadMenu(false);
    const baseTopic = currentFolder;
    await performUpload(files, baseTopic, "Folder Import", true);
  };

  const performUpload = async (files: FileList, fixedTopic: string | null, desc: string, isFolderUpload = false) => {
    try {
        const uploadPromises = Array.from(files).map(async (f: any) => {
            const fileExt = f.name.split('.').pop() || 'file';
            const randomID = Math.random().toString(36).substring(2, 10);
            const safeName = f.name.replace(/[^a-zA-Z0-9.-]/g, '_');
            const filePath = `uploads/${randomID}-${safeName}`;
            
            let finalTopic = fixedTopic;
            if (isFolderUpload && !finalTopic && f.webkitRelativePath) {
                const pathParts = f.webkitRelativePath.split('/');
                if (pathParts.length > 1) {
                    finalTopic = pathParts[0]; 
                }
            }
            
            // Database constraint: topic cannot be null
            if (!finalTopic) {
                finalTopic = "General";
            }

            const { error: upErr } = await supabase.storage.from('course-materials').upload(filePath, f);
            if (upErr) throw upErr;
            
            const { data } = supabase.storage.from('course-materials').getPublicUrl(filePath);
            
            return {
                course_id: 'BIG_DATA_2026',
                title: f.name,
                topic: finalTopic,
                file_type: fileExt,
                description: desc,
                location_url: data.publicUrl
                // is_visible removed
            };
        });

        const newRecords = await Promise.all(uploadPromises);
        const { error: dbError } = await supabase.from('instructional_materials').insert(newRecords);
        if (dbError) throw dbError;

        await fetchItems();
        showToast("Upload complete.");
    } catch (err: any) {
        showToast(err.message || "Upload failed", 'error');
    }
  };

  const startCreateFolder = () => {
    if (currentFolder) {
        showToast("Can only create folders in Root view.", 'error');
        return;
    }
    setNewFolderName("New Folder");
    setIsCreatingFolder(true);
    setTimeout(() => newFolderInputRef.current?.select(), 50);
  };

  const finalizeCreateFolder = async () => {
    if (!isCreatingFolder || !newFolderName.trim()) {
        setIsCreatingFolder(false);
        return;
    }
    const name = newFolderName.trim();
    if (allFolders.some(f => f.toLowerCase() === name.toLowerCase())) {
        showToast("A folder with this name already exists.", 'error');
        newFolderInputRef.current?.select();
        return;
    }
    setIsCreatingFolder(false);
    try {
        const { error } = await supabase.from('instructional_materials').insert({
            course_id: 'BIG_DATA_2026',
            title: '.keep',
            topic: name,
            file_type: 'folder_meta',
            description: 'Folder placeholder',
            location_url: '#'
            // is_visible removed
        });
        if (error) throw error;
        await fetchItems();
        showToast(`Folder "${name}" created.`);
    } catch(err: any) {
        console.error(err);
        showToast("Failed to create folder", 'error');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="flex h-screen bg-white font-['Plus_Jakarta_Sans'] overflow-hidden">
      <AppSidebar role="teacher" currentPath={currentPath} onNavigateTo={onNavigateTo} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} onLogout={onLogout} />
      
      <main className="flex-1 flex flex-col min-w-0 h-full">
        {/* Header */}
        <header className="h-20 border-b border-zinc-200 px-8 flex items-center justify-between shrink-0">
            <h1 className="text-2xl font-black text-zinc-900 tracking-tight">Files</h1>
            <div className="flex items-center space-x-4">
                <button className="flex items-center space-x-2 text-zinc-500 hover:text-zinc-900 px-4 py-2 rounded-lg hover:bg-zinc-50 transition-colors">
                    <span className="text-sm font-bold">6d View as Student</span>
                </button>
                <button onClick={onBack} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-zinc-100 text-zinc-400 hover:text-zinc-900 transition-all">✕</button>
            </div>
        </header>

        {/* Toolbar */}
        <div className="px-8 py-6 space-y-6 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center space-x-3">
                    <button onClick={() => setCurrentFolder(null)} className={`px-4 py-2 border border-zinc-200 text-zinc-600 font-bold text-xs rounded-md hover:bg-zinc-50 transition-colors shadow-sm ${!currentFolder ? 'bg-zinc-100' : 'bg-white'}`}>All My Files</button>
                    {!currentFolder && (
                      <button onClick={startCreateFolder} className="px-4 py-2 border border-zinc-200 text-zinc-600 font-bold text-xs rounded-md bg-white hover:bg-zinc-50 transition-colors shadow-sm flex items-center space-x-2">
                          <IconPlus /> <span>Folder</span>
                      </button>
                    )}
                </div>
                <div className="flex items-center space-x-3 relative">
                    <button onClick={() => setShowUploadMenu(!showUploadMenu)} className="px-6 py-2 bg-[#0E6C50] text-white font-bold text-xs rounded-md hover:bg-[#09523c] transition-all shadow-sm flex items-center space-x-2">
                        <IconUpload /> <span>Upload {currentFolder ? `to ${currentFolder}` : ''}</span> <IconChevronDown />
                    </button>
                    
                    {showUploadMenu && (
                      <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-zinc-100 overflow-hidden z-50 animate-fade-in origin-top-right">
                        <button onClick={() => fileInputRef.current?.click()} className="w-full text-left px-4 py-3 text-xs font-bold text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 flex items-center space-x-2">
                          <IconFile type="file" /> <span>Upload File</span>
                        </button>
                        <button onClick={() => folderInputRef.current?.click()} className="w-full text-left px-4 py-3 text-xs font-bold text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 flex items-center space-x-2 border-t border-zinc-50">
                          <IconFolder /> <span>Upload Folder</span>
                        </button>
                      </div>
                    )}
                    
                    <input type="file" multiple className="hidden" ref={fileInputRef} onChange={e => handleUpload(e.target.files)} />
                    <input 
                      type="file" 
                      multiple 
                      {...({ webkitdirectory: "", directory: "" } as any)} 
                      className="hidden" 
                      ref={folderInputRef} 
                      onChange={e => handleFolderUpload(e.target.files)} 
                    />
                </div>
            </div>

            <div className="flex items-center justify-between">
                <div className="relative w-full max-w-2xl">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2"><IconSearch /></span>
                    <input 
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search files..." 
                        className="w-full h-10 pl-10 pr-4 border border-zinc-300 rounded-md text-sm text-zinc-700 placeholder-zinc-400 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 transition-all"
                    />
                </div>
                <button className="ml-4 px-6 py-2 border border-zinc-300 rounded-md text-sm font-bold text-zinc-600 hover:bg-zinc-50">Search</button>
            </div>

            <div className="flex items-center justify-between text-sm text-zinc-500 border-b border-zinc-200 pb-2">
                <div className="flex items-center space-x-2">
                    <button onClick={() => setCurrentFolder(null)} className="font-bold text-zinc-900 hover:underline">[Online Version] EME6356.001S26.14525 Big Data & Learning Analytics</button>
                    {currentFolder && (
                        <>
                            <span>/</span>
                            <span className="font-bold text-zinc-700">{currentFolder}</span>
                        </>
                    )}
                </div>
                <div className="flex items-center space-x-3">
                    {selectedIds.size > 0 && (
                        <>
                            <span className="text-zinc-600 font-bold">{selectedIds.size} selected</span>
                            <button className="p-2 hover:bg-zinc-100 rounded text-zinc-600"><IconDownload /></button>
                        </>
                    )}
                </div>
            </div>
        </div>

        {/* File Table */}
        <div className="flex-1 overflow-auto px-8 pb-8" onClick={() => setShowUploadMenu(false)}>
            <table className="w-full min-w-[800px]">
                <thead className="sticky top-0 bg-white z-10 border-b border-zinc-200">
                    <tr>
                        <th className="w-12 py-3 text-left pl-2"><input type="checkbox" onChange={handleSelectAll} className="w-4 h-4 rounded border-zinc-300 text-[#0E6C50] focus:ring-[#0E6C50]" /></th>
                        <th className="py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider w-12"></th>
                        <th className="py-3 text-left text-xs font-bold text-[#0E6C50] uppercase tracking-wider cursor-pointer">Name ▲</th>
                        <th className="py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider">Created</th>
                        <th className="py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider">Last Modified</th>
                        <th className="py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider">Modified By</th>
                        <th className="py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider">Size</th>
                        <th className="py-3 text-center text-xs font-bold text-zinc-500 uppercase tracking-wider">Status</th>
                        <th className="py-3 text-right text-xs font-bold text-zinc-500 uppercase tracking-wider">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                    {/* Back Button inside Folder */}
                    {currentFolder && (
                        <tr className="group hover:bg-zinc-50 cursor-pointer" onClick={() => setCurrentFolder(null)}>
                            <td className="py-4 pl-2"></td>
                            <td className="py-4 text-center text-zinc-400 font-bold">..</td>
                            <td className="py-4 font-bold text-sm text-zinc-500" colSpan={7}>Back to Root</td>
                        </tr>
                    )}

                    {/* Inline Folder Creation Row */}
                    {isCreatingFolder && !currentFolder && (
                        <tr className="group bg-blue-50/20">
                            <td className="py-4 pl-2"><input type="checkbox" disabled className="w-4 h-4 rounded border-zinc-300" /></td>
                            <td className="py-4"><IconFolder /></td>
                            <td className="py-4">
                                <input 
                                    ref={newFolderInputRef}
                                    value={newFolderName}
                                    onChange={e => setNewFolderName(e.target.value)}
                                    onBlur={finalizeCreateFolder}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            finalizeCreateFolder();
                                        } else if (e.key === 'Escape') {
                                            setIsCreatingFolder(false);
                                        }
                                    }}
                                    className="bg-white border border-blue-400 rounded px-2 py-1 text-sm font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-200 w-64"
                                    autoFocus
                                />
                            </td>
                            <td className="py-4 text-xs text-zinc-400" colSpan={6}>Creating...</td>
                        </tr>
                    )}

                    {/* Render Folders (Only in Root) */}
                    {displayedFolders.map(folderName => {
                        // Determine folder visibility based on children
                        const folderItems = items.filter(i => i.topic === folderName);
                        // If ALL items in folder are hidden, folder is hidden. Otherwise visible.
                        const isFolderHidden = folderItems.length > 0 && folderItems.every(i => i.is_visible === false);

                        return (
                        <tr key={folderName} className={`group hover:bg-zinc-50 transition-colors ${selectedIds.has(folderName) ? 'bg-blue-50/50' : ''} ${isFolderHidden ? 'opacity-60' : ''}`}>
                            <td className="py-4 pl-2"><input type="checkbox" checked={selectedIds.has(folderName)} onChange={() => handleSelection(folderName, true)} className="w-4 h-4 rounded border-zinc-300 text-[#0E6C50] focus:ring-[#0E6C50]" /></td>
                            <td className="py-4">
                                <div className="relative">
                                    <IconFolder />
                                    {isFolderHidden && <div className="absolute -top-1 -right-1 w-2 h-2 bg-zinc-400 rounded-full border border-white" />}
                                </div>
                            </td>
                            <td className="py-4 font-bold text-sm text-zinc-900 cursor-pointer hover:underline hover:text-[#0E6C50]" onClick={() => setCurrentFolder(folderName)}>
                                {folderName}
                                {isFolderHidden && <span className="ml-2 text-[9px] uppercase tracking-widest text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full">Hidden</span>}
                            </td>
                            <td className="py-4 text-xs text-zinc-500 font-medium">Jan 3, 2026</td>
                            <td className="py-4 text-xs text-zinc-500 font-medium">Jan 3, 2026</td>
                            <td className="py-4 text-xs text-zinc-500 font-medium">--</td>
                            <td className="py-4 text-xs text-zinc-500 font-medium">--</td>
                            <td className="py-4 text-center"><div className="flex justify-center"><IconCheck /></div></td>
                            <td className="py-4 text-right pr-2 relative">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === folderName ? null : folderName); }} 
                                    className="text-zinc-400 hover:text-zinc-600 p-2"
                                >
                                    <IconDots />
                                </button>
                                {activeMenu === folderName && (
                                    <div className="absolute right-8 top-8 w-44 bg-white rounded-xl shadow-xl border border-zinc-100 z-50 overflow-hidden animate-fade-in origin-top-right">
                                        <button onClick={(e) => { e.stopPropagation(); handleToggleVisibility(folderName, true, !isFolderHidden); }} className="w-full text-left px-4 py-3 text-xs font-bold text-zinc-600 hover:bg-zinc-50 flex items-center space-x-2">
                                            {isFolderHidden ? <><IconEye /> <span>Show to Students</span></> : <><IconEyeOff /> <span>Hide from Students</span></>}
                                        </button>
                                        <button onClick={(e) => { e.stopPropagation(); handleSingleDelete(folderName, true); }} className="w-full text-left px-4 py-3 text-xs font-bold text-red-500 hover:bg-red-50 flex items-center space-x-2 border-t border-zinc-50">
                                            <IconTrash /> <span>Delete Folder</span>
                                        </button>
                                    </div>
                                )}
                            </td>
                        </tr>
                    )})}

                    {/* Render Files */}
                    {displayedFiles.map(item => (
                        <tr key={item.id} className={`group hover:bg-zinc-50 transition-colors ${selectedIds.has(item.id) ? 'bg-blue-50/50' : ''} ${item.is_visible === false ? 'opacity-60 bg-zinc-50/30' : ''}`}>
                            <td className="py-4 pl-2"><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => handleSelection(item.id, true)} className="w-4 h-4 rounded border-zinc-300 text-[#0E6C50] focus:ring-[#0E6C50]" /></td>
                            <td className="py-4">
                                <div className="relative">
                                    <IconFile type={item.file_type} />
                                    {item.is_visible === false && <div className="absolute -top-1 -right-1 w-2 h-2 bg-zinc-400 rounded-full border border-white" />}
                                </div>
                            </td>
                            <td className="py-4">
                                <div className="flex items-center">
                                    <a href={item.location_url} target="_blank" rel="noreferrer" className="font-bold text-sm text-zinc-900 hover:underline hover:text-[#0E6C50] block truncate max-w-[250px]">{item.title}</a>
                                    {item.is_visible === false && <span className="ml-2 text-[9px] uppercase tracking-widest text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full">Hidden</span>}
                                </div>
                            </td>
                            <td className="py-4 text-xs text-zinc-500 font-medium">{formatDate(item.created_at)}</td>
                            <td className="py-4 text-xs text-zinc-500 font-medium">{formatDate(item.created_at)}</td>
                            <td className="py-4 text-xs text-zinc-500 font-medium">{item.modified_by}</td>
                            <td className="py-4 text-xs text-zinc-500 font-medium">{item.size}</td>
                            <td className="py-4 text-center"><div className="flex justify-center"><IconCheck /></div></td>
                            <td className="py-4 text-right pr-2 relative">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === item.id ? null : item.id); }} 
                                    className="text-zinc-400 hover:text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity p-2"
                                >
                                    <IconDots />
                                </button>
                                {activeMenu === item.id && (
                                    <div className="absolute right-8 top-8 w-44 bg-white rounded-xl shadow-xl border border-zinc-100 z-50 overflow-hidden animate-fade-in origin-top-right">
                                        <button onClick={(e) => { e.stopPropagation(); window.open(item.location_url, '_blank'); setActiveMenu(null); }} className="w-full text-left px-4 py-3 text-xs font-bold text-zinc-600 hover:bg-zinc-50 flex items-center space-x-2">
                                            <IconDownload /> <span>Download</span>
                                        </button>
                                        <button onClick={(e) => { e.stopPropagation(); handleToggleVisibility(item.id, false, !!item.is_visible); }} className="w-full text-left px-4 py-3 text-xs font-bold text-zinc-600 hover:bg-zinc-50 flex items-center space-x-2 border-t border-zinc-50">
                                            {item.is_visible === false ? <><IconEye /> <span>Show to Students</span></> : <><IconEyeOff /> <span>Hide from Students</span></>}
                                        </button>
                                        <button onClick={(e) => { e.stopPropagation(); handleSingleDelete(item.id, false); }} className="w-full text-left px-4 py-3 text-xs font-bold text-red-500 hover:bg-red-50 border-t border-zinc-50 flex items-center space-x-2">
                                            <IconTrash /> <span>Delete</span>
                                        </button>
                                    </div>
                                )}
                            </td>
                        </tr>
                    ))}

                    {/* Empty State */}
                    {!isCreatingFolder && displayedFolders.length === 0 && displayedFiles.length === 0 && (
                        <tr>
                            <td colSpan={9} className="py-12 text-center text-zinc-400 font-medium text-sm">
                                {currentFolder ? "This folder is empty. Upload files to save it." : "No files found."}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>

        {/* Footer/Toast */}
        {toast && (
            <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg text-white text-sm font-bold animate-fade-in z-50 ${toast.type === 'error' ? 'bg-red-600' : 'bg-zinc-800'}`}>
                {toast.message}
            </div>
        )}
      </main>
      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.2s ease-out; }
      `}</style>
    </div>
  );
};

export default AssetHub;
