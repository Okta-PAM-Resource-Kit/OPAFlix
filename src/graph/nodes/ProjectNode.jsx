/**
 * Project Node Component
 *
 * Displays a project node as a circle with grid icon.
 * Color: Green (#34a853) or Purple (#9c27b0) for orphaned projects.
 * Clickable - navigates to sessions filtered by project.
 */

import { Handle, Position } from '@xyflow/react';
import { ProjectIcon } from '../components/Icons';

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

/**
 * Get handle style for horizontal layouts to align with circle center
 * Circle is 56px, so center is at 28px from top, edges at 50% +/- 28px
 */
function getHandleStyle(position) {
  if (position === Position.Left) {
    return { top: '28px', left: 'calc(50% - 28px)' };
  }
  if (position === Position.Right) {
    return { top: '28px', left: 'calc(50% + 28px)' };
  }
  return undefined;
}

export default function ProjectNode({ data, type }) {
  const isOrphaned = type === 'projectOrphan' || data.isOrphaned;
  const className = isOrphaned ? 'circle-node project-orphan-node' : 'circle-node project-node';
  const childCount = data.childCount || 0;
  const layoutDirection = data.layoutDirection || 'TB';
  const targetPosition = getTargetPosition(layoutDirection);
  const sourcePosition = getSourcePosition(layoutDirection);

  return (
    <div className={className}>
      <Handle
        type="target"
        position={targetPosition}
        className="custom-handle"
        style={getHandleStyle(targetPosition)}
      />
      <div className="circle-node-ring">
        <div className="circle-node-inner">
          <ProjectIcon />
        </div>
      </div>
      <div className="circle-node-label">{data.label}</div>
      {childCount > 0 && (
        <div className="circle-node-count">{childCount} servers</div>
      )}
      {isOrphaned && childCount === 0 && (
        <div className="circle-node-count orphan-badge">No Gateway</div>
      )}
      <Handle
        type="source"
        position={sourcePosition}
        className="custom-handle"
        style={getHandleStyle(sourcePosition)}
      />
    </div>
  );
}
