import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CITY_KEY = 'villavicencio';
const CACHE_TTL_MS = 5 * 60 * 1000;
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
const RANGE_MODE_VALUES = new Set(['none', 'dia', 'mes']);
const MAX_RANGE_DAY_STEPS = 120;
const MAX_RANGE_MONTH_STEPS = 24;
const HIGH_SEVERITY_THRESHOLD = 0.75;
const MEDIUM_HIGH_SEVERITY_THRESHOLD = 0.62;

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

const resolvePeriod = (period, hour) => {
  if (period && period !== 'todos') {
    return period;
  }
  if (hour === null || hour === undefined) {
    return 'todos';
  }
  return hour >= 6 && hour < 18 ? 'dia' : 'noche';
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

const resolveAddressPoint = (filters, cityProfile) => {
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

  const [west, south, east, north] = cityProfile.bbox;
  const random = createSeededRandom(`${cityProfile.key}-${normalizedAddress}`);

  const numberTokens = normalizedAddress.match(/\d+/g) || [];
  const firstNumber = numberTokens[0] ? Number.parseInt(numberTokens[0], 10) : Math.round(random() * 99 + 1);
  const secondNumber = numberTokens[1] ? Number.parseInt(numberTokens[1], 10) : Math.round(random() * 99 + 1);

  let colRatio = (firstNumber % 100) / 100;
  let rowRatio = (secondNumber % 100) / 100;

  const isCarrera = /\b(carrera|cra|cr|kr)\b/.test(normalizedAddress);
  const isCalle = /\b(calle|cll|cl)\b/.test(normalizedAddress);

  if (isCalle && !isCarrera) {
    rowRatio = (firstNumber % 100) / 100;
    colRatio = (secondNumber % 100) / 100;
  }

  if (!numberTokens.length) {
    colRatio = random();
    rowRatio = random();
  }

  const jitterLng = (random() - 0.5) * 0.04;
  const jitterLat = (random() - 0.5) * 0.04;
  colRatio = clamp(colRatio + jitterLng, 0.05, 0.95);
  rowRatio = clamp(rowRatio + jitterLat, 0.05, 0.95);

  return {
    address: filters.address.trim(),
    normalizedAddress,
    latitude: south + (north - south) * rowRatio,
    longitude: west + (east - west) * colRatio,
    source: 'address_heuristic'
  };
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
  const maxDistanceKm = 2.4;
  let selected = predictionsWithDistance.filter((prediction) => prediction.__distanceKm <= maxDistanceKm);

  if (selected.length < 6) {
    selected = predictionsWithDistance.slice(0, 12);
  }

  const normalizedSelected = selected
    .map((prediction) => ({
      ...prediction,
      distanceToQueryKm: Number(prediction.__distanceKm.toFixed(3)),
      isQueryMatch: prediction.id === nearestPrediction.id
    }))
    .sort((left, right) => right.riskScore - left.riskScore)
    .map((prediction) => {
      const { __distanceKm, ...rest } = prediction;
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
    probability: nearestPrediction.riskScore,
    riskLevel: nearestPrediction.riskLevel,
    distanceKm: Number(nearestPrediction.__distanceKm.toFixed(3))
  };

  return {
    predictions: normalizedSelected,
    query
  };
};

const normalizeFilters = (filters = {}) => {
  const profile = getCityProfile(filters.city);
  const weather = WEATHER_VALUES.has(filters.weather) ? filters.weather : 'todos';
  const period = PERIOD_VALUES.has(filters.period) ? filters.period : 'todos';
  const hour = parseHour(filters.hour);
  const pointDate = toIsoDate(filters.date);
  const address = typeof filters.address === 'string' ? filters.address.trim() : '';
  const latitude = parseCoordinate(filters.latitude, -90, 90);
  const longitude = parseCoordinate(filters.longitude, -180, 180);
  const range = normalizeRangeValues(filters.rangeMode, filters.rangeStart, filters.rangeEnd);
  const rangeSelected = range.rangeMode !== 'none' && range.rangeStart && range.rangeEnd;

  return {
    city: profile.key,
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

const buildSyntheticCells = (cityProfile) => {
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

      cells.push({
        id: `${cityProfile.key}-${row}-${col}`,
        row,
        col,
        roadSegment: `Zona ${row + 1}-${col + 1}`,
        centroid,
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
  cell.centroid.longitude
];

const buildFilterFactors = (cell, filters) => {
  let density = 1;
  let am = 1;
  let pm = 1;
  let weekend = 1;
  let rain = 1;
  let day = 1;

  if (filters.date) {
    const date = new Date(filters.date);
    if (!Number.isNaN(date.getTime())) {
      const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
      if (isWeekend) {
        density *= 0.9 + 0.75 * cell.weekendPct;
        weekend *= 1.35;
      } else {
        density *= 1.05 + (1 - cell.weekendPct) * 0.22;
        weekend *= 0.86;
      }

      const month = date.getUTCMonth() + 1;
      if ([4, 5, 10, 11].includes(month)) {
        density *= 1.08;
      }
      if ([12, 1].includes(month)) {
        density *= 1.06;
        weekend *= 1.08;
      }
      if ([6, 7, 8].includes(month)) {
        density *= 0.97;
      }
    }
  }

  if (filters.hour !== null) {
    if (filters.hour >= 6 && filters.hour <= 9) {
      density *= 1 + 0.58 * cell.hourPeakAmPct;
      am *= 1.35;
      pm *= 0.9;
    } else if (filters.hour >= 17 && filters.hour <= 20) {
      density *= 1 + 0.62 * cell.hourPeakPmPct;
      pm *= 1.38;
      am *= 0.9;
    } else if (filters.hour >= 0 && filters.hour <= 4) {
      density *= 0.68 + (1 - cell.dayPct) * 0.3;
      day *= 0.75;
    } else {
      density *= 0.85 + cell.dayPct * 0.34;
    }
  }

  if (filters.weather === 'lluvia') {
    density *= 1 + 0.52 * cell.rainPct;
    rain *= 1.42;
  } else if (filters.weather === 'no_lluvia') {
    density *= 1 - 0.26 * cell.rainPct;
    rain *= 0.76;
  }

  const effectivePeriod = resolvePeriod(filters.period, filters.hour);
  if (effectivePeriod === 'dia') {
    density *= 0.88 + 0.45 * cell.dayPct;
    day *= 1.25;
  } else if (effectivePeriod === 'noche') {
    density *= 0.84 + 0.45 * (1 - cell.dayPct);
    day *= 0.78;
  }

  return {
    density,
    am,
    pm,
    weekend,
    rain,
    day
  };
};

const getAdjustedFeatureVector = (cell, filters) => {
  const factors = buildFilterFactors(cell, filters);
  return [
    cell.densityKd * factors.density,
    cell.distHotspotKm,
    cell.hourPeakAmPct * factors.am,
    cell.hourPeakPmPct * factors.pm,
    cell.weekendPct * factors.weekend,
    cell.rainPct * factors.rain,
    cell.dayPct * factors.day,
    cell.centroid.latitude,
    cell.centroid.longitude
  ];
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

const buildCityModel = async (cityKey) => {
  const profile = CITY_PROFILES[cityKey] || CITY_PROFILES[DEFAULT_CITY_KEY];

  const geojsonPredictions = await parseGeoJsonPredictions(profile);
  if (geojsonPredictions) {
    return {
      profile,
      source: 'geojson',
      predictions: geojsonPredictions,
      metrics: {
        leve: { accuracy: 1, precision: 1, recall: 1, f1: 1 },
        medio: { accuracy: 1, precision: 1, recall: 1, f1: 1 },
        grave: { accuracy: 1, precision: 1, recall: 1, f1: 1 }
      }
    };
  }

  const cells = buildSyntheticCells(profile);
  const trained = buildModel(cells, cityKey);

  return {
    profile,
    source: 'synthetic_model',
    cells,
    models: trained.models,
    metrics: trained.metrics,
    thresholds: trained.thresholds
  };
};

const getOrCreateCityModel = async (cityKey) => {
  if (cityModelCache.has(cityKey)) {
    return cityModelCache.get(cityKey);
  }

  const built = await buildCityModel(cityKey);
  cityModelCache.set(cityKey, built);
  return built;
};

const buildCacheKey = (filters) =>
  JSON.stringify({
    city: filters.city,
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
  const features = getAdjustedFeatureVector(cell, filters);
  const pLeveModel = predictLogisticProbability(cityModel.models.leve, features);
  const pMedioModel = predictLogisticProbability(cityModel.models.medio, features);
  const pGraveModel = predictLogisticProbability(cityModel.models.grave, features);

  const baseLeve = cell.accidentesTotal > 0 ? cell.accidentesLeve / cell.accidentesTotal : 0.04;
  const baseMedio = cell.accidentesTotal > 0 ? cell.accidentesMedio / cell.accidentesTotal : 0.025;
  const baseGrave = cell.accidentesTotal > 0 ? cell.accidentesGrave / cell.accidentesTotal : 0.012;

  const predLeveProb = clamp(pLeveModel * 0.72 + baseLeve * 0.28, 0, 1);
  const predMedioProb = clamp(pMedioModel * 0.75 + baseMedio * 0.25, 0, 1);
  const predGraveProb = clamp(pGraveModel * 0.8 + baseGrave * 0.2, 0, 1);

  const weightedRisk = (predLeveProb + predMedioProb * 2 + predGraveProb * 3) / 6;
  const exposureFactor = clamp(cell.accidentesTotal / 28, 0, 1);
  const riskScore = clamp(weightedRisk * 0.84 + exposureFactor * 0.16, 0, 1);

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
    priority: riskScore >= 0.78 ? 4 : riskScore >= 0.62 ? 3 : riskScore >= 0.45 ? 2 : 1,
    date: filters.date || new Date().toISOString().slice(0, 10),
    hour: formatHour(filters.hour),
    weather: filters.weather,
    period: resolvePeriod(filters.period, filters.hour),
    geometry: cell.geometry
  };
};

const applyFiltersToGeoJsonPrediction = (prediction, filters) => {
  let riskScore = prediction.riskScore;

  if (filters.weather === 'lluvia') {
    riskScore = clamp(riskScore * 1.12, 0, 1);
  }
  if (filters.weather === 'no_lluvia') {
    riskScore = clamp(riskScore * 0.92, 0, 1);
  }

  if (filters.hour !== null) {
    if (filters.hour >= 6 && filters.hour <= 9) riskScore = clamp(riskScore * 1.08, 0, 1);
    if (filters.hour >= 17 && filters.hour <= 20) riskScore = clamp(riskScore * 1.12, 0, 1);
    if (filters.hour >= 0 && filters.hour <= 4) riskScore = clamp(riskScore * 0.84, 0, 1);
  }

  const period = resolvePeriod(filters.period, filters.hour);
  if (period === 'noche') {
    riskScore = clamp(riskScore * 1.07, 0, 1);
  }

  return {
    ...prediction,
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    priority: riskScore >= 0.78 ? 4 : riskScore >= 0.62 ? 3 : riskScore >= 0.45 ? 2 : 1,
    date: filters.date || prediction.date,
    hour: filters.hour === null ? prediction.hour : formatHour(filters.hour),
    weather: filters.weather,
    period
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
  responseCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
};

const fetchLocalPredictions = async (inputFilters = {}) => {
  const filters = normalizeFilters(inputFilters);
  const cityProfile = getCityProfile(filters.city);
  const rangeActive = isRangeActive(filters);

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

  const cityModel = await getOrCreateCityModel(filters.city);
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
    const queryPoint = resolveAddressPoint(filters, cityModel.profile);
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

export { LocalPredictionEngineError, fetchLocalPredictions, getAvailableCities };
