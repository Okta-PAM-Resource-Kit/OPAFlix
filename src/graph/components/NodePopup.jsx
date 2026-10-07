/**
 * NodePopup Component
 *
 * Displays detailed information about a selected node in a popup.
 * Includes "View Sessions" links for Server and Project nodes.
 */

import { LinuxIcon, WindowsIcon } from './Icons';

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format date string
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString();
  } catch (e) {
    return dateStr;
  }
}

/**
 * External link icon SVG
 */
function ExternalLinkIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
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
    return <LinuxIcon className="os-icon linux-icon" width={24} height={24} />;
  }
  if (os.includes('windows')) {
    return <WindowsIcon className="os-icon windows-icon" width={16} height={16} />;
  }
  return null;
}

/**
 * Gateway popup content
 */
function GatewayContent({ data }) {
  return (
    <div className="node-popup gateway-popup">
      <div className="popup-header">
        <h3>Gateway: {data.label}</h3>
      </div>
      <dl className="popup-details">
        {data.gatewayId && (
          <>
            <dt>ID</dt>
            <dd>
              <code>{data.gatewayId}</code>
            </dd>
          </>
        )}
        {data.defaultAddress && (
          <>
            <dt>Default Address</dt>
            <dd>{data.defaultAddress}</dd>
          </>
        )}
        {data.accessAddress && (
          <>
            <dt>Access Address</dt>
            <dd>{data.accessAddress}</dd>
          </>
        )}
        {data.cloudProvider && (
          <>
            <dt>Cloud Provider</dt>
            <dd>{data.cloudProvider}</dd>
          </>
        )}
        {data.description && (
          <>
            <dt>Description</dt>
            <dd>{data.description}</dd>
          </>
        )}
        {data.status && (
          <>
            <dt>Status</dt>
            <dd>{data.status}</dd>
          </>
        )}
        {data.statusUpdatedAt && (
          <>
            <dt>Last Check-in</dt>
            <dd>{formatDate(data.statusUpdatedAt)}</dd>
          </>
        )}
        {data.totalStorageBytes > 0 && (
          <>
            <dt>Storage</dt>
            <dd>
              {formatBytes(data.usedStorageBytes || 0)} /{' '}
              {formatBytes(data.totalStorageBytes)} (
              {((data.usedStorageBytes / data.totalStorageBytes) * 100).toFixed(1)}%)
            </dd>
          </>
        )}
        {data.labels && Object.keys(data.labels).length > 0 && (
          <>
            <dt>Labels</dt>
            <dd className="labels-list">
              {Object.entries(data.labels).map(([key, value]) => (
                <span key={key} className="label-tag">
                  {key}={value}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

/**
 * Project popup content
 */
function ProjectContent({ data }) {
  const isOrphaned = data.isOrphaned;

  return (
    <div className="node-popup project-popup">
      <div className="popup-header">
        <h3>Project: {data.label}</h3>
      </div>
      <dl className="popup-details">
        {data.projectId && (
          <>
            <dt>ID</dt>
            <dd>
              <code>{data.projectId}</code>
            </dd>
          </>
        )}
        <dt>Gateway Selector</dt>
        <dd>
          {data.gatewaySelector ? (
            <code>{data.gatewaySelector}</code>
          ) : (
            <em>None</em>
          )}
        </dd>
        {data.resourceGroupName && (
          <>
            <dt>Resource Group</dt>
            <dd>{data.resourceGroupName}</dd>
          </>
        )}
        {isOrphaned && (
          <>
            <dt>Status</dt>
            <dd className="status-warning">No matching gateway</dd>
          </>
        )}
      </dl>
      <div className="popup-links">
        <a
          href={`/sessions/list?project=${encodeURIComponent(data.label)}`}
          className="popup-link"
        >
          <ExternalLinkIcon />
          View Sessions
        </a>
      </div>
    </div>
  );
}

/**
 * Server popup content
 */
function ServerContent({ data }) {
  const osType = data.osType || data.os;

  return (
    <div className="node-popup server-popup">
      <div className="popup-header">
        <h3>
          <OsIcon osType={osType} />
          Server: {data.label}
        </h3>
      </div>
      <dl className="popup-details">
        {data.serverId && (
          <>
            <dt>ID</dt>
            <dd>
              <code>{data.serverId}</code>
            </dd>
          </>
        )}
        {data.accessAddress && (
          <>
            <dt>Access Address</dt>
            <dd>{data.accessAddress}</dd>
          </>
        )}
        {data.altNames && data.altNames.length > 0 && (
          <>
            <dt>Alternative Names</dt>
            <dd>{data.altNames.join(', ')}</dd>
          </>
        )}
        {data.osType && (
          <>
            <dt>OS Type</dt>
            <dd>{data.osType}</dd>
          </>
        )}
        {data.os && (
          <>
            <dt>Operating System</dt>
            <dd>{data.os}</dd>
          </>
        )}
        {data.cloudProvider && (
          <>
            <dt>Cloud Provider</dt>
            <dd>{data.cloudProvider}</dd>
          </>
        )}
        {data.agentVersion && (
          <>
            <dt>Agent Version</dt>
            <dd>{data.agentVersion}</dd>
          </>
        )}
        {data.projectName && (
          <>
            <dt>Project</dt>
            <dd>{data.projectName}</dd>
          </>
        )}
        {data.state && (
          <>
            <dt>State</dt>
            <dd>{data.state}</dd>
          </>
        )}
        {data.labels && Object.keys(data.labels).length > 0 && (
          <>
            <dt>Labels</dt>
            <dd className="labels-list">
              {Object.entries(data.labels).map(([key, value]) => (
                <span key={key} className="label-tag">
                  {key}={value}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
      <div className="popup-links">
        <a
          href={`/sessions/list?server=${encodeURIComponent(
            data.hostname || data.name || data.label
          )}`}
          className="popup-link"
        >
          <ExternalLinkIcon />
          View Sessions
        </a>
      </div>
    </div>
  );
}

/**
 * Main NodePopup component
 */
export default function NodePopup({ node, position, onClose }) {
  if (!node) return null;

  const { type, data } = node;

  // Determine which content to render
  let content;
  if (type === 'gateway') {
    content = <GatewayContent data={data} />;
  } else if (type === 'project' || type === 'projectOrphan') {
    content = <ProjectContent data={data} />;
  } else if (type === 'server') {
    content = <ServerContent data={data} />;
  } else {
    return null;
  }

  // Use the pre-calculated position from InfraGraph
  const style = {
    position: 'fixed',
    left: position.x,
    top: position.y,
    zIndex: 1000,
  };

  return (
    <div className="node-popup-container" style={style}>
      {content}
    </div>
  );
}
