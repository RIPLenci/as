# AEGIS SECURITY — System Architecture

## Multi-Service Topology

AEGIS SECURITY is structured into three coordinated runtimes sharing domain contracts (`lib/aegis/`) and persistence adapters (`lib/server/`):

1. **Web Control Plane & API (`app/`)**:
   - Serves the authenticated Security Dashboard (`app/page.tsx` -> `components/aegis/AegisWorkspace.tsx`).
   - Exposes REST endpoints (`app/api/**`) and Server-Sent Events (`app/api/realtime/stream/route.ts`).
2. **Discord Gateway Protection Bot (`services/bot/index.ts`)**:
   - Connects via `discord.js` v14.28.1 with minimal privacy-preserving intents (`Guilds`, `GuildMembers`, `GuildModeration`, `GuildWebhooks`, **no** `MessageContent`).
   - Registers 7 slash command groups (`services/bot/commands/registry.ts`) and renders operational panels using **Discord Components V2** (`services/bot/components/v2-panels.ts`).
   - Subscribes to Redis channel `aegis:sync` for zero-downtime hot configuration reload when admins save settings in the Web Dashboard.
3. **Background Expiration & Maintenance Worker (`services/worker/index.ts`)**:
   - Periodically expires temporary Global Bans past `expiresAt`, records immutable audit history events, and broadcasts invalidation messages.

---

## Multi-Tier Cache & Persistence

| Tier | Component | Role | Failure Mode |
| :--- | :--- | :--- | :--- |
| **L1** | `BoundedMemoryCache` (`lib/aegis/sliding-window.ts`) | O(1) Map LRU + TTL hot cache for guild policies and risk configs | Bounded `maxEntries` prevents unbounded memory growth |
| **L2** | `RedisCoordinator` (`lib/server/redis.ts`) | Lua sliding-window burst counters, `aegis:sync` Pub/Sub, bot heartbeat TTL | Safe degradation to local `SlidingWindowTracker` |
| **L3** | MongoDB (`lib/server/mongodb.ts`) + Atomic Disk WAL (`lib/server/store.ts`) | Persistent snapshots, Global Ban records, and immutable Audit Logs | Atomic write-rename to `.aegis-data/store.json` keeps operations continuous |

---

## Explainable Risk Engine (`lib/aegis/risk-engine.ts`)

Every suspicious join is scored from `0` to `100` using configurable weights (`accountAge`, `joinPattern`, `eventVolume`, `repetitiveBehavior`, `globalBanMatch`) multiplied by Guild Protection Mode (`NORMAL`, `STRICT`, `EMERGENCY`). Severe-sanction safeguards guarantee that a newly created Discord account alone never triggers an automated ban, kick, or quarantine without corroborating burst, pattern, bot, or Global Ban evidence.
