import { v4 as uuidv4 } from 'uuid';
import { pool, withTransaction } from '../db/mysqlPool.js';
import {
  insertPendingReport,
  listApprovedTodayReports
} from '../models/reportModel.js';
import {
  deleteEvidenceFileIfExists,
  ReportEvidenceError,
  saveEvidenceDataUrl
} from '../services/reportEvidenceService.js';

const allowedSeverities = new Set(['baja', 'media', 'alta']);

const getApprovedReportsForToday = async (req, res) => {
  try {
    const connection = await pool.getConnection();
    try {
      const reports = await listApprovedTodayReports(connection);
      return res.json({ data: reports });
    } finally {
      connection.release();
    }
  } catch {
    return res.status(500).json({ message: 'No se pudieron obtener los reportes aprobados.' });
  }
};

const createReportRequest = async (req, res) => {
  const description = String(req.body?.description || '').trim();
  const severity = String(req.body?.severity || 'media').trim().toLowerCase();
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const evidenceImageDataUrl = String(req.body?.evidenceImageDataUrl || '').trim();

  if (!description) {
    return res.status(400).json({ message: 'La descripcion es obligatoria.' });
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ message: 'Debes seleccionar un punto valido en el mapa.' });
  }
  if (!allowedSeverities.has(severity)) {
    return res.status(400).json({ message: 'Severidad invalida.' });
  }

  let savedEvidence = null;
  try {
    savedEvidence = await saveEvidenceDataUrl(evidenceImageDataUrl);

    const reportId = uuidv4();
    const sourceSystem = 'user_report_pending_v2';
    await withTransaction(async (connection) => {
      await insertPendingReport(connection, {
        id: reportId,
        description,
        severity,
        latitude,
        longitude,
        cityId: null,
        sourceSystem,
        evidenceUrl: savedEvidence.relativeUrl,
        reportedByUserId: req.authUser?.id || null
      });
    });

    return res.status(201).json({
      id: reportId,
      status: 'nuevo',
      message: 'Solicitud enviada. Un administrador debe aprobarla para publicarla en el mapa.',
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    await deleteEvidenceFileIfExists(savedEvidence?.absolutePath);
    if (error instanceof ReportEvidenceError) {
      return res.status(error.status).json({ message: error.message });
    }
    return res.status(500).json({ message: 'No se pudo registrar la solicitud de reporte.' });
  }
};

export { createReportRequest, getApprovedReportsForToday };
