import mysql from 'mysql2/promise';
import { mysqlConfig, getSafeDatabaseName } from './mysqlConfig.js';

const pool = mysql.createPool({
  host: mysqlConfig.host,
  port: mysqlConfig.port,
  user: mysqlConfig.user,
  password: mysqlConfig.password,
  database: getSafeDatabaseName(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true
});

const withTransaction = async (work) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Si falla rollback, dejamos que el error original se propague.
    }
    throw error;
  } finally {
    connection.release();
  }
};

export { pool, withTransaction };
