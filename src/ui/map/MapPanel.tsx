import { Component, lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import type { MapViewProps } from './MapView';
import styles from './map.module.css';

// MapLibre is large; it loads after the list has appeared (PLAN.md §4.3).
const MapView = lazy(() => import('./MapView'));

/** When the map can't start (no WebGL, or it's blocked), the list and details still work. */
class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={styles.fallback}>
        <p role="status">
          The map couldn’t start in this browser. It needs WebGL, which may be turned off. The list
          and details still work.
        </p>
      </div>
    );
  }
}

export function MapPanel(props: MapViewProps) {
  return (
    <MapErrorBoundary>
      <Suspense fallback={<div className={styles.fallback} aria-busy="true" />}>
        <MapView {...props} />
      </Suspense>
    </MapErrorBoundary>
  );
}
