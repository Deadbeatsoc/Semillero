import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRealCellsForCity } from './accidentDataProvider.js';
import { getSignalsForCity, computeSignalFeatures } from './trafficSignalsProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CITY_KEY = 'villavicencio';
const CACHE_TTL_MS = 5 * 60 * 1000;
// El modelo por ciudad se reconstruye periodicamente para reflejar nuevos
// accidentes ingestados (seed/reportes) sin reiniciar el proceso.
const MODEL_CACHE_TTL_MS = 15 * 60 * 1000;
// Limite de respuestas cacheadas para evitar crecimiento ilimitado de memoria.
const RESPONSE_CACHE_MAX_ENTRIES = 240;
const DEFAULT_GEOJSON_PATH = path.resolve(__dirname, '..', 'data', 'predicciones.geojson');

const CITY_PROFILES = {
  villavicencio: {
    key: 'villavicencio',
    label: 'Villavicencio',
    center: { latitude: 4.142, longitude: -73.6266 },
    zoom: 12,
    bbox: [-73.78, 4.01, -73.48, 4.27],
    rows: 14,
    cols: 14
  },
  bogota: {
    key: 'bogota',
    label: 'Bogota',
    center: { latitude: 4.711, longitude: -74.0721 },
    zoom: 11,
    bbox: [-74.25, 4.49, -73.99, 4.86],
    rows: 15,
    cols: 15
  },
  medellin: {
    key: 'medellin',
    label: 'Medellin',
    center: { latitude: 6.2442, longitude: -75.5812 },
    zoom: 12,
    bbox: [-75.7, 6.14, -75.49, 6.35],
    rows: 13,
    cols: 13
  },
  cali: {
    key: 'cali',
    label: 'Cali',
    center: { latitude: 3.4516, longitude: -76.532 },
    zoom: 12,
    bbox: [-76.62, 3.33, -76.46, 3.52],
    rows: 13,
    cols: 13
  },
  barranquilla: {
    key: 'barranquilla',
    label: 'Barranquilla',
    center: { latitude: 10.9685, longitude: -74.7813 },
    zoom: 12,
    bbox: [-74.9, 10.86, -74.71, 11.05],
    rows: 12,
    cols: 12
  }
};

const CITY_ALIASES = {
  villavo: 'villavicencio',
  villavicencio_meta: 'villavicencio',
  bogota_dc: 'bogota',
  bogota_d_c: 'bogota',
  medallo: 'medellin',
  medellin_antioquia: 'medellin'
};

const WEATHER_VALUES = new Set(['todos', 'lluvia', 'no_lluvia']);
const PERIOD_VALUES = new Set(['todos', 'dia', 'noche']);
const DATASET_VALUES = new Set(['mixto', 'real', 'sintetico']);
const DEFAULT_DATASET = 'mixto';
const RANGE_MODE_VALUES = new Set(['none', 'dia', 'mes']);
const MAX_RANGE_DAY_STEPS = 120;
const MAX_RANGE_MONTH_STEPS = 24;
const HIGH_SEVERITY_THRESHOLD = 0.75;
const MEDIUM_HIGH_SEVERITY_THRESHOLD = 0.62;
const ADDRESS_SCOPE_RADIUS_KM = 3.2;
const ADDRESS_SCOPE_MIN_POINTS = 8;
const ADDRESS_SCOPE_MAX_POINTS = 24;
const ADDRESS_SCOPE_QUERY_NEIGHBORS = 12;
const ADDRESS_SCOPE_DISTANCE_SIGMA_KM = 0.95;
const ADDRESS_SCOPE_MAX_REASONABLE_DISTANCE_KM = 6;
const CONTEXT_BASELINES = {
  rainPct: 0.35,
  dayPct: 0.56,
  weekendPct: 0.28,
  hourPeakAmPct: 0.42,
  hourPeakPmPct: 0.45
};

const cityModelCache = new Map();
const responseCache = new Map();

class LocalPredictionEngineError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'LocalPredictionEngineError';
    this.status = status;
  }
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeKey = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
};

const normalizeAddressText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
};

const parseCoordinate = (value, min, max) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number.parseFloat(String(value).trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (parsed < min || parsed > max) {
    return null;
  }
  return parsed;
};

const parseHour = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.floor(value);
    return rounded >= 0 && rounded <= 23 ? rounded : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const raw = value.trim();
  const match = raw.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) {
    return null;
  }

  const hour = Number.parseInt(match[1], 10);
  return hour >= 0 && hour <= 23 ? hour : null;
};

const toIsoDate = (value) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().slice(0, 10);
};

const toIsoMonth = (value) => {
  if (!value || typeof value !== 'string') {
    return '';
  }
  const raw = value.trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) {
    return '';
  }
  const [yearPart, monthPart] = raw.split('-');
  const year = Number.parseInt(yearPart, 10);
  const month = Number.parseInt(monthPart, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return '';
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
};

