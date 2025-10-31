import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

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

const WEATHER_OPTIONS = ['lluvia', 'no_lluvia'];

const basePredictions = generateInitialPredictions();
let reports = [];

function generateInitialPredictions() {
  const now = new Date();
  const base = [];
  for (let i = 0; i < 15; i += 1) {
    base.push(createPrediction(now, i));
  }
  return base;
}

function createPrediction(referenceDate, offsetHours = 0) {
  const date = new Date(referenceDate.getTime() + offsetHours * 3600 * 1000);
  const formattedDate = date.toISOString().split('T')[0];
  const hour = date.toISOString().split('T')[1].slice(0, 5);
  const weather = WEATHER_OPTIONS[Math.floor(Math.random() * WEATHER_OPTIONS.length)];
  const period = date.getHours() >= 6 && date.getHours() < 18 ? 'dia' : 'noche';

  const latitude = 14.6349 + (Math.random() - 0.5) * 0.2;
  const longitude = -90.5069 + (Math.random() - 0.5) * 0.2;
  const riskScore = Math.round(Math.random() * 50 + 50) / 100;

  return {
    id: uuidv4(),
    latitude,
    longitude,
    riskScore,
    date: formattedDate,
    hour,
    weather,
    period,
    roadSegment: `Segmento ${Math.ceil(Math.random() * 20)}`
  };
}

function filterPredictions({ date, hour, weather, period }) {
  return basePredictions.filter((prediction) => {
    if (date && prediction.date !== date) {
      return false;
    }
    if (hour) {
      const hourNum = parseInt(hour.split(':')[0], 10);
      const predictionHour = parseInt(prediction.hour.split(':')[0], 10);
      if (predictionHour !== hourNum) {
        return false;
      }
    }
    if (weather && weather !== 'todos' && prediction.weather !== weather) {
      return false;
    }
    if (period && period !== 'todos' && prediction.period !== period) {
      return false;
    }
    return true;
  });
}

app.get('/api/predictions', (req, res) => {
  const { date, hour, weather, period } = req.query;
  const filtered = filterPredictions({ date, hour, weather, period });
  res.json({ data: filtered });
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

io.on('connection', (socket) => {
  socket.emit('init', {
    reports,
    predictions: basePredictions.slice(-30)
  });
});

setInterval(() => {
  const newPrediction = createPrediction(new Date(), Math.floor(Math.random() * 5));
  basePredictions.push(newPrediction);
  if (basePredictions.length > 200) {
    basePredictions.shift();
  }
  io.emit('prediction:new', newPrediction);
}, 60000);

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Servidor de predicción de tráfico escuchando en el puerto ${PORT}`);
});
