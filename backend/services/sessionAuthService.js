import { pool } from '../db/mysqlPool.js';
import {
  deleteExpiredSessions,
  deleteSessionByTokenHash,
  findSessionByTokenHash,
  touchSession
} from '../models/authModel.js';
import { hashSessionToken, sanitizeUser, toMySqlDateTime } from './authSecurity.js';

class SessionAuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'SessionAuthError';
    this.status = status;
  }
}

const resolveAuthenticatedUser = async (plainToken, { touch = true } = {}) => {
  if (!plainToken || typeof plainToken !== 'string') {
    throw new SessionAuthError('Token de sesion faltante.', 401);
  }

  const tokenHash = hashSessionToken(plainToken);
  const now = new Date();
  const nowDateTime = toMySqlDateTime(now);

  const connection = await pool.getConnection();
  try {
    await deleteExpiredSessions(connection, nowDateTime);

    const session = await findSessionByTokenHash(connection, tokenHash);
    if (!session || !session.user_id || !session.is_active) {
      throw new SessionAuthError('Sesion invalida.', 401);
    }

    const expiresAt = new Date(session.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
      await deleteSessionByTokenHash(connection, tokenHash);
      throw new SessionAuthError('Sesion expirada.', 401);
    }

    if (touch) {
      await touchSession(connection, session.session_id, nowDateTime);
    }

    return {
      tokenHash,
      user: sanitizeUser({
        id: session.user_id,
        username: session.username,
        role: session.role
      })
    };
  } finally {
    connection.release();
  }
};

export { SessionAuthError, resolveAuthenticatedUser };
