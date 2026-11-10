# ---------- Stage 1: builder ----------
# Tag versi spesifik (bukan latest)
FROM node:22.11.0-alpine3.20 AS builder
# Semua perintah berikutnya berjalan di /app
WORKDIR /app
# Dependency dulu, supaya layer cache terpakai
COPY package.json package-lock.json ./
# Install persis sesuai lockfile
RUN npm ci
# Baru source code (sering berubah)
COPY . .
# Vite membuild frontend ke /app/dist
RUN npm run build
# Buang devDependencies
RUN npm prune --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:22.11.0-alpine3.20 AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
# Hanya prod dependencies dan hasil build yang disalin
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY package.json ./
# Dokumentasi port (bukan publish)
EXPOSE 3000
# Exec form
CMD ["node", "server/index.js"]
