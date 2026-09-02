import React, { useEffect, useMemo, useRef, useState } from 'react';
import AccidentHeatmap from './AccidentHeatmap.jsx';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const isUnauthorizedResponse = (response) =>
  response?.status === 401 || response?.status === 403;

const resolveApiAssetUrl = (assetPath) => {
  const raw = String(assetPath || '').trim();
  if (!raw) {
    return '';
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return `${API_BASE_URL}${raw.startsWith('/') ? raw : `/${raw}`}`;
};

const formatNumber = (value) =>
  new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 1
  }).format(Number(value) || 0);

const formatPercent = (value) => `${formatNumber(value)}%`;

const toSafeArray = (value) => (Array.isArray(value) ? value : []);

const makePolylinePoints = (series, accessor, width, height) => {
  if (!series.length) {
    return '';
  }
  const values = series.map((item) => Number(accessor(item)) || 0);
  const max = Math.max(...values, 1);
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - (value / max) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
};

const SparklineCard = ({ title, subtitle, series, valueKey, accentClass = '' }) => {
  const rows = toSafeArray(series);
  const points = makePolylinePoints(rows, (item) => item?.[valueKey], 280, 92);

  return (
    <article className="arc-card">
      <div className="arc-card-head">
        <h3>{title}</h3>
        <small>{subtitle}</small>
      </div>
      <div className="arc-sparkline-wrap">
        <svg viewBox="0 0 280 92" className={`arc-sparkline ${accentClass}`} role="img" aria-label={title}>
          <defs>
            <linearGradient id={`gradient-${title.replace(/\s+/g, '-').toLowerCase()}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />
        </svg>
      </div>
      <div className="arc-series-list">
        {rows.slice(-4).map((row) => (
          <div key={`${title}-${row.month || row.day}`} className="arc-series-item">
            <span>{row.month || row.day}</span>
            <strong>{formatNumber(row?.[valueKey])}</strong>
          </div>
        ))}
        {!rows.length && <div className="text-muted small">Sin datos disponibles.</div>}
      </div>
    </article>
  );
};

const BreakdownBars = ({ title, values, labels }) => {
  const entries = labels.map((item) => ({
    key: item.key,
    label: item.label,
    value: Number(values?.[item.key] || 0)
  }));
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <article className="arc-card">
      <div className="arc-card-head">
        <h3>{title}</h3>
        <small>Distribucion porcentual</small>
      </div>
      <div className="arc-bars-list">
        {entries.map((entry) => {
          const pct = total ? (entry.value / total) * 100 : 0;
          return (
            <div key={`${title}-${entry.key}`} className="arc-bar-row">
              <div className="arc-bar-meta">
                <span>{entry.label}</span>
                <strong>{formatNumber(entry.value)}</strong>
              </div>
              <div className="arc-bar-track">
                <div className="arc-bar-fill" style={{ width: `${pct.toFixed(1)}%` }} />
              </div>
              <small>{formatPercent(pct)}</small>
            </div>
          );
        })}
      </div>
    </article>
  );
};

const SourceMixCard = ({ sourceBreakdown }) => {
  const original = Number(sourceBreakdown?.original || 0);
  const simulated = Number(sourceBreakdown?.simulated || 0);
  const citizen = Number(sourceBreakdown?.citizen || 0);
  const total = original + simulated + citizen;

  const segments = [
    { key: 'original', label: 'Dataset original', value: original, color: '#0f766e' },
    { key: 'simulated', label: 'Datos simulados', value: simulated, color: '#f97316' },
    { key: 'citizen', label: 'Reportes ciudadanos', value: citizen, color: '#2563eb' }
  ];

  return (
    <article className="arc-card">
      <div className="arc-card-head">
        <h3>Origen del dato</h3>
        <small>Trazabilidad de fuentes</small>
      </div>

      <div className="arc-stacked-track">
        {segments.map((segment) => {
          const widthPct = total ? (segment.value / total) * 100 : 0;
          return (
            <div
              key={segment.key}
              className="arc-stacked-part"
              style={{ width: `${widthPct.toFixed(2)}%`, background: segment.color }}
              title={`${segment.label}: ${segment.value}`}
            />
          );
        })}
      </div>

      <div className="arc-legend-grid mt-3">
        {segments.map((segment) => (
          <div key={segment.key} className="arc-legend-item">
            <span className="arc-dot" style={{ backgroundColor: segment.color }} />
            <span>{segment.label}</span>
            <strong>{formatNumber(segment.value)}</strong>
          </div>
        ))}
      </div>

      <div className="arc-data-note mt-2">
        <span>Original:</span> <strong>{formatPercent(sourceBreakdown?.originalPct || 0)}</strong>
        <span>Simulado:</span> <strong>{formatPercent(sourceBreakdown?.simulatedPct || 0)}</strong>
        <span>Ciudadano:</span> <strong>{formatPercent(sourceBreakdown?.citizenPct || 0)}</strong>
      </div>
    </article>
  );
};

const KpiCard = ({ label, value, hint, tone = 'default' }) => (
  <article className={`arc-kpi-card tone-${tone}`}>
    <small>{label}</small>
    <strong>{value}</strong>
    {hint && <span>{hint}</span>}
  </article>
);

export default function AdminDashboard({
  authToken,
  currentUser,
  onLogout,
  onOpenPredictions,
  onAuthExpired
}) {
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [approvingId, setApprovingId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [dashboardData, setDashboardData] = useState(null);
  const [verificationCodeData, setVerificationCodeData] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [activeSection, setActiveSection] = useState('metrics');
  const [dataset, setDataset] = useState('mixto');
  const [trafficSignals, setTrafficSignals] = useState([]);

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${authToken}`
    }),
    [authToken]
  );

  const ensureAuthorized = (response) => {
    if (isUnauthorizedResponse(response)) {
      onAuthExpired?.();
      throw new Error('Tu sesion expiro. Inicia sesion nuevamente.');
    }
    return response;
  };

  const loadMetricsAndCode = async ({ silent = false } = {}) => {
    // En refrescos silenciosos no activamos el estado de carga: asi el contenido
    // no se desmonta/remonta (el mapa, popups y scroll se mantienen intactos).
    if (!silent) {
      setLoadingMetrics(true);
      setErrorMessage('');
    }
    try {
      const [dashboardResponse, codeResponse] = await Promise.all([
        ensureAuthorized(
          await fetch(`${API_BASE_URL}/api/admin/dashboard?dataset=${encodeURIComponent(dataset)}`, {
            headers: authHeaders
          })
        ),
        ensureAuthorized(
          await fetch(`${API_BASE_URL}/api/admin/verification-code`, {
            headers: authHeaders
          })
        )
      ]);

      const dashboardPayload = await dashboardResponse.json();
      const codePayload = await codeResponse.json();

      if (!dashboardResponse.ok) {
        throw new Error(dashboardPayload.message || 'No se pudo cargar el dashboard.');
      }
      if (!codeResponse.ok) {
        throw new Error(codePayload.message || 'No se pudo cargar el codigo de verificacion.');
      }

      const nextDashboardData = dashboardPayload.data || null;
      setDashboardData(nextDashboardData);
      setVerificationCodeData(codePayload.data || null);
      setPendingCount(Number(nextDashboardData?.totals?.pendingReports || 0));
    } catch (error) {
      // Un fallo durante un refresco silencioso no debe interrumpir la vista.
      if (!silent) {
        setErrorMessage(error.message || 'No se pudo cargar la informacion administrativa.');
      }
    } finally {
      if (!silent) {
        setLoadingMetrics(false);
      }
    }
  };

  const loadPendingRequests = async ({ silent = false } = {}) => {
    if (!silent) {
      setLoadingRequests(true);
      setErrorMessage('');
    }
    try {
      const response = ensureAuthorized(
        await fetch(`${API_BASE_URL}/api/admin/reports/pending`, {
          headers: authHeaders
        })
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || 'No se pudieron cargar las solicitudes.');
      }

      const data = payload.data || {};
      setPendingRequests(Array.isArray(data.items) ? data.items : []);
      setPendingCount(Number(data.pendingCount || 0));
    } catch (error) {
      if (!silent) {
        setErrorMessage(error.message || 'No se pudieron cargar las solicitudes.');
      }
    } finally {
      if (!silent) {
        setLoadingRequests(false);
      }
    }
  };

  useEffect(() => {
    if (!authToken) {
      return;
    }
    loadMetricsAndCode();
    loadPendingRequests({ silent: true });
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      return;
    }
    const loadSignals = async () => {
      try {
        const response = ensureAuthorized(
          await fetch(`${API_BASE_URL}/api/traffic-signals?city=villavicencio`, { headers: authHeaders })
        );
        const payload = await response.json();
        setTrafficSignals(Array.isArray(payload.data) ? payload.data : []);
      } catch {
        setTrafficSignals([]);
      }
    };
    loadSignals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  // Al cambiar de base de datos, recarga las metricas en modo silencioso (sin
  // desmontar el contenido), evitando el parpadeo del dashboard.
  const datasetInitRef = useRef(true);
  useEffect(() => {
    if (datasetInitRef.current) {
      datasetInitRef.current = false;
      return;
    }
    if (authToken) {
      loadMetricsAndCode({ silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset]);

  useEffect(() => {
    if (!authToken) {
      return undefined;
    }

    const refreshId = setInterval(() => {
      loadPendingRequests({ silent: true });
      if (activeSection === 'metrics') {
        loadMetricsAndCode({ silent: true });
      }
    }, 15000);

    return () => clearInterval(refreshId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, activeSection, dataset]);

  const handleRegenerateCode = async () => {
    setRegenerating(true);
    setErrorMessage('');
    try {
      const response = ensureAuthorized(
        await fetch(`${API_BASE_URL}/api/admin/verification-code/regenerate`, {
          method: 'POST',
          headers: authHeaders
        })
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || 'No se pudo generar un nuevo codigo.');
      }

      setVerificationCodeData(payload.data || null);
    } catch (error) {
      setErrorMessage(error.message || 'No se pudo generar un nuevo codigo.');
    } finally {
      setRegenerating(false);
    }
  };

  const handleApproveRequest = async (reportId) => {
    setApprovingId(reportId);
    setErrorMessage('');
    try {
      const response = ensureAuthorized(
        await fetch(`${API_BASE_URL}/api/admin/reports/${reportId}/approve`, {
          method: 'POST',
          headers: authHeaders
        })
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || 'No se pudo aprobar la solicitud.');
      }

      await loadPendingRequests({ silent: true });
      await loadMetricsAndCode();
    } catch (error) {
      setErrorMessage(error.message || 'No se pudo aprobar la solicitud.');
    } finally {
      setApprovingId('');
    }
  };

  const totals = dashboardData?.totals || {};
  const today = dashboardData?.today || {};
  const topQueryUsers = toSafeArray(dashboardData?.topQueryUsers);
  const accidents = dashboardData?.accidents || {};
  const accidentTotals = accidents?.totals || {};
  const sourceBreakdown = accidents?.sourceBreakdown || {};
  const quality = accidents?.quality || {};
  const coverage = quality?.coverage || {};
  const monthlySeries = toSafeArray(accidents?.monthlySeries);
  const topRiskRoads = toSafeArray(accidents?.topRiskRoads);
  const model = dashboardData?.model || null;
  const modelAvg = model?.averageMetrics || null;
  const heatmap = accidents?.heatmap || null;
  const heatmapPoints = toSafeArray(heatmap?.points);

  return (
    <div className="container py-4">
      <div className="app-topbar mb-4">
        <div>
          <strong>{currentUser?.username}</strong> (admin)
        </div>
        <div className="d-flex gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onOpenPredictions}
            disabled={loadingMetrics}
          >
            Ir a predicciones
          </button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onLogout}>
            Cerrar sesion
          </button>
        </div>
      </div>

      <div className="admin-section-tabs mb-3">
        <button
          type="button"
          className={`btn btn-sm ${activeSection === 'metrics' ? 'btn-primary' : 'btn-outline-primary'}`}
          onClick={() => setActiveSection('metrics')}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeSection === 'requests' ? 'btn-primary' : 'btn-outline-primary'}`}
          onClick={() => {
            setActiveSection('requests');
            loadPendingRequests();
          }}
        >
          Solicitudes
          {pendingCount > 0 && <span className="admin-badge-count">{pendingCount}</span>}
        </button>
      </div>

      {errorMessage && (
        <div className="alert alert-danger py-2" role="alert">
          {errorMessage}
        </div>
      )}

      {activeSection === 'metrics' && (
        <div className="d-flex align-items-center flex-wrap gap-2 mb-3">
          <label className="form-label filter-label mb-0">Base de datos:</label>
          <select
            className="form-select form-select-sm"
            style={{ maxWidth: '260px' }}
            value={dataset}
            onChange={(event) => setDataset(event.target.value)}
          >
            <option value="mixto">Mixta (real + sintetica)</option>
            <option value="real">Solo datos reales</option>
            <option value="sintetico">Solo datos sinteticos</option>
          </select>
          {accidents?.totals?.total !== undefined && (
            <span className="text-muted small">
              {formatNumber(accidents.totals.total)} eventos en esta base
            </span>
          )}
        </div>
      )}

      {activeSection === 'metrics' && (
        <>
          <section className="arc-header-shell mb-4">
            <div className="arc-header-title">
              <h1>Centro de Situacion Vial</h1>
              <p>Panel tecnico de accidentalidad y calidad de datos para Villavicencio</p>
            </div>
            <div className="arc-header-actions">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={loadMetricsAndCode}
                disabled={loadingMetrics}
              >
                Actualizar
              </button>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={handleRegenerateCode}
                disabled={regenerating}
              >
                {regenerating ? 'Generando...' : 'Regenerar codigo'}
              </button>
            </div>
          </section>

          <section className="arc-verification mb-4">
            <div>
              <small>Codigo de verificacion activo</small>
              <div className="verification-code-box mt-2">
                {verificationCodeData?.code || 'No disponible'}
              </div>
              {verificationCodeData?.createdAt && (
                <span className="text-muted small d-block mt-2">
                  Creado: {new Date(verificationCodeData.createdAt).toLocaleString()}
                </span>
              )}
            </div>
            <div className="arc-quality-pill">
              <small>Confiabilidad del sistema</small>
              <strong>{formatPercent(quality?.dataConfidence || 0)}</strong>
              <span>Indice compuesto de fuente observada y cobertura de atributos</span>
            </div>
          </section>

          {model && (
            <section className="card border-0 shadow-sm mb-4">
              <div className="card-body">
                <div className="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
                  <h6 className="panel-title mb-0">Desempeno del modelo de prediccion</h6>
                  <span
                    className={`badge rounded-pill ${
                      model.isDataDriven ? 'text-bg-success' : 'text-bg-secondary'
                    }`}
                  >
                    {model.sourceLabel || model.source}
                  </span>
                </div>
                {model.dataset && (
                  <p className="text-muted small mb-3">
                    Entrenado con {formatNumber(model.dataset.sampleSize)} accidentes reales sobre una
                    grilla de {model.dataset.gridRows}x{model.dataset.gridCols} zonas (
                    {formatPercent(model.dataset.coveragePct || 0)} con datos historicos).
                  </p>
                )}
                {model.source === 'synthetic_model' && (
                  <p className="text-warning small mb-3">
                    No hay accidentes en la base de datos. El modelo opera en modo demostracion; ejecuta
                    el seed para entrenar con datos reales.
                  </p>
                )}
                {modelAvg && model.source !== 'geojson' && (
                  <div className="arc-kpi-grid">
                    <KpiCard
                      label="Exactitud (accuracy)"
                      value={formatPercent((modelAvg.accuracy || 0) * 100)}
                      hint="Promedio leve/medio/grave en test"
                    />
                    <KpiCard
                      label="Precision"
                      value={formatPercent((modelAvg.precision || 0) * 100)}
                      hint="Aciertos sobre zonas marcadas de riesgo"
                    />
                    <KpiCard
                      label="Sensibilidad (recall)"
                      value={formatPercent((modelAvg.recall || 0) * 100)}
                      hint="Cobertura de zonas realmente criticas"
                      tone="alert"
                    />
                    <KpiCard
                      label="F1-score"
                      value={(modelAvg.f1 || 0).toFixed(2)}
                      hint="Balance precision-recall"
                    />
                  </div>
                )}
              </div>
            </section>
          )}

          {loadingMetrics && <div className="text-muted">Cargando dashboard...</div>}

          {!loadingMetrics && (
            <>
              <section className="arc-kpi-grid mb-4">
                <KpiCard
                  label="Eventos de accidentalidad"
                  value={formatNumber(accidentTotals?.total)}
                  hint="Registros consolidados"
                />
                <KpiCard
                  label="Fatalidades historicas"
                  value={formatNumber(accidentTotals?.fatalities)}
                  hint={`Tasa ${formatPercent(accidentTotals?.fatalityRatePct || 0)}`}
                  tone="danger"
                />
                <KpiCard
                  label="Eventos ultimos 30 dias"
                  value={formatNumber(accidentTotals?.accidentsLast30d)}
                  hint={`${formatNumber(accidentTotals?.fatalitiesLast30d)} fatalidades`}
                  tone="alert"
                />
                <KpiCard
                  label="Promedio mensual"
                  value={formatNumber(accidentTotals?.averageMonthlyAccidents)}
                  hint={`Pico: ${accidentTotals?.peakMonth?.month || 'N/D'}`}
                />
                <KpiCard
                  label="Cobertura clima"
                  value={formatPercent(coverage?.weatherPct || 0)}
                  hint="Eventos con etiqueta meteorologica"
                  tone="success"
                />
                <KpiCard
                  label="Cobertura segmento vial"
                  value={formatPercent(coverage?.linkedRoadSegmentPct || 0)}
                  hint="Eventos vinculados a corredor"
                  tone="success"
                />
                <KpiCard
                  label="Cobertura periodo"
                  value={formatPercent(coverage?.periodPct || 0)}
                  hint="Eventos con etiqueta dia/noche"
                  tone="success"
                />
                <KpiCard
                  label="Reportes validados hoy"
                  value={formatNumber(totals?.approvedReportsToday)}
                  hint={`${formatNumber(totals?.pendingReports)} pendientes`}
                />
                <KpiCard
                  label="Usuarios registrados"
                  value={formatNumber(totals?.totalUsers)}
                  hint={`${formatNumber(totals?.totalAdmins)} administradores`}
                />
                <KpiCard
                  label="Consultas de prediccion"
                  value={formatNumber(totals?.totalPredictionQueries)}
                  hint={`Hoy: ${formatNumber(today?.predictionQueries)}`}
                />
              </section>

              <section className="arc-analytics-grid mb-4">
                <SparklineCard
                  title="Tendencia mensual"
                  subtitle="Eventos y variacion de carga"
                  series={monthlySeries}
                  valueKey="total"
                />
                <SparklineCard
                  title="Fatalidades por mes"
                  subtitle="Seguimiento de criticidad"
                  series={monthlySeries}
                  valueKey="fatalities"
                  accentClass="danger"
                />
                <SourceMixCard sourceBreakdown={sourceBreakdown} />
              </section>

              <section className="arc-analytics-grid mb-4">
                <BreakdownBars
                  title="Severidad"
                  values={accidents?.severityBreakdown}
                  labels={[
                    { key: 'baja', label: 'Baja' },
                    { key: 'media', label: 'Media' },
                    { key: 'alta', label: 'Alta' },
                    { key: 'fatal', label: 'Fatal' }
                  ]}
                />
                <BreakdownBars
                  title="Condicion climatica"
                  values={accidents?.weatherBreakdown}
                  labels={[
                    { key: 'lluvia', label: 'Lluvia' },
                    { key: 'no_lluvia', label: 'Sin lluvia' },
                    { key: 'desconocido', label: 'Desconocido' }
                  ]}
                />
                <BreakdownBars
                  title="Periodo del evento"
                  values={accidents?.periodBreakdown}
                  labels={[
                    { key: 'dia', label: 'Dia' },
                    { key: 'noche', label: 'Noche' },
                    { key: 'desconocido', label: 'Desconocido' }
                  ]}
                />
              </section>

              <section className="arc-card mb-4">
                <div className="arc-card-head">
                  <h3>Mapa de calor de accidentalidad</h3>
                  <small>
                    Densidad real de siniestros ponderada por gravedad
                    {heatmapPoints.length ? ` - ${formatNumber(heatmapPoints.length)} zonas con eventos` : ''}
                  </small>
                </div>
                <AccidentHeatmap
                  center={heatmap?.center}
                  zoom={heatmap?.zoom || 12}
                  points={heatmapPoints}
                  signals={trafficSignals}
                />
              </section>

              <section className="arc-card mb-4">
                <div className="arc-card-head">
                  <h3>Corredores con mayor riesgo</h3>
                  <small>Top de segmentos viales por frecuencia y criticidad</small>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Corredor</th>
                        <th>Tipo</th>
                        <th>Eventos</th>
                        <th>Fatalidades</th>
                        <th>Riesgo ponderado</th>
                        <th>Coordenada centroide</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!topRiskRoads.length && (
                        <tr>
                          <td colSpan={6} className="text-muted">Sin datos de segmentos viales.</td>
                        </tr>
                      )}
                      {topRiskRoads.map((segment) => (
                        <tr key={`${segment.name}-${segment.latitude}-${segment.longitude}`}>
                          <td>{segment.name}</td>
                          <td>{segment.highwayType}</td>
                          <td><strong>{formatNumber(segment.total)}</strong></td>
                          <td>{formatNumber(segment.fatalities)}</td>
                          <td>{formatNumber(segment.weightedRisk)}</td>
                          <td>
                            {Number(segment.latitude).toFixed(5)}, {Number(segment.longitude).toFixed(5)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="arc-card">
                <div className="arc-card-head">
                  <h3>Usuarios con mas consultas</h3>
                  <small>Actividad analitica del sistema</small>
                </div>
                <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
                  {!topQueryUsers.length && (
                    <li className="text-muted">Aun no hay consultas registradas.</li>
                  )}
                  {topQueryUsers.map((row) => (
                    <li key={row.username} className="d-flex justify-content-between">
                      <span>{row.username}</span>
                      <strong>{row.totalQueries}</strong>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </>
      )}

      {activeSection === 'requests' && (
        <>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h2 className="h5 mb-0">Solicitudes pendientes ({pendingCount})</h2>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => loadPendingRequests()}
              disabled={loadingRequests}
            >
              Actualizar
            </button>
          </div>

          {loadingRequests && <div className="text-muted">Cargando solicitudes...</div>}

          {!loadingRequests && (
            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <div className="d-flex flex-column gap-3">
                  {pendingRequests.length === 0 && (
                    <div className="text-muted">No hay solicitudes pendientes en este momento.</div>
                  )}

                  {pendingRequests.map((request) => (
                    <article key={request.id} className="request-item">
                      <div className="d-flex justify-content-between align-items-start gap-3">
                        <div className="flex-fill">
                          <div className="d-flex flex-wrap gap-2 align-items-center mb-1">
                            <span className="badge bg-dark">
                              {String(request.severity || 'media').toUpperCase()}
                            </span>
                            <small className="text-muted">
                              Reportado: {new Date(request.createdAt).toLocaleString()}
                            </small>
                          </div>
                          <div>{request.description}</div>
                          <small className="text-muted d-block mt-1">
                            Usuario: {request.reportedBy || 'N/D'}
                          </small>
                          <small className="text-muted d-block">
                            Coordenadas: {Number(request.latitude).toFixed(5)}, {Number(request.longitude).toFixed(5)}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="btn btn-success btn-sm flex-shrink-0"
                          onClick={() => handleApproveRequest(request.id)}
                          disabled={approvingId === request.id}
                        >
                          {approvingId === request.id ? 'Aprobando...' : 'Aprobar'}
                        </button>
                      </div>

                      {request.evidenceUrl && (
                        <div className="request-evidence mt-2">
                          <img
                            src={resolveApiAssetUrl(request.evidenceUrl)}
                            alt="Evidencia del reporte"
                            className="request-evidence-image"
                          />
                          <a
                            href={resolveApiAssetUrl(request.evidenceUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="small"
                          >
                            Abrir imagen
                          </a>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
