Coloca aqui `predicciones.geojson` si quieres usar un resultado precomputado del modelo.

Formato esperado por feature:
- Geometria: `Polygon` (preferido) o atributos `latitude` y `longitude`.
- Probabilidades: `PRED_LEVE_PROB`, `PRED_MEDIO_PROB`, `PRED_GRAVE_PROB` (o variantes en camel/snake case).
- Riesgo opcional: `RIESGO_SCORE` (0..1 o 0..100).
- Ciudad opcional: `cityKey` o `city` (`villavicencio`, `bogota`, etc.) para filtrar por ciudad.
