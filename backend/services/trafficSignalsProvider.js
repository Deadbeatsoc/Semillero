import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');

// Archivo de semaforos por ciudad (GeoJSON de puntos extraido de OSM).
const SIGNAL_FILES = {
  villavicencio: 'semaforos_villavicencio.geojson'
};

const SIGNAL_CACHE_TTL_MS = 30 * 60 * 1000;
const signalCache = new Map();

const toRadians = (degrees) => (degrees * Math.PI) / 180;

const haversineDistanceKm = (lat1, lng1, lat2, lng2) => {
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const parseSignalsGeoJson = (raw) => {
  const geojson = JSON.parse(raw);
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const signals = [];
  for (const feature of features) {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      continue;
    }
    const longitude = Number(coords[0]);
    const latitude = Number(coords[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue;
    }
    signals.push({
      id: feature?.properties?.osm_id ?? signals.length,
      latitude,
      longitude,
      name: feature?.properties?.name || ''
    });
  }
  return signals;
};

/**
 * Carga (con cache) la lista de semaforos de una ciudad. Devuelve [] si no hay
 * archivo o si falla la lectura.
 */
const getSignalsForCity = async (cityKey) => {
  const key = String(cityKey || '').toLowerCase();
  const cached = signalCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.signals;
  }

  const filename = SIGNAL_FILES[key];
  if (!filename) {
    signalCache.set(key, { signals: [], expiresAt: Date.now() + SIGNAL_CACHE_TTL_MS });
    return [];
  }

  let signals = [];
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, filename), 'utf8');
    signals = parseSignalsGeoJson(raw);
  } catch {
    signals = [];
  }

  signalCache.set(key, { signals, expiresAt: Date.now() + SIGNAL_CACHE_TTL_MS });
  return signals;
};

/**
 * Calcula features de semaforo para una celda:
 *  - signalDistKm: distancia al semaforo mas cercano (cap a 5 km).
 *  - signalCount: numero de semaforos dentro del rectangulo de la celda.
 */
const computeSignalFeatures = (signals, centroid, cellBounds) => {
  if (!Array.isArray(signals) || !signals.length) {
    return { signalDistKm: 5, signalCount: 0 };
  }

  let minDistance = Number.POSITIVE_INFINITY;
  let count = 0;
  const { west, south, east, north } = cellBounds || {};
  const hasBounds = [west, south, east, north].every((value) => Number.isFinite(value));

  for (const signal of signals) {
    const distance = haversineDistanceKm(
      centroid.latitude,
      centroid.longitude,
      signal.latitude,
      signal.longitude
    );
    if (distance < minDistance) {
      minDistance = distance;
    }
    if (
      hasBounds &&
      signal.longitude >= west &&
      signal.longitude < east &&
      signal.latitude >= south &&
      signal.latitude < north
    ) {
      count += 1;
    }
  }

  return {
    signalDistKm: Number.isFinite(minDistance) ? Math.min(minDistance, 5) : 5,
    signalCount: count
  };
};

export { getSignalsForCity, computeSignalFeatures, haversineDistanceKm };
