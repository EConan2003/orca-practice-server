'use strict';

const express = require('express');
const {
  parseFlag,
  createFeatures,
  createFeaturesRouter,
  requireOrcaDashboard,
} = require('./features');
const { createOrcaRunner } = require('./orca/runner');
const { createOrcaService } = require('./orca/service');
const { createOrcaRouter } = require('./orca/router');

// Builds an Express app with its own in-memory item store and feature flags.
// Each call returns an independent app, so tests don't share state.
//
// options.orcaDashboard  initial flag state (default: parsed from ORCA_DASHBOARD)
// options.orcaRunner     (cmd, args) => Promise<result>; default runs the Orca CLI
function createApp(options = {}) {
  const app = express();
  const items = [];
  let nextId = 1;

  // The PUT loopback check reads the socket address; never trust forwarding headers.
  app.set('trust proxy', false);
  app.use(express.json());

  const features = createFeatures({
    orcaDashboard:
      typeof options.orcaDashboard === 'boolean'
        ? options.orcaDashboard
        : parseFlag(process.env.ORCA_DASHBOARD),
  });
  const orca = createOrcaService({ runner: options.orcaRunner || createOrcaRunner() });

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/api/items', (req, res) => {
    res.status(200).json(items);
  });

  app.post('/api/items', (req, res) => {
    const name = req.body && req.body.name;
    if (typeof name !== 'string' || name.length === 0) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    const item = { id: nextId++, name };
    items.push(item);
    return res.status(201).json(item);
  });

  app.use(createFeaturesRouter(features));

  // Every /dashboard and /api/orca/* request is gated on the flag, checked per request.
  const gate = requireOrcaDashboard(features);
  app.use('/dashboard', gate);
  app.use('/api/orca', gate);
  app.use(createOrcaRouter(orca));

  // All responses are JSON, including unknown routes and errors.
  app.use((req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // Express recognises error handlers by their four parameters.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
    const status = err.status || err.statusCode || 500;
    return res
      .status(status)
      .json({ error: status >= 500 ? 'internal server error' : err.message });
  });

  return app;
}

module.exports = { createApp };
