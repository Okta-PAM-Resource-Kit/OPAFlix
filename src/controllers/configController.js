/**
 * Configuration Controller
 *
 * Handles tenant configuration display and updates.
 * In single-tenant mode, configuration is read-only (from environment variables).
 */

const crypto = require('crypto');
const { updateTenantConfig, deleteTenantConfigKeys, isSingleTenantMode } = require('../services/tenantConfigService');
const { getLogger } = require('../config/logger');

const logger = getLogger();

/**
 * Mask a secret value, showing only the last 4 characters
 */
function maskSecret(value) {
  if (!value || value.length <= 4) {
    return '********';
  }
  return '********' + value.slice(-4);
}

/**
 * Parse X.509 certificate and extract useful information
 * @param {string} pemCertificate - PEM-encoded certificate
 * @returns {Object|null} Certificate details or null if parsing fails
 */
function parseCertificateDetails(pemCertificate) {
  if (!pemCertificate) return null;

  try {
    const cert = new crypto.X509Certificate(pemCertificate);

    // Extract CN from subject (format: "CN=value\nO=org\n...")
    const subjectParts = cert.subject.split('\n');
    let cn = '';
    for (const part of subjectParts) {
      if (part.startsWith('CN=')) {
        cn = part.substring(3);
        break;
      }
    }

    // Parse expiration date
    const validTo = new Date(cert.validTo);
    const validFrom = new Date(cert.validFrom);
    const now = new Date();

    // Calculate days until expiration
    const daysUntilExpiry = Math.ceil((validTo - now) / (1000 * 60 * 60 * 24));

    // Determine status
    let status = 'valid';
    if (now > validTo) {
      status = 'expired';
    } else if (daysUntilExpiry <= 30) {
      status = 'expiring-soon';
    }

    return {
      cn,
      validFrom: validFrom.toISOString().split('T')[0],
      validTo: validTo.toISOString().split('T')[0],
      daysUntilExpiry,
      status,
      serialNumber: cert.serialNumber,
    };
  } catch (error) {
    logger.warn('Failed to parse certificate', { error: error.message });
    return null;
  }
}

/**
 * Display configuration page
 */
async function showConfig(req, res, next) {
  try {
    const tenantConfig = req.tenantContext.config;
    const isReadOnly = isSingleTenantMode();

    // Parse certificate details if available
    const certDetails = parseCertificateDetails(tenantConfig.aws?.rolesAnywhereCertificate);

    // Prepare config for display with masked secrets
    const displayConfig = {
      okta: {
        issuer: tenantConfig.okta?.issuer || '',
        clientId: tenantConfig.okta?.clientId || '',
        clientSecretMasked: maskSecret(tenantConfig.okta?.clientSecret),
      },
      aws: {
        accessKeyId: tenantConfig.aws?.accessKeyId || '',
        secretAccessKeyMasked: maskSecret(tenantConfig.aws?.secretAccessKey),
        region: tenantConfig.aws?.region || '',
        bucket: tenantConfig.aws?.bucket || '',
        // IAM Roles Anywhere (PKI)
        roleArn: tenantConfig.aws?.roleArn || '',
        rolesAnywhereTrustAnchorArn: tenantConfig.aws?.rolesAnywhereTrustAnchorArn || '',
        rolesAnywhereProfileArn: tenantConfig.aws?.rolesAnywhereProfileArn || '',
        rolesAnywhereCertificateMasked: maskSecret(tenantConfig.aws?.rolesAnywhereCertificate),
        rolesAnywherePrivateKeyMasked: maskSecret(tenantConfig.aws?.rolesAnywherePrivateKey),
        // Certificate details for display
        certificateDetails: certDetails,
      },
      opaApi: {
        keyId: tenantConfig.opaApi?.keyId || '',
        keySecretMasked: maskSecret(tenantConfig.opaApi?.keySecret),
      },
      opaflix: {
        sessionIndexRefreshMinutes: parseInt(tenantConfig.opaflix?.sessionIndexRefreshMinutes, 10) || 15,
        defaultPageSize: parseInt(tenantConfig.opaflix?.defaultPageSize, 10) || 50,
      },
    };

    // Add presignedUrlExpiryMinutes to AWS section
    displayConfig.aws.presignedUrlExpiryMinutes = parseInt(tenantConfig.aws?.presignedUrlExpiryMinutes, 10) || 240;

    res.render('config', {
      title: 'Configuration',
      activeTab: 'config',
      isAuthenticated: true,
      user: req.user,
      tenant: {
        tenantId: req.tenantContext.tenantId,
        tenantUrl: req.tenantContext.tenantUrl,
        teamName: req.tenantContext.teamName,
      },
      config: displayConfig,
      readOnly: isReadOnly,
      isSingleTenant: isReadOnly,
      pageStyles: `<link rel="stylesheet" href="${req.app.locals.assetUrl('/css/config.css')}">`,
      scripts: `<script src="${req.app.locals.assetUrl('/js/configPage.js')}"></script>`,
    });
  } catch (error) {
    logger.error('Failed to load config page', {
      error: error.message,
      tenantId: req.tenantContext?.tenantId,
    });
    next(error);
  }
}

/**
 * Update configuration
 */
