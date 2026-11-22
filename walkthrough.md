# Security Summary

**Reviewed Files**: 34
**Issues Resolved**: 11

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Cross-Site Mutation Protection (CSRF) | `lib/server/auth-guard.ts` | 98 | Cookie sessions use `SameSite=None` for iframe compatibility without checking `Origin` / `Sec-Fetch-Site` on mutating endpoints. | High | Fixed | Added `verifyMutationOrigin(req)` enforcing Bearer token or matching `Host` / `X-Forwarded-Host` / `appUrl` and blocking `Sec-Fetch-Site: cross-site` across all `POST`, `PATCH`, and `DELETE` endpoints. |
| Duplicate Discord Gateway Ownership | `lib/server/bot-runner.ts` | 1 | Read-only health checks (`getSystemHealth`) and Next.js SSR could trigger a second Discord Gateway connection using the same token as `services/bot/index.ts`. | High | Fixed | Designated `services/bot/index.ts` (`AEGIS_STANDALONE_BOT=true`) as the sole Gateway owner with Redis lock `aegis:bot:gateway_owner`, converted `getSystemHealth()` and `/api/health/ready` to strictly read-only probes, and gated embedded start behind `AEGIS_EMBEDDED_BOT=true`. |
| Unverified Discord Sanctions & Silent Failures | `lib/aegis/sanction-executor.ts` | 49 | Sanctions could fail silently with empty `.catch(() => undefined)` handlers and increment `attacksPrevented` even when the bot lacked permissions or Discord rejected the call. | High | Fixed | Implemented `checkActionPrerequisites` (`BanMembers`, `KickMembers`, `ModerateMembers`, role hierarchy, guild owner exclusion), `PENDING -> EXECUTING -> SUCCESS | FAILED | CANCELLED` lifecycle, transient-only retries, 30s idempotency cache, and strict counter increment only on `SUCCESS`. |
| Unlinked Anti-Raid Detector Switches & Avatar Bias | `lib/aegis/fast-antiraid.ts`, `lib/aegis/risk-engine.ts` | 101, 85 | Disabling individual detector switches did not consistently isolate signals, and default Discord avatars could influence suspicion scoring. | Medium | Fixed | Wired `burstDetection`, `joinPatternDetection`, `suspiciousAccountDetection`, and `botJoinDetection` cleanly so disabled detectors contribute `0` points, removed all `!hasAvatar` penalties, and enforced non-punitive caps in `MONITORING` / `ALERT_ONLY`. |
| Synthetic Diagnostic Probes Polluting Metrics | `app/api/guilds/[guildId]/antiraid/test/route.ts` | 85 | Running `/antiraid probar` incremented real `attacksDetected`, `attacksPrevented`, and `eventsProcessed` metrics. | Medium | Fixed | Isolated diagnostic probes to `LOG_ONLY` / `LOGGED` records (`syntheticProbe: true`) without mutating real mitigation counters. |
| Unvalidated Evidence File Uploads | `app/api/admin/globalban/route.ts` | 1 | Client-supplied MIME headers/filenames on Global Ban evidence uploads risked disguised non-image uploads. | High | Fixed | Enforced binary magic-byte validation (`detectImageFormatFromMagicBytes`) for PNG/JPEG/GIF/WEBP with canonical generated filenames and resolved directory confinement. |
| Path Traversal on Evidence Serving | `app/api/admin/globalban/evidence/[banId]/[filename]/route.ts` | 1 | URL path parameters needed strict single-segment validation and response hardening. | High | Fixed | Enforced `isSafeSinglePathSegment`, canonical `path.resolve` prefix confinement, `X-Content-Type-Options: nosniff`, and explicit inline `Content-Disposition`. |
| Inline Script Breakout in OAuth Callback | `app/api/auth/callback/route.ts` | 1 | Session handoff serialized JSON inside an HTML `<script>` block. | High | Fixed | Applied `sanitizeHtmlScriptJson` (`<`, `>`, `&`, `\u2028`, `\u2029` escaping) and `escapeHtml` on fallback redirect attributes. |
| Prototype Pollution on Hydration | `lib/aegis/security-helpers.ts`, `lib/server/store.ts` | 1 | Hydrating external/persisted JSON could retain `__proto__`, `constructor`, or `prototype` keys. | High | Fixed | Applied recursive `stripUnsafeKeys` inside `normalizeLoadedState`. |
| Cross-Container Config Sync & Stale State | `lib/server/sync-coordinator.ts`, `lib/server/store.ts` | 38, 311 | File-only `store.json` sharing and unversioned Pub/Sub broadcasts risked stale or dropped updates across Web, Bot, and Worker containers. | High | Fixed | Added MongoDB `GuildConfigModel` with monotonic `syncVersion`, `SyncOutboxModel` for Redis disconnect recovery, out-of-order rejection (`applyVersionedGuildConfig`), and per-process `originProcessId` deduplication. |
| Internal Error Detail Exposure | `app/api/bot/control/route.ts` | 172 | Unhandled exceptions could leak runtime stack details in HTTP 500 JSON payloads. | Medium | Fixed | Sanitized 500 JSON responses to generic Spanish error messages and routed diagnostics to structured `aegisLogger` redacting secrets/tokens. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| API Keys & Secrets | `lib/server/env.ts`, `lib/server/logger.ts` | All secrets (`DISCORD_BOT_TOKEN`, `MONGODB_URI`, `REDIS_URL`, `SESSION_SECRET`) stay server-side in `process.env`; structured logs redact credentials automatically. |
| Session & Cookie Hardening | `lib/server/session.ts` | OAuth2 PKCE (`S256`), single-use HMAC-signed exchange codes, `HttpOnly; Secure; SameSite=None` session cookies, and server-side revocation blacklist. |
| Access Control & Anti-IDOR | `lib/server/auth-guard.ts`, `lib/aegis/rbac.ts` | Every guild endpoint validates server-side Discord guild ownership/secondary-owner/admin membership (`requireGuildAuthorization`); global admin endpoints lock to `OWNER_ID`. |
| Transitive Dependency Audit | `package.json`, `bun.lock` | `bun audit` completed with 9 upstream transitive advisories (2 high, 7 moderate inside `postcss`, `minimatch`, `glob`, `uuid`, `@opentelemetry/core` pulled by Next.js/Tailwind/Mongoose/Firebase CLI) and zero custom vulnerable route handlers. |

