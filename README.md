# DockerWatch Lite

A lightweight web dashboard that watches the Docker containers on the same machine, shows their status and memory usage in real time, and lets you record **audit snapshots** (tag + note + point-in-time container state) into PostgreSQL.

Built for the UTS COMP6991031 exam project: one `docker compose up -d --build` and the whole stack runs locally at `http://localhost:3000`. Cost: Rp0 — everything is open source.

## What it does

- Lists all containers (name, image, state, ports, networks, mounts) with live memory and CPU usage for running containers.
- Summary cards: total / running / exited / high memory (≥ 70% warning, ≥ 85% critical).
- "Needs attention" panel for exited containers (exit code, OOM killed) and near-OOM memory.
- Read-only inspect drawer per container (networks, mounts, healthcheck).
- Audit snapshots: the **server** reads the current Docker state at save time (host name, running/total counts, container list + memory). The client cannot fake these numbers. Snapshots survive stack restarts via a named volume.
- Redis cache (`containers:v1`, TTL 5 s) in front of the Docker socket. If Redis is down the app keeps working straight from Docker (`cached: false`); if Postgres is down, `/health` reports it.
- The demo twist: the dashboard monitors **its own compose stack** (app, db, cache, adminer), so the data on screen is real. `docker stop dockerwatch-cache` and the container instantly shows as exited in the UI.

## Architecture

```
Browser opens http://localhost:3000
  └─ app (Node/Express + built React, port 3000)        [mem_limit 256m]
       ├─ reads /var/run/docker.sock (read-only mount)  via dockerode
       ├─ caches results in cache (Redis 7.4, TTL 5 s)  [mem_limit 128m]
       └─ stores snapshots in db (PostgreSQL 16.4)      [mem_limit 256m, named volume pg_data]
              └─ adminer (optional, profile "tools", port 8080)
```

All services run on the user-defined bridge network `dw_net` and talk to each other via service names (`db`, `cache`) — the Docker DNS resolves them inside the network. The app's port is bound to `127.0.0.1` only (the dashboard has no login, so it must not be reachable from the network).

## Quickstart

Requires Docker with Compose v2. Git clone first, then:

```bash
cp .env.example .env
docker compose up -d --build
# open http://localhost:3000
```

Notes:

- Edit `.env` to change the port or the Postgres credentials (avoid `@`, `:`, `/` in the password — it is embedded in a URL).
- Optional DB UI: `docker compose --profile tools up -d`, then open `http://localhost:8080`.
- The app container mounts `/var/run/docker.sock` **read-only**. `:ro` only protects the socket file itself — the real safety comes from the app calling only read (GET) Engine API endpoints. Access to the socket is effectively root access to the host; for production use a socket proxy that restricts endpoints.
- Development mode (without Docker): `npm install`, `npm start` (API on :3000) and `npm run dev` (Vite on :5173, proxies `/api` and `/health`).

## API

| Method | Path | Description | Success | Errors |
|---|---|---|---|---|
| GET | `/health` | App + db + redis check | 200 `{status:"ok", db:"up", redis:"up"\|"down"}` | 503 `{status:"error", db:"down", ...}` — only when Postgres is unreachable; Redis down never fails health |
| GET | `/api/containers` | Host info + container list | 200 `{cached, updatedAt, host, containers}` | 503 `{error:"Cannot reach Docker socket"}` |
| POST | `/api/snapshots` | Save snapshot `{tag, note}` | 201 snapshot object | 400 `{error}` for invalid input |
| GET | `/api/snapshots` | 20 newest snapshots | 200 `Snapshot[]` | 500 when the DB fails |

Snapshot fields are camelCase: `{id, hostName, tag, note, runningCount, totalCount, containers:[{id,name,state,mem}], createdAt}`.

Example calls:

```bash
curl http://localhost:3000/health

curl http://localhost:3000/api/containers

curl -X POST http://localhost:3000/api/snapshots \
  -H 'Content-Type: application/json' \
  -d '{"tag":"ROUTINE_CHECK","note":"Morning check, everything healthy."}'

curl http://localhost:3000/api/snapshots
```

Valid tags: `ROUTINE_CHECK`, `INCIDENT_AUDIT`, `PRE_DEPLOY`, `POST_DEPLOY`. `note` is required, 1–500 characters.

> Don't enter personal data in snapshot notes — only container metadata and your own remark are stored; container environment variables, logs and file contents are never saved.

## Screenshots

_(to be added for the report — run the stack, take real screenshots)_

| Screenshot | What it shows |
|---|---|
| `![Dashboard](docs/screenshots/dashboard.png)` | Main dashboard with all containers up |
| `![Exited](docs/screenshots/exited.png)` | Demo: one container stopped, showing the "exited" state and attention panel |
| `![Snapshot](docs/screenshots/snapshot.png)` | Snapshot drawer with saved history |

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite 5 + Tailwind CSS 3 |
| Backend | Node.js 22 + Express 4 (serves the API and the built frontend from one container) |
| Docker client | dockerode over `/var/run/docker.sock` |
| Database | PostgreSQL 16.4 (named volume `pg_data`) |
| Cache | Redis 7.4 |

## AI Usage Declaration

_(fill in honestly before submitting — see PRD Appendix B)_

- Usage type: Partial (max. 50%)
- Tools: <e.g. Claude / Zed AI>
- AI-assisted parts: <e.g. drafting the PRD, reviewing the design, scaffolding the backend from the spec, boilerplate UI from the mockup>
- Parts I did myself: <e.g. Dockerfile, docker-compose.yml, testing, video, article>
- Example prompts: "<paste 1–3 prompts you actually used>"
