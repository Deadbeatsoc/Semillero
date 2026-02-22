import { getAvailableCities } from './localPredictionEngine.js';

const DEFAULT_USER_AGENT = process.env.GEOCODER_USER_AGENT || 'websemillero-local/1.0';
const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org';
const CITY_DEPARTMENTS = {
  villavicencio: 'Meta',
  bogota: 'Bogota',
  medellin: 'Antioquia',
  cali: 'Valle del Cauca',
  barranquilla: 'Atlantico'
};

class GeocodingClientError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'GeocodingClientError';
    this.status = status;
  }
}

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

const cityByKey = new Map(getAvailableCities().map((city) => [city.key, city]));

const getCityContext = (cityKeyInput) => {
  const key = normalizeKey(cityKeyInput);
  return cityByKey.get(key) || cityByKey.get('villavicencio');
};

const formatAddressLabel = (feature) => {
  if (!feature) {
    return 'Direccion sin nombre';
  }

  const address = feature.address || {};
  const road = address.road || address.pedestrian || address.footway || '';
  const houseNumber = address.house_number ? ` ${address.house_number}` : '';
  const suburb = address.suburb || address.neighbourhood || address.city_district || '';
  const city = address.city || address.town || address.village || '';

  const pieces = [`${road}${houseNumber}`.trim(), suburb, city].filter(Boolean);
  if (pieces.length) {
    return pieces.join(', ');
  }

  return feature.display_name || 'Direccion sin nombre';
};

const buildHeaders = () => ({
  Accept: 'application/json',
  'Accept-Language': 'es',
  'User-Agent': DEFAULT_USER_AGENT
});

const searchAddressSuggestions = async ({ query, city }) => {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  if (!normalizedQuery || normalizedQuery.length < 3) {
    return [];
  }

  const cityContext = getCityContext(city);
  const department = CITY_DEPARTMENTS[cityContext.key] || '';
  const [west, south, east, north] = cityContext.bbox;

  const url = new URL('/search', NOMINATIM_BASE_URL);
  const queryParts = [normalizedQuery, cityContext.label, department, 'Colombia'].filter(Boolean);
  url.searchParams.set('q', queryParts.join(', '));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '7');
  url.searchParams.set('countrycodes', 'co');
  url.searchParams.set('bounded', '1');
  url.searchParams.set('viewbox', `${west},${north},${east},${south}`);

  let response;
  try {
    response = await fetch(url, { headers: buildHeaders() });
  } catch (error) {
    throw new GeocodingClientError('No fue posible consultar sugerencias de direcciones.', 503);
  }

  if (!response.ok) {
    throw new GeocodingClientError(
      'El proveedor de geocodificacion no respondio correctamente.',
      response.status
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new GeocodingClientError('La respuesta de geocodificacion no es valida.', 502);
  }

  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((feature, index) => {
      const latitude = parseCoordinate(feature.lat, -90, 90);
      const longitude = parseCoordinate(feature.lon, -180, 180);
      if (latitude === null || longitude === null) {
        return null;
      }

      return {
        id: String(feature.place_id || `${cityContext.key}-${index}`),
        label: formatAddressLabel(feature),
        displayName: feature.display_name || formatAddressLabel(feature),
        latitude,
        longitude,
        source: 'nominatim'
      };
    })
    .filter(Boolean);
};

const reverseGeocode = async ({ latitude, longitude, city }) => {
  const lat = parseCoordinate(latitude, -90, 90);
  const lon = parseCoordinate(longitude, -180, 180);

  if (lat === null || lon === null) {
    throw new GeocodingClientError('Coordenadas invalidas para geocodificacion inversa.', 400);
  }

  const cityContext = getCityContext(city);
  const url = new URL('/reverse', NOMINATIM_BASE_URL);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', '18');

  let response;
  try {
    response = await fetch(url, { headers: buildHeaders() });
  } catch (error) {
    throw new GeocodingClientError('No fue posible consultar la direccion para ese punto.', 503);
  }

  if (!response.ok) {
    throw new GeocodingClientError(
      'El proveedor de geocodificacion no respondio correctamente.',
      response.status
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new GeocodingClientError('La respuesta de geocodificacion inversa no es valida.', 502);
  }

  const label = formatAddressLabel(payload);
  return {
    id: String(payload.place_id || `${cityContext.key}-reverse`),
    label,
    displayName: payload.display_name || label,
    latitude: lat,
    longitude: lon,
    source: 'nominatim'
  };
};

export { GeocodingClientError, reverseGeocode, searchAddressSuggestions };
