/**
 * Rectangular Gateway Node Component
 *
 * Displays a gateway node as a rectangular card.
 * Color: Blue (#1a73e8)
 */

import { Handle, Position } from '@xyflow/react';

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

export default function RectGatewayNode({ data }) {
  const address = data.defaultAddress || data.accessAddress || '';
  const childCount = data.childCount || 0;
  const layoutDirection = data.layoutDirection || 'TB';
  const sourcePosition = getSourcePosition(layoutDirection);

  return (
    <div className="rect-node rect-gateway-node">
      <div className="rect-node-label">{data.label}</div>
      {address && <div className="rect-node-address">{address}</div>}
      {childCount > 0 && (
        <div className="rect-node-badge">{childCount} projects</div>
      )}
      <Handle type="source" position={sourcePosition} className="custom-handle" />
    </div>
  );
}
