import { pool, withTransaction } from '../db/mysqlPool.js';
import { getDashboardSummary } from '../models/activityModel.js';
import {
  createRegistrationCode,
  deactivateActiveRegistrationCodes,
  getActiveRegistrationCode
} from '../models/authModel.js';
import { generateVerificationCode, toMySqlDateTime } from '../services/authSecurity.js';
import { getCityModelInsights } from '../services/localPredictionEngine.js';

const DATASET_VALUES = new Set(['mixto', 'real', 'sintetico']);

const getDashboard = async (req, res) => {
  try {
    const requestedDataset = String(req.query?.dataset || 'mixto').trim().toLowerCase();
    const dataset = DATASET_VALUES.has(requestedDataset) ? requestedDataset : 'mixto';

    const connection = await pool.getConnection();
    let summary;
    try {
      summary = await getDashboardSummary(connection, { dataset });
    } finally {
      connection.release();
    }

    // Desempeno del modelo de prediccion (fuente de datos + metricas honestas).
    let model = null;
    try {
      model = await getCityModelInsights(summary?.accidents?.cityKey || 'villavicencio', dataset);
    } catch {
      model = null;
    }

    return res.json({
      data: { ...summary, model },
      meta: {
        generatedAt: new Date().toISOString(),
        generatedBy: req.authUser.username
      }
    });
  } catch {
    return res.status(500).json({ message: 'No se pudo cargar el dashboard administrativo.' });
  }
};

const getVerificationCode = async (req, res) => {
  try {
    const connection = await pool.getConnection();
    try {
      const activeCode = await getActiveRegistrationCode(connection);
      if (!activeCode) {
        return res.status(404).json({ message: 'No hay codigo de verificacion activo.' });
      }

      return res.json({
        data: {
          code: String(activeCode.code_value),
          createdAt: activeCode.created_at,
          generatedBy: activeCode.generated_by || 'sistema'
        }
      });
    } finally {
      connection.release();
    }
  } catch {
    return res.status(500).json({ message: 'No se pudo obtener el codigo de verificacion.' });
  }
};

const regenerateVerificationCode = async (req, res) => {
  try {
    const newCode = generateVerificationCode();

    const payload = await withTransaction(async (connection) => {
      const nowDateTime = toMySqlDateTime(new Date());
      await deactivateActiveRegistrationCodes(connection, nowDateTime);
      await createRegistrationCode(connection, {
        codeValue: newCode,
        generatedByUserId: req.authUser.id
      });

      return {
        code: newCode,
        createdAt: new Date().toISOString(),
        generatedBy: req.authUser.username
      };
    });

    return res.status(201).json({ data: payload });
  } catch {
    return res.status(500).json({ message: 'No se pudo generar un nuevo codigo.' });
  }
};

export { getDashboard, getVerificationCode, regenerateVerificationCode };
