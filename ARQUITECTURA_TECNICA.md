# Arquitectura Técnica del Motor de Predicción

## 1. Arquitectura de Capas

```
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND (React + Vite)                       │
│  PredictionWorkspace.jsx → Leaflet Layers → Socket.io Updates    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                   HTTP + WebSocket
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│           BACKEND (Node.js + Express + Socket.io)                │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │         API Layer (Express Routes)                       │    │
│  │  GET /api/predictions, /api/geocode/*, /api/weather/*  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                          │                                       │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │    Service Layer (localPredictionEngine.js)              │    │
│  │                                                           │    │
│  │  ┌─────────────────────────────────────────────────────┐ │    │
│  │  │ fetchLocalPredictions()                             │ │    │
│  │  │  ├─ normalizeFilters()                              │ │    │
│  │  │  ├─ getOrCreateCityModel()                          │ │    │
│  │  │  │   ├─ parseGeoJsonPredictions() [si existe]       │ │    │
│  │  │  │   └─ buildSyntheticCells() + buildModel()        │ │    │
│  │  │  ├─ buildPredictions() o buildSeverePointsForRange()│ │    │
│  │  │  ├─ buildAddressScopedPredictions()                │ │    │
│  │  │  └─ cache (5 min TTL)                               │ │    │
│  │  └─────────────────────────────────────────────────────┘ │    │
│  │                                                           │    │
│  │  ┌─────────────────────────────────────────────────────┐ │    │
│  │  │  ML Training (Logistic Regression)                  │ │    │
│  │  │  trainLogisticModel(samples, labels)                │ │    │
│  │  │  ├─ standardizeMatrix()                             │ │    │
│  │  │  ├─ Gradient descent (650 iterations)               │ │    │
│  │  │  └─ Metrics: accuracy, precision, recall, f1        │ │    │
│  │  └─────────────────────────────────────────────────────┘ │    │
│  │                                                           │    │
│  │  ┌─────────────────────────────────────────────────────┐ │    │
│  │  │  Feature Engineering & Context                      │ │    │
│  │  │  ├─ buildSyntheticCells() → 14x14 grid             │ │    │
│  │  │  ├─ Hotspot clustering (Gaussian RBF)              │ │    │
│  │  │  ├─ corridorFactor (exp decay por distancia)        │ │    │
│  │  │  ├─ buildFilterFactors() → density adjustment       │ │    │
│  │  │  └─ buildAccidentInsights() → tipo/gravedad         │ │    │
│  │  └─────────────────────────────────────────────────────┘ │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  In-Memory Dual Cache                                    │    │
│  │  ├─ cityModelCache: Map<cityKey, trainedModels>        │    │
│  │  │  Lifetime: session (nunca expira)                    │    │
│  │  │  Tamaño: ~3-5 MB por ciudad                          │    │
│  │  │                                                       │    │
│  │  └─ responseCache: Map<filterHash, response>           │    │
│  │     TTL: 5 minutos                                     │    │
│  │     Límite: sin límite explícito (Map nativo)          │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Data Layer (MySQL + Transacciones)                     │    │
│  │  ├─ cities, road_segments, accident_events             │    │
│  │  ├─ citizen_reports, prediction_runs                    │    │
│  │  └─ Pool: 10 conexiones máximo                          │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Sistema de Caché Dual (Arquitectura Clave)

### 2.1 cityModelCache (Modelos ML)
```javascript
// backend/services/localPredictionEngine.js, línea 77
const cityModelCache = new Map();

// Estructura interna:
{
  'villavicencio': {
    profile: { key, label, center, bbox, zoom, rows, cols },
    source: 'geojson' | 'synthetic_model',
    
    // Si source === 'geojson':
    predictions: [
      { id, cityKey, roadSegment, latitude, longitude,
        predLeveProb, predMedioProb, predGraveProb, riskScore, ... }
    ],
    metrics: { ... },
    
    // Si source === 'synthetic_model':
    cells: [ 
      { id, row, col, roadSegment, centroid, densityKd, ...
        accidentesLeve, accidentesMedio, accidentesGrave, ... }
    ],
    models: {
      leve: { type: 'logistic', weights, bias, means, stds, metrics },
      medio: { type: 'logistic', weights, bias, means, stds, metrics },
      grave: { type: 'logistic', weights, bias, means, stds, metrics }
    },
    thresholds: { leve, medio, grave }
  }
}

