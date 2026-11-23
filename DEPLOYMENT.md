# AEGIS SECURITY — Deployment & Operations Guide (Pterodactyl Multi-Container)

## 1. Arquitectura Multi-Contenedor (3 Servicios Independientes)

AEGIS SECURITY opera de forma desacoplada en **tres contenedores independientes** sobre **MongoDB** (fuente de verdad persistente) y **Redis** (Pub/Sub de baja latencia, bloqueo distribuido con fencing tokens atómicos, rate limiting compartido, sesiones OAuth2 compartidas y heartbeats):

| Contenedor | Comando de Arranque | Punto de Entrada | Responsabilidad Exclusiva |
| :--- | :--- | :--- | :--- |
| **1. Web & API** | `npm run start:api` | Next.js Production Server (`:3000`) | Dashboard UI, API REST, Middleware CSRF (`/api/*`), OAuth2 PKCE, SSE Stream. **No abre conexión Gateway** (`AEGIS_EMBEDDED_BOT=false`). |
| **2. Discord Bot** | `npm run start:bot` | `services/bot/index.ts` (`tsx`) | **Propietario único** del Gateway WebSocket (`AEGIS_STANDALONE_BOT=true`), bloqueo distribuido fail-closed `aegis:bot:gateway_owner` con fencing token monotónico, motor Anti-Raid/Anti-Nuke, Components V2, Slash Commands y `/healthz` en `BOT_HEALTH_PORT`. |
| **3. Worker** | `npm run start:worker` | `services/worker/index.ts` (`tsx`) | Expiración idempotente de Global Bans / Cuarentenas / Premium, Backups automáticos por plan, vaciado atómico de Outbox (`SyncOutboxModel`) con bloqueo distribuido `aegis:worker:cycle_lock` y persistencia en `WorkerJobState`. |

> **Regla Crítica**: Los contenedores **no comparten archivos locales** (`.aegis-data/store.json`). En producción multi-contenedor, `MONGODB_URI` y `REDIS_URL` sincronizan configuraciones versionadas (`GuildConfigModel.syncVersion`), outbox, revocación de sesiones y tokens OAuth2 en milisegundos.

---

## 2. Variables de Entorno Exactas (`.env.example` / `lib/server/env.ts`)

Configura estas variables compartidas en los **3 contenedores** de Pterodactyl (nunca subas credenciales reales al repositorio):

```env
NODE_ENV=production
PORT=3000

# URLs de Hosting y OAuth2
APP_URL=https://tu-dominio.com
DASHBOARD_URL=https://tu-dominio.com
API_URL=https://tu-dominio.com/api
FRONTEND_URL=https://tu-dominio.com
NEXT_PUBLIC_APP_URL=https://tu-dominio.com   # Alias opcional retrocompatible de APP_URL

# Discord Application & Gateway
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_REDIRECT_URI=https://tu-dominio.com/api/auth/callback
DISCORD_BOT_TOKEN=...
DISCORD_BOT_INVITE_URL=

# Base de Datos y Caché Compartida (Obligatorios en Multi-Contenedor)
MONGODB_URI=mongodb+srv://...
REDIS_URL=redis://:password@host:6379

# Aislamiento de Contenedores y Liderazgo Fail-Closed
AEGIS_STANDALONE_BOT=true          # true SOLO en Contenedor 2 (Bot); false en Web y Worker
AEGIS_EMBEDDED_BOT=false           # false en Contenedor 1 (Web/API)
AEGIS_REQUIRE_DISTRIBUTED_LOCK=true # Fail-closed: exige Redis activo para tomar liderazgo Gateway/Worker
AEGIS_LOCAL_SINGLE_INSTANCE=false  # false en producción multi-contenedor
DISCORD_ENABLE_MESSAGE_CONTENT=false # true solo si habilitas Anti-Flood / Anti-Scam / Anti-Links en Discord Developer Portal
DISCORD_SHARD_COUNT=auto
BOT_HEALTH_PORT=3099               # Endpoint /healthz local para el contenedor Bot
WORKER_MAX_CONCURRENCY=4           # Concurrencia máxima controlada en Worker (1..32)
WORKER_INTERVAL_MS=60000           # Intervalo del ciclo Worker (>= 5000 ms)

# Seguridad, Sesiones y Encriptación de Tokens OAuth en Redis
SESSION_SECRET=minimo-32-caracteres-aleatorios-seguros
ENCRYPTION_KEY=clave-32-bytes-aes256-gcm-para-tokens-en-redis

# Gobernanza Inicial (Snowflakes separados por coma)
OWNER_IDS=1052422681569525792
AEGIS_OWNER_DISCORD_ID=1052422681569525792 # Alias retrocompatible de OWNER_IDS
GLOBAL_ADMIN_IDS=

# Diagnóstico y Logs
LOG_LEVEL=info
```

---

## 3. Instalación Inicial y Comandos en Pterodactyl

> Gestor de paquetes estándar del proyecto: **npm** (`tsx` declarado en `dependencies`). Nunca mezcles pnpm/yarn ni omitas `npm ci`.