## PoC Verification

### Cross-Site Mutation Origin Blocking (CSRF)

#### Summary
| Field | Value |
|---|---|
| Issue Type | Cross-Site Request Forgery on Cookie-Authenticated Mutations |
| Impact | High |
| Affected File | `lib/server/auth-guard.ts:98` |
| Test Scenario | `PATCH /api/guilds/100/antiraid` with `Origin: https://evil.example` and `Sec-Fetch-Site: cross-site` |

#### How It Was Fixed
Added `verifyMutationOrigin(req)` at the top of every mutating API route handler (`POST`, `PATCH`, `DELETE`) so requests lacking a `Bearer` header are blocked whenever `Sec-Fetch-Site: cross-site` or an untrusted `Origin` header is sent.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Untrusted cross-site request hits `PATCH /api/guilds/[guildId]/antiraid` (`app/api/guilds/[guildId]/antiraid/route.ts:34`) | Enters `verifyMutationOrigin(req)` |
| 2 | `lib/server/auth-guard.ts:104-110` detects `secFetchSite === 'cross-site'` and mismatched `Origin` host | Rejects prior to auth or state mutation |
| 3 | Live verification via `curl` returned HTTP `403`: `{"error":"CSRF_BLOCKED","message":"Solicitud cross-site bloqueada por política de origen."}` | **Blocked Safely** |

#### Conclusion
**Fix Verified** - Cross-origin cookie mutations from external sites are rejected with HTTP 403 before touching server state.

---

### Automated Unit, Integration, Concurrency & Benchmark Verification

#### Summary
| Field | Value |
|---|---|
| Issue Type | Anti-Raid Detector Isolation, Sanction Lifecycle, Sync Versioning & Concurrency Integrity |
| Impact | High |
| Affected File | `lib/aegis/antiraid-repair.test.ts` |
| Test Scenario | `npx tsx --test lib/aegis/*.test.ts` across all 56 unit, integration, concurrency, and 10k-iteration benchmark assertions |

#### Observed Verification Output
- **Test Suite**: `56/56` passed, `0` failed (`npx tsx --test lib/aegis/*.test.ts`), covering detector switch isolation, zero avatar penalty, `MONITORING` / `ALERT_ONLY` caps, Discord missing-permission cancellation (`attacksPrevented` unchanged), permanent `50013` non-retry, transient `429` retry + 30s idempotency deduplication, stale `syncVersion` rejection, 150-join `KeyedAsyncMutex` concurrency, and CSRF validation.
- **TypeScript Performance Benchmark (10,000 sequential evaluations)**: `251.84 ms` total (`39,708 ops/sec`), `p50 = 0.0183 ms`, `p95 = 0.0361 ms`, `p99 = 0.0966 ms`, `heapDelta = 7.69 MB`.
- **Health & Route Smoke Verification (`http://localhost:3000`)**: `GET /api/health/live` → `HTTP 200` (`{"live":true}`), `GET /api/health/ready` → `HTTP 200` (`ready: true`, `syncHealth.status: "SYNCHRONIZED"`), `/` and `/ruta-inexistente-test` rendered in headless Chromium with `0` React runtime errors.
