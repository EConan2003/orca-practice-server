'use strict';

const path = require('node:path');
const express = require('express');
const { featureCatalog } = require('./catalog');
const { learnContent } = require('./learn');
const { requireLoopback } = require('../features');

const DASHBOARD_HTML = path.join(__dirname, '..', 'dashboard', 'index.html');

// Parses an optional ?limit=<min-max>; returns the default when absent, null when invalid.
function parseLimit(raw, { max = 100, def = 50 } = {}) {
  if (raw === undefined) return def;
  if (typeof raw !== 'string' || !/^[0-9]{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= max ? n : null;
}

// Sends a service {status, body} result; errors go to the app's JSON error handler.
const send = (fn) => async (req, res, next) => {
  try {
    const { status, body } = await fn(req);
    res.status(status).json(body);
  } catch (err) {
    next(err);
  }
};

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

  router.get('/api/orca/learn', (req, res) => {
    res.status(200).json(learnContent());
  });

  router.get('/api/orca/runs', send(async () => ({ status: 200, body: await service.listRuns() })));

  router.get('/api/orca/runs/:id', send((req) => service.getRun(req.params.id)));

  router.get('/api/orca/runs/:id/timeline', send((req) => service.getTimeline(req.params.id)));

  router.get(
    '/api/orca/runs/:id/tasks/:taskId',
    requireLoopback,
    send((req) => service.getTask(req.params.id, req.params.taskId)),
  );

  router.get('/api/orca/messages/:id', requireLoopback, send((req) => service.getMessage(req.params.id)));

  router.get(
    '/api/orca/workers/:dispatchId/output',
    requireLoopback,
    send(async (req) => {
      const limit = parseLimit(req.query.limit, { max: 200, def: 50 });
      if (limit === null) {
        return { status: 400, body: { error: 'limit must be an integer from 1 to 200' } };
      }
      return service.getWorkerOutput(req.params.dispatchId, limit);
    }),
  );

  router.get(
    '/api/orca/inbox',
    send(async (req) => {
      const limit = parseLimit(req.query.limit);
      if (limit === null) {
        return { status: 400, body: { error: 'limit must be an integer from 1 to 100' } };
      }
      return { status: 200, body: await service.inbox(limit) };
    }),
  );

  return router;
}

module.exports = { createOrcaRouter, parseLimit };
