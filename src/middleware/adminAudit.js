const prisma = require('../db');
const logger = require('../logger');

async function logAdminAction(req, action, resource, details = {}) {
  try {
    const username = (req.user && req.user.username) || null;
    const ip = req.ip || null;

    await prisma.adminAuditLog.create({
      data: {
        username,
        action,
        resource,
        details,
        ip
      }
    });
  } catch (err) {
    logger.warn({ err: err.message, action, resource }, '[Audit] Failed to log admin action');
  }
}

module.exports = { logAdminAction };
