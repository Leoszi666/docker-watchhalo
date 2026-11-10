# DockerWatch Lite

A lightweight web dashboard that reads Docker containers on the host machine, shows their status and memory usage, and lets you record **audit snapshots** into PostgreSQL.

**Quick start:** one command starts the full stack. Cost: Rp0. Everything is open source.

---

## What it does

- Lists all containers: name, image, state, ports, networks, IP, and mounts.
- Summary row: total / running / exited / high-memory count.
- Memory bar per running container. Warning at ≥ 70 %. Critical at ≥ 85 %.
- Filter bar: ALL / RUNNING / EXITED / HIGH_MEM. Search by name.
- Read-only inspect panel per container (networks, mounts, healthcheck state).
- Host info from Docker: OS, kernel version, engine version, CPU count, total RAM.
- Audit snapshots: `POST /api/snapshots` sends only `{tag, note}`. The **server** reads the Docker state at save time. The browser cannot change the numbers.
- Snapshots survive a stack restart. Data lives in a named volume.
- Redis cache in front of the Docker socket (key `containers:v1`, TTL 5 s). If Redis is down, the app reads directly from Docker. The response always includes `cached: true/false`.
- Demo advantage: the dashboard monitors its own compose stack (app, db, cache). Run `docker stop dockerwatch-cache` and the UI shows "exited" immediately.

