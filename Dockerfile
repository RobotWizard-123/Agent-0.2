FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --chown=node:node server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node data/seed ./data/seed
COPY --chown=node:node scripts/reset-demo-data.js ./scripts/reset-demo-data.js

RUN mkdir -p /app/data/runtime && chown -R node:node /app/data/runtime

USER node
EXPOSE 3000
VOLUME ["/app/data/runtime"]

HEALTHCHECK --interval=20s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/ready >/dev/null || exit 1

CMD ["node", "server.js"]
