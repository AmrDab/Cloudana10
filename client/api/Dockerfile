FROM node:20-alpine
WORKDIR /app

# Install dependencies
COPY client/api/package.json client/api/package-lock.json* ./client/api/
COPY shared/ ./shared/
COPY pouw/ ./pouw/
WORKDIR /app/client/api
RUN npm ci --ignore-scripts

# Copy source
COPY client/api/ ./

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:7002/health || exit 1

EXPOSE 7002
CMD ["npx", "tsx", "src/index.ts"]
