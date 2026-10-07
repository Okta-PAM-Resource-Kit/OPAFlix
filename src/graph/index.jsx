/**
 * Graph Entry Point
 *
 * Mounts the ReactFlow infrastructure graph component.
 * React and ReactDOM are loaded from CDN.
 */

import InfraGraph from './InfraGraph.jsx';

/**
 * Cookie name for layout preference
 */
const LAYOUT_COOKIE = 'graphLayout';

/**
 * Get layout preference from cookie
 * @returns {string} 'TB' or 'LR'
 */
function getLayoutCookie() {
  const match = document.cookie.match(new RegExp(`${LAYOUT_COOKIE}=([^;]+)`));
  return match ? match[1] : 'TB';
}

/**
 * Set layout preference cookie (1 year expiration)
 * @param {string} value - 'TB' or 'LR'
 */
function setLayoutCookie(value) {
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  const expires = new Date(Date.now() + oneYear).toUTCString();
  document.cookie = `${LAYOUT_COOKIE}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  const rootElement = document.getElementById('graph-root');

  if (rootElement) {
    // Get layout direction from cookie and renew it
    const direction = getLayoutCookie();
    setLayoutCookie(direction); // Renew cookie expiration on every page load

    // Parse graph data
    const dataElement = document.getElementById('graph-data');
    let graphData = { nodes: [], edges: [] };

    try {
      if (dataElement && dataElement.dataset.graph) {
        graphData = JSON.parse(dataElement.dataset.graph);
      }
    } catch (error) {
      console.error('Failed to parse graph data:', error);
    }

    // Mount single graph with direction from cookie
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <InfraGraph
          initialNodes={graphData.nodes}
          initialEdges={graphData.edges}
          layoutDirection={direction}
          nodeStyle="circular"
          graphId="default"
        />
      </React.StrictMode>
    );
  }
});
