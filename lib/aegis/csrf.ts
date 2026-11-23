export interface CsrfCheckInput {
  method: string;
  authorization?: string | null;
  secFetchSite?: string | null;
  origin?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
  appUrl?: string | null;
}

export interface CsrfCheckResult {
  allowed: boolean;
  reason?: string;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function evaluateMutationCsrf(input: CsrfCheckInput): CsrfCheckResult {
  if (SAFE_METHODS.has(input.method.toUpperCase())) {
    return { allowed: true };
  }

  if (input.authorization && input.authorization.toLowerCase().startsWith('bearer ')) {
    return { allowed: true };
  }

  if (input.secFetchSite === 'cross-site') {
    return {
      allowed: false,
      reason: 'Solicitud cross-site bloqueada por política de origen.',
    };
  }

  if (!input.origin) {
    return { allowed: true };
  }

  try {
    const originHost = new URL(input.origin).host.toLowerCase();
    const expectedHosts = new Set<string>();
    const rawHost = input.forwardedHost || input.host;
    if (rawHost) {
      expectedHosts.add(rawHost.split(',')[0].trim().toLowerCase());
    }
    if (input.appUrl) {
      expectedHosts.add(new URL(input.appUrl).host.toLowerCase());
    }
    if (expectedHosts.size > 0 && !expectedHosts.has(originHost)) {
      return {
        allowed: false,
        reason: 'Origen de solicitud no autorizado.',
      };
    }
    return { allowed: true };
  } catch {
    return {
      allowed: false,
      reason: 'Cabecera Origin inválida.',
    };
  }
}