async function updateConfig(req, res, next) {
  try {
    // Check if single-tenant mode (read-only)
    if (isSingleTenantMode()) {
      return res.status(403).json({
        success: false,
        error: 'Configuration updates are not available in single-tenant mode. Update environment variables and restart the application.',
      });
    }

    const tenantId = req.tenantContext.tenantId;
    const updates = {};
    const keysToDelete = [];

    // Determine authentication method and clean up unused credentials
    const authMethod = req.body['aws.authMethod'];

    if (authMethod === 'rolesAnywhere') {
      // Switching to IAM Roles Anywhere - delete Access Key credentials
      keysToDelete.push('aws.accessKeyId', 'aws.secretAccessKey');
    } else if (authMethod === 'accessKey') {
      // Switching to Access Keys - delete IAM Roles Anywhere credentials
      keysToDelete.push(
        'aws.roleArn',
        'aws.rolesAnywhereTrustAnchorArn',
        'aws.rolesAnywhereProfileArn',
        'aws.rolesAnywhereCertificate',
        'aws.rolesAnywherePrivateKey'
      );
    }

    // Extract AWS config updates (only add if non-empty)
    if (req.body['aws.accessKeyId']) {
      updates['aws.accessKeyId'] = req.body['aws.accessKeyId'];
    }
    if (req.body['aws.secretAccessKey']) {
      updates['aws.secretAccessKey'] = req.body['aws.secretAccessKey'];
    }
    if (req.body['aws.region']) {
      updates['aws.region'] = req.body['aws.region'];
    }
    if (req.body['aws.bucket']) {
      updates['aws.bucket'] = req.body['aws.bucket'];
    }
    // IAM Roles Anywhere (PKI)
    if (req.body['aws.roleArn']) {
      updates['aws.roleArn'] = req.body['aws.roleArn'];
    }
    if (req.body['aws.rolesAnywhereTrustAnchorArn']) {
      updates['aws.rolesAnywhereTrustAnchorArn'] = req.body['aws.rolesAnywhereTrustAnchorArn'];
    }
    if (req.body['aws.rolesAnywhereProfileArn']) {
      updates['aws.rolesAnywhereProfileArn'] = req.body['aws.rolesAnywhereProfileArn'];
    }
    if (req.body['aws.rolesAnywhereCertificate']) {
      updates['aws.rolesAnywhereCertificate'] = req.body['aws.rolesAnywhereCertificate'];
    }
    if (req.body['aws.rolesAnywherePrivateKey']) {
      updates['aws.rolesAnywherePrivateKey'] = req.body['aws.rolesAnywherePrivateKey'];
    }

    // Extract OPA API config updates (only add if non-empty)
    if (req.body['opaApi.keyId']) {
      updates['opaApi.keyId'] = req.body['opaApi.keyId'];
    }
    if (req.body['opaApi.keySecret']) {
      updates['opaApi.keySecret'] = req.body['opaApi.keySecret'];
    }

    // Extract Opaflix advanced config (only store non-default values)
    const refreshMinutesRaw = req.body['opaflix.sessionIndexRefreshMinutes'];
    if (refreshMinutesRaw !== undefined && refreshMinutesRaw !== '') {
      const refreshMinutes = parseInt(refreshMinutesRaw, 10);
      if (!isNaN(refreshMinutes) && refreshMinutes !== 15 && refreshMinutes >= 1 && refreshMinutes <= 60) {
        updates['opaflix.sessionIndexRefreshMinutes'] = String(refreshMinutes);
      } else if (refreshMinutes === 15) {
        // Delete if set back to default
        keysToDelete.push('opaflix.sessionIndexRefreshMinutes');
      }
    }

    const pageSizeRaw = req.body['opaflix.defaultPageSize'];
    if (pageSizeRaw !== undefined && pageSizeRaw !== '') {
      const pageSize = parseInt(pageSizeRaw, 10);
      if (!isNaN(pageSize) && pageSize !== 50 && pageSize >= 10 && pageSize <= 100) {
        updates['opaflix.defaultPageSize'] = String(pageSize);
      } else if (pageSize === 50) {
        keysToDelete.push('opaflix.defaultPageSize');
      }
    }

    const presignedExpiryRaw = req.body['aws.presignedUrlExpiryMinutes'];
    if (presignedExpiryRaw !== undefined && presignedExpiryRaw !== '') {
      const presignedExpiry = parseInt(presignedExpiryRaw, 10);
      if (!isNaN(presignedExpiry) && presignedExpiry !== 240 && presignedExpiry >= 5 && presignedExpiry <= 720) {
        updates['aws.presignedUrlExpiryMinutes'] = String(presignedExpiry);
      } else if (presignedExpiry === 240) {
        keysToDelete.push('aws.presignedUrlExpiryMinutes');
      }
    }

    if (Object.keys(updates).length === 0 && keysToDelete.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No configuration changes provided',
      });
    }

    // Delete unused authentication method keys first
    if (keysToDelete.length > 0) {
      await deleteTenantConfigKeys(tenantId, keysToDelete);
      logger.info('Deleted unused auth method keys', {
        tenantId,
        authMethod,
        keysDeleted: keysToDelete,
      });
    }

    // Update config (only if there are updates)
    if (Object.keys(updates).length > 0) {
      await updateTenantConfig(tenantId, updates);
    }

    logger.info('Configuration updated', {
      tenantId,
      userId: req.user?.email,
      keysUpdated: Object.keys(updates),
    });

    res.json({
      success: true,
      message: 'Configuration updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update config', {
      error: error.message,
      tenantId: req.tenantContext?.tenantId,
      userId: req.user?.email,
    });

    // Handle specific errors
    if (error.message.includes('Cannot modify Okta')) {
      return res.status(403).json({
        success: false,
        error: error.message,
      });
    }

    if (error.message.includes('Invalid config key')) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    if (error.message.includes('single-tenant mode')) {
      return res.status(403).json({
        success: false,
        error: error.message,
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update configuration',
    });
  }
}

module.exports = {
  showConfig,
  updateConfig,
};
