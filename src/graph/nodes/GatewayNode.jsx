/**
 * Gateway Node Component
 *
 * Displays a gateway node as a circle with torii gate icon.
 * Color: Blue (#1a73e8)
 */

import { Handle, Position } from '@xyflow/react';
import { GatewayIcon } from '../components/Icons';

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

export default function GatewayNode({ data }) {
  const childCount = data.childCount || 0;
  const layoutDirection = data.layoutDirection || 'TB';
  const sourcePosition = getSourcePosition(layoutDirection);

  return (
    <div className="circle-node gateway-node">
      <div className="circle-node-ring">
        <div className="circle-node-inner">
          <GatewayIcon />
        </div>
      </div>
      <div className="circle-node-label">{data.label}</div>
      {childCount > 0 && (
        <div className="circle-node-count">{childCount} projects</div>
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
