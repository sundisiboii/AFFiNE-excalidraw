import { Boxed } from '@blocksuite/affine/store';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type {
  AppState,
  BinaryFiles,
  ExcalidrawInitialDataState,
  LibraryItems,
} from '@excalidraw/excalidraw/types';
import * as Y from 'yjs';

// Top-level types are replicated by nbstore along with the document's blocks.
// Individual element records avoid replacing another user's unrelated edits.
const PREFIX = 'affine:excalidraw:v1';
const STATE_KEYS = [
  'viewBackgroundColor',
  'gridSize',
  'gridStep',
  'gridModeEnabled',
  'objectsSnapModeEnabled',
  'exportBackground',
  'exportEmbedScene',
  'exportScale',
  'exportWithDarkMode',
] as const;

export class ExcalidrawSceneStore {
  private readonly elements: Y.Map<string>;
  private readonly files: Y.Map<string>;
  private readonly state: Y.Map<string>;
  private readonly meta: Y.Map<string>;
  private readonly pending = new Map<Y.Map<string>, Map<string, string>>();
  private timer?: ReturnType<typeof setTimeout>;
  private maxTimer?: ReturnType<typeof setTimeout>;
  private readonly serialized = new WeakMap<object, string>();
  private baseline = new Map<string, string>();

  constructor(
    private readonly doc: Y.Doc,
    private readonly canWrite: () => boolean
  ) {
    this.elements = doc.getMap(`${PREFIX}:elements`);
    this.files = doc.getMap(`${PREFIX}:files`);
    this.state = doc.getMap(`${PREFIX}:state`);
    this.meta = doc.getMap(`${PREFIX}:meta`);
    this.resetBaseline();
  }

  get exists() {
    return this.meta.has('version');
  }

  get supported() {
    return !this.exists || this.meta.get('version') === '1';
  }

  initialize() {
    if (this.canWrite() && this.supported && !this.exists) {
      this.meta.set('version', '1');
    }
  }

  read(): ExcalidrawInitialDataState {
    const elements = [...this.elements.values()].map(
      value => JSON.parse(value) as ExcalidrawElement
    );
    // Excalidraw uses fractional indices for stacking order.
    elements.sort((a, b) => {
      const left = a.index ?? a.id;
      const right = b.index ?? b.id;
      return left < right ? -1 : left > right ? 1 : a.id.localeCompare(b.id);
    });
    return {
      elements,
      files: Object.fromEntries(
        [...this.files].map(([id, value]) => [id, JSON.parse(value)])
      ),
      appState: Object.fromEntries(
        [...this.state].map(([key, value]) => [key, JSON.parse(value)])
      ),
      libraryItems: JSON.parse(this.meta.get('library') ?? '[]'),
    };
  }

  private serialize(value: object) {
    let json = this.serialized.get(value);
    if (!json) {
      json = JSON.stringify(value);
      this.serialized.set(value, json);
    }
    return json;
  }

  private resetBaseline() {
    this.baseline = new Map(this.elements);
  }

  private queue(map: Y.Map<string>, key: string, value: string) {
    if (map.get(key) === value && !this.pending.get(map)?.has(key)) return;
    let changes = this.pending.get(map);
    if (!changes) this.pending.set(map, (changes = new Map()));
    changes.set(key, value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
    this.maxTimer ??= setTimeout(() => this.flush(), 1000);
  }

  save(
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles
  ) {
    if (!this.canWrite() || !this.supported) return;
    for (const element of elements) {
      const value = JSON.stringify(element);
      // Compare against the scene last presented to this editor, not the latest
      // remote map: a stale scene must never overwrite unrelated remote edits.
      if (this.baseline.get(element.id) !== value) {
        this.queue(this.elements, element.id, value);
        this.baseline.set(element.id, value);
      }
    }
    // Loading an imported scene can omit old elements entirely. Preserve these
    // as tombstones, otherwise they would reappear when the drawing reopens.
    const ids = new Set(elements.map(element => element.id));
    for (const [id, value] of this.baseline) {
      if (ids.has(id)) continue;
      const previous = JSON.parse(value) as ExcalidrawElement;
      if (previous.isDeleted) continue;
      const deleted = JSON.stringify({
        ...previous,
        isDeleted: true,
        version: previous.version + 1,
        updated: Date.now(),
      });
      this.queue(this.elements, id, deleted);
      this.baseline.set(id, deleted);
    }
    // Deleted elements remain as tombstones for synchronization and undo.
    for (const [id, file] of Object.entries(files)) {
      this.queue(this.files, id, this.serialize(file));
    }
    for (const key of STATE_KEYS) {
      if (appState[key] !== undefined) {
        this.queue(this.state, key, JSON.stringify(appState[key]));
      }
    }
  }

  saveLibrary(items: LibraryItems) {
    if (this.canWrite())
      this.queue(this.meta, 'library', JSON.stringify(items));
  }

  flush = () => {
    clearTimeout(this.timer);
    clearTimeout(this.maxTimer);
    this.timer = this.maxTimer = undefined;
    if (!this.canWrite() || !this.supported) {
      this.pending.clear();
      return;
    }
    if (!this.pending.size) return;
    const pending = new Map(this.pending);
    this.pending.clear();
    this.doc.transact(() => {
      this.meta.set('version', '1');
      for (const [map, changes] of pending) {
        for (const [key, value] of changes) {
          if (map.get(key) !== value) map.set(key, value);
        }
      }
    }, this);
  };

  subscribe(onRemoteChange: () => void) {
    const listener = (transaction: Y.Transaction) => {
      if (transaction.origin === this) return;
      if (
        ![this.elements, this.files, this.state, this.meta].some(map =>
          new Set<unknown>(transaction.changed.keys()).has(map)
        )
      )
        return;
      // Commit only pending local deltas before presenting the merged document.
      this.flush();
      this.resetBaseline();
      onRemoteChange();
    };
    this.doc.on('afterTransaction', listener);
    return () => {
      this.doc.off('afterTransaction', listener);
      this.flush();
    };
  }
}

/** Conservative compatibility check: never discard BlockSuite content. */
export function hasLegacyEdgelessContent(doc: Y.Doc): boolean {
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  let notes = 0;
  for (const block of blocks.values()) {
    const flavour = block.get('sys:flavour');
    if (flavour === 'affine:page') continue;
    if (flavour === 'affine:surface') {
      let elements = block.get('prop:elements');
      if (elements instanceof Y.Map) {
        const unboxed = elements.get('value');
        if (Boxed.is(elements)) elements = unboxed;
      }
      if (elements instanceof Y.Map && elements.size > 0) return true;
      if (elements && !(elements instanceof Y.Map)) return true;
      continue;
    }
    if (flavour === 'affine:note') {
      if (++notes > 1) return true;
      continue;
    }
    if (flavour === 'affine:paragraph') {
      const text = block.get('prop:text');
      if (!text || text.toString().length === 0) continue;
    }
    return true;
  }
  return false;
}

/** BlockSuite snapshots omit extension maps; explicitly copy them on duplication. */
export function copyExcalidrawScene(source: Y.Doc, target: Y.Doc) {
  if (source === target) return;
  target.transact(() => {
    for (const suffix of ['elements', 'files', 'state', 'meta']) {
      const name = `${PREFIX}:${suffix}`;
      const destination = target.getMap<string>(name);
      destination.clear();
      for (const [key, value] of source.getMap<string>(name)) {
        destination.set(key, value);
      }
    }
  });
}
