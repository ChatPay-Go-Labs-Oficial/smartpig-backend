# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

RUN apt-get update -y && \
    apt-get install -y openssl libssl-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

# Generate Prisma client and binaries (schema-engine + query-engine)
RUN npx prisma generate

COPY . .

RUN npm run build

# Prune dev dependencies so production node_modules is lean
RUN npm prune --omit=dev

# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:22-slim AS production

WORKDIR /app

RUN apt-get update -y && \
    apt-get install -y openssl libssl-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy pruned node_modules (includes Prisma binaries already generated)
# `node:22-slim` já traz o usuário `node` (uid 1000); os arquivos são copiados
# com ele como dono para que o processo não precise de root.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/package*.json ./

EXPOSE 3000

# Sem isto o processo roda como root: qualquer execução remota de código dentro
# do Node teria root no container.
USER node

CMD ["npm", "run", "start:migrate"]
