// Servicio de pronostico de clima con soporte multi-proveedor.
//
// Proveedor por defecto: Open-Meteo (gratis, SIN API key, alta disponibilidad).
// Proveedor opcional: WeatherAPI.com (requiere WEATHERAPI_KEY).
//
// Estrategia: se intenta el proveedor primario y, si falla, se cae al
// secundario disponible. Asi el pronostico funciona de inmediato sin
// configuracion y se mantiene robusto ante caidas o cuotas agotadas.

const OPEN_METEO_BASE_URL =
  process.env.OPEN_METEO_BASE_URL || 'https://api.open-meteo.com/v1';
const WEATHER_API_BASE_URL = process.env.WEATHER_API_BASE_URL || 'https://api.weatherapi.com/v1';
const WEATHER_API_KEY = String(process.env.WEATHERAPI_KEY || process.env.WEATHER_API_KEY || '').trim();
const FORECAST_DAYS = Math.max(
  1,
  Math.min(
    10,
    Number.parseInt(process.env.WEATHER_FORECAST_DAYS || process.env.WEATHER_API_DAYS || '3', 10) || 3
  )
);
// 'open-meteo' (default) | 'weatherapi'
const PREFERRED_PROVIDER = String(process.env.WEATHER_PROVIDER || 'open-meteo')
  .trim()
  .toLowerCase();
const DEFAULT_TIMEZONE = process.env.WEATHER_TIMEZONE || 'America/Bogota';
const FORECAST_CACHE_TTL_MS = 15 * 60 * 1000;

const CITY_COORDINATES = {
  villavicencio: { latitude: 4.142, longitude: -73.6266, label: 'Villavicencio' },
  bogota: { latitude: 4.711, longitude: -74.0721, label: 'Bogota' },
  medellin: { latitude: 6.2442, longitude: -75.5812, label: 'Medellin' },
  cali: { latitude: 3.4516, longitude: -76.532, label: 'Cali' },
  barranquilla: { latitude: 10.9685, longitude: -74.7813, label: 'Barranquilla' }
};

// Codigos WMO (Open-Meteo) que representan precipitacion de lluvia.
const RAIN_WEATHER_CODES = new Set([
  51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99
]);

const forecastCache = new Map();

class WeatherForecastError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'WeatherForecastError';
    this.status = status;
  }
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeCityKey = (value) => String(value || '').trim().toLowerCase();

const parseCoordinate = (value, min, max) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number.parseFloat(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
};

const resolveCityProfile = (city) => {
  const cityKey = normalizeCityKey(city);
  if (CITY_COORDINATES[cityKey]) {
    return {
      key: cityKey,
      ...CITY_COORDINATES[cityKey]
    };
  }
  return {
    key: 'villavicencio',
    ...CITY_COORDINATES.villavicencio
  };
};

const resolveWeatherLocation = ({ city, latitude, longitude }) => {
  const cityProfile = resolveCityProfile(city);
  const lat = parseCoordinate(latitude, -90, 90);
  const lon = parseCoordinate(longitude, -180, 180);
  if (lat === null || lon === null) {
    return {
      cityKey: cityProfile.key,
      label: cityProfile.label,
      latitude: cityProfile.latitude,
      longitude: cityProfile.longitude,
      source: 'city_center',
      cacheToken: cityProfile.key
    };
  }

  return {
    cityKey: cityProfile.key,
    label: cityProfile.label,
    latitude: lat,
    longitude: lon,
    source: 'query_coordinates',
    cacheToken: `${cityProfile.key}:${lat.toFixed(3)},${lon.toFixed(3)}`
  };
};

const buildCacheKey = (locationToken, provider) =>
  `forecast:${provider}:${locationToken}:days:${FORECAST_DAYS}`;

const getCached = (cacheKey) => {
  const cached = forecastCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt < Date.now()) {
    forecastCache.delete(cacheKey);
    return null;
  }
  return cached.payload;
};

