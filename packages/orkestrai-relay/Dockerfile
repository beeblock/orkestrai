FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/orkestrai-collaboration-protocol/package.json packages/orkestrai-collaboration-protocol/package.json
COPY packages/orkestrai-relay/package.json packages/orkestrai-relay/package.json
# The relay only uses pure-JS packages; desktop lifecycle scripts do not belong in this image.
RUN npm install --global npm@11.6.2 \
  && npm ci --omit=dev --workspace @orkestrai/relay --include-workspace-root=false --ignore-scripts --no-audit --no-fund

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY packages/orkestrai-collaboration-protocol packages/orkestrai-collaboration-protocol
COPY packages/orkestrai-relay packages/orkestrai-relay
USER node
EXPOSE 8787
CMD ["node", "packages/orkestrai-relay/src/server.mjs"]
