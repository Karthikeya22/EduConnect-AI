
import React, { useEffect, useState, useCallback, Suspense, lazy } from 'react';
import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

// Lazy load components
const Navbar = lazy(() => import('./components/Navbar'));
const Hero = lazy(() => import('./components/Hero'));
const SocialProof = lazy(() => import('./components/SocialProof'));
const Features = lazy(() => import('./components/Features'));
const InteractiveDemo = lazy(() => import('./components/InteractiveDemo'));
const AITutorSection = lazy(() => import('./components/AITutorSection'));
const Stats = lazy(() => import('./components/Stats'));
const Testimonials = lazy(() => import('./components/Testimonials'));
const CTA = lazy(() => import('./components/CTA'));
const Footer = lazy(() => import('./components/Footer'));
const CustomCursor = lazy(() => import('./components/CustomCursor'));
const BackgroundParticles = lazy(() => import('./components/BackgroundParticles'));
const ScrollToTop = lazy(() => import('./components/ScrollToTop'));
const RoleSelectionModal = lazy(() => import('./components/RoleSelectionModal'));
const GlobalNotifications = lazy(() => import('./components/GlobalNotifications'));

// Lazy load pages
const TeacherAuth = lazy(() => import('./pages/TeacherAuth'));
const StudentAuth = lazy(() => import('./pages/StudentAuth'));
const TeacherDashboard = lazy(() => import('./pages/TeacherDashboard'));
const StudentDashboard = lazy(() => import('./pages/StudentDashboard'));
const AssignmentWork = lazy(() => import('./pages/AssignmentWork'));
const CourseMaterials = lazy(() => import('./pages/CourseMaterials'));
const StudentDiscussion = lazy(() => import('./pages/StudentDiscussion'));
const StudentProgress = lazy(() => import('./pages/StudentProgress'));
const UploadMaterials = lazy(() => import('./pages/UploadMaterials'));
const CreateAssignment = lazy(() => import('./pages/CreateAssignment'));
const StudentsAnalytics = lazy(() => import('./pages/StudentsAnalytics'));
const GradingHub = lazy(() => import('./pages/GradingHub'));
const PersonaSetup = lazy(() => import('./pages/PersonaSetup'));
const DiscussionsManagement = lazy(() => import('./pages/DiscussionsManagement'));
const Settings = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Laboratory = lazy(() => import('./pages/Laboratory'));
const PeerReviewHub = lazy(() => import('./pages/PeerReviewHub'));
const GradePredictor = lazy(() => import('./pages/GradePredictor'));

import { supabase } from './lib/supabase';

gsap.registerPlugin(ScrollTrigger);

export type AppPath = 
  | 'home' | 'teacher-login' | 'student-login' 
  | 'teacher-dashboard' | 'teacher-upload' | 'teacher-assignments' | 'teacher-analytics' | 'teacher-persona' | 'teacher-discussions' | 'teacher-grading' | 'teacher-predictor'
  | 'student-dashboard' | 'student-assignment' | 'student-materials' | 'student-discussion' | 'student-progress' | 'student-lab' | 'student-peer-review'
  | 'settings' | '404';

