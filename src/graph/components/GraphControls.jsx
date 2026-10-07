/**
 * GraphControls Component
 *
 * Control buttons styled identically to ReactFlow's built-in controls.
 */

import { useState, useCallback, useEffect } from 'react';

const LAYOUT_COOKIE = 'graphLayout';
const FULLSCREEN_KEY = 'graphFullscreen';

function setLayoutCookie(value) {
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  const expires = new Date(Date.now() + oneYear).toUTCString();
  document.cookie = `${LAYOUT_COOKIE}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute('content') : '';
}

export default function GraphControls({ layoutDirection, onResetView }) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() =>
    sessionStorage.getItem(FULLSCREEN_KEY) === 'true'
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    const url = new URL(window.location.href);
    const team = url.searchParams.get('team') || '';

    fetch('/api/refresh/graph' + (team ? '?team=' + encodeURIComponent(team) : ''), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken(),
      },
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          window.location.reload();
        } else {
          alert('Failed to refresh graph: ' + (data.error || 'Unknown error'));
          setIsRefreshing(false);
        }
      })
      .catch((error) => {
        alert('Failed to refresh graph: ' + error.message);
        setIsRefreshing(false);
      });
  }, []);

  const handleLayoutToggle = useCallback(() => {
    const newDirection = layoutDirection === 'TB' ? 'LR' : 'TB';
    setLayoutCookie(newDirection);
    window.location.reload();
  }, [layoutDirection]);

  const handleFullscreen = useCallback(() => {
    const graphPage = document.querySelector('.graph-page');
    if (!graphPage) return;

    graphPage.classList.toggle('fullscreen-mode');
    const newIsFullscreen = graphPage.classList.contains('fullscreen-mode');
    setIsFullscreen(newIsFullscreen);
    sessionStorage.setItem(FULLSCREEN_KEY, newIsFullscreen ? 'true' : 'false');

    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      if (onResetView) onResetView();
    }, 100);
  }, [onResetView]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        const graphPage = document.querySelector('.graph-page');
        if (graphPage && graphPage.classList.contains('fullscreen-mode')) {
          graphPage.classList.remove('fullscreen-mode');
          setIsFullscreen(false);
          sessionStorage.removeItem(FULLSCREEN_KEY);
          setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Apply fullscreen class on mount if sessionStorage flag is set
  useEffect(() => {
    if (sessionStorage.getItem(FULLSCREEN_KEY) === 'true') {
      const graphPage = document.querySelector('.graph-page');
      if (graphPage) {
        graphPage.classList.add('fullscreen-mode');
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
          if (onResetView) onResetView();
        }, 100);
      }
    }
  }, [onResetView]);

  // Same structure as ReactFlow's built-in Controls component
  return (
    <div
      className="react-flow__panel react-flow__controls vertical top left"
      data-testid="rf__controls"
      aria-label="Graph Controls"
    >
      <button
        type="button"
        className={`react-flow__controls-button${isRefreshing ? ' loading' : ''}`}
        onClick={handleRefresh}
        disabled={isRefreshing}
        title="Refresh"
        aria-label="Refresh"
      >
        {/* Reload icon */}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
          <path d="M1,12A11,11,0,0,1,17.882,2.7l1.411-1.41A1,1,0,0,1,21,2V6a1,1,0,0,1-1,1H16a1,1,0,0,1-.707-1.707l1.128-1.128A8.994,8.994,0,0,0,3,12a1,1,0,0,1-2,0Zm21-1a1,1,0,0,0-1,1,9.01,9.01,0,0,1-9,9,8.9,8.9,0,0,1-4.42-1.166l1.127-1.127A1,1,0,0,0,8,17H4a1,1,0,0,0-1,1v4a1,1,0,0,0,.617.924A.987.987,0,0,0,4,23a1,1,0,0,0,.707-.293L6.118,21.3A10.891,10.891,0,0,0,12,23,11.013,11.013,0,0,0,23,12,1,1,0,0,0,22,11Z"/>
        </svg>
      </button>

      <button
        type="button"
        className="react-flow__controls-button"
        onClick={handleLayoutToggle}
        title="Toggle Layout (horizontal/vertical)"
        aria-label="Toggle Layout (horizontal/vertical)"
      >
        {layoutDirection === 'TB' ? (
          /* Down arrow */
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
            <path d="M0 13.867h18.133V6l10 10-10 10v-7.867H0z"/>
          </svg>
        ) : (
          /* Right arrow */
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
            <path d="M13.867 0v18.133H6l10 10 10-10h-7.867V0z"/>
          </svg>
        )}
      </button>

      <button
        type="button"
        className="react-flow__controls-button"
        onClick={handleFullscreen}
        title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
      >
        {isFullscreen ? (
          /* Exit fullscreen icon */
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="currentColor">
            <polygon points="24.586,27.414 29.172,32 32,29.172 27.414,24.586 32,20 20,20 20,32"/>
            <polygon points="0,12 12,12 12,0 7.414,4.586 2.875,0.043 0.047,2.871 4.586,7.414"/>
            <polygon points="0,29.172 2.828,32 7.414,27.414 12,32 12,20 0,20 4.586,24.586"/>
            <polygon points="20,12 32,12 27.414,7.414 31.961,2.871 29.133,0.043 24.586,4.586 20,0"/>
          </svg>
        ) : (
          /* Fullscreen icon */
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="currentColor">
            <polygon points="27.414,24.586 22.828,20 20,22.828 24.586,27.414 20,32 32,32 32,20"/>
            <polygon points="12,0 0,0 0,12 4.586,7.414 9.129,11.953 11.957,9.125 7.414,4.586"/>
            <polygon points="12,22.828 9.172,20 4.586,24.586 0,20 0,32 12,32 7.414,27.414"/>
            <polygon points="32,0 20,0 24.586,4.586 20.043,9.125 22.871,11.953 27.414,7.414 32,12"/>
          </svg>
        )}
      </button>
    </div>
  );
}
