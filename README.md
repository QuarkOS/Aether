# Aether

A full-stack TypeScript starter: an Express REST API and a React + Vite web client, managed as npm workspaces. The demo app is a "signal board" where you broadcast short messages.

## Requirements

- Node.js >= 20 (repo tested on Node 22)
- npm >= 10

## Getting started

```bash
npm install   # installs all workspaces
npm run dev   # starts the API (http://localhost:3001) and web app (http://localhost:5173)
```

The web dev server proxies `/api/*` to the API, so open http://localhost:5173 and start broadcasting.

## Workspaces

- `server/` — Express + TypeScript API (`@aether/server`). In-memory signal store; no external services required.
- `web/` — React + Vite + TypeScript client (`@aether/web`).

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness check. |
| `GET` | `/api/signals` | List signals (newest first). |
| `POST` | `/api/signals` | Create a signal. Body: `{ "author": string, "message": string }`. |
| `DELETE` | `/api/signals/:id` | Delete a signal. |

## Scripts

Run from the repo root:

- `npm run dev` — run API and web dev servers together.
- `npm run build` — type-check and build both workspaces.
- `npm run typecheck` — type-check both workspaces.
- `npm run lint` — lint the repo with ESLint.
- `npm test` — run the API unit tests.

## Cloud Agent environment

`.cursor/environment.json` runs `npm install` on setup and starts the `api` and `web`
dev servers as persistent terminals, exposing ports `3001` and `5173`.
