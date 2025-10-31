const { ARCGIS_PREDICTIONS_URL, ARCGIS_TOKEN, ARCGIS_USERNAME, ARCGIS_PASSWORD } = process.env;

class ArcgisClientError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'ArcgisClientError';
    this.status = status;
  }
}

const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return value;
  }
  return value.normalize('NFKC').trim();
};

const parseNumber = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const toLowerCase = (value) => {
  const normalized = normalizeString(value);
  return typeof normalized === 'string' ? normalized.toLowerCase() : normalized;
};

const extractAttribute = (attributes = {}, keys = []) => {
  for (const key of keys) {
    if (attributes[key] !== undefined && attributes[key] !== null && attributes[key] !== '') {
      return attributes[key];
    }
  }
  return undefined;
};

const mapFeatureToPrediction = (feature, fallbackId) => {
  const attributes = feature?.attributes ?? feature ?? {};
  const geometry = feature?.geometry ?? {};

  const id = extractAttribute(attributes, ['id', 'ID', 'objectId', 'OBJECTID', 'guid', 'GUID']) ?? fallbackId;
  const latitude =
    parseNumber(extractAttribute(attributes, ['latitude', 'Latitude', 'LATITUDE'])) ??
    parseNumber(extractAttribute(geometry, ['y', 'latitude', 'Latitude'])) ??
    undefined;

  const longitude =
    parseNumber(extractAttribute(attributes, ['longitude', 'Longitude', 'LONGITUDE'])) ??
    parseNumber(extractAttribute(geometry, ['x', 'longitude', 'Longitude'])) ??
    undefined;

  const riskScoreRaw = extractAttribute(attributes, ['riskScore', 'RISK_SCORE', 'risk_score', 'risk', 'RISK']);
  const riskScore = (() => {
    const parsed = parseNumber(riskScoreRaw);
    if (parsed === undefined) return undefined;
    if (parsed > 1) {
      return Math.min(parsed / 100, 1);
    }
    if (parsed < 0) {
      return 0;
    }
    return parsed;
  })();

  const date = normalizeString(
    extractAttribute(attributes, ['date', 'DATE', 'predictionDate', 'prediction_date', 'PredictionDate'])
  );

  const hour = normalizeString(extractAttribute(attributes, ['hour', 'HOUR', 'predictionHour', 'PredictionHour']));
  const weather = toLowerCase(extractAttribute(attributes, ['weather', 'WEATHER', 'climate', 'CLIMATE'])) ?? 'desconocido';
  const period = toLowerCase(extractAttribute(attributes, ['period', 'PERIOD', 'timePeriod', 'TIMEPERIOD'])) ?? 'desconocido';
  const roadSegment =
    normalizeString(
      extractAttribute(attributes, [
        'roadSegment',
        'ROAD_SEGMENT',
        'segment',
        'SEGMENT',
        'road_segment',
        'via',
        'VIA'
      ])
    ) ?? 'Segmento desconocido';

  return {
    id: String(id ?? fallbackId),
    latitude,
    longitude,
    riskScore: riskScore ?? 0,
    date: date ?? '',
    hour: hour ?? '',
    weather: weather ?? 'desconocido',
    period: period ?? 'desconocido',
    roadSegment
  };
};

const buildUrl = (filters = {}) => {
  if (!ARCGIS_PREDICTIONS_URL) {
    throw new ArcgisClientError('El endpoint de ArcGIS no está configurado.', 500);
  }

  const url = new URL(ARCGIS_PREDICTIONS_URL);
  const entries = Object.entries(filters).filter(([, value]) => value && value !== 'todos');

  for (const [key, value] of entries) {
    url.searchParams.set(key, value);
  }

  return url;
};

const buildHeaders = () => {
  const headers = {
    Accept: 'application/json'
  };

  if (ARCGIS_TOKEN) {
    headers.Authorization = `Bearer ${ARCGIS_TOKEN}`;
  } else if (ARCGIS_USERNAME && ARCGIS_PASSWORD) {
    const credentials = Buffer.from(`${ARCGIS_USERNAME}:${ARCGIS_PASSWORD}`).toString('base64');
    headers.Authorization = `Basic ${credentials}`;
  }

  return headers;
};

export const fetchArcgisPredictions = async (filters = {}) => {
  const url = buildUrl(filters);

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders()
    });
  } catch (error) {
    throw new ArcgisClientError('No se pudo conectar con ArcGIS.', 503);
  }

  if (!response.ok) {
    throw new ArcgisClientError('ArcGIS devolvió un error al solicitar predicciones.', response.status);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ArcgisClientError('La respuesta de ArcGIS no es un JSON válido.', 502);
  }

  if (payload.error) {
    throw new ArcgisClientError(payload.error.message || 'ArcGIS reportó un error interno.', 502);
  }

  const features = payload.features ?? payload.data ?? payload.results ?? [];
  if (!Array.isArray(features)) {
    throw new ArcgisClientError('El formato de la respuesta de ArcGIS es inesperado.', 502);
  }

  return features.map((feature, index) => mapFeatureToPrediction(feature, `arcgis-${index}`));
};

export { ArcgisClientError };
