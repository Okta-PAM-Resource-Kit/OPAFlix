/**
 * Graph Controller
 *
 * Handles the infrastructure graph page that visualizes
 * OPA topology (Gateways -> Projects -> Servers) using ReactFlow.
 */

const { getLogger } = require('../config/logger');
const { isEnabled } = require('../services/opaApiService');
const { getInfrastructureTopology } = require('../services/opaGraphService');

const logger = getLogger();

/**
 * Generate ReactFlow elements from topology data
 * @param {Object} topology - Topology data from opaGraphService
 * @returns {Object} Object with nodes and edges arrays for ReactFlow
 */
function generateReactFlowElements(topology) {
  const nodes = [];
  const edges = [];

  const { gateways, projects, servers, relationships } = topology;

  // Build set of project names that have servers and count servers per project
  const projectsWithServers = new Set();
  const serverCountByProject = new Map();
  relationships.projectToServers.forEach((serverIds, projectName) => {
    if (serverIds && serverIds.length > 0) {
      projectsWithServers.add(projectName);
      serverCountByProject.set(projectName, serverIds.length);
    }
  });

  // Build set of included project IDs (projects with servers)
  const includedProjectIds = new Set();
  const projectIdToName = new Map();
  projects.forEach((project) => {
    if (projectsWithServers.has(project.name)) {
      includedProjectIds.add(project.id);
      projectIdToName.set(project.id, project.name);
    }
  });

  // Count projects per gateway (only included projects)
  const projectCountByGateway = new Map();
  relationships.gatewayToProjects.forEach((projectIds, gatewayId) => {
    const includedCount = projectIds.filter((id) => includedProjectIds.has(id)).length;
    if (includedCount > 0) {
      projectCountByGateway.set(gatewayId, includedCount);
    }
  });

  // Create gateway nodes
  gateways.forEach((gateway) => {
    const childCount = projectCountByGateway.get(gateway.id) || 0;
    nodes.push({
      id: `gw-${gateway.id}`,
      type: 'gateway',
      position: { x: 0, y: 0 }, // Dagre will calculate actual positions
      data: {
        label: gateway.name,
        gatewayId: gateway.id,
        accessAddress: gateway.accessAddress,
        defaultAddress: gateway.defaultAddress,
        labels: gateway.labels || {},
        cloudProvider: gateway.cloudProvider,
        description: gateway.description,
        status: gateway.status,
        statusUpdatedAt: gateway.statusUpdatedAt,
        totalStorageBytes: gateway.totalStorageBytes,
        usedStorageBytes: gateway.usedStorageBytes,
        childCount,
      },
    });
  });

  // Create project nodes (only if they have servers)
  projects.forEach((project) => {
    // Skip projects without servers
    if (!projectsWithServers.has(project.name)) {
      return;
    }

    const isOrphaned = relationships.orphanedProjects.includes(project.id);
    const childCount = serverCountByProject.get(project.name) || 0;
    nodes.push({
      id: `proj-${project.id}`,
      type: isOrphaned ? 'projectOrphan' : 'project',
      position: { x: 0, y: 0 },
      data: {
        label: project.name,
        projectId: project.id,
        gatewaySelector: project.gatewaySelector,
        resourceGroupId: project.resourceGroupId,
        resourceGroupName: project.resourceGroupName,
        isOrphaned,
        childCount,
      },
    });
  });

  // Create server nodes
  servers.forEach((server) => {
    nodes.push({
      id: `srv-${server.id}`,
      type: 'server',
      position: { x: 0, y: 0 },
      data: {
        label: server.hostname || server.name,
        serverId: server.id,
        hostname: server.hostname,
        name: server.name,
        projectName: server.projectName,
        accessAddress: server.accessAddress,
        altNames: server.altNames,
        os: server.os,
        osType: server.osType,
        cloudProvider: server.cloudProvider,
        agentVersion: server.agentVersion,
        labels: server.labels || {},
        state: server.state,
      },
    });
  });

  // Create edges: Gateway -> Project (only for included projects)
  relationships.gatewayToProjects.forEach((projectIds, gatewayId) => {
    projectIds.forEach((projectId) => {
      // Only create edge if project is included
      if (includedProjectIds.has(projectId)) {
        edges.push({
          id: `e-gw-${gatewayId}-proj-${projectId}`,
          source: `gw-${gatewayId}`,
          target: `proj-${projectId}`,
          type: 'default',
        });
      }
    });
  });

  // Create edges: Project -> Server
  relationships.projectToServers.forEach((serverIds, projectName) => {
    // Find project ID by name
    const project = projects.find((p) => p.name === projectName);
    if (project && includedProjectIds.has(project.id)) {
      serverIds.forEach((serverId) => {
        edges.push({
          id: `e-proj-${project.id}-srv-${serverId}`,
          source: `proj-${project.id}`,
          target: `srv-${serverId}`,
          type: 'default',
        });
      });
    }
  });

  return { nodes, edges };
}

/**
 * Display the infrastructure graph page
 */
async function showGraph(req, res, next) {
  try {
    const { tenantContext } = req;

    // Check if OPA API is configured
    if (!isEnabled(tenantContext.config)) {
      return res.render('graph', {
        title: 'Infrastructure Graph',
        activeTab: 'graph',
        pageStyles: `<link rel="stylesheet" href="${req.app.locals.assetUrl('/css/graph.css')}">`,
        opaEnabled: false,
        user: req.userContext?.userinfo,
        isAuthenticated: true,
      });
    }

    // Fetch topology data (reuse existing service)
    const topology = await getInfrastructureTopology(tenantContext.config);

    // Generate ReactFlow elements
    const reactFlowElements = generateReactFlowElements(topology);

    // Calculate stats from actual rendered nodes (after filtering)
    const gatewayNodes = reactFlowElements.nodes.filter((n) => n.type === 'gateway');
    const projectNodes = reactFlowElements.nodes.filter(
      (n) => n.type === 'project' || n.type === 'projectOrphan'
    );
    const serverNodes = reactFlowElements.nodes.filter((n) => n.type === 'server');

    const stats = {
      gatewayCount: gatewayNodes.length,
      projectCount: projectNodes.length,
      serverCount: serverNodes.length,
      orphanedProjects: topology.relationships.orphanedProjects.length,
      orphanedServers: topology.relationships.orphanedServers.length,
    };

    // Extract errors from topology
    const fetchErrors = topology.errors || [];

    res.render('graph', {
      title: 'Infrastructure Graph',
      activeTab: 'graph',
      pageStyles: `<link rel="stylesheet" href="${req.app.locals.assetUrl('/css/graph.css')}">`,
      opaEnabled: true,
      graphData: JSON.stringify(reactFlowElements),
      stats,
      fetchErrors: fetchErrors.length > 0 ? fetchErrors : null,
      user: req.userContext?.userinfo,
      isAuthenticated: true,
    });
  } catch (error) {
    logger.error('Failed to generate graph', { error: error.message, stack: error.stack });
    next(error);
  }
}

module.exports = {
  showGraph,
};
