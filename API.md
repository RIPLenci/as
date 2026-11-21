# AEGIS SECURITY — REST API & SSE Reference

## Health & Readiness

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Infrastructure snapshot (API, MongoDB, Redis, Discord Bot, L1 cache stats) |
| `GET` | `/api/ready` | Readiness check |
| `GET` | `/api/live` | Liveness check |

---

## Authentication & Guild Discovery

| Method | Path | Description |
| :--- | :--- | :--- |
| `POST` | `/api/auth/discord` | Generates Discord OAuth2 PKCE authorization URL & CSRF state cookie |
| `GET` | `/api/auth/callback` | Exchanges OAuth2 code, verifies user guilds & bot membership, sets session cookie |
| `POST` | `/api/auth/sandbox` | Initializes Local Evaluation Workspace session when testing without OAuth keys |
| `GET` | `/api/auth/session` | Returns current authenticated user & infrastructure state |
| `POST` | `/api/auth/logout` | Clears session cookie and logs audit event |
| `GET` | `/api/auth/servers` | Lists authorized manageable Discord guilds and bot install status |
| `POST` | `/api/auth/servers` | Verifies real Discord bot membership via REST API for a guild |

---

## Security Overview & Telemetry

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/overview?period=24h|7d|30d|90d&guildId=` | Equivalent-period metrics, activity series, threat breakdown, incidents, health |
| `GET` | `/api/realtime/events?guildId=&risk=` | Filtered security telemetry event list |
| `GET` | `/api/realtime/stream` | Server-Sent Events stream (`connected`, `heartbeat`, `aegis_update`) |
| `GET` / `PATCH` | `/api/notifications` | Fetch notifications & mark read |

---

## Guild Anti-Raid, Anti-Nuke, Lockdown & Operations

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/guilds/[guildId]/status` | Guild + Anti-Raid + Lockdown snapshot |
| `GET` / `PATCH` | `/api/guilds/[guildId]/config` | Guild settings (alert channel, batch interval, deduplication) |
| `GET` / `PATCH` | `/api/guilds/[guildId]/antiraid` | Read/update Anti-Raid thresholds, risk rules, signal weights |
| `POST` | `/api/guilds/[guildId]/antiraid/enable` | Enable guild Anti-Raid & publish `aegis:sync` |
| `POST` | `/api/guilds/[guildId]/antiraid/disable` | Disable guild Anti-Raid & publish `aegis:sync` |
| `POST` | `/api/guilds/[guildId]/antiraid/test` | Execute diagnostic Risk Engine evaluation (dry run or persisted incident) |
| `GET` / `PATCH` | `/api/guilds/[guildId]/antinuke` | Read/update Anti-Nuke thresholds & reversible auto-response |
| `GET` / `POST` | `/api/guilds/[guildId]/lockdown` | Read state / activate or restore snapshot-backed Emergency Lockdown |
| `GET` / `POST` / `DELETE` | `/api/guilds/[guildId]/whitelist` | Rule-scoped whitelist management |
| `GET` | `/api/incidents` & `GET` / `PATCH` `/api/incidents/[incidentId]` | Incident triage, status workflow, investigation comments |
| `GET` / `POST` | `/api/quarantine` & `PATCH` `/api/quarantine/[id]` | Member quarantine isolation, duration extension, release |

---

## Global Ban Network & Governance

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` / `POST` | `/api/globalban` | Search Global Bans + analytics / issue Global Ban |
| `GET` / `PATCH` | `/api/globalban/[id]` & `POST` `/api/globalban/[id]/revoke` | Inspect, update, or non-destructively revoke sanction |
| `GET` / `POST` | `/api/appeals` & `PATCH` `/api/appeals/[id]` | Submit & review appeals (approved appeals auto-revoke ban) |
| `GET` / `PATCH` | `/api/participating-servers` | Manage guild voluntary opt-in & enforcement mode |
| `GET` / `POST` / `DELETE` | `/api/global-moderators` | Global moderator authorization management |
| `GET` | `/api/audit-logs`, `/api/permissions`, `PATCH` `/api/preferences` | Audit ledger, RBAC matrix, and user theme/language settings |
