# --- Étape 1 : compilation du serveur TypeScript ---
FROM node:22-alpine AS build
WORKDIR /app
COPY cider-server/package.json cider-server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY cider-server/tsconfig.json ./
COPY cider-server/src ./src
RUN npm run build

# --- Étape 2 : exécution, dépendances de production uniquement ---
FROM node:22-alpine
ENV NODE_ENV=production \
    CIDER_DATA_DIR=/data \
    CIDER_PORT=3000
WORKDIR /app
COPY cider-server/package.json cider-server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN chmod +x /usr/local/bin/api-entrypoint.sh \
    && apk add --no-cache su-exec \
    && mkdir -p /data && chown node:node /data

VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
ENTRYPOINT ["api-entrypoint.sh"]
CMD ["node", "dist/index.js"]
