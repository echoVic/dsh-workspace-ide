/**
 * Globals injected by `scripts/build-client.mjs` around the concatenated
 * `src/client/*.js` fragments. Declaring them here lets `tsc --checkJs` see the
 * shared factory scope (only `react` is required at runtime).
 */

import type { createElement } from 'react';

declare global {
  /** The only module the factory may require. */
  const React: typeof import('react');
  /** React.createElement alias used for every element. */
  const h: typeof createElement;
  const useCallback: typeof import('react').useCallback;
  const useEffect: typeof import('react').useEffect;
  const useMemo: typeof import('react').useMemo;
  const useRef: typeof import('react').useRef;
  const useState: typeof import('react').useState;
  /** Shared namespace the fragments attach their public helpers to. */
  const S: any;
}

export {};