const setCached = (cacheKey, payload) => {
  forecastCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + FORECAST_CACHE_TTL_MS
  });
};

const toIsoDateTime = (value) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (raw.includes('T')) {
    return raw;
  }
  return raw.replace(' ', 'T');
};

const extractHourLabel = (isoDateTime) => {
  const safe = String(isoDateTime || '');
  const hour = safe.slice(11, 16);
  return /^\d{2}:\d{2}$/.test(hour) ? hour : '';
};

const buildDailySummary = (hourlyRows = []) => {
  const byDate = new Map();

  hourlyRows.forEach((row) => {
    const isoDate = String(row?.time || '').slice(0, 10);
    if (!isoDate) {
      return;
    }
    const probability = clamp(Number(row?.precipitationProbability) || 0, 0, 100);
    const precipMm = Math.max(0, Number(row?.precipMm) || 0);
    const willItRain = Boolean(row?.willItRain);
    const hour = extractHourLabel(row?.time);
    const existing = byDate.get(isoDate);
    if (!existing) {
      byDate.set(isoDate, {
        date: isoDate,
        maxPrecipitationProbability: probability,
        avgAccumulator: probability,
        maxPrecipMm: precipMm,
        totalPrecipMm: precipMm,
        rainyHours: willItRain ? 1 : 0,
        samples: 1,
        hours: hour ? [{ time: hour, precipitationProbability: probability, precipMm, willItRain }] : []
      });
      return;
    }
    existing.maxPrecipitationProbability = Math.max(existing.maxPrecipitationProbability, probability);
    existing.avgAccumulator += probability;
    existing.maxPrecipMm = Math.max(existing.maxPrecipMm, precipMm);
    existing.totalPrecipMm += precipMm;
    existing.rainyHours += willItRain ? 1 : 0;
    existing.samples += 1;
    if (hour) {
      existing.hours.push({ time: hour, precipitationProbability: probability, precipMm, willItRain });
    }
  });

  return Array.from(byDate.values()).map((entry) => {
    const topHours = [...entry.hours]
      .sort((left, right) => {
        if (right.precipitationProbability !== left.precipitationProbability) {
          return right.precipitationProbability - left.precipitationProbability;
        }
        if (right.precipMm !== left.precipMm) {
          return right.precipMm - left.precipMm;
        }
        return left.time.localeCompare(right.time);
      })
      .slice(0, 3)
      .map((hourEntry) => ({
        time: hourEntry.time,
        precipitationProbability: Math.round(hourEntry.precipitationProbability),
        precipMm: Number(hourEntry.precipMm.toFixed(2)),
        willItRain: Boolean(hourEntry.willItRain)
      }));

    return {
      date: entry.date,
      maxPrecipitationProbability: Math.round(entry.maxPrecipitationProbability),
      avgPrecipitationProbability: Math.round(entry.avgAccumulator / entry.samples),
      maxPrecipMm: Number(entry.maxPrecipMm.toFixed(2)),
      totalPrecipMm: Number(entry.totalPrecipMm.toFixed(2)),
      rainyHours: entry.rainyHours,
      peakHour: topHours[0]?.time || '',
      topHours
    };
  });
};

const buildTopHourly = (hourly) => {
  const sorted = [...hourly].sort((left, right) => {
    if (right.precipitationProbability !== left.precipitationProbability) {
      return right.precipitationProbability - left.precipitationProbability;
    }
    if (right.precipMm !== left.precipMm) {
      return right.precipMm - left.precipMm;
    }
    return String(left.time).localeCompare(String(right.time));
  });

  const selected = [];
  const perDate = new Map();
  for (const entry of sorted) {
    const dateKey = String(entry.time).slice(0, 10);
    const currentCount = perDate.get(dateKey) || 0;
    if (currentCount >= 3) {
      continue;
    }
    selected.push(entry);
    perDate.set(dateKey, currentCount + 1);
    if (selected.length >= 8) {
      break;
    }
  }

  if (selected.length < 8) {
    for (const entry of sorted) {
      if (selected.some((selectedEntry) => selectedEntry.time === entry.time)) {
        continue;
      }
      selected.push(entry);
      if (selected.length >= 8) {
        break;
      }
    }
  }

  return selected.map((entry) => ({
    time: String(entry.time),
    precipitationProbability: Math.round(entry.precipitationProbability),
    precipMm: Number(entry.precipMm.toFixed(2)),
    willItRain: Boolean(entry.willItRain)
  }));
};

