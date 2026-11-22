# AEGIS SECURITY — Deployment & Operations Guide (Pterodactyl Multi-Container)

## 1. Arquitectura Multi-Contenedor (3 Servicios Independientes)

AEGIS SECURITY opera de forma desacoplada en **tres contenedores independientes** sobre **MongoDB** (fuente de verdad persistente) y **Redis** (Pub/Sub de baja latencia, bloqueo distribuido, ventanas deslizantes y heartbeat):

| Contenedor | Comando de Arranque | Punto de Entrada | Responsabilidad Exclusiva |
| :--- | :--- | :--- | :--- |
| **1. Web & API** | `npm run start:api` | Next.js Production Server (`:3000`) | Dashboard UI, API REST, OAuth2 PKCE, SSE Stream. **No abre conexión Gateway** (`AEGIS_EMBEDDED_BOT` sin activar). |
| **2. Discord Bot** | `npm run start:bot` | `services/bot/index.ts` (`tsx`) | **Propietario único** del Gateway WebSocket (`AEGIS_STANDALONE_BOT=true`), bloqueo `aegis:bot:gateway_owner`, motor Anti-Raid/Anti-Nuke, Components V2 y Slash Commands. |
| **3. Worker** | `npm run start:worker` | `services/worker/index.ts` (`tsx`) | Expiración de Global Bans / Cuarentenas, Backups automáticos por plan, vaciado de Outbox (`SyncOutboxModel`) con lock distribuido `aegis:worker:cycle_lock`. |

> **Regla Crítica**: Nunca compartas almacenamiento local (`data/store.json`) entre contenedores como fuente de verdad. En producción, `MONGODB_URI` y `REDIS_URL` sincronizan las configuraciones versionadas (`GuildConfigModel.syncVersion`) entre los tres procesos en milisegundos.

---

## 2. Variables de Entorno Obligatorias

Configura las mismas credenciales compartidas en los **3 contenedores** de Pterodactyl (nunca subas `.env` al repositorio):

```env
# Base de datos y Sincronización Compartida
MONGODB_URI=mongodb+srv://...
REDIS_URL=redis://:password@host:6379

# Discord OAuth2 & Bot Gateway
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_BOT_TOKEN=...
DISCORD_REDIRECT_URI=https://tu-dominio.com/api/auth/callback

# Seguridad y Sesión
SESSION_SECRET=minimo-32-caracteres-aleatorios-seguros
NEXT_PUBLIC_APP_URL=https://tu-dominio.com
AEGIS_OWNER_DISCORD_ID=1052422681569525792

# Aislamiento de Gateway (OBLIGATORIO en Multi-Contenedor)
# Contenedor Bot: true | Contenedores Web y Worker: false / omitido
AEGIS_STANDALONE_BOT=true   # Solo en Contenedor 2 (Bot)
AEGIS_EMBEDDED_BOT=false    # En Contenedor 1 (Web/API)
```

---

## 3. Instalación Inicial y Comandos en Pterodactyl

> Gestor de paquetes estándar del proyecto: **npm** (`tsx` declarado en `dependencies` para ejecutar Bot y Worker de forma reproducible sin descargas interactivas).

1. **Contenedor 1 — Web Panel & API**
   - Build / Install: `npm ci && npm run build`
   - Startup: `npm run start:api`
2. **Contenedor 2 — Discord Bot**
   - Install: `npm ci`
   - Startup: `AEGIS_STANDALONE_BOT=true npm run start:bot`
3. **Contenedor 3 — Background Worker**
   - Install: `npm ci`
   - Startup: `npm run start:worker`

---

## 4. Configuración en Discord Developer Portal

1. **Privileged Gateway Intents** (`Bot -> Privileged Gateway Intents`):
   - **Server Members Intent (`GuildMembers`)**: OBLIGATORIO para recibir `GuildMemberAdd` y evaluar Anti-Raid/GlobalBan.
   - **Message Content Intent** (`GuildMessages` + contenido si moderas enlaces/scam/flood).
2. **OAuth2 Redirects**:
   - Agrega tu URL pública exacta `<NEXT_PUBLIC_APP_URL>/api/auth/callback`.
3. **Permisos del Bot al Invitar**:
   - Scopes: `bot` + `applications.commands`
   - Permisos requeridos: `ManageGuild`, `ManageChannels`, `ManageRoles`, `KickMembers`, `BanMembers`, `ModerateMembers`, `ManageMessages`, `ManageWebhooks`, `ViewAuditLog`.
   - **Jerarquía**: Coloca el rol de **AEGIS SECURITY** por encima de los roles de moderadores y usuarios que deban ser sancionados o puestos en cuarentena.

---

## 5. Healthchecks, Actualizaciones, Migraciones y Rollback

### Endpoints de Salud (Solo Lectura — nunca inician bots secundarios)
- **Liveness Probe**: `GET /api/health/live` → `{ live: true }` (HTTP 200).
- **Readiness Probe**: `GET /api/health/ready` → Verifica MongoDB, Redis, Outbox (`SyncOutboxModel`) y heartbeat del bot (`aegis:bot:heartbeat` en Redis). Responde HTTP 503 cuando MongoDB está desconectado (si está configurado) o cuando faltan subsistemas críticos.

### Procedimiento de Actualización (Zero-Surprise)
1. Verificar pruebas y compilación antes de desplegar: `npm run test:unit && npm run build`.
2. Detener ordenadamente los contenedores (**Worker** → **Discord Bot** → **Web/API**) para que `SIGINT`/`SIGTERM` libere los locks distribuidos en Redis (`aegis:bot:gateway_owner`, `aegis:worker:cycle_lock`).
3. Actualizar el código y ejecutar `npm ci && npm run build` (Web). Las colecciones MongoDB (`AegisSnapshot`, `GuildConfig`, `SyncOutbox`, `SanctionLedger`, `AuditLog`, `GlobalBan`) son retrocompatibles por versión (`syncVersion`).
4. Iniciar **Bot** → **Worker** → **Web/API**. Al arrancar, el Bot reconcilia todas las configuraciones desde MongoDB automáticamente.

### Recuperación ante Fallos y Rollback
- **Desconexión de Redis**: Web/API guarda la mutación en MongoDB (`GuildConfigModel`) y registra una entrada `PENDING` en `SyncOutboxModel`. Al reconectar Redis, `onReconnect` y el ciclo periódico (60s) vacían el Outbox y reconcilian versiones (`syncVersion`).
- **Rollback**: Hacer checkout al commit anterior, correr `npm ci && npm run build` y reiniciar los 3 contenedores. Los datos de MongoDB conservan compatibilidad con el esquema `AegisSnapshot` y `GuildConfig`.

### Logs y Rotación
- Los servicios emiten logs JSON estructurados con `correlationId`, nivel (`DEBUG|INFO|WARN|ERROR|FATAL`) y redacción automática de tokens/secretos hacia `stdout`/`stderr`. En Pterodactyl, configura la rotación de consola del daemon Wings (`docker` log driver `max-size: 25m`, `max-file: 5`) para evitar crecimiento ilimitado en disco.
