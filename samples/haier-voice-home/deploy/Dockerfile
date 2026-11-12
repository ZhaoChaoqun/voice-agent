FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . ./
RUN npm run build
WORKDIR /app/editions/modern
RUN npm ci --no-audit --no-fund && npm run build
WORKDIR /app/editions/habitat
RUN npm ci --no-audit --no-fund && npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
ENV HAIER_WEB_ROOT=editions/habitat/dist
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json /app/tsconfig.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/knowledge ./knowledge
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/editions/modern/dist ./editions/modern/dist
COPY --from=build --chown=node:node /app/editions/habitat/dist ./editions/habitat/dist
RUN mkdir -p .azure knowledge/uploads /data/sessions \
    && chown -R node:node .azure knowledge /data
USER node
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "server/index.ts"]
