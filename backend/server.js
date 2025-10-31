import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { fetchArcgisPredictions, ArcgisClientError } from './services/arcgisClient.js';

const PORT = process.env.PORT || 4000;

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

app.get('/api/predictions', async (req, res) => {
  const { date, hour, weather, period } = req.query;

  try {
    const predictions = await fetchArcgisPredictions({ date, hour, weather, period });

    predictions.forEach((prediction) => {
      io.emit('prediction:new', prediction);
    });

    return res.json({ data: predictions });
  } catch (error) {
    const status = error instanceof ArcgisClientError ? error.status : 500;
    const message =
      error instanceof ArcgisClientError
        ? error.message
        : 'Ocurrió un error inesperado al obtener las predicciones.';
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
    const predictions = await fetchArcgisPredictions();
    socket.emit('init', {
      reports,
      predictions
    });
  } catch (error) {
    socket.emit('init', {
      reports,
      predictions: []
    });
    if (!(error instanceof ArcgisClientError)) {
      // eslint-disable-next-line no-console
      console.error('Error inesperado al obtener predicciones para el socket:', error);
    }
  }
});

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Servidor de predicción de tráfico escuchando en el puerto ${PORT}`);
});
