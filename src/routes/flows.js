import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/authorization.js';
import { requireTenant } from '../middleware/tenant.js';
import adapter from '../../db/DatabaseAdapter.js';
import { flowSchema } from '../schemas/index.js';
import { createLog } from '../services/logs.js';
import { ensureTenantLimit } from '../services/tenantLimits.js';
import { verifyUserPassword } from '../services/passwords.js';
import { invalidateRuntimeFlowCache } from '../services/flowRuntimeCache.js';
import { generateId } from '../utils/helpers.js';
import { encryptString, isEncrypted } from '../utils/crypto.js';
import { validateScript } from '../utils/scriptValidator.js';

const router = express.Router();
const FLOW_READ_ROLES = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'];
const FLOW_WRITE_ROLES = ['ADMIN', 'SUPER_ADMIN'];
const FLOW_ROLLBACK_ROLES = ['ADMIN'];

// Secrets policy:
// - on-write: data.value de secretNode é cifrado at-rest (idempotente)
// - on-read editor: value substituído por '***' (qualquer papel que edita)
// - on-read export/MANAGER: idem '***'
// - on-PUT: se o cliente devolver value === '***', preserva o ciphertext existente
const SECRET_PLACEHOLDER = '***';

const shouldRedactSecrets = () => true;

const redactSecretNodes = (nodes, enabled) => {
  if (!Array.isArray(nodes) || !enabled) return nodes;
  return nodes.map((node) => {
    if (!node || node.type !== 'secretNode') return node;
    const data = node.data ? { ...node.data } : {};
    if (Object.prototype.hasOwnProperty.call(data, 'value')) {
      data.value = SECRET_PLACEHOLDER;
    }
    return { ...node, data };
  });
};

const encryptSecretNodes = (nodes) => {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.map((node) => {
    if (!node || node.type !== 'secretNode') return node;
    const value = node.data?.value;
    if (value === null || value === undefined || value === '') return node;
    if (typeof value !== 'string') return node;
    if (isEncrypted(value)) return node;
    return { ...node, data: { ...node.data, value: encryptString(value) } };
  });
};

// Preserva o ciphertext existente quando o frontend devolve o placeholder.
// Recebe os nodes incoming (do body do PUT) e o flow já persistido. Para cada
// secretNode cujo value === '***', copia o value do flow existente (mesmo id).
const preserveSecretPlaceholders = (incomingNodes, existingNodes) => {
  if (!Array.isArray(incomingNodes)) return incomingNodes;
  const existingMap = new Map();
  for (const node of Array.isArray(existingNodes) ? existingNodes : []) {
    if (node?.type === 'secretNode' && node.id) existingMap.set(node.id, node);
  }
  return incomingNodes.map((node) => {
    if (!node || node.type !== 'secretNode') return node;
    if (node.data?.value !== SECRET_PLACEHOLDER) return node;
    const existing = existingMap.get(node.id);
    if (!existing || existing.data?.value === undefined) return node;
    return { ...node, data: { ...node.data, value: existing.data.value } };
  });
};

const cloneSnapshot = (snapshot = {}) => ({
  nodes: encryptSecretNodes(Array.isArray(snapshot?.nodes) ? JSON.parse(JSON.stringify(snapshot.nodes)) : []),
  edges: Array.isArray(snapshot?.edges) ? JSON.parse(JSON.stringify(snapshot.edges)) : [],
  visualBlocks: Array.isArray(snapshot?.visualBlocks) ? JSON.parse(JSON.stringify(snapshot.visualBlocks)) : []
});

// Valida os scriptNode antes de gravar. Devolve null se todos estão OK ou um
// array de violações [{ nodeId, label, reason }] quando algum falha. Bloquear
// no save é a defesa primária — o runtime só vai precisar do fallback se um
// script burlar essa porta (race condition, dado herdado, etc).
const collectScriptViolations = (nodes) => {
  if (!Array.isArray(nodes)) return null;
  const violations = [];
  for (const node of nodes) {
    if (!node || node.type !== 'scriptNode') continue;
    const script = String(node.data?.script || '');
    if (!script.trim()) continue;
    try {
      validateScript(script);
    } catch (error) {
      violations.push({
        nodeId: node.id || null,
        label: node.data?.label || node.data?.name || null,
        reason: error.message || 'script inválido'
      });
    }
  }
  return violations.length ? violations : null;
};