// Ciclo de vida:
// 1. Request llega con city='villavicencio'
// 2. getOrCreateCityModel() consulta cityModelCache
// 3. Si no existe:
//    a) Intenta parseGeoJsonPredictions(profile)
//    b) Si falla, buildSyntheticCells() + trainLogisticModel() x3
//    c) Cachea resultado indefinidamente
// 4. Siguiente request: reutiliza sin re-entrenar
```

### 2.2 responseCache (Respuestas API)
```javascript
// Línea 78
const responseCache = new Map();

// Estructura:
{
  'hash_json_de_filtros': {
    payload: { data: [...], meta: {...} },
    expiresAt: Date.now() + 5*60*1000  // 5 minutos
  }
}

// buildCacheKey() (línea 1426):
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

// TTL: CACHE_TTL_MS = 5 * 60 * 1000 (línea 9)
// Estrategia: lazy eviction (se borra al consultarse si expiró)
```

## 3. Generación Procedural de Datos Sintéticos

### 3.1 Seeded Random (Determinístico + Reproducible)

```javascript
// Línea 467-497: Hash criptográfico + LCG
const xmur3 = (value) => {
  // xmur3: FNV-like hash algorithm
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
  // Mulberry32: LCG rápido
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

// Uso:
const random = createSeededRandom('grid-villavicencio');
// random() → siempre produce la misma secuencia para el mismo seed
```

**Ventaja arquitectónica**: Los mismos datos sintéticos se regeneran sin guardar en DB. Seed = `grid-{cityKey}` garantiza idempotencia.

### 3.2 Grid Generation (14x14 para Villavicencio)

```javascript
// Línea 904-1020: buildSyntheticCells()

const CITY_PROFILES = {
  villavicencio: {
    rows: 14,  // 14x14 = 196 celdas
    cols: 14,
    bbox: [-73.78, 4.01, -73.48, 4.27]  // [oeste, sur, este, norte]
  }
  // ... otras ciudades
};

// Cada celda es un Polygon en GeoJSON
// Centroide: (row, col) → (latitude, longitude)
const lngStep = (east - west) / cols;  // 0.0214°
const latStep = (north - south) / rows;  // 0.0186°

for (let row = 0; row < rows; row++) {
  for (let col = 0; col < cols; col++) {
    const centroid = {
      latitude: south + (row + 0.5) * latStep,
      longitude: west + (col + 0.5) * lngStep
    };
    
    // Cada celda tendrá features calculadas con el seeded random
  }
}
```

### 3.3 Hotspot Clustering con RBF

```javascript
// Línea 910-956

// 3 hotspots generados determinísticamente
const hotspots = Array.from({ length: 3 }, (_, index) => ({
  latitude: cityProfile.center.latitude + (random() - 0.5) * latStep * rows * 0.45,
  longitude: cityProfile.center.longitude + (random() - 0.5) * lngStep * cols * 0.45,
  spreadKm: 1.2 + random() * 1.8 + index * 0.15,
  weight: 0.55 + random() * 0.65
}));

// Para cada celda, calcular influencia gaussiana:
let hotspotScore = 0;
for (const hotspot of hotspots) {
  const distance = haversineDistanceKm(
    centroid.latitude, centroid.longitude,
    hotspot.latitude, hotspot.longitude
  );
  // RBF gaussian
  hotspotScore += hotspot.weight * Math.exp(
    -(distance * distance) / (2 * hotspot.spreadKm * hotspot.spreadKm)
  );
}

// Corridor factor: decae exponencialmente hacia los bordes
const corridorFactor = Math.exp(
  -Math.pow(
    (centroid.longitude - cityProfile.center.longitude) / 
    Math.max((east - west) * 0.22, 0.0001),
    2
  )
);

// Densidad final es mezcla ponderada
const densityRaw = hotspotScore * 0.72 + corridorFactor * 0.4 + random() * 0.22;
```

**Insight**: Este enfoque genera una distribución espacial realista sin necesidad de datos históricos reales. Es procedural + determinístico.

## 4. Pipeline ML End-to-End

### 4.1 Entrenamiento de Clasificadores Binarios

```javascript
// Línea 1134-1163: buildModel()

// Paso 1: Extraer características base de cada celda
const features = cells.map((cell) => [
  cell.densityKd,           // 0: densidad normalizada
  cell.distHotspotKm,       // 1: distancia a hotspot
  cell.hourPeakAmPct,       // 2: pico AM
  cell.hourPeakPmPct,       // 3: pico PM
  cell.weekendPct,          // 4: pico fin de semana
  cell.rainPct,             // 5: proporción lluvia
  cell.dayPct,              // 6: proporción día
  cell.centroid.latitude,   // 7: lat (captura tendencias geográficas)
  cell.centroid.longitude   // 8: lng
]);  // 9 características

// Paso 2: Crear etiquetas por percentiles
const leveCutoff = percentile(cells.map(c => c.accidentesLeve), 0.46);
const medioCutoff = percentile(cells.map(c => c.accidentesMedio), 0.57);
const graveCutoff = percentile(cells.map(c => c.accidentesGrave), 0.68);

// Paso 3: Binarizar
const labelsLeve = cells.map(c => c.accidentesLeve >= leveCutoff ? 1 : 0);
const labelsMedio = cells.map(c => c.accidentesMedio >= medioCutoff ? 1 : 0);
const labelsGrave = cells.map(c => c.accidentesGrave >= graveCutoff ? 1 : 0);

// Paso 4: Entrenar 3 modelos logísticos
const leveModel = trainLogisticModel(features, labelsLeve, 'villavicencio-leve');
const medioModel = trainLogisticModel(features, labelsMedio, 'villavicencio-medio');
const graveModel = trainLogisticModel(features, labelsGrave, 'villavicencio-grave');

// Resultado: modelos entrenados + métricas
return {
  models: { leve: leveModel, medio: medioModel, grave: graveModel },
  thresholds: { leve: leveCutoff, medio: medioCutoff, grave: graveCutoff },
  metrics: { leve: leve.metrics, medio: medio.metrics, grave: grave.metrics }
};
```

### 4.2 Entrenamiento Logístico Detallado

```javascript
// Línea 642-729: trainLogisticModel()

const trainLogisticModel = (samples, labels, modelKey) => {
  // 1. Dividir en train/test (75/25)
  const random = createSeededRandom(`split-${modelKey}`);
  const { normalized, means, stds } = standardizeMatrix(samples);
  const { trainIndices, testIndices } = buildSplit(samples.length, random);
  
  // 2. Inicializar parámetros
  const featureCount = normalized[0].length;  // 9
  const weights = new Array(featureCount).fill(0);
  let bias = 0;
  
  // 3. Hiperparámetros
  const learningRate = 0.1;
  const l2Penalty = 0.0015;  // Regularización L2
  const iterations = 650;
  
  // 4. Descenso por gradiente
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = new Array(featureCount).fill(0);
    let biasGradient = 0;
    
    for (const rowIndex of trainIndices) {
      const row = normalized[rowIndex];
      const target = labels[rowIndex];
      
      // Forward: z = w·x + b
      let linear = bias;
      for (let j = 0; j < featureCount; j += 1) {
        linear += weights[j] * row[j];
      }
      
      // Sigmoid: p = σ(z)
      const prediction = sigmoid(linear);
      
      // Error: ε = p - y
      const error = prediction - target;
      biasGradient += error;
      
      // Gradientes: ∂L/∂w_j = ε·x_j
      for (let j = 0; j < featureCount; j += 1) {
        gradient[j] += error * row[j];
      }
    }
    
    // Actualizar bias: b ← b - η·(1/m)·Σε
    const batchSize = trainIndices.length || 1;
    bias -= learningRate * (biasGradient / batchSize);
    
    // Actualizar pesos: w ← w - η·(1/m)·(Σε·x + λ·w)
    for (let j = 0; j < featureCount; j += 1) {
      const regularizedGradient = 
        gradient[j] / batchSize + l2Penalty * weights[j];
      weights[j] -= learningRate * regularizedGradient;
    }
  }
  
  // 5. Evaluar en conjunto de test
  const evalRows = testIndices.length ? testIndices : trainIndices;
  const evalLabels = evalRows.map(i => labels[i]);
  const evalProbabilities = evalRows.map(i => 
    predictLogisticProbability({ ... }, samples[i])
  );
  const metrics = evaluateBinaryClassification(evalLabels, evalProbabilities);
  
  return {
    type: 'logistic',
    means, stds, weights, bias,
    metrics: { accuracy, precision, recall, f1 }
  };
};