const App: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState<AppPath>('home');
  const [history, setHistory] = useState<AppPath[]>([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isNotifOpen, setIsNotifOpen] = useState(false);

  const getRole = (u: any): 'teacher' | 'student' | null => {
    if (!u) return null;
    const role = u.user_metadata?.role || u.app_metadata?.role;
    if (role === 'teacher') return 'teacher';
    if (role === 'student') return 'student';
    return null;
  };

  const navigateTo = useCallback((path: AppPath, params?: { assignmentId?: string }) => {
    if (params?.assignmentId) setSelectedAssignmentId(params.assignmentId);
    setHistory(prev => [...prev, currentPath]);
    setCurrentPath(path);
    window.scrollTo(0, 0);
    setIsModalOpen(false);
  }, [currentPath]);

  const goBack = useCallback(() => {
    if (history.length > 0) {
      const newHistory = [...history];
      const prevPath = newHistory.pop()!;
      setHistory(newHistory);
      setCurrentPath(prevPath);
    } else {
      const role = getRole(user);
      if (role === 'teacher') setCurrentPath('teacher-dashboard');
      else if (role === 'student') setCurrentPath('student-dashboard');
      else setCurrentPath('home');
    }
    window.scrollTo(0, 0);
  }, [history, user]);

  useEffect(() => {
    const initSession = async () => {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Auth node timeout')), 3500));
      
      try {
        const { data: { session } } = await Promise.race([
          supabase.auth.getSession(),
          timeout
        ]) as any;
        
        if (session?.user) {
          setUser(session.user);
          const role = getRole(session.user);
          if (role && (currentPath === 'home' || currentPath.includes('-login'))) {
            setCurrentPath(role === 'teacher' ? 'teacher-dashboard' : 'student-dashboard');
          }
        }
      } catch (error: any) {
        console.warn("Auth initialization deferred. Error:", error?.message);
      } finally {
        setIsCheckingAuth(false);
      }
    };

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setUser(session.user);
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          const role = getRole(session.user);
          if (role && (currentPath === 'home' || currentPath.includes('-login'))) {
            setCurrentPath(role === 'teacher' ? 'teacher-dashboard' : 'student-dashboard');
          }
        }
      } else {
        setUser(null);
        if (event === 'SIGNED_OUT') {
          setHistory([]);
          setCurrentPath('home');
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user && !isCheckingAuth) {
      const role = getRole(user);
      if (!role) return;
      
      const isTeacherPath = currentPath.startsWith('teacher-');
      const isStudentPath = currentPath.startsWith('student-');
      
      // Strict role enforcement
      if (role === 'teacher' && isStudentPath) {
        setCurrentPath('teacher-dashboard');
      } else if (role === 'student' && isTeacherPath) {
        setCurrentPath('student-dashboard');
      }
    }
  }, [currentPath, user, isCheckingAuth]);

  const commonProps = {
    onBack: goBack,
    onNavigateTo: navigateTo,
    onLogout: async () => { 
      try { await supabase.auth.signOut(); } catch (e) { setUser(null); setCurrentPath('home'); }
    },
    onOpenNotifs: () => setIsNotifOpen(true)
  };

  const studentNavProps = {
    onNavigateDashboard: () => navigateTo('student-dashboard'),
    onNavigateMaterials: () => navigateTo('student-materials'),
    onNavigateProgress: () => navigateTo('student-progress')
  };

  if (isCheckingAuth) return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-[#F9F8F3] font-['Plus_Jakarta_Sans']">
      <div className="w-12 h-12 border-4 border-zinc-200 border-t-zinc-900 rounded-full animate-spin mb-6"></div>
      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 animate-pulse">Initializing Hub Systems...</p>
    </div>
  );

  const renderContent = () => {
    const isPublic = ['home', 'teacher-login', 'student-login', '404'].includes(currentPath);
    const userRole = user ? getRole(user) : null;

    if (!user && !isPublic) {
      return <main><Hero onGetStarted={() => setIsModalOpen(true)} /><SocialProof /><Features /><InteractiveDemo /><AITutorSection onGetStarted={() => setIsModalOpen(true)} /><Stats /><Testimonials /><CTA onGetStarted={() => setIsModalOpen(true)} /></main>;
    }

    switch(currentPath) {
      case 'home': return <main><Hero onGetStarted={() => setIsModalOpen(true)} /><SocialProof /><Features /><InteractiveDemo /><AITutorSection onGetStarted={() => setIsModalOpen(true)} /><Stats /><Testimonials /><CTA onGetStarted={() => setIsModalOpen(true)} /></main>;
      case 'teacher-login': return <TeacherAuth onBack={goBack} onSuccess={() => navigateTo('teacher-dashboard')} />;
      case 'student-login': return <StudentAuth onBack={goBack} onSuccess={() => navigateTo('student-dashboard')} />;
      case 'teacher-dashboard': return userRole === 'teacher' ? <TeacherDashboard {...commonProps} currentPath={currentPath} /> : null;
      case 'teacher-upload': return userRole === 'teacher' ? <UploadMaterials {...commonProps} currentPath={currentPath} /> : null;
      case 'teacher-assignments': return userRole === 'teacher' ? <CreateAssignment {...commonProps} /> : null;
      case 'teacher-analytics': return userRole === 'teacher' ? <StudentsAnalytics {...commonProps} /> : null;
      case 'teacher-grading': return userRole === 'teacher' ? <GradingHub {...commonProps} currentPath={currentPath} /> : null;
      case 'teacher-persona': return userRole === 'teacher' ? <PersonaSetup {...commonProps} currentPath={currentPath} /> : null;
      case 'teacher-discussions': return userRole === 'teacher' ? <DiscussionsManagement {...commonProps} currentPath={currentPath} /> : null;
      case 'teacher-predictor': return userRole === 'teacher' ? <GradePredictor {...commonProps} currentPath={currentPath} /> : null;
      case 'student-dashboard': return userRole === 'student' ? <StudentDashboard {...commonProps} currentPath={currentPath} onSelectAssignment={(id, type) => navigateTo(type === 'discussion' ? 'student-discussion' : 'student-assignment', { assignmentId: id })} onNavigateMaterials={() => navigateTo('student-materials')} onNavigateProgress={() => navigateTo('student-progress')} onNavigateDashboard={() => navigateTo('student-dashboard')} onNavigateSettings={() => navigateTo('settings')} onNavigateLab={() => navigateTo('student-lab')} onNavigatePeerReview={() => navigateTo('student-peer-review')} /> : null;
      case 'student-materials': return userRole === 'student' ? <CourseMaterials {...commonProps} {...studentNavProps} /> : null;
      case 'student-assignment': return userRole === 'student' ? <AssignmentWork assignmentId={selectedAssignmentId || ''} {...commonProps} currentPath={currentPath} /> : null;
      case 'student-discussion': return userRole === 'student' ? <StudentDiscussion assignmentId={selectedAssignmentId || ''} {...commonProps} {...studentNavProps} /> : null;
      case 'student-progress': return userRole === 'student' ? <StudentProgress {...commonProps} {...studentNavProps} /> : null;
      case 'student-lab': return userRole === 'student' ? <Laboratory {...commonProps} currentPath={currentPath} /> : null;
      case 'student-peer-review': return userRole === 'student' ? <PeerReviewHub {...commonProps} currentPath={currentPath} /> : null;
      case 'settings': return userRole ? <Settings {...commonProps} /> : null;
      default: return <NotFound onBack={() => navigateTo(user ? (getRole(user) === 'teacher' ? 'teacher-dashboard' : 'student-dashboard') : 'home')} />;
    }
  };

  const isAuthPage = currentPath === 'teacher-login' || currentPath === 'student-login';

  const LoadingFallback = () => (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-[#F9F8F3] font-['Plus_Jakarta_Sans']">
      <div className="w-12 h-12 border-4 border-zinc-200 border-t-zinc-900 rounded-full animate-spin mb-6"></div>
      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 animate-pulse">Loading Hub Module...</p>
    </div>
  );

  return (
    <div className="relative w-full min-h-full">
      <Suspense fallback={<LoadingFallback />}>
        <BackgroundParticles />
        {!isAuthPage && <CustomCursor />}
        {!isAuthPage && <ScrollToTop />}
        {!isAuthPage && currentPath === 'home' && <Navbar onGetStarted={() => setIsModalOpen(true)} />}
        {renderContent()}
        {!isAuthPage && currentPath === 'home' && <Footer />}
        <RoleSelectionModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onNavigate={(path) => navigateTo(path as AppPath)} />
        <GlobalNotifications isOpen={isNotifOpen} onClose={() => setIsNotifOpen(false)} />
      </Suspense>
    </div>
  );
};

export default App;