const parseIsoDateUtc = (isoDate) => {
  if (!isoDate) {
    return null;
  }
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseIsoMonthUtc = (isoMonth) => {
  if (!isoMonth) {
    return null;
  }
  const parsed = new Date(`${isoMonth}-01T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIsoMonthFromDate = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const formatHour = (hour) => {
  if (hour === null || hour === undefined) {
    return '';
  }
  const normalized = clamp(Number.parseInt(hour, 10) || 0, 0, 23);
  return `${String(normalized).padStart(2, '0')}:00`;
};

const resolvePeriodFromHour = (hour) => (hour >= 6 && hour < 18 ? 'dia' : 'noche');

const resolvePeriod = (period, hour) => {
  if (hour !== null && hour !== undefined) {
    return resolvePeriodFromHour(hour);
  }
  if (period && period !== 'todos') {
    return period;
  }
  return 'todos';
};

const normalizeDistribution = (distribution, fallbackKey = '') => {
  const entries = Object.entries(distribution || {}).map(([key, value]) => [
    key,
    clamp(Number(value) || 0, 0, 4)
  ]);

  if (!entries.length) {
    return fallbackKey ? { [fallbackKey]: 1 } : {};
  }

  let total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 1e-9) {
    total = 1;
    return Object.fromEntries(
      entries.map(([key]) => [key, key === fallbackKey ? 1 : 0])
    );
  }

  return Object.fromEntries(
    entries.map(([key, value]) => [key, Number((value / total).toFixed(4))])
  );
};

const resolveDominantLabel = (
  distribution,
  { fallback = '', mixedLabel = '', mixedDelta = 0 } = {}
) => {
  const sorted = Object.entries(distribution || {}).sort((left, right) => right[1] - left[1]);
  if (!sorted.length) {
    return fallback;
  }

  const [topLabel, topValue] = sorted[0];
  const secondValue = sorted[1]?.[1] ?? 0;
  if (mixedLabel && topValue - secondValue < mixedDelta) {
    return mixedLabel;
  }

  return topLabel;
};

const clampProbability = (value) => clamp(Number(value) || 0, 0.001, 0.999);

const safeLikelihoodRatio = (numerator, denominator, min = 0.35, max = 2.85) => {
  const numeratorClamped = clampProbability(numerator);
  const denominatorClamped = clampProbability(denominator);
  return clamp(numeratorClamped / denominatorClamped, min, max);
};

const applyLikelihoodRatioToProbability = (probability, likelihoodRatio) => {
  const p = clampProbability(probability);
  const lr = clamp(Number(likelihoodRatio) || 1, 0.28, 3.8);
  const odds = p / (1 - p);
  const updatedOdds = odds * lr;
  return updatedOdds / (1 + updatedOdds);
};

const gaussianDistanceWeight = (distanceKm, sigmaKm = ADDRESS_SCOPE_DISTANCE_SIGMA_KM) => {
  const safeSigma = Math.max(Number(sigmaKm) || 0, 0.15);
  const distance = Math.max(Number(distanceKm) || 0, 0);
  return Math.exp(-(distance * distance) / (2 * safeSigma * safeSigma));
};

const buildAccidentInsights = ({
  filters,
  predLeveProb,
  predMedioProb,
  predGraveProb,
  baseAccidentTypes,
  dayPct
}) => {
  const effectivePeriod = resolvePeriod(filters.period, filters.hour);
  const baseTypeDistribution = normalizeDistribution(
    {
      moto: baseAccidentTypes?.moto ?? 0.4,
      carro: baseAccidentTypes?.carro ?? 0.4,
      peaton: baseAccidentTypes?.peaton ?? 0.2
    },
    'carro'
  );

  let moto = baseTypeDistribution.moto;
  let carro = baseTypeDistribution.carro;
  let peaton = baseTypeDistribution.peaton;

  if (filters.hour !== null) {
    if (filters.hour >= 6 && filters.hour <= 9) {
      moto *= 1.18;
      carro *= 1.24;
      peaton *= 0.82;
    } else if (filters.hour >= 10 && filters.hour <= 16) {
      moto *= 0.94;
      carro *= 1.06;
      peaton *= 1.16;
    } else if (filters.hour >= 17 && filters.hour <= 21) {
      moto *= 1.24;
      carro *= 1.18;
      peaton *= 0.78;
    } else {
      moto *= 1.34;
      carro *= 0.82;
      peaton *= 0.56;
    }
  } else if (effectivePeriod === 'dia') {
    moto *= 0.93;
    carro *= 1.08;
    peaton *= 1.18;
  } else if (effectivePeriod === 'noche') {
    moto *= 1.23;
    carro *= 0.9;
    peaton *= 0.64;
  }

  if (filters.weather === 'lluvia') {
    moto *= 1.2 + (1 - clamp(dayPct, 0, 1)) * 0.12;
    carro *= 1.14;
    peaton *= 0.88;
  } else if (filters.weather === 'no_lluvia') {
    moto *= 0.92;
    carro *= 1.06;
    peaton *= 1.1;
  }

  const accidentTypeBreakdown = normalizeDistribution({ moto, carro, peaton }, 'carro');
  const probableAccidentType = resolveDominantLabel(accidentTypeBreakdown, {
    fallback: 'carro',
    mixedLabel: 'mixto',
    mixedDelta: 0.05
  });

  let baja = clamp(predLeveProb, 0, 1);
  let media = clamp(predMedioProb, 0, 1);
  let alta = clamp(predGraveProb, 0, 1);

  if (filters.weather === 'lluvia') {
    alta *= 1.19;
    media *= 1.09;
    baja *= 0.88;
  } else if (filters.weather === 'no_lluvia') {
    alta *= 0.9;
    media *= 0.98;
    baja *= 1.08;
  }

  if (filters.hour !== null) {
    if (filters.hour >= 0 && filters.hour <= 4) {
      alta *= 1.24;
      media *= 1.08;
      baja *= 0.82;
    } else if (filters.hour >= 17 && filters.hour <= 21) {
      alta *= 1.12;
      media *= 1.08;
    } else if (filters.hour >= 10 && filters.hour <= 15) {
      alta *= 0.93;
      baja *= 1.1;
    }
  } else if (effectivePeriod === 'noche') {
    alta *= 1.14;
    media *= 1.06;
    baja *= 0.9;
  }

  const severityBreakdown = normalizeDistribution({ baja, media, alta }, 'media');
  const probableSeverity = resolveDominantLabel(severityBreakdown, {
    fallback: 'media'
  });

  return {
    effectivePeriod,
    probableAccidentType,
    accidentTypeBreakdown,
    probableSeverity,
    severityBreakdown
  };
};

const normalizeRangeMode = (value) =>
  RANGE_MODE_VALUES.has(value) ? value : 'none';

const normalizeRangeValues = (rangeModeInput, rangeStartInput, rangeEndInput) => {
  const rangeMode = normalizeRangeMode(rangeModeInput);
  if (rangeMode === 'none') {
    return {
      rangeMode: 'none',
      rangeStart: '',
      rangeEnd: ''
    };
  }

  if (rangeMode === 'dia') {
    const start = toIsoDate(rangeStartInput);
    const end = toIsoDate(rangeEndInput);
    if (!start || !end) {
      return {
        rangeMode,
        rangeStart: '',
        rangeEnd: ''
      };
    }
    return start <= end
      ? { rangeMode, rangeStart: start, rangeEnd: end }
      : { rangeMode, rangeStart: end, rangeEnd: start };
  }

  const start = toIsoMonth(rangeStartInput);
  const end = toIsoMonth(rangeEndInput);
  if (!start || !end) {
    return {
      rangeMode,
      rangeStart: '',
      rangeEnd: ''
    };
  }
  return start <= end
    ? { rangeMode, rangeStart: start, rangeEnd: end }
    : { rangeMode, rangeStart: end, rangeEnd: start };
};

const isRangeActive = (filters) =>
  filters.rangeMode !== 'none' && Boolean(filters.rangeStart) && Boolean(filters.rangeEnd);

const buildRangeSteps = (filters) => {
  if (!isRangeActive(filters)) {
    return [];
  }

  if (filters.rangeMode === 'dia') {
    const start = parseIsoDateUtc(filters.rangeStart);
    const end = parseIsoDateUtc(filters.rangeEnd);
    if (!start || !end) {
      return [];
    }

    const dates = [];
    const cursor = new Date(start);
    while (cursor <= end && dates.length < MAX_RANGE_DAY_STEPS) {
      dates.push({
        date: cursor.toISOString().slice(0, 10),
        label: cursor.toISOString().slice(0, 10)
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
  }

  const start = parseIsoMonthUtc(filters.rangeStart);
  const end = parseIsoMonthUtc(filters.rangeEnd);
  if (!start || !end) {
    return [];
  }

  const months = [];
  const cursor = new Date(start);
  while (cursor <= end && months.length < MAX_RANGE_MONTH_STEPS) {
    const monthId = toIsoMonthFromDate(cursor);
    months.push({
      month: monthId,
      date: `${monthId}-15`,
      label: monthId
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
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

const createSeededRandom = (seedValue) => {
  const hasher = xmur3(String(seedValue));
  return mulberry32(hasher());
};

const toRadians = (degrees) => (degrees * Math.PI) / 180;

const haversineDistanceKm = (lat1, lng1, lat2, lng2) => {
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};

const percentile = (values, ratio) => {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.floor(clamp(ratio, 0, 1) * (sorted.length - 1));
  return sorted[index];
};

const sigmoid = (value) => {
  if (value > 35) return 1;
  if (value < -35) return 0;
  return 1 / (1 + Math.exp(-value));
};

const standardizeMatrix = (samples) => {
  if (!samples.length) {
    return { normalized: [], means: [], stds: [] };
  }

  const featureCount = samples[0].length;
  const means = new Array(featureCount).fill(0);
  const stds = new Array(featureCount).fill(0);

  for (const sample of samples) {
    for (let index = 0; index < featureCount; index += 1) {
      means[index] += sample[index];
    }
  }

  for (let index = 0; index < featureCount; index += 1) {
    means[index] /= samples.length;
  }

  for (const sample of samples) {
    for (let index = 0; index < featureCount; index += 1) {
      const diff = sample[index] - means[index];
      stds[index] += diff * diff;
    }
  }

  for (let index = 0; index < featureCount; index += 1) {
    stds[index] = Math.sqrt(stds[index] / samples.length);
    if (!Number.isFinite(stds[index]) || stds[index] < 1e-8) {
      stds[index] = 1;
    }
  }

  const normalized = samples.map((sample) =>
    sample.map((value, index) => (value - means[index]) / stds[index])
  );

  return { normalized, means, stds };
};

const buildSplit = (size, random) => {
  const indices = Array.from({ length: size }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(random() * (index + 1));
    [indices[index], indices[randomIndex]] = [indices[randomIndex], indices[index]];
  }

  let trainSize = Math.floor(size * 0.75);
  trainSize = clamp(trainSize, 1, size - 1);
  const trainIndices = indices.slice(0, trainSize);
  const testIndices = indices.slice(trainSize);

  if (testIndices.length === 0) {
    return { trainIndices: indices, testIndices: [] };
  }

  return { trainIndices, testIndices };
};

const createConstantModel = (probability) => ({
  type: 'constant',
  probability: clamp(probability, 0.01, 0.99),
  means: [],
  stds: [],
  weights: [],
  bias: 0,
  metrics: {
    accuracy: 1,
    precision: 1,
    recall: 1,
    f1: 1
  }
});

const evaluateBinaryClassification = (labels, probabilities) => {
  if (!labels.length || labels.length !== probabilities.length) {
    return {
      accuracy: 0,
      precision: 0,
      recall: 0,
      f1: 0
    };
  }

  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (let index = 0; index < labels.length; index += 1) {
    const predicted = probabilities[index] >= 0.5 ? 1 : 0;
    const expected = labels[index];

    if (predicted === 1 && expected === 1) truePositive += 1;
    if (predicted === 0 && expected === 0) trueNegative += 1;
    if (predicted === 1 && expected === 0) falsePositive += 1;
    if (predicted === 0 && expected === 1) falseNegative += 1;
  }

  const accuracy = (truePositive + trueNegative) / labels.length;
  const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
  const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    accuracy,
    precision,
    recall,
    f1
  };
};

const trainLogisticModel = (samples, labels, modelKey) => {
  if (!samples.length || !labels.length || samples.length !== labels.length) {
    return createConstantModel(0.5);
  }

  const positives = labels.reduce((sum, label) => sum + (label === 1 ? 1 : 0), 0);
  if (positives === 0 || positives === labels.length) {
    const probability = positives === 0 ? 0.05 : 0.95;
    return createConstantModel(probability);
  }

  const random = createSeededRandom(`split-${modelKey}`);
  const { normalized, means, stds } = standardizeMatrix(samples);
  const { trainIndices, testIndices } = buildSplit(samples.length, random);

  const featureCount = normalized[0].length;
  const weights = new Array(featureCount).fill(0);
  let bias = 0;

  const learningRate = 0.1;
  const l2Penalty = 0.0015;
  const iterations = 650;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = new Array(featureCount).fill(0);
    let biasGradient = 0;

    for (const rowIndex of trainIndices) {
      const row = normalized[rowIndex];
      const target = labels[rowIndex];

      let linear = bias;
      for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
        linear += weights[featureIndex] * row[featureIndex];
      }

      const prediction = sigmoid(linear);
      const error = prediction - target;
      biasGradient += error;

      for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
        gradient[featureIndex] += error * row[featureIndex];
      }
    }

    const batchSize = trainIndices.length || 1;
    bias -= learningRate * (biasGradient / batchSize);

    for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
      const regularizedGradient = gradient[featureIndex] / batchSize + l2Penalty * weights[featureIndex];
      weights[featureIndex] -= learningRate * regularizedGradient;
    }
  }

  const predictProbability = (row) => {
    const normalizedRow = row.map((value, index) => (value - means[index]) / stds[index]);
    let linear = bias;
    for (let index = 0; index < featureCount; index += 1) {
      linear += weights[index] * normalizedRow[index];
    }
    return sigmoid(linear);
  };

  const evalRows = testIndices.length ? testIndices : trainIndices;
  const evalLabels = evalRows.map((index) => labels[index]);
  const evalProbabilities = evalRows.map((index) => predictProbability(samples[index]));

  return {
    type: 'logistic',
    means,
    stds,
    weights,
    bias,
    metrics: evaluateBinaryClassification(evalLabels, evalProbabilities)
  };
};

const predictLogisticProbability = (model, sample) => {
  if (!model) {
    return 0;
  }

  if (model.type === 'constant') {
    return model.probability;
  }

  let linear = model.bias;
  for (let index = 0; index < sample.length; index += 1) {
    const scaled = (sample[index] - model.means[index]) / model.stds[index];
    linear += model.weights[index] * scaled;
  }

  return sigmoid(linear);
};

const getCityProfile = (cityInput) => {
  const normalized = normalizeKey(cityInput);
  const resolved = CITY_PROFILES[normalized] ? normalized : CITY_ALIASES[normalized];
  return CITY_PROFILES[resolved] || CITY_PROFILES[DEFAULT_CITY_KEY];
};

const resolveAddressPoint = (filters) => {
  const latitude = parseCoordinate(filters.latitude, -90, 90);
  const longitude = parseCoordinate(filters.longitude, -180, 180);
  const normalizedAddress = normalizeAddressText(filters.address);

  if (latitude !== null && longitude !== null) {
    return {
      address: filters.address?.trim() || `Lat ${latitude.toFixed(5)}, Lon ${longitude.toFixed(5)}`,
      normalizedAddress,
      latitude,
      longitude,
      source: 'coordinates'
    };
  }

  if (!normalizedAddress) {
    return null;
  }
  return null;
};

const hasActiveFilters = (filters) =>
  Boolean(
    filters.address ||
      (filters.latitude !== null && filters.longitude !== null) ||
      isRangeActive(filters) ||
      filters.date ||
      filters.hour !== null ||
      filters.weather !== 'todos' ||
      filters.period !== 'todos'
  );

const buildAddressScopedPredictions = (predictions, queryPoint) => {
  if (!queryPoint || !predictions.length) {
    return {
      predictions,
      query: null
    };
  }

  const predictionsWithDistance = predictions
    .map((prediction) => ({
      ...prediction,
      __distanceKm: haversineDistanceKm(
        queryPoint.latitude,
        queryPoint.longitude,
        prediction.latitude,
        prediction.longitude
      )
    }))
    .sort((left, right) => left.__distanceKm - right.__distanceKm);

  const nearestPrediction = predictionsWithDistance[0];
  if (!nearestPrediction) {
    return {
      predictions: [],
      query: null
    };
  }

  if (nearestPrediction.__distanceKm > ADDRESS_SCOPE_MAX_REASONABLE_DISTANCE_KM) {
    const fallbackSeverity = normalizeDistribution(
      {
        baja: nearestPrediction.predLeveProb ?? 0,
        media: nearestPrediction.predMedioProb ?? 0,
        alta: nearestPrediction.predGraveProb ?? 0
      },
      'media'
    );

    return {
      predictions: [],
      query: {
        address: queryPoint.address,
        normalizedAddress: queryPoint.normalizedAddress,
        latitude: queryPoint.latitude,
        longitude: queryPoint.longitude,
        source: queryPoint.source || 'unknown',
        matchedPredictionId: nearestPrediction.id,
        roadSegment: nearestPrediction.roadSegment,
        probability: nearestPrediction.riskScore,
        riskLevel: nearestPrediction.riskLevel,
        accidentProbabilityDaily: nearestPrediction.accidentProbabilityDaily ?? null,
        distanceKm: Number(nearestPrediction.__distanceKm.toFixed(3)),
        probableAccidentType: nearestPrediction.probableAccidentType || 'carro',
        accidentTypeBreakdown: nearestPrediction.accidentTypeBreakdown || null,
        probableSeverity: resolveDominantLabel(fallbackSeverity, { fallback: 'media' }),
        severityBreakdown: fallbackSeverity,
        weather: nearestPrediction.weather || 'todos',
        period: nearestPrediction.period || 'todos',
        hour: nearestPrediction.hour || '',
        supportPoints: 1,
        historicalAccidentCount: Number(nearestPrediction.historicalAccidentCount) || 0,
        withinCoverage: false
      }
    };
  }

  let selected = predictionsWithDistance.filter(
    (prediction) => prediction.__distanceKm <= ADDRESS_SCOPE_RADIUS_KM
  );

  if (selected.length < ADDRESS_SCOPE_MIN_POINTS) {
    selected = predictionsWithDistance.slice(0, ADDRESS_SCOPE_MIN_POINTS);
  }
  if (selected.length > ADDRESS_SCOPE_MAX_POINTS) {
    selected = selected.slice(0, ADDRESS_SCOPE_MAX_POINTS);
  }

  const selectedWithWeights = selected.map((prediction) => {
    const distanceWeight = gaussianDistanceWeight(prediction.__distanceKm);
    return {
      ...prediction,
      __distanceWeight: distanceWeight,
      __localScore: distanceWeight * (Number(prediction.riskScore) || 0)
    };
  });

  const queryNeighbors = selectedWithWeights.slice(
    0,
    Math.min(ADDRESS_SCOPE_QUERY_NEIGHBORS, selectedWithWeights.length)
  );
  const totalWeight = queryNeighbors.reduce((sum, prediction) => sum + prediction.__distanceWeight, 0);
  const safeTotalWeight = totalWeight > 1e-9 ? totalWeight : 1;
  const weightedAverage = (resolver, fallback) => {
    if (totalWeight <= 1e-9) {
      return fallback;
    }
    return queryNeighbors.reduce(
      (sum, prediction) => sum + resolver(prediction) * prediction.__distanceWeight,
      0
    ) / safeTotalWeight;
  };

  const weightedTypeBreakdown = normalizeDistribution(
    {
      moto: weightedAverage(
        (prediction) => clamp(prediction.motoPct ?? 0, 0, 1),
        clamp(nearestPrediction.motoPct ?? 0.33, 0, 1)
      ),
      carro: weightedAverage(
        (prediction) => clamp(prediction.carroPct ?? 0, 0, 1),
        clamp(nearestPrediction.carroPct ?? 0.33, 0, 1)
      ),
      peaton: weightedAverage(
        (prediction) => clamp(prediction.peatonPct ?? 0, 0, 1),
        clamp(nearestPrediction.peatonPct ?? 0.34, 0, 1)
      )
    },
    'carro'
  );
  const weightedSeverityBreakdown = normalizeDistribution(
    {
      baja: weightedAverage(
        (prediction) => clamp(prediction.predLeveProb ?? 0, 0, 1),
        clamp(nearestPrediction.predLeveProb ?? 0.33, 0, 1)
      ),
      media: weightedAverage(
        (prediction) => clamp(prediction.predMedioProb ?? 0, 0, 1),
        clamp(nearestPrediction.predMedioProb ?? 0.33, 0, 1)
      ),
      alta: weightedAverage(
        (prediction) => clamp(prediction.predGraveProb ?? 0, 0, 1),
        clamp(nearestPrediction.predGraveProb ?? 0.34, 0, 1)
      )
    },
    'media'
  );
  const weightedRiskScore = clamp(
    weightedAverage(
      (prediction) => clamp(prediction.riskScore ?? 0, 0, 1),
      clamp(nearestPrediction.riskScore ?? 0, 0, 1)
    ),
    0,
    1
  );
  // Probabilidad Poisson ponderada por distancia sobre los vecinos de la consulta.
  // Solo se reporta si TODOS los vecinos la tienen (mismo origen real); si alguno
  // carece del dato (sintetico/geojson), se deja null en vez de subestimar con 0.
  const neighborsHaveDailyProb = queryNeighbors.every((prediction) =>
    Number.isFinite(Number(prediction.accidentProbabilityDaily))
  );
  const weightedAccidentProbabilityDaily = neighborsHaveDailyProb
    ? clamp(
        weightedAverage((prediction) => clamp(prediction.accidentProbabilityDaily ?? 0, 0, 1), 0),
        0,
        1
      )
    : null;

  const normalizedSelected = selectedWithWeights
    .map((prediction) => ({
      ...prediction,
      distanceToQueryKm: Number(prediction.__distanceKm.toFixed(3)),
      isQueryMatch: prediction.id === nearestPrediction.id
    }))
    .sort((left, right) => {
      if (right.__localScore !== left.__localScore) {
        return right.__localScore - left.__localScore;
      }
      if (left.__distanceKm !== right.__distanceKm) {
        return left.__distanceKm - right.__distanceKm;
      }
      return right.riskScore - left.riskScore;
    })
    .map((prediction) => {
      const { __distanceKm, __distanceWeight, __localScore, ...rest } = prediction;
      return rest;
    });

  const query = {
    address: queryPoint.address,
    normalizedAddress: queryPoint.normalizedAddress,
    latitude: queryPoint.latitude,
    longitude: queryPoint.longitude,
    source: queryPoint.source || 'unknown',
    matchedPredictionId: nearestPrediction.id,
    roadSegment: nearestPrediction.roadSegment,
    probability: weightedRiskScore,
    riskLevel: getRiskLevel(weightedRiskScore),
    accidentProbabilityDaily: weightedAccidentProbabilityDaily,
    distanceKm: Number(nearestPrediction.__distanceKm.toFixed(3)),
    probableAccidentType: resolveDominantLabel(weightedTypeBreakdown, {
      fallback: 'carro',
      mixedLabel: 'mixto',
      mixedDelta: 0.05
    }),
    accidentTypeBreakdown: weightedTypeBreakdown,
    probableSeverity: resolveDominantLabel(weightedSeverityBreakdown, {
      fallback: 'media'
    }),
    severityBreakdown: weightedSeverityBreakdown,
    weather: nearestPrediction.weather || 'todos',
    period: nearestPrediction.period || 'todos',
    hour: nearestPrediction.hour || '',
    supportPoints: queryNeighbors.length,
    historicalAccidentCount: queryNeighbors.reduce(
      (sum, prediction) => sum + (Number(prediction.historicalAccidentCount) || 0),
      0
    ),
    withinCoverage: true
  };

  return {
    predictions: normalizedSelected,
    query
  };
};

const normalizeDataset = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return DATASET_VALUES.has(normalized) ? normalized : DEFAULT_DATASET;
};

const normalizeFilters = (filters = {}) => {
  const profile = getCityProfile(filters.city);
  const weather = WEATHER_VALUES.has(filters.weather) ? filters.weather : 'todos';
  const hour = parseHour(filters.hour);
  const requestedPeriod = PERIOD_VALUES.has(filters.period) ? filters.period : 'todos';
  const period = hour === null ? requestedPeriod : 'todos';
  const pointDate = toIsoDate(filters.date);
  const address = typeof filters.address === 'string' ? filters.address.trim() : '';
  const latitude = parseCoordinate(filters.latitude, -90, 90);
  const longitude = parseCoordinate(filters.longitude, -180, 180);
  const range = normalizeRangeValues(filters.rangeMode, filters.rangeStart, filters.rangeEnd);
  const rangeSelected = range.rangeMode !== 'none' && range.rangeStart && range.rangeEnd;

  return {
    city: profile.key,
    dataset: normalizeDataset(filters.dataset),
    weather,
    period,
    hour,
    date: rangeSelected ? '' : pointDate,
    address,
    latitude,
    longitude,
    rangeMode: range.rangeMode,
    rangeStart: range.rangeStart,
    rangeEnd: range.rangeEnd
  };
};

const buildSyntheticCells = (cityProfile, signals = []) => {
  const random = createSeededRandom(`grid-${cityProfile.key}`);
  const [west, south, east, north] = cityProfile.bbox;
  const lngStep = (east - west) / cityProfile.cols;
  const latStep = (north - south) / cityProfile.rows;

  const hotspots = Array.from({ length: 3 }, (_, index) => ({
    latitude: cityProfile.center.latitude + (random() - 0.5) * latStep * cityProfile.rows * 0.45,
    longitude: cityProfile.center.longitude + (random() - 0.5) * lngStep * cityProfile.cols * 0.45,
    spreadKm: 1.2 + random() * 1.8 + index * 0.15,
    weight: 0.55 + random() * 0.65
  }));

  const cells = [];

  for (let row = 0; row < cityProfile.rows; row += 1) {
    for (let col = 0; col < cityProfile.cols; col += 1) {
      const cellWest = west + col * lngStep;
      const cellEast = cellWest + lngStep;
      const cellSouth = south + row * latStep;
      const cellNorth = cellSouth + latStep;

      const centroid = {
        latitude: cellSouth + latStep / 2,
        longitude: cellWest + lngStep / 2
      };

      const corridorFactor = Math.exp(
        -Math.pow(
          (centroid.longitude - cityProfile.center.longitude) /
            Math.max((east - west) * 0.22, 0.0001),
          2
        )
      );

      let hotspotScore = 0;
      let minHotspotDistance = Number.POSITIVE_INFINITY;
      for (const hotspot of hotspots) {
        const distance = haversineDistanceKm(
          centroid.latitude,
          centroid.longitude,
          hotspot.latitude,
          hotspot.longitude
        );
        minHotspotDistance = Math.min(minHotspotDistance, distance);
        hotspotScore += hotspot.weight * Math.exp(-(distance * distance) / (2 * hotspot.spreadKm * hotspot.spreadKm));
      }

      const densityRaw = hotspotScore * 0.72 + corridorFactor * 0.4 + random() * 0.22;
      const accidentesTotal = Math.max(0, Math.round(densityRaw * 24 + (random() - 0.55) * 8));

      const rawGraveRatio = clamp(0.05 + densityRaw * 0.09 + random() * 0.045, 0.03, 0.4);
      const rawMedioRatio = clamp(0.16 + densityRaw * 0.14 + random() * 0.07, 0.08, 0.58);
      let rawLeveRatio = Math.max(0.08, 1 - rawGraveRatio - rawMedioRatio);
      const ratioSum = rawLeveRatio + rawMedioRatio + rawGraveRatio;
      rawLeveRatio /= ratioSum;
      const medioRatio = rawMedioRatio / ratioSum;
      const graveRatio = rawGraveRatio / ratioSum;

      const accidentesGrave = Math.round(accidentesTotal * graveRatio);
      const accidentesMedio = Math.round(accidentesTotal * medioRatio);
      const accidentesLeve = Math.max(0, accidentesTotal - accidentesMedio - accidentesGrave);

      const hourPeakAmPct = clamp(0.15 + corridorFactor * 0.2 + random() * 0.32, 0.03, 0.9);
      const hourPeakPmPct = clamp(0.18 + corridorFactor * 0.24 + random() * 0.3, 0.05, 0.9);
      const weekendPct = clamp(0.12 + (1 - corridorFactor) * 0.28 + random() * 0.22, 0.05, 0.88);
      const rainPct = clamp(0.16 + random() * 0.46 + (1 - corridorFactor) * 0.07, 0.05, 0.93);
      const dayPct = clamp(0.34 + corridorFactor * 0.23 + random() * 0.24, 0.12, 0.95);
      const baseActorDistribution = normalizeDistribution(
        {
          moto: clamp(0.26 + (1 - corridorFactor) * 0.24 + random() * 0.28, 0.12, 0.8),
          carro: clamp(0.28 + corridorFactor * 0.27 + random() * 0.26, 0.15, 0.82),
          peaton: clamp(0.1 + weekendPct * 0.23 + random() * 0.2, 0.05, 0.48)
        },
        'carro'
      );

      const signalFeatures = computeSignalFeatures(signals, centroid, {
        west: cellWest,
        south: cellSouth,
        east: cellEast,
        north: cellNorth
      });

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
        densityKd: clamp(densityRaw / 2.3, 0.01, 1.45),
        distHotspotKm: clamp(minHotspotDistance, 0.05, 25),
        hourPeakAmPct,
        hourPeakPmPct,
        weekendPct,
        rainPct,
        dayPct,
        motoPct: baseActorDistribution.moto,
        carroPct: baseActorDistribution.carro,
        peatonPct: baseActorDistribution.peaton,
        accidentesLeve,
        accidentesMedio,
        accidentesGrave,
        accidentesTotal
      });
    }
  }

  return cells;
};

const getBaseFeatureVector = (cell) => [
  cell.densityKd,
  cell.distHotspotKm,
  cell.hourPeakAmPct,
  cell.hourPeakPmPct,
  cell.weekendPct,
  cell.rainPct,
  cell.dayPct,
  cell.centroid.latitude,
  cell.centroid.longitude,
  // Proximidad a semaforo: distancia al mas cercano (km) y semaforos en la celda.
  cell.signalDistKm ?? 5,
  cell.signalCount ?? 0
];

const buildContextLikelihoodRatio = (cell, filters) => {
  const rainPct = clamp(cell.rainPct ?? CONTEXT_BASELINES.rainPct, 0.03, 0.97);
  const dayPct = clamp(cell.dayPct ?? CONTEXT_BASELINES.dayPct, 0.03, 0.97);
  const weekendPct = clamp(cell.weekendPct ?? CONTEXT_BASELINES.weekendPct, 0.03, 0.97);
  const hourPeakAmPct = clamp(cell.hourPeakAmPct ?? CONTEXT_BASELINES.hourPeakAmPct, 0.03, 0.97);
  const hourPeakPmPct = clamp(cell.hourPeakPmPct ?? CONTEXT_BASELINES.hourPeakPmPct, 0.03, 0.97);

  let likelihoodRatio = 1;

  if (filters.date) {
    const date = new Date(filters.date);
    if (!Number.isNaN(date.getTime())) {
      const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
      likelihoodRatio *= isWeekend
        ? safeLikelihoodRatio(weekendPct, CONTEXT_BASELINES.weekendPct, 0.45, 2.35)
        : safeLikelihoodRatio(1 - weekendPct, 1 - CONTEXT_BASELINES.weekendPct, 0.5, 2.1);
    }
  }

  if (filters.weather === 'lluvia') {
    likelihoodRatio *= safeLikelihoodRatio(rainPct, CONTEXT_BASELINES.rainPct, 0.45, 2.5);
  } else if (filters.weather === 'no_lluvia') {
    likelihoodRatio *= safeLikelihoodRatio(1 - rainPct, 1 - CONTEXT_BASELINES.rainPct, 0.5, 2.1);
  }

  if (filters.hour !== null) {
    if (filters.hour >= 6 && filters.hour <= 9) {
      likelihoodRatio *= safeLikelihoodRatio(hourPeakAmPct, CONTEXT_BASELINES.hourPeakAmPct, 0.42, 2.65);
    } else if (filters.hour >= 17 && filters.hour <= 20) {
      likelihoodRatio *= safeLikelihoodRatio(hourPeakPmPct, CONTEXT_BASELINES.hourPeakPmPct, 0.42, 2.65);
    } else if (filters.hour >= 10 && filters.hour <= 16) {
      likelihoodRatio *= safeLikelihoodRatio(dayPct, CONTEXT_BASELINES.dayPct, 0.55, 1.75);
    } else {
      likelihoodRatio *= safeLikelihoodRatio(1 - dayPct, 1 - CONTEXT_BASELINES.dayPct, 0.5, 2.25);
    }
  } else {
    const effectivePeriod = resolvePeriod(filters.period, filters.hour);
    if (effectivePeriod === 'dia') {
      likelihoodRatio *= safeLikelihoodRatio(dayPct, CONTEXT_BASELINES.dayPct, 0.55, 1.85);
    } else if (effectivePeriod === 'noche') {
      likelihoodRatio *= safeLikelihoodRatio(1 - dayPct, 1 - CONTEXT_BASELINES.dayPct, 0.5, 2.2);
    }
  }

  return clamp(likelihoodRatio, 0.22, 4.4);
};

const buildSeverityProbabilities = ({
  baseLeveProb,
  baseMedioProb,
  baseGraveProb,
  contextLikelihoodRatio
}) => {
  const leveAdjusted = applyLikelihoodRatioToProbability(baseLeveProb, Math.pow(contextLikelihoodRatio, 0.78));
  const medioAdjusted = applyLikelihoodRatioToProbability(baseMedioProb, contextLikelihoodRatio);
  const graveAdjusted = applyLikelihoodRatioToProbability(baseGraveProb, Math.pow(contextLikelihoodRatio, 1.22));
  const incidentProbability = clamp((leveAdjusted + medioAdjusted + graveAdjusted) / 3, 0, 1);

  const normalizedSeverity = normalizeDistribution(
    { baja: leveAdjusted, media: medioAdjusted, alta: graveAdjusted },
    'media'
  );

  return {
    incidentProbability,
    predLeveProb: clamp(normalizedSeverity.baja ?? 0, 0, 1),
    predMedioProb: clamp(normalizedSeverity.media ?? 0, 0, 1),
    predGraveProb: clamp(normalizedSeverity.alta ?? 0, 0, 1)
  };
};

const computeRiskScoreFromSeverity = ({
  incidentProbability = 0,
  predLeveProb,
  predMedioProb,
  predGraveProb
}) => {
  const severityImpact = clamp(predLeveProb * 0.35 + predMedioProb * 0.67 + predGraveProb, 0, 1);
  return clamp(incidentProbability * severityImpact, 0, 1);
};

// Probabilidad Poisson de >=1 accidente en un dia para la celda, ajustada por
// contexto (clima/hora/dia) via el likelihood ratio ya calculado. La tasa base
// (accidentsPerDay) proviene de datos reales; sin ella (sintetico/geojson) => null.
const computeAccidentProbabilityDaily = (accidentsPerDay, contextLikelihoodRatio = 1) => {
  const baseLambda = Number(accidentsPerDay);
  if (!Number.isFinite(baseLambda) || baseLambda < 0) {
    return null;
  }
  const ratio = clamp(Number(contextLikelihoodRatio) || 1, 0.22, 4.4);
  const lambdaConditioned = baseLambda * ratio;
  return clamp(1 - Math.exp(-lambdaConditioned), 0, 1);
};

const buildModel = (cells, cityKey) => {
  const features = cells.map((cell) => getBaseFeatureVector(cell));
  const leveCutoff = Math.max(1, percentile(cells.map((cell) => cell.accidentesLeve), 0.46));
  const medioCutoff = Math.max(1, percentile(cells.map((cell) => cell.accidentesMedio), 0.57));
  const graveCutoff = Math.max(1, percentile(cells.map((cell) => cell.accidentesGrave), 0.68));

  const labelsLeve = cells.map((cell) => (cell.accidentesLeve >= leveCutoff ? 1 : 0));
  const labelsMedio = cells.map((cell) => (cell.accidentesMedio >= medioCutoff ? 1 : 0));
  const labelsGrave = cells.map((cell) => (cell.accidentesGrave >= graveCutoff ? 1 : 0));

  const leveModel = trainLogisticModel(features, labelsLeve, `${cityKey}-leve`);
  const medioModel = trainLogisticModel(features, labelsMedio, `${cityKey}-medio`);
  const graveModel = trainLogisticModel(features, labelsGrave, `${cityKey}-grave`);

  return {
    models: {
      leve: leveModel,
      medio: medioModel,
      grave: graveModel
    },
    thresholds: {
      leve: leveCutoff,
      medio: medioCutoff,
      grave: graveCutoff
    },
    metrics: {
      leve: leveModel.metrics,
      medio: medioModel.metrics,
      grave: graveModel.metrics
    }
  };
};

const getRiskLevel = (score) => {
  if (score >= 0.78) return 'MUY_ALTO';
  if (score >= 0.62) return 'ALTO';
  if (score >= 0.45) return 'MEDIO';
  return 'BAJO';
};

const parseMaybeNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
};

const computeCentroidFromPolygon = (geometry) => {
  if (!geometry || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  const ring = geometry.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 3) {
    return null;
  }

  let latitude = 0;
  let longitude = 0;
  let count = 0;
  for (const coord of ring) {
    if (!Array.isArray(coord) || coord.length < 2) {
      continue;
    }
    const lng = parseMaybeNumber(coord[0]);
    const lat = parseMaybeNumber(coord[1]);
    if (lng === null || lat === null) {
      continue;
    }
    latitude += lat;
    longitude += lng;
    count += 1;
  }

  if (!count) {
    return null;
  }

  return {
    latitude: latitude / count,
    longitude: longitude / count
  };
};

const parseGeoJsonPredictions = async (cityProfile) => {
  const explicitPath = process.env.LOCAL_PREDICTIONS_GEOJSON;
  const targetPath = explicitPath ? path.resolve(explicitPath) : DEFAULT_GEOJSON_PATH;

  let raw;
  try {
    raw = await fs.readFile(targetPath, 'utf8');
  } catch (error) {
    return null;
  }

  try {
    const geojson = JSON.parse(raw);
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    if (!features.length) {
      return null;
    }

    const currentDate = new Date().toISOString().slice(0, 10);
    let hasExplicitCityKeys = false;
    const parsed = features
      .map((feature, index) => {
        const props = feature?.properties || {};
        const geometry = feature?.geometry || null;
        const featureCityKey = normalizeKey(props.cityKey ?? props.city ?? '');

        if (featureCityKey) {
          hasExplicitCityKeys = true;
        }

        if (featureCityKey && featureCityKey !== cityProfile.key) {
          return null;
        }

        const centroid = computeCentroidFromPolygon(geometry) || {
          latitude: parseMaybeNumber(props.latitude) ?? cityProfile.center.latitude,
          longitude: parseMaybeNumber(props.longitude) ?? cityProfile.center.longitude
        };
        const featureRandom = createSeededRandom(
          `${cityProfile.key}-gj-${props.OBJECTID ?? props.id ?? index}`
        );
        const corridorFactor = Math.exp(
          -Math.pow(
            (centroid.longitude - cityProfile.center.longitude) /
              Math.max((cityProfile.bbox[2] - cityProfile.bbox[0]) * 0.22, 0.0001),
            2
          )
        );

        const hourPeakAmPct = clamp(
          parseMaybeNumber(props.HOUR_PEAK_AM_PCT ?? props.hourPeakAmPct ?? props.hour_peak_am_pct) ??
            (0.17 + corridorFactor * 0.22 + featureRandom() * 0.28),
          0.03,
          0.94
        );
        const hourPeakPmPct = clamp(
          parseMaybeNumber(props.HOUR_PEAK_PM_PCT ?? props.hourPeakPmPct ?? props.hour_peak_pm_pct) ??
            (0.19 + corridorFactor * 0.24 + featureRandom() * 0.27),
          0.05,
          0.95
        );
        const weekendPct = clamp(
          parseMaybeNumber(props.WEEKEND_PCT ?? props.weekendPct ?? props.weekend_pct) ??
            (0.14 + (1 - corridorFactor) * 0.25 + featureRandom() * 0.2),
          0.05,
          0.9
        );
        const rainPct = clamp(
          parseMaybeNumber(props.RAIN_PCT ?? props.rainPct ?? props.rain_pct) ??
            (0.18 + featureRandom() * 0.44 + (1 - corridorFactor) * 0.08),
          0.05,
          0.95
        );
        const dayPct = clamp(
          parseMaybeNumber(props.DAY_PCT ?? props.dayPct ?? props.day_pct) ??
            (0.36 + corridorFactor * 0.23 + featureRandom() * 0.2),
          0.08,
          0.95
        );
        const baseActorDistribution = normalizeDistribution(
          {
            moto:
              parseMaybeNumber(props.MOTO_PCT ?? props.motoPct ?? props.moto_pct) ??
              (0.28 + (1 - corridorFactor) * 0.24 + featureRandom() * 0.22),
            carro:
              parseMaybeNumber(props.CARRO_PCT ?? props.carroPct ?? props.carro_pct) ??
              (0.32 + corridorFactor * 0.26 + featureRandom() * 0.21),
            peaton:
              parseMaybeNumber(props.PEATON_PCT ?? props.peatonPct ?? props.peaton_pct) ??
              (0.1 + weekendPct * 0.26 + featureRandom() * 0.18)
          },
          'carro'
        );

        const leve = clamp(
          parseMaybeNumber(props.PRED_LEVE_PROB ?? props.predLeveProb ?? props.pred_leve_prob) ?? 0,
          0,
          1
        );
        const medio = clamp(
          parseMaybeNumber(props.PRED_MEDIO_PROB ?? props.predMedioProb ?? props.pred_medio_prob) ?? 0,
          0,
          1
        );
        const grave = clamp(
          parseMaybeNumber(props.PRED_GRAVE_PROB ?? props.predGraveProb ?? props.pred_grave_prob) ?? 0,
          0,
          1
        );

        const weighted = clamp((leve + medio * 2 + grave * 3) / 6, 0, 1);
        const storedRisk = parseMaybeNumber(props.RIESGO_SCORE ?? props.riesgo_score ?? props.riskScore);
        const riskScore = storedRisk === null ? weighted : clamp(storedRisk > 1 ? storedRisk / 100 : storedRisk, 0, 1);

        return {
          id: String(props.OBJECTID ?? props.id ?? `${cityProfile.key}-gj-${index}`),
          city: cityProfile.label,
          cityKey: featureCityKey || cityProfile.key,
          roadSegment: String(props.roadSegment ?? props.SEGMENTO ?? props.segmento ?? `Zona ${index + 1}`),
          latitude: centroid.latitude,
          longitude: centroid.longitude,
          predLeveProb: leve,
          predMedioProb: medio,
          predGraveProb: grave,
          riskScore,
          riskLevel: getRiskLevel(riskScore),
          priority:
            parseMaybeNumber(props.PRIORIDAD ?? props.priority) ??
            (riskScore >= 0.78 ? 4 : riskScore >= 0.62 ? 3 : riskScore >= 0.45 ? 2 : 1),
          historicalAccidentCount:
            parseMaybeNumber(props.ACCIDENT_COUNT ?? props.accidentCount ?? props.accidentes_total) ?? 0,
          hourPeakAmPct,
          hourPeakPmPct,
          weekendPct,
          rainPct,
          dayPct,
          motoPct: baseActorDistribution.moto,
          carroPct: baseActorDistribution.carro,
          peatonPct: baseActorDistribution.peaton,
          weather: 'todos',
          period: 'todos',
          hour: '',
          date: currentDate,
          geometry
        };
      })
      .filter(Boolean)
      .filter(
        (prediction) =>
          Number.isFinite(prediction.latitude) &&
          Number.isFinite(prediction.longitude) &&
          prediction.riskScore >= 0
      );

    if (!hasExplicitCityKeys && cityProfile.key !== DEFAULT_CITY_KEY) {
      return null;
    }

    return parsed.length ? parsed : null;
  } catch (error) {
    throw new LocalPredictionEngineError(
      'No se pudo leer LOCAL_PREDICTIONS_GEOJSON. Verifica el formato GeoJSON.',
      500
    );
  }
};

const buildCityModel = async (cityKey, dataset = DEFAULT_DATASET) => {
  const profile = CITY_PROFILES[cityKey] || CITY_PROFILES[DEFAULT_CITY_KEY];

  const geojsonPredictions = await parseGeoJsonPredictions(profile);
  if (geojsonPredictions) {
    return {
      profile,
      source: 'geojson',
      predictions: geojsonPredictions,
      dataset: null,
      // Las predicciones GeoJSON son precomputadas externamente: no se entrenan
      // ni se evaluan aqui, asi que no hay metricas honestas que reportar.
      metrics: null
    };
  }

  // Prioridad de datos observados: si hay accidentes en MySQL para el dataset
  // seleccionado, el modelo se entrena sobre ellos (anclado a siniestralidad real).
  const realData = await buildRealCellsForCity(profile, dataset);
  if (realData && Array.isArray(realData.cells) && realData.cells.length) {
    const trainedReal = buildModel(realData.cells, `${cityKey}-${dataset}`);
    return {
      profile,
      source: 'mysql_accidents',
      cells: realData.cells,
      dataset: realData.dataset,
      models: trainedReal.models,
      metrics: trainedReal.metrics,
      thresholds: trainedReal.thresholds
    };
  }

  // Fallback: modelo sintetico procedural (sin datos cargados para ese dataset).
  const signals = await getSignalsForCity(profile.key);
  const cells = buildSyntheticCells(profile, signals);
  const trained = buildModel(cells, cityKey);

  return {
    profile,
    source: 'synthetic_model',
    cells,
    dataset: { mode: dataset, sampleSize: 0, cellsWithData: 0, coveragePct: 0 },
    models: trained.models,
    metrics: trained.metrics,
    thresholds: trained.thresholds
  };
};

const getOrCreateCityModel = async (cityKey, dataset = DEFAULT_DATASET) => {
  const cacheKey = `${cityKey}:${dataset}`;
  const cached = cityModelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.model;
  }

  const built = await buildCityModel(cityKey, dataset);
  cityModelCache.set(cacheKey, {
    model: built,
    expiresAt: Date.now() + MODEL_CACHE_TTL_MS
  });
  return built;
};

const buildCacheKey = (filters) =>
  JSON.stringify({
    city: filters.city,
    dataset: filters.dataset,
    date: filters.date,
    rangeMode: filters.rangeMode,
    rangeStart: filters.rangeStart,
    rangeEnd: filters.rangeEnd,
    hour: filters.hour,
    weather: filters.weather,
    period: filters.period,
    address: filters.address,
    latitude: filters.latitude,
    longitude: filters.longitude
  });

const formatPredictionFromCell = (cell, filters, cityModel) => {
  const features = getBaseFeatureVector(cell);
  const baseLeveProb = predictLogisticProbability(cityModel.models.leve, features);
  const baseMedioProb = predictLogisticProbability(cityModel.models.medio, features);
  const baseGraveProb = predictLogisticProbability(cityModel.models.grave, features);
  const contextLikelihoodRatio = buildContextLikelihoodRatio(cell, filters);
  const severityProbabilities = buildSeverityProbabilities({
    baseLeveProb,
    baseMedioProb,
    baseGraveProb,
    contextLikelihoodRatio
  });
  const { predLeveProb, predMedioProb, predGraveProb } = severityProbabilities;
  const riskScore = computeRiskScoreFromSeverity(severityProbabilities);
  const accidentProbabilityDaily = computeAccidentProbabilityDaily(
    cell.accidentsPerDay,
    contextLikelihoodRatio
  );
  const insights = buildAccidentInsights({
    filters,
    predLeveProb,
    predMedioProb,
    predGraveProb,
    baseAccidentTypes: {
      moto: cell.motoPct,
      carro: cell.carroPct,
      peaton: cell.peatonPct
    },
    dayPct: cell.dayPct
  });

  return {
    id: cell.id,
    city: cityModel.profile.label,
    cityKey: cityModel.profile.key,
    roadSegment: cell.roadSegment,
    latitude: cell.centroid.latitude,
    longitude: cell.centroid.longitude,
    predLeveProb,
    predMedioProb,
    predGraveProb,
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    accidentProbabilityDaily,
    accidentsPerDay: cell.accidentsPerDay ?? null,
    priority: riskScore >= 0.78 ? 4 : riskScore >= 0.62 ? 3 : riskScore >= 0.45 ? 2 : 1,
    historicalAccidentCount: cell.accidentesTotal ?? 0,
    historicalLeve: cell.accidentesLeve ?? 0,
    historicalMedio: cell.accidentesMedio ?? 0,
    historicalGrave: cell.accidentesGrave ?? 0,
    signalDistKm: cell.signalDistKm ?? null,
    signalCount: cell.signalCount ?? 0,
    date: filters.date || new Date().toISOString().slice(0, 10),
    hour: formatHour(filters.hour),
    weather: filters.weather,
    period: insights.effectivePeriod,
    probableAccidentType: insights.probableAccidentType,
    accidentTypeBreakdown: insights.accidentTypeBreakdown,
    probableSeverity: insights.probableSeverity,
    severityBreakdown: insights.severityBreakdown,
    hourPeakAmPct: cell.hourPeakAmPct,
    hourPeakPmPct: cell.hourPeakPmPct,
    weekendPct: cell.weekendPct,
    rainPct: cell.rainPct,
    dayPct: cell.dayPct,
    motoPct: cell.motoPct,
    carroPct: cell.carroPct,
    peatonPct: cell.peatonPct,
    geometry: cell.geometry
  };
};

const applyFiltersToGeoJsonPrediction = (prediction, filters) => {
  const pseudoCell = {
    hourPeakAmPct: clamp(prediction.hourPeakAmPct ?? 0.42, 0.03, 0.95),
    hourPeakPmPct: clamp(prediction.hourPeakPmPct ?? 0.45, 0.03, 0.95),
    weekendPct: clamp(prediction.weekendPct ?? 0.28, 0.05, 0.9),
    rainPct: clamp(prediction.rainPct ?? 0.36, 0.05, 0.95),
    dayPct: clamp(prediction.dayPct ?? 0.56, 0.05, 0.95)
  };
  const contextLikelihoodRatio = buildContextLikelihoodRatio(pseudoCell, filters);
  const severityProbabilities = buildSeverityProbabilities({
    baseLeveProb: prediction.predLeveProb,
    baseMedioProb: prediction.predMedioProb,
    baseGraveProb: prediction.predGraveProb,
    contextLikelihoodRatio
  });
  const { predLeveProb, predMedioProb, predGraveProb } = severityProbabilities;
  const riskScore = computeRiskScoreFromSeverity(severityProbabilities);
  const insights = buildAccidentInsights({
    filters,
    predLeveProb,
    predMedioProb,
    predGraveProb,
    baseAccidentTypes: {
      moto: prediction.motoPct,
      carro: prediction.carroPct,
      peaton: prediction.peatonPct
    },
    dayPct: pseudoCell.dayPct
  });

  return {
    ...prediction,
    predLeveProb,
    predMedioProb,
    predGraveProb,
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    // GeoJSON precomputado no trae tasa temporal: sin probabilidad Poisson honesta.
    accidentProbabilityDaily: null,
    accidentsPerDay: null,
    priority: riskScore >= 0.78 ? 4 : riskScore >= 0.62 ? 3 : riskScore >= 0.45 ? 2 : 1,
    date: filters.date || prediction.date,
    hour: filters.hour === null ? prediction.hour : formatHour(filters.hour),
    weather: filters.weather,
    period: insights.effectivePeriod,
    probableAccidentType: insights.probableAccidentType,
    accidentTypeBreakdown: insights.accidentTypeBreakdown,
    probableSeverity: insights.probableSeverity,
    severityBreakdown: insights.severityBreakdown
  };
};

const buildPredictions = (cityModel, filters) => {
  if (cityModel.source === 'geojson') {
    return cityModel.predictions
      .map((prediction) => applyFiltersToGeoJsonPrediction(prediction, filters))
      .sort((left, right) => right.riskScore - left.riskScore);
  }

  return cityModel.cells
    .map((cell) => formatPredictionFromCell(cell, filters, cityModel))
    .sort((left, right) => right.riskScore - left.riskScore);
};

const buildSeverePointsForRange = (cityModel, filters) => {
  const steps = buildRangeSteps(filters);
  if (!steps.length) {
    return {
      predictions: [],
      range: {
        isActive: true,
        mode: filters.rangeMode,
        start: filters.rangeStart,
        end: filters.rangeEnd,
        steps: 0,
        totalSeverePoints: 0
      }
    };
  }

  const byPointId = new Map();

  for (const step of steps) {
    const stepFilters = {
      ...filters,
      date: step.date
    };
    const stepPredictions = buildPredictions(cityModel, stepFilters);

    stepPredictions.forEach((prediction) => {
      const riskScore = Number(prediction.riskScore) || 0;
      const existing = byPointId.get(prediction.id);

      if (!existing) {
        byPointId.set(prediction.id, {
          ...prediction,
          riskScore,
          peakRiskScore: riskScore,
          rangePeakDate: step.label,
          rangeRiskSum: riskScore,
          rangeOccurrences: riskScore >= HIGH_SEVERITY_THRESHOLD ? 1 : 0
        });
        return;
      }

      existing.rangeRiskSum += riskScore;
      if (riskScore >= HIGH_SEVERITY_THRESHOLD) {
        existing.rangeOccurrences += 1;
      }

      if (riskScore > existing.peakRiskScore) {
        existing.peakRiskScore = riskScore;
        existing.rangePeakDate = step.label;
        existing.riskScore = riskScore;
        existing.riskLevel = prediction.riskLevel;
        existing.priority = prediction.priority;
        existing.predLeveProb = prediction.predLeveProb;
        existing.predMedioProb = prediction.predMedioProb;
        existing.predGraveProb = prediction.predGraveProb;
        existing.probableAccidentType = prediction.probableAccidentType;
        existing.accidentTypeBreakdown = prediction.accidentTypeBreakdown;
        existing.probableSeverity = prediction.probableSeverity;
        existing.severityBreakdown = prediction.severityBreakdown;
        existing.date = step.date;
        existing.hour = prediction.hour;
        existing.weather = prediction.weather;
        existing.period = prediction.period;
        existing.geometry = prediction.geometry;
      }
    });
  }

  const aggregated = Array.from(byPointId.values()).map((prediction) => {
    const averageRisk = prediction.rangeRiskSum / steps.length;
    const { rangeRiskSum, ...base } = prediction;

    return {
      ...base,
      rangeAverageRisk: Number(averageRisk.toFixed(3)),
      rangeWindowSteps: steps.length
    };
  });

  let severePoints = aggregated.filter(
    (prediction) =>
      prediction.peakRiskScore >= HIGH_SEVERITY_THRESHOLD || prediction.rangeOccurrences > 0
  );

  if (severePoints.length < 8) {
    severePoints = aggregated.filter(
      (prediction) => prediction.peakRiskScore >= MEDIUM_HIGH_SEVERITY_THRESHOLD
    );
  }

  severePoints = severePoints
    .sort((left, right) => {
      if (right.peakRiskScore !== left.peakRiskScore) {
        return right.peakRiskScore - left.peakRiskScore;
      }
      if (right.rangeOccurrences !== left.rangeOccurrences) {
        return right.rangeOccurrences - left.rangeOccurrences;
      }
      return right.rangeAverageRisk - left.rangeAverageRisk;
    })
    .slice(0, 120)
    .map((prediction) => ({
      ...prediction,
      isRangeSevere: true
    }));

  return {
    predictions: severePoints,
    range: {
      isActive: true,
      mode: filters.rangeMode,
      start: filters.rangeStart,
      end: filters.rangeEnd,
      steps: steps.length,
      totalSeverePoints: severePoints.length
    }
  };
};

const maybeGetCachedResponse = (cacheKey) => {
  const cached = responseCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt < Date.now()) {
    responseCache.delete(cacheKey);
    return null;
  }
  return cached.payload;
};

const storeResponseCache = (cacheKey, payload) => {
  // Evita crecimiento ilimitado: descarta la entrada mas antigua (orden de
  // insercion en Map) cuando se supera el limite configurado.
  while (responseCache.size >= RESPONSE_CACHE_MAX_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    responseCache.delete(oldestKey);
  }
  responseCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
};

const fetchLocalPredictions = async (inputFilters = {}) => {
  const filters = normalizeFilters(inputFilters);
  const cityProfile = getCityProfile(filters.city);
  const rangeActive = isRangeActive(filters);

  if (
    !rangeActive &&
    filters.address &&
    (filters.latitude === null || filters.longitude === null)
  ) {
    throw new LocalPredictionEngineError(
      'Selecciona una direccion sugerida o un punto en el mapa para usar coordenadas exactas.',
      400
    );
  }

  if (!hasActiveFilters(filters)) {
    return {
      data: [],
      meta: {
        city: cityProfile,
        generatedAt: new Date().toISOString(),
        source: 'idle',
        metrics: null,
        activeFilters: false,
        query: null,
        range: {
          isActive: false,
          mode: 'none',
          start: '',
          end: '',
          steps: 0,
          totalSeverePoints: 0
        },
        appliedFilters: filters
      }
    };
  }

  const cacheKey = buildCacheKey(filters);
  const cached = maybeGetCachedResponse(cacheKey);
  if (cached) {
    return cached;
  }

  const cityModel = await getOrCreateCityModel(filters.city, filters.dataset);
  let scopedPredictions = [];
  let query = null;
  let range = {
    isActive: false,
    mode: 'none',
    start: '',
    end: '',
    steps: 0,
    totalSeverePoints: 0
  };

  if (rangeActive) {
    const rangeResult = buildSeverePointsForRange(cityModel, filters);
    scopedPredictions = rangeResult.predictions;
    range = rangeResult.range;
  } else {
    const predictions = buildPredictions(cityModel, filters);
    const queryPoint = resolveAddressPoint(filters);
    const scoped = buildAddressScopedPredictions(predictions, queryPoint);
    scopedPredictions = scoped.predictions;
    query = scoped.query;
  }

  const payload = {
    data: scopedPredictions,
    meta: {
      city: cityModel.profile,
      generatedAt: new Date().toISOString(),
      source: cityModel.source,
      dataset: cityModel.dataset || null,
      metrics: cityModel.metrics,
      activeFilters: true,
      query,
      range,
      appliedFilters: filters
    }
  };

  storeResponseCache(cacheKey, payload);
  return payload;
};

const getAvailableCities = () =>
  Object.values(CITY_PROFILES).map((city) => ({
    key: city.key,
    label: city.label,
    center: city.center,
    zoom: city.zoom,
    bbox: city.bbox
  }));

const SOURCE_LABELS = {
  geojson: 'GeoJSON precomputado',
  mysql_accidents: 'Datos reales (MySQL)',
  synthetic_model: 'Modelo sintetico (fallback)'
};

// Resumen del modelo entrenado para una ciudad: fuente de datos, tamano de
// muestra y metricas honestas (evaluadas sobre conjunto de prueba). Pensado
// para alimentar el panel de desempeno del modelo en el dashboard admin.
const getCityModelInsights = async (cityKey = DEFAULT_CITY_KEY, dataset = DEFAULT_DATASET) => {
  const profile = getCityProfile(cityKey);
  const normalizedDataset = normalizeDataset(dataset);
  const cityModel = await getOrCreateCityModel(profile.key, normalizedDataset);

  const average = (selector) => {
    const values = ['leve', 'medio', 'grave']
      .map((key) => Number(cityModel.metrics?.[key]?.[selector]))
      .filter((value) => Number.isFinite(value));
    if (!values.length) {
      // Sin metricas medidas (p.ej. fuente geojson): null => la interfaz muestra N/D,
      // en vez de un 0% enganoso o un 100% inventado.
      return null;
    }
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
  };

  return {
    cityKey: profile.key,
    dataset: normalizedDataset,
    source: cityModel.source,
    sourceLabel: SOURCE_LABELS[cityModel.source] || cityModel.source,
    isDataDriven: cityModel.source === 'mysql_accidents' || cityModel.source === 'geojson',
    dataset: cityModel.dataset || null,
    metricsBySeverity: cityModel.metrics || null,
    averageMetrics: {
      accuracy: average('accuracy'),
      precision: average('precision'),
      recall: average('recall'),
      f1: average('f1')
    }
  };
};

export {
  LocalPredictionEngineError,
  fetchLocalPredictions,
  getAvailableCities,
  getCityModelInsights
};
