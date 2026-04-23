FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Runtime
FROM node:22-slim

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Sessions and state are stored in /data; mount a volume for persistence.
ENV HOME=/data
RUN mkdir -p /data
VOLUME ["/data"]

# Bridge mode is activated by setting these two env vars:
#   ECHOMIND_BRIDGE_URL=https://bridge.example.com
#   ECHOMIND_BRIDGE_TOKEN=<JWT>
CMD ["node", "dist/main.js", "daemon"]
