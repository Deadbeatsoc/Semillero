# Plataforma de predicción y reporte de accidentes

Aplicación full-stack que muestra un mapa interactivo con predicciones reales de ArcGIS y reportes ciudadanos en tiempo real. El frontend está construido con React + Vite y utiliza ArcGIS JavaScript API para renderizar el mapa. El backend está desarrollado en Node.js con Express y Socket.IO para consultar ArcGIS y retransmitir eventos en vivo.

## Requisitos previos

- Node.js 18 o superior
- Cuenta de ArcGIS para crear una aplicación (client id/secret) y acceder al servicio de predicciones

## Estructura del proyecto

```
Semillero/
├── backend/    # API REST + WebSocket con Express y Socket.IO
└── frontend/   # SPA en React + Vite que consume ArcGIS JS API
```

## Configuración del backend

1. Instala las dependencias:

   ```bash
   cd backend
   npm install
   ```

2. Crea el archivo de variables de entorno:

   ```bash
   cp .env.example .env
   ```

3. Completa los valores del archivo `.env`:

   - `PORT`: puerto en el que se expondrá el API (por defecto 4000).
   - `ARCGIS_PREDICTIONS_URL`: endpoint REST de ArcGIS que devuelve las predicciones (por ejemplo, una capa de `FeatureServer`).
   - Autenticación:
     - Define `ARCGIS_TOKEN` con un token válido **o**
     - Proporciona `ARCGIS_USERNAME` y `ARCGIS_PASSWORD` si el servicio acepta Basic Auth **o**
     - Guarda `ARCGIS_CLIENT_ID` y `ARCGIS_CLIENT_SECRET` y usa estos valores para generar un token con el flujo *Client Credentials* de ArcGIS. Una vez obtenido, cópialo en `ARCGIS_TOKEN`.

4. Inicia el servidor de desarrollo (las variables del `.env` se cargan automáticamente mediante `dotenv`):

   ```bash
   npm run dev
   ```

### Flujo real de predicciones

Cuando el frontend solicita `GET /api/predictions`, el backend construye la URL hacia `ARCGIS_PREDICTIONS_URL` aplicando los filtros recibidos (fecha, hora, clima y periodo). A continuación ejecuta una petición HTTP con las credenciales configuradas, normaliza la respuesta de ArcGIS y devuelve las predicciones al cliente. Cada predicción recibida se emite también vía Socket.IO mediante el evento `prediction:new` para mantener sincronizados a todos los clientes conectados.

La API sigue exponiendo además:

- `GET /api/predictions`: devuelve las predicciones normalizadas que provienen de ArcGIS.
- `GET /api/reports`: devuelve los reportes ciudadanos guardados en memoria.
- `POST /api/reports`: recibe un reporte (latitud, longitud, descripción y severidad) y lo retransmite en tiempo real vía WebSocket.

> El backend escucha por defecto en el puerto **4000**. Puedes modificarlo mediante la variable de entorno `PORT`.

## Configuración del frontend

```bash
cd frontend
npm install
```

Crea un archivo `.env.local` (o `.env`) en `frontend/` para conectar con el backend y definir tu API key de ArcGIS JS:

```bash
VITE_API_URL=http://localhost:4000
VITE_SOCKET_URL=http://localhost:4000
VITE_ARCGIS_API_KEY=tu_api_key
```

Vite carga automáticamente las variables que empiecen con `VITE_`, por lo que estarán disponibles en `import.meta.env` al ejecutar `npm run dev` o `npm run build`.

La aplicación utiliza la API de ArcGIS para pintar:

- Marcadores de **predicciones de IA** con un gradiente de riesgo (verde, amarillo, rojo).
- Marcadores de **reportes ciudadanos** en vivo; cada vez que un usuario envía un reporte se emite un evento en tiempo real y el mapa se actualiza automáticamente.

### Flujo de uso

1. Ajusta los filtros (fecha, hora, clima y periodo) para recalcular las predicciones. El backend consulta ArcGIS con esos parámetros y devuelve los puntos que se visualizan en el mapa.
2. Envía un reporte con las coordenadas y severidad del incidente. La API lo guarda en memoria y lo transmite vía Socket.IO al resto de clientes conectados.
3. Observa el panel lateral con la lista de predicciones activas y los reportes más recientes.

## Estilos y UI

La interfaz utiliza **Bootstrap 5** junto con estilos propios para lograr un diseño limpio y moderno. El mapa se renderiza dentro de un contenedor con esquinas redondeadas y sombras suaves.

## Notas técnicas

- El backend no persiste datos: los reportes ciudadanos se guardan en memoria y se pierden al reiniciar el servidor.
- El frontend usa la configuración de proxy de Vite para redirigir peticiones `/api` al backend durante el desarrollo.

## Ejecución con datos reales

1. **Backend** (primer terminal):

   ```bash
   cd backend
   npm run dev
   ```

   Asegúrate de haber configurado previamente el archivo `.env` con las credenciales y la URL de ArcGIS.

2. **Frontend** (segundo terminal):

   ```bash
   cd frontend
   npm run dev
   ```

   Vite leerá el archivo `.env.local`/`.env` y propagará las variables `VITE_` al entorno del navegador.

Cuando despliegues en producción, exporta las mismas variables de entorno (`PORT`, `ARCGIS_*`) en el host del backend y define las variables `VITE_` durante el proceso de build del frontend para que las URLs y credenciales de ArcGIS apunten a tus servicios reales.

## Scripts disponibles

### Backend
- `npm run dev`: inicia el servidor con **nodemon**.
- `npm start`: ejecuta el servidor en modo producción.

### Frontend
- `npm run dev`: arranca el servidor de desarrollo de Vite.
- `npm run build`: genera los artefactos listos para producción.
- `npm run preview`: sirve la compilación generada por `build`.

## Próximos pasos sugeridos

- Conectar los reportes a una base de datos relacional o NoSQL para preservarlos.
- Desplegar la solución en un servicio gestionado y proteger el API key de ArcGIS mediante variables de entorno.
