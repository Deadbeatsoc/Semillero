# Plataforma local de prediccion y reporte de accidentes

Aplicacion full-stack con:
- Frontend en React + Vite.
- Mapa en OpenStreetMap (Leaflet).
- Backend en Node.js + Express + Socket.IO.
- Motor local de prediccion por zonas (sin ArcGIS API).
- Geocodificacion para autocompletar direcciones y seleccionar ubicaciones desde el mapa.

## Estructura del proyecto

```text
Websemillero/
|-- backend/    # API REST + WebSocket + modelo local
`-- frontend/   # SPA React con mapa OSM
```

## Requisitos

- Node.js 18 o superior.

## Backend

```bash
cd backend
npm install
cp .env.example .env
npm run migrate
npm run seed:villavicencio
npm run dev
```

Variables en `.env`:
- `PORT`: puerto del backend (default `4000`).
- `DEFAULT_CITY`: ciudad inicial para sockets (`villavicencio`, `bogota`, `medellin`, `cali`, `barranquilla`).
- `LOCAL_PREDICTIONS_GEOJSON` (opcional): ruta a un GeoJSON local precomputado.
- `GEOCODER_USER_AGENT` (opcional): identificador para consultas de geocodificacion.
- `NOMINATIM_BASE_URL` (opcional): proveedor de geocodificacion (default Nominatim OSM).
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`: conexion MySQL para migraciones.
- `DB_CHARSET`, `DB_COLLATION`: codificacion/collation para crear esquema MySQL.
- `SEED_ACCIDENT_COUNT` (opcional): cantidad de accidentes ficticios a generar (default `5000`).
- `SEED_DELETE_PREVIOUS` (opcional): borra seed anterior (`true` por defecto).
- `OVERPASS_URL` (opcional): endpoint Overpass para descargar vias OSM.

Si no defines `LOCAL_PREDICTIONS_GEOJSON`, el backend usa un modelo local sintetico entrenado en memoria.

### Migraciones MySQL

```bash
cd backend
npm run migrate
```

- El script crea la base de datos si no existe.
- Luego ejecuta los SQL en `backend/db/migrations` una sola vez (tabla `schema_migrations`).

### Seed Villavicencio (5000 registros)

```bash
cd backend
npm run seed:villavicencio
```

Comando rapido (PowerShell):

```powershell
cd backend
npm run migrate
npm run seed:villavicencio
```

- Descarga vias reales de OpenStreetMap (Overpass) dentro del bbox de Villavicencio.
- Guarda esas vias en `road_segments` con `path_json`.
- Inserta accidentes en `accident_events` eligiendo puntos sobre las polilineas de via.
- Esto evita puntos en rios/montanas o zonas sin acceso vehicular, porque el muestreo se hace sobre calles.

Nota: para esta seed necesitas acceso a internet hacia el endpoint de Overpass configurado.

### Endpoints

- `GET /api/cities`: lista de ciudades soportadas.
- `GET /api/predictions?city=&address=&latitude=&longitude=&date=&hour=&weather=&period=&rangeMode=&rangeStart=&rangeEnd=`: hotspots y probabilidad por zona.
  - `rangeMode=dia` usa `rangeStart/rangeEnd` en formato `YYYY-MM-DD`.
  - `rangeMode=mes` usa `rangeStart/rangeEnd` en formato `YYYY-MM`.
  - En modo rango, el backend devuelve los puntos con mayor severidad en la ventana seleccionada.
- `GET /api/geocode/suggest?query=&city=`: autocompletado de direcciones.
- `GET /api/geocode/reverse?latitude=&longitude=&city=`: direccion aproximada para un punto.
- `GET /api/reports`: reportes ciudadanos en memoria.
- `POST /api/reports`: registrar reporte ciudadano.

### Eventos Socket.IO

- `init`: envia reportes y una muestra de predicciones iniciales.
- `report:new`: nuevo reporte ciudadano en tiempo real.

## Frontend

```bash
cd frontend
npm install
```

Archivo `.env.local` recomendado:

```bash
VITE_API_URL=http://localhost:4000
VITE_SOCKET_URL=http://localhost:4000
```

Ejecutar:

```bash
npm run dev
```

## Como usar tu propio GeoJSON del modelo

1. Genera un archivo `predicciones.geojson` (por ejemplo desde tu pipeline Python local).
2. Define en `backend/.env`:

```bash
LOCAL_PREDICTIONS_GEOJSON=C:\ruta\predicciones.geojson
```

3. Reinicia backend.

El motor detecta el archivo y usa esas predicciones en vez del modelo sintetico.

## Notas

- Los reportes se guardan en memoria (se pierden al reiniciar).
- El modelo local esta disenado como fallback para desarrollo local sin servicios ArcGIS.
- El mapa inicia sin hotspots (modo normal). Los hotspots aparecen cuando aplicas filtros.
- Puedes escribir una direccion y elegir una sugerencia, o activar "Seleccionar ubicacion en mapa" para llenar la barra automaticamente.
- Si eliges modo temporal `dia a dia` o `mes a mes`, el mapa muestra los puntos mas graves del rango en vez de una consulta puntual.
`````````````
