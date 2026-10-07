const helmet = require('helmet');

/**
 * Build CSP directives, optionally including tenant-specific S3 URL
 * @param {Object} tenantContext - Tenant context from request (optional)
 * @returns {Object} CSP directives object for Helmet
 */
function buildCspDirectives(tenantContext) {
  const connectSrc = ['\'self\''];
  const mediaSrc = ['\'self\'', 'blob:'];

  // Add tenant-specific S3 URL if available
  if (tenantContext?.config?.aws?.bucket && tenantContext?.config?.aws?.region) {
    const s3Url = `https://${tenantContext.config.aws.bucket}.s3.${tenantContext.config.aws.region}.amazonaws.com`;
    connectSrc.push(s3Url);
    mediaSrc.push(s3Url);
  }

  return {
    defaultSrc: ['\'self\''],
    scriptSrc: ['\'self\'', '\'unsafe-inline\'', '\'unsafe-eval\'', 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
    styleSrc: ['\'self\'', '\'unsafe-inline\'', 'https://cdn.jsdelivr.net'],
    imgSrc: ['\'self\'', 'data:', 'blob:'],
    fontSrc: ['\'self\''],
    mediaSrc: mediaSrc,
    connectSrc: connectSrc,
    objectSrc: ['\'none\''],
    frameSrc: ['\'none\''],
    baseUri: ['\'self\''],
    formAction: ['\'self\''],
    frameAncestors: ['\'none\''],
  };
}

function setupSecurityHeaders(app) {
  // Helmet with CSP configured via directives function for dynamic tenant support
  app.use(helmet({
    contentSecurityPolicy: {
      directives: buildCspDirectives(null), // Base CSP without tenant context
    },
    crossOriginEmbedderPolicy: false, // Allow video embeds
  }));

  // Additional security headers
  app.use((req, res, next) => {
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // XSS protection (legacy browsers)
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions policy
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    next();
  });
}

/**
 * Dynamic CSP middleware - overrides CSP with tenant-specific S3 URLs
 * Must run after tenant resolution so req.tenantContext is available
 */
function setDynamicCSP() {
  return (req, res, next) => {
    // Build CSP directives with tenant context
    const directives = buildCspDirectives(req.tenantContext);

    // Build CSP header string
    const cspHeader = Object.entries(directives)
      .map(([key, values]) => {
        // Convert camelCase to kebab-case (e.g., defaultSrc -> default-src)
        const directive = key.replace(/([A-Z])/g, '-$1').toLowerCase();
        return `${directive} ${values.join(' ')}`;
      })
      .join('; ');

    res.setHeader('Content-Security-Policy', cspHeader);
    next();
  };
}

module.exports = { setupSecurityHeaders, setDynamicCSP };