const createPublishHistoryEntry = (flow, snapshot, req, version, extra = {}) => ({
  id: generateId('flow_pub'),
  version,
  name: String(extra.name || flow.name || '').trim() || flow.name,
  description: typeof extra.description === 'string' ? extra.description : (flow.description || ''),
  publishedAt: extra.publishedAt || new Date().toISOString(),
  publishedBy: req.user?.id || 'system',
  restoredFromHistoryId: extra.restoredFromHistoryId || null,
  restoredFromVersion: extra.restoredFromVersion || null,
  snapshot: cloneSnapshot(snapshot)
});

const summarizePublishHistory = (publishHistory = []) => (
  (Array.isArray(publishHistory) ? publishHistory : [])
    .map((entry) => ({
      id: entry.id,
      version: entry.version,
      name: entry.name || '',
      description: entry.description || '',
      publishedAt: entry.publishedAt || null,
      publishedBy: entry.publishedBy || null,
      restoredFromHistoryId: entry.restoredFromHistoryId || null,
      restoredFromVersion: entry.restoredFromVersion || null
    }))
    .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime())
);

const sanitizeFlowForResponse = (flow, req) => {
  if (!flow) return flow;
  const redact = shouldRedactSecrets(req);
  const { publishHistory, ...baseFlow } = flow;
  return {
    ...baseFlow,
    nodes: redactSecretNodes(flow.nodes, redact),
    draft: flow.draft ? { ...flow.draft, nodes: redactSecretNodes(flow.draft.nodes, redact) } : flow.draft,
    published: flow.published ? { ...flow.published, nodes: redactSecretNodes(flow.published.nodes, redact) } : flow.published,
    publishHistoryCount: Array.isArray(publishHistory) ? publishHistory.length : 0
  };
};

const sanitizeEditorFlowForResponse = (flow, req) => {
  if (!flow) return flow;
  const redact = shouldRedactSecrets(req);
  const snapshot = flow.editorSnapshot || { nodes: [], edges: [] };
  const hasPublished = Boolean(flow.published?.version || flow.published?.publishedAt || flow.hasPublished);

  return {
    id: flow.id,
    name: flow.name || '',
    description: flow.description || '',
    status: flow.status || 'draft',
    tenantId: flow.tenantId || null,
    createdAt: flow.createdAt || null,
    updatedAt: flow.updatedAt || null,
    createdBy: flow.createdBy || null,
    version: flow.version || 1,
    published: hasPublished
      ? {
          version: flow.published?.version || null,
          publishedAt: flow.published?.publishedAt || null
        }
      : null,
    editorSnapshot: {
      nodes: redactSecretNodes(snapshot.nodes, redact),
      edges: Array.isArray(snapshot.edges) ? snapshot.edges : [],
      visualBlocks: Array.isArray(snapshot.visualBlocks) ? snapshot.visualBlocks : []
    }
  };
};

const buildFlowListItem = (flow = {}) => ({
  id: flow.id,
  name: flow.name || '',
  description: flow.description || '',
  status: flow.status || 'draft',
  tenantId: flow.tenantId || null,
  createdAt: flow.createdAt || null,
  updatedAt: flow.updatedAt || null,
  createdBy: flow.createdBy || null,
  version: flow.version || 1,
  publishHistoryCount: Number.isFinite(flow.publishHistoryCount)
    ? flow.publishHistoryCount
    : (Array.isArray(flow.publishHistory) ? flow.publishHistory.length : 0),
  published: flow.published
    ? {
        version: flow.published.version || null,
        publishedAt: flow.published.publishedAt || null
      }
    : null
});

const isFlowAccessible = (flow, req) => {
  if (!flow) return false;
  if (req.user?.role === 'SUPER_ADMIN') {
    if (!req.tenantId) return true;
    return String(flow.tenantId || '') === String(req.tenantId);
  }
  return String(flow.tenantId || '') === String(req.tenantId);
};

const loadFlowById = async (id, options = {}) => {
  const projection = options.includePublishHistory
    ? { _id: 0 }
    : { _id: 0, publishHistory: 0 };
  return adapter.findOne('flows', { id }, { projection });
};