1. **Contenedor 1 — Web Panel & API**
   - Install: `npm ci && npm run build`
   - Startup (`AEGIS_EMBEDDED_BOT=false`, `AEGIS_STANDALONE_BOT=false`): `npm run start:api`
2. **Contenedor 2 — Discord Bot**
   - Install: `npm ci`
   - Startup (`AEGIS_STANDALONE_BOT=true`, `AEGIS_REQUIRE_DISTRIBUTED_LOCK=true`, `AEGIS_LOCAL_SINGLE_INSTANCE=false`): `npm run start:bot`
3. **Contenedor 3 — Background Worker**
   - Install: `npm ci`
   - Startup (`AEGIS_STANDALONE_BOT=false`, `AEGIS_REQUIRE_DISTRIBUTED_LOCK=true`): `npm run start:worker`

---

## 4. Configuración en Discord Developer Portal

1. **Privileged Gateway Intents** (`Bot -> Privileged Gateway Intents`):
   - **Server Members Intent (`GuildMembers`)**: OBLIGATORIO para recibir `GuildMemberAdd` y ejecutar Anti-Raid / GlobalBan.
   - **Message Content Intent**: Activar en Portal y fijar `DISCORD_ENABLE_MESSAGE_CONTENT=true` solo si se usan reglas de contenido (`Anti-Flood`, `Anti-Scam`, `Anti-Invites`, `Anti-Links`).
2. **OAuth2 Redirects**:
   - Agrega exactamente `<APP_URL>/api/auth/callback` (o `DISCORD_REDIRECT_URI`).
3. **Permisos e Intents del Bot**:
   - Scopes: `bot` + `applications.commands`.
   - Permisos mínimos: `ManageGuild`, `ManageChannels`, `ManageRoles`, `KickMembers`, `BanMembers`, `ModerateMembers`, `ManageMessages`, `ManageWebhooks`, `ViewAuditLog`.
   - **Jerarquía de Roles**: El rol más alto de **AEGIS SECURITY** debe situarse por encima de moderadores y usuarios objetivo; de lo contrario `SanctionExecutor` marcará la acción como `CANCELLED` por seguridad y sin falsificar estadísticas.

---

## 5. Healthchecks, Actualizaciones, Migraciones y Rollback

### Healthchecks (Solo Lectura)
- **Web/API Liveness**: `GET /api/health/live` → HTTP `200` `{ live: true }`.
- **Web/API Readiness**: `GET /api/health/ready` → Verifica MongoDB (`connected`), Redis (`CONNECTED`), Outbox pendiente (`SyncOutboxModel`), heartbeat del Bot (`aegis:bot:heartbeat`) y estado de liderazgo (`leaderState`). Devuelve HTTP `503` si la base de datos configurada o dependencias críticas están degradadas.
- **Bot Container Health**: `GET http://127.0.0.1:${BOT_HEALTH_PORT}/healthz` → Devuelve HTTP `200` cuando el cliente está listo y posee liderazgo `LEADER`, o `503` si está en `NO_LEADER` / `SHUTTING_DOWN`.

### Procedimiento de Actualización Ordenada
1. Verificar pruebas y build antes del despliegue: `npm run test:unit && npm run build`.
2. Detener en orden **Worker** → **Discord Bot** → **Web/API** para que `SIGINT`/`SIGTERM` completen tareas en curso, cierren el Gateway limpio y liberen `aegis:bot:gateway_owner` y `aegis:worker:cycle_lock` solo si pertenecen a la instancia saliente.
3. Desplegar código nuevo y ejecutar `npm ci && npm run build` en Web/API (y `npm ci` en Bot y Worker).
4. **Migraciones de esquema**: Los índices MongoDB (`ensureMongoConnected`) y las colecciones (`GuildConfig`, `SyncOutbox`, `SanctionLedger`, `GlobalBan`, `AuditLog`, `WorkerJobState`, `AegisSnapshot`) se auto-indexan al iniciar sin scripts destructivos.
5. Arrancar **Discord Bot** → **Worker** → **Web/API**. Al conectar, el Bot reconcilia configuraciones por `syncVersion` desde MongoDB automáticamente.

### Recuperación ante Fallos, Rollback y Logs
- **Pérdida de Redis en caliente**: El Gateway Bot detecta fallo al verificar/renovar su lock (`NO_LEADER`), aborta tareas críticas, cierra el Gateway y espera recuperación de Redis para re-adquirir liderazgo con un **fencing token** superior. Web/API persiste cambios en MongoDB + `SyncOutboxModel` (`PENDING`), y tanto `onReconnect` como Worker vacían el Outbox mediante reclamo atómico de leases + backoff exponencial con jitter.
- **Rollback**: Hacer `git checkout <commit_anterior>`, correr `npm ci && npm run build` en Web/API y reiniciar **Bot → Worker → Web/API**.
- **Rotación de Logs**: Los servicios escriben logs JSON estructurados con `correlationId` y redacción automática de secretos hacia `stdout`/`stderr` y archivos rotados (`MAX_LOG_FILE_BYTES = 5MB`, hasta 5 archivos en `.aegis-data/logs/`). Configura adicionalmente log rotation en Pterodactyl Wings (`max-size: 25m`, `max-file: 5`).
