/**
 * Rectangular Project Node Component
 *
 * Displays a project node as a rectangular card.
 * Color: Green (#34a853) or Purple (#9c27b0) for orphaned projects.
 */

import { Handle, Position } from '@xyflow/react';

/**
 * Get target handle position based on layout direction
 */
function getTargetPosition(layoutDirection) {
  switch (layoutDirection) {
    case 'LR':
      return Position.Left;
    case 'RL':
      return Position.Right;
    case 'BT':
      return Position.Bottom;
    case 'TB':
    default:
      return Position.Top;
  }
}

/**
 * Get source handle position based on layout direction
 */
function getSourcePosition(layoutDirection) {
  switch (layoutDirection) {
    case 'LR':
      return Position.Right;
    case 'RL':
      return Position.Left;
    case 'BT':
      return Position.Top;
    case 'TB':
    default:
      return Position.Bottom;
  }
}

export default function RectProjectNode({ data, type }) {
  const isOrphaned = type === 'projectOrphan' || data.isOrphaned;
  const className = isOrphaned
    ? 'rect-node rect-project-orphan-node'
    : 'rect-node rect-project-node';
  const childCount = data.childCount || 0;
  const layoutDirection = data.layoutDirection || 'TB';
  const targetPosition = getTargetPosition(layoutDirection);
  const sourcePosition = getSourcePosition(layoutDirection);

  return (
    <div className={className}>
      <Handle type="target" position={targetPosition} className="custom-handle" />
      <div className="rect-node-label">{data.label}</div>
      {childCount > 0 && (
        <div className="rect-node-badge">{childCount} servers</div>
      )}
      {isOrphaned && childCount === 0 && <div className="rect-node-badge">No Gateway</div>}
      <Handle type="source" position={sourcePosition} className="custom-handle" />
    </div>
  );
}
