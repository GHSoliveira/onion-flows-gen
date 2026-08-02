import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useMemo } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  MiniMap,
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  ReactFlowProvider,
  useReactFlow
} from 'reactflow';
import 'reactflow/dist/style.css';


import {
  MessageSquare, TextCursorInput, Split, FileText,
  Clock, Users, Code, Globe, Hourglass, Hand,
  Database, Anchor, Send, Save, Rocket, Circle,
  Flag, Play, RotateCcw, Star, Command, Image as ImageIcon, Package, Key, Menu as MenuIcon, Smartphone, Settings,
  Copy, Clipboard, Layers3, Trash2, Pencil, Eye, EyeOff, Minimize2, Maximize2, Map as MapIcon, Menu, MonitorPlay
} from 'lucide-react';

import { getJSON, putJSON } from '../services/api';
import toast from 'react-hot-toast';
import NodeConfigModal from '../components/NodeConfigModal';
import * as CustomNodes from '../nodes/CustomNodes';
import CommercialEdge from '../edges/CommercialEdge';
import FlowEdge from '../edges/FlowEdge';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { useDialog } from '../context/DialogContext';

function VisualBlockNode({ data, selected }) {
  const block = data?.block || {};
  const nodeCount = Array.isArray(block.nodeIds) ? block.nodeIds.length : 0;
  const height = block.collapsed ? Math.min(Number(block.bounds?.height || 90), 72) : Number(block.bounds?.height || 90);

  return (
    <div
      className={`relative rounded-3xl border border-dashed transition-all duration-200 ${
        block.hidden
          ? 'bg-transparent'
          : 'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]'
      } ${
        selected ? 'ring-2 ring-blue-400/80 ring-offset-2 ring-offset-transparent' : ''
      } ${block.collapsed ? 'rounded-2xl' : ''}`}
      style={{
        width: Number(block.bounds?.width || 120),
        height,
        borderColor: block.color,
        background: block.hidden ? 'transparent' : block.color,
        opacity: block.hidden ? 1 : (selected ? Math.min(Number(block.opacity || 0.09) + 0.06, 0.28) : Number(block.opacity || 0.09))
      }}
    >
      <button
        type="button"
        onDoubleClick={(event) => {
          event.stopPropagation();
          data?.onRename?.(block.id);
        }}
        className={`nodrag nopan absolute left-4 top-3 select-none rounded-md px-2 py-1 text-left text-lg font-black uppercase tracking-[0.18em] transition-colors ${
          selected
            ? 'bg-white/80 text-slate-700 shadow-sm dark:bg-slate-900/80 dark:text-slate-200'
            : 'text-slate-400/80 hover:bg-white/70 hover:text-slate-600 dark:text-slate-500/80 dark:hover:bg-slate-900/60 dark:hover:text-slate-300'
        }`}
        title="Duplo clique para renomear"
      >
        {block.title}
      </button>

      {selected && (
        <div className="nodrag nopan absolute left-4 top-14 z-20 min-w-[220px] overflow-hidden rounded-xl border border-slate-200/90 bg-white/96 shadow-2xl backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/94 animate-[nodeConfigPop_180ms_ease-out]">
          <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Bloco</p>
            <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
              {nodeCount} nodes vinculados
            </p>
          </div>
          <div className="p-1.5">
            <SelectionActionButton icon={Copy} label="Copiar nodes internos" onClick={() => data?.onCopy?.(block.id)} />
            <SelectionActionButton icon={Clipboard} label="Duplicar bloco" onClick={() => data?.onDuplicate?.(block.id)} />
            <SelectionActionButton
              icon={block.hidden ? Eye : EyeOff}
              label={block.hidden ? 'Mostrar fundo' : 'Ocultar fundo'}
              onClick={() => data?.onToggleHidden?.(block.id)}
            />
            <SelectionActionButton
              icon={block.collapsed ? Maximize2 : Minimize2}
              label={block.collapsed ? 'Expandir bloco' : 'Colapsar bloco'}
              onClick={() => data?.onToggleCollapsed?.(block.id)}
            />
            <SelectionActionButton icon={Pencil} label="Renomear" onClick={() => data?.onRename?.(block.id)} />
            <SelectionActionButton icon={Trash2} label="Remover bloco sem nodes" onClick={() => data?.onRemove?.(block.id)} />
            <SelectionActionButton icon={Trash2} label="Apagar bloco e nodes" onClick={() => data?.onDeleteNodes?.(block.id)} danger />
          </div>
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  visualBlockNode: VisualBlockNode,
  startNode: CustomNodes.StartNode,
  endNode: CustomNodes.EndNode,
  messageNode: CustomNodes.MessageNode,
  inputNode: CustomNodes.InputNode,
  holderNode: CustomNodes.HolderNode,
  setValueNode: CustomNodes.SetValueNode,
  secretNode: CustomNodes.SecretNode,
  conditionNode: CustomNodes.ConditionNode,
  anchorNode: CustomNodes.AnchorNode,
  gotoNode: CustomNodes.GotoNode,
  scriptNode: CustomNodes.ScriptNode,
  finalNode: CustomNodes.FinalNode,
  httpRequestNode: CustomNodes.HttpRequestNode,
  templateNode: CustomNodes.TemplateNode,
  whatsappTemplateNode: CustomNodes.WhatsAppTemplateNode,
  delayNode: CustomNodes.DelayNode,
  queueNode: CustomNodes.QueueNode,
  scheduleNode: CustomNodes.ScheduleNode,
  ratingNode: CustomNodes.RatingNode,
  commandNode: CustomNodes.CommandNode,
  mediaNode: CustomNodes.MediaNode,
  catalogNode: CustomNodes.CatalogNode,
  menuNode: CustomNodes.MenuNode,
  sequentialNode: CustomNodes.SequentialNode,
  commercialNode: CustomNodes.CommercialNode,
  caseNode: CustomNodes.CaseNode
};

const edgeTypes = {
  flowEdge: FlowEdge,
  commercialEdge: CommercialEdge
};

const cloneDeep = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const START_NODE_ID = 'start';
const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 50;
const VISUAL_BLOCK_PADDING = 44;
const VISUAL_BLOCK_COLORS = ['#38bdf8', '#f97316', '#22c55e', '#eab308', '#ec4899', '#8b5cf6'];
const DEFAULT_COMMERCIAL_EASING = 'ease-in-out';
const DEFAULT_COMMERCIAL_MODE = 'forwards';
const DEFAULT_COMMERCIAL_DURATION = 900;
const DEFAULT_COMMERCIAL_SHAPE = 'circle';
const DEFAULT_COMMERCIAL_COLOR = '#f97316';
const DEFAULT_COMMERCIAL_WIDTH = 120;
const DEFAULT_COMMERCIAL_HEIGHT = 120;
const DEFAULT_COMMERCIAL_EDGE_ROUTE = 'bezier';
const DEFAULT_COMMERCIAL_EDGE_STROKE_WIDTH = 2;
const DEFAULT_COMMERCIAL_EDGE_OPACITY = 1;
const DEFAULT_COMMERCIAL_EDGE_DASH_LENGTH = 8;
const DEFAULT_COMMERCIAL_EDGE_DASH_GAP = 6;
const DEFAULT_COMMERCIAL_EDGE_ANIMATION_DURATION = 1400;
const DEFAULT_COMMERCIAL_EDGE_CURVATURE = 0.25;
const DEFAULT_COMMERCIAL_EDGE_ROUTE_OFFSET = 80;
const DEFAULT_COMMERCIAL_EDGE_CORNER_RADIUS = 12;

const clampCommercialSize = (value, fallback = DEFAULT_COMMERCIAL_WIDTH) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(24, Math.min(500, Number(fallback) || DEFAULT_COMMERCIAL_WIDTH));
  return Math.max(24, Math.min(500, numeric));
};

const normalizeCommercialShape = (shape) => {
  const normalized = String(shape || '').trim().toLowerCase();
  if (['circle', 'square', 'rounded', 'rounded-rectangle'].includes(normalized)) {
    return normalized;
  }
  return DEFAULT_COMMERCIAL_SHAPE;
};

const normalizeCommercialColor = (color) => {
  const normalized = String(color || '').trim();
  return normalized || DEFAULT_COMMERCIAL_COLOR;
};

const normalizeCommercialEasing = (value) => {
  const normalized = String(value || '').trim();
  if (['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'].includes(normalized)) {
    return normalized;
  }
  return DEFAULT_COMMERCIAL_EASING;
};

const normalizeCommercialMode = (value) => {
  const normalized = String(value || '').trim();
  if (['forwards', 'backwards', 'both', 'none'].includes(normalized)) {
    return normalized;
  }
  return DEFAULT_COMMERCIAL_MODE;
};

const clampCommercialDuration = (value, fallback = DEFAULT_COMMERCIAL_DURATION) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(100, Math.min(15000, Number(fallback) || DEFAULT_COMMERCIAL_DURATION));
  return Math.max(100, Math.min(15000, numeric));
};

const clampCommercialConnectionNumber = (value, min, max, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
};

const normalizeCommercialConnectionRoute = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['bezier', 'smoothstep', 'straight'].includes(normalized)) return normalized;
  return DEFAULT_COMMERCIAL_EDGE_ROUTE;
};

const normalizeCommercialConnectionStyle = (value = {}, fallbackColor = DEFAULT_COMMERCIAL_COLOR) => ({
  route: normalizeCommercialConnectionRoute(value?.route),
  strokeColor: normalizeCommercialColor(value?.strokeColor ?? fallbackColor),
  strokeWidth: clampCommercialConnectionNumber(
    value?.strokeWidth,
    1,
    8,
    DEFAULT_COMMERCIAL_EDGE_STROKE_WIDTH
  ),
  opacity: clampCommercialConnectionNumber(
    value?.opacity,
    0.2,
    1,
    DEFAULT_COMMERCIAL_EDGE_OPACITY
  ),
  dashed: Boolean(value?.dashed),
  dashLength: clampCommercialConnectionNumber(
    value?.dashLength,
    1,
    48,
    DEFAULT_COMMERCIAL_EDGE_DASH_LENGTH
  ),
  dashGap: clampCommercialConnectionNumber(
    value?.dashGap,
    1,
    48,
    DEFAULT_COMMERCIAL_EDGE_DASH_GAP
  ),
  animated: Boolean(value?.animated),
  animationDurationMs: clampCommercialConnectionNumber(
    value?.animationDurationMs,
    300,
    15000,
    DEFAULT_COMMERCIAL_EDGE_ANIMATION_DURATION
  ),
  sourceOffsetX: clampCommercialConnectionNumber(value?.sourceOffsetX, -400, 400, 0),
  sourceOffsetY: clampCommercialConnectionNumber(value?.sourceOffsetY, -400, 400, 0),
  targetOffsetX: clampCommercialConnectionNumber(value?.targetOffsetX, -400, 400, 0),
  targetOffsetY: clampCommercialConnectionNumber(value?.targetOffsetY, -400, 400, 0),
  curvature: clampCommercialConnectionNumber(
    value?.curvature,
    0,
    1,
    DEFAULT_COMMERCIAL_EDGE_CURVATURE
  ),
  routeOffset: clampCommercialConnectionNumber(
    value?.routeOffset,
    0,
    400,
    DEFAULT_COMMERCIAL_EDGE_ROUTE_OFFSET
  ),
  cornerRadius: clampCommercialConnectionNumber(
    value?.cornerRadius,
    0,
    80,
    DEFAULT_COMMERCIAL_EDGE_CORNER_RADIUS
  )
});

const buildCommercialEdgeVisualStyle = (connectionStyle, baseStyle = {}) => {
  const nextStyle = {
    ...(baseStyle || {}),
    stroke: connectionStyle.strokeColor,
    strokeWidth: connectionStyle.strokeWidth,
    opacity: connectionStyle.opacity
  };

  if (connectionStyle.dashed || connectionStyle.animated) {
    nextStyle.strokeDasharray = `${connectionStyle.dashLength} ${connectionStyle.dashGap}`;
  } else if ('strokeDasharray' in nextStyle) {
    delete nextStyle.strokeDasharray;
  }

  return nextStyle;
};

const getCommercialConnectionStyleFromNode = (node = {}) => {
  const fallbackColor = node?.data?.currentBorderColor ?? node?.data?.borderColor ?? DEFAULT_COMMERCIAL_COLOR;
  return normalizeCommercialConnectionStyle(node?.data?.connectionStyle || {}, fallbackColor);
};

const normalizeCommercialFrame = (frame = {}, fallback = {}, index = 0, isLast = false, fallbackDuration = DEFAULT_COMMERCIAL_DURATION) => ({
  id: String(frame?.id || `kf_${index + 1}`),
  x: Number.isFinite(Number(frame?.x)) ? Number(frame.x) : Number(fallback?.x || 0),
  y: Number.isFinite(Number(frame?.y)) ? Number(frame.y) : Number(fallback?.y || 0),
  width: clampCommercialSize(frame?.width ?? frame?.size, fallback?.width ?? DEFAULT_COMMERCIAL_WIDTH),
  height: clampCommercialSize(frame?.height ?? frame?.size, fallback?.height ?? DEFAULT_COMMERCIAL_HEIGHT),
  shape: normalizeCommercialShape(frame?.shape ?? fallback?.shape),
  borderColor: normalizeCommercialColor(frame?.borderColor ?? fallback?.borderColor),
  segmentDurationMs: isLast ? undefined : clampCommercialDuration(frame?.segmentDurationMs, fallbackDuration),
  segmentEasing: isLast ? undefined : normalizeCommercialEasing(frame?.segmentEasing),
  segmentMode: isLast ? undefined : normalizeCommercialMode(frame?.segmentMode)
});

const normalizeCommercialKeyframes = (data = {}, fallbackState = {}) => {
  const fallbackDuration = clampCommercialDuration(data?.durationMs, DEFAULT_COMMERCIAL_DURATION);
  const fallback = {
    x: Number(fallbackState?.x || 0),
    y: Number(fallbackState?.y || 0),
    width: clampCommercialSize(
      fallbackState?.width ?? data?.currentWidth ?? data?.endWidth ?? data?.endSize ?? data?.size,
      DEFAULT_COMMERCIAL_WIDTH
    ),
    height: clampCommercialSize(
      fallbackState?.height ?? data?.currentHeight ?? data?.endHeight ?? data?.endSize ?? data?.size,
      DEFAULT_COMMERCIAL_HEIGHT
    ),
    shape: normalizeCommercialShape(fallbackState?.shape ?? data?.currentShape ?? data?.shape),
    borderColor: normalizeCommercialColor(fallbackState?.borderColor ?? data?.currentBorderColor ?? data?.borderColor)
  };

  let sourceFrames = Array.isArray(data?.motionKeyframes) ? data.motionKeyframes : [];

  if (sourceFrames.length === 0) {
    const first = {
      id: 'kf_1',
      x: Number(data?.startX ?? data?.currentX ?? fallback.x),
      y: Number(data?.startY ?? data?.currentY ?? fallback.y),
      width: clampCommercialSize(data?.startWidth ?? data?.startSize ?? data?.currentWidth ?? fallback.width, fallback.width),
      height: clampCommercialSize(data?.startHeight ?? data?.startSize ?? data?.currentHeight ?? fallback.height, fallback.height),
      shape: normalizeCommercialShape(data?.startShape ?? data?.currentShape ?? fallback.shape),
      borderColor: normalizeCommercialColor(data?.startBorderColor ?? data?.currentBorderColor ?? fallback.borderColor),
      segmentDurationMs: fallbackDuration,
      segmentEasing: normalizeCommercialEasing(data?.easing),
      segmentMode: normalizeCommercialMode(data?.mode)
    };
    const hasExplicitEnd =
      data?.endX !== undefined
      || data?.endY !== undefined
      || data?.endWidth !== undefined
      || data?.endHeight !== undefined
      || data?.endSize !== undefined
      || data?.endShape !== undefined
      || data?.endBorderColor !== undefined;
    if (hasExplicitEnd) {
      sourceFrames = [
        first,
        {
          id: 'kf_2',
          x: Number(data?.endX ?? first.x),
          y: Number(data?.endY ?? first.y),
          width: clampCommercialSize(data?.endWidth ?? data?.endSize ?? first.width, first.width),
          height: clampCommercialSize(data?.endHeight ?? data?.endSize ?? first.height, first.height),
          shape: normalizeCommercialShape(data?.endShape ?? first.shape),
          borderColor: normalizeCommercialColor(data?.endBorderColor ?? first.borderColor)
        }
      ];
    } else {
      sourceFrames = [first];
    }
  }

  return sourceFrames.map((frame, index) => (
    normalizeCommercialFrame(
      frame,
      fallback,
      index,
      index === sourceFrames.length - 1,
      fallbackDuration
    )
  ));
};

