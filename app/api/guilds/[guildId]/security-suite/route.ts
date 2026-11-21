import { NextRequest, NextResponse } from 'next/server';
import { isPaidTier, normalizePlanTier } from '@/lib/aegis/premium';
import { securitySuitePatchSchema } from '@/lib/aegis/validators';
import { requireAuthenticatedUser, requireGuildAuthorization } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';
import type { AntiRaidRuleKey } from '@/lib/aegis/types';

function computeAutoModRulesUsed(suite: {
  additionalSecurity: {
    antiInvites: boolean;
    antiLinks: { enabled: boolean };
    antiScam: { enabled: boolean };
    antiFlood: { enabled: boolean };
    antiWebhookSpam: boolean;
    antiEveryonePerms: boolean;
  };
}): number {
  let count = 0;
  if (suite.additionalSecurity.antiInvites) count += 1;
  if (suite.additionalSecurity.antiLinks.enabled) count += 1;
  if (suite.additionalSecurity.antiScam.enabled) count += 1;
  if (suite.additionalSecurity.antiFlood.enabled) count += 1;
  if (suite.additionalSecurity.antiWebhookSpam) count += 1;
  if (suite.additionalSecurity.antiEveryonePerms) count += 1;
  return Math.min(6, count);
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:read');
  if (!guard.ok) return guard.response;

  const { state } = auth.ctx;
  const suite = state.guildSecuritySuites[guildId];
  const plan = state.guildPlans[guildId];

  return NextResponse.json({
    guild: guard.guild,
    suite,
    plan,
    autoModRulesUsed: computeAutoModRulesUsed(suite),
    autoModRulesLimit: 6,
    backupsCount: (state.guildBackups[guildId] ?? []).length,
    whitelistUsersCount: state.whitelists.filter(
      (w) => w.guildId === guildId && w.status === 'ACTIVE'
    ).length,
    secondaryOwner: state.secondaryOwners[guildId] ?? null,
  });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = securitySuitePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const suite = state.guildSecuritySuites[guildId];
  const plan = state.guildPlans[guildId];
  const isPremium = isPaidTier(normalizePlanTier(plan.tier));
  const patch = parsed.data;

  // Enforce Premium lock server-side when attempting to enable Premium-only modules
  if (patch.antiRaidModules) {
    for (const [k, rulePatch] of Object.entries(patch.antiRaidModules)) {
      if (!rulePatch) continue;
      const key = k as AntiRaidRuleKey;
      const currentRule = suite.antiRaidModules[key];
      if (currentRule.premiumOnly && !isPremium && rulePatch.enabled) {
        return NextResponse.json(
          {
            error: 'PREMIUM_REQUIRED',
            message: 'Esta función avanzada requiere el plan AEGIS Premium activo en el servidor.',
          },
          { status: 402 }
        );
      }
      suite.antiRaidModules[key] = {
        ...currentRule,
        enabled: rulePatch.enabled ?? currentRule.enabled,
        actionsPerMinute: rulePatch.actionsPerMinute ?? currentRule.actionsPerMinute,
      };
    }
  }

  if (patch.punishmentAction) {
    suite.punishmentAction = patch.punishmentAction;
  }

  if (patch.additionalSecurity) {
    const a = patch.additionalSecurity;
    if (a.antiMassMute?.enabled && !isPremium) {
      return NextResponse.json(
        {
          error: 'PREMIUM_REQUIRED',
          message: 'Anti Mass Mute requiere el plan AEGIS Premium activo en el servidor.',
        },
        { status: 402 }
      );
    }

    if (typeof a.banMaliciousUsers === 'boolean') {
      suite.additionalSecurity.banMaliciousUsers = a.banMaliciousUsers;
    }
    if (a.antiFlood) {
      if (
        !isPremium &&
        (a.antiFlood.maxMessages !== undefined ||
          a.antiFlood.windowSeconds !== undefined ||
          a.antiFlood.muteMinutes !== undefined)
      ) {
        return NextResponse.json(
          {
            error: 'PREMIUM_REQUIRED',
            message: 'Personalizar parámetros de Anti Flood requiere AEGIS Premium.',
          },
          { status: 402 }
        );
      }
      suite.additionalSecurity.antiFlood = {
        ...suite.additionalSecurity.antiFlood,
        ...a.antiFlood,
      };
    }
    if (a.antiScam) {
      if (!isPremium && a.antiScam.muteMinutes !== undefined) {
        return NextResponse.json(
          {
            error: 'PREMIUM_REQUIRED',
            message: 'Personalizar la duración del mute en Anti Scam requiere AEGIS Premium.',
          },
          { status: 402 }
        );
      }
      suite.additionalSecurity.antiScam = {
        ...suite.additionalSecurity.antiScam,
        ...a.antiScam,
      };
    }
    if (typeof a.antiEveryonePerms === 'boolean') {
      suite.additionalSecurity.antiEveryonePerms = a.antiEveryonePerms;
    }
    if (typeof a.antiWebhookSpam === 'boolean') {
      suite.additionalSecurity.antiWebhookSpam = a.antiWebhookSpam;
    }
    if (a.antiMassMute) {
      suite.additionalSecurity.antiMassMute = {
        ...suite.additionalSecurity.antiMassMute,
        ...a.antiMassMute,
      };
    }
    if (a.antiAlts) {
      suite.additionalSecurity.antiAlts = {
        ...suite.additionalSecurity.antiAlts,
        ...a.antiAlts,
      };
    }
    if (a.antiBots) {
      suite.additionalSecurity.antiBots = a.antiBots;
    }
    if (typeof a.antiInvites === 'boolean') {
      suite.additionalSecurity.antiInvites = a.antiInvites;
    }
    if (a.antiLinks) {
      if (!isPremium && a.antiLinks.allowedDomains !== undefined) {
        return NextResponse.json(
          {
            error: 'PREMIUM_REQUIRED',
            message: 'La whitelist de dominios en Anti Links requiere AEGIS Premium (Plan Oro o Diamante).',
          },
          { status: 402 }
        );
      }
      if (
        a.antiLinks.allowedDomains &&
        a.antiLinks.allowedDomains.length > plan.quotas.maxAllowedDomains
      ) {
        return NextResponse.json(
          {
            error: 'QUOTA_EXCEEDED',
            message: `Has alcanzado el límite de ${plan.quotas.maxAllowedDomains} dominios permitidos en el plan ${plan.tier}.`,
          },
          { status: 402 }
        );
      }
      suite.additionalSecurity.antiLinks = {
        ...suite.additionalSecurity.antiLinks,
        ...a.antiLinks,
      };
    }
  }

  suite.updatedAt = new Date().toISOString();

  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'SECURITY_SUITE_UPDATED',
    entityType: 'GuildSecuritySuite',
    entityId: guildId,
    result: 'SUCCESS',
    metadata: {
      punishmentAction: suite.punishmentAction,
      autoModRulesUsed: computeAutoModRulesUsed(suite),
    },
  });

  await aegisStore.commitMutation('security_suite:updated', guildId, { suite });
  return NextResponse.json({
    suite,
    plan,
    autoModRulesUsed: computeAutoModRulesUsed(suite),
    autoModRulesLimit: 6,
  });
}
