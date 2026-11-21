# AEGIS SECURITY

**Discord Security & Global Protection Network**

AEGIS SECURITY is an enterprise-grade cybersecurity platform exclusively engineered for Discord community defense. It unifies:

1. **Web Security Operations Dashboard** (Next.js App Router + Tailwind CSS + Apache ECharts) with 23 specialized sections across `GENERAL`, `ANTI-RAID PROTECTION`, `GLOBAL SECURITY`, and `SYSTEM`, Dark/Light/System themes, and Spanish (default) + English i18n.
2. **Backend REST API & Real-Time SSE Telemetry** with Discord OAuth2 (Authorization Code + PKCE), Role-Based Access Control (RBAC), Anti-IDOR guild isolation, L1 Bounded Memory Cache, L2 Redis Pub/Sub & Lua sliding windows, and L3 MongoDB + atomic disk WAL fallback.
3. **Standalone Pterodactyl-Ready Discord Bot (`services/bot`)** using `discord.js` v14.28.1 with native **Discord Components V2** (`MessageFlags.IsComponentsV2`, `ContainerBuilder`, `SectionBuilder`, `TextDisplayBuilder`, `SeparatorBuilder`) and zero emojis.
4. **Background Sanction Worker (`services/worker`)** for scheduled Global Ban expiration, cache invalidation, and audit logging.

---

## Core Architecture

- **Dashboard & REST API**: `npm run dev` (or `npm run start:api`)
- **Discord Protection Bot**: `npm run start:bot`
- **Background Expiration Worker**: `npm run start:worker`
- **Unit Tests (`node:test`)**: `npm run test:unit` (or `npx --yes tsx --test lib/aegis/core.test.ts`)

---

## Environment Setup

Copy `.env.example` to `.env` and populate secrets:

- `DISCORD_CLIENT_ID`: Discord Application Client ID
- `DISCORD_CLIENT_SECRET`: Discord Application OAuth2 Client Secret
- `DISCORD_BOT_TOKEN`: Discord Bot Token (with `Guilds`, `GuildMembers`, `GuildModeration`, `GuildWebhooks` intents)
- `APP_URL`: Public application URL (used to compute `${APP_URL}/api/auth/callback`)
- `SESSION_SECRET`: 32+ byte cryptographic secret for HMAC-SHA256 cookies
- `MONGODB_URI`: MongoDB Atlas / self-hosted URI (L3 persistence)
- `REDIS_URL`: Redis connection string (L2 coordination & Pub/Sub)
- `AEGIS_OWNER_IDS` / `AEGIS_GLOBAL_ADMIN_IDS`: Comma-separated Discord User IDs for Global Network roles

When `DISCORD_CLIENT_ID` / `MONGODB_URI` / `REDIS_URL` are not configured yet, AEGIS SECURITY reports infrastructure health honestly (`UNCONFIGURED` / `DEGRADED`) and lets evaluators inspect all 23 dashboard workflows via the **Local Evaluation Workspace**.
