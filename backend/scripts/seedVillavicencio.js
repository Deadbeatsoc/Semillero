import 'dotenv/config';
import mysql from 'mysql2/promise';
import { mysqlConfig, getSafeDatabaseName } from '../db/mysqlConfig.js';

const CITY_KEY = process.env.SEED_CITY_KEY || 'villavicencio';
const TARGET_ACCIDENTS = Number.parseInt(process.env.SEED_ACCIDENT_COUNT || '5000', 10);
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const OVERPASS_TIMEOUT_SECONDS = Number.parseInt(process.env.OVERPASS_TIMEOUT_SECONDS || '180', 10);
const MAX_ROAD_WAYS = Number.parseInt(process.env.SEED_MAX_ROAD_WAYS || '2500', 10);
const SEED_SOURCE = 'seed_villavicencio_osm_v1';
const ROAD_SOURCE = 'osm_overpass_seed';
const DELETE_PREVIOUS = (process.env.SEED_DELETE_PREVIOUS || 'true').toLowerCase() === 'true';

const assertPositive = (value, fallback) => {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const randomInt = (min, max) => {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
};

const randomChoice = (items) => items[randomInt(0, items.length - 1)];

const haversineDistanceMeters = (a, b) => {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const earthRadius = 6371000;

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * earthRadius * Math.asin(Math.sqrt(h));
};

const buildOverpassQuery = (bbox) => {
  const { south, west, north, east } = bbox;
  return `
[out:json][timeout:${assertPositive(OVERPASS_TIMEOUT_SECONDS, 180)}];
(
  way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service"](${south},${west},${north},${east});
);
out geom;
`;
};

const weightedPick = (weightedItems) => {
  const total = weightedItems.reduce((sum, item) => sum + item.weight, 0);
  const target = Math.random() * total;
  let running = 0;
  for (const item of weightedItems) {
    running += item.weight;
    if (running >= target) {
      return item;
    }
  }
  return weightedItems[weightedItems.length - 1];
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
  let pool = [
    { value: 'baja', weight: 0.63 },
    { value: 'media', weight: 0.26 },
    { value: 'alta', weight: 0.09 },
    { value: 'fatal', weight: 0.02 }
  ];

  if (hour >= 22 || hour <= 4) {
    pool = [
      { value: 'baja', weight: 0.52 },
      { value: 'media', weight: 0.29 },
      { value: 'alta', weight: 0.15 },
      { value: 'fatal', weight: 0.04 }
    ];
  }

  return weightedPick(pool).value;
};

const chooseWeather = (month) => {
  const rainyMonths = new Set([4, 5, 10, 11]);
  const rainChance = rainyMonths.has(month) ? 0.58 : 0.33;
  return Math.random() < rainChance ? 'lluvia' : 'no_lluvia';
};

const buildDescription = (severity, roadName) => {
  const templates = {
    baja: [
      `Incidente leve en ${roadName}`,
      `Choque menor con danos materiales en ${roadName}`,
      `Afectacion leve de movilidad en ${roadName}`
    ],
    media: [
      `Colision con lesionados en ${roadName}`,
      `Accidente de severidad media reportado en ${roadName}`,
      `Siniestro vial con atencion medica en ${roadName}`
    ],
    alta: [
      `Accidente grave con cierre parcial en ${roadName}`,
      `Evento de alta severidad en ${roadName}`,
      `Siniestro vial grave con alta afectacion en ${roadName}`
    ],
    fatal: [
      `Accidente fatal reportado en ${roadName}`,
      `Siniestro mortal en ${roadName}`,
      `Evento vial critico con victimas fatales en ${roadName}`
    ]
  };

  return randomChoice(templates[severity] || templates.media);
};

const toMySqlDateTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

const chunkArray = (collection, size) => {
  const chunks = [];
  for (let index = 0; index < collection.length; index += size) {
    chunks.push(collection.slice(index, index + size));
  }
  return chunks;
};

const computePolylineMetrics = (geometry) => {
  if (!Array.isArray(geometry) || geometry.length < 2) {
    return null;
  }

  let totalLength = 0;
  let sumLat = 0;
  let sumLon = 0;
  const segments = [];

  for (let index = 1; index < geometry.length; index += 1) {
    const a = geometry[index - 1];
    const b = geometry[index];
    const length = haversineDistanceMeters(a, b);
    if (!Number.isFinite(length) || length <= 0.5) {
      continue;
    }

    totalLength += length;
    sumLat += ((a.lat + b.lat) / 2) * length;
    sumLon += ((a.lon + b.lon) / 2) * length;
    segments.push({
      a,
      b,
      length
    });
  }

  if (!segments.length || totalLength <= 0) {
    return null;
  }

  return {
    totalLength,
    centroidLat: sumLat / totalLength,
    centroidLon: sumLon / totalLength,
    segments
  };
};

const selectPointOnRoad = (segments) => {
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  let target = Math.random() * totalLength;

  for (const segment of segments) {
    if (target <= segment.length) {
      const ratio = segment.length <= 0 ? 0 : target / segment.length;
      const lat = segment.a.lat + (segment.b.lat - segment.a.lat) * ratio;
      const lon = segment.a.lon + (segment.b.lon - segment.a.lon) * ratio;
      return { latitude: lat, longitude: lon };
    }
    target -= segment.length;
  }

  const last = segments[segments.length - 1];
  return { latitude: last.b.lat, longitude: last.b.lon };
};

const fetchRoadWays = async (bbox) => {
  const query = buildOverpassQuery(bbox);
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    },
    body: query
  });

  if (!response.ok) {
    throw new Error(`Overpass devolvio ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const ways = Array.isArray(payload.elements)
    ? payload.elements.filter((element) => element.type === 'way')
    : [];

  if (!ways.length) {
    throw new Error('Overpass no devolvio vias para el bbox configurado');
  }

  return ways;
};

const normalizeWayName = (way) => {
  const name = way?.tags?.name;
  if (typeof name === 'string' && name.trim()) {
    return name.trim().slice(0, 180);
  }
  return `Via OSM ${way.id}`;
};

const highwayWeight = (highwayType) => {
  const weights = {
    motorway: 6,
    trunk: 5,
    primary: 4,
    secondary: 3.2,
    tertiary: 2.6,
    unclassified: 2,
    residential: 1.8,
    living_street: 1.5,
    service: 1.2
  };
  return weights[highwayType] || 1.3;
};

const prepareRoadRows = (ways) => {
  const rows = [];

  ways.forEach((way) => {
    const geometry = Array.isArray(way.geometry)
      ? way.geometry
          .map((point) => ({
            lat: Number(point.lat),
            lon: Number(point.lon)
          }))
          .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
      : [];

    const metrics = computePolylineMetrics(geometry);
    if (!metrics || metrics.totalLength < 50) {
      return;
    }

    rows.push({
      segmentCode: `osm_way_${way.id}`,
      name: normalizeWayName(way),
      centroidLatitude: Number(metrics.centroidLat.toFixed(7)),
      centroidLongitude: Number(metrics.centroidLon.toFixed(7)),
      highwayType: String(way?.tags?.highway || 'residential').slice(0, 40),
      pathJson: JSON.stringify(geometry.map((point) => [point.lon, point.lat]))
    });
  });

  return rows;
};

const upsertRoadSegments = async (connection, cityId, roadRows) => {
  for (const chunk of chunkArray(roadRows, 120)) {
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const sql = `
      INSERT INTO road_segments (
        city_id,
        segment_code,
        name,
        centroid_latitude,
        centroid_longitude,
        source,
        highway_type,
        path_json
      )
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        centroid_latitude = VALUES(centroid_latitude),
        centroid_longitude = VALUES(centroid_longitude),
        source = VALUES(source),
        highway_type = VALUES(highway_type),
        path_json = VALUES(path_json),
        updated_at = CURRENT_TIMESTAMP
    `;

    const params = [];
    chunk.forEach((row) => {
      params.push(
        cityId,
        row.segmentCode,
        row.name,
        row.centroidLatitude,
        row.centroidLongitude,
        ROAD_SOURCE,
        row.highwayType,
        row.pathJson
      );
    });

    await connection.query(sql, params);
  }
};

const loadRoadSegments = async (connection, cityId) => {
  const [rows] = await connection.query(
    `
      SELECT id, name, highway_type, path_json
      FROM road_segments
      WHERE city_id = ? AND source = ? AND path_json IS NOT NULL
    `,
    [cityId, ROAD_SOURCE]
  );

  return rows
    .map((row) => {
      let path;
      try {
        path = JSON.parse(row.path_json);
      } catch (error) {
        return null;
      }

      const geometry = Array.isArray(path)
        ? path
            .map((point) => ({
              lon: Number(point[0]),
              lat: Number(point[1])
            }))
            .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
        : [];

      const metrics = computePolylineMetrics(geometry);
      if (!metrics || metrics.totalLength < 40) {
        return null;
      }

      return {
        id: row.id,
        name: row.name,
        highwayType: row.highway_type || 'residential',
        segments: metrics.segments,
        weight: Math.max(1, Math.sqrt(metrics.totalLength / 80) * highwayWeight(row.highway_type))
      };
    })
    .filter(Boolean);
};

const generateAccidents = (segments, cityId, amount) => {
  const now = new Date();
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - 24);

  const weightedSegments = segments.map((segment) => ({
    ...segment,
    weight: segment.weight
  }));

  const rows = [];
  for (let index = 0; index < amount; index += 1) {
    const selectedSegment = weightedPick(weightedSegments);
    const point = selectPointOnRoad(selectedSegment.segments);

    const occurredAt = new Date(start.getTime() + Math.random() * (now.getTime() - start.getTime()));
    const hour = chooseHour();
    occurredAt.setUTCHours(hour, randomInt(0, 59), randomInt(0, 59), 0);

    const severity = chooseSeverity(hour);
    const weather = chooseWeather(occurredAt.getUTCMonth() + 1);
    const period = hour >= 6 && hour < 18 ? 'dia' : 'noche';

    rows.push({
      cityId,
      roadSegmentId: selectedSegment.id,
      occurredAt: toMySqlDateTime(occurredAt),
      severity,
      weather,
      period,
      latitude: Number(clamp(point.latitude, -90, 90).toFixed(7)),
      longitude: Number(clamp(point.longitude, -180, 180).toFixed(7)),
      sourceSystem: SEED_SOURCE,
      description: buildDescription(severity, selectedSegment.name || 'la via')
    });
  }

  return rows;
};

const insertAccidents = async (connection, rows) => {
  for (const chunk of chunkArray(rows, 300)) {
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const sql = `
      INSERT INTO accident_events (
        city_id,
        road_segment_id,
        occurred_at,
        severity,
        weather,
        period,
        latitude,
        longitude,
        source_system,
        description
      )
      VALUES ${placeholders}
    `;

    const params = [];
    chunk.forEach((row) => {
      params.push(
        row.cityId,
        row.roadSegmentId,
        row.occurredAt,
        row.severity,
        row.weather,
        row.period,
        row.latitude,
        row.longitude,
        row.sourceSystem,
        row.description
      );
    });

    await connection.query(sql, params);
  }
};

const run = async () => {
  const accidentCount = assertPositive(TARGET_ACCIDENTS, 5000);
  const connection = await mysql.createConnection({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    database: getSafeDatabaseName(),
    multipleStatements: true
  });

  try {
    const [cities] = await connection.query(
      `
        SELECT id, label, bbox_west, bbox_south, bbox_east, bbox_north
        FROM cities
        WHERE city_key = ?
        LIMIT 1
      `,
      [CITY_KEY]
    );

    if (!cities.length) {
      throw new Error(`No existe la ciudad "${CITY_KEY}" en tabla cities. Ejecuta primero npm run migrate.`);
    }

    const city = cities[0];
    if (
      !Number.isFinite(Number(city.bbox_west)) ||
      !Number.isFinite(Number(city.bbox_south)) ||
      !Number.isFinite(Number(city.bbox_east)) ||
      !Number.isFinite(Number(city.bbox_north))
    ) {
      throw new Error(`La ciudad ${CITY_KEY} no tiene bbox configurado en la base de datos.`);
    }

    // eslint-disable-next-line no-console
    console.log(`Descargando red vial OSM para ${city.label} (${CITY_KEY})...`);
    const ways = await fetchRoadWays({
      south: Number(city.bbox_south),
      west: Number(city.bbox_west),
      north: Number(city.bbox_north),
      east: Number(city.bbox_east)
    });

    const candidateRoads = prepareRoadRows(ways);
    if (!candidateRoads.length) {
      throw new Error('No se pudieron construir segmentos viales validos desde OSM.');
    }

    const limitedRoads =
      candidateRoads.length > MAX_ROAD_WAYS
        ? candidateRoads
            .sort(() => Math.random() - 0.5)
            .slice(0, assertPositive(MAX_ROAD_WAYS, 2500))
        : candidateRoads;

    // eslint-disable-next-line no-console
    console.log(`Guardando ${limitedRoads.length} vias en road_segments...`);
    await upsertRoadSegments(connection, city.id, limitedRoads);

    const preparedSegments = await loadRoadSegments(connection, city.id);
    if (preparedSegments.length < 50) {
      throw new Error(
        `Solo hay ${preparedSegments.length} segmentos validos. Revisa acceso a Overpass o ejecuta migrate nuevamente.`
      );
    }

    if (DELETE_PREVIOUS) {
      await connection.query(
        'DELETE FROM accident_events WHERE city_id = ? AND source_system = ?',
        [city.id, SEED_SOURCE]
      );
    }

    const accidents = generateAccidents(preparedSegments, city.id, accidentCount);
    // eslint-disable-next-line no-console
    console.log(`Insertando ${accidents.length} accidentes ficticios sobre vias reales...`);
    await insertAccidents(connection, accidents);

    // eslint-disable-next-line no-console
    console.log('Seed completado correctamente.');
    // eslint-disable-next-line no-console
    console.log(`Ciudad: ${CITY_KEY}`);
    // eslint-disable-next-line no-console
    console.log(`Registros accident_events insertados: ${accidents.length}`);
    // eslint-disable-next-line no-console
    console.log(`Origen: ${SEED_SOURCE}`);
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Error en seed Villavicencio:', error.message);
  process.exit(1);
});
