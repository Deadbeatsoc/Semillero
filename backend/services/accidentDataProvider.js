import { pool } from '../db/mysqlPool.js';
import { getSignalsForCity, computeSignalFeatures } from './trafficSignalsProvider.js';

// Minimo de accidentes reales para confiar en el modelo entrenado con datos
// observados. Por debajo de esto, el motor cae al modelo sintetico.
const MIN_REAL_ACCIDENTS = 80;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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

const xmur3 = (value) => {
  let h = 1779033703 ^ value.length;
  for (let index = 0; index < value.length; index += 1) {
    h = Math.imul(h ^ value.charCodeAt(index), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
};

const mulberry32 = (seed) => {
  let value = seed;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const createSeededRandom = (seedValue) => mulberry32(xmur3(String(seedValue))());

const percentile = (values, ratio) => {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.floor(clamp(ratio, 0, 1) * (sorted.length - 1));
  return sorted[index];
};

const safeShare = (numerator, denominator, fallback) => {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return fallback;
  }
  return clamp(numerator / denominator, 0, 1);
};

const loadCityRow = async (connection, cityKey) => {
  const [rows] = await connection.query(
    `
      SELECT id, label, center_latitude, center_longitude,
             bbox_west, bbox_south, bbox_east, bbox_north
      FROM cities
      WHERE city_key = ?
      LIMIT 1
    `,
    [cityKey]
  );
  return rows[0] || null;
};

// Construye el filtro SQL por dataset: 'real' | 'sintetico' | 'mixto' (union).
const buildDatasetClause = (dataset) => {
  if (dataset === 'real' || dataset === 'sintetico') {
    return { clause: 'AND dataset = ?', params: [dataset] };
  }
  return { clause: '', params: [] };
};

const loadAccidentRows = async (connection, cityId, dataset) => {
  const { clause, params } = buildDatasetClause(dataset);
  const [rows] = await connection.query(
    `
      SELECT
        latitude,
        longitude,
        severity,
        weather,
        period,
        occurred_at,
        HOUR(occurred_at) AS hour,
        DAYOFWEEK(occurred_at) AS dow
      FROM accident_events
      WHERE city_id = ?
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
        ${clause}
    `,
    [cityId, ...params]
  );
  return rows;
};

/**
 * Agrega accidentes reales (accident_events) en una grilla rows x cols sobre el
 * bbox de la ciudad. Devuelve celdas con la MISMA forma que buildSyntheticCells
 * para reutilizar el pipeline de entrenamiento/prediccion, mas un resumen del
 * dataset observado. Retorna null si no hay datos suficientes o si falla la DB.
 */
const buildRealCellsForCity = async (cityProfile, dataset = 'mixto') => {
  let connection;
  try {
    connection = await pool.getConnection();
  } catch {
    return null;
  }

  try {
    const cityRow = await loadCityRow(connection, cityProfile.key);
    if (!cityRow) {
      return null;
    }

    const accidents = await loadAccidentRows(connection, cityRow.id, dataset);
    if (!Array.isArray(accidents) || accidents.length < MIN_REAL_ACCIDENTS) {
      return null;
    }

    const west = Number(cityRow.bbox_west ?? cityProfile.bbox[0]);
    const south = Number(cityRow.bbox_south ?? cityProfile.bbox[1]);
    const east = Number(cityRow.bbox_east ?? cityProfile.bbox[2]);
    const north = Number(cityRow.bbox_north ?? cityProfile.bbox[3]);
    if (![west, south, east, north].every(Number.isFinite) || east <= west || north <= south) {
      return null;
    }

    const { rows, cols } = cityProfile;
    const lngStep = (east - west) / cols;
    const latStep = (north - south) / rows;

    const totalCells = rows * cols;
    const aggregate = Array.from({ length: totalCells }, () => ({
      total: 0,
      leve: 0,
      medio: 0,
      grave: 0,
      amPeak: 0,
      pmPeak: 0,
      weekend: 0,
      rain: 0,
      noRain: 0,
      dia: 0,
      noche: 0,
      sumLat: 0,
      sumLng: 0
    }));

    let usedAccidents = 0;
    // Ventana observada: rango [primer, ultimo] accidente con fecha valida.
    // Base para la tasa Poisson (accidentes por dia) de cada celda.
    let minTime = null;
    let maxTime = null;
    for (const accident of accidents) {
      const lat = Number(accident.latitude);
      const lng = Number(accident.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        continue;
      }

      const col = clamp(Math.floor((lng - west) / lngStep), 0, cols - 1);
      const row = clamp(Math.floor((lat - south) / latStep), 0, rows - 1);
      const cell = aggregate[row * cols + col];

      cell.total += 1;
      usedAccidents += 1;

      if (accident.occurred_at) {
        const eventTime = new Date(accident.occurred_at).getTime();
        if (Number.isFinite(eventTime)) {
          if (minTime === null || eventTime < minTime) minTime = eventTime;
          if (maxTime === null || eventTime > maxTime) maxTime = eventTime;
        }
      }
      cell.sumLat += lat;
      cell.sumLng += lng;

      const severity = String(accident.severity || '').toLowerCase();
      if (severity === 'baja') {
        cell.leve += 1;
      } else if (severity === 'media') {
        cell.medio += 1;
      } else {
        // 'alta' y 'fatal' se agrupan como gravedad alta.
        cell.grave += 1;
      }

      const hour = Number(accident.hour);
      if (Number.isFinite(hour)) {
        if (hour >= 6 && hour <= 9) cell.amPeak += 1;
        if (hour >= 17 && hour <= 20) cell.pmPeak += 1;
      }

      // DAYOFWEEK: 1 = domingo, 7 = sabado.
      const dow = Number(accident.dow);
      if (dow === 1 || dow === 7) {
        cell.weekend += 1;
      }

      const weather = String(accident.weather || '').toLowerCase();
      if (weather === 'lluvia') cell.rain += 1;
      else if (weather === 'no_lluvia') cell.noRain += 1;

      const period = String(accident.period || '').toLowerCase();
      if (period === 'dia') cell.dia += 1;
      else if (period === 'noche') cell.noche += 1;
    }

    if (usedAccidents < MIN_REAL_ACCIDENTS) {
      return null;
    }

    // Dias observados = span del dataset (inclusivo). Sin fechas validas => null,
    // y entonces no se calcula probabilidad Poisson (se reporta N/D).
    const MS_PER_DAY = 86400000;
    const observationDays =
      minTime !== null && maxTime !== null && maxTime >= minTime
        ? Math.max(1, Math.floor((maxTime - minTime) / MS_PER_DAY) + 1)
        : null;

    const totals = aggregate.map((cell) => cell.total);
    const densityScale = Math.max(1, percentile(totals, 0.95));

    // Hotspots = centroides de las 3 celdas con mas accidentes observados.
    const hotspotCells = aggregate
      .map((cell, index) => ({ index, total: cell.total }))
      .filter((entry) => entry.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 3)
      .map((entry) => {
        const cell = aggregate[entry.index];
        return {
          latitude: cell.sumLat / cell.total,
          longitude: cell.sumLng / cell.total
        };
      });

    const signals = await getSignalsForCity(cityProfile.key);

    const cells = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const cell = aggregate[row * cols + col];
        const cellWest = west + col * lngStep;
        const cellEast = cellWest + lngStep;
        const cellSouth = south + row * latStep;
        const cellNorth = cellSouth + latStep;

        const geometricCentroid = {
          latitude: cellSouth + latStep / 2,
          longitude: cellWest + lngStep / 2
        };
        // Centroide ponderado por accidentes reales: ubica el marcador sobre la
        // via donde efectivamente ocurren los siniestros, no en el centro de la celda.
        const centroid =
          cell.total > 0
            ? { latitude: cell.sumLat / cell.total, longitude: cell.sumLng / cell.total }
            : geometricCentroid;

        let minHotspotDistance = Number.POSITIVE_INFINITY;
        for (const hotspot of hotspotCells) {
          minHotspotDistance = Math.min(
            minHotspotDistance,
            haversineDistanceKm(centroid.latitude, centroid.longitude, hotspot.latitude, hotspot.longitude)
          );
        }
        if (!Number.isFinite(minHotspotDistance)) {
          minHotspotDistance = 25;
        }

        const corridorFactor = Math.exp(
          -Math.pow(
            (centroid.longitude - Number(cityRow.center_longitude)) /
              Math.max((east - west) * 0.22, 0.0001),
            2
          )
        );

        // El tipo de actor (moto/carro/peaton) no se registra en accident_events,
        // asi que se deriva con una heuristica determinista por celda.
        const random = createSeededRandom(`actor-${cityProfile.key}-${row}-${col}`);
        const actorMoto = clamp(0.26 + (1 - corridorFactor) * 0.24 + random() * 0.16, 0.12, 0.78);
        const actorCarro = clamp(0.28 + corridorFactor * 0.27 + random() * 0.16, 0.15, 0.8);
        const actorPeaton = clamp(0.1 + cell.weekend / Math.max(1, cell.total) * 0.3 + random() * 0.12, 0.05, 0.5);
        const actorSum = actorMoto + actorCarro + actorPeaton;

        const signalFeatures = computeSignalFeatures(signals, centroid, {
          west: cellWest,
          south: cellSouth,
          east: cellEast,
          north: cellNorth
        });

        // Tasa Poisson base de la celda: accidentes por dia sobre la ventana
        // observada. P(>=1 accidente en un dia) = 1 - e^(-lambda).
        const accidentsPerDay =
          observationDays && observationDays > 0 ? cell.total / observationDays : null;
        const accidentProbabilityDaily =
          accidentsPerDay === null ? null : clamp(1 - Math.exp(-accidentsPerDay), 0, 1);

        cells.push({
          id: `${cityProfile.key}-${row}-${col}`,
          row,
          col,
          roadSegment: `Zona ${row + 1}-${col + 1}`,
          centroid,
          signalDistKm: signalFeatures.signalDistKm,
          signalCount: signalFeatures.signalCount,
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [cellWest, cellSouth],
                [cellEast, cellSouth],
                [cellEast, cellNorth],
                [cellWest, cellNorth],
                [cellWest, cellSouth]
              ]
            ]
          },
          densityKd: clamp((cell.total / densityScale) * 1.2, 0.01, 1.45),
          distHotspotKm: clamp(minHotspotDistance, 0.05, 25),
          hourPeakAmPct: safeShare(cell.amPeak, cell.total, 0.18),
          hourPeakPmPct: safeShare(cell.pmPeak, cell.total, 0.22),
          weekendPct: safeShare(cell.weekend, cell.total, 0.28),
          rainPct: safeShare(cell.rain, cell.rain + cell.noRain, 0.35),
          dayPct: safeShare(cell.dia, cell.dia + cell.noche, 0.56),
          motoPct: actorMoto / actorSum,
          carroPct: actorCarro / actorSum,
          peatonPct: actorPeaton / actorSum,
          accidentesLeve: cell.leve,
          accidentesMedio: cell.medio,
          accidentesGrave: cell.grave,
          accidentesTotal: cell.total,
          accidentsPerDay,
          accidentProbabilityDaily
        });
      }
    }

    const cellsWithData = cells.filter((cell) => cell.accidentesTotal > 0).length;

    return {
      cells,
      dataset: {
        mode: dataset,
        sampleSize: usedAccidents,
        cellsWithData,
        coveragePct: Number(((cellsWithData / totalCells) * 100).toFixed(1)),
        gridRows: rows,
        gridCols: cols,
        observationDays
      }
    };
  } catch {
    return null;
  } finally {
    connection.release();
  }
};

export { buildRealCellsForCity, MIN_REAL_ACCIDENTS };
