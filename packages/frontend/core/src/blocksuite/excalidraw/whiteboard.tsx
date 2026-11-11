import type { ReactNode } from 'react';
import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import type { EditorProps } from '../block-suite-editor/blocksuite-editor';
import * as styles from './editor.css';
import { ExcalidrawSceneStore, hasLegacyEdgelessContent } from './scene-store';

const ExcalidrawEditor = lazy(() => import('./editor'));

/** Keep the legacy host out of the React canvas lifecycle and event handling. */
export function Whiteboard({
  page,
  readonly,
  shared,
  className,
  style,
  legacyEditor,
}: EditorProps & { legacyEditor: ReactNode }) {
  const scene = useMemo(
    () =>
      new ExcalidrawSceneStore(
        page.spaceDoc,
        () => !readonly && !shared && !page.readonly
      ),
    [page, readonly, shared]
  );
  const subscribe = useCallback(
    (notify: () => void) => {
      page.spaceDoc.on('afterTransaction', notify);
      return () => page.spaceDoc.off('afterTransaction', notify);
    },
    [page]
  );
  const hasLegacy = useSyncExternalStore(subscribe, () =>
    hasLegacyEdgelessContent(page.spaceDoc)
  );
  const exists = useSyncExternalStore(subscribe, () => scene.exists);
  const [legacyOverride, setLegacy] = useState<boolean | null>(null);
  const legacy = legacyOverride ?? (hasLegacy && !exists);
  const supported = useSyncExternalStore(subscribe, () => scene.supported);
  if (!supported) {
    return (
      <div role="alert">
        This drawing uses an unsupported Excalidraw storage version. Open it
        with the version of AFFiNE that saved it.
      </div>
    );
  }
  return (
    <div className={`${styles.root} ${className ?? ''}`} style={style}>
      {hasLegacy && (
        <div className={styles.notice}>
          <span>
            Original Edgeless content is preserved separately from Excalidraw.
          </span>
          <button
            type="button"
            onClick={() => {
              if (legacy) scene.initialize();
              setLegacy(!legacy);
            }}
          >
            {legacy
              ? 'Open Excalidraw canvas'
              : 'Open original Edgeless content'}
          </button>
        </div>
      )}
      {legacy ? (
        legacyEditor
      ) : (
        <ErrorBoundary
          fallbackRender={({ error }) => (
            <div role="alert">
              Unable to open this drawing. Its saved data has been preserved.{' '}
              {String(error)}
            </div>
          )}
        >
          <Suspense fallback={<div role="status">Loading Excalidraw…</div>}>
            <ExcalidrawEditor page={page} readonly={readonly || shared} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}
