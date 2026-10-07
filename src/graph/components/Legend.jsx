/**
 * Legend Component
 *
 * Shows a popup explaining node types and icons used in the graph.
 */

import { useState } from 'react';
import {
  GatewayIcon,
  ProjectIcon,
  ServerIcon,
  LinuxIcon,
  WindowsIcon,
  CloseIcon,
  HelpIcon,
} from './Icons';

/**
 * Legend Button Component
 */
export function LegendButton({ onClick }) {
  return (
    <button className="btn btn-secondary btn-small legend-btn" onClick={onClick} title="Show legend">
      <HelpIcon />
      Legend
    </button>
  );
}

/**
 * Legend Popup Component
 */
export function LegendPopup({ isOpen, onClose, nodeStyle = 'circular' }) {
  if (!isOpen) return null;

  const isCircular = nodeStyle === 'circular';

  return (
    <div className="legend-overlay" onClick={onClose}>
      <div className="legend-popup" onClick={(e) => e.stopPropagation()}>
        <div className="legend-header">
          <h3>Graph Legend</h3>
          <button className="legend-close-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="legend-content">
          <div className="legend-section">
            <h4>Node Types</h4>
            <div className="legend-items">
              <div className="legend-item">
                <div className={`legend-node-preview gateway ${isCircular ? 'circular' : 'rectangular'}`}>
                  <GatewayIcon width={16} height={16} />
                </div>
                <div className="legend-item-info">
                  <span className="legend-item-label">Access Gateway</span>
                  <span className="legend-item-desc">Bastion host used by OPA, responsible for the session capture</span>
                </div>
              </div>

              <div className="legend-item">
                <div className={`legend-node-preview project ${isCircular ? 'circular' : 'rectangular'}`}>
                  <ProjectIcon width={16} height={16} />
                </div>
                <div className="legend-item-info">
                  <span className="legend-item-label">Project</span>
                  <span className="legend-item-desc">Collection of resources (servers)</span>
                </div>
              </div>

              <div className="legend-item">
                <div className={`legend-node-preview orphan ${isCircular ? 'circular' : 'rectangular'}`}>
                  <ProjectIcon width={16} height={16} />
                </div>
                <div className="legend-item-info">
                  <span className="legend-item-label">Orphan Project</span>
                  <span className="legend-item-desc">Project without an assigned gateway</span>
                </div>
              </div>

              <div className="legend-item">
                <div className={`legend-node-preview server ${isCircular ? 'circular' : 'rectangular'}`}>
                  <ServerIcon width={16} height={16} />
                </div>
                <div className="legend-item-info">
                  <span className="legend-item-label">Server</span>
                  <span className="legend-item-desc">Target machine for SSH/RDP sessions</span>
                </div>
              </div>

              
            </div>
          </div>

          {/* Operating Systems - temporarily disabled
          <div className="legend-section">
            <h4>Operating Systems</h4>
            <div className="legend-items os-items">
              <div className="legend-item">
                <div className="legend-os-icon">
                  <LinuxIcon width={20} height={20} />
                </div>
                <span className="legend-item-label">Linux</span>
              </div>
              <div className="legend-item">
                <div className="legend-os-icon">
                  <WindowsIcon width={16} height={16} />
                </div>
                <span className="legend-item-label">Windows</span>
              </div>
            </div>
          </div>
          */}

          <div className="legend-section">
            <h4>Interactions</h4>
            <ul className="legend-hints">
              <li><strong>Click</strong> a node to view details</li>
              <li><strong>Double-click</strong> a gateway or project to filter</li>
              <li><strong>Drag</strong> to pan the view / <strong>Scroll</strong> to zoom in/out</li>
              <li><strong>Drag nodes</strong> to reposition them</li>
              <li><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>&nbsp;&nbsp;<strong>Use minimap</strong> to navigate large graphs</li>
              <li><svg width="12" height="12" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M1,12A11,11,0,0,1,17.882,2.7l1.411-1.41A1,1,0,0,1,21,2V6a1,1,0,0,1-1,1H16a1,1,0,0,1-.707-1.707l1.128-1.128A8.994,8.994,0,0,0,3,12a1,1,0,0,1-2,0Zm21-1a1,1,0,0,0-1,1,9.01,9.01,0,0,1-9,9,8.9,8.9,0,0,1-4.42-1.166l1.127-1.127A1,1,0,0,0,8,17H4a1,1,0,0,0-1,1v4a1,1,0,0,0,.617.924A.987.987,0,0,0,4,23a1,1,0,0,0,.707-.293L6.118,21.3A10.891,10.891,0,0,0,12,23,11.013,11.013,0,0,0,23,12,1,1,0,0,0,22,11Z"></path></svg>&nbsp;&nbsp;<strong>Click refresh</strong> to reload the graph</li>
              <li><svg width="12" height="12" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M0 13.867h18.133V6l10 10-10 10v-7.867H0z"></path></svg><svg width="12" height="12" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M13.867 0v18.133H6l10 10 10-10h-7.867V0z"></path></svg>&nbsp;&nbsp;<strong>Click the arrows</strong> to switch between Horizontal and Vertical layouts</li>
              <li><svg width="12" height="12" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="currentColor"><polygon points="27.414,24.586 22.828,20 20,22.828 24.586,27.414 20,32 32,32 32,20"></polygon><polygon points="12,0 0,0 0,12 4.586,7.414 9.129,11.953 11.957,9.125 7.414,4.586"></polygon><polygon points="12,22.828 9.172,20 4.586,24.586 0,20 0,32 12,32 7.414,27.414"></polygon><polygon points="32,0 20,0 24.586,4.586 20.043,9.125 22.871,11.953 27.414,7.414 32,12"></polygon></svg>&nbsp;&nbsp;<strong>Click fullscreen</strong> to extend the graph to the whole screen</li>
        
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Combined Legend Component with button and popup
 */
export default function Legend({ nodeStyle = 'circular' }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <LegendButton onClick={() => setIsOpen(true)} />
      <LegendPopup isOpen={isOpen} onClose={() => setIsOpen(false)} nodeStyle={nodeStyle} />
    </>
  );
}
