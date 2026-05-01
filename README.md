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
- `WEATHERAPI_KEY` o `WEATHER_API_KEY`: API key para consultar clima en WeatherAPI.
- `WEATHER_API_DAYS` (opcional): cantidad de dias a consultar (default `3`).
- `WEATHER_API_BASE_URL` (opcional): base URL de WeatherAPI.
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`: conexion MySQL para migraciones.
- `DB_CHARSET`, `DB_COLLATION`: codificacion/collation para crear esquema MySQL.
- `ADMIN_DEFAULT_USERNAME`, `ADMIN_DEFAULT_PASSWORD`: credenciales del primer administrador (si no existe uno).
- `ADMIN_INITIAL_VERIFICATION_CODE`: codigo inicial para registro de usuarios (opcional).
- `AUTH_SESSION_HOURS`: duracion de sesion en horas.
- `SEED_ACCIDENT_COUNT` (opcional): cantidad de accidentes ficticios a generar (default `5000`).
- `SEED_DELETE_PREVIOUS` (opcional): borra seed anterior (`true` por defecto).
- `OVERPASS_URL` (opcional): endpoint Overpass para descargar vias OSM.

Si no defines `LOCAL_PREDICTIONS_GEOJSON`, el backend usa un modelo local sintetico entrenado en memoria.
Si no existe ningun administrador, al iniciar backend se crea uno automaticamente y se muestra en consola.

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

- `POST /api/auth/register`: registro con `username`, `password`, `verificationCode`.
- `POST /api/auth/login`: login y entrega token Bearer.
- `GET /api/auth/me`: validar sesion actual.
- `POST /api/auth/logout`: cerrar sesion.
- `POST /api/activity/visit`: registra ingreso de usuario autenticado.
- `GET /api/admin/dashboard`: metricas (solo admin).
- `GET /api/admin/verification-code`: codigo de registro activo (solo admin).
- `POST /api/admin/verification-code/regenerate`: reemplaza codigo de registro (solo admin).
- `GET /api/admin/reports/pending`: lista solicitudes pendientes de aprobacion (solo admin).
- `POST /api/admin/reports/:id/approve`: aprueba una solicitud y la publica para hoy (solo admin).
- `GET /api/cities`: lista de ciudades soportadas.
- `GET /api/predictions?city=&address=&latitude=&longitude=&date=&hour=&weather=&period=&rangeMode=&rangeStart=&rangeEnd=`: hotspots y probabilidad por zona.
  - `rangeMode=dia` usa `rangeStart/rangeEnd` en formato `YYYY-MM-DD`.
  - `rangeMode=mes` usa `rangeStart/rangeEnd` en formato `YYYY-MM`.
  - En modo rango, el backend devuelve los puntos con mayor severidad en la ventana seleccionada.
- `GET /api/geocode/suggest?query=&city=`: autocompletado de direcciones.
- `GET /api/geocode/reverse?latitude=&longitude=&city=`: direccion aproximada para un punto.
- `GET /api/weather/forecast?city=&latitude=&longitude=`: pronostico de lluvia por hora y resumen diario. Si envias coordenadas, consulta clima para ese punto (si no, usa el centro de la ciudad).
- `GET /api/reports`: reportes ciudadanos **aprobados hoy** (visibles en mapa).
- `POST /api/reports`: crea solicitud pendiente con descripcion, punto en mapa y foto evidencia.

Todos los endpoints de consulta (`/api/cities`, `/api/predictions`, `/api/geocode/*`, `/api/reports`) requieren token Bearer.

### Eventos Socket.IO

- `init`: envia reportes y una muestra de predicciones iniciales.

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

Al abrir la SPA:
- Si no hay sesion, se muestra login/registro.
- Usuarios normales ven el sistema de predicciones.
- Administradores ven dashboard con metricas, codigo de verificacion y una vista `Solicitudes` para aprobar reportes pendientes.

## Como usar tu propio GeoJSON del modelo

1. Genera un archivo `predicciones.geojson` (por ejemplo desde tu pipeline Python local).
2. Define en `backend/.env`:

```bash
LOCAL_PREDICTIONS_GEOJSON=C:\ruta\predicciones.geojson
```

3. Reinicia backend.

El motor detecta el archivo y usa esas predicciones en vez del modelo sintetico.

## Notas

- Las solicitudes de reporte y aprobaciones se guardan en MySQL.
- Las imagenes de evidencia se guardan en `backend/uploads/reports`.
- El modelo local esta disenado como fallback para desarrollo local sin servicios ArcGIS.
- El mapa inicia sin hotspots (modo normal). Los hotspots aparecen cuando aplicas filtros.
- Puedes escribir una direccion y elegir una sugerencia, o activar "Seleccionar ubicacion en mapa" para llenar la barra automaticamente.
- Para prediccion puntual por direccion, debes tener coordenadas validas (sugerencia seleccionada o punto en mapa). El backend ya no usa ubicacion heuristica por texto libre.
- Si eliges modo temporal `dia a dia` o `mes a mes`, el mapa muestra los puntos mas graves del rango en vez de una consulta puntual.
`````````````