const buildForecastPayload = (location, hourly, { timezone, provider }) => {
  const daily = buildDailySummary(hourly);
  return {
    city: {
      key: location.cityKey,
      label: location.label,
      latitude: location.latitude,
      longitude: location.longitude,
      source: location.source
    },
    provider,
    generatedAt: new Date().toISOString(),
    timezone: timezone || DEFAULT_TIMEZONE,
    hourly,
    daily,
    range: {
      startDate: daily[0]?.date || '',
      endDate: daily[daily.length - 1]?.date || '',
      totalDays: daily.length
    },
    topHourly: buildTopHourly(hourly)
  };
};

const parseWeatherApiErrorMessage = async (response) => {
  try {
    const payload = await response.json();
    const apiMessage = payload?.error?.message;
    if (apiMessage) {
      return String(apiMessage);
    }
  } catch {
    // Ignoramos parse errors del body.
  }
  return '';
};

// ---------------------------------------------------------------------------
// Proveedor: Open-Meteo (sin API key)
// ---------------------------------------------------------------------------
const fetchFromOpenMeteo = async (location) => {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    hourly: 'precipitation_probability,precipitation,weather_code',
    forecast_days: String(FORECAST_DAYS),
    timezone: DEFAULT_TIMEZONE
  });

  let response;
  try {
    response = await fetch(`${OPEN_METEO_BASE_URL}/forecast?${params.toString()}`);
  } catch {
    throw new WeatherForecastError('No se pudo conectar con el servicio de clima (Open-Meteo).', 502);
  }

  if (!response.ok) {
    throw new WeatherForecastError(
      `Open-Meteo no esta disponible en este momento (HTTP ${response.status}).`,
      response.status >= 400 && response.status < 600 ? response.status : 502
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new WeatherForecastError('Respuesta invalida de Open-Meteo.', 502);
  }

  const block = payload?.hourly || {};
  const times = Array.isArray(block.time) ? block.time : [];
  const probabilities = Array.isArray(block.precipitation_probability)
    ? block.precipitation_probability
    : [];
  const precipitations = Array.isArray(block.precipitation) ? block.precipitation : [];
  const weatherCodes = Array.isArray(block.weather_code) ? block.weather_code : [];

  const hourly = times
    .map((time, index) => {
      const precipitationProbability = clamp(Number(probabilities[index]) || 0, 0, 100);
      const precipMm = Math.max(0, Number(precipitations[index]) || 0);
      const weatherCode = Number(weatherCodes[index]);
      // "Va a llover" si el codigo WMO es de lluvia o si hay precipitacion real.
      const willItRain = RAIN_WEATHER_CODES.has(weatherCode) || precipMm >= 0.1;
      return {
        time: toIsoDateTime(time),
        precipitationProbability,
        precipMm,
        willItRain
      };
    })
    .filter((entry) => entry.time);

  if (!hourly.length) {
    throw new WeatherForecastError('Open-Meteo no devolvio datos horarios de precipitacion.', 502);
  }

  return {
    hourly,
    timezone: String(payload?.timezone || DEFAULT_TIMEZONE)
  };
};

