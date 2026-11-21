# AEGIS SECURITY — Discord Slash Commands & Components V2

All bot panels use native **Discord Components V2** (`MessageFlags.IsComponentsV2`, `ContainerBuilder`, `SectionBuilder`, `TextDisplayBuilder`, `SeparatorBuilder`, `ButtonBuilder`) rendered exclusively in Spanish/English security copy with **zero emojis**.

---

## Registered Command Groups (`services/bot/commands/registry.ts`)

1. **`/antiraid`** (`ManageGuild`)
   - `enable`: Activates guild Anti-Raid protection and notifies `aegis:sync`.
   - `disable`: Disables guild Anti-Raid protection.
   - `status`: Displays live synchronization state, thresholds, and stats.
   - `mode <NORMAL|STRICT|EMERGENCY>`: Switches non-indiscriminate protection posture.
   - `config [max_joins] [window_seconds] [min_account_age_days]`: Updates sliding-window thresholds.
   - `test`: Runs a live Risk Engine diagnostic probe without mutating production members.

2. **`/antinuke`** (`Administrator`)
   - `enable` / `disable`: Toggles audit-log Anti-Nuke defense.
   - `status`: Shows channel/role/webhook/ban thresholds and auto-response posture.
   - `config`: Updates deletion, role mutation, and mass-ban thresholds.

3. **`/quarantine`** (`ModerateMembers`)
   - `add <user> <reason> [hours]`: Preserves previous roles, isolates member, logs incident.
   - `release <user>`: Releases member from quarantine cleanly.
   - `list`: Displays active quarantined accounts in the server.

4. **`/lockdown`** (`ManageChannels`)
   - `start <reason> [minutes]`: Captures pre-lockdown permission snapshots and restricts `@everyone`.
   - `end`: Restores only AEGIS-managed channel permission overwrites.
   - `status`: Shows active lockdown state and affected channel snapshot count.

5. **`/whitelist`** (`ManageGuild`)
   - `add <target_id> <type> <reason>`: Adds rule-scoped exception (`JOIN_BURST`).
   - `remove <entry_id>`: Revokes an active whitelist entry.
   - `list`: Lists rule-scoped active exemptions.

6. **`/globalban`** (Restricted to Global Moderators / Global Administrators / Owner)
   - `add <discord_id> <username> <sanction_type> <reason> <evidence>`: Issues a verified Global Ban.
   - `check <discord_id>`: Inspects active Global Ban status for a Discord ID.
   - `revoke <ban_id> <reason>`: Non-destructively revokes a sanction while keeping history.
   - `info <ban_id>`: Opens full sanction dossier & audit trail.

7. **`/aegis`** (`ManageGuild`)
   - `status`: Displays Bot Gateway latency, MongoDB, Redis, and guild sync telemetry.
   - `setup <alert_channel>`: Configures the guild's batched security alert channel.
   - `sync`: Forces immediate policy synchronization across Redis & disk/MongoDB store.
