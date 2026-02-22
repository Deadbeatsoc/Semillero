import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { io } from 'socket.io-client';
import FilterPanel from './components/FilterPanel.jsx';
import Legend from './components/Legend.jsx';
import ReportForm from './components/ReportForm.jsx';
import 'leaflet/dist/leaflet.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

const fallbackCity = {
  key: 'villavicencio',
  label: 'Villavicencio',
  center: { latitude: 4.142, longitude: -73.6266 },
  zoom: 12
};

const initialFilters = {
  city: fallbackCity.key,
  address: '',
  latitude: null,
  longitude: null,
  rangeMode: 'none',
  rangeStart: '',
  rangeEnd: '',
  date: '',
  hour: '',
  weather: 'todos',
  period: 'todos'
};

const maxItems = 120;

const hasActiveFilters = (filters) => {
  if (!filters) {
    return false;
  }

  const hasCoordinates =
    Number.isFinite(filters.latitude) && Number.isFinite(filters.longitude);
  const hasRange =
    filters.rangeMode &&
    filters.rangeMode !== 'none' &&
    (filters.rangeStart || '').trim() &&
    (filters.rangeEnd || '').trim();

  return Boolean(
    (filters.address || '').trim() ||
      hasCoordinates ||
      hasRange ||
      filters.date ||
      filters.hour ||
      filters.weather !== 'todos' ||
      filters.period !== 'todos'
  );
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

const getRiskColor = (riskScore) => {
  if (riskScore >= 0.75) return '#dc3545';
  if (riskScore >= 0.55) return '#f59f00';
  return '#1f9d55';
};

const isValidCoordinate = (latitude, longitude) =>
  Number.isFinite(latitude) && Number.isFinite(longitude);

const getPrimaryHotspot = (predictions) => {
  if (!Array.isArray(predictions) || predictions.length === 0) {
    return null;
  }

  const queryMatch = predictions.find((prediction) => Boolean(prediction?.isQueryMatch));
  return queryMatch || predictions[0];
};

const getHotspotShadowRadiusMeters = (riskScore) => {
  const safeScore = Math.max(0, Math.min(1, Number(riskScore) || 0));
  return 280 + safeScore * 900;
};

const formatWeather = (weather) => {
  if (weather === 'lluvia') return 'Lluvia';
  if (weather === 'no_lluvia') return 'Sin lluvia';
  return 'Todos';
};

const formatPeriod = (period) => {
  if (period === 'dia') return 'Dia';
  if (period === 'noche') return 'Noche';
  return 'Todos';
};

export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const predictionsLayerRef = useRef(null);
  const reportsLayerRef = useRef(null);
  const queryLayerRef = useRef(null);
  const draftSelectionLayerRef = useRef(null);

  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(null);
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [isPickingOnMap, setIsPickingOnMap] = useState(false);
  const [pickingAddress, setPickingAddress] = useState(false);

  const [cities, setCities] = useState([fallbackCity]);
  const [activeCity, setActiveCity] = useState(fallbackCity);
  const [predictions, setPredictions] = useState([]);
  const [querySummary, setQuerySummary] = useState(null);
  const [rangeSummary, setRangeSummary] = useState(null);
  const [reports, setReports] = useState([]);
  const [loadingPredictions, setLoadingPredictions] = useState(false);
  const [submittingReport, setSubmittingReport] = useState(false);

  const topPredictions = useMemo(() => predictions.slice(0, 60), [predictions]);
  const isQueryActive = hasActiveFilters(appliedFilters || initialFilters);
  const isRangeModeActive = Boolean(rangeSummary?.isActive);

  useEffect(() => {
    const map = L.map(mapContainerRef.current, {
      zoomControl: false
    }).setView([fallbackCity.center.latitude, fallbackCity.center.longitude], fallbackCity.zoom);

    L.control
      .zoom({
        position: 'topright'
      })
      .addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    predictionsLayerRef.current = L.layerGroup().addTo(map);
    reportsLayerRef.current = L.layerGroup().addTo(map);
    queryLayerRef.current = L.layerGroup().addTo(map);
    draftSelectionLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const fetchCities = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/cities`);
      if (!response.ok) {
        throw new Error('No se pudieron obtener las ciudades');
      }

      const payload = await response.json();
      const citiesData = Array.isArray(payload.data) && payload.data.length ? payload.data : [fallbackCity];
      setCities(citiesData);

      setDraftFilters((current) => {
        const currentCityExists = citiesData.some((city) => city.key === current.city);
        if (currentCityExists) {
          return current;
        }
        return { ...current, city: citiesData[0].key };
      });
    } catch (error) {
      setCities([fallbackCity]);
    }
  };

  const fetchPredictions = async (filtersToApply) => {
    if (!hasActiveFilters(filtersToApply)) {
      setPredictions([]);
      setQuerySummary(null);
      setRangeSummary(null);
      return;
    }

    setLoadingPredictions(true);
    try {
      const params = new URLSearchParams();
      if (filtersToApply.city) params.append('city', filtersToApply.city);
      if ((filtersToApply.address || '').trim()) params.append('address', filtersToApply.address.trim());
      if (isValidCoordinate(filtersToApply.latitude, filtersToApply.longitude)) {
        params.append('latitude', String(filtersToApply.latitude));
        params.append('longitude', String(filtersToApply.longitude));
      }
      if (filtersToApply.date) params.append('date', filtersToApply.date);
      if (filtersToApply.hour) params.append('hour', filtersToApply.hour);
      if (
        filtersToApply.rangeMode &&
        filtersToApply.rangeMode !== 'none' &&
        filtersToApply.rangeStart &&
        filtersToApply.rangeEnd
      ) {
        params.append('rangeMode', filtersToApply.rangeMode);
        params.append('rangeStart', filtersToApply.rangeStart);
        params.append('rangeEnd', filtersToApply.rangeEnd);
      }
      if (filtersToApply.weather && filtersToApply.weather !== 'todos') {
        params.append('weather', filtersToApply.weather);
      }
      if (filtersToApply.period && filtersToApply.period !== 'todos') {
        params.append('period', filtersToApply.period);
      }

      const endpoint = `${API_BASE_URL}/api/predictions?${params.toString()}`;
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error('No se pudo consultar la prediccion');
      }

      const payload = await response.json();
      setPredictions(Array.isArray(payload.data) ? payload.data : []);
      setQuerySummary(payload?.meta?.query || null);
      setRangeSummary(payload?.meta?.range || null);

      if (payload?.meta?.city) {
        setActiveCity(payload.meta.city);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('No se pudieron obtener las predicciones locales', error);
      setPredictions([]);
      setQuerySummary(null);
      setRangeSummary(null);
    } finally {
      setLoadingPredictions(false);
    }
  };

  const fetchReports = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/reports`);
      if (!response.ok) {
        throw new Error('No se pudieron obtener los reportes');
      }
      const payload = await response.json();
      setReports(Array.isArray(payload.data) ? payload.data : []);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('No se pudieron obtener los reportes', error);
    }
  };

  useEffect(() => {
    fetchCities();
    fetchReports();
  }, []);

  useEffect(() => {
    if (appliedFilters) {
      fetchPredictions(appliedFilters);
    } else {
      setPredictions([]);
      setQuerySummary(null);
      setRangeSummary(null);
    }
  }, [appliedFilters]);

  useEffect(() => {
    const query = (draftFilters.address || '').trim();
    if (isValidCoordinate(draftFilters.latitude, draftFilters.longitude)) {
      setAddressSuggestions([]);
      return;
    }
    if (query.length < 3) {
      setAddressSuggestions([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          query,
          city: draftFilters.city
        });
        const response = await fetch(`${API_BASE_URL}/api/geocode/suggest?${params.toString()}`);
        if (!response.ok) {
          throw new Error('Error al consultar sugerencias');
        }
        const payload = await response.json();
        setAddressSuggestions(Array.isArray(payload.data) ? payload.data : []);
      } catch (error) {
        setAddressSuggestions([]);
      }
    }, 280);

    return () => clearTimeout(timeoutId);
  }, [draftFilters.address, draftFilters.city, draftFilters.latitude, draftFilters.longitude]);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket']
    });

    socket.on('init', ({ reports: initialReports = [] }) => {
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
    });

    socket.on('report:new', (report) => {
      setReports((current) => addUnique(current, report));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const selected = cities.find((city) => city.key === draftFilters.city) || cities[0] || fallbackCity;
    setActiveCity(selected);

    if (mapRef.current && selected.center) {
      mapRef.current.setView([selected.center.latitude, selected.center.longitude], selected.zoom || 12);
    }
  }, [draftFilters.city, cities]);

  useEffect(() => {
    if (!mapRef.current) return undefined;
    if (!isPickingOnMap) return undefined;

    const map = mapRef.current;
    const handleClick = async (event) => {
      const { lat, lng } = event.latlng || {};
      if (!isValidCoordinate(lat, lng)) {
        return;
      }

      setPickingAddress(true);
      try {
        const params = new URLSearchParams({
          latitude: String(lat),
          longitude: String(lng),
          city: draftFilters.city
        });
        const response = await fetch(`${API_BASE_URL}/api/geocode/reverse?${params.toString()}`);
        if (!response.ok) {
          throw new Error('No se pudo resolver la direccion');
        }
        const payload = await response.json();
        const match = payload?.data;

        if (match) {
          setDraftFilters((current) => ({
            ...current,
            address: match.label || match.displayName || current.address,
            latitude: Number(match.latitude),
            longitude: Number(match.longitude)
          }));
        }
      } catch (error) {
        setDraftFilters((current) => ({
          ...current,
          address: `Lat ${lat.toFixed(5)}, Lon ${lng.toFixed(5)}`,
          latitude: lat,
          longitude: lng
        }));
      } finally {
        setAddressSuggestions([]);
        setIsPickingOnMap(false);
        setPickingAddress(false);
      }
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [isPickingOnMap, draftFilters.city]);

  useEffect(() => {
    if (!predictionsLayerRef.current) return;
    const layer = predictionsLayerRef.current;
    layer.clearLayers();

    if (isRangeModeActive) {
      predictions.forEach((prediction) => {
        if (!isValidCoordinate(prediction.latitude, prediction.longitude)) {
          return;
        }

        const peakRiskScore = Number(prediction.peakRiskScore ?? prediction.riskScore) || 0;
        const color = getRiskColor(peakRiskScore);
        const markerRadius = 6 + peakRiskScore * 6;
        const shadowRadius = 110 + peakRiskScore * 420;

        const popupHtml = `
          <strong>${prediction.roadSegment || 'Zona sin nombre'}</strong><br />
          <strong>Riesgo pico:</strong> ${Math.round(peakRiskScore * 100)}%<br />
          <strong>Pico en:</strong> ${prediction.rangePeakDate || prediction.date || 'N/A'}<br />
          <strong>Apariciones graves:</strong> ${prediction.rangeOccurrences || 0}<br />
          <strong>Riesgo promedio:</strong> ${Math.round((prediction.rangeAverageRisk || 0) * 100)}%
        `;

        L.circle([prediction.latitude, prediction.longitude], {
          radius: shadowRadius,
          color,
          weight: 0,
          fillColor: color,
          fillOpacity: 0.16
        })
          .bindPopup(popupHtml)
          .addTo(layer);

        L.circleMarker([prediction.latitude, prediction.longitude], {
          radius: markerRadius,
          color: '#111827',
          weight: 1.8,
          fillColor: color,
          fillOpacity: 0.95
        })
          .bindPopup(popupHtml)
          .addTo(layer);
      });
      return;
    }

    const hotspot = getPrimaryHotspot(predictions);
    if (!hotspot || !isValidCoordinate(hotspot.latitude, hotspot.longitude)) {
      return;
    }

    const riskScore = Number(hotspot.riskScore) || 0;
    const color = getRiskColor(riskScore);
    const shadowRadius = getHotspotShadowRadiusMeters(riskScore);
    const distanceRow =
      typeof hotspot.distanceToQueryKm === 'number'
        ? `<br /><strong>Distancia a consulta:</strong> ${hotspot.distanceToQueryKm} km`
        : '';

    const popupHtml = `
      <strong>${hotspot.roadSegment || 'Zona sin nombre'}</strong><br />
      <strong>Probabilidad:</strong> ${Math.round(riskScore * 100)}%<br />
      <strong>Nivel:</strong> ${hotspot.riskLevel || 'N/A'}<br />
      <strong>Fecha:</strong> ${hotspot.date || 'N/A'}<br />
      <strong>Hora:</strong> ${hotspot.hour || 'N/A'}<br />
      <strong>Clima:</strong> ${formatWeather(hotspot.weather)}<br />
      <strong>Periodo:</strong> ${formatPeriod(hotspot.period)}${distanceRow}
    `;

    L.circle([hotspot.latitude, hotspot.longitude], {
      radius: shadowRadius,
      color,
      weight: 0,
      fillColor: color,
      fillOpacity: 0.22
    })
      .bindPopup(popupHtml)
      .addTo(layer);

    L.circleMarker([hotspot.latitude, hotspot.longitude], {
      radius: 9,
      color: '#111827',
      weight: 2.2,
      fillColor: color,
      fillOpacity: 0.98
    })
      .bindPopup(popupHtml)
      .addTo(layer);
  }, [predictions, isRangeModeActive]);

  useEffect(() => {
    if (!queryLayerRef.current) return;
    const layer = queryLayerRef.current;
    layer.clearLayers();

    if (isRangeModeActive) {
      return;
    }

    if (!querySummary || !isValidCoordinate(querySummary.latitude, querySummary.longitude)) {
      return;
    }

    L.circleMarker([querySummary.latitude, querySummary.longitude], {
      radius: 8,
      color: '#1d4ed8',
      weight: 3,
      fillColor: '#60a5fa',
      fillOpacity: 0.9
    })
      .bindPopup(
        `<strong>Consulta:</strong> ${querySummary.address}<br />
         <strong>Probabilidad:</strong> ${Math.round((querySummary.probability || 0) * 100)}%<br />
         <strong>Zona:</strong> ${querySummary.roadSegment || 'N/A'}`
      )
      .addTo(layer);
  }, [querySummary, isRangeModeActive]);

  useEffect(() => {
    if (!draftSelectionLayerRef.current) return;
    const layer = draftSelectionLayerRef.current;
    layer.clearLayers();

    if (!isValidCoordinate(draftFilters.latitude, draftFilters.longitude)) {
      return;
    }

    L.circleMarker([draftFilters.latitude, draftFilters.longitude], {
      radius: 7,
      color: '#2563eb',
      weight: 2,
      fillColor: '#93c5fd',
      fillOpacity: 0.75
    }).addTo(layer);
  }, [draftFilters.latitude, draftFilters.longitude]);

  useEffect(() => {
    if (!reportsLayerRef.current) return;
    const layer = reportsLayerRef.current;
    layer.clearLayers();

    reports.forEach((report) => {
      if (!isValidCoordinate(report.latitude, report.longitude)) {
        return;
      }

      const colorBySeverity = {
        alta: '#dc3545',
        media: '#fd7e14',
        baja: '#0d6efd'
      };

      const marker = L.circleMarker([report.latitude, report.longitude], {
        radius: 6.5,
        color: '#ffffff',
        weight: 1,
        fillColor: colorBySeverity[report.severity] || '#111827',
        fillOpacity: 0.95
      });

      marker
        .bindPopup(
          `<strong>Reporte ciudadano</strong><br />
           <strong>Severidad:</strong> ${String(report.severity || 'media').toUpperCase()}<br />
           <strong>Descripcion:</strong> ${report.description || ''}<br />
           <strong>Registrado:</strong> ${new Date(report.createdAt).toLocaleString()}`
        )
        .addTo(layer);
    });
  }, [reports]);

  const handleFilterChange = (nextFilters) => {
    const changedCity = nextFilters.city !== draftFilters.city;
    const rangeMode = nextFilters.rangeMode || 'none';
    const isRangeSelected = rangeMode !== 'none';
    setDraftFilters({
      ...nextFilters,
      address: isRangeSelected ? '' : nextFilters.address,
      date: rangeMode === 'none' ? nextFilters.date : '',
      rangeStart: rangeMode === 'none' ? '' : nextFilters.rangeStart,
      rangeEnd: rangeMode === 'none' ? '' : nextFilters.rangeEnd,
      latitude: changedCity || isRangeSelected ? null : nextFilters.latitude,
      longitude: changedCity || isRangeSelected ? null : nextFilters.longitude
    });

    if (changedCity || isRangeSelected) {
      setAddressSuggestions([]);
      setIsPickingOnMap(false);
    }
  };

  const handleAddressChange = (value) => {
    setDraftFilters((current) => ({
      ...current,
      address: value,
      latitude: null,
      longitude: null
    }));
  };

  const handleAddressSuggestionSelect = (suggestion) => {
    setDraftFilters((current) => ({
      ...current,
      address: suggestion.label || suggestion.displayName,
      latitude: Number(suggestion.latitude),
      longitude: Number(suggestion.longitude)
    }));
    setAddressSuggestions([]);
  };

  const handleApplyFilters = () => {
    setAppliedFilters({ ...draftFilters });
  };

  const handleFilterReset = () => {
    setDraftFilters((current) => ({
      ...initialFilters,
      city: current.city
    }));
    setAppliedFilters(null);
    setRangeSummary(null);
    setAddressSuggestions([]);
    setIsPickingOnMap(false);
  };

  const handleToggleMapPick = () => {
    setIsPickingOnMap((current) => !current);
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
    } finally {
      setSubmittingReport(false);
    }
  };

  return (
    <div className="container py-4">
      <div className="d-flex flex-column flex-lg-row gap-4">
        <div className="flex-fill">
          <FilterPanel
            filters={draftFilters}
            cities={cities}
            onFilterChange={handleFilterChange}
            onAddressChange={handleAddressChange}
            addressSuggestions={addressSuggestions}
            onAddressSuggestionSelect={handleAddressSuggestionSelect}
            onToggleMapPick={handleToggleMapPick}
            isPickingOnMap={isPickingOnMap}
            onApply={handleApplyFilters}
            onReset={handleFilterReset}
            loading={loadingPredictions || pickingAddress}
          />
          <div className="map-container" ref={mapContainerRef} />
        </div>
        <div className="flex-shrink-0" style={{ minWidth: '320px', maxWidth: '380px' }}>
          <Legend />
          <div className="mt-4">
            <ReportForm onSubmit={handleReportSubmit} submitting={submittingReport} />
          </div>

          <div className="card border-0 shadow-sm mt-4">
            <div className="card-body">
              <h6 className="text-uppercase text-muted small mb-3">
                {isRangeModeActive ? 'Resumen de rango' : 'Consulta puntual'}
              </h6>
              {!isRangeModeActive && !querySummary && (
                <div className="text-muted small">
                  Escribe una direccion de Villavicencio o selecciona un punto en el mapa y luego aplica filtros.
                </div>
              )}
              {isRangeModeActive && rangeSummary && (
                <div className="d-flex flex-column gap-1">
                  <strong>
                    {rangeSummary.mode === 'mes' ? 'Analisis mes a mes' : 'Analisis dia a dia'}
                  </strong>
                  <small className="text-muted">
                    Ventana: {rangeSummary.start || 'N/A'} a {rangeSummary.end || 'N/A'}
                  </small>
                  <small className="text-muted">Pasos evaluados: {rangeSummary.steps || 0}</small>
                  <span className="badge rounded-pill bg-danger align-self-start">
                    {rangeSummary.totalSeverePoints || 0} puntos graves
                  </span>
                </div>
              )}
              {!isRangeModeActive && querySummary && (
                <div className="d-flex flex-column gap-1">
                  <strong>{querySummary.address}</strong>
                  <span className={`badge rounded-pill align-self-start ${getRiskClassName(querySummary.probability || 0)}`}>
                    {Math.round((querySummary.probability || 0) * 100)}%
                  </span>
                  <small className="text-muted">Zona: {querySummary.roadSegment || 'N/A'}</small>
                  <small className="text-muted">Distancia aprox: {querySummary.distanceKm} km</small>
                </div>
              )}
            </div>
          </div>

          <div className="card border-0 shadow-sm mt-4">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <h6 className="text-uppercase text-muted small mb-0">
                  {isRangeModeActive ? 'Puntos graves del rango' : 'Hotspots activos'}
                </h6>
                <span className="badge text-bg-light">{activeCity.label}</span>
              </div>
              <ul className="list-unstyled d-flex flex-column gap-3 mb-0" style={{ maxHeight: '260px', overflowY: 'auto' }}>
                {!isQueryActive && (
                  <li className="text-muted">El mapa esta en modo normal. Aplica filtros para ver hotspots.</li>
                )}
                {isQueryActive && topPredictions.length === 0 && (
                  <li className="text-muted">
                    {isRangeModeActive
                      ? 'No se encontraron puntos graves para el rango seleccionado.'
                      : 'No se encontraron hotspots para los filtros aplicados.'}
                  </li>
                )}
                {topPredictions.map((prediction) => (
                  <li key={prediction.id} className="timeline-entry">
                    <div className="d-flex align-items-center justify-content-between gap-2">
                      <strong>{prediction.roadSegment}</strong>
                      <span className={`badge rounded-pill ${getRiskClassName(prediction.riskScore)}`}>
                        {Math.round(prediction.riskScore * 100)}%
                      </span>
                    </div>
                    <div className="text-muted small">
                      {isRangeModeActive
                        ? `${prediction.rangePeakDate || prediction.date || 'N/A'} - Apariciones graves: ${
                            prediction.rangeOccurrences || 0
                          } - Riesgo promedio: ${Math.round((prediction.rangeAverageRisk || 0) * 100)}%`
                        : `${prediction.date || 'N/A'} - ${prediction.hour || 'N/A'} - ${formatWeather(
                            prediction.weather
                          )} - ${formatPeriod(prediction.period)}`}
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
                {reports.length === 0 && <li className="text-muted">Aun no hay reportes recientes.</li>}
                {reports.map((report) => (
                  <li key={report.id} className="timeline-entry">
                    <div className="d-flex align-items-center justify-content-between">
                      <strong>{String(report.severity || 'media').toUpperCase()}</strong>
                      <span className="badge rounded-pill bg-dark text-white">Reporte</span>
                    </div>
                    <div className="text-muted small">{report.description}</div>
                    <div className="text-muted small">{new Date(report.createdAt).toLocaleString()}</div>
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
