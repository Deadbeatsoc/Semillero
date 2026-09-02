-- Discriminador de dataset para soportar 3 fuentes seleccionables:
--   'real'      -> siniestros reales (importados de Excel Secretaria de Movilidad)
--   'sintetico' -> siniestros generados aleatoriamente (seed)
-- El modo "mixto" en la app es la union de ambos (no requiere almacenamiento extra).
ALTER TABLE accident_events
  ADD COLUMN dataset ENUM('real', 'sintetico') NOT NULL DEFAULT 'sintetico' AFTER source_system;

ALTER TABLE accident_events
  ADD KEY idx_accident_events_city_dataset (city_id, dataset);

-- Los registros existentes provienen del seed OSM: se marcan como sinteticos.
UPDATE accident_events
SET dataset = 'sintetico'
WHERE source_system LIKE 'seed_%' OR dataset IS NULL;
