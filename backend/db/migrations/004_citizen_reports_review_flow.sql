ALTER TABLE citizen_reports
  ADD COLUMN evidence_url VARCHAR(255) NULL AFTER description,
  ADD COLUMN reported_by_user_id BIGINT UNSIGNED NULL AFTER city_id,
  ADD COLUMN accepted_at DATETIME NULL AFTER updated_at,
  ADD COLUMN accepted_by_user_id BIGINT UNSIGNED NULL AFTER accepted_at;

ALTER TABLE citizen_reports
  ADD KEY idx_citizen_reports_status_created (status, created_at),
  ADD KEY idx_citizen_reports_accepted_at (accepted_at),
  ADD KEY idx_citizen_reports_reported_by_user (reported_by_user_id),
  ADD KEY idx_citizen_reports_accepted_by_user (accepted_by_user_id);
