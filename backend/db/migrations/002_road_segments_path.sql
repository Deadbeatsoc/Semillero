SET @has_highway_type = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'road_segments'
    AND COLUMN_NAME = 'highway_type'
);
SET @sql = IF(
  @has_highway_type = 0,
  'ALTER TABLE road_segments ADD COLUMN highway_type VARCHAR(40) NULL AFTER source',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_path_json = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'road_segments'
    AND COLUMN_NAME = 'path_json'
);
SET @sql = IF(
  @has_path_json = 0,
  'ALTER TABLE road_segments ADD COLUMN path_json JSON NULL AFTER highway_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_index = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'road_segments'
    AND INDEX_NAME = 'idx_road_segments_highway_type'
);
SET @sql = IF(
  @has_index = 0,
  'CREATE INDEX idx_road_segments_highway_type ON road_segments (highway_type)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
