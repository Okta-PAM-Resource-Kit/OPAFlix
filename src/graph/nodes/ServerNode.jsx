/**
 * Server Node Component
 *
 * Displays a server node as a circle with OS-specific icon.
 * Color: Grey (#5f6368)
 * Clickable - navigates to sessions filtered by server.
 */

import { Handle, Position } from '@xyflow/react';
import { LinuxIcon, WindowsIcon, ServerIcon } from '../components/Icons';

/**
 * Get OS icon component based on OS type
 */
function OsIcon({ osType }) {
  if (!osType) return <ServerIcon />;

  const os = osType.toLowerCase();
  if (
    os.includes('linux') ||
    os.includes('ubuntu') ||
    os.includes('centos') ||
    os.includes('debian') ||
    os.includes('rhel') ||
    os.includes('redhat')
  ) {
    // Linux icon is larger for better visibility
    return <LinuxIcon width={36} height={36} />;
  }
  if (os.includes('windows')) {
    return <WindowsIcon />;
  }
  return <ServerIcon />;
}

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

export default function ServerNode({ data }) {
  const osType = data.osType || data.os;
  const layoutDirection = data.layoutDirection || 'TB';
  const targetPosition = getTargetPosition(layoutDirection);

  return (
    <div className="circle-node server-node">
      <Handle
        type="target"
        position={targetPosition}
        className="custom-handle"
        style={getHandleStyle(targetPosition)}
      />
      <div className="circle-node-ring">
        <div className="circle-node-inner">
          <OsIcon osType={osType} />
        </div>
      </div>
      <div className="circle-node-label">{data.label}</div>
    </div>
  );
}
