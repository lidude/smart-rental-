const fs = require('fs');
const path = require('path');
const { Pool, Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
const dbName = process.env.DB_NAME || process.env.PGDATABASE || 'verified_rental';
let pool;

function getConnectionConfig() {
  if (databaseUrl) {
    return { connectionString: databaseUrl };
  }

  const config = {
    host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
    port: process.env.DB_PORT || process.env.PGPORT || 5432,
    user: process.env.DB_USER || process.env.PGUSER || 'postgres',
    database: dbName
  };

  if (process.env.DB_PASSWORD || process.env.PGPASSWORD) {
    config.password = process.env.DB_PASSWORD || process.env.PGPASSWORD;
  }

  return config;
}

async function initDatabase() {
  const connectionConfig = getConnectionConfig();
  const sslConfig = process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;

  // 1. Connect WITHOUT database first when creating a local DB.
  //    For DATABASE_URL, we assume the target database already exists.
  let clientConfig = connectionConfig;
  let shouldCreateDatabase = false;

  if (!databaseUrl) {
    clientConfig = { ...connectionConfig, database: 'postgres' };
    shouldCreateDatabase = true;
  }

  const client = new Client({
    ...clientConfig,
    ssl: sslConfig
  });

  await client.connect();

  // 2. Create database if needed (safe to run multiple times)
  if (shouldCreateDatabase) {
    try {
      await client.query(`CREATE DATABASE ${connectionConfig.database}`);
    } catch (error) {
      if (
  !error.message.includes('already exists') &&
  !error.message.includes('permission denied')
) {
  await client.end();
  throw error;
}
    }
  }

  await client.end();

  // 3. Connect to the actual database
  const dbClient = new Client({
    ...connectionConfig,
    ssl: sslConfig
  });

  await dbClient.connect();

  // 4. Run schema.sql
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'models', 'schema.sql'), 'utf8');
  await dbClient.query(schemaSql);
  await dbClient.end();

  // 5. Create pool (MAIN connection used by app)
  pool = new Pool({
    ...connectionConfig,
    max: 10,
    idleTimeoutMillis: 30000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
}

function getPool() {
  if (!pool) {
    throw new Error('Database has not been initialized. Call initDatabase() first.');
  }
  return pool;
}

module.exports = { initDatabase, getPool };
