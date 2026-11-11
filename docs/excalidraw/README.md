# Excalidraw whiteboards in AFFiNE

This fork embeds the official `@excalidraw/excalidraw` React editor (pinned to
0.18.0) in AFFiNE's normal Edgeless mode. The sidebar, document header, titles,
mode switch, permissions, and workspace routing remain AFFiNE components.
Regular document mode continues to use BlockSuite.

## Architecture

- `packages/frontend/core/src/blocksuite/block-suite-editor/blocksuite-editor.tsx`
  is the React entry point. Previously it selected Lit page and Edgeless editors
  from `lit-adaper.tsx`; it now selects `excalidraw/whiteboard.tsx` for Edgeless.
  The official editor and its CSS load lazily, leaving document mode unchanged.
- `modules/editor/entities/editor.ts` owns mode/navigation state. The existing
  `block-suite-mode-switch` and document routes still select `page`/`edgeless`.
  Excalidraw has its own imperative API and history; it does not pretend to
  provide a BlockSuite `std`, graphics controller, or selection service.
  BlockSuite-specific ready callbacks run only for BlockSuite editors.
- `modules/doc` owns document metadata, lifetime, permissions, duplication, and
  deletion. Its document Y.Doc is `blockSuiteDoc.spaceDoc`. nbstore replicates
  complete Yjs updates, including extension maps, through the existing local
  storage and self-hosted sync connections. No new backend endpoints, database
  tables, services, or authentication mechanisms are introduced.
- `excalidraw/scene-store.ts` stores JSON values in document-level Y.Maps named
  `affine:excalidraw:v1:{elements,files,state,meta}`. Elements are keyed by ID,
  retain deletion tombstones, and use Excalidraw fractional indices for layer
  order. File records include image data URLs. The state map stores the canvas
  background and grid settings; metadata stores format version and library.
  Selection, collaborators, dialogs, and device viewport are intentionally not
  shared. Opening/restarting restores scene content and canvas settings.
- Writes batch after 250 ms of inactivity, with a maximum 1 second interval
  during continuous editing. Cleanup on mode/document switching, page hiding,
  and browser unloading flushes pending changes into Yjs synchronously. AFFiNE
  then owns asynchronous local durability and server replication. Closing a tab
  does not guarantee a completed network round trip; the normal offline sync
  queue applies. A browser/process crash can lose the current batch.
- The adapter compares local elements to its baseline and writes only changes.
  Remote updates refresh mounted editors without adding an undo entry. Different
  elements merge independently, including after offline editing. Simultaneous
  edits to the **same element** use Yjs map conflict resolution, not character-
  level or geometric merging. There are no multiplayer cursors, presence,
  remote selections, or Excalidraw room servers. Do not confuse this basic
  replicated scene editing with Excalidraw's hosted collaboration product.
- Images remain inside the document update stream, so they work offline and use
  the same backend permissions. Existing BlockSuite attachments continue using
  AFFiNE's blob store. Inline images increase document size and are subject to
  existing document/update limits; large image-heavy boards need deployment
  testing. Deleted element/file records are retained for data integrity.
- AFFiNE's duplication and template duplication explicitly copy extension maps,
  since BlockSuite snapshots normally include only blocks.

## Existing content and compatibility

There is no automatic destructive migration. A conservative check detects
surface elements, nonempty notes, extra notes, embeds, and other BlockSuite
content. Existing content opens in the original Edgeless editor by default.
The compatibility banner allows opening a separate Excalidraw canvas, and
returning to the original content at any time. Neither choice changes the
original blocks. Ordinary text remains available in document mode.

Unknown storage versions and unreadable drawing data show an error instead of
silently replacing the drawing. Permission checks run both at change time and
flush time, and public/shared views are read-only.

Use Excalidraw's menu to import `.excalidraw` files and export `.excalidraw`, PNG,
and SVG files. Import changes only the Excalidraw canvas for the current
AFFiNE document. It can replace the current Excalidraw scene; export it first
if you want to retain both drawings. Original BlockSuite content is untouched.

AFFiNE's BlockSuite-specific presentation, AI tools, surface references,
whiteboard thumbnails, text search/indexing, and Markdown/HTML/PDF/BlockSuite
ZIP exports do not understand this custom scene. Use the Excalidraw menu for
drawing exports and keep normal database/storage backups for full workspaces.
Old unmodified AFFiNE clients preserve the Yjs maps but cannot render them.
Do not mix frontend versions if all clients must see the new canvas.

## Build and run

Use Node **22.23.4**, the repository's Yarn **4.18.0**, and the committed lockfile:

```sh
corepack enable
yarn install --immutable
PUBLIC_PATH=/ yarn affine @affine/web build
```

`tools/cli/src/rspack/index.ts` copies the package's fonts to
`dist/excalidraw/fonts`. The editor sets `EXCALIDRAW_ASSET_PATH` to the same
origin's `/excalidraw/` directory. Serve the entire generated dist directory;
no Excalidraw CDN or hosted storage is required. Light/dark appearance follows
AFFiNE's application theme. Editing shortcuts belong to the focused canvas;
AFFiNE's Alt+S mode switch remains available. Clipboard events must reach
Excalidraw's document listeners.

## Docker deployment

From the repository root, build the complete server and frontend image:

```sh
docker build --progress=plain -f .docker/selfhost/Dockerfile --build-arg GITHUB_SHA="$(git rev-parse HEAD)" -t affine-excalidraw:local .
```

The Dockerfile uses pinned Node/Rust versions, the immutable Yarn lockfile,
source builds of web/mobile/admin/server/native code, and the same runtime
layout and cleanup script as `.github/deployment/node/Dockerfile`. It does not
connect to or migrate a database during the build. Build on the deployment
architecture (amd64 or arm64); cross compilation is not configured. Base-image
and apt repositories can change independently of this lockfile; use digest-
pinned base images and a package mirror if bit-for-bit builds are required.
Allow ample RAM/disk space for the monorepo and Rust builds.

