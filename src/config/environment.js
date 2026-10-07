const Joi = require('joi');

/**
 * Helper to check if MULTITENANT is enabled
 */
function isMultitenantValue(value) {
  return ['YES', 'yes', '1', 'TRUE', 'true'].includes(value);
}

// Values that indicate multi-tenant mode (for Joi.valid())
const MULTITENANT_VALUES = ['YES', 'yes', '1', 'TRUE', 'true'];

// Values that indicate single-tenant mode (for Joi.valid())
const SINGLE_TENANT_VALUES = ['NO', 'no', '0', 'FALSE', 'false', ''];

function normalizeDatabaseEnvironment(env) {
  const prefix = env.VERCEL_NEON_PREFIX || 'OPAFLIX';

  return {
    ...env,
    PGHOST: env.PGHOST || env[`${prefix}_PGHOST`],
    PGDATABASE: env.PGDATABASE || env[`${prefix}_PGDATABASE`],
    PGUSER: env.PGUSER || env[`${prefix}_PGUSER`],
    PGPASSWORD: env.PGPASSWORD || env[`${prefix}_PGPASSWORD`],
  };
}

const envSchema = Joi.object({
  // Mode selection
  MULTITENANT: Joi.string()
    .valid(...MULTITENANT_VALUES, ...SINGLE_TENANT_VALUES)
    .default('YES'),

  // Database (PostgreSQL) - required when MULTITENANT=YES
  PGHOST: Joi.string().when('MULTITENANT', {
    is: Joi.valid(...MULTITENANT_VALUES),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  PGPORT: Joi.number().default(5432),
  PGDATABASE: Joi.string().when('MULTITENANT', {
    is: Joi.valid(...MULTITENANT_VALUES),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  PGUSER: Joi.string().when('MULTITENANT', {
    is: Joi.valid(...MULTITENANT_VALUES),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  PGPASSWORD: Joi.string().when('MULTITENANT', {
    is: Joi.valid(...MULTITENANT_VALUES),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  PGSSLMODE: Joi.string().valid('require', 'prefer', 'disable').default('require'),

  // Single-tenant Okta config - required when MULTITENANT=NO
  OKTA_ISSUER: Joi.string().uri().when('MULTITENANT', {
    is: Joi.valid(...SINGLE_TENANT_VALUES),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  OKTA_CLIENT_ID: Joi.string().when('MULTITENANT', {
    is: Joi.valid(...SINGLE_TENANT_VALUES),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  OKTA_CLIENT_SECRET: Joi.string().when('MULTITENANT', {
    is: Joi.valid(...SINGLE_TENANT_VALUES),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  // Single-tenant AWS config
  // Either static credentials OR Roles Anywhere must be configured (validated separately)
  AWS_ACCESS_KEY_ID: Joi.string().optional().allow(''),
  AWS_SECRET_ACCESS_KEY: Joi.string().optional().allow(''),
  AWS_REGION: Joi.string().when('MULTITENANT', {
    is: Joi.valid(...SINGLE_TENANT_VALUES),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  AWS_S3_BUCKET: Joi.string().when('MULTITENANT', {
    is: Joi.valid(...SINGLE_TENANT_VALUES),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  AWS_S3_PREFIX: Joi.string().optional().allow(''),

  // Single-tenant IAM Roles Anywhere (alternative to static credentials)
  // When set, uses X.509 certificate to authenticate (no static AWS keys needed)
  AWS_ROLES_ANYWHERE_TRUST_ANCHOR_ARN: Joi.string().optional().allow(''),
  AWS_ROLES_ANYWHERE_PROFILE_ARN: Joi.string().optional().allow(''),
  AWS_ROLES_ANYWHERE_ROLE_ARN: Joi.string().optional().allow(''),
  AWS_ROLES_ANYWHERE_CERTIFICATE: Joi.string().optional().allow(''),
  AWS_ROLES_ANYWHERE_PRIVATE_KEY: Joi.string().optional().allow(''),

  // Single-tenant OPA config
  // OPA_TENANT_URL is the full OPA instance URL (e.g., "demo-blue-sky-1234.pam.okta.com")
  // OPA_TEAM_NAME is the team name within that OPA instance
  OPA_TENANT_URL: Joi.string()
    .pattern(/^[a-z0-9-]+\.pam\.(okta|oktapreview)\.com$/)
    .optional()
    .allow('')
    .description('OPA tenant URL (e.g., demo-blue-sky-1234.pam.okta.com)'),
  OPA_TEAM_NAME: Joi.string()
    .pattern(/^[a-z0-9-]+$/)
    .optional()
    .allow('')
    .description('Team name within the OPA tenant'),

  // OPA API credentials (optional, for graph visualization and filter prepopulation)
  OPA_API_KEY_ID: Joi.string().optional().allow(''),
  OPA_API_KEY_SECRET: Joi.string().optional().allow(''),

  // Application
  BASE_URI: Joi.string().uri().required(),
  SESSION_SECRET: Joi.string().min(32).required(),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),

  // Optional
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  FILE_SIZE_LIMIT_MB: Joi.number().default(500),

  // Multi-tenant cache config
  CONFIG_CACHE_TTL_MINUTES: Joi.number().default(5),
  SESSION_INDEX_REFRESH_MINUTES: Joi.number().default(15),
}).unknown(true);

function validateEnvironment() {
  const { error, value } = envSchema.validate(normalizeDatabaseEnvironment(process.env), {
    abortEarly: false,
    stripUnknown: false,
  });

  if (error) {
    const messages = error.details.map(d => `  - ${d.message}`).join('\n');
    throw new Error(`Environment validation failed:\n${messages}`);
  }

  // Additional validation for single-tenant mode: require either static credentials OR Roles Anywhere
  const isSingleTenant = SINGLE_TENANT_VALUES.includes(value.MULTITENANT);
  if (isSingleTenant) {
    const hasStaticCredentials = value.AWS_ACCESS_KEY_ID && value.AWS_SECRET_ACCESS_KEY;
    const hasRolesAnywhere = value.AWS_ROLES_ANYWHERE_TRUST_ANCHOR_ARN &&
                             value.AWS_ROLES_ANYWHERE_PROFILE_ARN &&
                             value.AWS_ROLES_ANYWHERE_ROLE_ARN &&
                             value.AWS_ROLES_ANYWHERE_CERTIFICATE &&
                             value.AWS_ROLES_ANYWHERE_PRIVATE_KEY;

    if (!hasStaticCredentials && !hasRolesAnywhere) {
      throw new Error(
        'AWS credentials not configured. Provide either:\n' +
        '  - Method 1: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or\n' +
        '  - Method 2: All IAM Roles Anywhere variables (AWS_ROLES_ANYWHERE_*)'
      );
    }
  }

  return value;
}

function getConfig() {
  const env = validateEnvironment();

  const isMultitenant = isMultitenantValue(env.MULTITENANT);

  // Build base config
  const config = {
    app: {
      baseUri: env.BASE_URI,
      sessionSecret: env.SESSION_SECRET,
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      isProduction: env.NODE_ENV === 'production',
      isMultitenant,
    },
    logging: {
      level: env.LOG_LEVEL,
    },
    file: {
      sizeLimitMB: env.FILE_SIZE_LIMIT_MB,
      sizeLimitBytes: env.FILE_SIZE_LIMIT_MB * 1024 * 1024,
      minFreeDiskMB: 100,
    },
    configCacheTtlMinutes: env.CONFIG_CACHE_TTL_MINUTES,
    sessionIndexRefreshMinutes: env.SESSION_INDEX_REFRESH_MINUTES,
  };

  // Add database config only when multi-tenant
  if (isMultitenant) {
    config.database = {
      host: env.PGHOST,
      port: env.PGPORT,
      name: env.PGDATABASE,
      user: env.PGUSER,
      password: env.PGPASSWORD,
      ssl: env.PGSSLMODE === 'require',
    };
  }

  // Add single-tenant config when not multi-tenant
  if (!isMultitenant) {
    config.singleTenantConfig = {
      tenantId: 'single-tenant-default',
      tenantUrl: env.OPA_TENANT_URL || '',
      teamName: env.OPA_TEAM_NAME || 'default',
      okta: {
        issuer: env.OKTA_ISSUER,
        clientId: env.OKTA_CLIENT_ID,
        clientSecret: env.OKTA_CLIENT_SECRET,
      },
      aws: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        region: env.AWS_REGION,
        bucket: env.AWS_S3_BUCKET,
        bucketPrefix: env.AWS_S3_PREFIX || '',
        // IAM Roles Anywhere (optional) - when set, uses X.509 certificate auth
        rolesAnywhereTrustAnchorArn: env.AWS_ROLES_ANYWHERE_TRUST_ANCHOR_ARN || '',
        rolesAnywhereProfileArn: env.AWS_ROLES_ANYWHERE_PROFILE_ARN || '',
        roleArn: env.AWS_ROLES_ANYWHERE_ROLE_ARN || '',
        rolesAnywhereCertificate: env.AWS_ROLES_ANYWHERE_CERTIFICATE || '',
        rolesAnywherePrivateKey: env.AWS_ROLES_ANYWHERE_PRIVATE_KEY || '',
      },
      opaApi: {
        // API credentials for graph visualization and filter prepopulation
        keyId: env.OPA_API_KEY_ID || '',
        keySecret: env.OPA_API_KEY_SECRET || '',
      },
    };
  }

  return config;
}

module.exports = { getConfig, validateEnvironment };
