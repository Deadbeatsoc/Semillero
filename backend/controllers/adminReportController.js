import { pool, withTransaction } from '../db/mysqlPool.js';
import {
  approvePendingReport,
  countPendingReports,
  listPendingReports
} from '../models/reportModel.js';
import { toMySqlDateTime } from '../services/authSecurity.js';

const getPendingReports = async (req, res) => {
  try {
    const connection = await pool.getConnection();
    try {
      const [pendingItems, pendingCount] = await Promise.all([
        listPendingReports(connection),
        countPendingReports(connection)
      ]);
      return res.json({
        data: {
          pendingCount,
          items: pendingItems
        }
      });
    } finally {
      connection.release();
    }
  } catch {
    return res.status(500).json({ message: 'No se pudieron cargar las solicitudes pendientes.' });
  }
};

const approveReportRequest = async (req, res) => {
  const reportId = String(req.params?.id || '').trim();
  if (!reportId) {
    return res.status(400).json({ message: 'Id de solicitud invalido.' });
  }

  try {
    const result = await withTransaction(async (connection) => {
      const approvedAtDateTime = toMySqlDateTime(new Date());
      const affectedRows = await approvePendingReport(connection, {
        reportId,
        acceptedByUserId: req.authUser.id,
        acceptedAtDateTime: approvedAtDateTime
      });

      if (!affectedRows) {
        return { approved: false };
      }

      const pendingCount = await countPendingReports(connection);
      return {
        approved: true,
        approvedAt: new Date().toISOString(),
        pendingCount
      };
    });

    if (!result.approved) {
      return res
        .status(404)
        .json({ message: 'La solicitud no existe o ya fue procesada.' });
    }

    return res.json({
      ok: true,
      approvedAt: result.approvedAt,
      pendingCount: result.pendingCount
    });
  } catch {
    return res.status(500).json({ message: 'No se pudo aprobar la solicitud.' });
  }
};

export { approveReportRequest, getPendingReports };
