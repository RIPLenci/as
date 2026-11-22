import type {
  GlobalBanAnalyticsResponse,
  IncidentStatus,
  OverviewAnalyticsResponse,
  OverviewPeriod,
  SecurityIncidentRecord,
  SystemHealthSnapshot,
} from '../aegis/types';
import type { PersistedDatabaseState } from './store-defaults';

export function computeOverviewAnalytics(
  state: PersistedDatabaseState,
  systemHealth: SystemHealthSnapshot,
  period: OverviewPeriod,
  guildId?: string,
  authorizedGuildIds?: string[]
): OverviewAnalyticsResponse {
  const periodHoursMap: Record<OverviewPeriod, number> = {
    '24h': 24,
    '7d': 24 * 7,
    '30d': 24 * 30,
    '90d': 24 * 90,
  };
  const hours = periodHoursMap[period];
  const nowMs = Date.now();
  const currentCutoff = nowMs - hours * 3600_000;
  const prevCutoff = nowMs - hours * 2 * 3600_000;

  const allowedSet = authorizedGuildIds ? new Set(authorizedGuildIds) : null;
  const matchesScope = (targetGuildId: string) => {
    if (guildId) return targetGuildId === guildId;
    if (allowedSet) return allowedSet.has(targetGuildId);
    return false;
  };

  const scopedIncidents = state.incidents.filter((i) => matchesScope(i.guildId));
  const currentIncidents = scopedIncidents.filter(
    (i) => new Date(i.createdAt).getTime() >= currentCutoff
  );
  const prevIncidents = scopedIncidents.filter((i) => {
    const t = new Date(i.createdAt).getTime();
    return t >= prevCutoff && t < currentCutoff;
  });

  const calcDelta = (curr: number, prev: number): number | null => {
    if (prev === 0) return null;
    return Number((((curr - prev) / prev) * 100).toFixed(1));
  };

  const isRaid = (t: SecurityIncidentRecord['threatType']) =>
    t === 'JOIN_RAID' || t === 'COORDINATED_ACTIVITY';
  const isMitigated = (s: IncidentStatus) => s === 'MITIGATED' || s === 'RESOLVED';

  const currRaids = currentIncidents.filter((i) => isRaid(i.threatType)).length;
  const prevRaids = prevIncidents.filter((i) => isRaid(i.threatType)).length;

  const currPrevented = currentIncidents.filter((i) => isMitigated(i.status)).length;
  const prevPrevented = prevIncidents.filter((i) => isMitigated(i.status)).length;

  const currSuspicious = currentIncidents.filter(
    (i) => i.threatType === 'SUSPICIOUS_ACCOUNT_WAVE' || i.threatType === 'BOT_INFILTRATION'
  ).length;
  const prevSuspicious = prevIncidents.filter(
    (i) => i.threatType === 'SUSPICIOUS_ACCOUNT_WAVE' || i.threatType === 'BOT_INFILTRATION'
  ).length;

  const currCritical = currentIncidents.filter((i) => i.riskLevel === 'CRITICAL').length;
  const prevCritical = prevIncidents.filter((i) => i.riskLevel === 'CRITICAL').length;

  const scopedQuarantines = state.quarantines.filter((q) => matchesScope(q.guildId));
  const activeQuarantined = scopedQuarantines.filter((q) => q.status === 'ACTIVE').length;
  const prevQuarantined = scopedQuarantines.filter((q) => {
    const t = new Date(q.createdAt).getTime();
    return t >= prevCutoff && t < currentCutoff;
  }).length;

  const scopedGuilds = Object.values(state.guilds).filter((g) => matchesScope(g.guildId));
  const activeGuilds = scopedGuilds.filter(
    (g) => g.protectionEnabled && g.botStatus === 'BOT_CONNECTED'
  ).length;

  const bucketCount = period === '24h' ? 8 : period === '7d' ? 7 : period === '30d' ? 10 : 12;
  const bucketMs = (hours * 3600_000) / bucketCount;
  const securityActivity = Array.from({ length: bucketCount }, (_, idx) => {
    const bucketStart = currentCutoff + idx * bucketMs;
    const bucketEnd = bucketStart + bucketMs;
    const dt = new Date(bucketEnd);
    const label =
      period === '24h'
        ? `${String(dt.getHours()).padStart(2, '0')}:00`
        : `${dt.getDate()}/${dt.getMonth() + 1}`;

    const isLastBucket = idx === bucketCount - 1;
    const inBucket = currentIncidents.filter((inc) => {
      const ts = new Date(inc.createdAt).getTime();
      return ts >= bucketStart && (isLastBucket ? ts <= bucketEnd : ts < bucketEnd);
    });

    return {
      label,
      detectedRaids: inBucket.filter((i) => isRaid(i.threatType)).length,
      preventedAttacks: inBucket.filter((i) => isMitigated(i.status)).length,
      suspiciousJoins: inBucket.filter(
        (i) =>
          i.threatType === 'SUSPICIOUS_ACCOUNT_WAVE' ||
          i.threatType === 'BOT_INFILTRATION'
      ).length,
      criticalEvents: inBucket.filter((i) => i.riskLevel === 'CRITICAL').length,
    };
  });

  const raidAttemptsCount = currentIncidents.filter((i) => isRaid(i.threatType)).length;
  const suspiciousAccountsCount = currentIncidents.filter(
    (i) => i.threatType === 'SUSPICIOUS_ACCOUNT_WAVE' || i.threatType === 'BOT_INFILTRATION'
  ).length;
  const quarantinedUsersCount = scopedQuarantines.filter(
    (q) => new Date(q.createdAt).getTime() >= currentCutoff
  ).length;

  const totalDist = Math.max(
    1,
    raidAttemptsCount + suspiciousAccountsCount + quarantinedUsersCount
  );

  const toPct = (c: number) => Number(((c / totalDist) * 100).toFixed(1));

  return {
    period,
    metrics: {
      totalRaidsDetected: {
        key: 'totalRaidsDetected',
        value: currRaids,
        deltaPercent: calcDelta(currRaids, prevRaids),
        comparisonNote: `${prevRaids} vs ${period}`,
      },
      attacksPrevented: {
        key: 'attacksPrevented',
        value: currPrevented,
        deltaPercent: calcDelta(currPrevented, prevPrevented),
        comparisonNote: `${prevPrevented} vs ${period}`,
      },
      suspiciousJoins: {
        key: 'suspiciousJoins',
        value: currSuspicious,
        deltaPercent: calcDelta(currSuspicious, prevSuspicious),
        comparisonNote: `${prevSuspicious} vs ${period}`,
      },
      criticalIncidents: {
        key: 'criticalIncidents',
        value: currCritical,
        deltaPercent: calcDelta(currCritical, prevCritical),
        comparisonNote: `${prevCritical} vs ${period}`,
      },
      usersQuarantined: {
        key: 'usersQuarantined',
        value: activeQuarantined,
        deltaPercent: calcDelta(activeQuarantined, prevQuarantined),
        comparisonNote: `${scopedQuarantines.length} registros`,
      },
      activeProtection: {
        key: 'activeProtection',
        value: activeGuilds,
        deltaPercent: null,
        comparisonNote: `${scopedGuilds.length} servidor(es)`,
      },
      globalBansApplied: {
        key: 'globalBansApplied',
        value: 0,
        deltaPercent: null,
        comparisonNote: '',
      },
      participatingServers: {
        key: 'participatingServers',
        value: 0,
        deltaPercent: null,
        comparisonNote: '',
      },
    },
    securityActivity,
    threatDistribution: [
      {
        key: 'RAID_ATTEMPTS',
        count: raidAttemptsCount,
        percentage: toPct(raidAttemptsCount),
      },
      {
        key: 'SUSPICIOUS_ACCOUNTS',
        count: suspiciousAccountsCount,
        percentage: toPct(suspiciousAccountsCount),
      },
      {
        key: 'QUARANTINED_USERS',
        count: quarantinedUsersCount,
        percentage: toPct(quarantinedUsersCount),
      },
    ],
    recentIncidents: scopedIncidents.slice(0, 20),
    systemHealth,
  };
}