const buildCommercialDataSnapshot = (data = {}, fallbackState = {}) => {
  const keyframes = normalizeCommercialKeyframes(data, fallbackState);
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  const timelineTotalMs = keyframes
    .slice(0, -1)
    .reduce((acc, frame) => acc + clampCommercialDuration(frame.segmentDurationMs, DEFAULT_COMMERCIAL_DURATION), 0);

  const runtimeState = {
    x: Number.isFinite(Number(data?.currentX)) ? Number(data.currentX) : Number(fallbackState?.x ?? last?.x ?? 0),
    y: Number.isFinite(Number(data?.currentY)) ? Number(data.currentY) : Number(fallbackState?.y ?? last?.y ?? 0),
    width: clampCommercialSize(
      data?.currentWidth ?? fallbackState?.width ?? last?.width,
      DEFAULT_COMMERCIAL_WIDTH
    ),
    height: clampCommercialSize(
      data?.currentHeight ?? fallbackState?.height ?? last?.height,
      DEFAULT_COMMERCIAL_HEIGHT
    ),
    shape: normalizeCommercialShape(data?.currentShape ?? fallbackState?.shape ?? last?.shape),
    borderColor: normalizeCommercialColor(data?.currentBorderColor ?? fallbackState?.borderColor ?? last?.borderColor)
  };

  return {
    ...data,
    shape: runtimeState.shape,
    borderColor: runtimeState.borderColor,
    startX: Number(first?.x ?? runtimeState.x),
    startY: Number(first?.y ?? runtimeState.y),
    startWidth: clampCommercialSize(first?.width ?? runtimeState.width, runtimeState.width),
    startHeight: clampCommercialSize(first?.height ?? runtimeState.height, runtimeState.height),
    startSize: clampCommercialSize(first?.width ?? runtimeState.width, runtimeState.width),
    startShape: normalizeCommercialShape(first?.shape ?? runtimeState.shape),
    startBorderColor: normalizeCommercialColor(first?.borderColor ?? runtimeState.borderColor),
    endX: Number(last?.x ?? runtimeState.x),
    endY: Number(last?.y ?? runtimeState.y),
    endWidth: clampCommercialSize(last?.width ?? runtimeState.width, runtimeState.width),
    endHeight: clampCommercialSize(last?.height ?? runtimeState.height, runtimeState.height),
    endSize: clampCommercialSize(last?.width ?? runtimeState.width, runtimeState.width),
    endShape: normalizeCommercialShape(last?.shape ?? runtimeState.shape),
    endBorderColor: normalizeCommercialColor(last?.borderColor ?? runtimeState.borderColor),
    motionKeyframes: keyframes,
    durationMs: Math.max(100, Number(timelineTotalMs || DEFAULT_COMMERCIAL_DURATION)),
    easing: normalizeCommercialEasing(first?.segmentEasing ?? data?.easing),
    mode: normalizeCommercialMode(first?.segmentMode ?? data?.mode),
    connectionStyle: normalizeCommercialConnectionStyle(
      data?.connectionStyle || {},
      runtimeState.borderColor
    ),
    currentX: runtimeState.x,
    currentY: runtimeState.y,
    currentWidth: runtimeState.width,
    currentHeight: runtimeState.height,
    currentShape: runtimeState.shape,
    currentBorderColor: runtimeState.borderColor
  };
};

const getCommercialRuntimeStateFromNode = (node = {}) => {
  const fallbackData = node?.data || {};
  const widthFromNode = Number(node?.width);
  const heightFromNode = Number(node?.height);
  const width = clampCommercialSize(
    Number.isFinite(widthFromNode) ? widthFromNode : fallbackData?.currentWidth,
    DEFAULT_COMMERCIAL_WIDTH
  );
  const height = clampCommercialSize(
    Number.isFinite(heightFromNode) ? heightFromNode : fallbackData?.currentHeight,
    DEFAULT_COMMERCIAL_HEIGHT
  );

  return {
    x: Number(node?.position?.x || 0),
    y: Number(node?.position?.y || 0),
    width,
    height,
    shape: normalizeCommercialShape(fallbackData?.currentShape ?? fallbackData?.shape),
    borderColor: normalizeCommercialColor(fallbackData?.currentBorderColor ?? fallbackData?.borderColor)
  };
};

const withCommercialCurrentState = (node = {}, patch = {}) => {
  if (node?.type !== 'commercialNode') return node;
  const runtime = getCommercialRuntimeStateFromNode(node);
  const mergedRuntime = {
    x: Number.isFinite(Number(patch?.x)) ? Number(patch.x) : runtime.x,
    y: Number.isFinite(Number(patch?.y)) ? Number(patch.y) : runtime.y,
    width: clampCommercialSize(patch?.width, runtime.width),
    height: clampCommercialSize(patch?.height, runtime.height),
    shape: normalizeCommercialShape(patch?.shape ?? runtime.shape),
    borderColor: normalizeCommercialColor(patch?.borderColor ?? runtime.borderColor)
  };

  const snapshot = buildCommercialDataSnapshot(
    {
      ...(node?.data || {}),
      currentX: mergedRuntime.x,
      currentY: mergedRuntime.y,
      currentWidth: mergedRuntime.width,
      currentHeight: mergedRuntime.height,
      currentShape: mergedRuntime.shape,
      currentBorderColor: mergedRuntime.borderColor
    },
    mergedRuntime
  );

  return {
    ...node,
    position: { x: mergedRuntime.x, y: mergedRuntime.y },
    data: {
      ...(node?.data || {}),
      ...snapshot
    }
  };
};

const isCommercialEdgeAllowed = (edge, nodeById) => {
  const sourceType = nodeById.get(edge?.source)?.type;
  const targetType = nodeById.get(edge?.target)?.type;
  const hasCommercial = sourceType === 'commercialNode' || targetType === 'commercialNode';
  if (!hasCommercial) return true;
  return ['commercialNode', 'startNode'].includes(sourceType) && ['commercialNode', 'startNode'].includes(targetType);
};

const createStartNode = () => ({
  id: START_NODE_ID,
  type: 'startNode',
  position: { x: 100, y: 100 },
  data: { text: 'Início' }
});

