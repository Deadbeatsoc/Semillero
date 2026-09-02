import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Paleta de color del mapa de calor indexada por intensidad (0..255).
const buildPalette = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0.0, '#2c7bb6');
  gradient.addColorStop(0.35, '#00ccbc');
  gradient.addColorStop(0.55, '#a6d96a');
  gradient.addColorStop(0.7, '#ffffbf');
  gradient.addColorStop(0.85, '#fdae61');
  gradient.addColorStop(1.0, '#d7191c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1, 256);
  return ctx.getImageData(0, 0, 1, 256).data;
};

// Brocha radial (negro con caida de alpha) que se dibuja por cada punto.
const buildBrush = (radius, blur) => {
  const size = radius + blur;
  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size * 2;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size, size, 0, size, size, size);
  gradient.addColorStop(0, 'rgba(0,0,0,1)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size * 2, size * 2);
  return { canvas, size };
};

// Capa Leaflet personalizada que renderiza un mapa de calor aditivo en canvas
// (misma tecnica que leaflet.heat, sin dependencias externas).
const createHeatLayer = (points, options = {}) => {
  const HeatLayer = L.Layer.extend({
    initialize(heatPoints, opts) {
      this._points = heatPoints || [];
      this._radius = opts.radius || 26;
      this._blur = opts.blur || 16;
      this._minOpacity = opts.minOpacity ?? 0.06;
    },
    setPoints(nextPoints) {
      this._points = nextPoints || [];
      if (this._map) {
        this._redraw();
      }
      return this;
    },
    onAdd(map) {
      this._map = map;
      this._canvas = L.DomUtil.create('canvas', 'leaflet-heatmap-layer leaflet-layer');
      const size = map.getSize();
      this._canvas.width = size.x;
      this._canvas.height = size.y;
      this._canvas.style.pointerEvents = 'none';
      // Se oculta durante la animacion de zoom y se redibuja al terminar.
      L.DomUtil.addClass(this._canvas, 'leaflet-zoom-hide');
      map.getPanes().overlayPane.appendChild(this._canvas);
      map.on('moveend', this._reset, this);
      map.on('resize', this._onResize, this);
      this._palette = buildPalette();
      this._brush = buildBrush(this._radius, this._blur);
      this._reset();
    },
    onRemove(map) {
      if (this._canvas && this._canvas.parentNode) {
        this._canvas.parentNode.removeChild(this._canvas);
      }
      map.off('moveend', this._reset, this);
      map.off('resize', this._onResize, this);
    },
    _onResize() {
      const size = this._map.getSize();
      this._canvas.width = size.x;
      this._canvas.height = size.y;
      this._reset();
    },
    _reset() {
      const topLeft = this._map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(this._canvas, topLeft);
      this._redraw();
    },
    _redraw() {
      if (!this._map || !this._canvas) {
        return;
      }
      const ctx = this._canvas.getContext('2d');
      const size = this._map.getSize();
      ctx.clearRect(0, 0, size.x, size.y);

      const { canvas: brush, size: brushSize } = this._brush;
      const margin = brushSize;
      for (const point of this._points) {
        const pixel = this._map.latLngToContainerPoint([point.lat, point.lng]);
        if (
          pixel.x < -margin ||
          pixel.y < -margin ||
          pixel.x > size.x + margin ||
          pixel.y > size.y + margin
        ) {
          continue;
        }
        ctx.globalAlpha = Math.max(this._minOpacity, Math.min(1, point.intensity || 0));
        ctx.drawImage(brush, pixel.x - brushSize, pixel.y - brushSize);
      }
      ctx.globalAlpha = 1;

      if (!size.x || !size.y) {
        return;
      }
      const image = ctx.getImageData(0, 0, size.x, size.y);
      const data = image.data;
      const palette = this._palette;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha) {
          const offset = alpha * 4;
          data[i] = palette[offset];
          data[i + 1] = palette[offset + 1];
          data[i + 2] = palette[offset + 2];
          data[i + 3] = Math.min(alpha + 70, 235);
        }
      }
      ctx.putImageData(image, 0, 0);
    }
  });

  return new HeatLayer(points, options);
};

const LEGEND_STEPS = [
  { label: 'Bajo', color: '#2c7bb6' },
  { label: 'Medio', color: '#a6d96a' },
  { label: 'Alto', color: '#fdae61' },
  { label: 'Critico', color: '#d7191c' }
];

// Distancia (en pixeles) para considerar que un click cae sobre una zona.
const CLICK_TOLERANCE_PX = 22;

