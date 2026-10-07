/**
 * React Shim for CDN-loaded React
 *
 * This file provides module exports for React when it's loaded from CDN.
 * esbuild uses alias to map react imports to this shim.
 */

// Get React and ReactDOM from CDN globals
const _React = window.React;
const _ReactDOM = window.ReactDOM;

// Re-export everything from React for named imports
export const {
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createFactory,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = _React;

// JSX Runtime exports (React 17+ automatic JSX transform)
export const jsx = _React.createElement;
export const jsxs = _React.createElement;
export const jsxDEV = _React.createElement;

// ReactDOM exports
export const createRoot = _ReactDOM.createRoot;
export const hydrateRoot = _ReactDOM.hydrateRoot;
export const render = _ReactDOM.render;
export const hydrate = _ReactDOM.hydrate;
export const unmountComponentAtNode = _ReactDOM.unmountComponentAtNode;
export const findDOMNode = _ReactDOM.findDOMNode;
export const createPortal = _ReactDOM.createPortal;
export const flushSync = _ReactDOM.flushSync;

// Default exports
export default _React;
export { _React as React, _ReactDOM as ReactDOM };
