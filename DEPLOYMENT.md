# AEGIS SECURITY — Deployment Guide (Web, Bot & Worker / Pterodactyl)

## 1. Pterodactyl Multi-Container Deployment

AEGIS SECURITY runs cleanly across three independent Node.js processes using a shared Redis + MongoDB backing tier:

| Process | Package Script | Entry Point | Purpose |
| :--- | :--- | :--- | :--- |
| **Web & API** | `npm run start:api` | Next.js Production Server (`port 3000`) | Dashboard UI, REST API, OAuth2, SSE Stream |
| **Discord Bot** | `npm run start:bot` | `services/bot/index.ts` (via `tsx`) | Discord Gateway, Components V2, 7 Slash Commands |
| **Worker** | `npm run start:worker` | `services/worker/index.ts` (via `tsx`) | Global Ban expiration & Redis Pub/Sub maintenance |

---

## 2. Pterodactyl Startup Commands

1. **Web Panel Server**:
   - Build step: `npm ci && npm run build`
   - Startup command: `npm run start:api`
2. **Discord Bot Server**:
   - Install step: `npm ci`
   - Startup command: `npm run start:bot`
3. **Background Worker Server**:
   - Install step: `npm ci`
   - Startup command: `npm run start:worker`

All three containers should receive identical `MONGODB_URI`, `REDIS_URL`, and `DISCORD_BOT_TOKEN` secrets so `aegis:sync` Redis Pub/Sub broadcasts hot-reload bot policy caches in milliseconds.

---

## 3. Discord Developer Portal Configuration

1. Enable **Server Members Intent** under **Bot -> Privileged Gateway Intents**.
2. Add your deployment OAuth2 Redirect URLs under **OAuth2 -> Redirects**:
   - `https://ais-dev-q4elqz4ekj3s72cqfwbaxa-521789584755.us-east1.run.app/api/auth/callback`
   - `https://ais-pre-q4elqz4ekj3s72cqfwbaxa-521789584755.us-east1.run.app/api/auth/callback`
   - `http://localhost:3000/api/auth/callback` (local development)
3. Invite the bot with `bot` + `applications.commands` scopes and Administrator/Security permissions (`ManageGuild`, `ManageChannels`, `ManageRoles`, `KickMembers`, `BanMembers`, `ModerateMembers`, `ViewAuditLog`).