// ---------------------------------------------------------------------------
// Proveedor: WeatherAPI.com (requiere WEATHERAPI_KEY)
// ---------------------------------------------------------------------------
const fetchFromWeatherApi = async (location) => {
  if (!WEATHER_API_KEY) {
    throw new WeatherForecastError('WeatherAPI no esta configurado (falta WEATHERAPI_KEY).', 500);
  }

  const params = new URLSearchParams({
    key: WEATHER_API_KEY,
    q: `${location.latitude},${location.longitude}`,
    days: String(FORECAST_DAYS),
    aqi: 'no',
    alerts: 'no',
    lang: 'es'
  });

  let response;
  try {
    response = await fetch(`${WEATHER_API_BASE_URL}/forecast.json?${params.toString()}`);
  } catch {
    throw new WeatherForecastError('No se pudo conectar con el servicio de clima (WeatherAPI).', 502);
  }

  if (!response.ok) {
    const providerMessage = await parseWeatherApiErrorMessage(response);
    const message = providerMessage
      ? `WeatherAPI respondio: ${providerMessage}`
      : 'WeatherAPI no esta disponible en este momento.';
    throw new WeatherForecastError(
      message,
      response.status >= 400 && response.status < 600 ? response.status : 502
    );
  }

  const payload = await response.json();
  const forecastDays = Array.isArray(payload?.forecast?.forecastday) ? payload.forecast.forecastday : [];

  const hourly = forecastDays
    .flatMap((day) => (Array.isArray(day?.hour) ? day.hour : []))
    .map((hourEntry) => ({
      time: toIsoDateTime(hourEntry?.time),
      precipitationProbability: clamp(Number(hourEntry?.chance_of_rain) || 0, 0, 100),
      precipMm: Math.max(0, Number(hourEntry?.precip_mm) || 0),
      willItRain: Number(hourEntry?.will_it_rain) === 1
    }))
    .filter((entry) => entry.time);

  if (!hourly.length) {
    throw new WeatherForecastError('WeatherAPI no devolvio datos horarios de precipitacion.', 502);
  }

  return {
    hourly,
    timezone: String(payload?.location?.tz_id || DEFAULT_TIMEZONE)
  };
};

const PROVIDERS = {
  'open-meteo': { name: 'open-meteo', fetcher: fetchFromOpenMeteo, available: () => true },
  weatherapi: { name: 'weatherapi', fetcher: fetchFromWeatherApi, available: () => Boolean(WEATHER_API_KEY) }
};

// Orden de proveedores: el preferido primero, luego el resto disponible como
// respaldo automatico.
const resolveProviderOrder = () => {
  const order = [];
  if (PROVIDERS[PREFERRED_PROVIDER] && PROVIDERS[PREFERRED_PROVIDER].available()) {
    order.push(PROVIDERS[PREFERRED_PROVIDER]);
  }
  for (const provider of Object.values(PROVIDERS)) {
    if (provider.available() && !order.includes(provider)) {
      order.push(provider);
    }
  }
  return order;
};

const fetchWeatherForecast = async ({ city, latitude, longitude }) => {
  const weatherLocation = resolveWeatherLocation({ city, latitude, longitude });
  const providers = resolveProviderOrder();

  if (!providers.length) {
    throw new WeatherForecastError('No hay proveedores de clima disponibles.', 500);
  }

  let lastError = null;
  for (const provider of providers) {
    const cacheKey = buildCacheKey(weatherLocation.cacheToken, provider.name);
    const cached = getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const { hourly, timezone } = await provider.fetcher(weatherLocation);
      const normalizedPayload = buildForecastPayload(weatherLocation, hourly, {
        timezone,
        provider: provider.name
      });
      setCached(cacheKey, normalizedPayload);
      return normalizedPayload;
    } catch (error) {
      lastError = error;
      // eslint-disable-next-line no-console
      console.warn(`Proveedor de clima "${provider.name}" fallo: ${error.message}. Probando respaldo...`);
    }
  }

  throw lastError instanceof WeatherForecastError
    ? lastError
    : new WeatherForecastError('No se pudo obtener el pronostico del clima.', 502);
};

export { WeatherForecastError, fetchWeatherForecast };
