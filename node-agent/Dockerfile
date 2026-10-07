# Cloudana node agent.
#
# The agent imports the shared PoUW solver from ../pouw and ../shared/sealed.ts, so build from the repo root:
#   docker build -f node-agent/Dockerfile -t cloudana-node-agent .
# (node-agent/Dockerfile.dockerignore keeps the context to node-agent/, pouw/ and shared/.)
#
# Two stages: the builder compiles TypeScript to dist/ with tsc; the runtime image ships only compiled JS and
# production dependencies — no tsx, no compiler. Base image pinned to an exact version (CI rebuilds on bumps).

FROM node:22.12.0-slim AS build
WORKDIR /app
COPY node-agent/package.json node-agent/package-lock.json node-agent/tsconfig.json node-agent/tsconfig.build.json node-agent/
RUN cd node-agent && npm ci --include=dev
COPY pouw/package.json pouw/
COPY pouw/src pouw/src
COPY shared/sealed.ts shared/
COPY node-agent/src node-agent/src
RUN cd node-agent && npm run build && npm prune --omit=dev && npm cache clean --force

FROM node:22.12.0-slim
ENV NODE_ENV=production
WORKDIR /app

# Fleet nodes that run tenant containers need the docker CLI (talks to the host daemon over the mounted socket)
# and iptables (installs the cld-tenant egress DROP rules). Both are unused on compute + static-hosting nodes.
COPY --from=docker:27.3.1-cli /usr/local/bin/docker /usr/local/bin/docker
RUN apt-get update && apt-get install -y --no-install-recommends iptables && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node-agent/node_modules node-agent/node_modules
COPY --from=build /app/node-agent/dist dist
# The agent reads its version from ../package.json relative to its own file (dist/node-agent/src/index.js).
COPY node-agent/package.json dist/node-agent/package.json
# shared/sealed.js and pouw resolve @noble/* and viem by walking up from /app/dist/...: expose the agent's node_modules at /app.
RUN ln -s node-agent/node_modules node_modules

# The node key lives in node-agent/.data/<name>.json (resolved as ../.data from dist/node-agent/src). Mount a volume
# there so the node keeps its identity (and its fleet binding) across restarts.
RUN mkdir -p dist/node-agent/.data && chown node:node dist/node-agent/.data
VOLUME ["/app/dist/node-agent/.data"]

# Compute + static hosting (the default) runs as the unprivileged `node` user. Containers (CLOUDANA_ALLOW_CONTAINERS=1)
# need the docker socket mounted and root + NET_ADMIN for iptables — see deploy/kubernetes-daemonset.yaml.
USER node
WORKDIR /app/dist/node-agent

# CLOUDANA_API — API base URL (https); CLOUDANA_INSTRUCTION_SIGNER — address from GET /v1/nodes/instruction-key
# (required until a default is baked into src/instructions.ts); CLOUDANA_FLEET_TOKEN — joins your fleet, no bind link.
# Hosting: set CLOUDANA_PUBLIC_HOST (or "auto") and publish the port range, e.g. -p 42000-42100:42000-42100.
# GPU workstations: the host needs the NVIDIA driver + nvidia-container-toolkit; the agent only runs nvidia-smi to detect
# GPUs, so start it with `--gpus all` (or mount nvidia-smi and /dev/nvidia*) or it announces no `gpu` capability.
ENV CLOUDANA_API=https://api.cloudana.io
CMD ["node", "src/index.js"]
