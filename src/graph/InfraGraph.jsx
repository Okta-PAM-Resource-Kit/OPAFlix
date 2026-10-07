/**
 * InfraGraph Component
 *
 * Main ReactFlow component for visualizing OPA infrastructure topology.
 * Uses dagre for automatic hierarchical layout.
 *
 * Props:
 * - initialNodes: Array of node objects
 * - initialEdges: Array of edge objects
 * - layoutDirection: 'TB' | 'LR' | 'BT' | 'RL' (default: 'TB')
 * - nodeStyle: 'circular' | 'rectangular' (default: 'circular')
 * - graphId: unique ID for multiple instances (default: 'default')
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';

import GatewayNode from './nodes/GatewayNode.jsx';
import ProjectNode from './nodes/ProjectNode.jsx';
import ServerNode from './nodes/ServerNode.jsx';
import RectGatewayNode from './nodes/RectGatewayNode.jsx';
import RectProjectNode from './nodes/RectProjectNode.jsx';
import RectServerNode from './nodes/RectServerNode.jsx';
import NodePopup from './components/NodePopup.jsx';
import Legend from './components/Legend.jsx';
import GraphControls from './components/GraphControls.jsx';

// Circular node types
const circularNodeTypes = {
  gateway: GatewayNode,
  project: ProjectNode,
  projectOrphan: ProjectNode,
  server: ServerNode,
};

// Rectangular node types
const rectangularNodeTypes = {
  gateway: RectGatewayNode,
  project: RectProjectNode,
  projectOrphan: RectProjectNode,
  server: RectServerNode,
};

// Node dimensions for layout
const CIRCULAR_NODE_WIDTH = 100;
const CIRCULAR_NODE_HEIGHT = 90;
const RECT_NODE_WIDTH = 160;
const RECT_NODE_HEIGHT = 60;

/**
 * Apply dagre layout to nodes and edges
 * @param {Array} nodes - Array of node objects
 * @param {Array} edges - Array of edge objects
 * @param {string} direction - Layout direction: 'TB', 'LR', 'BT', 'RL'
 * @param {string} nodeStyle - Node style: 'circular' or 'rectangular'
 */
function getLayoutedElements(nodes, edges, direction = 'TB', nodeStyle = 'circular') {
  const nodeWidth = nodeStyle === 'rectangular' ? RECT_NODE_WIDTH : CIRCULAR_NODE_WIDTH;
  const nodeHeight = nodeStyle === 'rectangular' ? RECT_NODE_HEIGHT : CIRCULAR_NODE_HEIGHT;

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: nodeStyle === 'rectangular' ? 60 : 80,
    ranksep: nodeStyle === 'rectangular' ? 80 : 100,
    marginx: 40,
    marginy: 40,
  });

  // Add nodes to dagre
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  // Add edges to dagre
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Run layout algorithm
  dagre.layout(dagreGraph);

  // Apply calculated positions to nodes and add layoutDirection to data
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      data: {
        ...node.data,
        layoutDirection: direction,
      },
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  // Style edges with arrows and smooth bezier curves
  const styledEdges = edges.map((edge) => ({
    ...edge,
    type: 'default',  // 'default' uses bezier curves for smooth rounded connections
    animated: false,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 15,
      height: 15,
      color: '#999',
    },
    style: {
      strokeWidth: 2,
      stroke: '#999',
    },
  }));

  return { nodes: layoutedNodes, edges: styledEdges };
}

/**
 * Get node position in screen coordinates
 */
function getNodeScreenPosition(node, flowInstance, containerRef) {
  if (!flowInstance || !containerRef.current) {
    return { x: 0, y: 0 };
  }

  const { x, y, zoom } = flowInstance.getViewport();
  const containerRect = containerRef.current.getBoundingClientRect();

  // Node position in flow coordinates -> screen coordinates
  const screenX = node.position.x * zoom + x + containerRect.left;
  const screenY = node.position.y * zoom + y + containerRect.top;

  return { x: screenX, y: screenY };
}

/**
 * MiniMap node color function
 */
function getMiniMapNodeColor(node) {
  switch (node.type) {
    case 'gateway':
      return '#1a73e8';
    case 'project':
      return '#34a853';
    case 'projectOrphan':
      return '#9c27b0';
    case 'server':
      return '#5f6368';
    default:
      return '#999';
  }
}