**Bonus feature:** Discord crash alerting. See [Discord alerting](#discord-alerting).

---

## Architecture

```
Browser → http://localhost:3000
  └─ app  (Node.js 22 + Express, serves API and built React frontend)   [mem_limit 256m]
       ├─ /var/run/docker.sock  (read-only mount)  — read via dockerode
       ├─ cache  (Redis 7.4-alpine, internal port 6379, TTL 5 s)        [mem_limit 128m]
       ├─ db     (PostgreSQL 16.4-alpine, internal port 5432)           [mem_limit 256m]
       │            └─ named volume: pg_data
       └─ adminer  (optional, profile "tools", host port 8080)
```

All services run on the user-defined bridge network `dw_net`. Services reach each other by service name (`db`, `cache`). Docker DNS resolves the names inside the network. The app port binds to `127.0.0.1` only. The dashboard has no login, so it must not be reachable from other machines on the network.

---

## Prerequisites

- Docker Engine with Compose v2 installed on the host machine.
- The Docker socket at `/var/run/docker.sock` must be readable. On Linux, check the socket group with `stat -c '%g' /var/run/docker.sock`. Add your user to that group if needed.
- Ports 3000 (and 8080 for Adminer) must be free on the host.

---

## Quickstart

**Step 1.** Clone this repository and go to the project folder.

**Step 2.** Copy the example environment file.
```bash
cp .env.example .env
```

**Step 3.** Open `.env` in a text editor. Change the Postgres password.

> Do not use `@`, `:`, or `/` in the password. The password is part of a connection URL.

**Step 4.** Build and start the stack.
```bash
docker compose up -d --build
```
Result: Docker builds the app image, pulls `postgres:16.4-alpine3.20` and `redis:7.4.0-alpine`, and starts all three services. The db and cache services must pass their healthchecks before the app starts.

**Step 5.** Open `http://localhost:3000` in a browser.

Result: the dashboard shows the running containers with live status and memory usage.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_PORT` | No | `3000` | Host port for the app |
| `POSTGRES_USER` | Yes | — | Postgres username |
| `POSTGRES_PASSWORD` | Yes | — | Postgres password. No `@`, `:`, or `/`. |
| `POSTGRES_DB` | Yes | — | Postgres database name |
| `CACHE_TTL_SECONDS` | No | `5` | Redis cache TTL in seconds |
| `DISCORD_WEBHOOK_URL` | No | _(empty)_ | Discord webhook URL for crash alerts |
| `DISCORD_AUTO_ALERT` | No | `false` | `true` sends alerts automatically on crash |
| `SERVER_ENV` | No | `LOCAL-DEV` | Environment label shown in Discord alert footer |

Do not commit `.env`. The `.gitignore` file excludes it. Commit `.env.example` instead.

### How to get a Discord webhook URL

**Step 1.** Open your Discord server. Go to the channel where you want to receive alerts.

**Step 2.** Click the gear icon next to the channel name → **Integrations** → **Webhooks** → **New Webhook**.

**Step 3.** Give the webhook a name (e.g. `DockerWatch`). Click **Copy Webhook URL**.

**Step 4.** Paste the URL as the value of `DISCORD_WEBHOOK_URL` in your `.env` file. Leave it empty to disable alerting.

---

## Optional: database UI (Adminer)

**Step 1.** Start the `tools` profile.
```bash
docker compose --profile tools up -d
```

**Step 2.** Open `http://localhost:8080`.

Result: Adminer connects to the `db` service. Use the credentials from your `.env` file.

---

## Development without Docker

Use this method to run the backend and frontend separately during development.

**Step 1.** Install all dependencies.
```bash
npm install
```

**Step 2.** Start the Express API server.
```bash
npm start
```
Result: the API runs on port 3000. It connects to your local Docker socket, Postgres, and Redis. Set `DATABASE_URL` and `REDIS_URL` as environment variables or in a `.env` file.

**Step 3.** In a second terminal, start the Vite dev server.
```bash
npm run dev
```
Result: the dev server runs on port 5173. `vite.config.js` proxies `/api` and `/health` to port 3000.

---

## API reference

| Method | Path | Description | Success | Error |
|---|---|---|---|---|
| GET | `/health` | App, db, and Redis check | `200 {status:"ok", db:"up", redis:"up"\|"down"}` | `503` only when Postgres is unreachable |
| GET | `/api/containers` | Host info + container list | `200 {cached, updatedAt, host, containers[]}` | `503` when Docker socket is unreachable |
| POST | `/api/snapshots` | Save a snapshot `{tag, note}` | `201` snapshot object | `400` for invalid input |
| GET | `/api/snapshots` | 20 newest snapshots, newest first | `200 Snapshot[]` | `500` when db is unreachable |
| POST | `/api/containers/:id/alert` | Send manual Discord crash alert | `200` | `400` exit 0; `404` not found; `429` cooldown active; `503` webhook not set |

**Valid tags for POST /api/snapshots:** `ROUTINE_CHECK`, `INCIDENT_AUDIT`, `PRE_DEPLOY`, `POST_DEPLOY`.

**Note field:** required, 1–500 characters. Do not enter personal data in notes. The app stores only container metadata and your note text. It never stores environment variables, log content, or file contents.

**Snapshot field names** are camelCase: `id`, `hostName`, `tag`, `note`, `runningCount`, `totalCount`, `containers` (`[{id, name, state, mem}]`), `createdAt`.

### Verification procedure

Run these steps to verify the stack after `docker compose up -d --build`.

**Step 1.** Check the health endpoint.
```bash
curl -i http://localhost:3000/health
```
Expected result: HTTP `200` and `{"status":"ok","db":"up","redis":"up"}`.

**Step 2.** Get the container list.
```bash
curl -i http://localhost:3000/api/containers
```
Expected result: HTTP `200`.

**Step 3.** Save a snapshot.
```bash
curl -i -X POST http://localhost:3000/api/snapshots \
  -H 'Content-Type: application/json' \
  -d '{"tag":"ROUTINE_CHECK","note":"Morning check, all containers healthy."}'
```
Expected result: HTTP `201` and a snapshot object with `runningCount`, `totalCount`, and `containers`.

**Step 4.** Send invalid input.
```bash
curl -i -X POST http://localhost:3000/api/snapshots \
  -H 'Content-Type: application/json' \
  -d '{"tag":"INVALID"}'
```
Expected result: HTTP `400`.

**Step 5.** Verify persistence. Stop the stack.
```bash
docker compose down
```

**Step 6.** Start the stack again.
```bash
docker compose up -d
```

**Step 7.** Get the snapshots.
```bash
curl http://localhost:3000/api/snapshots
```
Expected result: HTTP `200` and the snapshot from Step 3 is still present.

> `docker compose down -v` deletes the `pg_data` volume and all snapshot data.

---

## Project structure

```
dockerwatch/
├── server/
│   ├── index.js        # Express: routes + serve dist/
│   ├── docker.js       # Read containers via dockerode
│   ├── alerter.js      # Docker Events listener + Discord alert (bonus)
│   ├── db.js           # Postgres pool + table init
│   └── cache.js        # Redis client (fail-safe)
├── src/                # React frontend (Vite)
├── index.html
├── package.json
├── vite.config.js      # Dev proxy for /api and /health
├── tailwind.config.js
├── postcss.config.js
├── Dockerfile          # Multi-stage build: builder + runtime
├── .dockerignore
├── docker-compose.yml
├── .env.example        # Committed. Contains no secrets.
├── .gitignore
└── README.md
```

---

## Safety notes

- The app container mounts `/var/run/docker.sock` with the `:ro` flag.
- `:ro` protects the socket file from deletion or replacement. It does **not** restrict which Docker API endpoints the app can call.
- The actual safety layer is the application code in `server/docker.js`, which calls only read (GET) Engine API endpoints.
- Access to the Docker socket is equivalent to root access on the host. For a production deployment, place a socket proxy (such as Tecnativa Docker Socket Proxy) in front of the socket and allow only the endpoints this app uses.
- Bind app and Adminer ports to `127.0.0.1`. Do not expose them to the network. The dashboard has no authentication.

---

## Discord alerting

This feature is optional. It is active when `DISCORD_WEBHOOK_URL` is set in `.env`.

**Two modes:**

| Mode | `DISCORD_AUTO_ALERT` | Behavior |
|---|---|---|
| Manual (default) | `false` | The listener runs and logs all events. Alerts go to Discord only when the user clicks the Discord icon on a non-running container in the Snapshots drawer. |
| Automatic | `true` | Every `die` event with an abnormal exit code sends an alert immediately. |

**Anti-spam:** after an alert sends, the app sets the key `alert:cooldown:<name>` in Redis with a TTL of 300 seconds. A second alert for the same container within that window is rejected with HTTP `429`. If Redis is down, alerting continues without cooldown (fail-open).

**Recovery detection:** a `start` event does not immediately send a green embed. The app waits 15 seconds and inspects the container. If `State.Running === true` and `State.Restarting === false`, the app sends a recovery embed (automatic mode only) and removes the cooldown key.

**Exit code 0 is always ignored.** The app only alerts on abnormal exits.

### Discord alert test procedure

**Step 1.** Start a container that exits with an error.
```bash
docker run -d --name crash-test alpine:3.20 sh -c "echo 'ERROR: disk full'; exit 1"
```
Expected result: a red Discord embed with the exit code and the last 10 log lines.

**Step 2.** Start a container that exits normally.
```bash
docker run -d --name clean-exit alpine:3.20 echo "done"
```
Expected result: no Discord alert.

**Step 3.** Remove the test containers.
```bash
docker rm -f crash-test clean-exit
```

---

## Screenshots


| File | What it shows |
|---|---|
| `docs/screenshots/dashboard.png` | Main dashboard, all containers running |
| `docs/screenshots/exited.png` | One container stopped; attention panel visible |
| `docs/screenshots/snapshot.png` | Snapshot drawer with saved history |
| `docs/screenshots/docker-images.png` | `docker images` output showing image size |
| `docs/screenshots/compose-ps.png` | `docker compose ps` with db and cache healthy |

---

## Assignment

| | |
|---|---|
| Course | COMP6991031 |
| NIM | 2802515141 |


---

## AI Usage Declaration


- Usage type: Partial 
- Tools: Glm-flash, claude, gemini
- AI-assisted parts: PRD drafting, backend discord feature, UI boilerplate from mockup
- Parts I did myself: backend core, Dockerfile, docker-compose.yml, testing, video, article
- Example prompts I used:
  1. "Draft a PRD for a Docker container monitoring dashboard: features, tech stack, API spec, and test plan."
  2. "Build the backend Discord alerting: listen to Docker die events, map exit codes, apply a 300-second Redis cooldown, and send rich embeds with the last 10 log lines."
  3. "Create the UI boilerplate from the HTML mockup as React components with Tailwind: summary cards, container table, and snapshot drawer."
