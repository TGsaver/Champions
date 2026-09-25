FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

ENV PORT=3000 DATABASE_PATH=/app/data/gym.db
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/occupancy > /dev/null || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
