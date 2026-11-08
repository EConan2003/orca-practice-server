'use strict';

const express = require('express');

// Builds an Express app with its own in-memory item store.
// Each call returns an independent app, so tests don't share state.
function createApp() {
  const app = express();
  const items = [];
  let nextId = 1;

  app.use(express.json());

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
