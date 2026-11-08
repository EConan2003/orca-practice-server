'use strict';

const express = require('express');

const DISABLED_ERROR = 'orca dashboard is disabled';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// ORCA_DASHBOARD: "on", "true" or "1" (any case) enable the flag; anything else disables it.
function parseFlag(value) {
  if (typeof value !== 'string') return false;
  return ['on', 'true', '1'].includes(value.trim().toLowerCase());
}

// True only for the loopback addresses listed in CONTRACT 4.1.
function isLoopback(address) {
  return typeof address === 'string' && LOOPBACK.has(address);
}

// In-memory flag store. Runtime state resets on restart (CONTRACT 4.1).
function createFeatures({ orcaDashboard = false } = {}) {
  let enabled = Boolean(orcaDashboard);
  return {
    isOrcaDashboardEnabled: () => enabled,
    setOrcaDashboard(value) {
      enabled = Boolean(value);
    },
    toJSON: () => ({ orcaDashboard: { enabled } }),
  };
}

// GET /api/features and PUT /api/features/orca-dashboard.
function createFeaturesRouter(features) {
  const router = express.Router();

  router.get('/api/features', (req, res) => {
    res.status(200).json(features.toJSON());
  });

  router.put('/api/features/orca-dashboard', (req, res) => {
    // The socket address, never a header: X-Forwarded-For must not grant access.
    if (!isLoopback(req.socket.remoteAddress)) {
      return res
        .status(403)
        .json({ error: 'feature flags can only be changed from loopback' });
    }
    const enabled = req.body && req.body.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    features.setOrcaDashboard(enabled);
    return res.status(200).json(features.toJSON());
  });

  return router;
}

// Checked on every request so a runtime toggle takes effect immediately.
function requireOrcaDashboard(features) {
  return (req, res, next) => {
    if (!features.isOrcaDashboardEnabled()) {
      return res.status(404).json({ error: DISABLED_ERROR });
    }
    return next();
  };
}

module.exports = {
  DISABLED_ERROR,
  parseFlag,
  isLoopback,
  createFeatures,
  createFeaturesRouter,
  requireOrcaDashboard,
};
