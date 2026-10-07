/**
 * Rectangular Server Node Component
 *
 * Displays a server node as a rectangular card with OS icon.
 * Color: Grey (#5f6368)
 */

import { Handle, Position } from '@xyflow/react';
import { LinuxIcon, WindowsIcon } from '../components/Icons';

/**
 * Get OS display text
 */
function getOsText(osType) {
  if (!osType) return '';
  const os = osType.toLowerCase();
  if (
    os.includes('linux') ||
    os.includes('ubuntu') ||
    os.includes('centos') ||
    os.includes('debian') ||
    os.includes('rhel') ||
    os.includes('redhat')
  ) {
    return 'Linux';
  }
  if (os.includes('windows')) {
    return 'Windows';
  }
  return osType;
}

/**
 * Get OS icon component based on OS type
 */
function OsIcon({ osType }) {
  if (!osType) return null;

  const os = osType.toLowerCase();
  if (
    os.includes('linux') ||
    os.includes('ubuntu') ||
    os.includes('centos') ||
    os.includes('debian') ||
    os.includes('rhel') ||
    os.includes('redhat')
  ) {
    return <LinuxIcon className="rect-os-icon" width={14} height={14} />;
  }
  if (os.includes('windows')) {
    return <WindowsIcon className="rect-os-icon" width={14} height={14} />;
  }
  return null;
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

export default function RectServerNode({ data }) {
  const osType = data.osType || data.os;
  const osText = getOsText(osType);
  const layoutDirection = data.layoutDirection || 'TB';
  const targetPosition = getTargetPosition(layoutDirection);

  return (
    <div className="rect-node rect-server-node">
      <Handle type="target" position={targetPosition} className="custom-handle" />
      <div className="rect-node-label">{data.label}</div>
      {data.accessAddress && (
        <div className="rect-node-address">{data.accessAddress}</div>
      )}
      {osType && (
        <div className="rect-node-os">
          <OsIcon osType={osType} />
          <span>{osText}</span>
        </div>
      )}
    </div>
  );
}
