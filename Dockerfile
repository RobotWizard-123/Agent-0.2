FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-solver.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements-solver.txt

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
COPY public ./public
COPY data/seed ./data/seed
COPY solver/cp_sat_solver.py ./solver/cp_sat_solver.py
COPY scripts/reset-demo-data.js ./scripts/reset-demo-data.js

RUN mkdir -p /app/data/runtime && chown node:node /app/data/runtime \
    && chmod -R a-w /app \
    && chmod u+w /app/data/runtime

USER node

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV CP_SAT_ENABLED=true
ENV CP_SAT_PYTHON=/opt/venv/bin/python
ENV CP_SAT_TIMEOUT_MS=2500

EXPOSE 3000

CMD ["npm", "start"]
