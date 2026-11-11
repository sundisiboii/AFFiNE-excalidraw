// oxlint-disable-next-line no-restricted-imports
import '@excalidraw/excalidraw/index.css';

import { AppThemeService } from '@affine/core/modules/theme';
import type { Store } from '@blocksuite/affine/store';
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
} from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { effect } from '@preact/signals-core';
import { useLiveData, useService } from '@toeverything/infra';
import { useEffect, useMemo, useRef, useState } from 'react';

import * as styles from './editor.css';
import { ExcalidrawSceneStore } from './scene-store';

// Must be set before Excalidraw mounts. Fonts are copied by AFFiNE's bundler.
Object.assign(window, {
  EXCALIDRAW_ASSET_PATH: new URL('/excalidraw/', window.location.href).href,
});

export default function ExcalidrawEditor({
  page,
  readonly,
}: {
  page: Store;
  readonly?: boolean;
}) {
  const theme = useLiveData(useService(AppThemeService).appTheme.theme$);
  const [storeReadonly, setStoreReadonly] = useState(page.readonly);
  useEffect(() => effect(() => setStoreReadonly(page.readonly$.value)), [page]);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const failed = useRef(false);
  const scene = useMemo(
    () =>
      new ExcalidrawSceneStore(
        page.spaceDoc,
        () => !readonly && !page.readonly && !failed.current
      ),
    [page, readonly]
  );
  const initialData = useMemo(() => scene.read(), [scene]);
  const [error, setError] = useState<string>();

  useEffect(() => () => scene.flush(), [scene]);

  useEffect(() => {
    if (!api) return;
    const refresh = () => {
      try {
        const data = scene.read();
        api.addFiles(Object.values(data.files ?? {}));
        api.updateScene({
          elements: data.elements,
          appState: { ...api.getAppState(), ...data.appState },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      } catch (error) {
        failed.current = true;
        setError(`Unable to read the synchronized drawing: ${String(error)}`);
      }
    };
    refresh();
    const unsubscribe = scene.subscribe(refresh);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') scene.flush();
    };
    window.addEventListener('pagehide', scene.flush);
    window.addEventListener('beforeunload', scene.flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubscribe();
      window.removeEventListener('pagehide', scene.flush);
      window.removeEventListener('beforeunload', scene.flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [api, scene]);

  return (
    <div
      className={styles.root}
      data-affine-excalidraw
      data-testid={`excalidraw-${page.id}`}
    >
      {error && <div role="alert">{error}</div>}
      <div
        className={styles.canvas}
        onKeyDown={event => event.stopPropagation()}
      >
        <Excalidraw
          key={`${page.id}-${!!readonly}`}
          excalidrawAPI={setApi}
          initialData={initialData}
          name={page.meta?.title}
          theme={theme === 'dark' ? 'dark' : 'light'}
          viewModeEnabled={readonly || storeReadonly || !!error}
          handleKeyboardGlobally={false}
          autoFocus
          aiEnabled={false}
          onChange={(elements, state, files) =>
            scene.save(elements, state, files)
          }
          onLibraryChange={items => scene.saveLibrary(items)}
          UIOptions={{
            canvasActions: { loadScene: !readonly && !storeReadonly },
          }}
        >
          <MainMenu>
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.SaveToActiveFile />
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.ClearCanvas />
          </MainMenu>
        </Excalidraw>
      </div>
    </div>
  );
}
