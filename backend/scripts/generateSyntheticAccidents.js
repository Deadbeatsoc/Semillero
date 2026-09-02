import 'dotenv/config';
import mysql from 'mysql2/promise';
import { mysqlConfig, getSafeDatabaseName } from '../db/mysqlConfig.js';

// Genera MUCHOS accidentes sinteticos (aleatorios) sobre las vias OSM ya
// guardadas en road_segments. No requiere red (no vuelve a consultar Overpass).
// Se etiquetan con dataset='sintetico' para la base de datos "solo inventados".
const CITY_KEY = process.env.SEED_CITY_KEY || 'villavicencio';
const TARGET = Math.max(1, Number.parseInt(process.env.SYNTH_COUNT || '30000', 10) || 30000);
const MONTHS_BACK = Math.max(1, Number.parseInt(process.env.SYNTH_MONTHS_BACK || '36', 10) || 36);
const SOURCE_SYSTEM = 'synthetic_random_v1';
const ROAD_SOURCE = 'osm_overpass_seed';
const DELETE_PREVIOUS = (process.env.SYNTH_DELETE_PREVIOUS || 'true').toLowerCase() === 'true';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomInt = (min, max) => Math.floor(Math.random() * (Math.floor(max) - Math.ceil(min) + 1)) + Math.ceil(min);
const randomChoice = (items) => items[randomInt(0, items.length - 1)];

const haversineMeters = (a, b) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const computeSegments = (geometry) => {
  if (!Array.isArray(geometry) || geometry.length < 2) return null;
  let total = 0;
  const segments = [];
  for (let i = 1; i < geometry.length; i += 1) {
    const a = geometry[i - 1];
    const b = geometry[i];
    const length = haversineMeters(a, b);
    if (!Number.isFinite(length) || length <= 0.5) continue;
    total += length;
    segments.push({ a, b, length });
  }
  return segments.length && total > 0 ? { total, segments } : null;
};

const highwayWeight = (type) =>
  ({ motorway: 6, trunk: 5, primary: 4, secondary: 3.2, tertiary: 2.6, unclassified: 2, residential: 1.8, living_street: 1.5, service: 1.2 }[type] || 1.3);

const weightedPick = (items) => {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let target = Math.random() * total;
  for (const item of items) {
    target -= item.weight;
    if (target <= 0) return item;
  }
  return items[items.length - 1];
};

const pointOnRoad = (segments) => {
  const total = segments.reduce((sum, s) => sum + s.length, 0);
  let target = Math.random() * total;
  for (const s of segments) {
    if (target <= s.length) {
      const r = s.length <= 0 ? 0 : target / s.length;
      return { latitude: s.a.lat + (s.b.lat - s.a.lat) * r, longitude: s.a.lon + (s.b.lon - s.a.lon) * r };
    }
    target -= s.length;
  }
  const last = segments[segments.length - 1];
  return { latitude: last.b.lat, longitude: last.b.lon };
};

const chooseHour = () => {
  const roll = Math.random();
  if (roll < 0.23) return randomInt(6, 9);
  if (roll < 0.48) return randomInt(17, 20);
  if (roll < 0.74) return randomInt(10, 16);
  if (roll < 0.9) return randomInt(21, 23);
  return randomInt(0, 5);
};

const chooseSeverity = (hour) => {
  const pool =
    hour >= 22 || hour <= 4
      ? [{ value: 'baja', weight: 0.52 }, { value: 'media', weight: 0.29 }, { value: 'alta', weight: 0.15 }, { value: 'fatal', weight: 0.04 }]
      : [{ value: 'baja', weight: 0.63 }, { value: 'media', weight: 0.26 }, { value: 'alta', weight: 0.09 }, { value: 'fatal', weight: 0.02 }];
  return weightedPick(pool).value;
};

const chooseWeather = (month) => {
  const rainy = new Set([4, 5, 10, 11]);
  return Math.random() < (rainy.has(month) ? 0.58 : 0.33) ? 'lluvia' : 'no_lluvia';
};

const toMySqlDateTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const loadRoadSegments = async (connection, cityId) => {
  const [rows] = await connection.query(
    `SELECT id, name, highway_type, path_json FROM road_segments
     WHERE city_id = ? AND source = ? AND path_json IS NOT NULL`,
    [cityId, ROAD_SOURCE]
  );
  return rows
    .map((row) => {
      let path;
      try {
        path = JSON.parse(row.path_json);
      } catch {
        return null;
      }
      const geometry = Array.isArray(path)
        ? path.map((p) => ({ lon: Number(p[0]), lat: Number(p[1]) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
        : [];
      const metrics = computeSegments(geometry);
      if (!metrics) return null;
      return {
        id: row.id,
        name: row.name,
        segments: metrics.segments,
        weight: Math.max(1, Math.sqrt(metrics.total / 80) * highwayWeight(row.highway_type))
      };
    })
    .filter(Boolean);
};

const run = async () => {
  const connection = await mysql.createConnection({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    database: getSafeDatabaseName(),
    multipleStatements: true
  });

  try {
    const [cities] = await connection.query('SELECT id, label FROM cities WHERE city_key = ? LIMIT 1', [CITY_KEY]);
    if (!cities.length) throw new Error(`No existe la ciudad "${CITY_KEY}". Ejecuta npm run migrate.`);
    const city = cities[0];

    const segments = await loadRoadSegments(connection, city.id);
    if (segments.length < 50) {
      throw new Error(`Solo hay ${segments.length} vias. Ejecuta primero npm run seed:villavicencio (descarga OSM).`);
    }
    // eslint-disable-next-line no-console
    console.log(`Generando ${TARGET} accidentes sinteticos sobre ${segments.length} vias de ${city.label}...`);

    if (DELETE_PREVIOUS) {
      await connection.query(
        "DELETE FROM accident_events WHERE city_id = ? AND dataset = 'sintetico' AND source_system = ?",
        [city.id, SOURCE_SYSTEM]
      );
    }

    const now = new Date();
    const start = new Date(now);
    start.setUTCMonth(start.getUTCMonth() - MONTHS_BACK);

    const rows = [];
    for (let i = 0; i < TARGET; i += 1) {
      const seg = weightedPick(segments);
      const point = pointOnRoad(seg.segments);
      const occurredAt = new Date(start.getTime() + Math.random() * (now.getTime() - start.getTime()));
      const hour = chooseHour();
      occurredAt.setUTCHours(hour, randomInt(0, 59), randomInt(0, 59), 0);
      const severity = chooseSeverity(hour);
      const weather = chooseWeather(occurredAt.getUTCMonth() + 1);
      const period = hour >= 6 && hour < 18 ? 'dia' : 'noche';
      rows.push([
        city.id,
        seg.id,
        toMySqlDateTime(occurredAt),
        severity,
        weather,
        period,
        Number(clamp(point.latitude, -90, 90).toFixed(7)),
        Number(clamp(point.longitude, -180, 180).toFixed(7)),
        SOURCE_SYSTEM,
        'sintetico',
        `Evento sintetico aleatorio en ${seg.name || 'la via'}`
      ]);
    }

    let inserted = 0;
    for (const batch of chunk(rows, 500)) {
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      await connection.query(
        `INSERT INTO accident_events
           (city_id, road_segment_id, occurred_at, severity, weather, period, latitude, longitude, source_system, dataset, description)
         VALUES ${placeholders}`,
        batch.flat()
      );
      inserted += batch.length;
    }

    // eslint-disable-next-line no-console
    console.log(`Listo. Insertados ${inserted} accidentes sinteticos (dataset='sintetico').`);
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Error generando sinteticos:', error.message);
  process.exit(1);
});
