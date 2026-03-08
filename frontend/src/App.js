import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';

import { api } from './api';
import { loadBranding } from './branding';
import AdminLayout from './components/AdminLayout';
import StudentLayout from './components/StudentLayout';
import LoadingScreen from './components/ui/LoadingScreen';
import { clearSession, getSessionToken, getStoredUser, migrateLegacySession, storeSession } from './lib/session';

const LandingPage = React.lazy(() => import('./pages/LandingPage'));
const LoginPage = React.lazy(() => import('./pages/LoginPage'));
const AuthCallback = React.lazy(() => import('./pages/AuthCallback'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const StudentsPage = React.lazy(() => import('./pages/StudentsPage'));
const PlansPage = React.lazy(() => import('./pages/PlansPage'));
const AccessLogsPage = React.lazy(() => import('./pages/AccessLogsPage'));
const NotificationsPage = React.lazy(() => import('./pages/NotificationsPage'));
const CatracaPage = React.lazy(() => import('./pages/CatracaPage'));
const SubscriptionPage = React.lazy(() => import('./pages/SubscriptionPage'));
const BillingCenterPage = React.lazy(() => import('./pages/BillingCenterPage'));
const StaffPage = React.lazy(() => import('./pages/StaffPage'));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage'));
const PlatformAdminPage = React.lazy(() => import('./pages/PlatformAdminPage'));
const StudentContractsPage = React.lazy(() => import('./pages/StudentContractsPage'));
const StudentDashboardPage = React.lazy(() => import('./pages/StudentDashboardPage'));
const StudentBillingPage = React.lazy(() => import('./pages/StudentBillingPage'));

function SignupRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search || '');
  params.set('mode', 'register');
  return <Navigate to={`/login?${params.toString()}`} replace />;
}

function ProtectedRoute({ children }) {
  const token = getSessionToken();
  const [checking, setChecking] = React.useState(true);
  const [ok, setOk] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    const checkSession = async () => {
      try {
        const data = await api.me();
        const { token: refreshedToken, ...user } = data || {};
        storeSession(refreshedToken || token, user);
        if (active) {
          setOk(true);
        }
      } catch {
        clearSession();
        if (active) {
          setOk(false);
        }
      } finally {
        if (active) {
          setChecking(false);
        }
      }
    };

    checkSession();
    return () => {
      active = false;
    };
  }, [token]);

  if (checking) {
    return <LoadingScreen fullscreen label="Validando sessao..." />;
  }
  if (!ok) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function RoleRoute({ children, roles }) {
  const role = String(getStoredUser().role || '').toUpperCase();
  if (!role) return <Navigate to="/login" replace />;
  if (!roles.includes(role)) return <Navigate to={role === 'STUDENT' ? '/aluno' : '/admin'} replace />;
  return children;
}

function AdminPortalRoute({ children }) {
  const role = String(getStoredUser().role || '').toUpperCase();
  if (role === 'SUPER_ADMIN') return <Navigate to="/platform" replace />;
  if (role === 'STUDENT') return <Navigate to="/aluno" replace />;
  return children;
}

function SuperAdminRoute({ children }) {
  const role = String(getStoredUser().role || '').toUpperCase();
  if (role !== 'SUPER_ADMIN') return <Navigate to={role === 'STUDENT' ? '/aluno' : '/admin'} replace />;
  return children;
}

function StudentPortalRoute({ children }) {
  const role = String(getStoredUser().role || '').toUpperCase();
  if (role === 'SUPER_ADMIN') return <Navigate to="/platform" replace />;
  if (role !== 'STUDENT') return <Navigate to="/admin" replace />;
  return children;
}

function AppRouter() {
  const location = useLocation();
  if (location.hash?.includes('session_id=')) {
    return <AuthCallback />;
  }

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/signup" element={<SignupRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminPortalRoute>
              <AdminLayout />
            </AdminPortalRoute>
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="alunos" element={<StudentsPage />} />
        <Route path="contratos" element={<RoleRoute roles={['OWNER', 'MANAGER', 'RECEPTION']}><StudentContractsPage /></RoleRoute>} />
        <Route path="planos" element={<PlansPage />} />
        <Route path="acessos" element={<AccessLogsPage />} />
        <Route path="notificacoes" element={<NotificationsPage />} />
        <Route path="catraca" element={<RoleRoute roles={['OWNER', 'MANAGER', 'RECEPTION']}><CatracaPage /></RoleRoute>} />
        <Route path="funcionarios" element={<RoleRoute roles={['OWNER', 'MANAGER']}><StaffPage /></RoleRoute>} />
        <Route path="perfil" element={<ProfilePage />} />
        <Route path="assinatura" element={<RoleRoute roles={['OWNER', 'MANAGER']}><SubscriptionPage /></RoleRoute>} />
        <Route path="cobranca" element={<RoleRoute roles={['OWNER', 'MANAGER']}><BillingCenterPage /></RoleRoute>} />
      </Route>
      <Route
        path="/aluno"
        element={
          <ProtectedRoute>
            <StudentPortalRoute>
              <StudentLayout />
            </StudentPortalRoute>
          </ProtectedRoute>
        }
      >
        <Route index element={<StudentDashboardPage />} />
        <Route path="financeiro" element={<StudentBillingPage />} />
        <Route path="perfil" element={<ProfilePage />} />
      </Route>
      <Route
        path="/platform"
        element={
          <ProtectedRoute>
            <SuperAdminRoute>
              <PlatformAdminPage />
            </SuperAdminRoute>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const [branding, setBranding] = React.useState(() => loadBranding());

  React.useEffect(() => {
    migrateLegacySession();
  }, []);

  React.useEffect(() => {
    const onBrandingChange = (event) => {
      setBranding(event?.detail || loadBranding());
    };
    window.addEventListener('gymbro:branding-change', onBrandingChange);
    return () => window.removeEventListener('gymbro:branding-change', onBrandingChange);
  }, []);

  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors theme={branding.color_mode === 'light' ? 'light' : 'dark'} />
      <React.Suspense fallback={<LoadingScreen fullscreen label="Carregando aplicacao..." />}>
        <AppRouter />
      </React.Suspense>
    </BrowserRouter>
  );
}
