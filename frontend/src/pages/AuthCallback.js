import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function AuthCallback() {
  const navigate = useNavigate();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = window.location.hash;
    const match = hash.match(/session_id=([^&]+)/);
    if (!match) {
      navigate('/login', { replace: true });
      return;
    }

    const sessionId = match[1];
    (async () => {
      try {
        const result = await api.googleSession(sessionId);
        localStorage.setItem('gymbro_user', JSON.stringify(result.user));
        if (result.session_token) {
          localStorage.setItem('gymbro_token', result.session_token);
        }
        navigate('/admin', { replace: true });
      } catch {
        navigate('/login', { replace: true });
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-zinc-400">Autenticando...</p>
      </div>
    </div>
  );
}
