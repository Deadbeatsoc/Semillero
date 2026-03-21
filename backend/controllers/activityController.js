import { pool } from '../db/mysqlPool.js';
import { createActivityLog } from '../models/activityModel.js';

const registerPageVisit = async (req, res) => {
  try {
    const connection = await pool.getConnection();
    try {
      await createActivityLog(connection, {
        userId: req.authUser.id,
        eventType: 'page_visit',
        eventData: {
          source: req.body?.source || 'app'
        }
      });
    } finally {
      connection.release();
    }
    return res.status(201).json({ ok: true });
  } catch {
    return res.status(500).json({ message: 'No se pudo registrar el ingreso al sistema.' });
  }
};

export { registerPageVisit };