// Función sigmoid
const sigmoid = (value) => {
  if (value > 35) return 1;      // Evitar overflow
  if (value < -35) return 0;    // Evitar overflow
  return 1 / (1 + Math.exp(-value));
};
```

### 4.3 Predicción Final (Síntesis de Modelos + Contexto)

```javascript
// Línea 1443-1490: formatPredictionFromCell()

const formatPredictionFromCell = (cell, filters, cityModel) => {
  // Paso 1: Ajustar features por contexto de filtros
  const filterFactors = buildFilterFactors(cell, filters);
  const features = getAdjustedFeatureVector(cell, filters);
  
  // Paso 2: Obtener predicciones de los 3 modelos logísticos
  const pLeveModel = predictLogisticProbability(cityModel.models.leve, features);
  const pMedioModel = predictLogisticProbability(cityModel.models.medio, features);
  const pGraveModel = predictLogisticProbability(cityModel.models.grave, features);
  
  // Paso 3: Mezclar con frecuencias históricas de la celda
  const baseLeve = cell.accidentesTotal > 0 
    ? cell.accidentesLeve / cell.accidentesTotal 
    : 0.04;
  const baseMedio = cell.accidentesTotal > 0 
    ? cell.accidentesMedio / cell.accidentesTotal 
    : 0.025;
  const baseGrave = cell.accidentesTotal > 0 
    ? cell.accidentesGrave / cell.accidentesTotal 
    : 0.012;
  
  // MEZCLA: 72-80% modelo + 18-28% base histórico
  const predLeveProb = clamp(pLeveModel * 0.72 + baseLeve * 0.28, 0, 1);
  const predMedioProb = clamp(pMedioModel * 0.75 + baseMedio * 0.25, 0, 1);
  const predGraveProb = clamp(pGraveModel * 0.8 + baseGrave * 0.2, 0, 1);
  
  // Paso 4: Agregar por severidad (ponderado)
  // Si ocurren: leve (peso=1), medio (peso=2), grave (peso=3)
  const weightedRisk = (predLeveProb + predMedioProb * 2 + predGraveProb * 3) / 6;
  
  // Paso 5: Incorporar exposición histórica
  // Más accidentes totales → mayor exposición base
  const exposureFactor = clamp(cell.accidentesTotal / 28, 0, 1);
  const baseRiskScore = clamp(weightedRisk * 0.84 + exposureFactor * 0.16, 0, 1);
  
  // Paso 6: Aplicar factor de contexto (hora, lluvia, día/noche)
  const contextSwing = clamp(
    0.86 +
      (filterFactors.density - 1) * 0.38 +  // Densidad es el factor más fuerte
      (filterFactors.rain - 1) * 0.16 +     // Lluvia es moderado
      (filterFactors.day - 1) * 0.12,       // Día/noche es menor
    0.5,   // Minimum: 50% del riesgo base
    1.55   // Maximum: 155% del riesgo base
  );
  
  const contextRiskScore = clamp(baseRiskScore * contextSwing, 0, 1);
  
  // Paso 7: Mezclar base + contexto
  // 72% modelo base + 28% ajuste contextual
  const riskScore = clamp(baseRiskScore * 0.72 + contextRiskScore * 0.28, 0, 1);
  
  // Paso 8: Generar insights (tipo de accidente, gravedad probable)
  const insights = buildAccidentInsights({
    filters,
    predLeveProb, predMedioProb, predGraveProb,
    baseAccidentTypes: { 
      moto: cell.motoPct, 
      carro: cell.carroPct, 
      peaton: cell.peatonPct 
    },
    dayPct: cell.dayPct
  });
  
  return {
    id: cell.id,
    riskScore,
    riskLevel: getRiskLevel(riskScore),  // BAJO/MEDIO/ALTO/MUY_ALTO
    predLeveProb, predMedioProb, predGraveProb,
    ...insights,
    // ... más campos
  };
};
```

## 5. Ajuste de Contexto (buildFilterFactors)

```javascript
// Línea 1032-1131: buildFilterFactors()

