CREATE TABLE IF NOT EXISTS cities (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  city_key VARCHAR(60) NOT NULL,
  label VARCHAR(120) NOT NULL,
  center_latitude DECIMAL(9, 6) NOT NULL,
  center_longitude DECIMAL(9, 6) NOT NULL,
  zoom_level TINYINT UNSIGNED NOT NULL DEFAULT 12,
  bbox_west DECIMAL(10, 6) NULL,
  bbox_south DECIMAL(10, 6) NULL,
  bbox_east DECIMAL(10, 6) NULL,
  bbox_north DECIMAL(10, 6) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cities_city_key (city_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS road_segments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  city_id INT UNSIGNED NOT NULL,
  segment_code VARCHAR(120) NOT NULL,
  name VARCHAR(180) NOT NULL,
  centroid_latitude DECIMAL(10, 7) NOT NULL,
  centroid_longitude DECIMAL(10, 7) NOT NULL,
  source VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_road_segments_city_segment (city_id, segment_code),
  KEY idx_road_segments_city (city_id),
  CONSTRAINT fk_road_segments_city
    FOREIGN KEY (city_id) REFERENCES cities(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS accident_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  city_id INT UNSIGNED NOT NULL,
  road_segment_id BIGINT UNSIGNED NULL,
  occurred_at DATETIME NOT NULL,
  severity ENUM('baja', 'media', 'alta', 'fatal') NOT NULL DEFAULT 'media',
  weather ENUM('lluvia', 'no_lluvia', 'desconocido') NOT NULL DEFAULT 'desconocido',
  period ENUM('dia', 'noche', 'desconocido') NOT NULL DEFAULT 'desconocido',
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  source_system VARCHAR(100) NULL,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_accident_events_city_occurred_at (city_id, occurred_at),
  KEY idx_accident_events_severity (severity),
  KEY idx_accident_events_segment (road_segment_id),
  CONSTRAINT fk_accident_events_city
    FOREIGN KEY (city_id) REFERENCES cities(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_accident_events_segment
    FOREIGN KEY (road_segment_id) REFERENCES road_segments(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS prediction_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  city_id INT UNSIGNED NOT NULL,
  requested_by VARCHAR(100) NULL,
  filter_payload JSON NULL,
  range_mode ENUM('none', 'dia', 'mes') NOT NULL DEFAULT 'none',
  range_start DATE NULL,
  range_end DATE NULL,
  model_version VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prediction_runs_city_created_at (city_id, created_at),
  CONSTRAINT fk_prediction_runs_city
    FOREIGN KEY (city_id) REFERENCES cities(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS prediction_points (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id BIGINT UNSIGNED NOT NULL,
  road_segment_id BIGINT UNSIGNED NULL,
  risk_score DECIMAL(6, 5) NOT NULL,
  risk_level ENUM('BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO') NOT NULL,
  pred_leve_prob DECIMAL(6, 5) NOT NULL DEFAULT 0,
  pred_medio_prob DECIMAL(6, 5) NOT NULL DEFAULT 0,
  pred_grave_prob DECIMAL(6, 5) NOT NULL DEFAULT 0,
  peak_date DATE NULL,
  range_average_risk DECIMAL(6, 5) NULL,
  range_occurrences SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prediction_points_run (run_id),
  KEY idx_prediction_points_segment (road_segment_id),
  KEY idx_prediction_points_risk (risk_score),
  CONSTRAINT fk_prediction_points_run
    FOREIGN KEY (run_id) REFERENCES prediction_runs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_prediction_points_segment
    FOREIGN KEY (road_segment_id) REFERENCES road_segments(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS citizen_reports (
  id CHAR(36) NOT NULL,
  city_id INT UNSIGNED NULL,
  description TEXT NOT NULL,
  severity ENUM('baja', 'media', 'alta') NOT NULL DEFAULT 'media',
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  status ENUM('nuevo', 'validado', 'descartado') NOT NULL DEFAULT 'nuevo',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_citizen_reports_created_at (created_at),
  KEY idx_citizen_reports_city_status (city_id, status),
  CONSTRAINT fk_citizen_reports_city
    FOREIGN KEY (city_id) REFERENCES cities(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO cities (
  city_key,
  label,
  center_latitude,
  center_longitude,
  zoom_level,
  bbox_west,
  bbox_south,
  bbox_east,
  bbox_north
) VALUES
  ('villavicencio', 'Villavicencio', 4.142000, -73.626600, 12, -73.780000, 4.010000, -73.480000, 4.270000),
  ('bogota', 'Bogota', 4.711000, -74.072100, 11, -74.250000, 4.490000, -73.990000, 4.860000),
  ('medellin', 'Medellin', 6.244200, -75.581200, 12, -75.700000, 6.140000, -75.490000, 6.350000),
  ('cali', 'Cali', 3.451600, -76.532000, 12, -76.620000, 3.330000, -76.460000, 3.520000),
  ('barranquilla', 'Barranquilla', 10.968500, -74.781300, 12, -74.900000, 10.860000, -74.710000, 11.050000)
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  center_latitude = VALUES(center_latitude),
  center_longitude = VALUES(center_longitude),
  zoom_level = VALUES(zoom_level),
  bbox_west = VALUES(bbox_west),
  bbox_south = VALUES(bbox_south),
  bbox_east = VALUES(bbox_east),
  bbox_north = VALUES(bbox_north);
