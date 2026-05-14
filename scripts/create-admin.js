const { Pool, Client } = require('pg');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

function getConnectionConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  const dbName = process.env.DB_NAME || 'verified_rental';
  if (databaseUrl) {
    const url = new URL(databaseUrl);
    return {
      host: url.hostname,
      port: url.port || 5432,
      user: url.username,
      password: url.password,
      database: url.pathname ? url.pathname.slice(1) : dbName
    };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: dbName
  };
}

(async () => {
  try {
    const connectionConfig = getConnectionConfig();

    // 1. Connect WITHOUT database (for initial setup)
    const client = new Client({
      host: connectionConfig.host,
      user: connectionConfig.user,
      password: connectionConfig.password,
      port: connectionConfig.port,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    await client.connect();

    // 2. Create database if needed
    try {
      await client.query(`CREATE DATABASE ${connectionConfig.database}`);
    } catch (error) {
     if (
  !error.message.includes('already exists') &&
  !error.message.includes('permission denied')
) {
  throw error;
}
    }
    await client.end();

    // 3. Connect to the actual database
    const dbClient = new Client({
      host: connectionConfig.host,
      user: connectionConfig.user,
      password: connectionConfig.password,
      database: connectionConfig.database,
      port: connectionConfig.port,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    await dbClient.connect();

    // 4. Run schema.sql
    const schema = fs.readFileSync(path.join(__dirname, '..', 'models', 'schema.sql'), 'utf8');
    await dbClient.query(schema);
    await dbClient.end();

    // 5. Create pool for admin creation
    const pool = new Pool({
      host: connectionConfig.host,
      user: connectionConfig.user,
      password: connectionConfig.password,
      database: connectionConfig.database,
      port: connectionConfig.port,
      max: 10,
      idleTimeoutMillis: 30000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    const adminEmail = 'admin@example.com';
    const adminPassword = 'Admin1234';
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    if (existing.rows.length === 0) {
      const hash = await bcrypt.hash(adminPassword, 10);
      await pool.query(
        'INSERT INTO users (name, email, phone, password, role, national_id, verified, broker_verified, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)',
        ['Admin User', adminEmail, '0911000002', hash, 'admin', null, true, false]
      );
      console.log('Admin user created:', adminEmail, 'password:', adminPassword);
    } else {
      console.log('Admin user already exists:', adminEmail);
    }

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Failed to create admin user:', error.message);
    process.exit(1);
  }
})();
