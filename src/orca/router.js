'use strict';

const path = require('node:path');
const express = require('express');
const { featureCatalog } = require('./catalog');

const DASHBOARD_HTML = path.join(__dirname, '..', 'dashboard', 'index.html');
const DEFAULT_INBOX_LIMIT = 50;

function parseLimit(raw) {
  if (raw === undefined) return DEFAULT_INBOX_LIMIT;
  if (typeof raw !== 'string' || !/^[0-9]{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 100 ? n : null;
}

// GET /dashboard and /api/orca/*. The caller mounts the feature-flag gate in front.
function createOrcaRouter(service) {
  const router = express.Router();

  router.get('/dashboard', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.type('html').sendFile(DASHBOARD_HTML, (err) => {
      if (err) next(err);
    });
  });

  router.get('/api/orca/features', (req, res) => {
    res.status(200).json(featureCatalog());
  });

  router.get('/api/orca/runs', async (req, res, next) => {
    try {
      res.status(200).json(await service.listRuns());
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/orca/runs/:id', async (req, res, next) => {
    try {
      const { status, body } = await service.getRun(req.params.id);
      res.status(status).json(body);
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/orca/inbox', async (req, res, next) => {
    const limit = parseLimit(req.query.limit);
    if (limit === null) {
      return res.status(400).json({ error: 'limit must be an integer from 1 to 100' });
    }
    try {
      return res.status(200).json(await service.inbox(limit));
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createOrcaRouter, parseLimit };
