
import React, { useEffect, useState, useCallback, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

import { supabase } from './lib/supabase';

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
import RoleSelectionModal from './components/RoleSelectionModal';
import GlobalNotifications from './components/GlobalNotifications';
import StudentAITutor from './components/StudentAITutor';

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
const CourseModules = lazy(() => import('./pages/CourseModules'));
const StudentAssignments = lazy(() => import('./pages/StudentAssignments'));

gsap.registerPlugin(ScrollTrigger);

export type AppPath =
  | 'home' | 'teacher-login' | 'student-login'
  | 'teacher-dashboard' | 'teacher-upload' | 'teacher-assignments' | 'teacher-analytics' | 'teacher-persona' | 'teacher-discussions' | 'teacher-grading' | 'teacher-predictor' | 'teacher-modules'
  | 'student-dashboard' | 'student-assignment' | 'student-materials' | 'student-discussion' | 'student-progress' | 'student-lab' | 'student-peer-review' | 'student-modules' | 'student-assignments'
  | 'settings' | '404';

const getRole = (u: any): 'teacher' | 'student' | null => {
  if (!u) return null;
  const role = u.user_metadata?.role || u.app_metadata?.role;
  if (role === 'teacher') return 'teacher';
  if (role === 'student') return 'student';
  return null;
};

const LoadingFallback = () => (
  <div className="h-screen w-full flex flex-col items-center justify-center bg-[#F9F8F3] font-['Plus_Jakarta_Sans']">
    <div className="w-12 h-12 border-4 border-zinc-200 border-t-zinc-900 rounded-full animate-spin mb-6"></div>
    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 animate-pulse">Loading Hub Module...</p>
  </div>
);

const ProtectedRoute = ({ children, allowedRole, user, isCheckingAuth }: any) => {
  const location = useLocation();

  if (isCheckingAuth) return <LoadingFallback />;
  if (!user) return <Navigate to="/" state={{ from: location }} replace />;

  const role = getRole(user);
  if (allowedRole && role !== allowedRole) {
    return <Navigate to={role === 'teacher' ? '/teacher/dashboard' : '/student/dashboard'} replace />;
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
      case 'student-login': return '/student/login';
      case 'teacher-dashboard': return '/teacher/dashboard';
      case 'teacher-upload': return '/teacher/upload';
      case 'teacher-assignments': return '/teacher/assignments';
      case 'teacher-analytics': return '/teacher/analytics';
      case 'teacher-persona': return '/teacher/persona';
      case 'teacher-discussions': return '/teacher/discussions';
      case 'teacher-grading': return '/teacher/grading';
      case 'teacher-predictor': return '/teacher/predictor';
      case 'student-dashboard': return '/student/dashboard';
      case 'student-materials': return '/student/materials';
      case 'student-progress': return '/student/progress';
      case 'student-lab': return '/student/lab';
      case 'student-peer-review': return '/student/peer-review';
      case 'settings': return '/settings';
      case 'teacher-modules': return '/teacher/modules';
      case 'student-modules': return '/student/modules';
      case 'student-assignments': return '/student/assignments';
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
      try { await supabase.auth.signOut(); } catch (e) { setUser(null); navigate('/'); }
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

  const isAuthPage = location.pathname.includes('/login');
  const isHomePage = location.pathname === '/';

  return (
    <div className="relative w-full min-h-full">
      <Suspense fallback={<LoadingFallback />}>
        <BackgroundParticles />
        {!isAuthPage && <CustomCursor />}
        {!isAuthPage && <ScrollToTop />}
        {!isAuthPage && isHomePage && <Navbar onGetStarted={() => setIsModalOpen(true)} />}

        <Routes>
          <Route path="/" element={
            user ? (
              <Navigate to={getRole(user) === 'teacher' ? '/teacher/dashboard' : '/student/dashboard'} replace />
            ) : (
              <main>
                <Hero onGetStarted={() => setIsModalOpen(true)} />
                <SocialProof />
                <Features />
                <InteractiveDemo />
                <AITutorSection onGetStarted={() => setIsModalOpen(true)} />
                <Stats />
                <Testimonials />
                <CTA onGetStarted={() => setIsModalOpen(true)} />
              </main>
            )
          } />

          <Route path="/teacher/login" element={<TeacherAuth onBack={goBack} onSuccess={() => navigateTo('teacher-dashboard')} />} />
          <Route path="/student/login" element={<StudentAuth onBack={goBack} onSuccess={() => navigateTo('student-dashboard')} />} />

          {/* Teacher Routes */}
          <Route path="/teacher/dashboard" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><TeacherDashboard {...commonProps} currentPath="teacher-dashboard" /></ProtectedRoute>} />
          <Route path="/teacher/upload" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><UploadMaterials {...commonProps} currentPath="teacher-upload" /></ProtectedRoute>} />
          <Route path="/teacher/assignments" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><CreateAssignment {...commonProps} /></ProtectedRoute>} />
          <Route path="/teacher/analytics" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><StudentsAnalytics {...commonProps} /></ProtectedRoute>} />
          <Route path="/teacher/grading" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><GradingHub {...commonProps} currentPath="teacher-grading" /></ProtectedRoute>} />
          <Route path="/teacher/persona" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><PersonaSetup {...commonProps} currentPath="teacher-persona" /></ProtectedRoute>} />
          <Route path="/teacher/discussions" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><DiscussionsManagement {...commonProps} currentPath="teacher-discussions" /></ProtectedRoute>} />
          <Route path="/teacher/modules" element={<ProtectedRoute allowedRole="teacher" user={user} isCheckingAuth={isCheckingAuth}><CourseModules {...commonProps} currentPath="teacher-modules" role="teacher" /></ProtectedRoute>} />

          {/* Student Routes */}
          <Route path="/student/dashboard" element={<ProtectedRoute allowedRole="student" user={user} isCheckingAuth={isCheckingAuth}>
            <StudentDashboard {...commonProps} currentPath="student-dashboard"
              onSelectAssignment={(id, type) => navigateTo(type === 'discussion' ? 'student-discussion' : 'student-assignment', { assignmentId: id })}
              onNavigateMaterials={() => navigateTo('student-materials')}
              onNavigateProgress={() => navigateTo('student-progress')}
              onNavigateDashboard={() => navigateTo('student-dashboard')}
              onNavigateSettings={() => navigateTo('settings')}
              onNavigateLab={() => navigateTo('student-lab')}
              onNavigatePeerReview={() => navigateTo('student-peer-review')}
            />
          </ProtectedRoute>} />
          <Route path="/student/materials" element={<ProtectedRoute allowedRole="student" user={user} isCheckingAuth={isCheckingAuth}><CourseMaterials {...commonProps} {...studentNavProps} currentPath="student-materials" user={user} /></ProtectedRoute>} />
          <Route path="/student/assignments" element={<ProtectedRoute allowedRole="student" user={user} isCheckingAuth={isCheckingAuth}><StudentAssignments {...commonProps} currentPath="student-assignments" user={user} /></ProtectedRoute>} />
          <Route path="/student/assignment/:assignmentId" element={<ProtectedRoute allowedRole="student" user={user} isCheckingAuth={isCheckingAuth}><AssignmentWrapper {...commonProps} type="assignment" /></ProtectedRoute>} />
          <Route path="/student/discussion/:assignmentId" element={<ProtectedRoute allowedRole="student" user={user} isCheckingAuth={isCheckingAuth}><AssignmentWrapper {...commonProps} type="discussion" /></ProtectedRoute>} />
          <Route path="/student/progress" element={<ProtectedRoute allowedRole="student" user={user} isCheckingAuth={isCheckingAuth}><StudentProgress {...commonProps} {...studentNavProps} /></ProtectedRoute>} />
          <Route path="/student/lab" element={<ProtectedRoute allowedRole="student" user={user} isCheckingAuth={isCheckingAuth}><Laboratory {...commonProps} currentPath="student-lab" /></ProtectedRoute>} />
          <Route path="/student/peer-review" element={<ProtectedRoute allowedRole="student" user={user} isCheckingAuth={isCheckingAuth}><PeerReviewHub {...commonProps} currentPath="student-peer-review" /></ProtectedRoute>} />
          <Route path="/student/modules" element={<ProtectedRoute allowedRole="student" user={user} isCheckingAuth={isCheckingAuth}><CourseModules {...commonProps} currentPath="student-modules" role="student" /></ProtectedRoute>} />

          <Route path="/settings" element={<ProtectedRoute user={user} isCheckingAuth={isCheckingAuth}><Settings {...commonProps} /></ProtectedRoute>} />
          <Route path="*" element={<NotFound onBack={() => navigate('/')} />} />
        </Routes>

        {!isAuthPage && isHomePage && <Footer />}
        <RoleSelectionModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onNavigate={(path) => navigateTo(path as AppPath)} />
        <GlobalNotifications isOpen={isNotifOpen} onClose={() => setIsNotifOpen(false)} />

        {/* Global Student AI Tutor */}
        {user && location.pathname.startsWith('/student') && (
          <StudentAITutor studentName={user.user_metadata?.full_name?.split(' ')[0] || 'Student'} />
        )}
      </Suspense>
    </div>
  );
};

const AssignmentWrapper = (props: any) => {
  const { assignmentId } = useParams();
  const Component = props.type === 'discussion' ? StudentDiscussion : AssignmentWork;
  return <Component assignmentId={assignmentId || ''} {...props} currentPath={props.type === 'discussion' ? 'student-discussion' : 'student-assignment'} />;
};

export default App;
