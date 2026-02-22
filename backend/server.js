import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import {
  fetchLocalPredictions,
  getAvailableCities,
  LocalPredictionEngineError
} from './services/localPredictionEngine.js';
import {
  GeocodingClientError,
  reverseGeocode,
  searchAddressSuggestions
} from './services/geocodingClient.js';

const PORT = process.env.PORT || 4000;
const DEFAULT_CITY = process.env.DEFAULT_CITY || 'villavicencio';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let reports = [];

app.get('/api/cities', (req, res) => {
  res.json({ data: getAvailableCities() });
});

app.get('/api/predictions', async (req, res) => {
  const {
    city,
    date,
    hour,
    weather,
    period,
    address,
    latitude,
    longitude,
    rangeMode,
    rangeStart,
    rangeEnd
  } = req.query;

  try {
    const payload = await fetchLocalPredictions({
      city,
      date,
      hour,
      weather,
      period,
      address,
      latitude,
      longitude,
      rangeMode,
      rangeStart,
      rangeEnd
    });
    return res.json(payload);
  } catch (error) {
    const status = error instanceof LocalPredictionEngineError ? error.status : 500;
    const message =
      error instanceof LocalPredictionEngineError
        ? error.message
        : 'Ocurrio un error inesperado al obtener las predicciones locales.';
    return res.status(status).json({ message });
  }
});

app.get('/api/geocode/suggest', async (req, res) => {
  const { query, city } = req.query;

  try {
    const suggestions = await searchAddressSuggestions({ query, city });
    return res.json({ data: suggestions });
  } catch (error) {
    const status = error instanceof GeocodingClientError ? error.status : 500;
    const message =
      error instanceof GeocodingClientError
        ? error.message
        : 'Ocurrio un error inesperado al buscar sugerencias de direccion.';
    return res.status(status).json({ message });
  }
});

app.get('/api/geocode/reverse', async (req, res) => {
  const { latitude, longitude, city } = req.query;

  try {
    const match = await reverseGeocode({ latitude, longitude, city });
    return res.json({ data: match });
  } catch (error) {
    const status = error instanceof GeocodingClientError ? error.status : 500;
    const message =
      error instanceof GeocodingClientError
        ? error.message
        : 'Ocurrio un error inesperado al buscar direccion por coordenadas.';
    return res.status(status).json({ message });
  }
});

app.get('/api/reports', (req, res) => {
  res.json({ data: reports });
});

app.post('/api/reports', (req, res) => {
  const { description, latitude, longitude, severity } = req.body;

  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !description ||
    !description.trim()
  ) {
    return res.status(400).json({ message: 'Datos del reporte incompletos.' });
  }

  const newReport = {
    id: uuidv4(),
    description: description.trim(),
    latitude,
    longitude,
    severity: severity || 'media',
    createdAt: new Date().toISOString()
  };

  reports = [newReport, ...reports].slice(0, 50);
  io.emit('report:new', newReport);

  return res.status(201).json(newReport);
});

io.on('connection', async (socket) => {
  try {
    const { data: predictions } = await fetchLocalPredictions({ city: DEFAULT_CITY });
    socket.emit('init', {
      reports,
      predictions: predictions.slice(0, 80)
    });
  } catch (error) {
    socket.emit('init', {
      reports,
      predictions: []
    });

    if (!(error instanceof LocalPredictionEngineError)) {
      // eslint-disable-next-line no-console
      console.error('Error inesperado al obtener predicciones iniciales para socket:', error);
    }
  }
});

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Servidor de prediccion de trafico escuchando en el puerto ${PORT}`);
});