// Este es el "conocimiento de negocio" codificado

const buildFilterFactors = (cell, filters) => {
  let density = 1.0;  // Factor multiplicativo base
  
  // Efecto por fecha
  if (filters.date) {
    const date = new Date(filters.date);
    const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    
    if (isWeekend) {
      // Fin de semana: aplicar factor del cell + multiplicador global
      density *= 0.9 + 0.75 * cell.weekendPct;
      // Si la celda tiene alto weekendPct → más aumento
    } else {
      // Día de semana: intercepción diferente
      density *= 1.05 + (1 - cell.weekendPct) * 0.22;
    }
    
    // Efecto estacional
    const month = date.getUTCMonth() + 1;
    if ([4, 5, 10, 11].includes(month)) {
      density *= 1.08;  // Lluvias en Colombia
    }
  }
  
  // Efecto por hora
  if (filters.hour !== null) {
    if (filters.hour >= 6 && filters.hour <= 9) {
      // Pico AM (6-9am)
      density *= 1.12 + 1.05 * cell.hourPeakAmPct;
    } else if (filters.hour >= 10 && filters.hour <= 16) {
      // Diurno (10-4pm)
      density *= 0.82 + 0.48 * cell.dayPct;
    } else if (filters.hour >= 17 && filters.hour <= 20) {
      // Pico PM (5-8pm)
      density *= 1.16 + 1.08 * cell.hourPeakPmPct;
    } else if (filters.hour >= 21 && filters.hour <= 23) {
      // Noche (9-11pm)
      density *= 0.72 + (1 - cell.dayPct) * 0.58;
    } else if (filters.hour >= 0 && filters.hour <= 4) {
      // Madrugada (12-4am)
      density *= 0.52 + (1 - cell.dayPct) * 0.5;
    }
  }
  
  // Efecto por clima
  if (filters.weather === 'lluvia') {
    density *= 1.12 + 0.88 * cell.rainPct;
    // Lluvia + alta rainPct en celda = mucho más riesgo
  } else if (filters.weather === 'no_lluvia') {
    density *= 0.74 + 0.22 * (1 - cell.rainPct);
  }
  
  // Retornar con clipping
  return {
    density: clamp(density, 0.35, 2.45)  // [35%, 245%]
  };
};
```

## 6. Flujo End-to-End (Request a Respuesta)

```
1. Frontend hace:
   GET /api/predictions?city=villavicencio&address=Carrera+5&date=2025-01-15&hour=17
   
