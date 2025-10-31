# Plataforma de predicción y reporte de accidentes

Aplicación full-stack que muestra un mapa interactivo con datos simulados de predicción de accidentes y reportes ciudadanos en tiempo real. El frontend está construido con React + Vite y utiliza ArcGIS JavaScript API para renderizar el mapa. El backend está desarrollado en Node.js con Express y Socket.IO para enviar eventos en vivo.

## Requisitos previos

- Node.js 18 o superior
- Cuenta de ArcGIS (opcional) para generar un API key y visualizar capas premium

## Estructura del proyecto

```
Semillero/
├── backend/    # API REST + WebSocket con Express y Socket.IO
└── frontend/   # SPA en React + Vite que consume ArcGIS JS API
```

## Configuración del backend

```bash
cd backend
npm install
npm run dev
```

La API expone los siguientes endpoints:

- `GET /api/predictions`: devuelve las predicciones filtradas por fecha, hora, clima y periodo del día.
- `GET /api/reports`: devuelve los reportes ciudadanos guardados.
- `POST /api/reports`: recibe un reporte (latitud, longitud, descripción y severidad) y lo retransmite en tiempo real vía WebSocket.

> El backend escucha por defecto en el puerto **4000**. Puedes modificarlo mediante la variable de entorno `PORT`.

## Configuración del frontend

```bash
cd frontend
npm install
npm run dev
```

Opcionalmente crea un archivo `.env` en `frontend/` para personalizar la conexión al backend o agregar tu API key de ArcGIS:

```bash
VITE_API_URL=http://localhost:4000
VITE_SOCKET_URL=http://localhost:4000
VITE_ARCGIS_API_KEY=tu_api_key
```

La aplicación utiliza la API de ArcGIS para pintar:

- Marcadores de **predicciones de IA** con un gradiente de riesgo (verde, amarillo, rojo).
- Marcadores de **reportes ciudadanos** en vivo; cada vez que un usuario envía un reporte se emite un evento en tiempo real y el mapa se actualiza automáticamente.

### Flujo de uso

1. Ajusta los filtros (fecha, hora, clima y periodo) para recalcular las predicciones. El backend aplica el filtrado y devuelve los puntos que se visualizan en el mapa.
2. Envía un reporte con las coordenadas y severidad del incidente. La API lo guarda en memoria y lo transmite vía Socket.IO al resto de clientes conectados.
3. Observa el panel lateral con la lista de predicciones activas y los reportes más recientes.

## Estilos y UI

La interfaz utiliza **Bootstrap 5** junto con estilos propios para lograr un diseño limpio y moderno. El mapa se renderiza dentro de un contenedor con esquinas redondeadas y sombras suaves.

## Notas técnicas

- Las predicciones se generan aleatoriamente para efectos de demostración y se renuevan cada minuto, emitiendo un evento `prediction:new`.
- Los datos se mantienen en memoria para simplificar la ejecución local. Si deseas persistirlos, reemplaza la lógica con una base de datos.
- El frontend usa la configuración de proxy de Vite para redirigir peticiones `/api` al backend durante el desarrollo.

## Scripts disponibles

### Backend
- `npm run dev`: inicia el servidor con **nodemon**.
- `npm start`: ejecuta el servidor en modo producción.

### Frontend
- `npm run dev`: arranca el servidor de desarrollo de Vite.
- `npm run build`: genera los artefactos listos para producción.
- `npm run preview`: sirve la compilación generada por `build`.

## Próximos pasos sugeridos

- Integrar un modelo real de predicción (TensorFlow, PyTorch, AutoML, etc.).
- Conectar los reportes a una base de datos relacional o NoSQL.
- Desplegar la solución en un servicio gestionado y proteger el API key de ArcGIS mediante variables de entorno.
