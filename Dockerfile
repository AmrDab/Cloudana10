# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY shared/ shared/
RUN npm ci --ignore-scripts
COPY client/ client/
COPY vite.config.ts tsconfig.json postcss.config.js components.json ./
ARG VITE_WALLETCONNECT_PROJECT_ID
ARG VITE_API_URL
ARG VITE_PINATA_GATEWAY
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine
COPY --from=builder /app/dist/public /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