2. Backend: server.js línea 81
   app.get('/api/predictions', async (req, res) => {
   
3. Valida autenticación (requireAuth middleware)

4. Llama fetchLocalPredictions(filters)
   
5. normalizeFilters():
   - Valida y normaliza cada parámetro
   - Parse date, hour, lat/lon, weather, period
   - Si hay conflictos (ej: hour + period), resuelve según reglas
   
6. getCityProfile('villavicencio')
   - Retorna: center, bbox, rows=14, cols=14
   
7. getOrCreateCityModel('villavicencio')
   - Consulta cityModelCache
   
   PRIMERA VEZ:
   a) parseGeoJsonPredictions(profile) → intenta leer LOCAL_PREDICTIONS_GEOJSON
      - Si existe: OK, retorna
      - Si no existe: null
      
   b) Si null → buildSyntheticCells(profile)
      - createSeededRandom('grid-villavicencio')
      - Genera 3 hotspots (determinísticos)
      - Itera 14x14 = 196 celdas
      - Para cada celda: calcula 9 features
      - Retorna array de cells
      
   c) buildModel(cells, 'villavicencio')
      - Extrae features: [densityKd, distHotspotKm, ..., lon]
      - Para cada modelo (leve, medio, grave):
        * Percentiles de corte (46%, 57%, 68%)
        * Binariza labels
        * trainLogisticModel():
          - standardizeMatrix()
          - buildSplit() (75/25)
          - Gradient descent 650 iterations
          - evaluateBinaryClassification()
      - Retorna models, thresholds, metrics
      
   d) Cachea en cityModelCache: NUNCA expira para esta sesión
      
   SIGUIENTE VEZ:
   a) cityModelCache.get('villavicencio') → retorna modelos ya entrenados
      
