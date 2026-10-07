/**
 * Database Service
 *
 * PostgreSQL connection pool management for multi-tenant architecture.
 * In single-tenant mode, database is disabled and all operations are no-ops or throw errors.
 *
 * Schema:
 * - tenants table: one row per (tenant_url, team_name) combination
 * - tenant_configs: key-value config storage per tenant
 * - session_indices: cached session data per tenant
 */

const { Pool } = require('pg');
const { getLogger } = require('../config/logger');

let pool = null;
let databaseEnabled = false;
const logger = getLogger();

/**
 * Check if database is enabled
 * @returns {boolean} True if database is enabled
 */
function isDatabaseEnabled() {
  return databaseEnabled;
}

/**
 * Initialize database connection pool
 * @param {Object} config - Application configuration with database settings
 * @returns {Pool|null} PostgreSQL connection pool or null if database disabled
 */
function initDatabase(config) {
  // Skip database initialization in single-tenant mode
  if (!config.app.isMultitenant) {
    databaseEnabled = false;
    logger.info('Database disabled (single-tenant mode)');
    return null;
  }

  if (pool) return pool;

  if (!config.database) {
    throw new Error('Database configuration missing for multi-tenant mode');
  }

  databaseEnabled = true;

  pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    logger.error('Unexpected database pool error', { error: err.message });
  });

  pool.on('connect', () => {
    logger.debug('New database connection established');
  });

  logger.info('Database connection pool initialized', {
    host: config.database.host,
    database: config.database.name,
  });

  return pool;
}

/**
 * Get database pool
 * @returns {Pool} PostgreSQL connection pool
 * @throws {Error} If pool not initialized or database disabled
 */
function getPool() {
  if (!databaseEnabled) {
    throw new Error('Database is disabled in single-tenant mode');
  }
  if (!pool) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return pool;
}

/**
 * Get database pool for session store (non-throwing version)
 * Returns null if database is disabled or not initialized
 * @returns {Pool|null} PostgreSQL connection pool or null
 */
function getPoolForSessionStore() {
  if (!databaseEnabled || !pool) {
    return null;
  }
  return pool;
}

/**
 * Execute a query with logging and automatic retry on connection errors
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @param {number} retries - Maximum number of retries for connection errors
 * @returns {Promise<Object>} Query result
 * @throws {Error} If database is disabled or query fails after retries
 */
async function query(text, params, retries = 1) {
  if (!databaseEnabled) {
    throw new Error('Database is disabled in single-tenant mode. Database queries are not available.');
  }

  const start = Date.now();
  const maxRetries = retries;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await pool.query(text, params);
      const duration = Date.now() - start;

      if (attempt > 0) {
        logger.info('Database query succeeded after retry', {
          duration,
          rows: result.rowCount,
          attempt,
        });
      } else {
        logger.debug('Database query executed', {
          duration,
          rows: result.rowCount,
        });
      }

      return result;
    } catch (error) {
      lastError = error;

      // Check if this is a connection-related error that we should retry
      const isConnectionError =
        error.message?.includes('Connection terminated') ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('ECONNREFUSED') ||
        error.code === '57P01' ||  // admin_shutdown
        error.code === '57P02' ||  // crash_shutdown
        error.code === '57P03';    // cannot_connect_now

      if (isConnectionError && attempt < maxRetries) {
        const duration = Date.now() - start;
        logger.warn('Database connection error, retrying', {
          duration,
          error: error.message,
          code: error.code,
          attempt: attempt + 1,
          maxRetries,
        });
        // Exponential backoff delay
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        continue;
      }

      // Not a connection error, or out of retries
      const duration = Date.now() - start;
      logger.error('Database query failed', {
        duration,
        error: error.message,
        code: error.code,
        query: text.substring(0, 100),
        attempts: attempt + 1,
      });
      throw error;
    }
  }

  throw lastError;
}

/**
 * Ensure required tables exist
 * Creates tables if they don't exist
 * No-op if database is disabled
 */
async function ensureTables() {
  if (!databaseEnabled) {
    logger.debug('Skipping table creation (database disabled)');
    return;
  }

  try {
    const createTablesSQL = `
      -- Tenants table (one row per team configuration)
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_url VARCHAR(255) NOT NULL,
        team_name VARCHAR(255) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_url, team_name)
      );

      CREATE INDEX IF NOT EXISTS idx_tenants_lookup ON tenants(tenant_url, team_name);
      CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(is_active);

      -- Tenant configurations (key-value store, per tenant)
      CREATE TABLE IF NOT EXISTS tenant_configs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        config_key VARCHAR(255) NOT NULL,
        config_value TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, config_key)
      );

      CREATE INDEX IF NOT EXISTS idx_tenant_configs_lookup ON tenant_configs(tenant_id, config_key);

      -- Session index cache (per-tenant JSONB storage)
      CREATE TABLE IF NOT EXISTS session_indices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        session_type VARCHAR(10) NOT NULL,
        index_data JSONB NOT NULL,
        session_count INTEGER DEFAULT 0,
        last_refreshed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, session_type)
      );

      CREATE INDEX IF NOT EXISTS idx_session_indices_lookup ON session_indices(tenant_id, session_type);
    `;

    await query(createTablesSQL, []);
    logger.info('Database tables ensured');
  } catch (error) {
    logger.error('Failed to ensure database tables', { error: error.message });
    throw error;
  }
}

/**
 * Close database connections gracefully
 * No-op if database is disabled
 */
async function closeDatabase() {
  if (!databaseEnabled) {
    logger.debug('Skipping database close (database disabled)');
    return;
  }

  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database connection pool closed');
  }
}

/**
 * Health check for database connection
 * @returns {Promise<Object>} Health status
 */
async function checkHealth() {
  if (!databaseEnabled) {
    return { status: 'disabled', connected: false, message: 'Database disabled in single-tenant mode' };
  }

  try {
    const result = await query('SELECT 1', []);
    return { status: 'ok', connected: true };
  } catch (error) {
    return { status: 'error', connected: false, error: error.message };
  }
}

module.exports = {
  initDatabase,
  isDatabaseEnabled,
  getPool,
  getPoolForSessionStore,
  query,
  ensureTables,
  closeDatabase,
  checkHealth,
};
