
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

  // Inline styles so Brave shields / blocked Tailwind CDN cannot blank this screen.
  return (
    <div
      style={{
        height: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F4F7FA',
        fontFamily: '"Plus Jakarta Sans", sans-serif',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          border: '4px solid #E2E8F0',
          borderTopColor: '#4F46E5',
          borderRadius: '9999px',
          marginBottom: 24,
          animation: 'edu-spin 0.8s linear infinite',
        }}
      />
      <p
        style={{
          fontSize: 10,
          fontWeight: 900,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          color: '#64748B',
          margin: 0,
        }}
      >
        {message}
      </p>
      {showReload && (
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 32,
            padding: '12px 24px',
            border: '1px solid #E2E8F0',
            borderRadius: 12,
            fontSize: 12,
            fontWeight: 700,
            color: '#64748B',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          Forced Reload
        </button>
      )}
      <style>{`@keyframes edu-spin { to { transform: rotate(360deg); } }`}</style>
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
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);

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
        // Brave / blocked network can hang getSession — never leave a blank loading screen.
        const sessionResult = await Promise.race([
          supabase.auth.getSession(),
          new Promise<{ data: { session: null } }>((resolve) =>
            setTimeout(() => resolve({ data: { session: null } }), 4000)
          ),
        ]);
        const session = sessionResult?.data?.session;
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
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoveringPassword(true);
      }
      
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

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    if (newPassword.length < 8) {
      setResetError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setResetError("Passwords do not match");
      return;
    }
    
    setIsResetting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setIsRecoveringPassword(false);
      setNewPassword('');
      setConfirmNewPassword('');
      // User is already signed in by the recovery link
      navigate('/teacher/dashboard');
    } catch (err: any) {
      setResetError(err.message || "Failed to update password");
    } finally {
      setIsResetting(false);
    }
  };

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

      {isRecoveringPassword && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-[var(--bg-card)] max-w-md w-full rounded-[2rem] shadow-[var(--shadow-2xl)] border-2 border-[var(--border-primary)] overflow-hidden p-8 animate-fade-in">
            <h2 className="text-2xl font-black text-[var(--text-primary)] mb-2 font-['Space_Grotesk']">Reset Password</h2>
            <p className="text-[var(--text-muted)] font-bold text-xs mb-6">Enter your new secure faculty key below.</p>
            
            {resetError && (
              <div className="bg-[var(--color-danger)]/10 text-[var(--color-danger)] px-4 py-3 rounded-xl text-xs font-bold mb-4">
                {resetError}
              </div>
            )}
            
            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">New Password</label>
                <input required type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" className="w-full h-12 px-5 bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1rem] focus:border-[var(--brand-primary)] focus:outline-none font-bold text-sm" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Confirm Password</label>
                <input required type="password" value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)} placeholder="••••••••" className="w-full h-12 px-5 bg-[var(--bg-nested)] border-2 border-[var(--border-primary)] rounded-[1rem] focus:border-[var(--brand-primary)] focus:outline-none font-bold text-sm" />
              </div>
              <button disabled={isResetting} type="submit" className="w-full h-12 bg-[var(--brand-primary)] text-white rounded-[1rem] font-black text-[11px] uppercase tracking-widest shadow-lg hover:brightness-110 disabled:opacity-50 mt-2">
                {isResetting ? "Updating..." : "Update Password"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;