8. buildCacheKey(filters)
   - JSON.stringify de filtros
   
9. maybeGetCachedResponse(cacheKey)
   - ResponseCache.get(cacheKey)
   - Si expirado (5 min): borra y retorna null
   - Si válido: retorna response cacheada
   
10. Si NOT cached o expired:
    
    a) buildPredictions(cityModel, filters)
       - Si source==='geojson': 
         * Para cada prediction: applyFiltersToGeoJsonPrediction()
         * Ajusta riskScore por densityFactor
       - Si source==='synthetic_model':
         * Para cada cell: formatPredictionFromCell()
         * Aplica todos los pasos del pipeline ML
       - Sort por riskScore descending
       
    b) resolveAddressPoint(filters, profile)
       - Si lat/lon: usa directamente
       - Si address: crea seeded random desde address
         * Parsea números de dirección para generar (lat, lon) heurístico
         * Jittering para evitar puntos exactos
         
    c) buildAddressScopedPredictions(predictions, queryPoint)
       - haversineDistanceKm(queryPoint, cada prediction)
       - Filtra radius ≤ 2.4 km
       - Si < 6 resultados: expande a 12 más cercanos
       - Retorna predictions sorted + query (punto consultado)
       
11. storeResponseCache(cacheKey, payload) (TTL 5 min)

12. Retorna JSON:
    {
      data: [ { riskScore, predLeveProb, ... }, ... ],
      meta: {
        city: { key, label, center, ... },
        generatedAt: ISO timestamp,
        source: 'synthetic_model' | 'geojson',
        metrics: { leve: {...}, medio: {...}, grave: {...} },
        activeFilters: true,
        query: { probability, riskLevel, ... },
        range: { ... }
      }
    }
    
13. Frontend recibe y renderiza:
    - Leaflet: L.circleMarker + L.circle (shadow)
    - Popup con detalles
    - Color por getRiskColor(riskScore)
