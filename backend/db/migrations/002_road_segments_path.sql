ALTER TABLE road_segments
  ADD COLUMN IF NOT EXISTS highway_type VARCHAR(40) NULL AFTER source,
  ADD COLUMN IF NOT EXISTS path_json JSON NULL AFTER highway_type;

CREATE INDEX idx_road_segments_highway_type ON road_segments (highway_type);
