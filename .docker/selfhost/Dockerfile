# syntax=docker/dockerfile:1.7
# Build from the repository root. No database or user storage is used at build time.
FROM rust:1.97.1-bookworm AS rust-toolchain
FROM node:22.23.4-bookworm-slim AS build
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential clang cmake pkg-config libssl-dev protobuf-compiler git python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=rust-toolchain /usr/local/cargo /usr/local/cargo
COPY --from=rust-toolchain /usr/local/rustup /usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/usr/local/rustup
ENV PATH="/usr/local/cargo/bin:${PATH}"
ENV HUSKY=0 ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY . .
RUN corepack enable && YARN_ENABLE_SCRIPTS=true yarn install --immutable
ARG GITHUB_SHA=local-source
ENV GITHUB_SHA=${GITHUB_SHA}
ARG BUILD_TYPE=stable
ENV BUILD_TYPE=${BUILD_TYPE}
RUN yarn affine @affine/web build \
    && yarn affine @affine/mobile build \
    && yarn affine @affine/admin build
# napi captures cargo metadata output internally, hiding dependency/network waits.
# Run it explicitly first so --progress=plain exposes downloads and errors.
# Cache dependencies and compiled artifacts even if a build is interrupted.
ARG TARGETARCH
# Use Git's HTTPS transport and expose its errors instead of Cargo's built-in
# transport. Public dependencies must never wait for interactive credentials.
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true GIT_TERMINAL_PROMPT=0
RUN --mount=type=cache,id=affine-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=affine-cargo-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=affine-cargo-target-${TARGETARCH},target=/src/target,sharing=locked \
    set -eux; \
    git config --global http.lowSpeedLimit 1; \
    git config --global http.lowSpeedTime 60; \
    rustup show active-toolchain; \
    rustc --version; \
    cargo --version; \
    cargo metadata --locked --manifest-path packages/backend/native/Cargo.toml --format-version 1 > /tmp/affine-cargo-metadata.json; \
    CC="clang -D_BSD_SOURCE" DEBUG="napi:*" yarn workspace @affine/server-native build; \
    node -e 'const fs = require("node:fs"); fs.renameSync("packages/backend/native/server-native.node", "packages/backend/native/server-native." + (process.arch === "arm" ? "armv7" : process.arch) + ".node")'
RUN yarn workspace @affine/server build
# Match the existing release image's runtime dependency layout.
RUN yarn workspaces focus @affine/server --production \
    && yarn workspace @affine/server prisma generate \
    && cp -a node_modules packages/backend/server/node_modules

FROM node:22.23.4-bookworm-slim AS assets
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/packages/backend/server /app
COPY --from=build /src/packages/frontend/apps/web/dist /app/static
COPY --from=build /src/packages/frontend/admin/dist /app/static/admin
COPY --from=build /src/packages/frontend/apps/mobile/dist /app/static/mobile
ARG TARGETARCH
ARG TARGETVARIANT
RUN AFFINE_DOCKER_CLEAN=1 TARGETARCH="${TARGETARCH}" TARGETVARIANT="${TARGETVARIANT}" node ./scripts/docker-clean.mjs

FROM node:22.23.4-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl libjemalloc2 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=assets /app /app
ENV LD_PRELOAD=libjemalloc.so.2
EXPOSE 3010
CMD ["sh", "-c", "node ./scripts/upgrade-config.js && exec node ./dist/main.js"]
