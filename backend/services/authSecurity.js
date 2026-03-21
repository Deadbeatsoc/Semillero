import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

const PASSWORD_KEY_LENGTH = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SESSION_TOKEN_BYTES = 48;
const SESSION_DURATION_HOURS = Number.parseInt(process.env.AUTH_SESSION_HOURS || '12', 10);

const normalizeUsername = (username) =>
  String(username || '')
    .trim()
    .toLowerCase();

const assertValidUsername = (username) => {
  if (!username || username.length < 3 || username.length > 40) {
    return 'El usuario debe tener entre 3 y 40 caracteres.';
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return 'El usuario solo puede contener letras minusculas, numeros, punto, guion y guion bajo.';
  }
  return '';
};

const assertValidPassword = (password) => {
  const safePassword = String(password || '');
  if (safePassword.length < 8 || safePassword.length > 80) {
    return 'La contrasena debe tener entre 8 y 80 caracteres.';
  }
  return '';
};

const hashPassword = (password) => {
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(password, salt, PASSWORD_KEY_LENGTH, {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION
  }).toString('hex');
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt}$${digest}`;
};

const verifyPassword = (password, storedHash) => {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }

  const [, costRaw, blockSizeRaw, parallelizationRaw, salt, expectedDigestHex] = parts;
  const cost = Number.parseInt(costRaw, 10);
  const blockSize = Number.parseInt(blockSizeRaw, 10);
  const parallelization = Number.parseInt(parallelizationRaw, 10);

  if (!Number.isFinite(cost) || !Number.isFinite(blockSize) || !Number.isFinite(parallelization)) {
    return false;
  }

  const computedDigestHex = scryptSync(password, salt, PASSWORD_KEY_LENGTH, {
    cost,
    blockSize,
    parallelization
  }).toString('hex');

  const expectedBuffer = Buffer.from(expectedDigestHex, 'hex');
  const computedBuffer = Buffer.from(computedDigestHex, 'hex');

  if (expectedBuffer.length !== computedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, computedBuffer);
};

const createSessionToken = () => randomBytes(SESSION_TOKEN_BYTES).toString('hex');

const hashSessionToken = (token) => createHash('sha256').update(String(token || '')).digest('hex');

const buildSessionExpirationDate = () => {
  const safeHours = Number.isFinite(SESSION_DURATION_HOURS) && SESSION_DURATION_HOURS > 0
    ? SESSION_DURATION_HOURS
    : 12;
  return new Date(Date.now() + safeHours * 60 * 60 * 1000);
};

const toMySqlDateTime = (value) => new Date(value).toISOString().slice(0, 19).replace('T', ' ');

const generateVerificationCode = () => String(randomInt(100000, 1000000));

const sanitizeUser = (userRow) => ({
  id: Number(userRow.id),
  username: userRow.username,
  role: userRow.role
});

export {
  assertValidPassword,
  assertValidUsername,
  buildSessionExpirationDate,
  createSessionToken,
  generateVerificationCode,
  hashPassword,
  hashSessionToken,
  normalizeUsername,
  sanitizeUser,
  toMySqlDateTime,
  verifyPassword
};
