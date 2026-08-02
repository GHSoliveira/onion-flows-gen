import React from 'react';
import {
  BaseEdge,
  getSmoothStepPath
} from 'reactflow';

const TONE_STYLES = {
  default: {
    stroke: '#94a3b8',
    activeStroke: '#38bdf8'
  },
  error: {
    stroke: '#f87171',
    activeStroke: '#ef4444'
  },
  muted: {
    stroke: '#94a3b8',
    activeStroke: '#64748b'
  }
};

const FlowEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
  selected
}) => {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
    offset: 28
  });

  const tone = TONE_STYLES[data?.tone] || TONE_STYLES.default;
  const active = Boolean(data?.active || selected);
  const dimmed = Boolean(data?.dimmed && !active);

  const composedStyle = {
    ...(style || {}),
    stroke: active ? tone.activeStroke : (style?.stroke || tone.stroke),
    strokeWidth: active ? 3 : 2,
    opacity: dimmed ? 0.22 : 1,
    transition: 'stroke 180ms ease, opacity 180ms ease, stroke-width 180ms ease'
  };

  if (data?.dashed) {
    composedStyle.strokeDasharray = '6 7';
  }

  if (active) {
    composedStyle.filter = 'drop-shadow(0 0 4px rgba(56, 189, 248, 0.55))';
  }

  return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={composedStyle} />;
};

export default FlowEdge;