const loadFlowEditorById = async (id) => {
  if (!adapter.db) await adapter.init();

  const collection = adapter.db.collection('flows');
  const [flow] = await collection.aggregate([
    { $match: { id } },
    {
      $project: {
        _id: 0,
        id: 1,
        name: 1,
        description: 1,
        status: 1,
        tenantId: 1,
        createdAt: 1,
        updatedAt: 1,
        createdBy: 1,
        version: 1,
        hasPublished: {
          $gt: [
            { $size: { $ifNull: ['$published.nodes', []] } },
            0
          ]
        },
        published: {
          version: '$published.version',
          publishedAt: '$published.publishedAt'
        },
        editorSnapshot: {
          $cond: [
            {
              $gt: [
                { $size: { $ifNull: ['$draft.nodes', []] } },
                0
              ]
            },
            '$draft',
            {
              $ifNull: [
                '$published',
                { nodes: [], edges: [] }
              ]
            }
          ]
        }
      }
    }
  ]).toArray();

  return flow || null;
};

// Endpoint usado pelo editor de fluxo (botão "Validar" no scriptNode). Roda
// exatamente as mesmas regras do AST validator que o save aplica, para evitar
// que o usuário receba "Sintaxe OK" no front e depois um 400 ao salvar.
// Resposta unificada: { ok, reason? }. Sem mensagens distintas para validações
// de sintaxe vs construções proibidas — o reason já carrega o detalhe.
router.post('/validate-script', authenticate, authorize(FLOW_WRITE_ROLES), async (req, res) => {
  try {
    const script = String(req.body?.script || '');
    try {
      validateScript(script);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(200).json({ ok: false, reason: error.message || 'script inválido' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', authenticate, authorize(FLOW_READ_ROLES), requireTenant, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const limitRaw = parseInt(req.query.limit || '0', 10) || 0;
    const limit = limitRaw > 0 ? Math.min(Math.max(limitRaw, 1), 500) : 0;

    if (!limit) {
      const query = {};
      if (req.tenantId && req.tenantId !== 'super_admin') {
        query.tenantId = req.tenantId;
      }
      const flows = await adapter.findMany('flows', {
        query,
        projection: {
          _id: 0,
          draft: 0,
          'published.nodes': 0,
          'published.edges': 0,
          publishHistory: 0
        },
        sort: { updatedAt: -1, createdAt: -1 }
      });
      return res.json((flows || []).map(buildFlowListItem));
    }

    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('flows');
    const query = {};
    if (req.tenantId && req.tenantId !== 'super_admin') {
      query.tenantId = req.tenantId;
    }

    const total = await collection.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const itemsRaw = await collection.aggregate([
      { $match: query },
      { $sort: { updatedAt: -1, createdAt: -1 } },
      { $skip: start },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          id: 1,
          name: 1,
          description: 1,
          status: 1,
          tenantId: 1,
          createdAt: 1,
          updatedAt: 1,
          createdBy: 1,
          version: 1,
          publishHistoryCount: {
            $size: {
              $ifNull: ['$publishHistory', []]
            }
          },
          published: {
            version: '$published.version',
            publishedAt: '$published.publishedAt'
          }
        }
      }
    ]).toArray();

    const items = (itemsRaw || []).map(buildFlowListItem);
    res.json({ items, total, page, totalPages, limit });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', authenticate, authorize(FLOW_READ_ROLES), requireTenant, async (req, res) => {
  try {
    const mode = String(req.query.view || '').trim().toLowerCase();
    const flow = mode === 'editor'
      ? await loadFlowEditorById(req.params.id)
      : await loadFlowById(req.params.id);

    if (!flow || !isFlowAccessible(flow, req)) {
      return res.status(404).json({ error: 'Fluxo nao encontrado' });
    }

    res.json(
      mode === 'editor'
        ? sanitizeEditorFlowForResponse(flow, req)
        : sanitizeFlowForResponse(flow, req)
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/publish-history', authenticate, authorize(FLOW_READ_ROLES), requireTenant, async (req, res) => {
  try {
    const flow = await loadFlowById(req.params.id, { includePublishHistory: true });

    if (!flow || !isFlowAccessible(flow, req)) {
      return res.status(404).json({ error: 'Fluxo nao encontrado' });
    }

    return res.json({
      items: summarizePublishHistory(flow.publishHistory),
      currentPublishedVersion: flow.published?.version || null
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, authorize(FLOW_WRITE_ROLES), requireTenant, async (req, res) => {
  try {
    const data = flowSchema.parse(req.body);

    const flow = {
      id: generateId('f'),
      name: data.name,
      description: data.description || '',
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user?.id || 'system',
      version: 1,
      tenantId: req.user.role === 'SUPER_ADMIN' ? (req.body.tenantId || req.tenantId) : req.tenantId,
      publishHistory: [],
      draft: {
        nodes: [{ id: 'start', type: 'startNode', position: { x: 400, y: 300 }, data: { label: 'Inicio', text: 'Inicio' } }],
        edges: [],
        visualBlocks: []
      },
      published: null
    };

    await ensureTenantLimit(flow.tenantId, 'flows');

    const collection = adapter.db.collection('flows');
    await collection.updateOne(
      { id: flow.id },
      { $set: flow },
      { upsert: true }
    );
    invalidateRuntimeFlowCache(flow.tenantId);

    await createLog('FLOW_ACTION', `Fluxo criado: ${flow.name}`, req.user.id, req.tenantId);
    res.status(201).json(sanitizeFlowForResponse(flow, req));
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, authorize(FLOW_WRITE_ROLES), requireTenant, async (req, res) => {
  try {
    const { nodes, edges, visualBlocks, status, name, description, published } = req.body;
    const flow = await loadFlowById(req.params.id, { includePublishHistory: true });

    if (!flow || !isFlowAccessible(flow, req)) {
      return res.status(404).json({ error: 'Fluxo nao encontrado' });
    }

    const hasGraphPayload = Array.isArray(nodes) && Array.isArray(edges);

    // Defesa primária do scriptNode: rejeita o save quando algum script contém
    // construções proibidas. O editor recebe a lista de nodes problemáticos
    // para destacar visualmente e o ADMIN corrige antes de publicar.
    if (hasGraphPayload) {
      const violations = collectScriptViolations(nodes);
      if (violations) {
        return res.status(400).json({
          error: 'Alguns scripts contêm construções proibidas. Corrija para publicar.',
          code: 'script_validation_failed',
          violations
        });
      }
    }

    const now = new Date().toISOString();
    const nextName = typeof name === 'string' && name.trim() ? name.trim() : flow.name;
    const nextDescription = typeof description === 'string' ? description : flow.description;
    const nextVersion = hasGraphPayload ? (flow.version || 0) + 1 : (flow.version || 1);

    const updatedFlow = {
      ...flow,
      name: nextName,
      description: nextDescription,
      updatedAt: now,
      version: nextVersion
    };

    if (typeof status === 'string' && status.trim()) {
      updatedFlow.status = status;
    }

    // Para cada secretNode no body que vier com value === '***', preservar o
    // ciphertext já gravado no flow existente. Sem isso o usuário que editar
    // qualquer outro campo do flow zeraria os segredos.
    const existingSecretSource = flow.draft?.nodes
      || flow.published?.nodes
      || flow.nodes
      || [];
    const nodesPreserved = hasGraphPayload
      ? preserveSecretPlaceholders(nodes, existingSecretSource)
      : nodes;

    if (hasGraphPayload) {
      const draftSnapshot = cloneSnapshot({ nodes: nodesPreserved, edges, visualBlocks });
      updatedFlow.nodes = draftSnapshot.nodes;
      updatedFlow.edges = draftSnapshot.edges;
      updatedFlow.visualBlocks = draftSnapshot.visualBlocks;
      updatedFlow.draft = draftSnapshot;
    }

    if (published) {
      if (!hasGraphPayload) {
        return res.status(400).json({ error: 'Publicacao exige nodes e edges' });
      }

      const publishedSnapshot = cloneSnapshot({ nodes: nodesPreserved, edges, visualBlocks });
      updatedFlow.published = {
        ...publishedSnapshot,
        publishedAt: now,
        version: updatedFlow.version
      };
      updatedFlow.status = 'published';
      updatedFlow.publishHistory = [
        ...(Array.isArray(flow.publishHistory) ? flow.publishHistory : []),
        createPublishHistoryEntry(updatedFlow, publishedSnapshot, req, updatedFlow.version, {
          name: nextName,
          description: nextDescription,
          publishedAt: now
        })
      ];
    }

    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('flows');
    const updateResult = await collection.updateOne(
      { id: req.params.id },
      { $set: updatedFlow }
    );
    if (!updateResult?.matchedCount) {
      return res.status(404).json({ error: 'Fluxo nao encontrado para salvar' });
    }
    invalidateRuntimeFlowCache(updatedFlow.tenantId, updatedFlow.id);

    await createLog('FLOW_ACTION', `Fluxo atualizado: ${updatedFlow.name}`, req.user.id, req.tenantId);
    res.json(sanitizeFlowForResponse(updatedFlow, req));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/rollback', authenticate, authorize(FLOW_ROLLBACK_ROLES), requireTenant, async (req, res) => {
  try {
    const password = String(req.body?.password || '');
    const historyId = String(req.body?.historyId || '');

    if (!password || !historyId) {
      return res.status(400).json({ error: 'Senha e publicacao sao obrigatorias' });
    }

    const isPasswordValid = await verifyUserPassword(req.user, password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Senha incorreta' });
    }

    const flow = await loadFlowById(req.params.id, { includePublishHistory: true });

    if (!flow || !isFlowAccessible(flow, req)) {
      return res.status(404).json({ error: 'Fluxo nao encontrado' });
    }

    const targetPublication = (Array.isArray(flow.publishHistory) ? flow.publishHistory : [])
      .find((entry) => entry.id === historyId);

    if (!targetPublication?.snapshot) {
      return res.status(404).json({ error: 'Publicacao nao encontrada' });
    }

    const restoredSnapshot = cloneSnapshot(targetPublication.snapshot);
    const now = new Date().toISOString();
    const nextVersion = (flow.version || 0) + 1;
    const nextName = String(targetPublication.name || flow.name || '').trim() || flow.name;
    const nextDescription = typeof targetPublication.description === 'string'
      ? targetPublication.description
      : flow.description;

    const updatedFlow = {
      ...flow,
      name: nextName,
      description: nextDescription,
      nodes: restoredSnapshot.nodes,
      edges: restoredSnapshot.edges,
      visualBlocks: restoredSnapshot.visualBlocks,
      draft: restoredSnapshot,
      published: {
        ...restoredSnapshot,
        publishedAt: now,
        version: nextVersion,
        restoredFromHistoryId: historyId
      },
      publishHistory: [
        ...(Array.isArray(flow.publishHistory) ? flow.publishHistory : []),
        createPublishHistoryEntry(flow, restoredSnapshot, req, nextVersion, {
          name: nextName,
          description: nextDescription,
          publishedAt: now,
          restoredFromHistoryId: historyId,
          restoredFromVersion: targetPublication.version || null
        })
      ],
      status: 'published',
      updatedAt: now,
      version: nextVersion
    };

    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('flows');
    await collection.updateOne(
      { id: req.params.id },
      { $set: updatedFlow }
    );
    invalidateRuntimeFlowCache(updatedFlow.tenantId, updatedFlow.id);

    await createLog(
      'FLOW_ACTION',
      `Fluxo restaurado para publicacao v${targetPublication.version || '?'}: ${updatedFlow.name}`,
      req.user.id
    );

    return res.json(sanitizeFlowForResponse(updatedFlow, req));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, authorize(FLOW_WRITE_ROLES), requireTenant, async (req, res) => {
  try {
    const password = String(req.body?.password || '');
    if (!password) {
      return res.status(400).json({ error: 'Senha obrigatoria' });
    }

    const isPasswordValid = await verifyUserPassword(req.user, password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Senha incorreta' });
    }

    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('flows');

    const query = { id: req.params.id };
    if (req.user.role !== 'SUPER_ADMIN') {
      query.tenantId = req.tenantId;
    } else if (req.tenantId) {
      query.tenantId = req.tenantId;
    }

    const flow = await collection.findOne(query, { projection: { id: 1, name: 1, tenantId: 1 } });
    const result = await collection.deleteOne(query);

    if (!result.deletedCount) {
      return res.json({ message: 'Fluxo ja removido', deleted: null });
    }

    invalidateRuntimeFlowCache(flow?.tenantId || req.tenantId || null, req.params.id);
    await createLog('FLOW_ACTION', `Fluxo removido: ${flow?.name || req.params.id}`, req.user.id);
    res.json({ message: 'Fluxo removido', deleted: flow || { id: req.params.id } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
