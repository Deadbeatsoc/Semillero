import React, { useState } from 'react';

export default function AuthScreen({ onLogin, onRegister, loading, errorMessage }) {
  const [activeTab, setActiveTab] = useState('login');
  const [loginForm, setLoginForm] = useState({
    username: '',
    password: ''
  });
  const [registerForm, setRegisterForm] = useState({
    username: '',
    password: '',
    verificationCode: ''
  });

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    await onLogin(loginForm);
  };

  const handleRegisterSubmit = async (event) => {
    event.preventDefault();
    await onRegister(registerForm);
  };

  return (
    <div className="auth-shell container py-5">
      <div className="row justify-content-center">
        <div className="col-12 col-md-9 col-lg-6">
          <div className="card border-0 shadow auth-card">
            <div className="card-body p-4 p-lg-5">
              <h1 className="h4 mb-1">Acceso al sistema</h1>
              <p className="text-muted mb-4">
                Inicia sesion o crea cuenta con el codigo de verificacion entregado por el administrador.
              </p>

              <div className="btn-group w-100 mb-4" role="tablist" aria-label="Tabs autenticacion">
                <button
                  type="button"
                  className={`btn ${activeTab === 'login' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setActiveTab('login')}
                  disabled={loading}
                >
                  Iniciar sesion
                </button>
                <button
                  type="button"
                  className={`btn ${activeTab === 'register' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setActiveTab('register')}
                  disabled={loading}
                >
                  Crear cuenta
                </button>
              </div>

              {errorMessage && (
                <div className="alert alert-danger py-2" role="alert">
                  {errorMessage}
                </div>
              )}

              {activeTab === 'login' && (
                <form className="d-flex flex-column gap-3" onSubmit={handleLoginSubmit}>
                  <div>
                    <label className="form-label">Usuario</label>
                    <input
                      className="form-control"
                      value={loginForm.username}
                      onChange={(event) =>
                        setLoginForm((current) => ({
                          ...current,
                          username: event.target.value
                        }))
                      }
                      autoComplete="username"
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Contrasena</label>
                    <input
                      className="form-control"
                      type="password"
                      value={loginForm.password}
                      onChange={(event) =>
                        setLoginForm((current) => ({
                          ...current,
                          password: event.target.value
                        }))
                      }
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <button className="btn btn-primary w-100" type="submit" disabled={loading}>
                    {loading ? 'Validando...' : 'Entrar'}
                  </button>
                </form>
              )}

              {activeTab === 'register' && (
                <form className="d-flex flex-column gap-3" onSubmit={handleRegisterSubmit}>
                  <div>
                    <label className="form-label">Usuario</label>
                    <input
                      className="form-control"
                      value={registerForm.username}
                      onChange={(event) =>
                        setRegisterForm((current) => ({
                          ...current,
                          username: event.target.value
                        }))
                      }
                      autoComplete="username"
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Contrasena</label>
                    <input
                      className="form-control"
                      type="password"
                      value={registerForm.password}
                      onChange={(event) =>
                        setRegisterForm((current) => ({
                          ...current,
                          password: event.target.value
                        }))
                      }
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Codigo de verificacion</label>
                    <input
                      className="form-control"
                      value={registerForm.verificationCode}
                      onChange={(event) =>
                        setRegisterForm((current) => ({
                          ...current,
                          verificationCode: event.target.value
                        }))
                      }
                      placeholder="Codigo entregado por admin"
                      required
                    />
                  </div>
                  <button className="btn btn-primary w-100" type="submit" disabled={loading}>
                    {loading ? 'Creando...' : 'Crear y entrar'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
