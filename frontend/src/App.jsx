import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { io } from 'socket.io-client';
import FilterPanel from './components/FilterPanel.jsx';
import ReportForm from './components/ReportForm.jsx';
import Legend from './components/Legend.jsx';
import StreetViewExplorer from './components/StreetViewExplorer.jsx';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

const initialFilters = {
  date: '',
  hour: '',
  weather: 'todos',
  period: 'todos'
};

const defaultCenter = {
  longitude: -73.6294,
  latitude: 4.1425,
  zoom: 13
};

const maxItems = 120;

const matchesFilters = (prediction, filters) => {
  if (!prediction) {
    return false;
  }
  if (filters.date && prediction.date !== filters.date) {
    return false;
  }
  if (filters.hour) {
    const selectedHour = parseInt(filters.hour.split(':')[0], 10);
    const predictionHour = parseInt(prediction.hour.split(':')[0], 10);
    if (predictionHour !== selectedHour) {
      return false;
    }
  }
  if (filters.weather !== 'todos' && prediction.weather !== filters.weather) {
    return false;
  }
  if (filters.period !== 'todos' && prediction.period !== filters.period) {
    return false;
  }
  return true;
};

const addUnique = (collection, item) => {
  if (!item) {
    return collection;
  }
  const exists = collection.some((element) => element.id === item.id);
  if (exists) {
    return collection;
  }
  return [item, ...collection].slice(0, maxItems);
};

const getRiskClassName = (riskScore) => {
  if (riskScore >= 0.75) return 'badge-risk-high';
  if (riskScore >= 0.55) return 'badge-risk-medium';
  return 'badge-risk-low';
};

const severityColor = {
  alta: '#dc3545',
  media: '#fd7e14',
  baja: '#0d6efd'
};

const MapBoundsController = ({ predictions, reports }) => {
  const map = useMap();

  const bounds = useMemo(() => {
    const points = [];
    predictions.forEach((prediction) => {
      if (typeof prediction.latitude === 'number' && typeof prediction.longitude === 'number') {
        points.push([prediction.latitude, prediction.longitude]);
      }
    });
    reports.forEach((report) => {
      if (typeof report.latitude === 'number' && typeof report.longitude === 'number') {
        points.push([report.latitude, report.longitude]);
      }
    });
    return points;
  }, [predictions, reports]);

  useEffect(() => {
    if (bounds.length === 0) {
      map.setView([defaultCenter.latitude, defaultCenter.longitude], defaultCenter.zoom);
      return;
    }
    map.fitBounds(bounds, { padding: [32, 32] });
  }, [bounds, map]);

  return null;
};

