import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { mysqlConfig, getSafeDatabaseName } from '../db/mysqlConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'db', 'migrations');

const assertSafeToken = (value, name) => {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw new Error(`Valor invalido para ${name}: "${value}"`);
  }
};

const loadMigrationFiles = async () => {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
};

const bootstrapDatabase = async () => {
  const dbName = getSafeDatabaseName();
  assertSafeToken(mysqlConfig.charset, 'DB_CHARSET');
  assertSafeToken(mysqlConfig.collation, 'DB_COLLATION');

  const connection = await mysql.createConnection({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    multipleStatements: true
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET ${mysqlConfig.charset} COLLATE ${mysqlConfig.collation}`
    );
  } finally {
    await connection.end();
  }
};

const ensureMigrationsTable = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL,
      executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_schema_migrations_filename (filename)
    ) ENGINE=InnoDB
      DEFAULT CHARSET=${mysqlConfig.charset}
      COLLATE=${mysqlConfig.collation}
  `);
};

const run = async () => {
  await bootstrapDatabase();

  const dbName = getSafeDatabaseName();
  const connection = await mysql.createConnection({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    database: dbName,
    multipleStatements: true
  });

  try {
    await ensureMigrationsTable(connection);

    const [appliedRows] = await connection.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedRows.map((row) => row.filename));
    const files = await loadMigrationFiles();

    if (files.length === 0) {
      // eslint-disable-next-line no-console
      console.log('No hay archivos de migracion en backend/db/migrations.');
      return;
    }

    for (const filename of files) {
      if (applied.has(filename)) {
        // eslint-disable-next-line no-console
        console.log(`- Omitida (ya aplicada): ${filename}`);
        continue;
      }

      const migrationPath = path.join(MIGRATIONS_DIR, filename);
      const sql = await fs.readFile(migrationPath, 'utf8');

      await connection.beginTransaction();
      try {
        await connection.query(sql);
        await connection.execute('INSERT INTO schema_migrations (filename) VALUES (?)', [filename]);
        await connection.commit();
        // eslint-disable-next-line no-console
        console.log(`- Aplicada: ${filename}`);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }

    // eslint-disable-next-line no-console
    console.log('Migraciones completadas correctamente.');
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Error ejecutando migraciones MySQL:', error.message);
  process.exit(1);
});
