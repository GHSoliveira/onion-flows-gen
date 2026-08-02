import React from 'react';
import {
  BaseEdge,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath
} from 'reactflow';

const clamp = (value, min, max, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

const normalizeRoute = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['bezier', 'smoothstep', 'straight'].includes(normalized)) {
    return normalized;
  }
  return 'bezier';
};

const normalizeColor = (value) => {
  const normalized = String(value || '').trim();
  return normalized || '#f97316';
};

const normalizeCommercialEdgeConfig = (rawConfig = {}) => ({
  route: normalizeRoute(rawConfig.route),
  strokeColor: normalizeColor(rawConfig.strokeColor),
  strokeWidth: clamp(rawConfig.strokeWidth, 1, 8, 2),
  opacity: clamp(rawConfig.opacity, 0.2, 1, 1),
  dashed: Boolean(rawConfig.dashed),
  dashLength: clamp(rawConfig.dashLength, 1, 48, 8),
  dashGap: clamp(rawConfig.dashGap, 1, 48, 6),
  animated: Boolean(rawConfig.animated),
  animationDurationMs: clamp(rawConfig.animationDurationMs, 300, 15000, 1400),
  sourceOffsetX: clamp(rawConfig.sourceOffsetX, -400, 400, 0),
  sourceOffsetY: clamp(rawConfig.sourceOffsetY, -400, 400, 0),
  targetOffsetX: clamp(rawConfig.targetOffsetX, -400, 400, 0),
  targetOffsetY: clamp(rawConfig.targetOffsetY, -400, 400, 0),
  curvature: clamp(rawConfig.curvature, 0, 1, 0.25),
  routeOffset: clamp(rawConfig.routeOffset, 0, 400, 80),
  cornerRadius: clamp(rawConfig.cornerRadius, 0, 80, 12)
});

const CommercialEdge = ({
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
  const config = normalizeCommercialEdgeConfig(data?.commercial || {});

  const shiftedSourceX = Number(sourceX || 0) + config.sourceOffsetX;
  const shiftedSourceY = Number(sourceY || 0) + config.sourceOffsetY;
  const shiftedTargetX = Number(targetX || 0) + config.targetOffsetX;
  const shiftedTargetY = Number(targetY || 0) + config.targetOffsetY;

  let path = '';
  if (config.route === 'straight') {
    [path] = getStraightPath({
      sourceX: shiftedSourceX,
      sourceY: shiftedSourceY,
      targetX: shiftedTargetX,
      targetY: shiftedTargetY
    });
  } else if (config.route === 'smoothstep') {
    [path] = getSmoothStepPath({
      sourceX: shiftedSourceX,
      sourceY: shiftedSourceY,
      targetX: shiftedTargetX,
      targetY: shiftedTargetY,
      sourcePosition,
      targetPosition,
      borderRadius: config.cornerRadius,
      offset: config.routeOffset
    });
  } else {
    [path] = getBezierPath({
      sourceX: shiftedSourceX,
      sourceY: shiftedSourceY,
      targetX: shiftedTargetX,
      targetY: shiftedTargetY,
      sourcePosition,
      targetPosition,
      curvature: config.curvature
    });
  }

  const composedStyle = {
    ...(style || {}),
    stroke: config.strokeColor,
    strokeWidth: config.strokeWidth,
    opacity: config.opacity
  };

  if (config.dashed || config.animated) {
    composedStyle.strokeDasharray = `${config.dashLength} ${config.dashGap}`;
  } else if (composedStyle.strokeDasharray) {
    delete composedStyle.strokeDasharray;
  }

  if (config.animated) {
    composedStyle.animation = `commercial-edge-dash ${config.animationDurationMs}ms linear infinite`;
    composedStyle.strokeDashoffset = 0;
  } else if (composedStyle.animation) {
    delete composedStyle.animation;
  }

  if (selected) {
    composedStyle.filter = 'drop-shadow(0 0 2px rgba(14, 165, 233, 0.9))';
  }

  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={composedStyle} />;
};

export default CommercialEdge;

