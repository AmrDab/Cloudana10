# Cloudana node agent.
#
# The agent imports the shared PoUW solver from ../pouw, so build from the repo root:
#   docker build -f node-agent/Dockerfile -t cloudana-node-agent .
# (node-agent/Dockerfile.dockerignore keeps the context to node-agent/ and pouw/.)
#
# The agent runs TypeScript through tsx, which is a devDependency, so this is a
# full `npm ci` rather than --omit=dev.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY pouw/package.json pouw/
COPY pouw/src pouw/src
COPY node-agent/package.json node-agent/package-lock.json node-agent/tsconfig.json node-agent/
RUN cd node-agent && npm ci --include=dev && npm cache clean --force
COPY node-agent/src node-agent/src
# shared/sealed.ts resolves @noble/* by walking up from /app/shared, so expose the agent's node_modules at /app.
COPY shared/sealed.ts shared/
RUN ln -s node-agent/node_modules node_modules

# The node key lives in node-agent/.data/<name>.json. Mount a volume here so the
# node keeps its identity (and its fleet binding) across restarts.
RUN mkdir -p node-agent/.data && chown node:node node-agent/.data
VOLUME ["/app/node-agent/.data"]

USER node
WORKDIR /app/node-agent

# CLOUDANA_API — API base URL; CLOUDANA_FLEET_TOKEN — joins your fleet, no bind link.
# Hosting: set CLOUDANA_PUBLIC_HOST (or "auto") and publish the port range, e.g. -p 42000-42100:42000-42100.
# Containers need the host Docker socket (-v /var/run/docker.sock:/var/run/docker.sock) and a docker CLI in the image.
# GPU workstations: the agent does not need `--gpus all` itself — it asks the *host* Docker daemon (via the socket)
# to start workstations with --gpus, so the host needs the NVIDIA driver + nvidia-container-toolkit. The agent only
# runs nvidia-smi to detect GPUs; to let it see them, start the agent with `--gpus all` (or mount nvidia-smi and
# /dev/nvidia*) — without that it announces no `gpu` capability even on a GPU host.
ENV CLOUDANA_API=https://api.cloudana.io
CMD ["node", "--import", "tsx", "src/index.ts"]
