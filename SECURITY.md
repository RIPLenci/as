# AEGIS SECURITY — Security Model & Threat Mitigations

## 1. Zero-Trust Authentication (Discord OAuth2 + PKCE)

- **Flow**: Authorization Code Grant with `S256` PKCE (`code_challenge` + `code_verifier`) and cryptographic CSRF `state` validation (`lib/server/session.ts`).
- **Session Storage**: HMAC-SHA256 signed cookies marked `HttpOnly`, `Secure`, `SameSite=None` (required for secure iframe/sandbox embedding). Timing-safe HMAC comparison (`crypto.timingSafeEqual`) rejects tampered cookies.
- **No Trust in Client State**: User identity, global RBAC role, and authorized guild IDs are resolved exclusively on the server (`lib/server/auth-guard.ts`).

---

## 2. Anti-IDOR & Strict Guild Isolation

- Every `/api/guilds/[guildId]/*`, `/api/quarantine/*`, and `/api/incidents/*` request validates that the authenticated user either:
  - Holds `OWNER` or `GLOBAL_ADMINISTRATOR` authority, OR
  - Possesses verified Discord guild ownership / `MANAGE_GUILD` / `ADMINISTRATOR` permission stored in `userGuildAccess`.
- Cross-guild tampering attempts return `403 FORBIDDEN` and write a `DENIED` audit log entry.

---

## 3. Non-Indiscriminate Enforcement Safeguards

- **Safe Account-Age Handling**: Young account age contributes weighted risk points but includes an explicit safeguard in `lib/aegis/risk-engine.ts` capping recommended action at `ALERT` unless corroborated by burst volume, username similarity, bot flag, or active Global Ban status.
- **Reversible Channel Lockdown**: Pre-lockdown `@everyone` channel permission overwrites are captured as `ChannelPermissionSnapshot` records so deactivation restores only AEGIS-applied flags while preserving external admin changes.
- **Hierarchy Validation**: Discord Bot quarantine/kick/ban actions verify bot role hierarchy relative to the target member before attempting Discord API mutations.
- **Voluntary Global Ban Opt-In**: Global Bans are enforced **only** in guilds that explicitly enable Global Ban participation (`GuildParticipationRecord.globalBanEnabled = true`).

---

## 4. Secret Hygiene & Audit Integrity

- Bot tokens, OAuth2 client secrets, MongoDB URIs, and Redis credentials remain strictly server-side (`lib/server/env.ts`) and are never logged in `AuditLogs` or serialized to the client.
- All administrative actions validate inputs with strict Zod schemas (`lib/aegis/validators.ts`) rejecting malformed Discord Snowflake IDs (`^\d{17,20}$`) and unbounded durations.
