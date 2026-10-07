const { checkS3Health } = require('../services/s3Service');
const { HEALTH_STATUS } = require('../config/constants');

async function getHealthStatus(req, res) {
  const checks = {};
  let overallStatus = HEALTH_STATUS.HEALTHY;

  // Server check (always OK if we got here)
  checks.server = HEALTH_STATUS.OK;

  // S3 check
  try {
    const s3Health = await checkS3Health();
    checks.s3 = s3Health.status;
    if (s3Health.status !== HEALTH_STATUS.OK) {
      overallStatus = HEALTH_STATUS.DEGRADED;
    }
  } catch (error) {
    checks.s3 = HEALTH_STATUS.DEGRADED;
    overallStatus = HEALTH_STATUS.DEGRADED;
  }

  // Memory check
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
  const heapPercent = (heapUsedMB / heapTotalMB) * 100;

  if (heapPercent > 90) {
    checks.memory = HEALTH_STATUS.WARNING;
    overallStatus = HEALTH_STATUS.DEGRADED;
  } else {
    checks.memory = HEALTH_STATUS.OK;
  }

  const response = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
    memory: {
      heapUsedMB: heapUsedMB.toFixed(2),
      heapTotalMB: heapTotalMB.toFixed(2),
      heapPercent: heapPercent.toFixed(1),
    },
  };

  const httpStatus = overallStatus === HEALTH_STATUS.HEALTHY ? 200 : 503;
  res.status(httpStatus).json(response);
}

module.exports = {
  getHealthStatus,
};
