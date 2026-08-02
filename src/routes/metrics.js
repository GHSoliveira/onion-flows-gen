import express from 'express';
import jwt from 'jsonwebtoken';
import adapter from '../../db/DatabaseAdapter.js';
import { JWT_SECRET_VALUE } from '../config/constants.js';

import { authenticate } from '../middleware/auth.js';
import { generateId } from '../utils/helpers.js';

const router = express.Router();
const MAX_METRICS = 1000;
const ALLOWED_METRICS = new Set(['CLS', 'FID', 'FCP', 'INP', 'LCP', 'TTFB']);
let metricWritesSinceCleanup = 0;
let metricCleanupRunning = false;

const cleanupWebVitals = async () => {
  if (metricCleanupRunning) return;
  metricCleanupRunning = true;
  try {
    const total = await adapter.countDocuments('webVitals');
    if (total <= MAX_METRICS) return;
    const obsolete = await adapter.findMany('webVitals', {
      projection: { _id: 1 },
      sort: { timestamp: -1 },
      skip: MAX_METRICS
    });
    if (obsolete.length > 0) {
      await adapter.deleteMany('webVitals', {
        _id: { $in: obsolete.map((item) => item._id) }
      });
    }
  } finally {
    metricCleanupRunning = false;
  }
};

router.post('/web-vitals', authenticate, async (req, res) => {
  try {
    const metric = req.body || {};
    if (!metric || !metric.name || !ALLOWED_METRICS.has(metric.name)) {
      return res.status(400).json({ error: 'Invalid metric' });
    }

    const user = req.user;
    const payload = {
      id: generateId('wv'),
      timestamp: new Date().toISOString(),
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      delta: metric.delta,
      navigationType: metric.navigationType || null,
      page: metric.page || null,
      userId: user?.id || null,
      tenantId: user?.tenantId || null
    };

    await adapter.insertOne('webVitals', payload);

    metricWritesSinceCleanup += 1;
    if (metricWritesSinceCleanup >= 50) {
      metricWritesSinceCleanup = 0;
      cleanupWebVitals().catch(() => {});
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
