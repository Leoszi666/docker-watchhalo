# ---------- Stage 1: builder ----------
# Pinned version tag (not latest)
FROM node:22.11.0-alpine3.20 AS builder
# All later commands run in /app
WORKDIR /app
# Dependencies first, to use the layer cache
COPY package.json package-lock.json ./
# Install exactly from the lockfile
RUN npm ci
# Source code last (it changes often)
COPY . .
# Vite builds the frontend to /app/dist
RUN npm run build
# Drop the devDependencies
RUN npm prune --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:22.11.0-alpine3.20 AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
# Copy only the prod dependencies and the build output
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY package.json ./
# Port documentation (not publish)
EXPOSE 3000
# Exec form
CMD ["node", "server/index.js"]
