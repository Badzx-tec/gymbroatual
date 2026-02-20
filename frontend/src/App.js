import React from 'react';
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import AuthCallback from './pages/AuthCallback';
import Dashboard from './pages/Dashboard';
import StudentsPage from './pages/StudentsPage';
import PlansPage from './pages/PlansPage';
import AccessLogsPage from './pages/AccessLogsPage';
import AdminLayout from './components/AdminLayout';

function AppRouter() {
  const location = useLocation();
  // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
  if (location.hash?.includes('session_id=')) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="alunos" element={<StudentsPage />} />
        <Route path="planos" element={<PlansPage />} />
        <Route path="acessos" element={<AccessLogsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('gymbro_token');
  const [checking, setChecking] = React.useState(!token);
  const [ok, setOk] = React.useState(!!token);

  React.useEffect(() => {
    if (token) return;
    const checkCookie = async () => {
      try {
        const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/auth/me`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          localStorage.setItem('gymbro_user', JSON.stringify(data));
          setOk(true);
        } else {
          setOk(false);
        }
      } catch {
        setOk(false);
      }
      setChecking(false);
    };
    checkCookie();
  }, [token]);

  if (checking) return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-lime-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!ok) return <Navigate to="/login" replace />;
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