/**
 * Inner component that has access to ReactFlow instance
 */
function InfraGraphInner({
  initialNodes,
  initialEdges,
  layoutDirection = 'TB',
  nodeStyle = 'circular',
  graphId = 'default',
}) {
  // Store initial data for reset
  const initialDataRef = useRef({ nodes: initialNodes, edges: initialEdges });

  // Select node types based on style
  const nodeTypes = useMemo(
    () => (nodeStyle === 'rectangular' ? rectangularNodeTypes : circularNodeTypes),
    [nodeStyle]
  );

  // Apply layout on initial data
  const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
    initialNodes,
    initialEdges,
    layoutDirection,
    nodeStyle
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  // Popup state
  const [selectedNode, setSelectedNode] = useState(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });

  // Minimap visibility state (starts closed)
  const [showMinimap, setShowMinimap] = useState(false);

  // Filter state - when set, only show this node and its descendants
  const [filteredNodeId, setFilteredNodeId] = useState(null);

  // Compute filtered nodes and edges when filter is active
  const { filteredNodes, filteredEdges, filteredNodeData } = useMemo(() => {
    if (!filteredNodeId) {
      return { filteredNodes: nodes, filteredEdges: edges, filteredNodeData: null };
    }

    // Find the filtered node
    const rootNode = nodes.find((n) => n.id === filteredNodeId);
    if (!rootNode) {
      return { filteredNodes: nodes, filteredEdges: edges, filteredNodeData: null };
    }

    // Build adjacency list from edges (source -> targets)
    const childrenMap = new Map();
    edges.forEach((edge) => {
      if (!childrenMap.has(edge.source)) {
        childrenMap.set(edge.source, []);
      }
      childrenMap.get(edge.source).push(edge.target);
    });

    // BFS to collect all descendants
    const visibleNodeIds = new Set([filteredNodeId]);
    const queue = [filteredNodeId];
    while (queue.length > 0) {
      const current = queue.shift();
      const children = childrenMap.get(current) || [];
      for (const childId of children) {
        if (!visibleNodeIds.has(childId)) {
          visibleNodeIds.add(childId);
          queue.push(childId);
        }
      }
    }

    // Filter nodes and edges
    const newFilteredNodes = nodes.filter((n) => visibleNodeIds.has(n.id));
    const newFilteredEdges = edges.filter(
      (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
    );

    return {
      filteredNodes: newFilteredNodes,
      filteredEdges: newFilteredEdges,
      filteredNodeData: rootNode,
    };
  }, [filteredNodeId, nodes, edges]);

  const containerRef = useRef(null);
  const flowInstance = useReactFlow();

  // Reset view function - re-apply layout, clear filter, and fit view
  const resetView = useCallback(() => {
    // Re-apply dagre layout
    const { nodes: relayoutedNodes, edges: relayoutedEdges } = getLayoutedElements(
      initialDataRef.current.nodes,
      initialDataRef.current.edges,
      layoutDirection,
      nodeStyle
    );
    setNodes(relayoutedNodes);
    setEdges(relayoutedEdges);

    // Close popup and clear filter
    setSelectedNode(null);
    setFilteredNodeId(null);

    // Fit view after a short delay to allow nodes to update
    setTimeout(() => {
      flowInstance.fitView({ padding: 0.2, duration: 300 });
    }, 50);
  }, [flowInstance, setNodes, setEdges, layoutDirection, nodeStyle]);

  // Expose resetView function on window for external access (legacy support)
  useEffect(() => {
    const resetFnName = graphId === 'default' ? 'graphResetView' : `graphResetView_${graphId}`;
    window[resetFnName] = resetView;
    return () => {
      delete window[resetFnName];
    };
  }, [resetView, graphId]);

  // Handle node click - show popup
  const handleNodeClick = useCallback(
    (event, node) => {
      event.stopPropagation();

      // Calculate screen position for popup
      const position = getNodeScreenPosition(node, flowInstance, containerRef);

      // Popup dimensions and margins
      const POPUP_WIDTH = 420;   // Match CSS max-width
      const POPUP_HEIGHT = 400;  // Approximate max height
      const MARGIN = 20;         // Screen edge margin
      const NODE_OFFSET = 100;   // Offset from node

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Start with popup to the right of node
      let popupX = position.x + NODE_OFFSET;
      let popupY = position.y - 50;

      // If goes off right edge, flip to left side
      if (popupX + POPUP_WIDTH > viewportWidth - MARGIN) {
        popupX = position.x - POPUP_WIDTH - MARGIN;
      }

      // If still goes off left edge, clamp to left margin
      if (popupX < MARGIN) {
        popupX = MARGIN;
      }

      // Vertical: ensure popup stays within viewport
      if (popupY + POPUP_HEIGHT > viewportHeight - MARGIN) {
        popupY = viewportHeight - POPUP_HEIGHT - MARGIN;
      }
      if (popupY < MARGIN) {
        popupY = MARGIN;
      }

      setSelectedNode(node);
      setPopupPosition({ x: popupX, y: popupY });
    },
    [flowInstance]
  );

  // Handle pane click - close popup
  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Handle node double-click - filter to show only this node and descendants
  const handleNodeDoubleClick = useCallback((event, node) => {
    // Only allow filtering on gateway and project nodes (not servers)
    if (node.type === 'gateway' || node.type === 'project' || node.type === 'projectOrphan') {
      setFilteredNodeId(node.id);
      setSelectedNode(null); // Close any open popup
      // Fit view after filter is applied
      setTimeout(() => {
        flowInstance.fitView({ padding: 0.2, duration: 300 });
      }, 50);
    }
  }, [flowInstance]);

  // Handle zoom/pan - close popup
  const handleMove = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Clear the filter and restore full graph
  const clearFilter = useCallback(() => {
    setFilteredNodeId(null);
    setTimeout(() => {
      flowInstance.fitView({ padding: 0.2, duration: 300 });
    }, 50);
  }, [flowInstance]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={filteredNodes}
        edges={filteredEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={handlePaneClick}
        onMove={handleMove}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        attributionPosition="bottom-left"
      >
        <Background color="#e0e0e0" gap={20} />
        <Controls showInteractive={false} />
        {showMinimap ? (
          <div className="minimap-container">
            <button
              className="minimap-close-btn"
              onClick={() => setShowMinimap(false)}
              title="Hide minimap"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <MiniMap
              nodeColor={getMiniMapNodeColor}
              nodeStrokeWidth={3}
              zoomable
              pannable
            />
          </div>
        ) : (
          <button
            className="minimap-restore-btn"
            onClick={() => setShowMinimap(true)}
            title="Show minimap"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <rect x="14" y="14" width="6" height="6" rx="1" />
            </svg>
          </button>
        )}
        {/* Graph Controls - positioned in top-left, inside ReactFlow for proper styling */}
        <GraphControls
          layoutDirection={layoutDirection}
          onResetView={resetView}
        />
      </ReactFlow>

      {/* Legend Button - positioned in top-right */}
      <div className="graph-legend-container">
        <Legend nodeStyle={nodeStyle} />
      </div>

      {/* Filter Indicator - shown when filtering by node */}
      {filteredNodeId && filteredNodeData && (
        <div className="graph-filter-indicator">
          <span className="filter-label">
            Showing: <strong>{filteredNodeData.data?.label || filteredNodeId}</strong>
          </span>
          <button
            className="filter-clear-btn"
            onClick={clearFilter}
            title="Clear filter and show all nodes"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            Clear
          </button>
        </div>
      )}

      {selectedNode && (
        <NodePopup
          node={selectedNode}
          position={popupPosition}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}

/**
 * Wrapper component that provides ReactFlowProvider
 */
export default function InfraGraph({
  initialNodes = [],
  initialEdges = [],
  layoutDirection = 'TB',
  nodeStyle = 'circular',
  graphId = 'default',
}) {
  return (
    <ReactFlowProvider>
      <InfraGraphInner
        initialNodes={initialNodes}
        initialEdges={initialEdges}
        layoutDirection={layoutDirection}
        nodeStyle={nodeStyle}
        graphId={graphId}
      />
    </ReactFlowProvider>
  );
}
