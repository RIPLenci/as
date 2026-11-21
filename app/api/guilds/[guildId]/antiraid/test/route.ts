import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { evaluateJoinRisk } from '@/lib/aegis/risk-engine';
import { requireAuthenticatedUser, requireGuildAuthorization } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';

const testSchema = z.object({
  simulatedJoins: z.number().int().min(1).max(50).default(12),
  accountAgeDays: z.number().int().min(0).max(1000).default(1),
  similarUsernameCount: z.number().int().min(1).max(50).default(5),
  hasAvatar: z.boolean().default(false),
  isBot: z.boolean().default(false),
  hasActiveGlobalBan: z.boolean().default(false),
  persistIncident: z.boolean().default(true),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({}));
  const parsed = testSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const config = state.antiRaidConfigs[guildId];
  if (!config) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const input = parsed.data;
  const evaluation = evaluateJoinRisk({
    accountAgeDays: input.accountAgeDays,
    isBot: input.isBot,
    hasAvatar: input.hasAvatar,
    joinsInWindow: input.simulatedJoins,
    maxJoinsThreshold: config.maxJoins,
    similarUsernameCount: input.similarUsernameCount,
    repetitiveJoinCount: input.simulatedJoins >= config.maxJoins ? 2 : 0,
    hasActiveGlobalBan: input.hasActiveGlobalBan,
    mode: config.mode,
    weights: config.riskWeights,
    rules: config.riskRules,
  });

  const nowIso = new Date().toISOString();
  const syntheticDiscordId = `999${Date.now().toString().slice(-15)}`;
  const syntheticUsername = `probe_node_${Date.now().toString().slice(-4)}`;

  if (input.persistIncident && evaluation.score >= config.riskThreshold) {
    const incidentId = `INC-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    config.eventsProcessed += input.simulatedJoins;
    config.attacksDetected += 1;
    config.attacksPrevented += 1;

    aegisStore.pushIncident(state, {
      id: incidentId,
      guildId,
      guildName: guard.guild.name,
      threatType: input.hasActiveGlobalBan ? 'GLOBAL_BAN_MATCH' : 'JOIN_RAID',
      riskScore: evaluation.score,
      riskLevel: evaluation.level,
      affectedUserId: syntheticDiscordId,
      affectedUsername: syntheticUsername,
      responsibleUserId: syntheticDiscordId,
      responsibleUsername: syntheticUsername,
      appliedAction: evaluation.recommendedAction,
      status: 'MITIGATED',
      assignedTo: user.username,
      evidenceSummary: `Diagnostic burst test: ${input.simulatedJoins} joins in ${config.timeWindowSeconds}s (threshold ${config.maxJoins}).`,
      signals: evaluation.signals,
      comments: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    aegisStore.pushEvent(state, {
      id: `EVT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      guildId,
      guildName: guard.guild.name,
      eventType: 'DIAGNOSTIC_RAID_PROBE',
      threatType: 'JOIN_RAID',
      targetDiscordId: syntheticDiscordId,
      targetUsername: syntheticUsername,
      riskScore: evaluation.score,
      riskLevel: evaluation.level,
      actionTaken: evaluation.recommendedAction,
      status: 'MITIGATED',
      createdAt: nowIso,
    });

    aegisStore.appendAuditLog(state, {
      guildId,
      actorId: user.discordId,
      actorName: user.username,
      action: 'ANTIRAID_DIAGNOSTIC_TEST_TRIGGERED',
      entityType: 'SecurityIncident',
      entityId: incidentId,
      result: 'SUCCESS',
      metadata: { score: evaluation.score, level: evaluation.level },
    });

    await aegisStore.commitMutation('incident:created', guildId, {
      incidentId,
      score: evaluation.score,
    });
  }

  return NextResponse.json({
    evaluation,
    threshold: config.riskThreshold,
    wouldTriggerAction: evaluation.score >= config.riskThreshold,
  });
}
