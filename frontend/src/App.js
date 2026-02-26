import React from 'react';
import { apiUrl } from './config';
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import AuthCallback from './pages/AuthCallback';
import Dashboard from './pages/Dashboard';
import StudentsPage from './pages/StudentsPage';
import PlansPage from './pages/PlansPage';
import AccessLogsPage from './pages/AccessLogsPage';
import NotificationsPage from './pages/NotificationsPage';
import CatracaPage from './pages/CatracaPage';
import SubscriptionPage from './pages/SubscriptionPage';
import BillingCenterPage from './pages/BillingCenterPage';
import StaffPage from './pages/StaffPage';
import ProfilePage from './pages/ProfilePage';
import PlatformAdminPage from './pages/PlatformAdminPage';
import AdminLayout from './components/AdminLayout';
import StudentLayout from './components/StudentLayout';
import StudentContractsPage from './pages/StudentContractsPage';
import StudentDashboardPage from './pages/StudentDashboardPage';
import StudentBillingPage from './pages/StudentBillingPage';

function AppRouter() {
  const location = useLocation();
  // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
  if (location.hash?.includes('session_id=')) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/signup" element={<SignupRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin" element={<ProtectedRoute><AdminPortalRoute><AdminLayout /></AdminPortalRoute></ProtectedRoute>}>
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
      <Route path="/aluno" element={<ProtectedRoute><StudentPortalRoute><StudentLayout /></StudentPortalRoute></ProtectedRoute>}>
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

function SignupRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search || '');
  params.set('mode', 'register');
  return <Navigate to={`/login?${params.toString()}`} replace />;
}

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('gymbro_token');
  const [checking, setChecking] = React.useState(true);
  const [ok, setOk] = React.useState(false);

  React.useEffect(() => {
    const checkSession = async () => {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        const res = await fetch(apiUrl('/api/auth/me'), { credentials: 'include', headers });
        if (res.ok) {
          const data = await res.json();
          localStorage.setItem('gymbro_user', JSON.stringify(data));
          if (!token && data?.token) {
            localStorage.setItem('gymbro_token', data.token);
          }
          setOk(true);
        } else {
          localStorage.removeItem('gymbro_token');
          localStorage.removeItem('gymbro_user');
          setOk(false);
        }
      } catch {
        setOk(false);
      }
      setChecking(false);
    };
    checkSession();
  }, [token]);

  if (checking) return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-lime-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!ok) return <Navigate to="/login" replace />;
  return children;
}

function RoleRoute({ children, roles }) {
  const user = JSON.parse(localStorage.getItem('gymbro_user') || '{}');
  const role = String(user.role || '').toUpperCase();
  if (!role) return <Navigate to="/login" replace />;
  if (!roles.includes(role)) return <Navigate to={role === 'STUDENT' ? '/aluno' : '/admin'} replace />;
  return children;
}

function AdminPortalRoute({ children }) {
  const user = JSON.parse(localStorage.getItem('gymbro_user') || '{}');
  const role = String(user.role || '').toUpperCase();
  if (role === 'SUPER_ADMIN') return <Navigate to="/platform" replace />;
  if (role === 'STUDENT') return <Navigate to="/aluno" replace />;
  return children;
}

function SuperAdminRoute({ children }) {
  const user = JSON.parse(localStorage.getItem('gymbro_user') || '{}');
  const role = String(user.role || '').toUpperCase();
  if (role !== 'SUPER_ADMIN') return <Navigate to={role === 'STUDENT' ? '/aluno' : '/admin'} replace />;
  return children;
}

function StudentPortalRoute({ children }) {
  const user = JSON.parse(localStorage.getItem('gymbro_user') || '{}');
  const role = String(user.role || '').toUpperCase();
  if (role === 'SUPER_ADMIN') return <Navigate to="/platform" replace />;
  if (role !== 'STUDENT') return <Navigate to="/admin" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors theme="dark" />
      <AppRouter />
    </BrowserRouter>
  );
}