const dedupeById = (items = []) => {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const id = String(item?.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const formatConditionCaseLabel = (condition = {}) => {
  const value = String(condition?.value || '').trim() || 'Vazio';
  const operator = String(condition?.operator || '==').trim() || '==';

  if (operator === '==') {
    return value;
  }

  const operatorLabel = operator === 'contains' ? 'contém' : operator;
  return `${operatorLabel} ${value}`.trim();
};

const EDGE_HANDLE_LABELS = {
  success: 'OK',
  error: 'Erro',
  else: 'Else'
};

const compactEdgeLabel = (value) => {
  const label = String(value || '').trim();
  if (!label) return '';
  return label.length > 34 ? `${label.slice(0, 31)}...` : label;
};

const getEdgeLabel = (edge = {}, nodeById = new Map()) => {
  const sourceNode = nodeById.get(edge.source);
  const targetNode = nodeById.get(edge.target);
  const sourceHandle = String(edge.sourceHandle || '').trim();
  const targetLabel = String(targetNode?.data?.label || '').trim();

  if (targetNode?.type === 'caseNode' && targetLabel) {
    return compactEdgeLabel(targetLabel);
  }

  if (sourceNode?.type === 'conditionNode') {
    if (sourceHandle === 'else') return 'Else';
    const condition = (Array.isArray(sourceNode?.data?.conditions) ? sourceNode.data.conditions : [])
      .find((item) => String(item?.id) === sourceHandle);
    return compactEdgeLabel(formatConditionCaseLabel(condition));
  }

  if (sourceNode?.type === 'menuNode') {
    const option = (Array.isArray(sourceNode?.data?.options) ? sourceNode.data.options : [])
      .find((item) => String(item?.id) === sourceHandle);
    return compactEdgeLabel(option?.label || option?.value || EDGE_HANDLE_LABELS[sourceHandle]);
  }

  const button = (Array.isArray(sourceNode?.data?.buttons) ? sourceNode.data.buttons : [])
    .find((item) => String(item?.id || item?.payload || item?.value) === sourceHandle);
  if (button) return compactEdgeLabel(button.label || button.text || button.title || button.value);

  return compactEdgeLabel(EDGE_HANDLE_LABELS[sourceHandle]);
};

const getFlowEdgeTone = (edge = {}) => {
  const sourceHandle = String(edge.sourceHandle || '').trim().toLowerCase();
  if (sourceHandle === 'error') return 'error';
  if (sourceHandle === 'else') return 'muted';
  return 'default';
};

const buildActiveEdgeState = (graphNodes = [], graphEdges = []) => {
  const selectedNode = graphNodes.find((node) => node?.selected && !String(node?.id || '').startsWith('visual_block_'));
  if (!selectedNode) {
    return {
      selectedNodeId: null,
      edgeIds: new Set()
    };
  }

  const incomingByTarget = new Map();
  graphEdges.forEach((edge) => {
    if (!incomingByTarget.has(edge.target)) incomingByTarget.set(edge.target, []);
    incomingByTarget.get(edge.target).push(edge);
  });

  const edgeIds = new Set();
  const visitedNodes = new Set();
  const stack = [selectedNode.id];

  while (stack.length) {
    const nodeId = stack.pop();
    if (visitedNodes.has(nodeId)) continue;
    visitedNodes.add(nodeId);
    (incomingByTarget.get(nodeId) || []).forEach((edge) => {
      edgeIds.add(edge.id);
      if (edge.source) stack.push(edge.source);
    });
  }

  graphEdges
    .filter((edge) => edge.source === selectedNode.id)
    .forEach((edge) => edgeIds.add(edge.id));

  return {
    selectedNodeId: selectedNode.id,
    edgeIds
  };
};

const syncConditionCaseNodeLabels = (graphNodes = []) => {
  const labelsByNodeId = new Map();

  (Array.isArray(graphNodes) ? graphNodes : []).forEach((node) => {
    if (node?.type !== 'conditionNode') return;

    const conditions = Array.isArray(node?.data?.conditions) ? node.data.conditions : [];
    conditions.forEach((condition) => {
      labelsByNodeId.set(`child_${node.id}_${String(condition.id)}`, formatConditionCaseLabel(condition));
    });

    if (node?.data?.hasElse !== false) {
      labelsByNodeId.set(`child_${node.id}_else`, 'Else');
    }
  });

  return (Array.isArray(graphNodes) ? graphNodes : []).map((node) => {
    if (node?.type !== 'caseNode') return node;
    const nextLabel = labelsByNodeId.get(node.id);
    if (!nextLabel || node?.data?.label === nextLabel) return node;
    return {
      ...node,
      data: {
        ...node.data,
        label: nextLabel
      }
    };
  });
};

const getNodeBox = (node = {}) => {
  const width = Number(node.width || node.measured?.width || node.style?.width || DEFAULT_NODE_WIDTH);
  const height = Number(node.height || node.measured?.height || node.style?.height || DEFAULT_NODE_HEIGHT);
  return {
    x: Number(node.position?.x || 0),
    y: Number(node.position?.y || 0),
    width: Number.isFinite(width) ? width : DEFAULT_NODE_WIDTH,
    height: Number.isFinite(height) ? height : DEFAULT_NODE_HEIGHT
  };
};

const getNodesBounds = (items = []) => {
  const boxes = (Array.isArray(items) ? items : []).map(getNodeBox);
  if (!boxes.length) return null;

  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    right,
    bottom,
    centerX: left + (right - left) / 2,
    centerY: top + (bottom - top) / 2
  };
};

const normalizeVisualBlocks = (items = []) => (
  (Array.isArray(items) ? items : [])
    .map((block, index) => {
      const bounds = block?.bounds || {};
      const width = Number(bounds.width || 0);
      const height = Number(bounds.height || 0);
      const x = Number(bounds.x || 0);
      const y = Number(bounds.y || 0);
      return {
        id: String(block?.id || `block_${Date.now()}_${index}`),
        title: String(block?.title || '## Novo bloco').trim() || '## Novo bloco',
        color: String(block?.color || VISUAL_BLOCK_COLORS[index % VISUAL_BLOCK_COLORS.length]),
        opacity: Math.max(0.04, Math.min(0.22, Number(block?.opacity ?? 0.09))),
        bounds: {
          x: Number.isFinite(x) ? x : 0,
          y: Number.isFinite(y) ? y : 0,
          width: Math.max(120, Number.isFinite(width) ? width : 120),
          height: Math.max(90, Number.isFinite(height) ? height : 90)
        },
        nodeIds: Array.isArray(block?.nodeIds) ? block.nodeIds.map(String).filter(Boolean) : [],
        hidden: false,
        collapsed: false
      };
    })
);

const toScreenPoint = (point, viewport) => ({
  x: viewport.x + point.x * viewport.zoom,
  y: viewport.y + point.y * viewport.zoom
});

const FlowEditor = () => {
  const { id } = useParams();
  const { getNodes, getViewport, fitView, setCenter } = useReactFlow();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const { confirm } = useDialog();
  const isManager = user?.role === 'MANAGER';
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const toolbarScrollRef = useRef(null);
  const toolbarTrackRef = useRef(null);
  const toolbarDragRef = useRef({
    active: false,
    startClientX: 0,
    startOffset: 0
  });
  const copiedSelectionRef = useRef(null);
  const pasteCountRef = useRef(0);
  const visualBlockDragRef = useRef(null);
  const commercialAnimationEndRef = useRef(null);
  const supportDataPromisesRef = useRef({
    catalog: null,
    media: null,
    whatsapp: null
  });


  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {

    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const [nodes, setNodes] = useState([]);
  const [visualBlocks, setVisualBlocks] = useState([]);
  const [visualBlockModal, setVisualBlockModal] = useState({
    open: false,
    mode: 'create',
    title: '',
    blockId: null,
    blockDraft: null
  });
  const [selectedVisualBlockId, setSelectedVisualBlockId] = useState(null);
  const [selectionActionsOpen, setSelectionActionsOpen] = useState(false);
  const [canvasMenuOpen, setCanvasMenuOpen] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [queues, setQueues] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [mediaAssets, setMediaAssets] = useState([]);
  const [edges, setEdges] = useState([]);
  const [vars, setVars] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [whatsappTemplates, setWhatsappTemplates] = useState([]);
  const [whatsappInteractiveTemplates, setWhatsappInteractiveTemplates] = useState([]);
  const [whatsappSenderOptions, setWhatsappSenderOptions] = useState([]);
  const [whatsappChannelReady, setWhatsappChannelReady] = useState(false);
  const [schedules, setSchedules] = useState([]);
  const [flowName, setFlowName] = useState('');
  const [configModal, setConfigModal] = useState({ open: false, nodeId: null });
  const [inactivityModalOpen, setInactivityModalOpen] = useState(false);
  const [inactivityConfig, setInactivityConfig] = useState({
    inactivityMaxHours: 8,
    inactivityMessage: 'Atendimento encerrado por inatividade.'
  });
  const [inactivitySaving, setInactivitySaving] = useState(false);
  const [hideCommercialGhostsGlobal, setHideCommercialGhostsGlobal] = useState(false);
  const [toolbarScrollbar, setToolbarScrollbar] = useState({
    visible: false,
    thumbWidth: 0,
    thumbOffset: 0
  });

  useEffect(() => {
    const currentFlowName = String(flowName || '').trim() || 'Editor de Fluxo';
    const currentTenantName = String(tenant?.name || '').trim() || 'Onion Flows';
    document.title = `${currentFlowName} - ${currentTenantName}`;
  }, [flowName, tenant?.name]);

  const ensureCatalogItems = useCallback(async () => {
    if (catalogItems.length > 0) return catalogItems;
    if (supportDataPromisesRef.current.catalog) {
      return supportDataPromisesRef.current.catalog;
    }

    supportDataPromisesRef.current.catalog = getJSON('/catalog/items?active=all&limit=500')
      .then((data) => {
        const nextItems = Array.isArray(data) ? data : (data?.items || []);
        setCatalogItems(nextItems);
        return nextItems;
      })
      .catch((error) => {
        console.error(error);
        return [];
      })
      .finally(() => {
        supportDataPromisesRef.current.catalog = null;
      });

    return supportDataPromisesRef.current.catalog;
  }, [catalogItems]);

  const ensureMediaAssets = useCallback(async () => {
    if (mediaAssets.length > 0) return mediaAssets;
    if (supportDataPromisesRef.current.media) {
      return supportDataPromisesRef.current.media;
    }

    supportDataPromisesRef.current.media = getJSON('/media/assets?limit=500')
      .then((data) => {
        const nextAssets = Array.isArray(data) ? data : (data?.items || []);
        setMediaAssets(nextAssets);
        return nextAssets;
      })
      .catch((error) => {
        console.error(error);
        return [];
      })
      .finally(() => {
        supportDataPromisesRef.current.media = null;
      });

    return supportDataPromisesRef.current.media;
  }, [mediaAssets]);

  const ensureWhatsAppEditorData = useCallback(async () => {
    if ((whatsappTemplates.length > 0 || whatsappInteractiveTemplates.length > 0 || whatsappChannelReady) && !supportDataPromisesRef.current.whatsapp) {
      return {
        templates: whatsappTemplates,
        interactive: whatsappInteractiveTemplates
      };
    }
    if (supportDataPromisesRef.current.whatsapp) {
      return supportDataPromisesRef.current.whatsapp;
    }

    supportDataPromisesRef.current.whatsapp = Promise.all([
      getJSON('/templates/whatsapp').catch(() => ({ items: [], channelConfig: {} })),
      getJSON('/templates/whatsapp/interactive').catch(() => ({ items: [] }))
    ])
      .then(([templateData, interactiveData]) => {
        const approvedTemplates = Array.isArray(templateData?.items) ? templateData.items : [];
        const interactiveTemplates = Array.isArray(interactiveData?.items) ? interactiveData.items : [];
        setWhatsappTemplates(approvedTemplates);
        setWhatsappInteractiveTemplates(interactiveTemplates);
        setWhatsappSenderOptions(Array.isArray(templateData?.channelConfig?.senderNumbers) ? templateData.channelConfig.senderNumbers : []);
        setWhatsappChannelReady(Boolean(templateData?.channelConfig?.ready));
        return {
          templates: approvedTemplates,
          interactive: interactiveTemplates
        };
      })
      .catch((error) => {
        console.error(error);
        return { templates: [], interactive: [] };
      })
      .finally(() => {
        supportDataPromisesRef.current.whatsapp = null;
      });

    return supportDataPromisesRef.current.whatsapp;
  }, [whatsappChannelReady, whatsappInteractiveTemplates, whatsappTemplates]);

  const updateToolbarScrollbar = useCallback(() => {
    const element = toolbarScrollRef.current;
    if (!element) return;

    const { clientWidth, scrollWidth, scrollLeft } = element;
    const hasOverflow = scrollWidth - clientWidth > 1;

    if (!hasOverflow) {
      setToolbarScrollbar((current) => (
        current.visible || current.thumbWidth || current.thumbOffset
          ? { visible: false, thumbWidth: 0, thumbOffset: 0 }
          : current
      ));
      return;
    }

    const rawThumbWidth = (clientWidth / scrollWidth) * clientWidth;
    const thumbWidth = Math.max(40, Math.min(clientWidth, rawThumbWidth));
    const maxScroll = Math.max(scrollWidth - clientWidth, 1);
    const maxOffset = Math.max(clientWidth - thumbWidth, 0);
    const thumbOffset = (scrollLeft / maxScroll) * maxOffset;

    setToolbarScrollbar((current) => {
      const sameWidth = Math.abs(current.thumbWidth - thumbWidth) < 0.5;
      const sameOffset = Math.abs(current.thumbOffset - thumbOffset) < 0.5;
      if (current.visible && sameWidth && sameOffset) {
        return current;
      }
      return { visible: true, thumbWidth, thumbOffset };
    });
  }, []);

  const scrollToolbarToThumbOffset = useCallback((nextThumbOffset) => {
    const element = toolbarScrollRef.current;
    const track = toolbarTrackRef.current;
    if (!element || !track) return;

    const trackWidth = track.clientWidth;
    const maxScroll = Math.max(element.scrollWidth - element.clientWidth, 0);
    const maxOffset = Math.max(trackWidth - toolbarScrollbar.thumbWidth, 0);

    if (maxScroll <= 0 || maxOffset <= 0) {
      element.scrollLeft = 0;
      return;
    }

    const clampedOffset = Math.min(Math.max(nextThumbOffset, 0), maxOffset);
    element.scrollLeft = (clampedOffset / maxOffset) * maxScroll;
  }, [toolbarScrollbar.thumbWidth]);

  const handleToolbarWheel = useCallback((event) => {
    const element = toolbarScrollRef.current;
    if (!element) return;

    const hasOverflow = element.scrollWidth - element.clientWidth > 1;
    if (!hasOverflow) return;

    const primaryDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (primaryDelta === 0) return;

    event.preventDefault();
    element.scrollLeft += primaryDelta;
  }, []);

  const stopToolbarDrag = useCallback(() => {
    if (!toolbarDragRef.current.active) return;
    toolbarDragRef.current.active = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, []);

  const handleToolbarThumbPointerDown = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();

    toolbarDragRef.current = {
      active: true,
      startClientX: event.clientX,
      startOffset: toolbarScrollbar.thumbOffset
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
  }, [toolbarScrollbar.thumbOffset]);

  const handleToolbarTrackPointerDown = useCallback((event) => {
    if (event.target !== event.currentTarget) return;

    const track = toolbarTrackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    const targetOffset = event.clientX - rect.left - (toolbarScrollbar.thumbWidth / 2);
    scrollToolbarToThumbOffset(targetOffset);

    toolbarDragRef.current = {
      active: true,
      startClientX: event.clientX,
      startOffset: Math.min(
        Math.max(targetOffset, 0),
        Math.max(track.clientWidth - toolbarScrollbar.thumbWidth, 0)
      )
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
  }, [scrollToolbarToThumbOffset, toolbarScrollbar.thumbWidth]);

  useEffect(() => {
    const element = toolbarScrollRef.current;
    if (!element) return undefined;

    const scheduleUpdate = () => {
      window.requestAnimationFrame(updateToolbarScrollbar);
    };

    scheduleUpdate();
    element.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleUpdate)
      : null;

    resizeObserver?.observe(element);

    return () => {
      element.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [isManager, updateToolbarScrollbar]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!toolbarDragRef.current.active) return;
      const deltaX = event.clientX - toolbarDragRef.current.startClientX;
      scrollToolbarToThumbOffset(toolbarDragRef.current.startOffset + deltaX);
    };

    const handlePointerUp = () => {
      stopToolbarDrag();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      stopToolbarDrag();
    };
  }, [scrollToolbarToThumbOffset, stopToolbarDrag]);

  const openConfig = useCallback((nodeId) => {

    const currentNode = getNodes().find(n => n.id === nodeId);
    if (currentNode) {
      if (user?.role === 'MANAGER' && currentNode.type === 'secretNode') {
        toast.error("Você não tem permissão para acessar Secrets.");
        return;
      }
      if (currentNode.type === 'commercialNode' && !isSuperAdmin) {
        toast.error("Apenas SUPER_ADMIN pode editar nos comerciais.");
        return;
      }
      if (currentNode.type === 'catalogNode') {
        ensureCatalogItems();
      }
      if (currentNode.type === 'mediaNode') {
        ensureMediaAssets();
      }
      if (currentNode.type === 'whatsappTemplateNode') {
        ensureWhatsAppEditorData();
      }
      setConfigModal({ open: true, nodeId });
    }
  }, [ensureCatalogItems, ensureMediaAssets, ensureWhatsAppEditorData, getNodes, isSuperAdmin, user?.role]);

  const updateNodeData = useCallback((nodeId, newData) => {
    setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...newData } } : n));
  }, []);

  const deleteNode = useCallback((nodeId) => {
    if (nodeId === START_NODE_ID) return toast.error("O nó de início é protegido.");
    setNodes((nds) => nds.filter((n) => n.id !== nodeId && !n.id.startsWith(`child_${nodeId}`)));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
  }, []);

  const handleCommercialResize = useCallback((nodeId, resizePayload = {}) => {
    setNodes((nds) => nds.map((node) => {
      if (node.id !== nodeId || node.type !== 'commercialNode') return node;
      return withCommercialCurrentState(node, {
        x: resizePayload?.x,
        y: resizePayload?.y,
        width: resizePayload?.width,
        height: resizePayload?.height
      });
    }));
  }, []);

  const hydrateNode = useCallback((node, vData, tData, sData) => {
    const baseData = node?.type === 'commercialNode'
      ? buildCommercialDataSnapshot(
        node?.data || {},
        getCommercialRuntimeStateFromNode(node)
      )
      : (node?.data || {});

    return {
      ...node,
      data: {
        ...baseData,
        availableVars: vData,
        availableTemplates: tData,
        availableSchedules: sData,
        onDelete: deleteNode,
        onConfig: (id) => openConfig(id),
        onChange: (v) => updateNodeData(node.id, { text: v }),
        ...(node.type === 'commercialNode'
          ? {
            hideCommercialGhostsGlobal,
            onCommercialAnimationEnd: (targetNodeId, playKey, finalFrame) => {
              if (typeof commercialAnimationEndRef.current === 'function') {
                commercialAnimationEndRef.current(targetNodeId, playKey, finalFrame);
              }
            },
            onCommercialResize: (targetNodeId, resizePayload) => {
              handleCommercialResize(targetNodeId, resizePayload);
            }
          }
          : {})
      }
    };
  }, [deleteNode, handleCommercialResize, hideCommercialGhostsGlobal, openConfig, updateNodeData]);

  const sanitizeNodeData = useCallback((data = {}) => {
    const {
      availableVars,
      availableTemplates,
      availableSchedules,
      onDelete,
      onConfig,
      onChange,
      onCommercialAnimationEnd,
      onCommercialResize,
      hideCommercialGhostsGlobal,
      animationPlayKey,
      lastSpawnPlayKey,
      ...cleanData
    } = data;

    return cloneDeep(cleanData);
  }, []);

  const handleCommercialAnimationEnd = useCallback((nodeId, playKey, finalFrame = null) => {
    let generatedEdges = [];

    setNodes((currentNodes) => {
      const sourceNode = currentNodes.find((node) => node.id === nodeId);
      if (!sourceNode || sourceNode.type !== 'commercialNode') {
        return currentNodes;
      }

      const runtimeState = getCommercialRuntimeStateFromNode(sourceNode);
      const sourceData = buildCommercialDataSnapshot(sourceNode.data || {}, runtimeState);
      const lastFrame = sourceData.motionKeyframes[sourceData.motionKeyframes.length - 1];
      const resolvedFinal = finalFrame
        ? normalizeCommercialFrame(
          finalFrame,
          {
            x: lastFrame?.x ?? runtimeState.x,
            y: lastFrame?.y ?? runtimeState.y,
            width: lastFrame?.width ?? runtimeState.width,
            height: lastFrame?.height ?? runtimeState.height,
            shape: lastFrame?.shape ?? runtimeState.shape,
            borderColor: lastFrame?.borderColor ?? runtimeState.borderColor
          },
          0,
          true,
          DEFAULT_COMMERCIAL_DURATION
        )
        : lastFrame;

      const nodeAtFinal = withCommercialCurrentState(sourceNode, {
        x: resolvedFinal?.x,
        y: resolvedFinal?.y,
        width: resolvedFinal?.width,
        height: resolvedFinal?.height,
        shape: resolvedFinal?.shape,
        borderColor: resolvedFinal?.borderColor
      });
      const finalData = buildCommercialDataSnapshot(
        nodeAtFinal.data || {},
        getCommercialRuntimeStateFromNode(nodeAtFinal)
      );

      if (!finalData.spawnOnComplete || String(finalData.lastSpawnPlayKey || '') === String(playKey || '')) {
        return currentNodes.map((node) => (
          node.id === nodeId
            ? hydrateNode(
              {
                ...nodeAtFinal,
                data: {
                  ...nodeAtFinal.data,
                  animationPlayKey: ''
                }
              },
              vars,
              templates,
              schedules
            )
            : node
        ));
      }

      const sourceGeneration = Number(finalData.generation || 0);
      const maxDepth = Math.max(1, Math.min(4, Number(finalData.spawnDepth || 1)));
      if (sourceGeneration >= maxDepth) {
        return currentNodes.map((node) => {
          if (node.id !== nodeId) return node;
          return hydrateNode(
            {
              ...nodeAtFinal,
              data: {
                ...nodeAtFinal.data,
                lastSpawnPlayKey: playKey,
                animationPlayKey: ''
              }
            },
            vars,
            templates,
            schedules
          );
        });
      }

      const spawnCount = Math.max(1, Math.min(8, Number(finalData.spawnCount || 1)));
      const spacingX = Number(finalData.spawnSpacingX || 180);
      const spacingY = Number(finalData.spawnSpacingY || 0);
      const baseTime = Date.now();
      let previousId = sourceNode.id;
      const spawnedNodes = [];
      const originFrame = finalData.motionKeyframes[finalData.motionKeyframes.length - 1];
      const spawnConnectionStyle = normalizeCommercialConnectionStyle(
        finalData?.connectionStyle || {},
        finalData?.currentBorderColor ?? finalData?.borderColor ?? DEFAULT_COMMERCIAL_COLOR
      );

      for (let index = 0; index < spawnCount; index += 1) {
        const newId = `commercialNode_${baseTime}_${index}`;
        const posX = Math.round(Number(originFrame?.x || sourceNode.position.x) + spacingX * (index + 1));
        const posY = Math.round(Number(originFrame?.y || sourceNode.position.y) + spacingY * (index + 1));
        const rawData = {
          text: finalData.text || '',
          customName: '',
          shape: String(originFrame?.shape || finalData.currentShape || DEFAULT_COMMERCIAL_SHAPE),
          borderColor: originFrame?.borderColor || finalData.currentBorderColor || DEFAULT_COMMERCIAL_COLOR,
          durationMs: Number(finalData.durationMs || DEFAULT_COMMERCIAL_DURATION),
          easing: String(finalData.easing || DEFAULT_COMMERCIAL_EASING),
          mode: String(finalData.mode || DEFAULT_COMMERCIAL_MODE),
          motionKeyframes: [
            {
              id: `kf_${newId}_1`,
              x: Number(originFrame?.x || sourceNode.position.x),
              y: Number(originFrame?.y || sourceNode.position.y),
              width: clampCommercialSize(originFrame?.width, DEFAULT_COMMERCIAL_WIDTH),
              height: clampCommercialSize(originFrame?.height, DEFAULT_COMMERCIAL_HEIGHT),
              shape: normalizeCommercialShape(originFrame?.shape || finalData.currentShape),
              borderColor: normalizeCommercialColor(originFrame?.borderColor || finalData.currentBorderColor),
              segmentDurationMs: Number(finalData.durationMs || DEFAULT_COMMERCIAL_DURATION),
              segmentEasing: String(finalData.easing || DEFAULT_COMMERCIAL_EASING),
              segmentMode: String(finalData.mode || DEFAULT_COMMERCIAL_MODE)
            },
            {
              id: `kf_${newId}_2`,
              x: posX,
              y: posY,
              width: clampCommercialSize(originFrame?.width, DEFAULT_COMMERCIAL_WIDTH),
              height: clampCommercialSize(originFrame?.height, DEFAULT_COMMERCIAL_HEIGHT),
              shape: normalizeCommercialShape(originFrame?.shape || finalData.currentShape),
              borderColor: normalizeCommercialColor(originFrame?.borderColor || finalData.currentBorderColor)
            }
          ],
          currentX: Number(originFrame?.x || sourceNode.position.x),
          currentY: Number(originFrame?.y || sourceNode.position.y),
          currentWidth: clampCommercialSize(originFrame?.width, DEFAULT_COMMERCIAL_WIDTH),
          currentHeight: clampCommercialSize(originFrame?.height, DEFAULT_COMMERCIAL_HEIGHT),
          currentShape: normalizeCommercialShape(originFrame?.shape || finalData.currentShape),
          currentBorderColor: normalizeCommercialColor(originFrame?.borderColor || finalData.currentBorderColor),
          spawnOnComplete: Boolean(finalData.spawnOnComplete),
          spawnCount,
          spawnDepth: maxDepth,
          spawnSpacingX: spacingX,
          spawnSpacingY: spacingY,
          generation: sourceGeneration + 1,
          animationPlayKey: playKey
        };
        const nextData = buildCommercialDataSnapshot(rawData, { x: posX, y: posY });

        const hydrated = hydrateNode({
          id: newId,
          type: 'commercialNode',
          position: { x: Number(nextData.currentX || posX), y: Number(nextData.currentY || posY) },
          data: nextData
        }, vars, templates, schedules);

        spawnedNodes.push(hydrated);
        generatedEdges.push({
          id: `edge_commercial_spawn_${baseTime}_${index}`,
          source: previousId,
          sourceHandle: 'default',
          target: newId,
          targetHandle: null,
          type: 'commercialEdge',
          data: {
            commercial: spawnConnectionStyle
          },
          style: buildCommercialEdgeVisualStyle(spawnConnectionStyle)
        });
        previousId = newId;
      }

      if (!spawnedNodes.length) {
        return currentNodes;
      }

      const nextNodes = currentNodes.map((node) => {
        if (node.id !== nodeId) return node;
        return hydrateNode(
          {
            ...nodeAtFinal,
            data: {
              ...nodeAtFinal.data,
              lastSpawnPlayKey: playKey,
              animationPlayKey: ''
            }
          },
          vars,
          templates,
          schedules
        );
      });

      return [...nextNodes, ...spawnedNodes];
    });

    if (generatedEdges.length > 0) {
      setEdges((currentEdges) => {
        const existingIds = new Set(currentEdges.map((edge) => edge.id));
        const uniqueEdges = generatedEdges.filter((edge) => !existingIds.has(edge.id));
        if (!uniqueEdges.length) return currentEdges;
        return [...currentEdges, ...uniqueEdges];
      });
    }
  }, [hydrateNode, schedules, templates, vars]);

  useEffect(() => {
    commercialAnimationEndRef.current = handleCommercialAnimationEnd;
  }, [handleCommercialAnimationEnd]);

  const triggerCommercialAnimation = useCallback(() => {
    const playKey = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    setNodes((currentNodes) => {
      let changed = false;
      const updated = currentNodes.map((node) => {
        if (node.type !== 'commercialNode') return node;

        const runtime = getCommercialRuntimeStateFromNode(node);
        const snapshot = buildCommercialDataSnapshot(
          {
            ...(node.data || {}),
            currentX: runtime.x,
            currentY: runtime.y,
            currentWidth: runtime.width,
            currentHeight: runtime.height,
            currentShape: runtime.shape,
            currentBorderColor: runtime.borderColor
          },
          runtime
        );

        changed = true;
        return {
          ...node,
          data: {
            ...snapshot,
            animationPlayKey: playKey,
          }
        };
      });

      return changed ? updated : currentNodes;
    });
  }, []);

  const resetCommercialTimeline = useCallback(() => {
    let changed = false;
    setNodes((currentNodes) => {
      const updated = currentNodes.map((node) => {
        if (node.type !== 'commercialNode') return node;
        const runtime = getCommercialRuntimeStateFromNode(node);
        const snapshot = buildCommercialDataSnapshot(node.data || {}, runtime);
        const firstFrame = snapshot.motionKeyframes?.[0];
        if (!firstFrame) return node;

        const resetNode = withCommercialCurrentState(
          {
            ...node,
            data: {
              ...node.data,
              ...snapshot,
              animationPlayKey: ''
            }
          },
          {
            x: firstFrame.x,
            y: firstFrame.y,
            width: firstFrame.width,
            height: firstFrame.height,
            shape: firstFrame.shape,
            borderColor: firstFrame.borderColor
          }
        );
        const finalSnapshot = buildCommercialDataSnapshot(
          {
            ...resetNode.data,
            animationPlayKey: ''
          },
          getCommercialRuntimeStateFromNode(resetNode)
        );
        changed = true;
        return hydrateNode(
          {
            ...resetNode,
            data: {
              ...resetNode.data,
              ...finalSnapshot,
              animationPlayKey: ''
            }
          },
          vars,
          templates,
          schedules
        );
      });
      return changed ? updated : currentNodes;
    });
    if (changed) {
      toast.success('Linha do tempo reiniciada para o frame inicial.');
    }
  }, [hydrateNode, schedules, templates, vars]);

  const normalizeGraphStructure = useCallback((graphNodes = [], graphEdges = []) => {
    const dedupedNodes = dedupeById(graphNodes);
    const nodesWithStart = dedupedNodes.some((node) => node.id === START_NODE_ID)
      ? dedupedNodes
      : [createStartNode(), ...dedupedNodes];
    const normalizedNodes = syncConditionCaseNodeLabels(nodesWithStart);
    const validNodeIds = new Set(normalizedNodes.map((node) => node.id));
    const nodeById = new Map(normalizedNodes.map((node) => [node.id, node]));
    const normalizedEdges = dedupeById(graphEdges)
      .filter(
        (edge) => validNodeIds.has(edge.source)
          && validNodeIds.has(edge.target)
          && isCommercialEdgeAllowed(edge, nodeById)
      )
      .map((edge) => {
        const sourceNode = nodeById.get(edge.source);
        const targetNode = nodeById.get(edge.target);
        const hasCommercial = sourceNode?.type === 'commercialNode' || targetNode?.type === 'commercialNode';
        if (!hasCommercial) return edge;

        const styleNode = sourceNode?.type === 'commercialNode' ? sourceNode : targetNode;
        const connectionStyle = normalizeCommercialConnectionStyle(
          edge?.data?.commercial || styleNode?.data?.connectionStyle,
          styleNode?.data?.currentBorderColor ?? styleNode?.data?.borderColor ?? DEFAULT_COMMERCIAL_COLOR
        );

        return {
          ...edge,
          type: 'commercialEdge',
          data: {
            ...(edge?.data || {}),
            commercial: connectionStyle
          },
          style: buildCommercialEdgeVisualStyle(connectionStyle, edge?.style || {})
        };
      });

    return {
      nodes: normalizedNodes,
      edges: normalizedEdges
    };
  }, []);

  const getSelectedNodes = useCallback(() => nodes.filter((node) => node.selected), [nodes]);

  const copyNodesToClipboard = useCallback((selectedNodes = [], options = {}) => {
    const nodesToCopy = (Array.isArray(selectedNodes) ? selectedNodes : [])
      .filter((node) => node && node.id !== START_NODE_ID);

    if (!nodesToCopy.length) {
      if (options.showStartError) {
        toast.error('O no de inicio nao pode ser copiado.');
      }
      return false;
    }

    const selectedIds = new Set(nodesToCopy.map((node) => node.id));
    const originX = Math.min(...nodesToCopy.map((node) => node.position.x));
    const originY = Math.min(...nodesToCopy.map((node) => node.position.y));

    const copiedNodes = nodesToCopy.map((node) => {
      const {
        data,
        selected,
        dragging,
        positionAbsolute,
        measured,
        hidden,
        ...rest
      } = node;

      return {
        ...cloneDeep(rest),
        id: node.id,
        position: {
          x: node.position.x - originX,
          y: node.position.y - originY
        },
        data: sanitizeNodeData(data)
      };
    });

    const copiedEdges = edges
      .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
      .map(({ selected, hidden, ...edge }) => cloneDeep(edge));

    copiedSelectionRef.current = {
      origin: { x: originX, y: originY },
      nodes: copiedNodes,
      edges: copiedEdges
    };
    pasteCountRef.current = 0;

    if (options.toast !== false) {
      toast.success(
        nodesToCopy.length > 1
          ? `${nodesToCopy.length} nos copiados`
          : 'No copiado'
      );
    }

    return {
      nodeIds: nodesToCopy.map((node) => node.id),
      origin: { x: originX, y: originY }
    };
  }, [edges, sanitizeNodeData]);

  const createVisualBlockFromSelection = useCallback(() => {
    const selectedNodes = getSelectedNodes().filter((node) => node.id !== START_NODE_ID);
    if (!selectedNodes.length) {
      toast.error('Selecione ao menos um no alem do inicio.');
      return false;
    }

    const bounds = getNodesBounds(selectedNodes);
    if (!bounds) return false;

    const blockIndex = visualBlocks.length;
    const blockDraft = {
      id: `block_${Date.now()}`,
      title: '## Comandos',
      color: VISUAL_BLOCK_COLORS[blockIndex % VISUAL_BLOCK_COLORS.length],
      opacity: 0.09,
      bounds: {
        x: bounds.x - VISUAL_BLOCK_PADDING,
        y: bounds.y - VISUAL_BLOCK_PADDING,
        width: bounds.width + VISUAL_BLOCK_PADDING * 2,
        height: bounds.height + VISUAL_BLOCK_PADDING * 2
      },
      nodeIds: selectedNodes.map((node) => node.id)
    };

    setVisualBlockModal({
      open: true,
      mode: 'create',
      title: 'Comandos',
      blockId: null,
      blockDraft
    });
    setSelectionActionsOpen(false);
    return true;
  }, [getSelectedNodes, visualBlocks.length]);

  const deleteSelectedNodes = useCallback(() => {
    const selectedNodes = getSelectedNodes();
    const removableIds = new Set(selectedNodes.filter((node) => node.id !== START_NODE_ID).map((node) => node.id));
    if (!removableIds.size) {
      if (selectedNodes.some((node) => node.id === START_NODE_ID)) {
        toast.error('O no de inicio e protegido.');
      }
      return false;
    }

    const shouldRemoveNode = (node) => (
      removableIds.has(node.id)
      || [...removableIds].some((id) => node.id.startsWith(`child_${id}`))
    );

    setNodes((current) => current.filter((node) => !shouldRemoveNode(node)));
    setEdges((current) => current.filter((edge) => !removableIds.has(edge.source) && !removableIds.has(edge.target)));
    setVisualBlocks((current) => current.map((block) => ({
      ...block,
      nodeIds: block.nodeIds.filter((nodeId) => !removableIds.has(nodeId))
    })));
    setSelectionActionsOpen(false);
    toast.success(removableIds.size > 1 ? `${removableIds.size} nos removidos` : 'No removido');
    return true;
  }, [getSelectedNodes]);

  const copySelectedNodes = useCallback(() => {
    const selectedNodes = nodes.filter((node) => node.selected && node.id !== START_NODE_ID);

    if (!selectedNodes.length) {
      if (nodes.some((node) => node.selected && node.id === START_NODE_ID)) {
        toast.error('O no de inicio nao pode ser copiado.');
      }
      return false;
    }

    return Boolean(copyNodesToClipboard(selectedNodes));
  }, [copyNodesToClipboard, nodes]);

  const pasteCopiedNodes = useCallback(() => {
    const clipboard = copiedSelectionRef.current;
    if (!clipboard?.nodes?.length) {
      return false;
    }

    const pasteIndex = pasteCountRef.current + 1;
    const offset = 40 * pasteIndex;
    const timestamp = Date.now();
    const idMap = new Map();

    const newNodes = clipboard.nodes.map((node, index) => {
      const newId = `${node.type}_${timestamp}_${index}`;
      idMap.set(node.id, newId);

      return hydrateNode({
        ...cloneDeep(node),
        id: newId,
        selected: true,
        dragging: false,
        position: {
          x: clipboard.origin.x + node.position.x + offset,
          y: clipboard.origin.y + node.position.y + offset
        },
        data: sanitizeNodeData(node.data)
      }, vars, templates, schedules);
    });

    const newEdges = clipboard.edges
      .map((edge, index) => {
        const source = idMap.get(edge.source);
        const target = idMap.get(edge.target);
        if (!source || !target) return null;

        return {
          ...cloneDeep(edge),
          id: `edge_copy_${timestamp}_${index}`,
          source,
          target,
          selected: false
        };
      })
      .filter(Boolean);

    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      ...newNodes
    ]);
    setEdges((current) => [
      ...current.map((edge) => ({ ...edge, selected: false })),
      ...newEdges
    ]);

    pasteCountRef.current = pasteIndex;

    toast.success(
      newNodes.length > 1
        ? `${newNodes.length} nos colados`
        : 'No colado'
    );

    return {
      nodeIds: newNodes.map((node) => node.id),
      idMap
    };
  }, [edges, hydrateNode, sanitizeNodeData, schedules, templates, vars]);

  const duplicateSelectedNodes = useCallback(() => {
    const copied = copySelectedNodes();
    if (!copied) return false;
    pasteCopiedNodes();
    setSelectionActionsOpen(false);
    return true;
  }, [copySelectedNodes, pasteCopiedNodes]);

  const loadInactivityConfig = useCallback(async () => {
    if (!tenant?.id) return;
    try {
      const data = await getJSON(`/tenants/${tenant.id}/settings`);
      setInactivityConfig({
        inactivityMaxHours: Number(data?.inactivityMaxHours ?? 8),
        inactivityMessage: data?.inactivityMessage || 'Atendimento encerrado por inatividade.'
      });
    } catch (e) {
      toast.error('Erro ao carregar inatividade');
    }
  }, [tenant?.id]);

  const handleSaveConfig = (nodeId, newData) => {
    const parentNode = getNodes().find(n => n.id === nodeId);
    if (!parentNode) return;

    if (parentNode.type === 'commercialNode') {
      const runtime = getCommercialRuntimeStateFromNode(parentNode);
      const nodeById = new Map(getNodes().map((node) => [node.id, node]));
      const snapshot = buildCommercialDataSnapshot(
        {
          ...(newData || {}),
          currentX: Number(newData?.currentX ?? runtime.x),
          currentY: Number(newData?.currentY ?? runtime.y),
          currentWidth: clampCommercialSize(newData?.currentWidth, runtime.width),
          currentHeight: clampCommercialSize(newData?.currentHeight, runtime.height),
          currentShape: normalizeCommercialShape(newData?.currentShape ?? runtime.shape),
          currentBorderColor: normalizeCommercialColor(newData?.currentBorderColor ?? runtime.borderColor)
        },
        runtime
      );

      setNodes((nds) => nds.map((node) => {
        if (node.id !== nodeId) return node;
        return hydrateNode({
          ...node,
          position: { x: Number(snapshot.currentX || runtime.x), y: Number(snapshot.currentY || runtime.y) },
          data: {
            ...node.data,
            ...snapshot
          }
        }, vars, templates, schedules);
      }));

      const connectionStyle = normalizeCommercialConnectionStyle(
        snapshot?.connectionStyle || {},
        snapshot?.currentBorderColor ?? snapshot?.borderColor ?? DEFAULT_COMMERCIAL_COLOR
      );
      setEdges((currentEdges) => currentEdges.map((edge) => {
        if (edge.source !== nodeId) return edge;

        const targetNode = nodeById.get(edge.target);
        const hasCommercial = targetNode?.type === 'commercialNode' || parentNode.type === 'commercialNode';
        if (!hasCommercial) return edge;

        return {
          ...edge,
          type: 'commercialEdge',
          data: {
            ...(edge?.data || {}),
            commercial: connectionStyle
          },
          style: buildCommercialEdgeVisualStyle(connectionStyle, edge?.style || {})
        };
      }));

      toast.success("Configuracao salva");
      return;
    }

    updateNodeData(nodeId, newData);

    const newNodes = [];
    const newEdges = [];
    const baseX = parentNode.position.x + 300;
    const baseY = parentNode.position.y;


    if (parentNode.type === 'conditionNode' && newData.conditions) {

      setNodes(nds => nds.filter(n => !n.id.startsWith(`child_${nodeId}`)));
      setEdges(eds => eds.filter(e =>
        !(e.source === nodeId && (
          e.id.startsWith(`edge_${nodeId}_`) ||
          e.id.startsWith(`edge_${nodeId}_else`)
        ))
      ));


      newData.conditions.forEach((cond, index) => {
        const condId = String(cond.id);
        const childId = `child_${nodeId}_${condId}`;

        newNodes.push({
          id: childId, type: 'caseNode',
          position: { x: baseX, y: baseY + (index * 80) },
          data: { label: formatConditionCaseLabel(cond) }
        });

        newEdges.push({
          id: `edge_${nodeId}_${condId}`,
          source: nodeId,
          target: childId,
          sourceHandle: condId,
          type: 'smoothstep'
        });
      });


      if (newData.hasElse !== false) {
        const elseId = `child_${nodeId}_else`;

        newNodes.push({
          id: elseId,
          type: 'caseNode',
          position: { x: baseX, y: baseY + (newData.conditions.length * 80) },
          data: { label: "Else" }
        });

        newEdges.push({
          id: `edge_${nodeId}_else`,
          source: nodeId,
          target: elseId,
          sourceHandle: 'else',
          style: { strokeDasharray: 5, stroke: '#94a3b8' }
        });
      }


    }


    if (parentNode.type === 'templateNode' && newData.templateId) {
      const template = templates.find(t => t.id === newData.templateId);
      if (template && template.buttons) {

        setNodes(nds => nds.filter(n => !n.id.startsWith(`child_${nodeId}`)));
        setEdges(eds => eds.filter(e =>
          !(e.source === nodeId && (
            e.id.startsWith(`e_${nodeId}_`)
          ))
        ));

        template.buttons.forEach((btn, index) => {
          const childId = `child_${nodeId}_${btn.id}`;
          newNodes.push({
            id: childId,
            type: 'caseNode',
            position: { x: baseX, y: baseY + (index * 80) },
            data: { label: btn.label }
          });


          newEdges.push({
            id: `e_${nodeId}_${childId}`,
            source: nodeId,
            target: childId,
            sourceHandle: btn.id,
            type: 'default',
            style: { stroke: '#be185d', strokeWidth: 2 }
          });
        });
      }
    }

    if (parentNode.type === 'menuNode' && Array.isArray(newData.options)) {
      setNodes(nds => nds.filter(n => !n.id.startsWith(`child_${nodeId}`)));
      setEdges(eds => eds.filter(e =>
        !(e.source === nodeId && (
          e.id.startsWith(`m_${nodeId}_`) ||
          e.id.startsWith(`m_${nodeId}_else`)
        ))
      ));

      if (newData.createBranches === false) {
        if (newNodes.length > 0) {
          setNodes(nds => [...nds, ...newNodes]);
          setEdges(eds => [...eds, ...newEdges]);
        }
        toast.success("Configuração salva");
        return;
      }

      newData.options.forEach((opt, index) => {
        const optionId = String(opt.id || index + 1);
        const childId = `child_${nodeId}_${optionId}`;
        newNodes.push({
          id: childId,
          type: 'caseNode',
          position: { x: baseX, y: baseY + (index * 80) },
          data: { label: opt.label || optionId }
        });

        newEdges.push({
          id: `m_${nodeId}_${optionId}`,
          source: nodeId,
          target: childId,
          sourceHandle: optionId,
          type: 'default',
          style: { stroke: '#94a3b8' }
        });
      });

      if (newData.hasElse !== false) {
        const elseId = `child_${nodeId}_else`;
        newNodes.push({
          id: elseId,
          type: 'caseNode',
          position: { x: baseX, y: baseY + (newData.options.length * 80) },
          data: { label: 'Else' }
        });
        newEdges.push({
          id: `m_${nodeId}_else`,
          source: nodeId,
          target: elseId,
          sourceHandle: 'else',
          style: { strokeDasharray: 5, stroke: '#94a3b8' }
        });
      }
    }


    if (parentNode.type === 'scheduleNode') {

      setNodes(nds => nds.filter(n => !n.id.startsWith(`child_${nodeId}`)));
      setEdges(eds => eds.filter(e =>
        !(e.source === nodeId && (
          e.id.startsWith(`e_${nodeId}_`)
        ))
      ));

      ['inside', 'outside'].forEach((type, index) => {
        const childId = `child_${nodeId}_${type}`;
        newNodes.push({
          id: childId, type: 'caseNode',
          position: { x: baseX, y: baseY + (index * 80) },
          data: { label: type === 'inside' ? 'âœ… Aberto' : 'âŒ Fechado' }
        });
        newEdges.push({
          id: `e_${nodeId}_${type}`, source: nodeId, target: childId, sourceHandle: 'source',
          style: { stroke: type === 'inside' ? '#16a34a' : '#ef4444' }
        });
      });
    }

    if (parentNode.type === 'httpRequestNode') {
      setNodes(nds => nds.filter(n => !n.id.startsWith(`child_${nodeId}`)));
      setEdges(eds => eds.filter(e =>
        !(e.source === nodeId && (
          e.id.startsWith(`e_${nodeId}_`)
        ))
      ));

      const successId = `child_${nodeId}_success`;
      const errorId = `child_${nodeId}_error`;

      newNodes.push({
        id: successId, type: 'caseNode',
        position: { x: baseX, y: baseY },
        data: { label: 'Sucesso' }
      });
      newNodes.push({
        id: errorId, type: 'caseNode',
        position: { x: baseX + 20, y: baseY + 90 },
        data: { label: 'Erro', tone: 'error' }
      });

      newEdges.push({
        id: `e_${nodeId}_success`,
        source: nodeId,
        target: successId,
        sourceHandle: 'success',
        type: 'smoothstep',
        style: { stroke: '#16a34a' }
      });
      newEdges.push({
        id: `e_${nodeId}_error`,
        source: nodeId,
        target: errorId,
        sourceHandle: 'error',
        type: 'smoothstep',
        style: { stroke: '#ef4444' }
      });
    }

    if (newNodes.length > 0) {
      setNodes(nds => [...nds, ...newNodes]);
      setEdges(eds => [...eds, ...newEdges]);
      toast.success("Ramificações criadas!");
    } else {
      toast.success("Configuração salva");
    }
  };



  const load = useCallback(async () => {
    try {
      const supportPromise = Promise.all([
        getJSON('/variables'),
        getJSON('/templates'),
        getJSON('/schedules'),
        getJSON('/queues')
      ]);
      const fD = await getJSON(`/flows/${id}?view=editor`);
      setFlowName(fD.name);

      const source = fD.editorSnapshot || fD.draft || fD.published || { nodes: [createStartNode()], edges: [] };
      const sourceNodeTypes = new Set((Array.isArray(source?.nodes) ? source.nodes : []).map((node) => node?.type));

      const normalizedGraph = normalizeGraphStructure(source.nodes || [], source.edges || []);
      setNodes(normalizedGraph.nodes.map((node) => hydrateNode(node, [], [], [])));
      setEdges(normalizedGraph.edges);
      setVisualBlocks(normalizeVisualBlocks(source.visualBlocks || []));

      void supportPromise
        .then(([vD, tD, sD, qD]) => {
          setVars(vD);
          setTemplates(tD);
          setSchedules(sD);
          setQueues(qD);
          setNodes((current) => current.map((node) => hydrateNode(node, vD, tD, sD)));

          if (sourceNodeTypes.has('catalogNode')) {
            ensureCatalogItems();
          }
          if (sourceNodeTypes.has('mediaNode')) {
            ensureMediaAssets();
          }
          if (sourceNodeTypes.has('whatsappTemplateNode')) {
            ensureWhatsAppEditorData();
          }
        })
        .catch(() => {
          toast.error("Erro ao carregar dados auxiliares do editor");
        });
    } catch (e) { toast.error("Erro ao carregar fluxo"); }
  }, [ensureCatalogItems, ensureMediaAssets, ensureWhatsAppEditorData, hydrateNode, id, normalizeGraphStructure]);

  useEffect(() => { load(); }, [load]);



  const onNodesChange = useCallback((changes) => {
    const visualBlockChanges = changes.filter((change) => String(change.id || '').startsWith('visual_block_'));
    const graphChanges = changes.filter((change) => !String(change.id || '').startsWith('visual_block_'));

    visualBlockChanges.forEach((change) => {
      const blockId = String(change.id || '').replace(/^visual_block_/, '');

      if (change.type === 'select') {
        setSelectedVisualBlockId(change.selected ? blockId : null);
        return;
      }

      if (change.type === 'remove') {
        setVisualBlocks((current) => current.filter((block) => block.id !== blockId));
        setSelectedVisualBlockId((current) => (current === blockId ? null : current));
        return;
      }

      if (change.type === 'position' && change.position) {
        setVisualBlocks((current) => {
          let movePayload = null;
          const nextBlocks = current.map((block) => {
            if (block.id !== blockId) return block;
            const nextX = Number(change.position.x || 0);
            const nextY = Number(change.position.y || 0);
            const dx = nextX - Number(block.bounds?.x || 0);
            const dy = nextY - Number(block.bounds?.y || 0);
            movePayload = {
              dx,
              dy,
              nodeIds: Array.isArray(block.nodeIds) ? block.nodeIds : []
            };
            return {
              ...block,
              bounds: {
                ...block.bounds,
                x: nextX,
                y: nextY
              }
            };
          });

          if (movePayload && (movePayload.dx !== 0 || movePayload.dy !== 0)) {
            const nodeIds = new Set(movePayload.nodeIds);
            setNodes((currentNodes) => currentNodes.map((node) => (
              nodeIds.has(node.id)
                ? {
                  ...node,
                  position: {
                    x: Number(node.position?.x || 0) + movePayload.dx,
                    y: Number(node.position?.y || 0) + movePayload.dy
                  }
                }
                : node
            )));
          }

          return nextBlocks;
        });
      }
    });

    if (graphChanges.some((change) => change.type === 'select' && change.selected)) {
      setSelectedVisualBlockId(null);
    }
    const safeChanges = graphChanges.filter((change) => !(change.type === 'remove' && change.id === START_NODE_ID));
    const removedIds = new Set(safeChanges.filter((change) => change.type === 'remove').map((change) => change.id));
    if (removedIds.size) {
      setVisualBlocks((current) => current.map((block) => ({
        ...block,
        nodeIds: block.nodeIds.filter((nodeId) => !removedIds.has(nodeId))
      })));
    }
    setNodes((nds) => {
      const changed = applyNodeChanges(safeChanges, nds);
      return changed.map((node) => {
        if (node.type !== 'commercialNode') return node;
        return withCommercialCurrentState(node, {
          x: node.position?.x,
          y: node.position?.y,
          width: node.width,
          height: node.height
        });
      });
    });
  }, []);
  const onEdgesChange = useCallback((c) => setEdges(eds => applyEdgeChanges(c, eds)), []);

  const onConnect = useCallback((params) => {
    const sourceNode = nodes.find(n => n.id === params.source);
    const targetNode = nodes.find(n => n.id === params.target);
    if (!sourceNode) return;
    if (!targetNode) return;

    if (sourceNode.type === 'commercialNode' || targetNode.type === 'commercialNode') {
      const isSourceAllowed = ['commercialNode', 'startNode'].includes(sourceNode.type);
      const isTargetAllowed = ['commercialNode', 'startNode'].includes(targetNode.type);
      if (!isSourceAllowed || !isTargetAllowed) {
        return toast.error("No comercial conecta apenas em Inicio ou outro no comercial.");
      }

      const styleNode = sourceNode.type === 'commercialNode' ? sourceNode : targetNode;
      const connectionStyle = getCommercialConnectionStyleFromNode(styleNode);
      const commercialEdge = {
        ...params,
        type: 'commercialEdge',
        data: {
          commercial: connectionStyle
        },
        style: buildCommercialEdgeVisualStyle(connectionStyle)
      };

      setEdges((eds) => addEdge(commercialEdge, eds));
      return;
    }

    if (sourceNode.type === 'menuNode' && sourceNode.data?.createBranches !== false) {
      return toast.error("Este nó gera conexões automaticamente. Configure-o com duplo clique.");
    }


    if (['gotoNode', 'endNode', 'finalNode', 'conditionNode', 'templateNode', 'scheduleNode'].includes(sourceNode.type)) {
      return toast.error("Este nó gera conexões automaticamente. Configure-o com duplo clique.");
    }


    if (sourceNode.type === 'httpRequestNode') {
      if (edges.some(e => e.source === params.source && e.sourceHandle === params.sourceHandle)) {
        return toast.error("Essa saida ja esta conectada.");
      }
    } else if (sourceNode.type !== 'commercialNode') {
      if (edges.some(e => e.source === params.source)) return toast.error("Apenas uma saida permitida.");
    }

    setEdges((eds) => addEdge({ ...params, type: 'flowEdge' }, eds));
  }, [nodes, edges]);

  const onEdgeClick = useCallback(async (evt, edge) => {
    if (edge.id.startsWith('e_')) return toast.error("Conexão estrutural fixa.");
    const ok = await confirm({
      title: 'Remover conexão',
      message: 'Tem certeza que deseja remover esta conexão entre os nós?',
      confirmText: 'Remover',
      type: 'danger',
    });
    if (!ok) return;
    setEdges((eds) => eds.filter(e => e.id !== edge.id));
  }, [confirm]);


  const applyCommercialShortcut = useCallback((shortcut) => {
    const selectedNode = nodes.find((node) => node.selected && node.type === 'commercialNode');
    if (!selectedNode) return false;
    if (!['reset', 'add', 'apply-last'].includes(shortcut)) return false;

    let toastMessage = shortcut === 'reset'
      ? 'Quadro 1 aplicado no estado atual.'
      : shortcut === 'add'
        ? 'Novo quadro adicionado do estado atual.'
        : 'Estado atual aplicado no ultimo quadro.';

    setNodes((currentNodes) => {
      const targetNode = currentNodes.find((node) => node.id === selectedNode.id && node.type === 'commercialNode');
      if (!targetNode) return currentNodes;

      const runtime = getCommercialRuntimeStateFromNode(targetNode);
      const baseSnapshot = buildCommercialDataSnapshot(
        {
          ...(targetNode.data || {}),
          currentX: runtime.x,
          currentY: runtime.y,
          currentWidth: runtime.width,
          currentHeight: runtime.height,
          currentShape: runtime.shape,
          currentBorderColor: runtime.borderColor
        },
        runtime
      );
      const frames = Array.isArray(baseSnapshot.motionKeyframes)
        ? baseSnapshot.motionKeyframes.map((frame) => ({ ...frame }))
        : [];
      if (!frames.length) return currentNodes;

      let updatedNode = targetNode;

      if (shortcut === 'reset') {
        const first = frames[0];
        updatedNode = withCommercialCurrentState(targetNode, {
          x: first?.x,
          y: first?.y,
          width: first?.width,
          height: first?.height,
          shape: first?.shape,
          borderColor: first?.borderColor
        });
      }

      if (shortcut === 'add') {
        const currentFrame = {
          id: `kf_${Date.now()}`,
          x: runtime.x,
          y: runtime.y,
          width: runtime.width,
          height: runtime.height,
          shape: runtime.shape,
          borderColor: runtime.borderColor
        };

        if (frames.length === 1) {
          frames[0] = {
            ...frames[0],
            segmentDurationMs: clampCommercialDuration(frames[0]?.segmentDurationMs, DEFAULT_COMMERCIAL_DURATION),
            segmentEasing: normalizeCommercialEasing(frames[0]?.segmentEasing),
            segmentMode: normalizeCommercialMode(frames[0]?.segmentMode)
          };
          frames.push(currentFrame);
        } else {
          const previousLast = frames[frames.length - 1];
          frames[frames.length - 1] = {
            ...previousLast,
            segmentDurationMs: clampCommercialDuration(previousLast?.segmentDurationMs, DEFAULT_COMMERCIAL_DURATION),
            segmentEasing: normalizeCommercialEasing(previousLast?.segmentEasing),
            segmentMode: normalizeCommercialMode(previousLast?.segmentMode)
          };
          frames.push(currentFrame);
        }

        const nextSnapshot = buildCommercialDataSnapshot(
          {
            ...targetNode.data,
            motionKeyframes: frames,
            currentX: runtime.x,
            currentY: runtime.y,
            currentWidth: runtime.width,
            currentHeight: runtime.height,
            currentShape: runtime.shape,
            currentBorderColor: runtime.borderColor
          },
          runtime
        );
        updatedNode = {
          ...targetNode,
          position: { x: runtime.x, y: runtime.y },
          data: {
            ...targetNode.data,
            ...nextSnapshot
          }
        };
      }

      if (shortcut === 'apply-last') {
        frames[frames.length - 1] = {
          ...(frames[frames.length - 1] || {}),
          x: runtime.x,
          y: runtime.y,
          width: runtime.width,
          height: runtime.height,
          shape: runtime.shape,
          borderColor: runtime.borderColor
        };

        const nextSnapshot = buildCommercialDataSnapshot(
          {
            ...targetNode.data,
            motionKeyframes: frames,
            currentX: runtime.x,
            currentY: runtime.y,
            currentWidth: runtime.width,
            currentHeight: runtime.height,
            currentShape: runtime.shape,
            currentBorderColor: runtime.borderColor
          },
          runtime
        );
        updatedNode = {
          ...targetNode,
          position: { x: runtime.x, y: runtime.y },
          data: {
            ...targetNode.data,
            ...nextSnapshot
          }
        };
      }

      const hydrated = hydrateNode(updatedNode, vars, templates, schedules);
      return currentNodes.map((node) => (node.id === targetNode.id ? hydrated : node));
    });

    if (toastMessage) {
      toast.success(toastMessage);
    }

    return true;
  }, [hydrateNode, nodes, schedules, templates, vars]);

  const onKeyDown = useCallback((event) => {
    const target = event.target;
    const tagName = String(target?.tagName || '').toUpperCase();
    const isTypingTarget = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName) || target?.isContentEditable;
    if (isTypingTarget) return;

    // Enquanto um modal estiver aberto, os atalhos do canvas (copy/paste/delete
    // /space) não devem disparar — senão o Ctrl+C/V de texto dentro do modal
    // é capturado pelo fluxo. Deixa o evento seguir para o comportamento nativo.
    const isModalOpen = configModal.open || visualBlockModal.open || inactivityModalOpen;
    if (isModalOpen) return;

    const lowerKey = String(event.key || '').toLowerCase();
    const hasModifier = event.ctrlKey || event.metaKey;

    if (event.key === 'Escape') {
      setSelectionActionsOpen(false);
      return;
    }

    if (event.key === 'Alt' && nodes.some((node) => node.selected)) {
      event.preventDefault();
      setSelectionActionsOpen(true);
      return;
    }

    if (hasModifier && lowerKey === 'c') {
      event.preventDefault();
      copySelectedNodes();
      return;
    }

    if (hasModifier && lowerKey === 'v') {
      event.preventDefault();
      pasteCopiedNodes();
      return;
    }

    if (hasModifier && event.key === 'ArrowLeft') {
      event.preventDefault();
      resetCommercialTimeline();
      return;
    }

    if (hasModifier && ['1', '2', '3'].includes(lowerKey)) {
      let handled = false;
      if (lowerKey === '1') handled = applyCommercialShortcut('reset');
      if (lowerKey === '2') handled = applyCommercialShortcut('add');
      if (lowerKey === '3') handled = applyCommercialShortcut('apply-last');
      if (handled) {
        event.preventDefault();
        return;
      }
    }

    if (event.code === 'Space' || lowerKey === ' ') {
      event.preventDefault();
      triggerCommercialAnimation();
      return;
    }

    if (['delete', 'backspace', 'a'].includes(lowerKey) || (hasModifier && lowerKey === 'a')) {
      const selectedNodes = nodes.filter(n => n.selected);

      if (selectedNodes.some(n => n.id === START_NODE_ID)) {
        event.preventDefault();
        event.stopPropagation();
        toast.error("O nó de início é protegido e não pode ser removido.");
      }
    }
  }, [applyCommercialShortcut, copySelectedNodes, nodes, pasteCopiedNodes, resetCommercialTimeline, triggerCommercialAnimation, configModal.open, visualBlockModal.open, inactivityModalOpen]);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onKeyDown]);



  const createNode = (type) => {
    if (type === 'commercialNode' && !isSuperAdmin) {
      toast.error('Apenas SUPER_ADMIN pode criar nos comerciais.');
      return;
    }

    const newId = `${type}_${Date.now()}`;
    const { x, y, zoom } = getViewport();

    const xPos = Math.round(((-x + window.innerWidth / 2) / zoom) / 20) * 20;
    const yPos = Math.round(((-y + window.innerHeight / 2) / zoom) / 20) * 20;

    const newNode = hydrateNode({
      id: newId, type, position: { x: xPos, y: yPos },
      data: {
        text: '...',
        conditions: [],
        mappings: [],
        customName: '',
        ...(type === 'catalogNode'
          ? { sourceType: 'catalog', limit: 5, title: 'Selecione um item:', varPrefix: 'PRODUTO', showButtons: true, itemIds: [], items: [] }
          : {}),
        ...(type === 'mediaNode'
          ? { mediaType: 'image', mediaUrl: '', caption: '', fileName: '' }
          : {})
        ,
        ...(type === 'menuNode'
          ? {
            text: 'Escolha uma opção:',
            options: [
              { id: '1', label: 'Opção 1', value: '1' },
              { id: '2', label: 'Opção 2', value: '2' }
            ],
            setVarEnabled: false,
            variableName: '',
            invalidSelectionMessage: 'Selecione uma opção válida.',
            hasElse: true,
            timeoutMinutes: 0,
            timeoutMessage: ''
          }
          : {}),
        ...(type === 'sequentialNode'
          ? {
            steps: [
              { id: 'step_1', type: 'message', text: 'Vamos iniciar o formulario.' },
              { id: 'step_2', type: 'input', text: 'Qual o seu nome?', variableName: '' }
            ],
            timeoutMinutes: 0,
            timeoutMessage: ''
          }
          : {}),
        ...(type === 'inputNode'
          ? { timeoutMinutes: 0, timeoutMessage: '' }
          : {}),
        ...(type === 'holderNode'
          ? {
            text: '',
            saveMessages: true,
            lastMessageVar: 'HOLDER_LAST',
            listVar: 'HOLDER_MESSAGES',
            textVar: 'HOLDER_TEXT',
            countVar: 'HOLDER_COUNT',
            fallbackText: '',
            fallbackOnce: true,
            exitKeywords: '',
            timeoutMinutes: 0,
            timeoutMessage: ''
          }
          : {}),
        ...(type === 'ratingNode'
          ? { timeoutMinutes: 0, timeoutMessage: '' }
          : {}),
        ...(type === 'whatsappTemplateNode'
          ? {
            contentKind: 'template',
            whatsappTemplateId: '',
            interactiveTemplateId: '',
            senderPhoneNumberId: '',
            waitForReply: true,
            nonWhatsappAction: 'skip',
            fallbackText: '',
            saveResponseTextVar: '',
            saveResponsePayloadVar: '',
            saveButtonTextVar: '',
            headerMappings: [],
            bodyMappings: [],
            buttonMappings: {},
            headerMediaMapping: { mode: 'fixed', value: '' }
          }
          : {}),
        ...(type === 'commercialNode'
          ? {
            text: '',
            shape: DEFAULT_COMMERCIAL_SHAPE,
            borderColor: DEFAULT_COMMERCIAL_COLOR,
            connectionStyle: {
              route: DEFAULT_COMMERCIAL_EDGE_ROUTE,
              strokeColor: DEFAULT_COMMERCIAL_COLOR,
              strokeWidth: DEFAULT_COMMERCIAL_EDGE_STROKE_WIDTH,
              opacity: DEFAULT_COMMERCIAL_EDGE_OPACITY,
              dashed: false,
              dashLength: DEFAULT_COMMERCIAL_EDGE_DASH_LENGTH,
              dashGap: DEFAULT_COMMERCIAL_EDGE_DASH_GAP,
              animated: false,
              animationDurationMs: DEFAULT_COMMERCIAL_EDGE_ANIMATION_DURATION,
              sourceOffsetX: 0,
              sourceOffsetY: 0,
              targetOffsetX: 0,
              targetOffsetY: 0,
              curvature: DEFAULT_COMMERCIAL_EDGE_CURVATURE,
              routeOffset: DEFAULT_COMMERCIAL_EDGE_ROUTE_OFFSET,
              cornerRadius: DEFAULT_COMMERCIAL_EDGE_CORNER_RADIUS
            },
            durationMs: DEFAULT_COMMERCIAL_DURATION,
            easing: DEFAULT_COMMERCIAL_EASING,
            mode: DEFAULT_COMMERCIAL_MODE,
            motionKeyframes: [
              {
                id: `kf_${newId}_1`,
                x: xPos,
                y: yPos,
                width: DEFAULT_COMMERCIAL_WIDTH,
                height: DEFAULT_COMMERCIAL_HEIGHT,
                shape: DEFAULT_COMMERCIAL_SHAPE,
                borderColor: DEFAULT_COMMERCIAL_COLOR
              }
            ],
            currentX: xPos,
            currentY: yPos,
            currentWidth: DEFAULT_COMMERCIAL_WIDTH,
            currentHeight: DEFAULT_COMMERCIAL_HEIGHT,
            currentShape: DEFAULT_COMMERCIAL_SHAPE,
            currentBorderColor: DEFAULT_COMMERCIAL_COLOR,
            spawnOnComplete: false,
            spawnCount: 1,
            spawnDepth: 1,
            spawnSpacingX: 180,
            spawnSpacingY: 0,
            generation: 0
          }
          : {})
      }
    }, vars, templates, schedules);
    setNodes((nds) => [...nds, newNode]);
  };

  const saveInactivityConfig = async () => {
    if (!tenant?.id) return;
    try {
      setInactivitySaving(true);
      await putJSON(`/tenants/${tenant.id}/settings`, {
        inactivityMaxHours: Number(inactivityConfig.inactivityMaxHours || 0),
        inactivityMessage: inactivityConfig.inactivityMessage || ''
      });
      toast.success('Inatividade global atualizada');
      setInactivityModalOpen(false);
    } catch (e) {
      toast.error('Erro ao salvar inatividade');
    } finally {
      setInactivitySaving(false);
    }
  };

  const save = async (publish = false) => {
    if (publish) {
      const excluded = new Set(['endNode', 'finalNode', 'gotoNode', 'commercialNode', 'holderNode']);
      const sources = new Set(edges.map(e => e.source));
      const disconnected = nodes.filter(n => !excluded.has(n.type) && !sources.has(n.id));
      if (disconnected.length > 0) {
        const labels = disconnected
          .slice(0, 4)
          .map(n => n.data?.customName || n.data?.text || n.type)
          .join(', ');
        const extra = disconnected.length > 4 ? ` (+${disconnected.length - 4})` : '';
        toast.error(`Existem nós sem saída: ${labels}${extra}.`);
        return;
      }
      const ok = await confirm({
        title: 'Publicar fluxo em Produção',
        message: `Publicar "${flowName}" em Produção? Essa versão substituirá a atual.`,
        confirmText: 'Publicar',
        type: 'warning',
      });
      if (!ok) return;
    }

    const normalizedGraph = normalizeGraphStructure(nodes, edges);

    const cleanNodes = normalizedGraph.nodes.map(({ data, hidden, ...n }) => {
      const {
        availableVars,
        availableTemplates,
        availableSchedules,
        onDelete,
        onConfig,
        onCommercialAnimationEnd,
        onCommercialResize,
        animationPlayKey,
        lastSpawnPlayKey,
        ...cleanData
      } = data;
      return { ...n, data: cleanData };
    });

    try {
      const cleanEdges = normalizedGraph.edges.map(({ hidden, ...edge }) => edge);

      const savedFlow = await putJSON(`/flows/${id}`, { 
        nodes: cleanNodes, 
        edges: cleanEdges, 
        visualBlocks: normalizeVisualBlocks(visualBlocks),
        published: publish,
        status: publish ? 'published' : 'draft'
      });
      if (publish && !savedFlow?.published?.publishedAt) {
        throw new Error('O servidor salvou a requisicao, mas nao confirmou a publicacao do fluxo.');
      }
      toast.success(publish ? "Publicado!" : "Rascunho Salvo");
    } catch (e) { 
      console.error("Erro ao salvar:", e);
      toast.error("Erro ao salvar: " + (e.message || 'Erro desconhecido'));
    }
  };

  useEffect(() => {
    setNodes((currentNodes) => {
      let changed = false;
      const nextNodes = currentNodes.map((node) => {
        if (node.type !== 'commercialNode') return node;
        if (Boolean(node?.data?.hideCommercialGhostsGlobal) === hideCommercialGhostsGlobal) {
          return node;
        }
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            hideCommercialGhostsGlobal
          }
        };
      });
      return changed ? nextNodes : currentNodes;
    });
  }, [hideCommercialGhostsGlobal]);

  const selectedNodes = nodes.filter((node) => node.selected);
  const selectedBounds = getNodesBounds(selectedNodes);
  const selectionActionPoint = selectedBounds
    ? toScreenPoint({ x: selectedBounds.centerX, y: selectedBounds.y }, viewport)
    : null;
  const hasCommercialNodes = nodes.some((node) => node.type === 'commercialNode');
  const selectedVisualBlock = useMemo(() => (
    normalizeVisualBlocks(visualBlocks).find((block) => block.id === selectedVisualBlockId) || null
  ), [selectedVisualBlockId, visualBlocks]);

  const zoomToAll = () => {
    fitView({ padding: 0.18, duration: 520 });
  };

  const zoomToSelection = () => {
    const bounds = getNodesBounds(selectedNodes);
    if (!bounds) {
      toast.error('Selecione um ou mais nodes para focar.');
      return;
    }
    setCenter(bounds.centerX, bounds.centerY, {
      zoom: selectedNodes.length === 1 ? 1.18 : 0.95,
      duration: 520
    });
  };

  const zoomToSelectedBlock = () => {
    if (!selectedVisualBlock?.bounds) {
      toast.error('Selecione um bloco visual para focar.');
      return;
    }
    const { bounds } = selectedVisualBlock;
    const maxSize = Math.max(Number(bounds.width || 1), Number(bounds.height || 1));
    const zoom = Math.max(0.45, Math.min(1.18, 760 / Math.max(maxSize, 240)));
    setCenter(
      Number(bounds.x || 0) + Number(bounds.width || 0) / 2,
      Number(bounds.y || 0) + Number(bounds.height || 0) / 2,
      { zoom, duration: 520 }
    );
  };

  const enterPresentationMode = () => {
    setPresentationMode(true);
    setSelectionActionsOpen(false);
    setCanvasMenuOpen(false);
    window.setTimeout(() => {
      fitView({ padding: 0.22, duration: 700 });
    }, 80);
  };

  const exitPresentationMode = () => {
    setPresentationMode(false);
  };

  useEffect(() => {
    if (!presentationMode) return undefined;
    const onPresentationKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        exitPresentationMode();
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        fitView({ padding: 0.22, duration: 520 });
      }
    };
    window.addEventListener('keydown', onPresentationKeyDown);
    return () => window.removeEventListener('keydown', onPresentationKeyDown);
  }, [fitView, presentationMode]);

  useEffect(() => {
    if (!selectedNodes.length && selectionActionsOpen) {
      setSelectionActionsOpen(false);
    }
  }, [selectedNodes.length, selectionActionsOpen]);

  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const nextNodes = current.map((node) => {
        if (!node.hidden) return node;
        changed = true;
        const { hidden, ...nextNode } = node;
        return nextNode;
      });
      return changed ? nextNodes : current;
    });

    setEdges((current) => {
      let changed = false;
      const nextEdges = current.map((edge) => {
        if (!edge.hidden) return edge;
        changed = true;
        const { hidden, ...nextEdge } = edge;
        return nextEdge;
      });
      return changed ? nextEdges : current;
    });
  }, [visualBlocks]);

  const renameVisualBlock = useCallback((blockId) => {
    const block = visualBlocks.find((item) => item.id === blockId);
    if (!block) return;
    setVisualBlockModal({
      open: true,
      mode: 'rename',
      title: block.title.replace(/^##\s*/, ''),
      blockId,
      blockDraft: null
    });
  }, [visualBlocks]);

  const removeVisualBlock = useCallback((blockId) => {
    setVisualBlocks((current) => current.filter((item) => item.id !== blockId));
    setSelectedVisualBlockId((current) => (current === blockId ? null : current));
    toast.success('Bloco visual removido');
  }, []);

  const getVisualBlockNodes = useCallback((blockId) => {
    const block = normalizeVisualBlocks(visualBlocks).find((item) => item.id === blockId);
    if (!block) return { block: null, blockNodes: [] };
    const blockNodeIds = new Set(block.nodeIds);
    return {
      block,
      blockNodes: nodes.filter((node) => blockNodeIds.has(node.id))
    };
  }, [nodes, visualBlocks]);

  const selectVisualBlock = useCallback((blockId) => {
    setSelectedVisualBlockId(blockId);
    setSelectionActionsOpen(false);
    setNodes((current) => current.map((node) => (
      node.selected ? { ...node, selected: false } : node
    )));
  }, []);

  const copyVisualBlockNodes = useCallback((blockId, options = {}) => {
    const { blockNodes } = getVisualBlockNodes(blockId);
    const copied = copyNodesToClipboard(blockNodes, { toast: options.toast !== false });
    if (!copied && options.toast !== false) {
      toast.error('Este bloco nao possui nodes copiaveis.');
    }
    return copied;
  }, [copyNodesToClipboard, getVisualBlockNodes]);

  const duplicateVisualBlock = useCallback((blockId) => {
    const { block } = getVisualBlockNodes(blockId);
    if (!block) return false;

    const copied = copyVisualBlockNodes(blockId, { toast: false });
    if (!copied) return false;

    const pasted = pasteCopiedNodes();
    const idMap = pasted?.idMap;
    if (!idMap) return false;

    const nextNodeIds = block.nodeIds
      .map((nodeId) => idMap.get(nodeId))
      .filter(Boolean);

    const nextBlock = {
      ...block,
      id: `block_${Date.now()}`,
      title: `${block.title.replace(/^##\s*/, '## ')} copia`,
      hidden: false,
      collapsed: false,
      bounds: {
        ...block.bounds,
        x: block.bounds.x + 40,
        y: block.bounds.y + 40
      },
      nodeIds: nextNodeIds
    };

    setVisualBlocks((current) => [...current, nextBlock]);
    setSelectedVisualBlockId(nextBlock.id);
    toast.success('Bloco duplicado');
    return true;
  }, [copyVisualBlockNodes, getVisualBlockNodes, pasteCopiedNodes]);

  const toggleVisualBlockHidden = useCallback((blockId) => {
    setVisualBlocks((current) => current.map((block) => (
      block.id === blockId ? { ...block, hidden: !block.hidden } : block
    )));
  }, []);

  const toggleVisualBlockCollapsed = useCallback((blockId) => {
    setVisualBlocks((current) => current.map((block) => (
      block.id === blockId ? { ...block, collapsed: !block.collapsed } : block
    )));
  }, []);

  const deleteVisualBlockNodes = useCallback(async (blockId) => {
    const { block, blockNodes } = getVisualBlockNodes(blockId);
    if (!block || !blockNodes.length) {
      removeVisualBlock(blockId);
      return;
    }

    const ok = await confirm({
      title: 'Apagar nodes do bloco',
      message: `Apagar todos os ${blockNodes.length} nodes do bloco "${block.title.replace(/^##\s*/, '')}"?`,
      confirmText: 'Apagar',
      type: 'danger'
    });
    if (!ok) return;

    const removableIds = new Set(blockNodes.map((node) => node.id));
    const shouldRemoveNode = (node) => (
      removableIds.has(node.id)
      || [...removableIds].some((id) => node.id.startsWith(`child_${id}`))
    );

    setNodes((current) => current.filter((node) => !shouldRemoveNode(node)));
    setEdges((current) => current.filter((edge) => !removableIds.has(edge.source) && !removableIds.has(edge.target)));
    setVisualBlocks((current) => current
      .filter((item) => item.id !== blockId)
      .map((item) => ({
        ...item,
        nodeIds: item.nodeIds.filter((nodeId) => !removableIds.has(nodeId))
      })));
    setSelectedVisualBlockId(null);
    toast.success('Nodes do bloco apagados');
  }, [confirm, getVisualBlockNodes, removeVisualBlock]);

  const handleVisualBlockPointerDown = useCallback((blockId, event) => {
    if (event.button !== 0) return;
    const { block, blockNodes } = getVisualBlockNodes(blockId);
    if (!block) return;

    event.preventDefault();
    event.stopPropagation();
    selectVisualBlock(blockId);

    const nodeStarts = new Map(blockNodes.map((node) => [
      node.id,
      {
        x: Number(node.position?.x || 0),
        y: Number(node.position?.y || 0)
      }
    ]));

    visualBlockDragRef.current = {
      blockId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startBounds: { ...block.bounds },
      nodeStarts,
      zoom: viewport.zoom || 1
    };

    const handlePointerMove = (moveEvent) => {
      const drag = visualBlockDragRef.current;
      if (!drag || drag.blockId !== blockId) return;

      const deltaX = (moveEvent.clientX - drag.startClientX) / drag.zoom;
      const deltaY = (moveEvent.clientY - drag.startClientY) / drag.zoom;

      setVisualBlocks((current) => current.map((item) => (
        item.id === blockId
          ? {
            ...item,
            bounds: {
              ...item.bounds,
              x: drag.startBounds.x + deltaX,
              y: drag.startBounds.y + deltaY
            }
          }
          : item
      )));

      setNodes((current) => current.map((node) => {
        const start = drag.nodeStarts.get(node.id);
        if (!start) return node;
        return {
          ...node,
          position: {
            x: start.x + deltaX,
            y: start.y + deltaY
          }
        };
      }));
    };

    const handlePointerUp = () => {
      visualBlockDragRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [getVisualBlockNodes, selectVisualBlock, viewport.zoom]);

  const closeVisualBlockModal = useCallback(() => {
    setVisualBlockModal({
      open: false,
      mode: 'create',
      title: '',
      blockId: null,
      blockDraft: null
    });
  }, []);

  const submitVisualBlockModal = useCallback(() => {
    const titleText = String(visualBlockModal.title || 'Novo bloco').trim() || 'Novo bloco';
    const normalizedTitle = titleText.startsWith('##') ? titleText : `## ${titleText}`;

    if (visualBlockModal.mode === 'rename' && visualBlockModal.blockId) {
      setVisualBlocks((current) => current.map((item) => (
        item.id === visualBlockModal.blockId
          ? { ...item, title: normalizedTitle }
          : item
      )));
      toast.success('Bloco visual renomeado');
      closeVisualBlockModal();
      return;
    }

    if (visualBlockModal.blockDraft) {
      setVisualBlocks((current) => [
        ...current,
        {
          ...visualBlockModal.blockDraft,
          title: normalizedTitle
        }
      ]);
      toast.success('Bloco visual criado');
    }

    closeVisualBlockModal();
  }, [closeVisualBlockModal, visualBlockModal]);

  const visualBlockFlowNodes = normalizeVisualBlocks(visualBlocks).map((block) => ({
    id: `visual_block_${block.id}`,
    type: 'visualBlockNode',
    position: {
      x: block.bounds.x,
      y: block.bounds.y
    },
    draggable: true,
    selectable: true,
    deletable: true,
    zIndex: 0,
    style: {
      width: block.bounds.width,
      height: block.collapsed ? Math.min(block.bounds.height, 72) : block.bounds.height
    },
    data: {
      block,
      onRename: renameVisualBlock,
      onRemove: removeVisualBlock,
      onCopy: copyVisualBlockNodes,
      onDuplicate: duplicateVisualBlock,
      onToggleHidden: toggleVisualBlockHidden,
      onToggleCollapsed: toggleVisualBlockCollapsed,
      onDeleteNodes: deleteVisualBlockNodes
    }
  }));
  const renderedNodes = [...visualBlockFlowNodes, ...nodes];
  const displayEdges = useMemo(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const activeState = buildActiveEdgeState(nodes, edges);
    const hasActiveNode = Boolean(activeState.selectedNodeId);

    return edges.map((edge) => {
      if (edge.type === 'commercialEdge') return edge;

      const active = activeState.edgeIds.has(edge.id);
      const tone = getFlowEdgeTone(edge);
      const sourceHandle = String(edge.sourceHandle || '').trim();
      const markerColor = active
        ? (tone === 'error' ? '#ef4444' : '#38bdf8')
        : (tone === 'error' ? '#f87171' : '#94a3b8');

      return {
        ...edge,
        type: 'flowEdge',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: markerColor
        },
        data: {
          ...(edge.data || {}),
          active,
          dimmed: hasActiveNode && !active,
          dashed: sourceHandle === 'else' || edge?.style?.strokeDasharray,
          tone
        }
      };
    });
  }, [edges, nodes]);

  return (
    <div className={`h-full flex flex-col bg-gray-50 dark:bg-slate-900 ${presentationMode ? 'fixed inset-0 z-[9998]' : ''}`}>

      {}
      <NodeConfigModal
        isOpen={configModal.open}
        node={nodes.find(n => n.id === configModal.nodeId)}
        onClose={() => setConfigModal({ open: false, nodeId: null })}
        onSave={handleSaveConfig}
        nodes={nodes}
        vars={vars} templates={templates} schedules={schedules}
        whatsappTemplates={whatsappTemplates}
        whatsappInteractiveTemplates={whatsappInteractiveTemplates}
        whatsappSenderOptions={whatsappSenderOptions}
        whatsappChannelReady={whatsappChannelReady}
        queues={queues}
        catalogItems={catalogItems}
        mediaAssets={mediaAssets}
      />

      <VisualBlockNameModal
        open={visualBlockModal.open}
        mode={visualBlockModal.mode}
        title={visualBlockModal.title}
        onChangeTitle={(title) => setVisualBlockModal((current) => ({ ...current, title }))}
        onClose={closeVisualBlockModal}
        onSubmit={submitVisualBlockModal}
      />

      {}
      {!presentationMode && (
      <div className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-3 sm:px-4 min-h-[64px] flex flex-wrap items-center gap-3 shadow-sm z-10">
        <span className="self-center font-bold text-sm text-gray-700 dark:text-slate-200 px-2 border-r border-gray-200 dark:border-slate-700 mr-2 truncate max-w-[160px] sm:max-w-[220px]">
          {flowName}
        </span>

        <div className="group/flow-toolbar relative flex flex-1 self-stretch min-w-0 items-center">
          <div
            ref={toolbarScrollRef}
            className="flow-toolbar-scroll flex flex-1 self-stretch items-center gap-2 overflow-x-auto overflow-y-hidden py-3"
            onWheel={handleToolbarWheel}
          >

        <ToolButton icon={MessageSquare} label="Msg" onClick={() => createNode('messageNode')} />
        <ToolButton icon={TextCursorInput} label="Input" onClick={() => createNode('inputNode')} />
              <ToolButton icon={Hand} label="Hold" onClick={() => createNode('holderNode')} />
        <ToolButton icon={Split} label="If" onClick={() => createNode('conditionNode')} />
        <ToolButton icon={FileText} label="Template" onClick={() => createNode('templateNode')} />
        <ToolButton icon={Smartphone} label="WTN" onClick={() => createNode('whatsappTemplateNode')} />
        <ToolButton icon={Clock} label="Horário" onClick={() => createNode('scheduleNode')} />
        <ToolButton icon={Users} label="Fila" onClick={() => createNode('queueNode')} />
        <ToolButton icon={Star} label="Nota" onClick={() => createNode('ratingNode')} />
        <ToolButton icon={Command} label="Cmd" onClick={() => createNode('commandNode')} />
        <ToolButton icon={MenuIcon} label="Menu" onClick={() => createNode('menuNode')} />
        <ToolButton icon={Settings} label="Seq" onClick={() => createNode('sequentialNode')} />
        {isSuperAdmin && (
                <ToolButton icon={Circle} label="Comercial" onClick={() => createNode('commercialNode')} />
        )}
        <ToolButton icon={ImageIcon} label="Mídia" onClick={() => createNode('mediaNode')} />
        <ToolButton icon={Package} label="Catálogo" onClick={() => createNode('catalogNode')} />
        <ToolButton icon={Code} label="Script" onClick={() => createNode('scriptNode')} />
        <ToolButton icon={Globe} label="API" onClick={() => createNode('httpRequestNode')} />
        <ToolButton icon={Hourglass} label="Delay" onClick={() => createNode('delayNode')} />
        <ToolButton icon={Database} label="Set" onClick={() => createNode('setValueNode')} />
        {!isManager && (
          <ToolButton icon={Key} label="Secret" onClick={() => createNode('secretNode')} color="text-slate-500" />
        )}
        <ToolButton icon={Anchor} label="Flag" onClick={() => createNode('anchorNode')} />
          <ToolButton icon={Send} label="Go" onClick={() => createNode('gotoNode')} />
          <ToolButton icon={Flag} label="Fim" onClick={() => createNode('finalNode')} color="text-red-500" />
          </div>
          {toolbarScrollbar.visible && (
            <div className="absolute inset-x-0 bottom-1 opacity-0 transition-opacity duration-200 group-hover/flow-toolbar:opacity-100">
              <div
                ref={toolbarTrackRef}
                className="pointer-events-auto relative h-1 w-full rounded-full bg-slate-200/55 dark:bg-slate-700/45 cursor-pointer"
                onPointerDown={handleToolbarTrackPointerDown}
              >
                <div
                  className="absolute top-0 left-0 h-full rounded-full bg-slate-400/80 dark:bg-slate-500/80 transition-[transform,width] duration-200 ease-out cursor-grab active:cursor-grabbing"
                  style={{
                    width: `${toolbarScrollbar.thumbWidth}px`,
                    transform: `translateX(${toolbarScrollbar.thumbOffset}px)`
                  }}
                  onPointerDown={handleToolbarThumbPointerDown}
                />
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center self-stretch gap-2 ml-auto w-full sm:w-auto justify-start sm:justify-end py-3">
          <button
            onClick={async () => {
              await loadInactivityConfig();
              setInactivityModalOpen(true);
            }}
            className="
      flex items-center gap-1.5 px-3 py-1.5
      bg-white dark:bg-slate-700
      border border-gray-300 dark:border-slate-600
      text-gray-700 dark:text-slate-100
      rounded text-sm font-medium
      hover:bg-gray-50 dark:hover:bg-slate-600
      transition-all shadow-sm
    "
          >
            <Clock size={14} />
            Inatividade
          </button>
          <button
            onClick={() => save(false)}
            className="
      flex items-center gap-1.5 px-3 py-1.5
      bg-white dark:bg-slate-700
      border border-gray-300 dark:border-slate-600
      text-gray-700 dark:text-slate-100
      rounded text-sm font-medium
      hover:bg-gray-50 dark:hover:bg-slate-600
      transition-all shadow-sm
    "
          >
            <Save size={14} />
            Salvar
          </button>

          <button
            onClick={() => save(true)}
            className="
      flex items-center gap-1.5 px-3 py-1.5
      bg-blue-600 dark:bg-blue-500
      text-white
      rounded text-sm font-medium
      hover:bg-blue-700 dark:hover:bg-blue-400
      transition-all shadow-md active:scale-95
    "
          >
            <Rocket size={14} />
            Publicar
          </button>
        </div>
      </div>
      )}

      <div style={{ flex: 1 }} className={`relative ${presentationMode ? 'min-h-screen bg-[#07111f]' : 'min-h-[60vh]'}`}>
        <ReactFlow
          proOptions={{ hideAttribution: true }}
          nodes={nodes} edges={displayEdges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          onPaneClick={() => {
            setSelectionActionsOpen(false);
            setCanvasMenuOpen(false);
            setSelectedVisualBlockId(null);
          }}
          onMove={(_, nextViewport) => setViewport(nextViewport)}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          snapToGrid={true}
          snapGrid={[20, 20]}
          selectionOnDrag={true}
          panOnDrag={[2]}
          nodesDraggable={!presentationMode}
          nodesConnectable={!presentationMode}
          elementsSelectable={!presentationMode}
          edgesFocusable={!presentationMode}
          nodesFocusable={!presentationMode}
        >
          <Background
            id="fine-grid"
            color={isDark ? '#334155' : '#cbd5e1'}
            gap={20}
            size={1}
          />
          <Background
            id="wide-grid"
            color={isDark ? '#475569' : '#94a3b8'}
            gap={100}
            size={1.25}
          />
          {showMiniMap && !presentationMode && (
            <MiniMap
              className="!absolute !bottom-4 !right-4 !h-36 !w-52 overflow-hidden !rounded-2xl !border !border-slate-200/90 !bg-white/88 !shadow-2xl !backdrop-blur dark:!border-slate-700/80 dark:!bg-slate-950/82"
              nodeColor={(node) => {
                if (node.type === 'startNode') return '#10b981';
                if (node.type === 'finalNode' || node.type === 'endNode') return '#ef4444';
                if (node.type === 'conditionNode') return '#7c3aed';
                if (node.type === 'caseNode') return '#94a3b8';
                if (node.type === 'commercialNode') return '#f97316';
                return '#38bdf8';
              }}
              nodeStrokeColor={(node) => (node.selected ? '#0ea5e9' : 'transparent')}
              nodeStrokeWidth={4}
              maskColor={isDark ? 'rgba(15,23,42,0.62)' : 'rgba(226,232,240,0.64)'}
              pannable
              zoomable
            />
          )}
          {!presentationMode && <Controls className="dark:bg-slate-800 dark:fill-white" />}
        </ReactFlow>
        {!presentationMode && (
        <CanvasNavigationPanel
          open={canvasMenuOpen}
          showMiniMap={showMiniMap}
          selectedCount={selectedNodes.length}
          selectedBlock={selectedVisualBlock}
          onFitAll={zoomToAll}
          onFitSelection={zoomToSelection}
          onFitBlock={zoomToSelectedBlock}
          onToggleOpen={() => setCanvasMenuOpen((current) => !current)}
          onToggleMiniMap={() => setShowMiniMap((current) => !current)}
          onPresentation={enterPresentationMode}
        />
        )}
        <VisualBlocksLayer
          blocks={visualBlocks}
          viewport={viewport}
          selectedBlockId={selectedVisualBlockId}
          onSelect={selectVisualBlock}
          onRemove={removeVisualBlock}
        />
        {presentationMode && (
          <PresentationOverlay
            flowName={flowName}
            selectedNode={selectedNodes[0]}
            onFit={() => fitView({ padding: 0.22, duration: 520 })}
            onExit={exitPresentationMode}
          />
        )}
        {!presentationMode && selectedNodes.length > 0 && selectionActionPoint && (
          <SelectionActionHint
            point={selectionActionPoint}
            open={selectionActionsOpen}
            selectedCount={selectedNodes.length}
            canEdit={selectedNodes.length === 1}
            onCopy={() => {
              copySelectedNodes();
              setSelectionActionsOpen(false);
            }}
            onDuplicate={duplicateSelectedNodes}
            onDelete={deleteSelectedNodes}
            onCreateBlock={createVisualBlockFromSelection}
            onEdit={() => {
              if (selectedNodes.length === 1) {
                openConfig(selectedNodes[0].id);
                setSelectionActionsOpen(false);
              }
            }}
          />
        )}
        {hasCommercialNodes && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20">
            <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-slate-200/90 dark:border-slate-700/80 bg-white/92 dark:bg-slate-900/88 backdrop-blur px-3 py-2 shadow-lg">
              <button
                onClick={triggerCommercialAnimation}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
                title="Tocar linha do tempo (Espaco)"
              >
                <Play size={13} />
                Tocar
              </button>
              <button
                onClick={resetCommercialTimeline}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Reiniciar para o primeiro quadro (Ctrl + Seta Esquerda)"
              >
                <RotateCcw size={13} />
                Reiniciar
              </button>
              <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 select-none">
                <input
                  type="checkbox"
                  checked={hideCommercialGhostsGlobal}
                  onChange={(event) => setHideCommercialGhostsGlobal(event.target.checked)}
                />
                Ocultar fantasmas
              </label>
              <div className="flex-1 min-w-0">
                <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div className="h-full w-0 animate-pulse bg-blue-500/70" />
                </div>
              </div>
              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                Espaco = tocar | Ctrl + Esquerda = reiniciar
              </span>
            </div>
          </div>
        )}
      </div>

      {inactivityModalOpen && (
        <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-t-xl">
              <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <Clock size={16} /> Inatividade Global
              </h3>
              <button
                onClick={() => setInactivityModalOpen(false)}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Tempo máximo (horas)</label>
                <input
                  type="number"
                  min="0"
                  className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                  value={inactivityConfig.inactivityMaxHours}
                  onChange={e => setInactivityConfig(prev => ({ ...prev, inactivityMaxHours: Number(e.target.value) || 0 }))}
                />
                <p className="text-[10px] text-gray-400 mt-1">0 desativa o encerramento automático.</p>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Mensagem ao encerrar</label>
                <textarea
                  className="w-full mt-1 p-2 border rounded-lg text-sm dark:bg-gray-700 dark:text-white h-24"
                  value={inactivityConfig.inactivityMessage}
                  onChange={e => setInactivityConfig(prev => ({ ...prev, inactivityMessage: e.target.value }))}
                  placeholder="Atendimento encerrado por inatividade."
                />
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-b-xl flex justify-end gap-3">
              <button
                onClick={() => setInactivityModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={saveInactivityConfig}
                disabled={inactivitySaving}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 rounded-lg shadow-sm transition-colors disabled:opacity-60"
              >
                {inactivitySaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const VisualBlockNameModal = ({ open, mode, title, onChangeTitle, onClose, onSubmit }) => {
  if (!open) return null;

  const isRename = mode === 'rename';

  return (
    <div className="ui-overlay-fade fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="node-config-modal-surface w-full max-w-sm overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl"
      >
        <div className="border-b border-slate-100 dark:border-slate-800 px-5 py-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            Bloco visual
          </p>
          <h3 className="mt-1 text-base font-bold text-slate-800 dark:text-slate-100">
            {isRename ? 'Renomear bloco' : 'Nomear novo bloco'}
          </h3>
        </div>
        <div className="px-5 py-4">
          <label className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
            Nome
          </label>
          <input
            autoFocus
            value={title}
            onChange={(event) => onChangeTitle(event.target.value)}
            placeholder="Comandos"
            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:ring-blue-950"
          />
          <p className="mt-2 text-[11px] text-slate-400">
            O titulo aparece no canvas como ## Nome do bloco.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/60">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-95"
          >
            {isRename ? 'Salvar nome' : 'Criar bloco'}
          </button>
        </div>
      </form>
    </div>
  );
};

const CanvasNavigationPanel = ({
  open,
  showMiniMap,
  selectedCount,
  selectedBlock,
  onFitAll,
  onFitSelection,
  onFitBlock,
  onToggleOpen,
  onToggleMiniMap,
  onPresentation
}) => (
  <div className="pointer-events-none absolute left-4 top-4 z-20">
    <div className="pointer-events-auto flex items-start gap-2">
      <button
        type="button"
        onClick={onToggleOpen}
        className={`flex h-12 w-12 items-center justify-center rounded-full border shadow-xl backdrop-blur transition-all active:scale-95 ${
          open
            ? 'border-sky-300 bg-sky-500 text-white shadow-[0_18px_44px_rgba(14,165,233,0.28)]'
            : 'border-slate-200/90 bg-white/90 text-slate-600 hover:bg-white hover:text-sky-600 dark:border-slate-700/80 dark:bg-slate-950/84 dark:text-slate-200 dark:hover:text-sky-300'
        }`}
        title={open ? 'Fechar menu do canvas' : 'Abrir menu do canvas'}
      >
        <Menu size={20} strokeWidth={2.5} />
      </button>

      {open && (
        <div className="animate-[nodeConfigPop_180ms_ease-out] overflow-hidden rounded-2xl border border-slate-200/90 bg-white/92 shadow-xl backdrop-blur dark:border-slate-700/80 dark:bg-slate-950/88">
          <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Canvas</p>
          </div>
          <div className="grid gap-1 p-1.5">
            <CanvasNavButton icon={Maximize2} label="Encaixar tudo" onClick={onFitAll} />
            <CanvasNavButton
              icon={Circle}
              label={selectedCount ? `Focar selecao (${selectedCount})` : 'Focar selecao'}
              onClick={onFitSelection}
              muted={!selectedCount}
            />
            <CanvasNavButton
              icon={Layers3}
              label={selectedBlock ? `Focar ${selectedBlock.title}` : 'Focar bloco'}
              onClick={onFitBlock}
              muted={!selectedBlock}
            />
            <CanvasNavButton
              icon={showMiniMap ? EyeOff : MapIcon}
              label={showMiniMap ? 'Ocultar minimapa' : 'Mostrar minimapa'}
              onClick={onToggleMiniMap}
            />
            <CanvasNavButton icon={MonitorPlay} label="Modo apresentacao" onClick={onPresentation} />
          </div>
        </div>
      )}
    </div>
  </div>
);

const PresentationOverlay = ({ flowName, selectedNode, onFit, onExit }) => (
  <>
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-slate-950/78 via-slate-950/34 to-transparent px-6 py-5 text-white">
      <div className="pointer-events-auto flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-200/70">Modo apresentacao</p>
          <h1 className="mt-1 max-w-[720px] truncate text-2xl font-black">{flowName || 'Fluxo'}</h1>
          <p className="mt-1 text-xs font-medium text-slate-300">
            {selectedNode
              ? `Node selecionado: ${selectedNode.data?.customName || selectedNode.data?.label || selectedNode.data?.text || selectedNode.type}`
              : 'Selecione um node antes de apresentar para destacar o caminho.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onFit}
            className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-black text-white shadow-xl backdrop-blur transition hover:bg-white/18"
          >
            Encaixar fluxo
          </button>
          <button
            type="button"
            onClick={onExit}
            className="rounded-full bg-white px-4 py-2 text-xs font-black text-slate-950 shadow-xl transition hover:bg-slate-100"
          >
            Sair ESC
          </button>
        </div>
      </div>
    </div>
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-slate-950/65 to-transparent px-6 py-5 text-center text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">
      Arraste para navegar • Scroll para zoom • F para encaixar • ESC para sair
    </div>
  </>
);

const CanvasNavButton = ({ icon: Icon, label, onClick, muted = false }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold transition-colors ${
      muted
        ? 'text-slate-400 hover:bg-slate-50 dark:text-slate-500 dark:hover:bg-slate-900'
        : 'text-slate-600 hover:bg-sky-50 hover:text-sky-700 dark:text-slate-200 dark:hover:bg-sky-950/40 dark:hover:text-sky-200'
    }`}
  >
    <Icon size={14} />
    <span className="max-w-[150px] truncate">{label}</span>
  </button>
);

const VisualBlocksLayer = ({ blocks, viewport, selectedBlockId, onSelect, onRemove }) => (
  <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden">
    {normalizeVisualBlocks(blocks).map((block) => {
      const topLeft = toScreenPoint({ x: block.bounds.x, y: block.bounds.y }, viewport);
      const width = block.bounds.width * viewport.zoom;
      const height = block.bounds.height * viewport.zoom;
      const selected = block.id === selectedBlockId;
      return (
        <div
          key={block.id}
          className={`absolute rounded-3xl border border-dashed shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] transition-[opacity,box-shadow,transform] duration-200 ${
            selected ? 'ring-2 ring-sky-300/80 ring-offset-2 ring-offset-transparent' : ''
          }`}
          style={{
            left: topLeft.x,
            top: topLeft.y,
            width,
            height,
            borderColor: block.color,
            background: block.color,
            opacity: selected ? Math.min(Number(block.opacity || 0.09) + 0.08, 0.24) : block.opacity
          }}
        />
      );
    })}
    {normalizeVisualBlocks(blocks).map((block) => {
      const titlePoint = toScreenPoint({ x: block.bounds.x + 18, y: block.bounds.y + 14 }, viewport);
      const selected = block.id === selectedBlockId;
      return (
        <div
          key={`${block.id}_title`}
          className="absolute flex items-center gap-2"
          style={{ left: titlePoint.x, top: titlePoint.y }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(block.id);
            }}
            className={`pointer-events-auto select-none rounded-md px-2 py-1 text-left text-lg font-black uppercase tracking-[0.18em] transition-colors ${
              selected
                ? 'bg-white/80 text-sky-600 shadow-sm dark:bg-slate-950/70 dark:text-sky-300'
                : 'text-slate-400/65 hover:bg-white/70 hover:text-slate-600 dark:text-slate-500/70 dark:hover:bg-slate-950/50 dark:hover:text-slate-300'
            }`}
          >
            {block.title}
          </button>
          <button
            type="button"
            onClick={() => onRemove(block.id)}
            className="pointer-events-auto rounded-full bg-white/80 dark:bg-slate-900/75 p-1 text-slate-400 hover:text-red-500 shadow-sm opacity-70 hover:opacity-100 focus:opacity-100 transition-opacity"
            title="Remover bloco visual"
          >
            <Trash2 size={12} />
          </button>
        </div>
      );
    })}
  </div>
);

const SelectionActionHint = ({
  point,
  open,
  selectedCount,
  canEdit,
  onCopy,
  onDuplicate,
  onDelete,
  onCreateBlock,
  onEdit
}) => (
  <div
    className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full"
    style={{ left: point.x, top: point.y - 14 }}
  >
    {!open ? (
      <div className="rounded-full border border-slate-200/90 dark:border-slate-700/80 bg-white/92 dark:bg-slate-900/88 px-3 py-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-300 shadow-lg backdrop-blur">
        ALT = acoes
      </div>
    ) : (
      <div className="pointer-events-auto min-w-[210px] overflow-hidden rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-white/96 dark:bg-slate-900/94 shadow-2xl backdrop-blur animate-[nodeConfigPop_180ms_ease-out]">
        <div className="border-b border-slate-100 dark:border-slate-800 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Selecao</p>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            {selectedCount === 1 ? '1 node selecionado' : `${selectedCount} nodes selecionados`}
          </p>
        </div>
        <div className="p-1.5">
          {canEdit && (
            <SelectionActionButton icon={Pencil} label="Editar configuracao" onClick={onEdit} />
          )}
          <SelectionActionButton icon={Copy} label="Copiar" onClick={onCopy} />
          <SelectionActionButton icon={Clipboard} label="Duplicar" onClick={onDuplicate} />
          <SelectionActionButton icon={Layers3} label="Criar bloco visual" onClick={onCreateBlock} />
          <SelectionActionButton icon={Trash2} label="Excluir selecao" onClick={onDelete} danger />
        </div>
      </div>
    )}
  </div>
);

const SelectionActionButton = ({ icon: Icon, label, onClick, danger = false }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
      danger
        ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30'
        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
    }`}
  >
    <Icon size={14} />
    {label}
  </button>
);

const ToolButton = ({ icon: Icon, label, onClick, color = "text-gray-600 dark:text-slate-300" }) => (
  <button
    onClick={onClick}
    className={`
      flex h-9 items-center gap-1.5 px-3
      bg-white dark:bg-slate-700
      border border-gray-200 dark:border-slate-600
      rounded text-xs font-medium
      ${color}
      hover:bg-gray-50 dark:hover:bg-slate-600
      whitespace-nowrap shadow-sm transition-colors
    `}
  >
    <Icon size={14} /> {label}
  </button>
);

export default () => (<ReactFlowProvider><FlowEditor /></ReactFlowProvider>);
