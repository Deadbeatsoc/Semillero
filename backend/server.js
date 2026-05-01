import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { pool } from './db/mysqlPool.js';
import { createActivityLog } from './models/activityModel.js';
import { listApprovedTodayReports } from './models/reportModel.js';
import { requireAuth } from './middleware/authMiddleware.js';
import adminRouter from './routes/adminRoutes.js';
import activityRouter from './routes/activityRoutes.js';
import authRouter from './routes/authRoutes.js';
import reportRouter from './routes/reportRoutes.js';
import { bootstrapAuthData } from './services/bootstrapAuthData.js';
import {
  fetchLocalPredictions,
  getAvailableCities,
  LocalPredictionEngineError
} from './services/localPredictionEngine.js';
import { ensureEvidenceDirectory } from './services/reportEvidenceService.js';
import { resolveAuthenticatedUser } from './services/sessionAuthService.js';
import {
  GeocodingClientError,
  reverseGeocode,
  searchAddressSuggestions
} from './services/geocodingClient.js';
import {
  WeatherForecastError,
  fetchWeatherForecast
} from './services/weatherForecastService.js';

const PORT = process.env.PORT || 4000;
const DEFAULT_CITY = process.env.DEFAULT_CITY || 'villavicencio';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/activity', activityRouter);
app.use('/api/reports', reportRouter);
app.use('/api', requireAuth);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const logUserActivity = async ({ userId, eventType, eventData = null }) => {
  try {
    const connection = await pool.getConnection();
    try {
      await createActivityLog(connection, {
        userId,
        eventType,
        eventData
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`No se pudo registrar actividad (${eventType}):`, error.message);
  }
};

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
    await logUserActivity({
      userId: req.authUser.id,
      eventType: 'prediction_query',
      eventData: {
        city: payload?.meta?.city?.key || city || DEFAULT_CITY,
        rangeMode: rangeMode || 'none',
        hasAddressFilter: Boolean((address || '').trim())
      }
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

app.get('/api/weather/forecast', async (req, res) => {
  const { city, latitude, longitude } = req.query;
  try {
    const forecast = await fetchWeatherForecast({ city, latitude, longitude });
    return res.json({ data: forecast });
  } catch (error) {
    const status = error instanceof WeatherForecastError ? error.status : 500;
    const message =
      error instanceof WeatherForecastError
        ? error.message
        : 'Ocurrio un error inesperado al consultar el clima.';
    return res.status(status).json({ message });
  }
});

io.use(async (socket, next) => {
  try {
    const rawToken = String(
      socket.handshake?.auth?.token || socket.handshake?.query?.token || ''
    ).trim();
    const resolved = await resolveAuthenticatedUser(rawToken, { touch: true });
    socket.data.authUser = resolved.user;
    return next();
  } catch {
    return next(new Error('No autorizado'));
  }
});

io.on('connection', async (socket) => {
  try {
    const connection = await pool.getConnection();
    let reports = [];
    try {
      reports = await listApprovedTodayReports(connection);
    } finally {
      connection.release();
    }

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

const startServer = async () => {
  try {
    await ensureEvidenceDirectory();
    const bootstrapData = await bootstrapAuthData();

    if (bootstrapData.createdAdmin && !bootstrapData.createdAdmin.reusedExisting) {
      // eslint-disable-next-line no-console
      console.log('Administrador inicial creado.');
      // eslint-disable-next-line no-console
      console.log(`Usuario admin: ${bootstrapData.createdAdmin.username}`);
      // eslint-disable-next-line no-console
      console.log(`Contrasena admin inicial: ${bootstrapData.createdAdmin.generatedPassword}`);
    }

    if (bootstrapData.createdCode) {
      // eslint-disable-next-line no-console
      console.log(`Codigo de verificacion inicial: ${bootstrapData.activeCode}`);
    }

    httpServer.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Servidor de prediccion de trafico escuchando en el puerto ${PORT}`);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      'No se pudo inicializar autenticacion. Ejecuta primero "npm run migrate".',
      error.message
    );
    process.exit(1);
  }
};

startServer();
