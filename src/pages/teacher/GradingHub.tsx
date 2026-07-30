import React, { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { gsap } from 'gsap';
import * as Icons from '../../components/ui/Icons';
import { canvasAPI } from '../../services/canvasAPI';
import { supabase } from '../../lib/supabase';
import { aiAPI } from '../../services/aiAPI';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { GradingResult } from '../../components/grading/GradingResult';
import { GradingOutput } from '../../types/grading';
import { UniversalPreviewer } from '../../components/ui/UniversalPreviewer';
import { selectPhaseFiles, CanvasCourseFile } from '../../lib/courseFileRanker';

const MOCK_LEARNING_PROFILE = {
  materialsViewed: '18/24',
  mostActiveTopic: 'Chapter 2 (MapReduce)',
  lastActive: '2 days ago',
  discussionPosts: 8,
  assignmentCompletion: '5/6',
  completionRate: 83,
  backgroundNote: 'Works in data engineering, engages most with practical applications'
};

const MOCK_AI_RESPONSE = {
  suggestedGrade: 87,
  strengths: [
    "Strong real-world connection to professional experience",
    "Accurate technical explanation of MapReduce architecture"
  ],
  improvements: [
    "Could elaborate more on fault tolerance mechanisms",
    "Missing comparison to alternative frameworks"
  ],
  feedback: "Excellent work. Your explanation of distributed processing is accurate and well-structured. To strengthen this further, consider discussing how MapReduce handles node failures.",
  personalizedNote: "Given your background in data engineering, you might find it valuable to explore how modern tools like Apache Spark have evolved from the MapReduce paradigm.",
  tags: ["Excellent format", "Needs fault tolerance info"]
};

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMsg: string;
}

class RightPanelErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMsg: error.toString() };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("RightPanel Crash Detected:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-zinc-900 border-2 border-red-500 rounded text-red-100 min-h-[50vh]">
          <div className="text-center max-w-lg mb-4 p-4 bg-black rounded shadow">
            <h2 className="text-xl font-bold mb-2">Rendering Error in Student View</h2>
            <div className="text-xs mb-4 font-mono text-left block text-red-300 overflow-auto">{this.state.errorMsg}</div>
          </div>
          <button onClick={() => this.setState({hasError: false})} className="px-6 py-3 bg-red-600 font-bold uppercase disabled opacity-80 cursor-pointer rounded">Retry Render</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function GradingHub({ onBack, onNavigateTo, currentPath, onLogout, onOpenNotifs }: { onBack?: () => void, onNavigateTo?: (path: string) => void, currentPath?: string, onLogout?: () => void, onOpenNotifs?: () => void }) {
  const [activeCourse, setActiveCourse] = useState<{id: string, name: string} | null>(null);
  const selectedCourse = activeCourse?.id;

  const [assignments, setAssignments] = useState<any[]>([]);
  const [discussions, setDiscussions] = useState<any[]>([]);
  const [studentsData, setStudentsData] = useState<any[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [activeAttachment, setActiveAttachment] = useState<any>(null);
  const [useMoE, setUseMoE] = useState<boolean>(false);

  const [filter, setFilter] = useState<'All' | 'Ungraded' | 'Graded' | 'Missing'>('All');
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'Default' | 'NameASC' | 'UID' | 'GradeASC'>('Default');

  const [leftPanelWidth, setLeftPanelWidth] = useState(280);
  const [rightPanelWidth, setRightPanelWidth] = useState(420);
  const isDraggingLeft = useRef(false);
  const isDraggingRight = useRef(false);

  // New states for Sidebar Filtering
  const [sideFilterType, setSideFilterType] = useState<'All' | 'Assignments' | 'Quizzes' | 'Discussions'>('All');
  const [sideSortOrder, setSideSortOrder] = useState<'Newest' | 'Oldest'>('Newest');

  const [loading, setLoading] = useState({ assignments: true, submissions: false });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [showScaffoldedFeedback, setShowScaffoldedFeedback] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isGradingSidebarCollapsed, setIsGradingSidebarCollapsed] = useState(false);
  const [showAssignmentContext, setShowAssignmentContext] = useState(false);
  const [showLearningProfile, setShowLearningProfile] = useState(false);
  const [showRubricContext, setShowRubricContext] = useState(false);

  // Phase 3: RAG States
  const [aiGradingData, setAiGradingData] = useState<Record<string, GradingOutput>>({});
  const [loadingStudents, setLoadingStudents] = useState<Set<string>>(new Set());
  const [ingestingStudents, setIngestingStudents] = useState<Set<string>>(new Set());
  const [ingestStatus, setIngestStatus] = useState<{ type: 'success' | 'error' | 'loading', msg: string } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [ingestedAssignments, setIngestedAssignments] = useState<Set<string>>(new Set());
  const ingestionPromisesRef = useRef<Record<string, Promise<void>>>({});
  const [backgroundIndexing, setBackgroundIndexing] = useState(false);
  const [highlightText, setHighlightText] = useState<string | null>(null);

  // References for animations
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const centerPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const centerRowsRef = useRef<HTMLDivElement>(null);
  const rightCardsRef = useRef<HTMLDivElement>(null);

  // Resizing logic
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingLeft.current) {
        let newWidth = e.clientX;
        if (newWidth < 200) newWidth = 200;
        if (newWidth > 500) newWidth = 500;
        setLeftPanelWidth(newWidth);
      }
      if (isDraggingRight.current) {
        let newWidth = window.innerWidth - e.clientX;
        if (newWidth < 300) newWidth = 300;
        if (newWidth > 700) newWidth = 700;
        setRightPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      if (isDraggingLeft.current || isDraggingRight.current) {
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
      }
      isDraggingLeft.current = false;
      isDraggingRight.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Initial Data Fetch
  useEffect(() => {
    gsap.from([leftPanelRef.current, centerPanelRef.current, rightPanelRef.current], {
      x: -30,
      opacity: 0,
      stagger: 0.1,
      duration: 0.5,
      ease: "power2.out",
      clearProps: "all"
    });

    const initData = () => {
      const rawCourse = localStorage.getItem('active_canvas_course');
      if (!rawCourse) {
        if (onNavigateTo) onNavigateTo('teacher-select-course');
      } else {
        const parsed = JSON.parse(rawCourse);
        setActiveCourse({ id: parsed.id.toString(), name: parsed.name });
      }
    };
    initData();
  }, []);

  // Fetch Assignments & Discussions when course changes
  useEffect(() => {
    if (!selectedCourse) return;
    const fetchAssn = async () => {
      setLoading(l => ({ ...l, assignments: true }));
      try {
        const [assn, disc] = await Promise.all([
          canvasAPI.getAssignments(selectedCourse),
          canvasAPI.getDiscussionTopics(selectedCourse)
        ]);
        setAssignments(Array.isArray(assn) ? assn : []);
        setDiscussions(Array.isArray(disc) ? disc : []);
      } catch (err: any) {
        setErrorMsg(`Failed to load assignments: ${err.message || 'Unknown error'}`);
        console.error("Assignments fetch failed:", err);
      } finally {
        setLoading(l => ({ ...l, assignments: false }));
      }
    };
    fetchAssn();
  }, [selectedCourse]);

  // Fetch Submissions when assignment changes
  useEffect(() => {
    // Clear old grading data so we don't bleed previous assignment's scores
    setAiGradingData({});
    setSelectedStudent(null);
    setRowErrors({});
    
    if (!selectedCourse || !selectedAssignment) return;
    const isDiscussion = discussions.some(d => String(d.id) === selectedAssignment);

    const fetchSubmissions = async () => {
      setLoading(l => ({ ...l, submissions: true }));
      try {
        if (isDiscussion) {
          const entries = await canvasAPI.getDiscussionEntries(selectedCourse, selectedAssignment);
          // format entries to match student view
          const mapped = (Array.isArray(entries) ? entries : []).map((e: any) => ({
            id: String(e.user_id),
            name: e.user_name || 'Unknown Student',
            initials: (e.user_name || 'U S').substring(0, 2).toUpperCase(),
            date: e.created_at ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(e.created_at)) : 'No date',
            status: e.message ? 'Ungraded' : 'Missing',
            gradeText: 'Ungraded',
            avatarColor: 'bg-emerald-700',
            rawScore: null,
            body: e.message || ''
          }));
          setStudentsData(mapped);
        } else {
          const subs = await canvasAPI.getSubmissions(selectedCourse, selectedAssignment);
          const mapped = (Array.isArray(subs) ? subs : []).filter((s: any) => s.user).map((s: any) => ({
            id: String(s.user_id),
            name: s.user?.name || s.user?.short_name || 'Unknown Student',
            initials: (s.user?.name || s.user?.short_name || 'U S').substring(0, 2).toUpperCase(),
            date: s.submitted_at ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(s.submitted_at)) : 'Missing input',
            status: s.score !== null ? 'Graded' : (s.submitted_at ? 'Ungraded' : 'Missing'),
            gradeText: s.score !== null ? `${s.score} pts` : 'Ungraded',
            avatarColor: 'bg-blue-700',
            rawScore: s.score,
            attachments: (() => {
              let allAtts = [...(s.attachments || [])];
              // Traverse submission history to collect any past attached files if they submitted multiple times
              if (s.submission_history && Array.isArray(s.submission_history)) {
                s.submission_history.forEach((hist: any) => {
                  if (hist.attachments) {
                    hist.attachments.forEach((ha: any) => {
                      if (!allAtts.find(a => a.id === ha.id)) {
                        allAtts.push(ha);
                      }
                    });
                  }
                });
              }
              return allAtts;
            })(),
            body: (() => {
              let content = s.body || '';
              // For graded discussions, Canvas returns student responses inside discussion_entries
              if (!content && s.discussion_entries && Array.isArray(s.discussion_entries) && s.discussion_entries.length > 0) {
                 content = s.discussion_entries.map((e: any) => e.message || '').filter(Boolean).join('<hr class="my-4 border-zinc-200 dark:border-white/10" />');
              }
              // Fallback to submission_history if discussion_entries is absent but it is a text-based submission
              if (!content && s.submission_history && Array.isArray(s.submission_history) && s.submission_history.length > 0) {
                 const latestHistory = s.submission_history[s.submission_history.length - 1];
                 if (latestHistory && latestHistory.body) content = latestHistory.body;
                 else if (latestHistory && latestHistory.discussion_entries) {
                    content = latestHistory.discussion_entries.map((e: any) => e.message || '').filter(Boolean).join('<hr class="my-4 border-zinc-200 dark:border-white/10" />');
                 }
              }
              if (!content) {
                 content = s.submission_type ? `Submission type: ${s.submission_type}` : 'No submission content.';
              }
              return content;
            })()
          }));
          setStudentsData(mapped);

          // Phase 2: Upsert into supabase (Removed frontend parallel upserts to fix Supabase Rate Limiting / 400 errors)
        }
      } catch (err: any) {
        setErrorMsg(`Failed to load submissions: ${err.message || 'Unknown error'}`);
        console.error("Submissions fetch failed:", err);
      } finally {
        setLoading(l => ({ ...l, submissions: false }));
      }
    };
    fetchSubmissions();
  }, [selectedCourse, selectedAssignment, discussions]);

  // Stagger center panel rows when assignment changes
  useEffect(() => {
    if (selectedAssignment && centerRowsRef.current && !loading.submissions) {
      gsap.fromTo(centerRowsRef.current.children, 
        { y: 15, opacity: 0 },
        { y: 0, opacity: 1, stagger: 0.05, duration: 0.3, ease: "power2.out", clearProps: "all" }
      );
    }
  }, [selectedAssignment, filter, loading.submissions]);

  // Slide right panel in when student selected
  useEffect(() => {
    if (selectedStudent && rightPanelRef.current) {
      gsap.from(rightPanelRef.current, {
        x: 50,
        opacity: 0,
        duration: 0.3,
        ease: "power2.out"
      });
    }
    setActiveAttachment(null);
    setHighlightText(null);
  }, [selectedStudent]);

  const currentAuthItem = assignments.find(a => String(a.id) === selectedAssignment) || discussions.find(d => String(d.id) === selectedAssignment);
  const assignmentContextStr = currentAuthItem?.description || currentAuthItem?.message || '';


  const handleDownloadZip = async () => {
    if (!selectedAssignment || studentsData.length === 0) return;
    setIsDownloading(true);
    
    try {
      const zip = new JSZip();
      
      // Iterate through students and fetch their content
      for (const student of studentsData) {
        // Only include students who have some sort of submission or attachments
        if (student.status === 'Missing') continue;

        const studentFolder = zip.folder(student.name);
        if (!studentFolder) continue;

        // Clean out HTML tags for the text version
        const rawBodyText = student.body ? student.body.replace(/(<([^>]+)>)/gi, "\n") : "No submission text.";
        studentFolder.file(`${student.name}_submission.txt`, rawBodyText);

        // Fetch attachments
        if (student.attachments && student.attachments.length > 0) {
          for (const att of student.attachments) {
            if (att.url && att.filename) {
              try {
                const res = await fetch(att.url);
                const blob = await res.blob();
                studentFolder.file(att.filename, blob);
              } catch (err) {
                console.error(`Failed to download attachment for ${student.name}: ${att.filename}`, err);
                studentFolder.file(`${att.filename}_download_error.txt`, `Failed to download file from canvas.`);
              }
            }
          }
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const assignmentTitle = (currentAuthItem?.name || currentAuthItem?.title || 'Submissions').replace(/[^a-z0-9]/gi, '_').toLowerCase();
      saveAs(zipBlob, `${assignmentTitle}_submissions.zip`);

    } catch (err) {
      console.error("Failed to generate ZIP", err);
      alert("Failed to download ZIP file.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadSingleAttachment = async (url: string, filename: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      saveAs(blob, filename);
    } catch (err) {
      console.error(`Failed to download ${filename}`, err);
      alert(`Failed to download file from canvas.`);
    }
  };



  // Phase 3: RAG Handlers
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5557';

  // Auto-ingest when assignment is selected
  useEffect(() => {
    if (!selectedCourse || !selectedAssignment) return;

    if (ingestedAssignments.has(selectedAssignment) || ingestionPromisesRef.current[selectedAssignment]) {
      return;
    }

    const runAutoIngest = async () => {
      setIngestStatus({ type: 'loading', msg: 'Reading class materials, please wait...' });
      try {
        const currentItem = assignments.find(a => String(a.id) === selectedAssignment) || discussions.find(d => String(d.id) === selectedAssignment);
        const rubric = currentItem?.rubric || [];
        const materialText = currentItem?.description || currentItem?.message || '';

        const headers: any = { 'Content-Type': 'application/json' };
        const customGeminiKey = localStorage.getItem('custom_gemini_api_key');
        if (customGeminiKey) {
          headers['X-Gemini-Api-Key'] = customGeminiKey;
        }

        await fetch(`${API_BASE_URL}/api/ingest`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            assignment_id: selectedAssignment,
            course_material_text: materialText,
            rubric_criteria: rubric.map((r: any) => ({
              criterion_id: r.id || r.description,
              title: r.description,
              description: r.long_description || r.description,
              max_score: r.points,
              dimension: 'content' // default
            })),
            exemplars: []
          })
        });

        const files = await canvasAPI.getCourseFiles(selectedCourse);
        const { phaseA, phaseB } = selectPhaseFiles(
          Array.isArray(files) ? files as CanvasCourseFile[] : [],
          currentItem?.name || currentItem?.title || '',
          5
        );

        const ingestFile = async (file: CanvasCourseFile) => {
          const payload = {
            assignment_id: selectedAssignment,
            course_id: selectedCourse,
            url: file.url,
            filename: file.display_name,
            canvas_file_id: String(file.id),
            updated_at: file.updated_at || file.created_at || '',
            canvas_token: localStorage.getItem('custom_canvas_token') || ''
          };

          const fileHeaders: any = { 'Content-Type': 'application/json' };
          if (customGeminiKey) {
            fileHeaders['X-Gemini-Api-Key'] = customGeminiKey;
          }

          const res = await fetch(`${API_BASE_URL}/api/ingest/canvas-url`, {
            method: 'POST',
            headers: fileHeaders,
            body: JSON.stringify(payload)
          });
          if (!res.ok) {
            throw new Error(await res.text());
          }
        };

        for (const file of phaseA) {
          try {
            await ingestFile(file);
            await new Promise(r => setTimeout(r, 800));
          } catch (e) {
            console.error(`Failed to ingest course file: ${file.display_name}`, e);
          }
        }

        setIngestedAssignments(prev => new Set(prev).add(selectedAssignment));
        setIngestStatus({ type: 'success', msg: 'Materials auto-ingested' });

        if (phaseB.length > 0) {
          void (async () => {
            setBackgroundIndexing(true);
            setIngestStatus({ type: 'loading', msg: 'Indexing more materials in background...' });
            for (const file of phaseB) {
              try {
                await ingestFile(file);
                await new Promise(r => setTimeout(r, 400));
              } catch (e) {
                console.error(`Background ingest failed: ${file.display_name}`, e);
              }
            }
            setBackgroundIndexing(false);
            setIngestStatus({ type: 'success', msg: 'Materials auto-ingested' });
            setTimeout(() => setIngestStatus(null), 5000);
          })();
        } else {
          setTimeout(() => setIngestStatus(null), 5000);
        }
      } catch (err: any) {
        console.error(`Auto-ingestion failed:`, err);
        setIngestStatus({ type: 'error', msg: `Auto-ingestion failed: ${err.message}` });
      }
    };

    const promise = runAutoIngest();
    ingestionPromisesRef.current[selectedAssignment] = promise;
  }, [selectedAssignment, selectedCourse, assignments, discussions]);

  const handleFetchAiGrade = async (studentId: string, isRetry = false) => {
    const student = studentsData.find(s => s.id === studentId);
    if (!student) return;

    setLoadingStudents(prev => new Set(prev).add(studentId));
    setRowErrors(prev => { const n = { ...prev }; delete n[studentId]; return n; });
    
    try {
      // Wait for auto-ingest to finish if it's currently running for this assignment
      if (ingestionPromisesRef.current[selectedAssignment!]) {
        try {
          setIngestingStudents(prev => new Set(prev).add(studentId));
          await ingestionPromisesRef.current[selectedAssignment!];
        } catch(e) {} finally {
          setIngestingStudents(prev => { const n = new Set(prev); n.delete(studentId); return n; });
        }
      }

      const submissionTextForAnalysis = student.body ? String(student.body).replace(/(<([^>]+)>)/gi, "") : "";
      const hfText = submissionTextForAnalysis.substring(0, 1500);

      const backendReq = async () => {
        let body: any;
        let headers: any = {};
        const customGeminiKey = localStorage.getItem('custom_gemini_api_key');
        if (customGeminiKey) {
          headers['X-Gemini-Api-Key'] = customGeminiKey;
        }

        if (student.attachments && student.attachments.length > 0) {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify({
            assignment_id: selectedAssignment,
            course_id: selectedCourse,
            student_id: studentId,
            submission_text: student.body || '',
            file_urls: student.attachments.map((a: any) => ({ url: a.url, filename: a.filename }))
          });
        } else {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify({
            assignment_id: selectedAssignment,
            course_id: selectedCourse,
            student_id: studentId,
            submission_text: student.body || ''
          });
        }

        const res = await fetch(`${API_BASE_URL}/api/grade`, {
          method: 'POST',
          headers,
          body
        });

        const data = await res.json();
        if (!res.ok) {
          if (data.error === "DATABASE_DIMENSION_MISMATCH") {
             throw new Error(`Database Error: ${data.details}`);
          }
          if (res.status === 429 || String(data.error || '').toLowerCase().includes('quota')) {
             throw new Error(data.error || "Gemini API quota exceeded. Wait a moment and retry.");
          }
          throw new Error(data.error || data.details || "Grading failed");
        }
        
        if (data.rubric_missing) {
           if (isRetry) {
              throw new Error("No rubric exists for this assignment.");
           }
           setIngestStatus({ type: 'error', msg: 'AI has no rubric. Attempting background ingestion again...' });
           // Could retry autoingest here if needed, but it should have run.
           throw new Error("RUBRIC_MISSING_RETRY");
        }
        return data;
      };

      const linguisticReq = async () => {
          try {
             const { analyzeSubmission } = await import('../../grader/linguistic_analyzer');
             const apiKey = localStorage.getItem('custom_gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY || '';
             const profile = await analyzeSubmission(submissionTextForAnalysis, "", "", apiKey);
             return profile;
         } catch(e) {
            console.error("Linguistic profile failed", e);
            return undefined;
         }
      };

      const integrityReq = async () => {
         try {
            const hfToken = import.meta.env.VITE_HUGGINGFACE_TOKEN || ''; 
            const hfRes = await fetch('https://api-inference.huggingface.co/models/roberta-base-openai-detector', {
               method: 'POST',
               headers: {
                 'Content-Type': 'application/json',
                 ...(hfToken ? { 'Authorization': `Bearer ${hfToken}` } : {})
               },
               body: JSON.stringify({ inputs: hfText })
            });
            const hfData = await hfRes.json();
            
            let fakeProb = 0;
            if (Array.isArray(hfData) && Array.isArray(hfData[0])) {
               const fakeEntry = hfData[0].find((l: any) => l.label === "Fake");
               if (fakeEntry) fakeProb = fakeEntry.score;
            } else if (Array.isArray(hfData) && hfData[0]?.label) {
               const fakeEntry = hfData.find((l: any) => l.label === "Fake");
               if (fakeEntry) fakeProb = fakeEntry.score;
            }
            
            let risk = "Low";
            if (fakeProb > 0.8) risk = "High";
            else if (fakeProb > 0.4) risk = "Medium";
            
            return {
               ai_authorship_probability: fakeProb,
               plagiarism_risk: risk,
               integrity_flags: fakeProb > 0.5 ? ["High likelihood of AI generation"] : []
            };
         } catch(e) {
            console.error("Integrity check failed", e);
            return undefined;
         }
      };

      const [backendData, linguisticProfile, integrityEvaluation] = await Promise.all([
          backendReq(),
          linguisticReq(),
          integrityReq()
      ]);

      const finalData = { ...backendData, linguisticProfile };
      if (integrityEvaluation) {
         finalData.integrityEvaluation = integrityEvaluation;
      }

      setAiGradingData(prev => ({ ...prev, [studentId]: finalData }));
      setSelectedStudent(studentId);
    } catch (err: any) {
      if (err.message === "RUBRIC_MISSING_RETRY") {
          return handleFetchAiGrade(studentId, true); 
      }
      setRowErrors(prev => ({ ...prev, [studentId]: err.message }));
    } finally {
      setLoadingStudents(prev => {
        const next = new Set(prev);
        next.delete(studentId);
        return next;
      });
    }
  };

  const totalUngraded = studentsData.filter(s => s.status === 'Ungraded').length;

  const visibleStudents = studentsData.filter(s => {
    if (filter !== 'All' && s.status !== filter) return false;
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    if (sortOrder === 'NameASC') {
      return a.name.localeCompare(b.name);
    } else if (sortOrder === 'UID') {
      return a.id.localeCompare(b.id);
    } else if (sortOrder === 'GradeASC') {
      const scoreA = a.rawScore ?? Infinity;
      const scoreB = b.rawScore ?? Infinity;
      return scoreA - scoreB;
    }
    return 0; // Default
  });

  // Combine and sort Side items
  const combinedItems = [
    ...assignments.map(a => ({
      id: String(a.id),
      title: a.name,
      dateStr: a.due_at,
      date: a.due_at ? new Date(a.due_at) : null,
      type: (a.is_quiz_assignment || (a.submission_types && a.submission_types.includes('online_quiz'))) ? 'Quizzes' : 
            ((a.submission_types && a.submission_types.includes('discussion_topic')) || (a.name && a.name.toLowerCase().includes('discussion'))) ? 'Discussions' : 
            'Assignments'
    })),
    ...discussions.map(d => ({
      id: String(d.id),
      title: d.title,
      dateStr: d.posted_at || d.created_at,
      date: (d.posted_at || d.created_at) ? new Date(d.posted_at || d.created_at) : null,
      type: 'Discussions'
    }))
  ];

  const filteredSideItems = combinedItems
    .filter(item => sideFilterType === 'All' || item.type === sideFilterType)
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return sideSortOrder === 'Newest' ? b.date.getTime() - a.date.getTime() : a.date.getTime() - b.date.getTime();
    });

  return (
    <>
      <div className="flex w-full h-screen bg-[#F8FAFC] dark:bg-[#020617] text-zinc-900 dark:text-zinc-100 font-['Plus_Jakarta_Sans'] overflow-hidden">

      {/* LEFT PANEL */}
      <div 
        ref={leftPanelRef} 
        style={{ width: `${leftPanelWidth}px`, display: selectedStudent ? 'none' : 'flex' }}
        className="shrink-0 bg-[#0F172A] text-white flex flex-col h-full border-r border-[#1E293B] relative"
      >
        {/* Header */}
        <div className="p-5 border-b border-[#1E293B] shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              {onBack && <button onClick={onBack} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">←</button>}
              <h1 className="text-xl font-bold font-['Space_Grotesk'] text-white">Evaluation Nexus</h1>
            </div>
            {onNavigateTo && (
               <button 
                 onClick={() => onNavigateTo('teacher-select-course')}
                 className="p-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-lg transition-colors border border-indigo-500/20"
                 title="Switch Course"
               >
                 <Icons.IconChart className="w-4 h-4" />
               </button>
            )}
          </div>
          <div className="bg-[#1E293B] border border-zinc-700 text-xs text-zinc-300 rounded px-3 py-2 flex items-center justify-between">
            <span className="font-bold truncate text-[10px] tracking-widest">{activeCourse?.name || 'Loading Course...'}</span>
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
          </div>
        </div>

        {/* Scrollable List */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col min-h-0">
          
          {/* Side Filters */}
          <div className="mb-4 space-y-2 shrink-0">
             <div className="flex gap-2">
               <select 
                 value={sideFilterType} 
                 onChange={e => setSideFilterType(e.target.value as any)}
                 className="flex-1 bg-[#1E293B] border border-zinc-700 text-xs text-zinc-300 rounded px-2 py-1.5 outline-none appearance-none cursor-pointer"
               >
                 <option value="All">All Types</option>
                 <option value="Assignments">Assignments</option>
                 <option value="Quizzes">Quizzes</option>
                 <option value="Discussions">Discussions</option>
               </select>

               <select 
                 value={sideSortOrder} 
                 onChange={e => setSideSortOrder(e.target.value as any)}
                 className="flex-1 bg-[#1E293B] border border-zinc-700 text-xs text-zinc-300 rounded px-2 py-1.5 outline-none appearance-none cursor-pointer"
               >
                 <option value="Newest">Newest First</option>
                 <option value="Oldest">Oldest First</option>
               </select>
             </div>
          </div>

          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-xs font-bold text-center mb-4 shrink-0">
              {errorMsg} <br /> <button onClick={() => window.location.reload()} className="underline mt-1">Retry</button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-1 pb-4">
            {loading.assignments ? (
              <div className="space-y-3 px-2">
                {[1, 2, 3].map(i => <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse"></div>)}
              </div>
            ) : (
                <>
                  {filteredSideItems.map(item => (
                    <div
                      key={item.id}
                      onClick={() => { setSelectedAssignment(item.id); setSelectedStudent(null); }}
                      className={`w-full text-left p-3 rounded-lg flex flex-col justify-center transition-all cursor-pointer border 
                      ${selectedAssignment === item.id ? 'bg-[#1E293B] border-purple-500/20' : 'hover:bg-white/5 border-transparent'}`}
                    >
                      <div className="flex items-start justify-between">
                         <div className="font-bold text-sm text-zinc-200 line-clamp-2 mb-1 flex-1 pr-2">{item.title}</div>
                         <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full mt-0.5 shrink-0
                            ${item.type === 'Quizzes' ? 'bg-orange-500/20 text-orange-400' : 
                              item.type === 'Discussions' ? 'bg-blue-500/20 text-blue-400' : 
                              'bg-zinc-700 text-zinc-300'}`}
                         >
                           {item.type === 'Quizzes' ? 'Quiz' : item.type === 'Discussions' ? 'Discussion' : 'Assignment'}
                         </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-zinc-500 font-medium">
                          {item.dateStr ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(item.dateStr)) : 'No Date'}
                        </span>
                      </div>
                    </div>
                  ))}
                  {filteredSideItems.length === 0 && <div className="text-xs text-zinc-500 italic ml-2 mt-4">No items match filters</div>}
                </>
            )}
          </div>
        </div>

        {/* Bottom Stats */}
        <div className="p-4 border-t border-[#1E293B] shrink-0 text-center">
          <div className="text-sm font-medium text-zinc-300">
            <span className={`font-bold ${totalUngraded > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{totalUngraded}</span> ungraded for this assignment
          </div>
        </div>
      </div>

      {/* DRAG HANDLE 1 */}
      <div 
        style={{ display: selectedStudent ? 'none' : 'block' }}
        className="w-1.5 bg-transparent hover:bg-indigo-500/50 cursor-col-resize z-50 transition-colors"
        onMouseDown={(e) => {
           e.preventDefault();
           isDraggingLeft.current = true;
           document.body.style.cursor = 'col-resize';
           document.body.style.userSelect = 'none';
        }}
      />

      {/* CENTER PANEL */}
      <div 
        ref={centerPanelRef} 
        style={{ display: selectedStudent ? 'none' : 'flex' }}
        className="flex-1 bg-zinc-50 dark:bg-[#0B1120] flex flex-col min-w-0 border-r border-zinc-200 dark:border-white/5"
      >
        {!selectedAssignment ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-zinc-500 dark:text-zinc-400 font-bold">Select an assignment to view submissions</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-6 bg-white dark:bg-[#0F172A] border-b border-zinc-200 dark:border-white/5 shrink-0">
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                <h2 className="text-xl font-bold font-['Space_Grotesk'] truncate flex-1 min-w-0 pr-4">
                  {assignments.find(a => String(a.id) === selectedAssignment)?.name || discussions.find(d => String(d.id) === selectedAssignment)?.title || "Reviewing Submissions"}
                </h2>
                <div className="flex space-x-3 shrink-0 items-center">

                  <button 
                    onClick={handleDownloadZip}
                    disabled={isDownloading || studentsData.length === 0}
                    className="px-4 py-2 border border-zinc-300 dark:border-white/10 rounded-lg text-xs font-bold hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                  >
                    {isDownloading ? (
                      <><span className="w-3 h-3 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin mr-2"></span> Downloading...</>
                    ) : (
                      "Download All as ZIP"
                    )}
                  </button>
                </div>
              </div>

              {ingestStatus && (
                <div className={`mt-4 p-3 rounded-lg text-sm font-bold flex items-center shadow-sm
                  ${ingestStatus.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' :
                    ingestStatus.type === 'loading' ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20 animate-pulse' :
                    'bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'}`}
                >
                  {ingestStatus.type === 'loading' && (
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-3"></div>
                  )}
                  {ingestStatus.type === 'success' && <Icons.IconCheck className="w-5 h-5 mr-2" />}
                  {ingestStatus.type === 'error' && <Icons.IconX className="w-5 h-5 mr-2" />}
                  {ingestStatus.msg}
                </div>
              )}

              <div className="flex items-center justify-between mt-6">
                <div className="flex items-center space-x-3">
                  <div className="flex bg-zinc-100 dark:bg-white/5 p-2 rounded-lg">
                    {(['All', 'Ungraded', 'Graded', 'Missing'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all 
                          ${filter === f ? 'bg-white dark:bg-white/10 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'}`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>

                  <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as any)}
                    className="bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="Default">Default Sort</option>
                    <option value="NameASC">Sort by Name (A-Z)</option>
                    <option value="UID">Sort by U-ID</option>
                    <option value="GradeASC">Sort by Grade (Lowest)</option>
                  </select>
                </div>

                <div className="flex items-center bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-3 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 w-64">
                  <svg className="w-4 h-4 text-zinc-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  <input
                    type="text"
                    placeholder="Search students..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-2 pr-4 py-2 bg-transparent text-sm outline-none w-full placeholder:text-zinc-500"
                  />
                </div>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2" ref={centerRowsRef}>
              {loading.submissions ? (
                <div className="space-y-4 px-2 py-4">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="flex items-center space-x-4">
                      <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-white/5 animate-pulse"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-zinc-200 dark:bg-white/5 rounded animate-pulse w-32"></div>
                        <div className="h-3 bg-zinc-200 dark:bg-white/5 rounded animate-pulse w-48"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {visibleStudents.map(student => (
                    <div
                      key={student.id}
                      onClick={() => setSelectedStudent(student.id)}
                      className={`w-full text-left p-4 rounded-xl border flex items-center justify-between transition-all group cursor-pointer
                          ${selectedStudent === student.id ? 'bg-white dark:bg-[#0F172A] border-purple-500 shadow-md transform -translate-y-0.5' : 'bg-white dark:bg-[#0B1120] border-zinc-200 dark:border-white/5 hover:shadow-md hover:-translate-y-0.5'}`}
                    >
                      <div className="flex items-center space-x-4 min-w-0 pr-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0 ${student.avatarColor}`}>
                          {student.initials}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-zinc-900 dark:text-white truncate">{student.name}</div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center space-x-2 mt-0.5">
                            <span>{student.date}</span>
                            <span className="hidden sm:inline w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700"></span>
                            <span className="hidden sm:inline italic truncate">"{student.body ? String(student.body).replace(/(<([^>]+)>)/gi, "").substring(0, 60) + (String(student.body).length > 60 ? '...' : '') : 'No preview'}"</span>
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center space-x-4">
                        {/* Per-Submission Grade Trigger */}
                        <div className="flex flex-col items-end">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFetchAiGrade(student.id); }}
                            disabled={loadingStudents.has(student.id)}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
                          >
                            {loadingStudents.has(student.id) ? (
                              ingestingStudents.has(student.id) ? (
                                <span className="flex items-center"><div className="w-2 h-2 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1.5"></div> Reading class materials, please wait...</span>
                              ) : backgroundIndexing ? (
                                <span className="flex items-center"><div className="w-2 h-2 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1.5"></div> Indexing more materials in background...</span>
                              ) : (
                                <span className="flex items-center"><div className="w-2 h-2 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1.5"></div> Grading...</span>
                              )
                            ) : (
                              "Grade with AI ✨"
                            )}
                          </button>
                          {rowErrors[student.id] && (
                            <span className="text-xs font-bold text-red-500 mt-1 max-w-[120px] truncate">
                              {rowErrors[student.id]}
                            </span>
                          )}
                        </div>

                        <span className={`px-2.5 py-1 rounded-full text-xs font-black
                              ${student.status === 'Graded' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' :
                            student.status === 'Ungraded' ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400' :
                              'bg-zinc-200 text-zinc-700 dark:bg-white/10 dark:text-zinc-400'}`}
                        >
                          {student.status === 'Graded' ? student.gradeText : student.status}
                        </span>
                      </div>
                    </div>
                  ))}
                  {visibleStudents.length === 0 && (
                    <div className="text-center p-10 text-zinc-500 font-medium">No students match the current filters.</div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* RIGHT PANEL */}
      <div 
        style={{ display: selectedStudent ? 'flex' : 'none' }}
        className="flex-1 flex flex-col relative z-10 shadow-[-10px_0_30px_rgba(0,0,0,0.02)] overflow-x-hidden"
      >
        {!selectedStudent ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] p-8 text-center">
            <div className="w-16 h-16 bg-zinc-200 dark:bg-white/5 rounded-full mb-4 flex items-center justify-center">
              <Icons.IconUsers className="w-8 h-8 opacity-50" />
            </div>
            <div className="font-bold">Select a student to begin grading</div>
          </div>
        ) : (
          <RightPanelErrorBoundary>
            {(() => {
              const student = studentsData.find(s => s.id === selectedStudent);
              if (!student) return <div className="p-8 text-zinc-500 italic">Student not found</div>;
              
              let scoreText = "RUBRIC";
              const gradingResult = aiGradingData[selectedStudent!];
              const item = currentAuthItem;
              if (gradingResult && gradingResult.criteria_verdicts && item?.rubric) {
                 let totalEarned = 0;
                 let totalPossible = 0;
                 
                 item.rubric.forEach((crit: any) => {
                    totalPossible += crit.points || 0;
                    const verdict = gradingResult.criteria_verdicts.find((v: any) => 
                        v.criterion_id === crit.id || 
                        v.criterion_name === crit.description || 
                        v.title === crit.description ||
                        (crit.id && v.criterion_id && String(v.criterion_id).includes(String(crit.id)))
                    );
                    if (verdict) {
                       totalEarned += verdict.score || 0;
                    }
                 });
                 
                 if (totalPossible > 0) {
                    scoreText = `RUBRIC (${totalEarned}/${totalPossible})`;
                 }
              }
              
              return (
                <div className="flex flex-col h-full w-full">
                  {/* TOP BAR */}
                  <div className="px-6 py-4 border-b border-zinc-200 dark:border-white/5 bg-white dark:bg-[#0F172A] flex items-center justify-between shrink-0 z-20">
                    <div className="flex items-center space-x-6">
                      <button 
                        onClick={() => setSelectedStudent(null)} 
                        className="p-2 bg-zinc-100 dark:bg-white/5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white rounded-lg transition-colors border border-transparent hover:border-zinc-200 dark:hover:border-white/10"
                        title="Back to Students"
                      >
                        <Icons.IconArrowLeft className="w-5 h-5" />
                      </button>
                      <div className="flex items-center space-x-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0 ${student.avatarColor || 'bg-indigo-600'} shadow-lg shadow-indigo-500/10`}>
                          {student.initials}
                        </div>
                        <div>
                          <h2 className="text-lg font-bold font-['Space_Grotesk'] text-zinc-900 dark:text-white leading-tight">{typeof student.name === 'string' ? student.name : JSON.stringify(student.name)}</h2>
                          <div className="text-[10px] uppercase tracking-widest font-black text-[var(--text-muted)] mt-0.5">STUDENT SUBMISSION</div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center bg-zinc-100 dark:bg-white/5 p-2 rounded-xl">
                        <button 
                          onClick={() => setShowAssignmentContext(!showAssignmentContext)}
                          className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${showAssignmentContext ? 'bg-white dark:bg-white/10 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700'}`}
                        >
                          CONTEXT
                        </button>
                        <button 
                          onClick={() => setShowLearningProfile(!showLearningProfile)}
                          className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${showLearningProfile ? 'bg-white dark:bg-white/10 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700'}`}
                          title="Learning Profile"
                        >
                          PROFILE
                        </button>
                        <button 
                          onClick={() => setShowRubricContext(!showRubricContext)}
                          className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${showRubricContext ? 'bg-white dark:bg-white/10 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700'}`}
                          title="Official Rubric"
                        >
                          {scoreText}
                        </button>
                      </div>

                      <div className="h-6 w-px bg-zinc-200 dark:bg-white/10 mx-2"></div>

                      <button 
                        onClick={() => setIsGradingSidebarCollapsed(!isGradingSidebarCollapsed)}
                        className="p-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl transition-all border border-indigo-500/20 group"
                        title={isGradingSidebarCollapsed ? "Expand Grading Panel" : "Collapse Grading Panel"}
                      >
                        <Icons.IconList className={`w-5 h-5 transition-transform duration-300 ${isGradingSidebarCollapsed ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* MAIN CONTENT AREA */}
                  <div ref={rightPanelRef} className="flex-1 overflow-hidden flex w-full relative">
                    
                    {/* LEFT SECTION: DOCUMENT VIEWER */}
                    <div className="flex-1 h-full bg-[#F8FAFC] dark:bg-[#020617] flex flex-col items-center overflow-y-auto scrollbar-hide p-4 sm:p-8 relative">
                      
                      {/* Context Overlay (Collapsible) */}
                      {showAssignmentContext && (
                        <div className="absolute top-8 left-8 right-8 z-30 animate-in slide-in-from-top-4 fade-in duration-300">
                          <div className="bg-white/90 dark:bg-[#0F172A]/90 backdrop-blur-md rounded-2xl border border-[var(--brand-primary)]/20 shadow-2xl overflow-hidden max-h-[400px] flex flex-col">
                            <div className="p-4 border-b border-[var(--brand-primary)]/10 flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <Icons.IconFile className="w-4 h-4 text-[var(--brand-primary)]" />
                                <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--brand-primary)]">Assignment Context</h3>
                              </div>
                              <button onClick={() => setShowAssignmentContext(false)} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-full transition-colors">
                                <Icons.IconX className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div 
                              className="p-6 overflow-y-auto prose dark:prose-invert prose-sm max-w-none text-zinc-700 dark:text-zinc-300"
                              dangerouslySetInnerHTML={{ 
                                __html: (() => {
                                  const item = assignments.find(a => String(a.id) === selectedAssignment) || discussions.find(d => String(d.id) === selectedAssignment);
                                  let htmlStr = item?.description || item?.message || '<div class="text-zinc-500 italic">No additional context provided.</div>';
                                  htmlStr = typeof htmlStr === 'string' ? htmlStr : JSON.stringify(htmlStr);
                                  htmlStr = htmlStr.replace(/style="[^"]*"/gi, "");
                                  htmlStr = htmlStr.replace(/style='[^']*'/gi, "");
                                  return htmlStr;
                                })() 
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Learning Profile Overlay */}
                      {showLearningProfile && (
                        <div className="absolute top-8 left-8 right-8 z-30 animate-in slide-in-from-top-4 fade-in duration-300">
                          <div className="bg-white/90 dark:bg-[#0F172A]/90 backdrop-blur-md rounded-2xl border border-[var(--brand-secondary)]/20 shadow-2xl overflow-hidden max-h-[420px] flex flex-col">
                            <div className="p-4 border-b border-[var(--brand-secondary)]/10 flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <Icons.IconUsers className="w-4 h-4 text-[var(--brand-secondary)]" />
                                <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--brand-secondary)]">Learning Profile</h3>
                              </div>
                              <button onClick={() => setShowLearningProfile(false)} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-full transition-colors">
                                <Icons.IconX className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="p-6 overflow-y-auto space-y-4">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="bg-purple-50 dark:bg-purple-500/5 border border-purple-100 dark:border-purple-500/10 rounded-xl p-3">
                                  <div className="text-[9px] font-black text-purple-500 uppercase tracking-widest mb-1">Materials Viewed</div>
                                  <div className="text-lg font-black text-zinc-900 dark:text-white">{MOCK_LEARNING_PROFILE.materialsViewed}</div>
                                </div>
                                <div className="bg-blue-50 dark:bg-blue-500/5 border border-blue-100 dark:border-blue-500/10 rounded-xl p-3">
                                  <div className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-1">Discussion Posts</div>
                                  <div className="text-lg font-black text-zinc-900 dark:text-white">{MOCK_LEARNING_PROFILE.discussionPosts}</div>
                                </div>
                                <div className="bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-100 dark:border-emerald-500/10 rounded-xl p-3">
                                  <div className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-1">Assignments Done</div>
                                  <div className="text-lg font-black text-zinc-900 dark:text-white">{MOCK_LEARNING_PROFILE.assignmentCompletion}</div>
                                </div>
                                <div className="bg-amber-50 dark:bg-amber-500/5 border border-amber-100 dark:border-amber-500/10 rounded-xl p-3">
                                  <div className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1">Last Active</div>
                                  <div className="text-lg font-black text-zinc-900 dark:text-white">{MOCK_LEARNING_PROFILE.lastActive}</div>
                                </div>
                              </div>
                              <div className="bg-zinc-50 dark:bg-white/5 border border-zinc-100 dark:border-white/10 rounded-xl p-4">
                                <div className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1">Most Active Topic</div>
                                <div className="text-sm font-bold text-zinc-700 dark:text-zinc-300">{MOCK_LEARNING_PROFILE.mostActiveTopic}</div>
                              </div>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-widest">Completion Rate</div>
                                  <div className="text-xs font-black text-[var(--brand-primary)]">{MOCK_LEARNING_PROFILE.completionRate}%</div>
                                </div>
                                <div className="h-2 w-full bg-zinc-100 dark:bg-white/5 rounded-full overflow-hidden">
                                  <div className="h-full bg-gradient-to-r from-[var(--brand-primary)] to-[var(--brand-secondary)] rounded-full transition-all duration-1000" style={{ width: `${MOCK_LEARNING_PROFILE.completionRate}%` }}></div>
                                </div>
                              </div>
                              <div className="bg-indigo-50 dark:bg-indigo-500/5 border border-indigo-100 dark:border-indigo-500/10 rounded-xl p-4">
                                <div className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1">Background Note</div>
                                <div className="text-xs text-zinc-600 dark:text-zinc-400 font-medium italic leading-relaxed">"{MOCK_LEARNING_PROFILE.backgroundNote}"</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Rubric Overlay */}
                      {showRubricContext && (
                        <div className="absolute top-8 left-8 right-8 z-30 animate-in slide-in-from-top-4 fade-in duration-300">
                          <div className="bg-white/90 dark:bg-[#0F172A]/90 backdrop-blur-md rounded-2xl border border-[var(--brand-primary)]/20 shadow-2xl overflow-hidden max-h-[420px] flex flex-col">
                            <div className="p-4 border-b border-[var(--brand-primary)]/10 flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <Icons.IconList className="w-4 h-4 text-[var(--brand-primary)]" />
                                <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--brand-primary)]">Official Rubric</h3>
                              </div>
                              <button onClick={() => setShowRubricContext(false)} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-full transition-colors">
                                <Icons.IconX className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="p-6 overflow-y-auto space-y-4">
                              {(() => {
                                const item = assignments.find(a => String(a.id) === selectedAssignment) || discussions.find(d => String(d.id) === selectedAssignment);
                                if (!item?.rubric || item.rubric.length === 0) {
                                  return <div className="text-zinc-500 italic">No rubric attached to this assignment.</div>;
                                }
                                const gradingResult = aiGradingData[selectedStudent!];
                                return (
                                  <div className="space-y-4">
                                    {item.rubric.map((crit: any) => {
                                      const verdict = gradingResult?.criteria_verdicts?.find((v: any) => 
                                        v.criterion_id === crit.id || 
                                        v.criterion_name === crit.description || 
                                        v.title === crit.description ||
                                        (crit.id && v.criterion_id && String(v.criterion_id).includes(String(crit.id)))
                                      );

                                      return (
                                        <div key={crit.id} className="bg-zinc-50 dark:bg-white/5 border border-zinc-100 dark:border-white/10 rounded-xl p-4 transition-all duration-300 hover:border-zinc-200 dark:hover:border-white/20 shadow-sm">
                                          <div className="flex justify-between items-start mb-2">
                                            <h4 className="text-sm font-bold text-zinc-900 dark:text-white">{crit.description}</h4>
                                            {verdict ? (
                                              <span className={`text-xs font-black px-2 py-1 rounded-md ${verdict.score === crit.points ? 'text-emerald-600 bg-emerald-500/10' : verdict.score > 0 ? 'text-amber-600 bg-amber-500/10' : 'text-rose-600 bg-rose-500/10'}`}>
                                                {verdict.score} / {crit.points} PTS
                                              </span>
                                            ) : (
                                              <span className="text-xs font-black text-indigo-500 bg-indigo-500/10 px-2 py-1 rounded-md">{crit.points} PTS</span>
                                            )}
                                          </div>
                                          <div className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed mb-3">{crit.long_description || "No detailed description provided."}</div>
                                          
                                          {crit.ratings && crit.ratings.length > 0 && (
                                            <div className="flex flex-col sm:flex-row gap-3 mb-4 mt-2 w-full">
                                              {(() => {
                                                const sorted = [...crit.ratings].sort((a, b) => b.points - a.points);
                                                return sorted.map((rating: any, rIdx: number) => {
                                                  const isTop = rIdx === 0;
                                                  const isBottom = rIdx === sorted.length - 1 && sorted.length > 1;
                                                  
                                                  let isSelected = false;
                                                  if (verdict) {
                                                    const nextRating = sorted[rIdx - 1]; // higher points
                                                    if (isTop && verdict.score >= rating.points) {
                                                        isSelected = true;
                                                    } else if (isBottom && verdict.score <= rating.points) {
                                                        isSelected = true;
                                                    } else if (verdict.score >= rating.points && (!nextRating || verdict.score < nextRating.points)) {
                                                        isSelected = true;
                                                    }
                                                  }

                                                  let borderAccentColor = 'border-amber-500/40 dark:border-amber-500/20';
                                                  let textColor = 'text-amber-700 dark:text-amber-300';
                                                  
                                                  if (isTop) {
                                                    borderAccentColor = 'border-emerald-500/40 dark:border-emerald-500/20';
                                                    textColor = 'text-emerald-700 dark:text-emerald-300';
                                                  } else if (isBottom) {
                                                    borderAccentColor = 'border-rose-500/40 dark:border-rose-500/20';
                                                    textColor = 'text-rose-700 dark:text-rose-300';
                                                  }
                                                  
                                                  const activeClass = !verdict 
                                                    ? 'opacity-100 border border-dashed rounded-xl' 
                                                    : (isSelected 
                                                        ? 'opacity-100 border-2 border-solid font-bold scale-[1.02] z-10 rounded-xl' 
                                                        : 'opacity-40 grayscale scale-95 border border-dashed rounded-xl');

                                                  return (
                                                    <div key={rIdx} className={`flex-1 flex flex-col relative px-3 py-2 transition-all duration-300 ${borderAccentColor} ${textColor} ${activeClass}`}>
                                                      {isSelected && (
                                                        <div className="absolute top-2 right-2 w-4 h-4 bg-indigo-600 rounded-full flex items-center justify-center shadow-md">
                                                          <Icons.IconCheck className="w-2.5 h-2.5 text-white" />
                                                        </div>
                                                      )}
                                                      <span className="text-[11px] font-bold mb-1 leading-tight">{rating.description}</span>
                                                      <span className="text-[10px] font-black opacity-80 mb-2">{rating.points} pts</span>
                                                      {rating.long_description && <span className="text-[9px] opacity-75 leading-relaxed line-clamp-4" title={rating.long_description}>{rating.long_description}</span>}
                                                    </div>
                                                  );
                                                });
                                              })()}
                                            </div>
                                          )}
                                          
                                          {verdict && (
                                            <div className="mt-4 space-y-3 pt-3 border-t border-zinc-200 dark:border-white/10 animate-in fade-in slide-in-from-top-2 duration-300">
                                              <div className="space-y-1">
                                                <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500 flex items-center">
                                                  <Icons.IconCheck className="w-3 h-3 mr-1 text-emerald-500" /> Explanation
                                                </div>
                                                <div className="text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed pl-3 border-l-2 border-indigo-500/30 py-1">
                                                  {verdict.justification}
                                                </div>
                                              </div>
                                              <div className="space-y-1">
                                                <div className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)] flex items-center mb-1">
                                                  <Icons.IconFile className="w-3 h-3 mr-1 text-[var(--brand-primary)]" /> Anchor Text
                                                </div>
                                                <div className={`pl-3 border-l-2 text-xs italic py-1 ${verdict.evidence_anchor === 'not found' ? 'border-rose-300 text-rose-600 dark:text-rose-400' : 'border-[var(--brand-primary)]/30 text-[var(--text-primary)]'}`}>
                                                  {verdict.evidence_anchor === 'not found' ? 'No evidence found in submission.' : `"${verdict.evidence_anchor}"`}
                                                </div>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="w-full max-w-5xl bg-white dark:bg-[#0F172A] rounded-2xl border border-zinc-200 dark:border-white/5 shadow-2xl shadow-black/5 overflow-hidden flex flex-col min-h-[600px] transition-all duration-500 p-2">


                        {/* MAIN VIEWER AREA */}
                        <div className="flex-1 flex flex-col min-w-0">
                          {student.attachments && student.attachments.length > 0 ? (
                            (() => {
                              const att = activeAttachment || student.attachments[0];
                              return (
                                <UniversalPreviewer 
                                  url={att.url} 
                                  filename={att.filename} 
                                  onDownload={() => handleDownloadSingleAttachment(att.url, att.filename)}
                                  highlightText={highlightText}
                                />
                              );
                            })()
                          ) : student.body ? (
                            <div className="h-full bg-white dark:bg-[#0F172A] p-12 overflow-y-auto prose dark:prose-invert max-w-none text-zinc-800 dark:text-zinc-200" 
                                dangerouslySetInnerHTML={{ 
                                  __html: (() => {
                                    let content = typeof student.body === 'string' ? student.body : JSON.stringify(student.body);
                                    if (highlightText) {
                                      const words = highlightText.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                                      if (words.length > 0) {
                                        const fuzzyPattern = words.join('(?:\\s|&nbsp;|<[^>]+>)+');
                                        try {
                                          const regex = new RegExp(`(${fuzzyPattern})`, 'gi');
                                          if (regex.test(content)) {
                                            content = content.replace(regex, '<mark id="evidence-anchor-highlight" class="bg-[var(--brand-primary)]/10 dark:bg-[var(--brand-primary)]/30 text-inherit px-1 rounded transition-all duration-500">$1</mark>');
                                            setTimeout(() => {
                                              const mark = document.getElementById('evidence-anchor-highlight');
                                              if (mark) {
                                                mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                              }
                                            }, 200);
                                          }
                                        } catch (e) {
                                          console.error("Highlight regex error", e);
                                        }
                                      }
                                    }
                                    return content;
                                  })()
                                }} 
                            />
                          ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 bg-white dark:bg-[#0F172A] p-12">
                              <Icons.IconFile className="w-16 h-16 mb-4 text-zinc-300 dark:text-zinc-700" />
                              <h4 className="text-lg font-bold text-zinc-900 dark:text-white">No submission content</h4>
                              <p className="text-sm">The student hasn't provided any text or file attachment.</p>
                            </div>
                          )}
                        </div>

                        {/* BOTTOM FILES STRIP (only if files exist) */}
                        {student.attachments && student.attachments.length > 0 && (
                          <div className="w-full border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-[#0B1120] p-2 flex items-center space-x-2 overflow-x-auto custom-scrollbar shrink-0">
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 shrink-0 px-2">Submission Files:</span>
                            {student.attachments.map((att: any, idx: number) => {
                              const isSelected = activeAttachment ? activeAttachment.id === att.id : idx === 0;
                              return (
                                <button
                                  key={att.id}
                                  onClick={() => setActiveAttachment(att)}
                                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border transition-all shrink-0
                                    ${isSelected 
                                      ? 'bg-white dark:bg-[#0F172A] border-indigo-500 shadow-sm' 
                                      : 'bg-transparent border-transparent hover:bg-zinc-100 dark:hover:bg-white/5'}`}
                                >
                                  <Icons.IconFile className={`w-3.5 h-3.5 ${isSelected ? 'text-[var(--brand-primary)]' : 'text-[var(--text-muted)]'}`} />
                                  <span className={`text-xs font-bold ${isSelected ? 'text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'}`}>
                                    {att.filename}
                                  </span>
                                  <span className="text-[9px] text-[var(--text-muted)] ml-2">
                                    {att.size ? (att.size / 1024).toFixed(1) + ' KB' : ''}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div> {/* closes w-full max-w-5xl */}
                    </div> {/* closes flex-1 flex flex-col (Left Side) */}

                    {/* RIGHT SECTION: GRADING SIDEBAR */}
                    {!isGradingSidebarCollapsed && (
                      <div className="w-[420px] h-full bg-white dark:bg-[#0F172A] border-l border-zinc-200 dark:border-white/5 grid grid-rows-[auto_1fr] z-10 animate-in slide-in-from-right duration-300 shrink-0">
                        {/* Sidebar Header */}
                        <div className="p-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/5 flex items-center justify-between shrink-0">
                          <div className="flex items-center space-x-2">
                            <Icons.IconSparkles className="w-4 h-4 text-[var(--brand-primary)]" />
                            <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--brand-primary)]">GRADING & AI FEEDBACK</h3>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => setUseMoE(!useMoE)}
                              className={`flex items-center px-2 py-1 rounded-full transition-all ${useMoE ? 'bg-indigo-600' : 'bg-zinc-200 dark:bg-zinc-700'}`}
                            >
                              <div className={`w-3 h-3 rounded-full bg-white transition-transform ${useMoE ? 'translate-x-4' : 'translate-x-0'}`} />
                            </button>
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tight whitespace-nowrap">MOE</span>
                          </div>
                        </div>

                        {/* Sidebar Scrollable Content */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
                          
                          {/* Phase 3: RAG Loading Skeleton */}
                          {loadingStudents.has(selectedStudent) && (
                            <div className="flex flex-col items-center justify-center p-8 space-y-3 h-full">
                              <Icons.IconSparkles className="w-8 h-8 text-indigo-500 animate-spin" />
                              <div className="text-[10px] font-black text-indigo-500 uppercase tracking-widest text-center animate-pulse">
                                {ingestingStudents.has(selectedStudent)
                                  ? "Reading class materials, please wait..."
                                  : backgroundIndexing
                                    ? "Indexing more materials in background..."
                                    : "CONSULTING CONTEXT & RUBRICS..."}
                              </div>
                            </div>
                          )}

                          {/* Phase 3: RAG Result View */}
                          {!loadingStudents.has(selectedStudent!) && aiGradingData[selectedStudent!] ? (
                            <GradingResult 
                               result={aiGradingData[selectedStudent!]} 
                               rubricContext={currentAuthItem?.rubric || []}
                               onEvidenceAnchorClick={(text) => setHighlightText(text)}
                            />
                          ) : (
                            !loadingStudents.has(selectedStudent!) && (
                              <div className="space-y-6">
                                {rowErrors[selectedStudent!] ? (
                                  <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl shadow-sm">
                                    <div className="text-red-600 dark:text-red-400 text-xs font-bold mb-1 flex items-center"><Icons.IconX className="w-4 h-4 mr-1"/> GRADING FAILED</div>
                                    <div className="text-red-500 dark:text-red-300 text-xs whitespace-pre-wrap">{rowErrors[selectedStudent!]}</div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col">
                                    <div className="text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-4 text-center">Click below to assess this submission</div>
                                    <button 
                                      onClick={() => handleFetchAiGrade(selectedStudent!)}
                                      className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center"
                                    >
                                      <Icons.IconSparkles className="w-4 h-4 mr-2" />
                                      GRADE WITH AI ✨
                                    </button>
                                  </div>
                                )}
                                
                                {/* Expected Rubric View (Before Grading) */}
                                {currentAuthItem?.rubric && currentAuthItem.rubric.length > 0 && (
                                  <div className="space-y-3 pt-4 border-t border-zinc-200 dark:border-white/10">
                                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Expected Rubric Criteria</h3>
                                    <div className="space-y-2">
                                      {currentAuthItem.rubric.map((r: any, idx: number) => (
                                        <div key={idx} className="bg-white dark:bg-white/5 border border-zinc-100 dark:border-white/10 rounded-2xl p-4 flex items-center justify-between shadow-sm">
                                          <div className="flex items-center space-x-3">
                                            <div className="w-6 h-6 rounded-md bg-zinc-100 dark:bg-white/5 flex items-center justify-center text-[10px] font-black text-zinc-500">
                                              {idx + 1}
                                            </div>
                                            <div>
                                              <div className="text-xs font-bold text-zinc-900 dark:text-white">{r.description || r.id}</div>
                                              {r.long_description && <div className="text-[9px] text-zinc-500 line-clamp-1">{r.long_description}</div>}
                                            </div>
                                          </div>
                                          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-1 rounded-md">{r.points} pts</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          )}

                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </RightPanelErrorBoundary>
        )}
      </div>
    </div>

    </>
  );
}
