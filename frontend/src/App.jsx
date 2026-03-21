import React, { useEffect, useState } from 'react';
import AdminDashboard from './components/AdminDashboard.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import PredictionWorkspace from './components/PredictionWorkspace.jsx';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const STORAGE_TOKEN_KEY = 'traffic_app_auth_token';
const STORAGE_USER_KEY = 'traffic_app_auth_user';

const safeParseUser = (value) => {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export default function App() {
  const [authToken, setAuthToken] = useState(() => localStorage.getItem(STORAGE_TOKEN_KEY) || '');
  const [currentUser, setCurrentUser] = useState(() =>
    safeParseUser(localStorage.getItem(STORAGE_USER_KEY))
  );
  const [checkingSession, setCheckingSession] = useState(Boolean(authToken));
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [adminView, setAdminView] = useState('dashboard');

  const persistSession = (token, user) => {
    setAuthToken(token);
    setCurrentUser(user);
    localStorage.setItem(STORAGE_TOKEN_KEY, token);
    localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user));
  };

  const clearSession = () => {
    setAuthToken('');
    setCurrentUser(null);
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_USER_KEY);
    setAdminView('dashboard');
  };

  const fetchSessionUser = async (token) => {
    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!response.ok) {
      throw new Error('Sesion no valida.');
    }
    const payload = await response.json();
    return payload.user || null;
  };

  const registerVisit = async (token, source = 'login') => {
    try {
      await fetch(`${API_BASE_URL}/api/activity/visit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ source })
      });
    } catch {
      // No bloqueamos la UI por fallas de telemetria.
    }
  };

  useEffect(() => {
    let isMounted = true;

    const validateSession = async () => {
      if (!authToken) {
        if (isMounted) {
          setCheckingSession(false);
        }
        return;
      }

      try {
        const user = await fetchSessionUser(authToken);
        if (!isMounted || !user) {
          return;
        }
        setCurrentUser(user);
        localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user));
        await registerVisit(authToken, 'session_restore');
      } catch {
        if (!isMounted) {
          return;
        }
        clearSession();
      } finally {
        if (isMounted) {
          setCheckingSession(false);
        }
      }
    };

    validateSession();
    return () => {
      isMounted = false;
    };
  }, [authToken]);

  const handleAuthAction = async (endpoint, body, successView = 'dashboard') => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || 'No se pudo completar la autenticacion.');
      }

      if (!payload.token || !payload.user) {
        throw new Error('Respuesta de autenticacion incompleta.');
      }

      persistSession(payload.token, payload.user);
      setAdminView(successView);
    } catch (error) {
      setAuthError(error.message || 'No se pudo completar la autenticacion.');
    } finally {
      setAuthLoading(false);
      setCheckingSession(false);
    }
  };

  const handleLogin = async ({ username, password }) =>
    handleAuthAction(
      '/api/auth/login',
      {
        username,
        password
      },
      'dashboard'
    );

  const handleRegister = async ({ username, password, verificationCode }) =>
    handleAuthAction(
      '/api/auth/register',
      {
        username,
        password,
        verificationCode
      },
      'predictions'
    );

  const handleLogout = async () => {
    const token = authToken;
    clearSession();
    if (!token) {
      return;
    }

    try {
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
    } catch {
      // El usuario ya quedo desconectado en frontend.
    }
  };

  const handleAuthExpired = () => {
    clearSession();
    setAuthError('Tu sesion expiro. Inicia sesion de nuevo.');
  };

  if (checkingSession) {
    return (
      <div className="container py-5 text-center text-muted">
        Validando sesion...
      </div>
    );
  }

  if (!currentUser || !authToken) {
    return (
      <AuthScreen
        onLogin={handleLogin}
        onRegister={handleRegister}
        loading={authLoading}
        errorMessage={authError}
      />
    );
  }

  if (currentUser.role === 'admin' && adminView === 'dashboard') {
    return (
      <AdminDashboard
        authToken={authToken}
        currentUser={currentUser}
        onLogout={handleLogout}
        onOpenPredictions={() => setAdminView('predictions')}
        onAuthExpired={handleAuthExpired}
      />
    );
  }

  return (
    <PredictionWorkspace
      authToken={authToken}
      currentUser={currentUser}
      onOpenAdmin={currentUser.role === 'admin' ? () => setAdminView('dashboard') : null}
      onLogout={handleLogout}
      onAuthExpired={handleAuthExpired}
    />
  );
}
