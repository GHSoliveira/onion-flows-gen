import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/authorization.js';
import { getRedisStatus, isBullMqEnabled, isRedisEnabled } from '../services/redisClient.js';
import { getQueuesMetrics } from '../queues/index.js';

const router = express.Router();

router.get('/queues', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), async (_req, res) => {
  try {
    const queues = await getQueuesMetrics();
    res.json({
      redis: getRedisStatus(),
      flags: {
        redisEnabled: isRedisEnabled(),
        bullMqEnabled: isBullMqEnabled()
      },
      queues
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Falha ao consultar filas' });
  }
});

export default router;
