import { Worker } from 'bullmq';
import { getRedisConnection, getRedisStatus, isBullMqEnabled } from '../services/redisClient.js';
import { handleWhatsAppWebhook } from '../services/whatsappHandler.js';
import { sendWhatsAppMedia, sendWhatsAppText } from '../services/whatsappApi.js';
import { processNextOutreachCampaign } from '../services/outreachCampaignWorker.js';
import { addQueueJob, getQueueConcurrency, QUEUE_NAMES } from '../queues/index.js';

const workers = [];

const summarizeError = (error) => ({
  message: error?.message || 'job_failed',
  name: error?.name || null,
  status: error?.response?.status || error?.status || null
});

const logJob = ({ queueName, job, startedAt, status, error = null }) => {
  const durationMs = Date.now() - startedAt;
  const data = job?.data || {};
  const payload = {
    tenantId: data.tenantId || null,
    chatId: data.chatId || null,
    jobId: job?.id || null,
    queueName,
    durationMs,
    status,
    error: error ? summarizeError(error) : null
  };
  const method = status === 'failed' ? console.warn : console.log;
  method('[BULLMQ_JOB]', payload);
};

const createWorker = (queueName, processor) => {
  const connection = getRedisConnection();
  const worker = new Worker(queueName, async (job) => {
    const startedAt = Date.now();
    try {
      const result = await processor(job);
      logJob({ queueName, job, startedAt, status: 'completed' });
      return result;
    } catch (error) {
      logJob({ queueName, job, startedAt, status: 'failed', error });
      throw error;
    }
  }, {
    connection,
    concurrency: getQueueConcurrency(queueName)
  });

  worker.on('failed', (job, error) => {
    console.warn('[BULLMQ_WORKER] Job falhou', {
      queueName,
      jobId: job?.id || null,
      attemptsMade: job?.attemptsMade || 0,
      error: error?.message || 'job_failed'
    });
  });

  workers.push(worker);
  return worker;
};

const scheduleCampaignDrain = async ({ delay = 500 } = {}) => {
  await addQueueJob(
    QUEUE_NAMES.outreachCampaign,
    'process-outreach-campaign',
    { reason: 'drain' },
    { jobId: `campaign-drain-${Date.now()}`, delay }
  );
};

export const startBullMqWorkers = async () => {
  if (!isBullMqEnabled()) {
    console.log('[BULLMQ] Desligado por configuracao');
    return [];
  }

  if (!getRedisConnection() || !getRedisStatus().ready) {
    console.warn('[BULLMQ] Redis indisponivel. Workers nao iniciados; fallback local ativo.');
    return [];
  }

  if (workers.length > 0) return workers;

  createWorker(QUEUE_NAMES.whatsappWebhook, async (job) => {
    if (job.name === 'smoke-noop') return { ok: true, smoke: true };
    await handleWhatsAppWebhook({
      payload: job.data?.payload,
      tenantId: job.data?.tenantId || null
    });
    return { ok: true };
  });

  createWorker(QUEUE_NAMES.whatsappSend, async (job) => {
    const data = job.data || {};
    if (data.mediaType || data.mediaUrl) {
      return sendWhatsAppMedia(data);
    }
    return sendWhatsAppText(data);
  });

  createWorker(QUEUE_NAMES.outreachCampaign, async () => {
    const result = await processNextOutreachCampaign();
    if (result && !result.idle) {
      await scheduleCampaignDrain({ delay: 500 });
    }
    return result || { ok: true };
  });

  await scheduleCampaignDrain({ delay: 1000 }).catch((error) => {
    console.warn('[BULLMQ] Falha ao agendar drain inicial de campanhas:', error?.message || error);
  });

  console.log('[BULLMQ] Workers iniciados', {
    queues: Object.values(QUEUE_NAMES).map((name) => ({
      name,
      concurrency: getQueueConcurrency(name)
    }))
  });

  return workers;
};

export const closeBullMqWorkers = async () => {
  await Promise.all(workers.map((worker) => worker.close().catch(() => null)));
  workers.length = 0;
};
