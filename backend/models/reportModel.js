const insertPendingReport = async (
  connection,
  {
    id,
    cityId = null,
    description,
    severity,
    latitude,
    longitude,
    evidenceUrl,
    reportedByUserId = null
  }
) => {
  await connection.execute(
    `
      INSERT INTO citizen_reports (
        id,
        city_id,
        reported_by_user_id,
        description,
        evidence_url,
        severity,
        latitude,
        longitude,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'nuevo')
    `,
    [
      id,
      cityId,
      reportedByUserId,
      description,
      evidenceUrl,
      severity,
      latitude,
      longitude
    ]
  );
};

const listApprovedTodayReports = async (connection) => {
  const [rows] = await connection.query(
    `
      SELECT
        reports.id,
        reports.description,
        reports.severity,
        reports.latitude,
        reports.longitude,
        reports.evidence_url,
        reports.created_at,
        reports.accepted_at,
        reporter.username AS reported_by_username,
        approver.username AS accepted_by_username
      FROM citizen_reports AS reports
      LEFT JOIN users AS reporter ON reporter.id = reports.reported_by_user_id
      LEFT JOIN users AS approver ON approver.id = reports.accepted_by_user_id
      WHERE reports.status = 'validado'
        AND reports.accepted_at IS NOT NULL
        AND DATE(reports.accepted_at) = CURRENT_DATE()
      ORDER BY reports.accepted_at DESC
      LIMIT 200
    `
  );

  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    severity: row.severity,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    evidenceUrl: row.evidence_url || '',
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    reportedBy: row.reported_by_username || 'N/D',
    acceptedBy: row.accepted_by_username || 'N/D'
  }));
};

const listPendingReports = async (connection) => {
  const [rows] = await connection.query(
    `
      SELECT
        reports.id,
        reports.description,
        reports.evidence_url,
        reports.severity,
        reports.latitude,
        reports.longitude,
        reports.created_at,
        reporter.username AS reported_by_username
      FROM citizen_reports AS reports
      LEFT JOIN users AS reporter ON reporter.id = reports.reported_by_user_id
      WHERE reports.status = 'nuevo'
      ORDER BY reports.created_at ASC
      LIMIT 300
    `
  );

  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    severity: row.severity,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    evidenceUrl: row.evidence_url || '',
    createdAt: row.created_at,
    reportedBy: row.reported_by_username || 'N/D'
  }));
};

const countPendingReports = async (connection) => {
  const [rows] = await connection.query(
    `
      SELECT COUNT(*) AS total
      FROM citizen_reports
      WHERE status = 'nuevo'
    `
  );
  return Number(rows[0]?.total || 0);
};

const approvePendingReport = async (connection, { reportId, acceptedByUserId, acceptedAtDateTime }) => {
  const [result] = await connection.execute(
    `
      UPDATE citizen_reports
      SET status = 'validado',
          accepted_at = ?,
          accepted_by_user_id = ?,
          updated_at = ?
      WHERE id = ?
        AND status = 'nuevo'
    `,
    [acceptedAtDateTime, acceptedByUserId, acceptedAtDateTime, reportId]
  );

  return Number(result.affectedRows || 0);
};

export {
  approvePendingReport,
  countPendingReports,
  insertPendingReport,
  listApprovedTodayReports,
  listPendingReports
};