// Busca el punto del heatmap mas cercano al pixel del evento dentro de la
// tolerancia configurada. Retorna { point, distance } o null.
const findNearestPoint = (map, points, eventLatLng) => {
  if (!points.length) {
    return null;
  }
  const target = map.latLngToContainerPoint(eventLatLng);
  let best = null;
  let bestDistance = Infinity;
  for (const point of points) {
    const pixel = map.latLngToContainerPoint([point.lat, point.lng]);
    const dx = pixel.x - target.x;
    const dy = pixel.y - target.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  if (!best || bestDistance > CLICK_TOLERANCE_PX) {
    return null;
  }
  return { point: best, distance: bestDistance };
};

const SEVERITY_ROWS = [
  { key: 'baja', label: 'Baja', color: '#2c7bb6' },
  { key: 'media', label: 'Media', color: '#a6d96a' },
  { key: 'alta', label: 'Alta', color: '#fdae61' },
  { key: 'fatal', label: 'Fatal', color: '#d7191c' }
];

const buildPopupHtml = (point) => {
  const count = Number(point.count) || 0;
  const rows = SEVERITY_ROWS.map((row) => {
    const value = Number(point[row.key]) || 0;
    const pct = count > 0 ? Math.round((value / count) * 100) : 0;
    return `
      <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
        <span style="width:10px;height:10px;border-radius:50%;background:${row.color};display:inline-block;"></span>
        <span style="flex:1;">${row.label}</span>
        <strong>${value}</strong>
        <span style="color:#64748b;">(${pct}%)</span>
      </div>`;
  }).join('');

  const dominant = SEVERITY_ROWS.reduce(
    (best, row) => {
      const value = Number(point[row.key]) || 0;
      return value > best.value ? { label: row.label, value } : best;
    },
    { label: 'N/D', value: -1 }
  );

  return `
    <div style="min-width:180px;font-size:0.85rem;">
      <strong>Zona de accidentalidad</strong><br />
      <span style="color:#64748b;">${Number(point.lat).toFixed(3)}, ${Number(point.lng).toFixed(3)}</span>
      <div style="margin-top:6px;"><strong>Accidentes:</strong> ${count}</div>
      <div><strong>Gravedad dominante:</strong> ${dominant.label}</div>
      <div style="margin-top:6px;border-top:1px solid #e2e8f0;padding-top:6px;">${rows}</div>
    </div>`;
};

const AccidentHeatmap = ({ center, zoom = 12, points = [], signals = [] }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const pointsRef = useRef([]);
  const signalsLayerRef = useRef(null);
  const [showSignals, setShowSignals] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return undefined;
    }
    const initialCenter =
      center && Number.isFinite(center.latitude) && Number.isFinite(center.longitude)
        ? [center.latitude, center.longitude]
        : [4.142, -73.6266];

    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: false
    }).setView(initialCenter, zoom || 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);

    layerRef.current = createHeatLayer([], { radius: 26, blur: 16 });
    layerRef.current.addTo(map);
    signalsLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const popup = L.popup({ closeButton: true, autoPan: false });

    const handleClick = (event) => {
      const match = findNearestPoint(map, pointsRef.current, event.latlng);
      if (!match) {
        return;
      }
      popup
        .setLatLng([match.point.lat, match.point.lng])
        .setContent(buildPopupHtml(match.point))
        .openOn(map);
    };

    // Cursor de "mano" cuando el puntero esta sobre una zona con datos.
    const handleMouseMove = (event) => {
      const match = findNearestPoint(map, pointsRef.current, event.latlng);
      const container = map.getContainer();
      container.style.cursor = match ? 'pointer' : '';
    };

    map.on('click', handleClick);
    map.on('mousemove', handleMouseMove);

    // Asegura render correcto cuando el contenedor se monta dentro de cards.
    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      map.off('click', handleClick);
      map.off('mousemove', handleMouseMove);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    pointsRef.current = Array.isArray(points) ? points : [];
    if (layerRef.current) {
      layerRef.current.setPoints(points);
    }
  }, [points]);

  // Capa de semaforos (toggle) sobre el mapa de calor.
  useEffect(() => {
    const layer = signalsLayerRef.current;
    if (!layer) {
      return;
    }
    layer.clearLayers();
    if (!showSignals || !Array.isArray(signals)) {
      return;
    }
    signals.forEach((signal) => {
      const lat = Number(signal.latitude);
      const lon = Number(signal.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return;
      }
      L.circleMarker([lat, lon], {
        radius: 4,
        color: '#0b7a3b',
        weight: 1.3,
        fillColor: '#22c55e',
        fillOpacity: 0.95
      })
        .bindPopup(`<strong>Semaforo</strong>${signal.name ? `<br />${signal.name}` : ''}`)
        .addTo(layer);
    });
  }, [signals, showSignals]);

  // Se recentra solo cuando cambian los VALORES de coordenadas/zoom (no la
  // referencia del objeto), para no resetear el pan/zoom del usuario en cada
  // refresco silencioso del dashboard.
  const centerLat = center?.latitude;
  const centerLng = center?.longitude;
  useEffect(() => {
    if (mapRef.current && Number.isFinite(centerLat) && Number.isFinite(centerLng)) {
      mapRef.current.setView([centerLat, centerLng], zoom || mapRef.current.getZoom());
    }
  }, [centerLat, centerLng, zoom]);

  return (
    <div className="accident-heatmap">
      <div ref={containerRef} className="accident-heatmap__canvas" />
      {!points.length && (
        <div className="accident-heatmap__empty text-muted small">
          No hay accidentes para mostrar en el mapa.
        </div>
      )}
      <div className="accident-heatmap__legend">
        {LEGEND_STEPS.map((step) => (
          <span key={step.label} className="accident-heatmap__legend-item">
            <span className="accident-heatmap__legend-dot" style={{ backgroundColor: step.color }} />
            {step.label}
          </span>
        ))}
        {Boolean(signals.length) && (
          <span className="form-check form-switch mb-0 ms-2">
            <input
              className="form-check-input"
              type="checkbox"
              role="switch"
              id="heatmap-toggle-signals"
              checked={showSignals}
              onChange={(event) => setShowSignals(event.target.checked)}
            />
            <label className="form-check-label" htmlFor="heatmap-toggle-signals">
              Semaforos ({signals.length})
            </label>
          </span>
        )}
        {Boolean(points.length) && (
          <span className="accident-heatmap__legend-hint">
            Haz clic en una zona caliente para ver el detalle.
          </span>
        )}
      </div>
    </div>
  );
};

export default AccidentHeatmap;
