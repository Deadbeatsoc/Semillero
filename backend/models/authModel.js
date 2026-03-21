const findUserByUsername = async (connection, username) => {
  const [rows] = await connection.query(
    `
      SELECT
        id,
        username,
        password_hash,
        role,
        is_active,
        last_login_at
      FROM users
      WHERE username = ?
      LIMIT 1
    `,
    [username]
  );
  return rows[0] || null;
};

const findUserById = async (connection, id) => {
  const [rows] = await connection.query(
    `
      SELECT
        id,
        username,
        password_hash,
        role,
        is_active,
        last_login_at
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [id]
  );
  return rows[0] || null;
};

const countAdmins = async (connection) => {
  const [rows] = await connection.query(
    `
      SELECT COUNT(*) AS total
      FROM users
      WHERE role = 'admin'
    `
  );
  return Number(rows[0]?.total || 0);
};

const createUser = async (connection, { username, passwordHash, role }) => {
  const [result] = await connection.execute(
    `
      INSERT INTO users (username, password_hash, role)
      VALUES (?, ?, ?)
    `,
    [username, passwordHash, role]
  );
  return Number(result.insertId);
};

const updateUserLastLogin = async (connection, userId, loginDateTime) => {
  await connection.execute(
    `
      UPDATE users
      SET last_login_at = ?
      WHERE id = ?
    `,
    [loginDateTime, userId]
  );
};

const getActiveRegistrationCode = async (connection) => {
  const [rows] = await connection.query(
    `
      SELECT
        registration_codes.id,
        registration_codes.code_value,
        registration_codes.created_at,
        users.username AS generated_by
      FROM registration_codes
      LEFT JOIN users ON users.id = registration_codes.generated_by_user_id
      WHERE registration_codes.is_active = 1
      ORDER BY registration_codes.created_at DESC
      LIMIT 1
    `
  );
  return rows[0] || null;
};

const deactivateActiveRegistrationCodes = async (connection, replacedAt) => {
  await connection.execute(
    `
      UPDATE registration_codes
      SET is_active = 0,
          replaced_at = ?
      WHERE is_active = 1
    `,
    [replacedAt]
  );
};

const createRegistrationCode = async (connection, { codeValue, generatedByUserId }) => {
  const [result] = await connection.execute(
    `
      INSERT INTO registration_codes (code_value, generated_by_user_id, is_active)
      VALUES (?, ?, 1)
    `,
    [codeValue, generatedByUserId]
  );
  return Number(result.insertId);
};

const createAuthSession = async (connection, { userId, tokenHash, expiresAt, lastUsedAt }) => {
  const [result] = await connection.execute(
    `
      INSERT INTO auth_sessions (user_id, token_hash, expires_at, last_used_at)
      VALUES (?, ?, ?, ?)
    `,
    [userId, tokenHash, expiresAt, lastUsedAt]
  );
  return Number(result.insertId);
};

const findSessionByTokenHash = async (connection, tokenHash) => {
  const [rows] = await connection.query(
    `
      SELECT
        auth_sessions.id AS session_id,
        auth_sessions.user_id,
        auth_sessions.expires_at,
        users.username,
        users.role,
        users.is_active
      FROM auth_sessions
      INNER JOIN users ON users.id = auth_sessions.user_id
      WHERE auth_sessions.token_hash = ?
      LIMIT 1
    `,
    [tokenHash]
  );
  return rows[0] || null;
};

const touchSession = async (connection, sessionId, lastUsedAt) => {
  await connection.execute(
    `
      UPDATE auth_sessions
      SET last_used_at = ?
      WHERE id = ?
    `,
    [lastUsedAt, sessionId]
  );
};

const deleteSessionByTokenHash = async (connection, tokenHash) => {
  await connection.execute(
    `
      DELETE FROM auth_sessions
      WHERE token_hash = ?
    `,
    [tokenHash]
  );
};

const deleteExpiredSessions = async (connection, nowDateTime) => {
  await connection.execute(
    `
      DELETE FROM auth_sessions
      WHERE expires_at <= ?
    `,
    [nowDateTime]
  );
};

export {
  countAdmins,
  createAuthSession,
  createRegistrationCode,
  createUser,
  deactivateActiveRegistrationCodes,
  deleteExpiredSessions,
  deleteSessionByTokenHash,
  findSessionByTokenHash,
  findUserById,
  findUserByUsername,
  getActiveRegistrationCode,
  touchSession,
  updateUserLastLogin
};