For the repository's self-hosted compose layout:

```sh
cd .docker/selfhost
docker compose -f compose.yml -f compose.excalidraw.yml config
docker compose -f compose.yml -f compose.excalidraw.yml up -d
```

For an existing deployment, retain its own volumes, secrets, environment,
network, and database configuration, and change **both** the app and migration
service images to `affine-excalidraw:local`. The override file changes only the
image names. The normal AFFiNE migration service remains part of deployment;
review version compatibility and take a backup before upgrading AFFiNE itself.
No Excalidraw-specific database migration is necessary. This implementation
runs no migration against existing user data.

Test the image against a separate test database and storage volume before
replacing a production instance. To roll back, restore the previous image;
original Edgeless blocks remain intact and the extension maps remain stored.
Export drawings with the Excalidraw menu before returning to a client that
cannot display them.

## Troubleshooting a silent native build

The N-API launcher runs `cargo metadata` with captured output before compiling.
Dependency downloads or network retries in this phase can therefore appear idle,
even with Docker's plain progress output. The Dockerfile now prints toolchain
information and runs locked Cargo metadata resolution explicitly, with its
stderr visible, before invoking N-API. It also separates the native and server
bundles so their progress and failures are distinguishable.

Build with `--progress=plain` as shown above. If it stops at metadata resolution,
inspect Cargo's download, registry, DNS/TLS, or lock messages; time elapsed alone
does not identify the cause. `Canceled: context canceled` reports interruption,
not a compiler diagnosis. Cargo registry, Git, and target caches retain work
across interrupted builds; do not prune the builder cache while troubleshooting.
The image sets `CARGO_NET_GIT_FETCH_WITH_CLI=true` to use the installed Git
client, disables interactive credential prompts, and aborts Git HTTPS transfers
that remain below one byte/second for 60 seconds. This exposes transport errors
and bounds stalled data transfers. It does not bypass DNS, proxy, firewall, or
TLS problems. The pinned public `opus-codec` commit is
`c2afef20773c3afb06395a26a4f054ca90ba9078`; no GitHub token is needed for it.

To distinguish host connectivity from Docker connectivity, compare:

```sh
git ls-remote https://github.com/toeverything/opus-codec
docker run --rm node:22.23.4-bookworm-slim node -e 'fetch("https://github.com/toeverything/opus-codec/info/refs?service=git-upload-pack", {signal: AbortSignal.timeout(30000)}).then(r => { console.log(r.status); process.exitCode = r.ok ? 0 : 1; }).catch(e => { console.error(e); process.exitCode = 1; })'
```

The second command is only an HTTPS reachability check from a normal container;
BuildKit can use different network/proxy configuration. If host access works
but container/build access fails, investigate Docker DNS, proxies, and outbound
HTTPS routing. Do not disable TLS verification or change the pinned dependency
as a workaround.

A first release compilation can still take substantial time once dependencies
are available. These changes improve observability and retry efficiency; they
do not establish which network/resource condition occurred on another host.

## Troubleshooting a missing server bundle

If migrations report `Cannot find module /app/dist/main.js`, the image is
incomplete. A bundling failure previously could be hidden by the AFFiNE CLI
wrapper returning success. The wrapper now propagates Yarn's exit code; its
regression tests run with `node --test tools/cli/bin/cli.spec.mjs`.

The source Docker build produces one native architecture. It generates a
matching native loader inside the build stage so Rspack does not try to resolve
unbuilt binaries for the other release architectures. Server bundle existence
and syntax are checked after bundling, dependency preparation, image cleanup,
and in the final runtime image. These checks do not start the server or run
migrations during image creation.

After rebuilding, check the image before starting services:

```sh
docker run --rm --entrypoint node affine-excalidraw:local --check /app/dist/main.js
```

Use the rebuilt image for both AFFiNE services and recreate them using your
existing Compose configuration. Preserve database/storage volumes. Successful
schema migrations do not imply that the later application data migrations ran;
the migration job must finish successfully before starting the app.

## Verification

```sh
yarn vitest run packages/frontend/core/src/blocksuite/excalidraw/scene-store.spec.ts
yarn exec tsc -b packages/frontend/core --pretty false
yarn exec playwright install chromium
PUBLIC_PATH=/ yarn affine @affine/web build
yarn exec playwright test --config tests/affine-local/excalidraw.playwright.config.ts --workers=1
PUBLIC_PATH=/ yarn affine @affine/web build
docker build --check -f .docker/selfhost/Dockerfile .
```

Storage tests cover batching/max wait, reopening, images, deleted elements,
import replacement, independent offline edits, disposal flushing, document
isolation, permissions, version guards, legacy preservation, and duplication.
Browser tests cover drawing through the actual toolbar, mode switching,
navigation/reload persistence, and access to legacy content. A self-hosted
multi-client test with your server and representative large boards remains
necessary to validate infrastructure limits and deployment-specific behavior.

### Validation performed for this integration

- Core and local-browser-test TypeScript project builds passed.
- The 10 storage/data-integrity unit tests passed.
- Both Chromium tests against the locally served production bundle passed,
  including copy/paste, undo/redo, save/reopen/navigation, and legacy access.
- The production web build passed (bundle-size warnings remain).
- Changed TypeScript/JavaScript files passed oxlint and formatting checks.
- Dockerfile validation/base-image resolution and Compose configuration passed.

A complete Docker image build and a running self-hosted backend/multi-client
session have not been exercised here. The source-build Dockerfile is provided
for that deployment verification; Dockerfile validation alone does not prove
that every native/backend build step or production deployment succeeds.
