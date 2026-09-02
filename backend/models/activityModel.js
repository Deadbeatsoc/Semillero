const createActivityLog = async (connection, { userId = null, eventType, eventData = null }) => {
  await connection.execute(
    `
      INSERT INTO activity_logs (user_id, event_type, event_data)
      VALUES (?, ?, ?)
    `,
    [userId, eventType, eventData ? JSON.stringify(eventData) : null]
  );
};

const getDashboardSummary = async (connection, { dataset = 'mixto' } = {}) => {
  // dataset: 'real' | 'sintetico' | 'mixto'. Solo se inyectan literales validados
  // del enum (sin riesgo de inyeccion). 'mixto' = sin filtro (union).
  const safeDataset = dataset === 'real' || dataset === 'sintetico' ? dataset : null;
  const datasetClause = safeDataset ? ` AND dataset = '${safeDataset}'` : '';
  const datasetClauseQualified = safeDataset ? ` AND accident_events.dataset = '${safeDataset}'` : '';

  const [totalsRows] = await connection.query(
    `
      SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'user') AS total_users,
        (SELECT COUNT(*) FROM users WHERE role = 'admin') AS total_admins,
        (SELECT COUNT(*) FROM activity_logs WHERE event_type = 'login') AS total_logins,
        (SELECT COUNT(*) FROM activity_logs WHERE event_type = 'page_visit') AS total_page_visits,
        (SELECT COUNT(*) FROM activity_logs WHERE event_type = 'prediction_query') AS total_prediction_queries,
        (SELECT COUNT(DISTINCT user_id) FROM activity_logs WHERE event_type = 'page_visit' AND user_id IS NOT NULL) AS unique_visitors,
        (SELECT COUNT(*) FROM citizen_reports WHERE status = 'nuevo') AS pending_reports,
        (
          SELECT COUNT(*)
          FROM citizen_reports
          WHERE status = 'validado'
            AND accepted_at IS NOT NULL
            AND DATE(accepted_at) = CURRENT_DATE()
        ) AS approved_reports_today
    `
  );

  const [todayRows] = await connection.query(
    `
      SELECT
        SUM(CASE WHEN event_type = 'login' THEN 1 ELSE 0 END) AS today_logins,
        SUM(CASE WHEN event_type = 'page_visit' THEN 1 ELSE 0 END) AS today_page_visits,
        SUM(CASE WHEN event_type = 'prediction_query' THEN 1 ELSE 0 END) AS today_prediction_queries
      FROM activity_logs
      WHERE DATE(created_at) = CURRENT_DATE()
    `
  );

  const [topQueryUsers] = await connection.query(
    `
      SELECT
        users.username,
        COUNT(*) AS total_queries
      FROM activity_logs
      INNER JOIN users ON users.id = activity_logs.user_id
      WHERE activity_logs.event_type = 'prediction_query'
      GROUP BY users.id, users.username
      ORDER BY total_queries DESC, users.username ASC
      LIMIT 5
    `
  );

  const [dailyRows] = await connection.query(
    `
      SELECT
        DATE(created_at) AS day,
        SUM(CASE WHEN event_type = 'page_visit' THEN 1 ELSE 0 END) AS page_visits,
        SUM(CASE WHEN event_type = 'prediction_query' THEN 1 ELSE 0 END) AS prediction_queries
      FROM activity_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      ORDER BY day DESC
    `
  );

  const [accidentTotalsRows] = await connection.query(
    `
      SELECT
        COUNT(*) AS total_accidents,
        SUM(CASE WHEN severity = 'fatal' THEN 1 ELSE 0 END) AS total_fatalities,
        SUM(CASE WHEN occurred_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS accidents_last_30d,
        SUM(
          CASE
            WHEN occurred_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND severity = 'fatal' THEN 1
            ELSE 0
          END
        ) AS fatalities_last_30d,
        SUM(CASE WHEN source_system LIKE 'seed_%' THEN 1 ELSE 0 END) AS simulated_count,
        SUM(CASE WHEN source_system LIKE 'user_report%' THEN 1 ELSE 0 END) AS citizen_count,
        SUM(
          CASE
            WHEN source_system IS NULL
              OR (source_system NOT LIKE 'seed_%' AND source_system NOT LIKE 'user_report%') THEN 1
            ELSE 0
          END
        ) AS original_count,
        SUM(CASE WHEN weather <> 'desconocido' THEN 1 ELSE 0 END) AS weather_annotated,
        SUM(CASE WHEN period <> 'desconocido' THEN 1 ELSE 0 END) AS period_annotated,
        SUM(CASE WHEN road_segment_id IS NOT NULL THEN 1 ELSE 0 END) AS linked_segments
      FROM accident_events
      WHERE city_id = (SELECT id FROM cities WHERE city_key = 'villavicencio' LIMIT 1)${datasetClause}
    `
  );

  const [severityRows] = await connection.query(
    `
      SELECT severity, COUNT(*) AS total
      FROM accident_events
      WHERE city_id = (SELECT id FROM cities WHERE city_key = 'villavicencio' LIMIT 1)${datasetClause}
      GROUP BY severity
    `
  );

  const [weatherRows] = await connection.query(
    `
      SELECT weather, COUNT(*) AS total
      FROM accident_events
      WHERE city_id = (SELECT id FROM cities WHERE city_key = 'villavicencio' LIMIT 1)${datasetClause}
      GROUP BY weather
    `
  );

  const [periodRows] = await connection.query(
    `
      SELECT period, COUNT(*) AS total
      FROM accident_events
      WHERE city_id = (SELECT id FROM cities WHERE city_key = 'villavicencio' LIMIT 1)${datasetClause}
      GROUP BY period
    `
  );

  const [monthlyRows] = await connection.query(
    `
      SELECT
        DATE_FORMAT(occurred_at, '%Y-%m') AS month_key,
        COUNT(*) AS total,
        SUM(CASE WHEN severity = 'fatal' THEN 1 ELSE 0 END) AS fatal_count
      FROM accident_events
      WHERE city_id = (SELECT id FROM cities WHERE city_key = 'villavicencio' LIMIT 1)${datasetClause}
        AND occurred_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
      GROUP BY DATE_FORMAT(occurred_at, '%Y-%m')
      ORDER BY month_key ASC
    `
  );

  const [topSegmentsRows] = await connection.query(
    `
      SELECT
        road_segments.name,
        road_segments.highway_type,
        road_segments.centroid_latitude,
        road_segments.centroid_longitude,
        COUNT(*) AS total,
        SUM(CASE WHEN accident_events.severity = 'fatal' THEN 1 ELSE 0 END) AS fatal_count,
        AVG(
          CASE accident_events.severity
            WHEN 'fatal' THEN 1
            WHEN 'alta' THEN 0.76
            WHEN 'media' THEN 0.48
            ELSE 0.24
          END
        ) AS weighted_risk
      FROM accident_events
      INNER JOIN road_segments ON road_segments.id = accident_events.road_segment_id
      WHERE accident_events.city_id = (SELECT id FROM cities WHERE city_key = 'villavicencio' LIMIT 1)${datasetClauseQualified}
      GROUP BY
        road_segments.id,
        road_segments.name,
        road_segments.highway_type,
        road_segments.centroid_latitude,
        road_segments.centroid_longitude
      ORDER BY total DESC, weighted_risk DESC
      LIMIT 8
    `
  );

  // Puntos para el mapa de calor: accidentes reales agregados en bins de ~110 m
  // (redondeo a 3 decimales) con intensidad ponderada por gravedad.
  const [heatmapRows] = await connection.query(
    `
      SELECT
        ROUND(latitude, 3) AS lat,
        ROUND(longitude, 3) AS lng,
        COUNT(*) AS total,
        SUM(CASE WHEN severity = 'baja' THEN 1 ELSE 0 END) AS baja,
        SUM(CASE WHEN severity = 'media' THEN 1 ELSE 0 END) AS media,
        SUM(CASE WHEN severity = 'alta' THEN 1 ELSE 0 END) AS alta,
        SUM(CASE WHEN severity = 'fatal' THEN 1 ELSE 0 END) AS fatal,
        SUM(
          CASE severity
            WHEN 'fatal' THEN 4
            WHEN 'alta' THEN 3
            WHEN 'media' THEN 2
            ELSE 1
          END
        ) AS weight
      FROM accident_events
      WHERE city_id = (SELECT id FROM cities WHERE city_key = 'villavicencio' LIMIT 1)${datasetClause}
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      ORDER BY weight DESC
      LIMIT 1200
    `
  );

  const [cityCenterRows] = await connection.query(
    `
      SELECT center_latitude, center_longitude, zoom_level
      FROM cities
      WHERE city_key = 'villavicencio'
      LIMIT 1
    `
  );

  const totals = totalsRows[0] || {};
  const today = todayRows[0] || {};
  const accidentTotals = accidentTotalsRows[0] || {};

  const maxHeatWeight = heatmapRows.reduce(
    (max, row) => Math.max(max, Number(row.weight) || 0),
    0
  );
  const heatmapPoints = heatmapRows.map((row) => ({
    lat: Number(row.lat),
    lng: Number(row.lng),
    count: Number(row.total) || 0,
    baja: Number(row.baja) || 0,
    media: Number(row.media) || 0,
    alta: Number(row.alta) || 0,
    fatal: Number(row.fatal) || 0,
    intensity: maxHeatWeight > 0 ? Number((Number(row.weight) / maxHeatWeight).toFixed(4)) : 0
  }));
  const cityCenterRow = cityCenterRows[0] || null;

  const totalAccidents = Number(accidentTotals.total_accidents || 0);
  const totalFatalities = Number(accidentTotals.total_fatalities || 0);
  const simulatedCount = Number(accidentTotals.simulated_count || 0);
  const citizenCount = Number(accidentTotals.citizen_count || 0);
  const originalCount = Number(accidentTotals.original_count || 0);

  const weatherAnnotated = Number(accidentTotals.weather_annotated || 0);
  const periodAnnotated = Number(accidentTotals.period_annotated || 0);
  const linkedSegments = Number(accidentTotals.linked_segments || 0);

  const completenessWeather = totalAccidents ? weatherAnnotated / totalAccidents : 0;
  const completenessPeriod = totalAccidents ? periodAnnotated / totalAccidents : 0;
  const linkageCoverage = totalAccidents ? linkedSegments / totalAccidents : 0;
  const observedShare = totalAccidents ? (originalCount + citizenCount) / totalAccidents : 0;

  const dataConfidence = Math.min(
    100,
    Math.round(
      observedShare * 70 +
        ((completenessWeather + completenessPeriod + linkageCoverage) / 3) * 30
    )
  );

  const toPct = (value) => Number((Math.max(0, Math.min(1, value)) * 100).toFixed(1));

  const severityMap = severityRows.reduce(
    (accumulator, row) => ({
      ...accumulator,
      [row.severity]: Number(row.total || 0)
    }),
    {
      baja: 0,
      media: 0,
      alta: 0,
      fatal: 0
    }
  );

  const weatherMap = weatherRows.reduce(
    (accumulator, row) => ({
      ...accumulator,
      [row.weather]: Number(row.total || 0)
    }),
    {
      lluvia: 0,
      no_lluvia: 0,
      desconocido: 0
    }
  );

  const periodMap = periodRows.reduce(
    (accumulator, row) => ({
      ...accumulator,
      [row.period]: Number(row.total || 0)
    }),
    {
      dia: 0,
      noche: 0,
      desconocido: 0
    }
  );

  const monthlySeries = monthlyRows.map((row) => ({
    month: row.month_key,
    total: Number(row.total || 0),
    fatalities: Number(row.fatal_count || 0)
  }));

  const averageMonthlyAccidents = monthlySeries.length
    ? Number(
        (
          monthlySeries.reduce((sum, row) => sum + row.total, 0) / monthlySeries.length
        ).toFixed(1)
      )
    : 0;

  const peakMonth = monthlySeries.reduce(
    (best, row) => (row.total > best.total ? row : best),
    { month: '', total: 0, fatalities: 0 }
  );

  return {
    totals: {
      totalUsers: Number(totals.total_users || 0),
      totalAdmins: Number(totals.total_admins || 0),
      totalLogins: Number(totals.total_logins || 0),
      totalPageVisits: Number(totals.total_page_visits || 0),
      totalPredictionQueries: Number(totals.total_prediction_queries || 0),
      uniqueVisitors: Number(totals.unique_visitors || 0),
      pendingReports: Number(totals.pending_reports || 0),
      approvedReportsToday: Number(totals.approved_reports_today || 0)
    },
    today: {
      logins: Number(today.today_logins || 0),
      pageVisits: Number(today.today_page_visits || 0),
      predictionQueries: Number(today.today_prediction_queries || 0)
    },
    topQueryUsers: topQueryUsers.map((row) => ({
      username: row.username,
      totalQueries: Number(row.total_queries || 0)
    })),
    daily: dailyRows.map((row) => ({
      day: row.day,
      pageVisits: Number(row.page_visits || 0),
      predictionQueries: Number(row.prediction_queries || 0)
    })),
    accidents: {
      cityKey: 'villavicencio',
      dataset: safeDataset || 'mixto',
      totals: {
        total: totalAccidents,
        fatalities: totalFatalities,
        accidentsLast30d: Number(accidentTotals.accidents_last_30d || 0),
        fatalitiesLast30d: Number(accidentTotals.fatalities_last_30d || 0),
        fatalityRatePct: toPct(totalAccidents ? totalFatalities / totalAccidents : 0),
        averageMonthlyAccidents,
        peakMonth
      },
      sourceBreakdown: {
        original: originalCount,
        simulated: simulatedCount,
        citizen: citizenCount,
        originalPct: toPct(totalAccidents ? originalCount / totalAccidents : 0),
        simulatedPct: toPct(totalAccidents ? simulatedCount / totalAccidents : 0),
        citizenPct: toPct(totalAccidents ? citizenCount / totalAccidents : 0)
      },
      quality: {
        dataConfidence,
        coverage: {
          weatherPct: toPct(completenessWeather),
          periodPct: toPct(completenessPeriod),
          linkedRoadSegmentPct: toPct(linkageCoverage)
        }
      },
      severityBreakdown: severityMap,
      weatherBreakdown: weatherMap,
      periodBreakdown: periodMap,
      monthlySeries,
      topRiskRoads: topSegmentsRows.map((row) => ({
        name: row.name,
        highwayType: row.highway_type || 'N/D',
        latitude: Number(row.centroid_latitude),
        longitude: Number(row.centroid_longitude),
        total: Number(row.total || 0),
        fatalities: Number(row.fatal_count || 0),
        weightedRisk: Number(Number(row.weighted_risk || 0).toFixed(3))
      })),
      heatmap: {
        center: cityCenterRow
          ? {
              latitude: Number(cityCenterRow.center_latitude),
              longitude: Number(cityCenterRow.center_longitude)
            }
          : null,
        zoom: cityCenterRow ? Number(cityCenterRow.zoom_level) || 12 : 12,
        maxWeight: maxHeatWeight,
        points: heatmapPoints
      }
    }
  };
};

export { createActivityLog, getDashboardSummary };
