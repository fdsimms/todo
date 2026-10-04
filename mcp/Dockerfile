# The MCP server and payload store, for a host like Fly.io. See mcp/DEPLOY.md.
#
# Built from the repo root, not from mcp/: the server runs the app's own db
# layer out of ../src, and that code resolves date-fns, zustand and expo-sqlite
# from the root node_modules.
FROM node:22-bookworm-slim

# better-sqlite3 compiles from source when no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Scripts skipped: the root postinstall patches React Native and builds patch
# notes, neither of which the server touches.
# .npmrc too: it sets legacy-peer-deps, without which the lockfile reads as
# out of sync and `npm ci` refuses.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts

# Dev dependencies kept: the server runs straight off TypeScript through tsx.
COPY mcp/package.json mcp/package-lock.json mcp/
RUN cd mcp && npm ci

COPY src src
COPY mcp mcp

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

WORKDIR /app/mcp
# tsx directly rather than `npm start`, so a stop signal reaches the server.
CMD ["node_modules/.bin/tsx", "src/server.ts"]
