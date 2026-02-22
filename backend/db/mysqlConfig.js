const toPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const dbName = process.env.DB_NAME || 'movilidad';

const mysqlConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: toPositiveInteger(process.env.DB_PORT, 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: dbName,
  charset: process.env.DB_CHARSET || 'utf8mb4',
  collation: process.env.DB_COLLATION || 'utf8mb4_unicode_ci'
};

const assertSafeIdentifier = (value, fieldName) => {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw new Error(
      `Valor invalido para ${fieldName}: "${value}". Usa solo letras, numeros y guion bajo.`
    );
  }
};

const getSafeDatabaseName = () => {
  assertSafeIdentifier(mysqlConfig.database, 'DB_NAME');
  return mysqlConfig.database;
};

export { mysqlConfig, getSafeDatabaseName };