export default function App() {
  const filtersRef = useRef(initialFilters);

  const [filters, setFilters] = useState(initialFilters);
  const [predictions, setPredictions] = useState([]);
  const [reports, setReports] = useState([]);
  const [loadingPredictions, setLoadingPredictions] = useState(false);
  const [submittingReport, setSubmittingReport] = useState(false);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const fetchPredictions = async (currentFilters) => {
    setLoadingPredictions(true);
    try {
      const params = new URLSearchParams();
      if (currentFilters.date) params.append('date', currentFilters.date);
      if (currentFilters.hour) params.append('hour', currentFilters.hour);
      if (currentFilters.weather && currentFilters.weather !== 'todos') params.append('weather', currentFilters.weather);
      if (currentFilters.period && currentFilters.period !== 'todos') params.append('period', currentFilters.period);

      const url = `${API_BASE_URL}/api/predictions${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetch(url);
      const { data } = await response.json();
      setPredictions(data || []);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('No se pudieron obtener las predicciones', error);
    } finally {
      setLoadingPredictions(false);
    }
  };

  const fetchReports = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/reports`);
      const { data } = await response.json();
      setReports(data || []);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('No se pudieron obtener los reportes', error);
    }
  };

  useEffect(() => {
    fetchPredictions(filters);
  }, [filters]);

  useEffect(() => {
    fetchReports();
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket']
    });

    socket.on('init', ({ reports: initialReports = [], predictions: recentPredictions = [] }) => {
      setReports((current) => {
        const combined = [...initialReports, ...current];
        const unique = [];
        combined.forEach((report) => {
          if (!unique.some((item) => item.id === report.id)) {
            unique.push(report);
          }
        });
        return unique.slice(0, maxItems);
      });

      setPredictions((current) => {
        const combined = [...recentPredictions, ...current];
        const unique = [];
        combined.forEach((prediction) => {
          if (matchesFilters(prediction, filtersRef.current) && !unique.some((item) => item.id === prediction.id)) {
            unique.push(prediction);
          }
        });
        return unique.slice(0, maxItems);
      });
    });

    socket.on('report:new', (report) => {
      setReports((current) => addUnique(current, report));
    });

    socket.on('prediction:new', (prediction) => {
      setPredictions((current) => {
        if (!matchesFilters(prediction, filtersRef.current)) {
          return current;
        }
        return addUnique(current, prediction);
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleFilterChange = (nextFilters) => {
    setFilters(nextFilters);
  };

  const handleFilterReset = () => {
    setFilters(initialFilters);
  };

  const handleReportSubmit = async (payload) => {
    setSubmittingReport(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Error al enviar el reporte');
      }

      const saved = await response.json();
      setReports((current) => addUnique(current, saved));
      return saved;
    } catch (error) {
      throw error;
    } finally {
      setSubmittingReport(false);
    }
  };

  return (
    <div className="container py-4">
      <div className="d-flex flex-column flex-lg-row gap-4">
        <div className="flex-fill">
          <FilterPanel
            filters={filters}
            onFilterChange={handleFilterChange}
            onReset={handleFilterReset}
            loading={loadingPredictions}
          />
          <div className="map-container">
            <MapContainer
              center={[defaultCenter.latitude, defaultCenter.longitude]}
              zoom={defaultCenter.zoom}
              className="leaflet-map"
              scrollWheelZoom
            >
              <TileLayer
                attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapBoundsController predictions={predictions} reports={reports} />
              {predictions
                .filter(
                  (prediction) => typeof prediction.latitude === 'number' && typeof prediction.longitude === 'number'
                )
                .map((prediction) => (
                  <CircleMarker
                    key={`prediction-${prediction.id}`}
                    center={[prediction.latitude, prediction.longitude]}
                    radius={8}
                    pathOptions={{
                      color: prediction.riskScore >= 0.75 ? '#dc3545' : prediction.riskScore >= 0.55 ? '#ffc107' : '#198754',
                      weight: 2,
                      fillColor:
                        prediction.riskScore >= 0.75
                          ? 'rgba(220, 53, 69, 0.6)'
                          : prediction.riskScore >= 0.55
                          ? 'rgba(255, 193, 7, 0.6)'
                          : 'rgba(25, 135, 84, 0.6)',
                      fillOpacity: 0.8
                    }}
                  >
                    <Popup>
                      <strong>Riesgo {Math.round(prediction.riskScore * 100)}%</strong>
                      <br />
                      Segmento: {prediction.roadSegment}
                      <br />
                      Fecha: {prediction.date}
                      <br />
                      Hora: {prediction.hour}
                      <br />
                      Clima: {prediction.weather === 'lluvia' ? 'Lluvia' : 'Sin lluvia'}
                      <br />
                      Periodo: {prediction.period === 'dia' ? 'Día' : 'Noche'}
                    </Popup>
                  </CircleMarker>
                ))}
              {reports
                .filter((report) => typeof report.latitude === 'number' && typeof report.longitude === 'number')
                .map((report) => (
                  <CircleMarker
                    key={`report-${report.id}`}
                    center={[report.latitude, report.longitude]}
                    radius={10}
                    pathOptions={{
                      color: severityColor[report.severity] || '#000000',
                      weight: 2,
                      fillColor: (severityColor[report.severity] || '#000000') + 'b3',
                      fillOpacity: 0.8
                    }}
                  >
                    <Popup>
                      <strong>Reporte ciudadano</strong>
                      <br />
                      Severidad: {report.severity}
                      <br />
                      Descripción: {report.description}
                      <br />
                      Registrado: {new Date(report.createdAt).toLocaleString()}
                    </Popup>
                  </CircleMarker>
                ))}
            </MapContainer>
          </div>
          <StreetViewExplorer />
        </div>
        <div className="flex-shrink-0" style={{ minWidth: '320px', maxWidth: '380px' }}>
          <Legend />
          <div className="mt-4">
            <ReportForm onSubmit={handleReportSubmit} submitting={submittingReport} />
          </div>
          <div className="card border-0 shadow-sm mt-4">
            <div className="card-body">
              <h6 className="text-uppercase text-muted small mb-3">Predicciones activas</h6>
              <ul className="list-unstyled d-flex flex-column gap-3 mb-0" style={{ maxHeight: '260px', overflowY: 'auto' }}>
                {predictions.length === 0 && (
                  <li className="text-muted">No hay predicciones para los filtros seleccionados.</li>
                )}
                {predictions.map((prediction) => (
                  <li key={prediction.id} className="timeline-entry">
                    <div className="d-flex align-items-center justify-content-between">
                      <strong>{prediction.roadSegment}</strong>
                      <span className={`badge rounded-pill ${getRiskClassName(prediction.riskScore)}`}>
                        {Math.round(prediction.riskScore * 100)}%
                      </span>
                    </div>
                    <div className="text-muted small">
                      {prediction.date} · {prediction.hour} ·{' '}
                      {prediction.weather === 'lluvia' ? 'Lluvia' : 'Sin lluvia'} ·{' '}
                      {prediction.period === 'dia' ? 'Día' : 'Noche'}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="card border-0 shadow-sm mt-4">
            <div className="card-body">
              <h6 className="text-uppercase text-muted small mb-3">Reportes ciudadanos</h6>
              <ul className="list-unstyled d-flex flex-column gap-3 mb-0" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                {reports.length === 0 && <li className="text-muted">Aún no hay reportes recientes.</li>}
                {reports.map((report) => (
                  <li key={report.id} className="timeline-entry">
                    <div className="d-flex align-items-center justify-content-between">
                      <strong>{report.severity.toUpperCase()}</strong>
                      <span className="badge rounded-pill bg-dark text-white">Reporte</span>
                    </div>
                    <div className="text-muted small">{report.description}</div>
                    <div className="text-muted small">
                      {new Date(report.createdAt).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