```

## 7. Decisiones Arquitectónicas Clave

| Decisión | Razón | Trade-off |
|----------|-------|-----------|
| **In-memory models, no DB** | Rendimiento: 0 latencia | Si reciclan proceso, re-entrenan |
| **Dual cache (modelos + responses)** | Models: sesión larga; Responses: 5min | Usan RAM, sin límite explícito |
| **Seeded random** | Reproducibilidad: mismo seed=mismo grid | No actualiza con datos nuevos |
| **Logística binaria x3** | Simple, rápido, interpretable | No captura correlaciones entre severidades |
| **Mezcla modelo+base (72/28)** | Suaviza overfitting del modelo | Asume que base es representativa |
| **Contexto multiplicativo** | Intuición humana: hora/lluvia × densidad | Lineal, no captura interacciones complejas |
| **Percentile binning (46/57/68)** | Balanceo de clases automático | Pierde info cuantitativa |
| **Socket.io broadcast inicial** | Reduce latencia inicial frontend | Se envía muestra fija (80 predicciones) |

## 8. Stack Tecnológico

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **DB**: MySQL 8+ (pool 10 conexiones)
- **Real-time**: Socket.io
- **ML**: Implementación manual (sin TensorFlow/scikit-learn)
- **Utilities**: 
  - `mysql2/promise` (async queries)
  - `uuid` (IDs ciudadano)
  - `node:crypto` (hashing)

### Frontend
- **Framework**: React 18+
- **Build**: Vite (muy rápido)
- **Maps**: Leaflet.js + OpenStreetMap
- **Real-time**: Socket.io client
- **Styling**: CSS modules + Bootstrap

## 9. Optimizaciones Implementadas

### 9.1 Request Prediction
```
Sin caché: 1-2s (entrena modelos en primer request)
Con caché modelos: 100-300ms (ya entrenados)
Con caché respuestas: 10-50ms (JSON serializado)
```

### 9.2 Memory Management
- **Models cache**: ~3-5 MB/ciudad × 5 ciudades = ~20-25 MB
- **Response cache**: Variable, típicamente <50 MB
- **Total overhead**: ~50-70 MB en un proceso Node.js dedicado

### 9.3 Rendering Leaflet
- Limita a 120 predicciones máximo en UI
- Uses LayerGroups para batch operations:
  - `predictionsLayerRef.clearLayers()` O(1)
  - `layer.addTo(map)` lazy
- Circle markers + shadow circles (efecto visual económico)

## 10. Flujos Especiales

### 10.1 Modo Rango (Temporal)
```
GET /api/predictions?rangeMode=dia&rangeStart=2025-01-10&rangeEnd=2025-01-15

1. buildRangeSteps() → genera [2025-01-10, ..., 2025-01-15]
2. Para CADA fecha:
   - buildPredictions(cityModel, {..., date: step})
   - Acumula riskScore en estructura byPointId
3. buildSeverePointsForRange():
   - Para cada punto: peakRiskScore, rangeOccurrences
   - Filtra HIGH_SEVERITY_THRESHOLD (0.75)
   - Retorna ≤120 puntos
```

### 10.2 Modo GeoJSON Precomputado
```
Si LOCAL_PREDICTIONS_GEOJSON está configurado:

1. parseGeoJsonPredictions(profile)
   - Lee archivo JSON
   - Parsea propiedades: PRED_LEVE_PROB, PRED_MEDIO_PROB, PRED_GRAVE_PROB
   - Si no existen: calcula weighted = (leve + medio*2 + grave*3) / 6
   
2. NO entrena modelos logísticos
   - Usa probabilidades leídas del archivo
   - Solo aplica filterFactors al riskScore

Ventaja: Carga datos precomputados desde pipeline Python/ML externos
```

## 11. Seguridad y Errores

### Error Handling
```javascript
// Todos los endpoints retornan:
{
  message: "Error description",
  status: 400 | 500
}

// LocalPredictionEngineError subclasea Error con status
throw new LocalPredictionEngineError(
  'GeoJSON mal formado', 
  400
);
```

### Validación
- **normalizeFilters()**: Convierte/valida cada parámetro
- **parseCoordinate()**: -90 ≤ lat ≤ 90, -180 ≤ lon ≤ 180
- **parseHour()**: 0-23
- **toIsoDate()**: Formato YYYY-MM-DD
- **Clamp()**: Fuerza [min, max]

---

## 12. Resumen de Complejidad Computacional

| Operación | Complejidad | Tiempo Típico |
|-----------|-----------|---------------|
| Normalize filters | O(1) | <1ms |
| Build synthetic grid | O(rows × cols × hotspots) = O(196 × 3) | 50-100ms |
| Train logistic model | O(iterations × trainSize × features) = O(650 × 147 × 9) | 400-800ms |
| Build predictions | O(cells × features) = O(196 × 9) | 10-20ms |
| Apply context | O(cells) | 5-10ms |
| Build address scope | O(predictions × predictions) = O(60²) peor caso | 10-30ms |
| Cache lookup | O(1) amortizado | <1ms |
| **Total PRIMERA VEZ** | | **500-1200ms** |
| **Total CON CACHE** | | **50-150ms** |

