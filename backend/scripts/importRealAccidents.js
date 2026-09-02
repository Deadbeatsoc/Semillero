import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { mysqlConfig, getSafeDatabaseName } from '../db/mysqlConfig.js';

// Carga en accident_events los siniestros reales ya geocodificados por
// scripts/geocode_real_accidents.py (data/real_accidents.json), etiquetados
// con dataset='real'. Reemplaza la carga real previa.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.resolve(__dirname, '..', 'data', 'real_accidents.json');
const CITY_KEY = process.env.SEED_CITY_KEY || 'villavicencio';
const SOURCE_SYSTEM = 'real_secretaria_movilidad';

const SEVERITY_VALUES = new Set(['baja', 'media', 'alta', 'fatal']);
const WEATHER_VALUES = new Set(['lluvia', 'no_lluvia', 'desconocido']);
const PERIOD_VALUES = new Set(['dia', 'noche', 'desconocido']);

// Backfill de clima: la fuente real no registra clima ('desconocido'). Se
// consulta el histORico de lluvia (Open-Meteo Archive, gratis y sin API key)
// por la hora exacta de cada siniestro y se marca 'lluvia'/'no_lluvia'.
// Desactivable con WEATHER_BACKFILL=false (queda 'desconocido').
const WEATHER_BACKFILL = String(process.env.WEATHER_BACKFILL ?? 'true').toLowerCase() !== 'false';
// Umbral de precipitacion (mm/h) para considerar la hora como lluviosa.
const RAIN_MM_THRESHOLD = Number(process.env.RAIN_MM_THRESHOLD ?? 0.1);
const ARCHIVE_URL = process.env.OPEN_METEO_ARCHIVE_URL || 'https://archive-api.open-meteo.com/v1/archive';
const ARCHIVE_TIMEZONE = process.env.WEATHER_TIMEZONE || 'America/Bogota';

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const isoDate = (occurredAt) => occurredAt.slice(0, 10);
// Clave horaria "YYYY-MM-DDTHH" alineada con hourly.time de Open-Meteo.
const hourKey = (occurredAt) => `${occurredAt.slice(0, 10)}T${occurredAt.slice(11, 13)}`;

// Descarga precipitacion horaria historica para el rango y punto dados y la
// indexa por hora. Devuelve un Map o null si falla / esta desactivado.
const fetchHourlyRainMap = async (records) => {
  if (!WEATHER_BACKFILL) return null;

  const dates = records.map((rec) => String(rec.occurred_at || '').slice(0, 19)).filter(Boolean).sort();
  if (!dates.length) return null;
  const startDate = isoDate(dates[0]);
  const endDate = isoDate(dates[dates.length - 1]);

  // Centroide de los siniestros: aproxima la lluvia de la zona (ciudad compacta).
  let sumLat = 0;
  let sumLon = 0;
  let n = 0;
  for (const rec of records) {
    const lat = Number(rec.latitude);
    const lon = Number(rec.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      sumLat += lat;
      sumLon += lon;
      n += 1;
    }
  }
  if (!n) return null;
  const latitude = (sumLat / n).toFixed(4);
  const longitude = (sumLon / n).toFixed(4);

  const url =
    `${ARCHIVE_URL}?latitude=${latitude}&longitude=${longitude}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=precipitation&timezone=${encodeURIComponent(ARCHIVE_TIMEZONE)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const times = json?.hourly?.time;
    const precip = json?.hourly?.precipitation;
    if (!Array.isArray(times) || !Array.isArray(precip) || times.length !== precip.length) {
      throw new Error('respuesta sin datos horarios');
    }
    const map = new Map();
    for (let i = 0; i < times.length; i += 1) {
      // times[i] = "2022-01-04T16:00" -> clave "2022-01-04T16".
      map.set(String(times[i]).slice(0, 13), Number(precip[i]) || 0);
    }
    // eslint-disable-next-line no-console
    console.log(`Clima historico: ${map.size} horas cargadas (${startDate} -> ${endDate}) en ${latitude},${longitude}.`);
    return map;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`Backfill de clima omitido (${error.message}); se conserva 'desconocido'.`);
    return null;
  }
};

const run = async () => {
  let raw;
  try {
    raw = await fs.readFile(JSON_PATH, 'utf8');
  } catch {
    throw new Error(
      `No existe ${JSON_PATH}. Ejecuta primero: python scripts/geocode_real_accidents.py`
    );
  }
  const records = JSON.parse(raw);
  if (!Array.isArray(records) || !records.length) {
    throw new Error('real_accidents.json no contiene registros.');
  }

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

    await connection.query(
      "DELETE FROM accident_events WHERE city_id = ? AND dataset = 'real'",
      [city.id]
    );

    const rainMap = await fetchHourlyRainMap(records);
    const weatherStats = { lluvia: 0, no_lluvia: 0, desconocido: 0, backfilled: 0 };

    const rows = [];
    for (const rec of records) {
      const lat = Number(rec.latitude);
      const lon = Number(rec.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const severity = SEVERITY_VALUES.has(rec.severity) ? rec.severity : 'media';
      let weather = WEATHER_VALUES.has(rec.weather) ? rec.weather : 'desconocido';
      const period = PERIOD_VALUES.has(rec.period) ? rec.period : 'desconocido';
      const occurredAt = String(rec.occurred_at || '').slice(0, 19);
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(occurredAt)) continue;

      // Solo se completa cuando la fuente no trae clima; un valor real se respeta.
      if (weather === 'desconocido' && rainMap) {
        const precip = rainMap.get(hourKey(occurredAt));
        if (precip !== undefined) {
          weather = precip >= RAIN_MM_THRESHOLD ? 'lluvia' : 'no_lluvia';
          weatherStats.backfilled += 1;
        }
      }
      weatherStats[weather] = (weatherStats[weather] || 0) + 1;

      rows.push([
        city.id,
        null,
        occurredAt,
        severity,
        weather,
        period,
        Number(lat.toFixed(7)),
        Number(lon.toFixed(7)),
        SOURCE_SYSTEM,
        'real',
        String(rec.description || 'Siniestro real').slice(0, 240)
      ]);
    }

    if (!rows.length) throw new Error('No hay filas validas para insertar.');

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

    const [[byYear]] = await connection.query(
      "SELECT MIN(occurred_at) mn, MAX(occurred_at) mx FROM accident_events WHERE city_id = ? AND dataset = 'real'",
      [city.id]
    );
    // eslint-disable-next-line no-console
    console.log(`Importados ${inserted} siniestros reales (dataset='real') en ${city.label}.`);
    // eslint-disable-next-line no-console
    console.log(`Rango temporal: ${byYear.mn} -> ${byYear.mx}`);
    // eslint-disable-next-line no-console
    console.log(
      `Clima: lluvia=${weatherStats.lluvia}, no_lluvia=${weatherStats.no_lluvia}, ` +
        `desconocido=${weatherStats.desconocido} (backfill aplicado a ${weatherStats.backfilled}).`
    );
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Error importando reales:', error.message);
  process.exit(1);
});
