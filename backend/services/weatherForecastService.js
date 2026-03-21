const WEATHER_API_BASE_URL = process.env.WEATHER_API_BASE_URL || 'https://api.weatherapi.com/v1';
const WEATHER_API_KEY = String(process.env.WEATHERAPI_KEY || process.env.WEATHER_API_KEY || '').trim();
const WEATHER_API_DAYS = Math.max(
  1,
  Math.min(10, Number.parseInt(process.env.WEATHER_API_DAYS || '3', 10) || 3)
);
const FORECAST_CACHE_TTL_MS = 15 * 60 * 1000;

const CITY_COORDINATES = {
  villavicencio: { latitude: 4.142, longitude: -73.6266, label: 'Villavicencio' },
  bogota: { latitude: 4.711, longitude: -74.0721, label: 'Bogota' },
  medellin: { latitude: 6.2442, longitude: -75.5812, label: 'Medellin' },
  cali: { latitude: 3.4516, longitude: -76.532, label: 'Cali' },
  barranquilla: { latitude: 10.9685, longitude: -74.7813, label: 'Barranquilla' }
};

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

const buildCacheKey = (cityKey) => `forecast:${cityKey}:days:${WEATHER_API_DAYS}`;

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
    const hour = extractHourLabel(row?.time);
    const existing = byDate.get(isoDate);
    if (!existing) {
      byDate.set(isoDate, {
        date: isoDate,
        maxPrecipitationProbability: probability,
        avgAccumulator: probability,
        samples: 1,
        hours: hour ? [{ time: hour, precipitationProbability: probability, precipMm }] : []
      });
      return;
    }
    existing.maxPrecipitationProbability = Math.max(existing.maxPrecipitationProbability, probability);
    existing.avgAccumulator += probability;
    existing.samples += 1;
    if (hour) {
      existing.hours.push({ time: hour, precipitationProbability: probability, precipMm });
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
        precipMm: Number(hourEntry.precipMm.toFixed(2))
      }));

    return {
      date: entry.date,
      maxPrecipitationProbability: Math.round(entry.maxPrecipitationProbability),
      avgPrecipitationProbability: Math.round(entry.avgAccumulator / entry.samples),
      peakHour: topHours[0]?.time || '',
      topHours
    };
  });
};

const assertConfigured = () => {
  if (!WEATHER_API_KEY) {
    throw new WeatherForecastError(
      'Falta configurar WEATHERAPI_KEY en backend/.env para consultar WeatherAPI.',
      500
    );
  }
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

const fetchWeatherForecast = async ({ city }) => {
  assertConfigured();

  const cityProfile = resolveCityProfile(city);
  const cityKey = cityProfile.key;
  const cacheKey = buildCacheKey(cityKey);
  const cached = getCached(cacheKey);
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    key: WEATHER_API_KEY,
    q: `${cityProfile.latitude},${cityProfile.longitude}`,
    days: String(WEATHER_API_DAYS),
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
    throw new WeatherForecastError(message, response.status >= 400 && response.status < 600 ? response.status : 502);
  }

  const payload = await response.json();
  const forecastDays = Array.isArray(payload?.forecast?.forecastday) ? payload.forecast.forecastday : [];

  const hourly = forecastDays
    .flatMap((day) => (Array.isArray(day?.hour) ? day.hour : []))
    .map((hourEntry) => ({
      time: toIsoDateTime(hourEntry?.time),
      precipitationProbability: clamp(Number(hourEntry?.chance_of_rain) || 0, 0, 100),
      precipMm: Math.max(0, Number(hourEntry?.precip_mm) || 0)
    }))
    .filter((entry) => entry.time);

  const daily = buildDailySummary(hourly);

  const normalizedPayload = {
    city: {
      key: cityKey,
      label: cityProfile.label,
      latitude: cityProfile.latitude,
      longitude: cityProfile.longitude
    },
    generatedAt: new Date().toISOString(),
    timezone: String(payload?.location?.tz_id || 'America/Bogota'),
    hourly,
    daily,
    range: {
      startDate: daily[0]?.date || '',
      endDate: daily[daily.length - 1]?.date || '',
      totalDays: daily.length
    },
    topHourly: (() => {
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
        precipMm: Number(entry.precipMm.toFixed(2))
      }));
    })()
  };

  setCached(cacheKey, normalizedPayload);
  return normalizedPayload;
};

export { WeatherForecastError, fetchWeatherForecast };
