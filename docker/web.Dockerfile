# --- Étape 1 : build de l'application Angular ---
FROM node:22-alpine AS build
WORKDIR /app

# Dépendances d'abord (meilleur cache des couches Docker)
COPY cider-app/package.json cider-app/package-lock.json ./
COPY cider-app/libs ./libs
RUN npm ci --no-audit --no-fund

# Sources puis build de production
COPY cider-app/ ./
RUN npm run build

# --- Étape 2 : serveur web statique ---
FROM nginx:1.27-alpine
# modèle traité au démarrage par l'image nginx (variables d'environnement substituées)
ENV CIDER_MAX_PROJECT_MB=200
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist/cider/browser /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
