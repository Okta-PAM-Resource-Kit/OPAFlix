const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { SignatureV4 } = require('@smithy/signature-v4');
const { Sha256 } = require('@aws-crypto/sha256-js');
const crypto = require('crypto');
const { mapS3Error } = require('../utils/errorMessages');
const { AppError } = require('../middleware/errorHandler');
const { S3_PREFIXES, FILE_EXTENSIONS } = require('../config/constants');
const { getLogger } = require('../config/logger');
const logger = getLogger();

// Default presigned URL expiration (4 hours)
const PRESIGNED_URL_EXPIRES_IN = 4 * 60 * 60;

// Credential cache for Roles Anywhere
// Stores: { credentials, expiration }
const credentialCache = new Map();

// Refresh credentials 5 minutes before expiry
const CREDENTIAL_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Get credentials using IAM Roles Anywhere (PKI/X.509 certificate).
 *
 * Uses a certificate and private key to authenticate to AWS Roles Anywhere
 * and obtain temporary credentials without any static AWS keys.
 *
 * @param {object} aws - AWS configuration from tenant
 * @returns {Promise<object>} AWS credentials object
 */
async function getCredentialsFromRolesAnywhere(aws) {
  const cacheKey = `rolesanywhere:${aws.rolesAnywhereTrustAnchorArn}:${aws.rolesAnywhereProfileArn}`;
  const cached = credentialCache.get(cacheKey);

  if (cached && cached.expiration > Date.now() + CREDENTIAL_REFRESH_BUFFER_MS) {
    logger.debug('Using cached Roles Anywhere credentials');
    return cached.credentials;
  }

  logger.info('Obtaining credentials from IAM Roles Anywhere', {
    trustAnchorArn: aws.rolesAnywhereTrustAnchorArn,
    profileArn: aws.rolesAnywhereProfileArn,
    roleArn: aws.roleArn,
    region: aws.region,
  });

  try {
    // Parse certificate and private key from PEM format
    const certificate = aws.rolesAnywhereCertificate;
    const privateKey = aws.rolesAnywherePrivateKey;

    if (!certificate || !privateKey) {
      throw new Error('Certificate and private key are required for IAM Roles Anywhere');
    }

    // Parse the certificate to get DER encoding and serial number
    const cert = new crypto.X509Certificate(certificate);
    const certDER = cert.raw; // DER-encoded certificate bytes
    const certBase64 = certDER.toString('base64');

    // Convert serial number from hex to decimal (AWS expects decimal format)
    const serialNumberHex = cert.serialNumber;
    const serialNumberDecimal = BigInt('0x' + serialNumberHex).toString();

    // Extract region from profile ARN (e.g., arn:aws:rolesanywhere:eu-west-3:...)
    const profileArnParts = aws.rolesAnywhereProfileArn.split(':');
    const rolesAnywhereRegion = profileArnParts.length >= 4 ? profileArnParts[3] : aws.region;

    // Build the request - parameters go in query string, not body
    const endpoint = `https://rolesanywhere.${rolesAnywhereRegion}.amazonaws.com`;
    const basePath = '/sessions';
    const method = 'POST';
    const service = 'rolesanywhere';

    // Build query string with URL-encoded parameters
    const queryParams = new URLSearchParams({
      profileArn: aws.rolesAnywhereProfileArn,
      roleArn: aws.roleArn,
      trustAnchorArn: aws.rolesAnywhereTrustAnchorArn,
    });
    const queryString = queryParams.toString();

    logger.debug('Roles Anywhere request', {
      endpoint: `${endpoint}${basePath}?${queryString}`,
      serialNumberDecimal,
      rolesAnywhereRegion,
    });

    // Create the request to sign
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    const headers = {
      'Content-Type': 'application/json',
      'Host': `rolesanywhere.${rolesAnywhereRegion}.amazonaws.com`,
      'X-Amz-Date': amzDate,
      'X-Amz-X509': certBase64,
    };

    // Create canonical request for AWS Signature Version 4 with X.509
    // Headers must be sorted by lowercase key name
    const sortedHeaderKeys = Object.keys(headers).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );

    const canonicalHeaders = sortedHeaderKeys
      .map(key => `${key.toLowerCase()}:${headers[key]}`)
      .join('\n') + '\n';

    const signedHeaders = sortedHeaderKeys
      .map(key => key.toLowerCase())
      .join(';');

    // Empty body for query string request
    const body = '';
    const payloadHash = crypto.createHash('sha256').update(body).digest('hex');

    const canonicalRequest = [
      method,
      basePath,
      queryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest).digest('hex');

    // Create string to sign
    const algorithm = 'AWS4-X509-RSA-SHA256';
    const credentialScope = `${dateStamp}/${rolesAnywhereRegion}/${service}/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join('\n');

    // Sign with private key (RSA-SHA256)
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(stringToSign);
    const signature = sign.sign(privateKey, 'hex');

    // Build Authorization header using decimal serial number
    const authorization = `${algorithm} Credential=${serialNumberDecimal}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    headers['Authorization'] = authorization;

    // Make the request with query string parameters
    const requestUrl = `${endpoint}${basePath}?${queryString}`;
    const response = await fetch(requestUrl, {
      method,
      headers,
      // Empty body for query string requests
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Roles Anywhere API error response', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        endpoint: requestUrl,
        trustAnchorArn: aws.rolesAnywhereTrustAnchorArn,
        profileArn: aws.rolesAnywhereProfileArn,
        roleArn: aws.roleArn,
      });
      throw new Error(`Roles Anywhere request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    if (!data.credentialSet || data.credentialSet.length === 0) {
      throw new Error('No credentials returned from Roles Anywhere');
    }

    const credSet = data.credentialSet[0].credentials;
    const credentials = {
      accessKeyId: credSet.accessKeyId,
      secretAccessKey: credSet.secretAccessKey,
      sessionToken: credSet.sessionToken,
    };

    // Cache the credentials
    const expiration = new Date(credSet.expiration).getTime();
    credentialCache.set(cacheKey, {
      credentials,
      expiration,
    });

    logger.info('Successfully obtained credentials from IAM Roles Anywhere', {
      expiresAt: credSet.expiration,
    });

    return credentials;
  } catch (error) {
    logger.error('Failed to get credentials from IAM Roles Anywhere', {
      errorName: error.name,
      errorMessage: error.message,
    });
    throw new AppError('AWS_ROLES_ANYWHERE_FAILED', error);
  }
}

/**
 * Get credentials for S3 operations.
 *
 * Supports two authentication methods (in priority order):
 * 1. IAM Roles Anywhere (PKI) - if rolesAnywhereTrustAnchorArn is set
 * 2. Static credentials - direct accessKeyId/secretAccessKey
 *
 * @param {object} tenantConfig - Tenant configuration
 * @returns {Promise<object>} AWS credentials object
 */
async function getCredentials(tenantConfig) {
  const { aws } = tenantConfig;

  // Method 1: IAM Roles Anywhere (PKI - no static keys needed)
  if (aws.rolesAnywhereTrustAnchorArn && aws.rolesAnywhereProfileArn) {
    return getCredentialsFromRolesAnywhere(aws);
  }

  // Method 2: Static credentials
  if (aws.accessKeyId && aws.secretAccessKey) {
    return {
      accessKeyId: aws.accessKeyId,
      secretAccessKey: aws.secretAccessKey,
    };
  }

  throw new AppError('AWS_CREDENTIALS_NOT_CONFIGURED', new Error(
    'No AWS credentials configured. Provide either: ' +
    '(1) IAM Roles Anywhere certificate and private key, or ' +
    '(2) Access Key ID + Secret Access Key'
  ));
}

/**
 * Create an S3 client with appropriate credentials.
 * Supports static credentials and IAM Roles Anywhere.
 *
 * @param {object} tenantConfig - Tenant configuration
 * @returns {Promise<S3Client>} Configured S3 client
 */
async function createS3Client(tenantConfig) {
  const credentials = await getCredentials(tenantConfig);

  return new S3Client({
    region: tenantConfig.aws.region,
    credentials,
  });
}

async function listSessions(tenantConfig, type, continuationToken = null) {
  const client = await createS3Client(tenantConfig);
  const bucketName = tenantConfig.aws.bucket;

  // Build prefix: optional bucket prefix + type prefix (ssh~ or rdp~)
  const bucketPrefix = (tenantConfig.aws.bucketPrefix || '').replace(/\/$/, '');
  const typePrefix = type === 'ssh' ? S3_PREFIXES.SSH : S3_PREFIXES.RDP;
  const prefix = bucketPrefix ? `${bucketPrefix}/${typePrefix}` : typePrefix;

  const extension = type === 'ssh' ? FILE_EXTENSIONS.SSH : FILE_EXTENSIONS.RDP;

  try {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    });

    const response = await client.send(command);

    // Filter by extension and map to minimal session objects
    const sessions = (response.Contents || [])
      .filter(obj => obj.Key.endsWith(extension))
      .map(obj => ({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified,
      }));

    return {
      sessions,
      nextToken: response.NextContinuationToken || null,
      isTruncated: response.IsTruncated || false,
    };
  } catch (error) {
    logger.error('S3 operation error', {
      errorName: error.name,
      errorCode: error.code,
      errorMessage: error.message,
      bucket: tenantConfig.aws.bucket,
      stack: error.stack,
    });
    const errorInfo = mapS3Error(error);
    throw new AppError(Object.keys(require('../utils/errorMessages').ERROR_MESSAGES).find(
      key => require('../utils/errorMessages').ERROR_MESSAGES[key] === errorInfo
    ) || 'S3_GENERIC', error);
  }
}

async function getSessionMetadata(tenantConfig, key) {
  const client = await createS3Client(tenantConfig);
  const bucketName = tenantConfig.aws.bucket;

  try {
    const command = new HeadObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await client.send(command);

    return {
      size: response.ContentLength,
      lastModified: response.LastModified,
      contentType: response.ContentType,
      metadata: response.Metadata || {},
    };
  } catch (error) {
    logger.error('S3 operation error', {
      errorName: error.name,
      errorCode: error.code,
      errorMessage: error.message,
      bucket: tenantConfig.aws.bucket,
      stack: error.stack,
    });
    const errorInfo = mapS3Error(error);
    throw new AppError(Object.keys(require('../utils/errorMessages').ERROR_MESSAGES).find(
      key => require('../utils/errorMessages').ERROR_MESSAGES[key] === errorInfo
    ) || 'S3_GENERIC', error);
  }
}

async function getSessionStream(tenantConfig, key) {
  const client = await createS3Client(tenantConfig);
  const bucketName = tenantConfig.aws.bucket;

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await client.send(command);

    return {
      stream: response.Body,
      size: response.ContentLength,
      contentType: response.ContentType,
    };
  } catch (error) {
    logger.error('S3 operation error', {
      errorName: error.name,
      errorCode: error.code,
      errorMessage: error.message,
      bucket: tenantConfig.aws.bucket,
      stack: error.stack,
    });
    const errorInfo = mapS3Error(error);
    throw new AppError(Object.keys(require('../utils/errorMessages').ERROR_MESSAGES).find(
      key => require('../utils/errorMessages').ERROR_MESSAGES[key] === errorInfo
    ) || 'S3_GENERIC', error);
  }
}

async function getSessionContent(tenantConfig, key) {
  const { stream } = await getSessionStream(tenantConfig, key);

  // Convert stream to buffer
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function checkS3Health(tenantConfig) {
  const client = await createS3Client(tenantConfig);
  const bucketName = tenantConfig.aws.bucket;

  try {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      MaxKeys: 1,
    });

    await client.send(command);
    return { status: 'ok' };
  } catch (error) {
    return { status: 'degraded', error: error.message };
  }
}

/**
 * Generate a presigned URL for direct S3 access
 * @param {object} tenantConfig - Tenant configuration with AWS credentials
 * @param {string} key - S3 object key
 * @param {number} expiresIn - URL expiration in seconds (optional, uses tenant config or default)
 * @returns {Promise<string>} Presigned URL
 */
async function getPresignedUrl(tenantConfig, key, expiresIn = null) {
  const client = await createS3Client(tenantConfig);
  const bucketName = tenantConfig.aws.bucket;

  // Use per-tenant setting if available, otherwise provided value or global default
  if (expiresIn === null) {
    const expiryMinutes = parseInt(tenantConfig.aws?.presignedUrlExpiryMinutes, 10) || (PRESIGNED_URL_EXPIRES_IN / 60);
    expiresIn = expiryMinutes * 60;
  }

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const url = await getSignedUrl(client, command, { expiresIn });

    logger.debug('Generated presigned URL', {
      key,
      expiresIn,
    });

    return url;
  } catch (error) {
    logger.error('Failed to generate presigned URL', {
      errorName: error.name,
      errorCode: error.code,
      errorMessage: error.message,
      key,
    });
    const errorInfo = mapS3Error(error);
    throw new AppError(Object.keys(require('../utils/errorMessages').ERROR_MESSAGES).find(
      k => require('../utils/errorMessages').ERROR_MESSAGES[k] === errorInfo
    ) || 'S3_GENERIC', error);
  }
}

module.exports = {
  listSessions,
  getSessionMetadata,
  getSessionStream,
  getSessionContent,
  getPresignedUrl,
  checkS3Health,
};
