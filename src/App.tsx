
import React, { useEffect, useState, useCallback, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

import { supabase } from '@/src/lib/supabase';

// Lazy load components
const Navbar = lazy(() => import('@/src/components/layout/Navbar'));
const Hero = lazy(() => import('@/src/components/landing/Hero'));
const SocialProof = lazy(() => import('@/src/components/landing/SocialProof'));
const Features = lazy(() => import('@/src/components/landing/Features'));
const InteractiveDemo = lazy(() => import('@/src/components/landing/InteractiveDemo'));
const AITutorSection = lazy(() => import('@/src/components/landing/AITutorSection'));
const Stats = lazy(() => import('@/src/components/landing/Stats'));
const Testimonials = lazy(() => import('@/src/components/landing/Testimonials'));
const CTA = lazy(() => import('@/src/components/landing/CTA'));
const Footer = lazy(() => import('@/src/components/layout/Footer'));
const CustomCursor = lazy(() => import('@/src/components/layout/CustomCursor'));
const BackgroundParticles = lazy(() => import('@/src/components/layout/BackgroundParticles'));
const ScrollToTop = lazy(() => import('@/src/components/layout/ScrollToTop'));
import GlobalNotifications from '@/src/components/dashboard/GlobalNotifications';

// Lazy load pages
const TeacherCourseSelection = lazy(() => import('@/src/pages/teacher/TeacherCourseSelection'));
const TeacherAuth = lazy(() => import('@/src/pages/auth/TeacherAuth'));
const TeacherDashboard = lazy(() => import('@/src/pages/teacher/TeacherDashboard'));
const CreateAssignment = lazy(() => import('@/src/pages/teacher/CreateAssignment'));
const StudentsAnalytics = lazy(() => import('@/src/pages/teacher/StudentsAnalytics'));
const GradingHub = lazy(() => import('@/src/pages/teacher/GradingHub'));
const ClickstreamAnalytics = lazy(() => import('@/src/pages/teacher/ClickstreamAnalytics'));
const Gradebook = lazy(() => import('@/src/pages/teacher/Gradebook'));
const DiscussionsManagement = lazy(() => import('@/src/pages/teacher/DiscussionsManagement'));
const CanvasSync = lazy(() => import('@/src/pages/teacher/CanvasSync'));
const NotFound = lazy(() => import('@/src/pages/shared/NotFound'));
const GradePredictor = lazy(() => import('@/src/pages/teacher/GradePredictor'));
const CourseModules = lazy(() => import('@/src/pages/shared/CourseModules'));

gsap.registerPlugin(ScrollTrigger);

export type AppPath =
  | 'home' | 'teacher-login' | 'teacher-select-course'
  | 'teacher-dashboard' | 'teacher-assignments' | 'teacher-analytics' | 'teacher-clickstream' | 'teacher-discussions' | 'teacher-grading' | 'teacher-grades' | 'teacher-predictor' | 'teacher-modules' | 'teacher-canvas-sync'
  | 'student-dashboard' | 'student-assignments' | 'student-materials' | 'student-modules' | 'student-lab' | 'student-progress' | 'student-assignment' | 'student-discussion'
  | '404';

const getRole = (u: any): 'teacher' | null => {
  if (!u) return null;
  return 'teacher';
};

const LoadingFallback = ({ message = "Loading Hub Module..." }: { message?: string }) => {
  const [showReload, setShowReload] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowReload(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-white dark:bg-[#0B1120] font-['Plus_Jakarta_Sans'] transition-colors duration-500">
      <div className="w-12 h-12 border-4 border-zinc-200 dark:border-white/10 border-t-indigo-600 dark:border-t-indigo-500 rounded-full animate-spin mb-6"></div>
      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 dark:text-zinc-500 animate-pulse">{message}</p>
      {showReload && (
        <button onClick={() => window.location.reload()} className="mt-8 px-6 py-3 border border-zinc-200 dark:border-white/10 rounded-xl text-xs font-bold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
          Forced Reload
        </button>
      )}
    </div>
  );
};

const ProtectedRoute = ({ children, allowedRole, user, isCheckingAuth }: any) => {
  const location = useLocation();

  if (isCheckingAuth) return <LoadingFallback />;
  if (!user) return <Navigate to="/" state={{ from: location }} replace />;

  const role = getRole(user);
  if (allowedRole && role !== allowedRole) {
    return <Navigate to="/teacher/dashboard" replace />;
  }

  return children;
};

const App: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isNotifOpen, setIsNotifOpen] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  // Map AppPath to URLs for reverse compatibility if needed
  const pathToUrl = (path: AppPath, params?: { assignmentId?: string }): string => {
    switch (path) {
      case 'home': return '/';
      case 'teacher-login': return '/teacher/login';
      case 'teacher-select-course': return '/teacher/select-course';
      case 'teacher-dashboard': return '/teacher/dashboard';
      case 'teacher-assignments': return '/teacher/assignments';
      case 'teacher-analytics': return '/teacher/analytics';
      case 'teacher-clickstream': return '/teacher/clickstream';
      case 'teacher-discussions': return '/teacher/discussions';
      case 'teacher-grading': return '/teacher/grading';
      case 'teacher-grades': return '/teacher/grades';
      case 'teacher-predictor': return '/teacher/predictor';
      case 'teacher-canvas-sync': return '/teacher/canvas-sync';
      case 'teacher-modules': return '/teacher/modules';
      case 'student-dashboard': return '/student/dashboard';
      case 'student-assignments': return '/student/assignments';
      case 'student-materials': return '/student/materials';
      case 'student-modules': return '/student/modules';
      case 'student-lab': return '/student/lab';
      case 'student-progress': return '/student/progress';
      case 'student-assignment': return `/student/assignment/${params?.assignmentId || ''}`;
      case 'student-discussion': return `/student/discussion/${params?.assignmentId || ''}`;
      default: return '/404';
    }
  };

  const navigateTo = useCallback((path: AppPath, params?: any) => {
    navigate(pathToUrl(path, params), { state: params });
    window.scrollTo(0, 0);
    setIsModalOpen(false);
  }, [navigate]);

  const goBack = useCallback(() => {
    navigate(-1);
    window.scrollTo(0, 0);
  }, [navigate]);

  useEffect(() => {
    const initSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setUser(session.user);
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
      } else {
        setUser(null);
        if (event === 'SIGNED_OUT') {
          navigate('/');
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const commonProps = {
    onBack: goBack,
    onNavigateTo: navigateTo,
    onLogout: async () => {
      try {
        await supabase.auth.signOut();
        setUser(null);
        navigate('/');
      } catch (e) {
        setUser(null);
        navigate('/');
      }
    },
    onOpenNotifs: () => setIsNotifOpen(true)
  };

  if (isCheckingAuth) return <LoadingFallback message="Initializing Hub Systems..." />;

  const isAuthPage = location.pathname.includes('/login');
  const isHomePage = location.pathname === '/';

  return (
    <div className="relative w-full min-h-full">
      <Suspense fallback={<LoadingFallback />}>
        <BackgroundParticles />
        {!isAuthPage && <CustomCursor />}
        {!isAuthPage && <ScrollToTop />}

        <Routes>
          <Route path="/" element={
            user ? (
              <Navigate to="/teacher/dashboard" replace />
            ) : (
              <Navigate to="/teacher/login" replace />
            )
          } />

          <Route path="/teacher/login" element={<TeacherAuth onBack={goBack} onSuccess={() => navigateTo('teacher-select-course')} />} />

          {/* Teacher Routes */}
          <Route path="/teacher/select-course" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><TeacherCourseSelection onLogout={commonProps.onLogout} /></ProtectedRoute>} />
          <Route path="/teacher/dashboard" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><TeacherDashboard {...commonProps} currentPath="teacher-dashboard" /></ProtectedRoute>} />
          <Route path="/teacher/assignments" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><CreateAssignment {...commonProps} /></ProtectedRoute>} />
          <Route path="/teacher/analytics" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><StudentsAnalytics {...commonProps} /></ProtectedRoute>} />
          <Route path="/teacher/clickstream" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><ClickstreamAnalytics {...commonProps} currentPath="teacher-clickstream" /></ProtectedRoute>} />
          <Route path="/teacher/grading" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><GradingHub {...commonProps} currentPath="teacher-grading" /></ProtectedRoute>} />
          <Route path="/teacher/grades" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><Gradebook {...commonProps} currentPath="teacher-grades" /></ProtectedRoute>} />
          <Route path="/teacher/discussions" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><DiscussionsManagement {...commonProps} currentPath="teacher-discussions" /></ProtectedRoute>} />
          <Route path="/teacher/modules" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><CourseModules {...commonProps} currentPath="teacher-modules" role="teacher" /></ProtectedRoute>} />
          <Route path="/teacher/canvas-sync" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><CanvasSync {...commonProps} currentPath="teacher-canvas-sync" /></ProtectedRoute>} />

          <Route path="*" element={<NotFound onBack={() => navigate('/')} />} />
        </Routes>

        <GlobalNotifications isOpen={isNotifOpen} onClose={() => setIsNotifOpen(false)} user={user} />
      </Suspense>
    </div>
  );
};

export default App;