export function computeGlobalBanAnalytics(
  state: PersistedDatabaseState
): GlobalBanAnalyticsResponse {
  const now = Date.now();
  const weekMs = 7 * 86_400_000;
  const monthAgo = now - 30 * 86_400_000;

  const active = state.globalBans.filter((b) => b.status === 'ACTIVE');
  const permanent = state.globalBans.filter((b) => b.sanctionType === 'PERMANENT');
  const temporary = state.globalBans.filter((b) => b.sanctionType === 'TEMPORARY');
  const expiringSoon = active.filter(
    (b) => b.expiresAt && new Date(b.expiresAt).getTime() - now <= weekMs
  );
  const thisMonth = state.globalBans.filter(
    (b) => new Date(b.createdAt).getTime() >= monthAgo
  );

  const activitySeries = Array.from({ length: 6 }, (_, idx) => {
    const sliceDays = 30 - idx * 5;
    const start = now - sliceDays * 86_400_000;
    const end = now - (sliceDays - 5) * 86_400_000;
    const dt = new Date(end);
    const label = `${dt.getMonth() + 1}/${dt.getDate()}`;
    return {
      label,
      created: state.globalBans.filter((b) => {
        const t = new Date(b.createdAt).getTime();
        return t >= start && t < end;
      }).length,
      revoked: state.globalBans.filter((b) => {
        if (!b.revokedAt) return false;
        const t = new Date(b.revokedAt).getTime();
        return t >= start && t < end;
      }).length,
      expired: state.globalBans.filter((b) => {
        if (b.status !== 'EXPIRED' || !b.expiresAt) return false;
        const t = new Date(b.expiresAt).getTime();
        return t >= start && t < end;
      }).length,
    };
  });

  return {
    cards: {
      totalGlobalBans: state.globalBans.length,
      activeSanctions: active.length,
      permanentBans: permanent.length,
      temporaryBans: temporary.length,
      pendingAppeals: state.appeals.filter(
        (a) => a.status === 'PENDING' || a.status === 'REVIEWING'
      ).length,
      participatingServers: Object.values(state.participatingServers).filter(
        (p) => p.globalBanEnabled
      ).length,
      expiringSoon: expiringSoon.length,
      sanctionsThisMonth: thisMonth.length,
    },
    activitySeries,
    typeBreakdown: {
      permanent: permanent.length,
      temporary: temporary.length,
    },
    appealsBreakdown: {
      pending: state.appeals.filter((a) => a.status === 'PENDING').length,
      reviewing: state.appeals.filter((a) => a.status === 'REVIEWING').length,
      approved: state.appeals.filter((a) => a.status === 'APPROVED').length,
      rejected: state.appeals.filter((a) => a.status === 'REJECTED').length,
    },
  };
}
