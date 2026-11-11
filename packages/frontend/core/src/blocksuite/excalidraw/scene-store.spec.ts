import { Boxed } from '@blocksuite/affine/store';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
  copyExcalidrawScene,
  ExcalidrawSceneStore,
  hasLegacyEdgelessContent,
} from './scene-store';

const element = (id: string, version = 1, isDeleted = false) =>
  ({
    id,
    version,
    isDeleted,
    type: 'rectangle',
    index: `a${id}`,
  }) as ExcalidrawElement;
const state = {
  viewBackgroundColor: '#fff',
  gridSize: 20,
  collaborators: new Map(),
} as AppState;
const makeStore = (doc = new Y.Doc()) =>
  new ExcalidrawSceneStore(doc, () => true);
const sync = (from: Y.Doc, to: Y.Doc) =>
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from));

afterEach(() => vi.useRealTimers());

describe('Excalidraw document storage', () => {
  it('batches changes and restores elements, tombstones, images and safe state after restart', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    const store = makeStore(doc);
    const files = {
      image: {
        id: 'image',
        dataURL: 'data:image/png;base64,abc',
        mimeType: 'image/png',
        created: 1,
      },
    } as unknown as BinaryFiles;
    store.save([element('1'), element('2', 2, true)], state, files);
    expect(store.read().elements).toEqual([]);
    vi.advanceTimersByTime(250);
    const restarted = new Y.Doc();
    sync(doc, restarted);
    const restored = makeStore(restarted).read();
    expect(restored.elements).toEqual([element('1'), element('2', 2, true)]);
    expect(restored.files).toEqual(files);
    expect(restored.appState).toEqual({
      viewBackgroundColor: '#fff',
      gridSize: 20,
    });
    expect(restored.appState).not.toHaveProperty('collaborators');
  });

  it('flushes pending changes on editor disposal and keeps documents isolated', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = makeStore(docA);
    const dispose = a.subscribe(() => {});
    a.save([element('a')], state, {});
    dispose();
    const b = makeStore(docB);
    b.save([element('b')], state, {});
    b.flush();
    expect(makeStore(docA).read().elements).toEqual([element('a')]);
    expect(makeStore(docB).read().elements).toEqual([element('b')]);
  });

  it('saves during continuous editing within the maximum batch interval', () => {
    vi.useFakeTimers();
    const store = makeStore();
    for (let version = 1; version <= 10; version++) {
      store.save([element('1', version)], state, {});
      vi.advanceTimersByTime(100);
    }
    expect(store.read().elements?.[0].version).toBe(10);
  });

  it('merges independent offline edits and notifies a mounted editor of remote updates', () => {
    const docA = new Y.Doc();
    const a = makeStore(docA);
    a.save([element('1'), element('2')], state, {});
    a.flush();
    const docB = new Y.Doc();
    sync(docA, docB);
    const b = makeStore(docB);
    const update = vi.fn();
    const dispose = a.subscribe(update);
    a.save([element('1', 2), element('2')], state, {});
    b.save([element('1'), element('2', 2)], state, {});
    b.flush();
    sync(docB, docA);
    sync(docA, docB);
    expect(update).toHaveBeenCalled();
    expect(a.read().elements).toEqual([element('1', 2), element('2', 2)]);
    expect(b.read().elements).toEqual(a.read().elements);
    dispose();
  });

  it('does not write in read-only mode or after permission revocation', () => {
    let allowed = true;
    const doc = new Y.Doc();
    const store = new ExcalidrawSceneStore(doc, () => allowed);
    store.save([element('1')], state, {});
    allowed = false;
    store.flush();
    store.initialize();
    expect(store.exists).toBe(false);
    expect(store.read().elements).toEqual([]);
  });

  it('does not rewrite unrelated blocks or accept unknown storage versions', () => {
    const doc = new Y.Doc();
    const block = new Y.Map();
    doc.getMap('blocks').set('original', block);
    block.set('sys:flavour', 'affine:image');
    const original = doc.getMap('blocks').toJSON();
    const store = makeStore(doc);
    store.save([element('1')], state, {});
    store.flush();
    expect(doc.getMap('blocks').toJSON()).toEqual(original);
    doc.getMap('affine:excalidraw:v1:meta').set('version', '2');
    store.save([element('2')], state, {});
    store.flush();
    expect(store.supported).toBe(false);
    expect(store.read().elements).toEqual([element('1')]);
  });

  it('keeps imported replacement scenes and deleted elements on reopen', () => {
    const store = makeStore();
    store.save([element('old')], state, {});
    store.flush();
    store.save([element('imported')], state, {});
    store.flush();
    expect(store.read().elements).toContainEqual(element('imported'));
    expect(store.read().elements).toContainEqual(
      expect.objectContaining({ id: 'old', version: 2, isDeleted: true })
    );
  });
});

describe('document duplication', () => {
  it('copies the drawing and files independently without modifying source data', () => {
    const source = new Y.Doc();
    const target = new Y.Doc();
    const original = makeStore(source);
    original.save([element('1')], state, {});
    original.saveLibrary([]);
    original.flush();
    copyExcalidrawScene(source, target);
    const duplicate = makeStore(target);
    expect(duplicate.read()).toEqual(original.read());
    duplicate.save([element('1', 2)], state, {});
    duplicate.flush();
    expect(original.read().elements?.[0].version).toBe(1);
  });
});

describe('legacy compatibility', () => {
  it('detects surface elements, note text and unknown blocks without modifying them', () => {
    for (const flavour of [
      'affine:paragraph',
      'affine:surface',
      'affine:database',
    ]) {
      const doc = new Y.Doc();
      const block = new Y.Map();
      doc.getMap('blocks').set('block', block);
      block.set('sys:flavour', flavour);
      if (flavour === 'affine:paragraph')
        block.set('prop:text', new Y.Text('Keep me'));
      if (flavour === 'affine:surface')
        block.set('prop:elements', new Y.Map([['shape', new Y.Map()]]));
      const before = doc.getMap('blocks').toJSON();
      expect(hasLegacyEdgelessContent(doc)).toBe(true);
      expect(doc.getMap('blocks').toJSON()).toEqual(before);
    }
  });

  it('allows a new empty document to open Excalidraw', () => {
    const doc = new Y.Doc();
    for (const flavour of [
      'affine:page',
      'affine:surface',
      'affine:note',
      'affine:paragraph',
    ]) {
      const block = new Y.Map();
      doc.getMap('blocks').set(flavour, block);
      block.set('sys:flavour', flavour);
      if (flavour === 'affine:paragraph') block.set('prop:text', new Y.Text());
      if (flavour === 'affine:surface')
        block.set('prop:elements', new Boxed(new Y.Map()).yMap);
    }
    expect(hasLegacyEdgelessContent(doc)).toBe(false);
  });
});
