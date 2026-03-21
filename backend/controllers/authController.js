import { pool, withTransaction } from '../db/mysqlPool.js';
import { createActivityLog } from '../models/activityModel.js';
import {
  createAuthSession,
  createUser,
  findUserById,
  findUserByUsername,
  getActiveRegistrationCode,
  updateUserLastLogin,
  deleteSessionByTokenHash
} from '../models/authModel.js';
import {
  assertValidPassword,
  assertValidUsername,
  buildSessionExpirationDate,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeUsername,
  sanitizeUser,
  toMySqlDateTime,
  verifyPassword
} from '../services/authSecurity.js';

class AuthControllerError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AuthControllerError';
    this.status = status;
  }
}

const buildAuthResponse = ({ token, expiresAt, user }) => ({
  token,
  expiresAt: new Date(expiresAt).toISOString(),
  user
});

const register = async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const verificationCode = String(req.body?.verificationCode || '').trim();

  const usernameError = assertValidUsername(username);
  if (usernameError) {
    return res.status(400).json({ message: usernameError });
  }

  const passwordError = assertValidPassword(password);
  if (passwordError) {
    return res.status(400).json({ message: passwordError });
  }

  if (!verificationCode) {
    return res.status(400).json({ message: 'Debes ingresar el codigo de verificacion.' });
  }

  try {
    const authPayload = await withTransaction(async (connection) => {
      const activeCode = await getActiveRegistrationCode(connection);
      if (!activeCode) {
        throw new AuthControllerError(
          'No hay codigo de verificacion activo. Contacta a un administrador.',
          403
        );
      }

      if (verificationCode !== String(activeCode.code_value)) {
        throw new AuthControllerError('Codigo de verificacion invalido.', 403);
      }

      const existingUser = await findUserByUsername(connection, username);
      if (existingUser) {
        throw new AuthControllerError('Ese usuario ya existe.', 409);
      }

      const passwordHash = hashPassword(password);
      const userId = await createUser(connection, {
        username,
        passwordHash,
        role: 'user'
      });

      const token = createSessionToken();
      const tokenHash = hashSessionToken(token);
      const expiresAt = buildSessionExpirationDate();
      const expiresAtDateTime = toMySqlDateTime(expiresAt);
      const nowDateTime = toMySqlDateTime(new Date());

      await createAuthSession(connection, {
        userId,
        tokenHash,
        expiresAt: expiresAtDateTime,
        lastUsedAt: nowDateTime
      });
      await updateUserLastLogin(connection, userId, nowDateTime);
      await createActivityLog(connection, {
        userId,
        eventType: 'login',
        eventData: { origin: 'register' }
      });

      const createdUser = await findUserById(connection, userId);
      return buildAuthResponse({
        token,
        expiresAt,
        user: sanitizeUser(createdUser)
      });
    });

    return res.status(201).json(authPayload);
  } catch (error) {
    if (error instanceof AuthControllerError) {
      return res.status(error.status).json({ message: error.message });
    }
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ese usuario ya existe.' });
    }
    return res.status(500).json({ message: 'No se pudo crear la cuenta.' });
  }
};

const login = async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({ message: 'Usuario y contrasena son obligatorios.' });
  }

  try {
    const authPayload = await withTransaction(async (connection) => {
      const user = await findUserByUsername(connection, username);
      if (!user || !user.is_active) {
        throw new AuthControllerError('Credenciales invalidas.', 401);
      }

      const isValidPassword = verifyPassword(password, user.password_hash);
      if (!isValidPassword) {
        throw new AuthControllerError('Credenciales invalidas.', 401);
      }

      const token = createSessionToken();
      const tokenHash = hashSessionToken(token);
      const expiresAt = buildSessionExpirationDate();
      const expiresAtDateTime = toMySqlDateTime(expiresAt);
      const nowDateTime = toMySqlDateTime(new Date());

      await createAuthSession(connection, {
        userId: user.id,
        tokenHash,
        expiresAt: expiresAtDateTime,
        lastUsedAt: nowDateTime
      });
      await updateUserLastLogin(connection, user.id, nowDateTime);
      await createActivityLog(connection, {
        userId: user.id,
        eventType: 'login',
        eventData: { origin: 'login' }
      });

      return buildAuthResponse({
        token,
        expiresAt,
        user: sanitizeUser(user)
      });
    });

    return res.json(authPayload);
  } catch (error) {
    if (error instanceof AuthControllerError) {
      return res.status(error.status).json({ message: error.message });
    }
    return res.status(500).json({ message: 'No se pudo iniciar sesion.' });
  }
};

const me = async (req, res) => {
  return res.json({ user: req.authUser });
};

const logout = async (req, res) => {
  try {
    const tokenHash = req.authTokenHash;
    if (!tokenHash) {
      return res.status(200).json({ ok: true });
    }

    const connection = await pool.getConnection();
    try {
      await deleteSessionByTokenHash(connection, tokenHash);
    } finally {
      connection.release();
    }
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ message: 'No se pudo cerrar sesion.' });
  }
};

export { login, logout, me, register };
