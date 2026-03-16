FROM node:20-alpine
WORKDIR /app

# Install kubectl for fallback execution
RUN apk add --no-cache curl && \
    curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
    install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl && \
    rm kubectl

# Install dependencies
COPY provider-node-server/package.json provider-node-server/package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source
COPY provider-node-server/ ./
COPY shared/ /app/shared/

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:4040/health || exit 1

EXPOSE 4040
CMD ["npx", "tsx", "src/index.ts"]
