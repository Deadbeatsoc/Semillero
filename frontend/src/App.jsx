import React, { useEffect, useRef, useState } from 'react';
import Map from '@arcgis/core/Map';
import MapView from '@arcgis/core/views/MapView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import esriConfig from '@arcgis/core/config';
import { io } from 'socket.io-client';
import FilterPanel from './components/FilterPanel.jsx';
import ReportForm from './components/ReportForm.jsx';
import Legend from './components/Legend.jsx';
import StreetViewExplorer from './components/StreetViewExplorer.jsx';
import '@arcgis/core/assets/esri/themes/light/main.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

const initialFilters = {
  date: '',
  hour: '',
  weather: 'todos',
  period: 'todos'
};

const defaultCenter = {
  longitude: -90.5069,
  latitude: 14.6349,
  zoom: 12
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

const createPredictionGraphic = (prediction) =>
  new Graphic({
    geometry: {
      type: 'point',
      longitude: prediction.longitude,
      latitude: prediction.latitude
    },
    attributes: prediction,
    symbol: {
      type: 'simple-marker',
      color: prediction.riskScore >= 0.75 ? '#dc3545' : prediction.riskScore >= 0.55 ? '#ffc107' : '#198754',
      size: 11,
      outline: {
        color: '#ffffff',
        width: 1.5
      }
    },
    popupTemplate: {
      title: `Riesgo ${Math.round(prediction.riskScore * 100)}%`,
      content: `\n        <strong>Segmento:</strong> ${prediction.roadSegment}<br />
        <strong>Fecha:</strong> ${prediction.date}<br />
        <strong>Hora:</strong> ${prediction.hour}<br />
        <strong>Clima:</strong> ${prediction.weather === 'lluvia' ? 'Lluvia' : 'Sin lluvia'}<br />
        <strong>Periodo:</strong> ${prediction.period === 'dia' ? 'Día' : 'Noche'}
      `
    }
  });

const createReportGraphic = (report) => {
  const severityColor = {
    alta: '#dc3545',
    media: '#fd7e14',
    baja: '#0d6efd'
  };

  return new Graphic({
    geometry: {
      type: 'point',
      longitude: report.longitude,
      latitude: report.latitude
    },
    attributes: report,
    symbol: {
      type: 'simple-marker',
      color: severityColor[report.severity] || '#000000',
      size: 12,
      outline: {
        color: '#ffffff',
        width: 1.5
      }
    },
    popupTemplate: {
      title: 'Reporte ciudadano',
      content: `\n        <strong>Descripción:</strong> ${report.description}<br />
        <strong>Severidad:</strong> ${report.severity}<br />
        <strong>Registrado:</strong> ${new Date(report.createdAt).toLocaleString()}
      `
    }
  });
};

export default function App() {
  const mapContainerRef = useRef(null);
  const filtersRef = useRef(initialFilters);
  const predictionsLayerRef = useRef(new GraphicsLayer({ id: 'predictions-layer' }));
  const reportsLayerRef = useRef(new GraphicsLayer({ id: 'reports-layer' }));

  const [filters, setFilters] = useState(initialFilters);
  const [predictions, setPredictions] = useState([]);
  const [reports, setReports] = useState([]);
  const [loadingPredictions, setLoadingPredictions] = useState(false);
  const [submittingReport, setSubmittingReport] = useState(false);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    esriConfig.apiKey = import.meta.env.VITE_ARCGIS_API_KEY || '';
    const map = new Map({
      basemap: 'arcgis-navigation'
    });

    map.addMany([predictionsLayerRef.current, reportsLayerRef.current]);

    const view = new MapView({
      container: mapContainerRef.current,
      map,
      center: [defaultCenter.longitude, defaultCenter.latitude],
      zoom: defaultCenter.zoom
    });

    view.ui.move('zoom', 'top-right');

    return () => {
      view.destroy();
    };
  }, []);

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

  useEffect(() => {
    if (!predictionsLayerRef.current) return;
    const layer = predictionsLayerRef.current;
    layer.removeAll();
    const graphics = predictions.map((prediction) => createPredictionGraphic(prediction));
    layer.addMany(graphics);
  }, [predictions]);

  useEffect(() => {
    if (!reportsLayerRef.current) return;
    const layer = reportsLayerRef.current;
    layer.removeAll();
    const graphics = reports.map((report) => createReportGraphic(report));
    layer.addMany(graphics);
  }, [reports]);

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
          <div className="map-container" ref={mapContainerRef} />
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
