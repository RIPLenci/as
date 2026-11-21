import type { LanguageCode } from './types';

export type NavSectionId =
  | 'overview'
  | 'premium'
  | 'servers'
  | 'monitor'
  | 'incidents'
  | 'protection-overview'
  | 'additional-security'
  | 'bot-permissions'
  | 'join-protection'
  | 'anti-nuke'
  | 'risk-engine'
  | 'quarantine'
  | 'lockdown'
  | 'whitelist'
  | 'verification'
  | 'log-channel'
  | 'backups'
  | 'two-factor'
  | 'secondary-owner'
  | 'audit-logs'
  | 'admin-panel'
  | 'settings';

export interface TranslationDictionary {
  brandName: string;
  brandSubtitle: string;
  login: {
    title: string;
    subtitle: string;
    description: string;
    continueDiscord: string;
    linkingNoteTitle: string;
    linkingNote: string;
    securityNoticeTitle: string;
    securityNotice: string;
    welcomeBack: string;
    preparingWorkspace: string;
    retry: string;
  };
  navCategories: {
    general: string;
    antiRaid: string;
    system: string;
  };
  navItems: Record<NavSectionId, string>;
  header: {
    selectServer: string;
    searchPlaceholder: string;
    notifications: string;
    markAllRead: string;
    noNotifications: string;
    connectionOnline: string;
    connectionDegraded: string;
    connectionOffline: string;
    logout: string;
    language: string;
    theme: string;
    themeDark: string;
    themeLight: string;
    themeSystem: string;
  };
  periods: {
    '24h': string;
    '7d': string;
    '30d': string;
    '90d': string;
  };
  overview: {
    title: string;
    subtitle: string;
    cards: {
      totalRaidsDetected: string;
      attacksPrevented: string;
      suspiciousJoins: string;
      criticalIncidents: string;
      usersQuarantined: string;
      activeProtection: string;
      globalBansApplied: string;
      participatingServers: string;
    };
    securityActivityTitle: string;
    threatDistributionTitle: string;
    recentIncidentsTitle: string;
    systemStatusTitle: string;
    series: {
      detectedRaids: string;
      preventedAttacks: string;
      suspiciousJoins: string;
      criticalEvents: string;
    };
    distribution: {
      raidAttempts: string;
      suspiciousAccounts: string;
      quarantinedUsers: string;
      globalBanMatches: string;
    };
    infrastructure: {
      botStatus: string;
      apiStatus: string;
      mongodbStatus: string;
      redisStatus: string;
      lastSync: string;
      l1Cache: string;
    };
  };
  servers: {
    title: string;
    subtitle: string;
    addBot: string;
    verifyConnection: string;
    selectWorkspace: string;
    confirmedTitle: string;
    confirmedServer: string;
    confirmedBot: string;
    confirmedSecurity: string;
    confirmedReady: string;
    states: {
      BOT_CONNECTED: string;
      BOT_NOT_INSTALLED: string;
      INSUFFICIENT_PERMISSIONS: string;
      PROTECTION_ENABLED: string;
      PROTECTION_DISABLED: string;
    };
    membersLabel: string;
    membersUnknown: string;
    roles: {
      PROPIETARIO: string;
      'SEGUNDO DUEÑO': string;
      ADMINISTRADOR: string;
      MIEMBRO: string;
    };
    botStates: {
      ACTIVE: string;
      NOT_INSTALLED: string;
    };
    configureBot: string;
    manageBot: string;
    inviteBot: string;
    memberReadOnlyNote: string;
    priorities: {
      ownedBadge: string;
      ownedTitle: string;
      ownedDesc: string;
      adminBadge: string;
      adminTitle: string;
      adminDesc: string;
      inviteBadge: string;
      inviteTitle: string;
      inviteDesc: string;
      memberBadge: string;
      memberTitle: string;
      memberDesc: string;
    };
    welcomeTitle: string;
    welcomeSubtitle: string;
    filters: {
      all: string;
      owned: string;
      admin: string;
      invite: string;
    };
    syncingDiscord: string;
    syncDiscord: string;
    retry: string;
    loadingMessage: string;
    errorTitle: string;
  };
  botHub: {
    title: string;
    subtitle: string;
    onlineBadge: string;
    degradedBadge: string;
    offlineBadge: string;
    unconfiguredBadge: string;
    connectBot: string;
    connecting: string;
    connectSuccess: string;
    deployCommands: string;
    deploying: string;
    deploySuccess: string;
    rebootCluster: string;
    rebooting: string;
    rebootSuccess: string;
    ultraLowPing: string;
    clusterTitle: string;
    clusterDesc: string;
    shardsTitle: string;
    shardsDesc: string;
    slashTitle: string;
    slashDesc: string;
    measuresTitle: string;
    measuresDesc: string;
    subcommands: string;
    registeredGlobal: string;
    pingLatency: string;
    memoryAllocated: string;
    eventLoopLag: string;
    uptimeLabel: string;
    assignedGuilds: string;
  };
  common: {
    saveChanges: string;
    saving: string;
    savedConfirmed: string;
    cancel: string;
    confirm: string;
    refresh: string;
    exportJson: string;
    filter: string;
    all: string;
    search: string;
    noData: string;
    loading: string;
    actions: string;
    status: string;
    date: string;
    server: string;
    user: string;
    moderator: string;
    reason: string;
    evidence: string;
    riskScore: string;
    previous: string;
    next: string;
    enabled: string;
    disabled: string;
    insufficientRole: string;
    syncConfirmed: string;
  };
}

export const DICTIONARIES: Record<LanguageCode, TranslationDictionary> = {
  es: {
    brandName: 'AEGIS SECURITY',
    brandSubtitle: 'Sistema Avanzado de Protección Anti-Raid',
    login: {
      title: 'AEGIS SECURITY',
      subtitle: 'Protección avanzada para tu comunidad de Discord.',
      description:
        'Plataforma especializada de operaciones de seguridad: detección Anti-Raid en tiempo real, defensa Anti-Nuke, cuarentena automatizada y respaldo independiente por servidor.',
      continueDiscord: 'Continuar con Discord',
      linkingNoteTitle: 'Vinculación Verificada por OAuth2',
      linkingNote:
        'Autenticación oficial mediante Discord Authorization Code y PKCE. Solo solicitamos los permisos identify y guilds para verificar tu identidad y servidores administrados.',
      securityNoticeTitle: 'Arquitectura Zero-Trust',
      securityNotice:
        'Nunca solicitamos tu contraseña de Discord ni almacenamos tokens de acceso en el navegador. Las sesiones operan con cookies HttpOnly firmadas y verificación RBAC en el servidor.',
      welcomeBack: 'Bienvenido de nuevo',
      preparingWorkspace: 'Preparando tu centro de operaciones de seguridad...',
      retry: 'Reintentar autenticación',
    },
    navCategories: {
      general: 'GENERAL',
      antiRaid: 'SEGURIDAD',
      system: 'SISTEMA',
    },
    navItems: {
      overview: 'General',
      premium: 'Premium',
      servers: 'Cambiar de servidor',
      monitor: 'Monitor en Vivo',
      incidents: 'Registros',
      'protection-overview': 'Antiraid',
      'additional-security': 'Seguridad Adicional',
      'bot-permissions': 'Permisos del Bot',
      'join-protection': 'Protección de Ingresos',
      'anti-nuke': 'Defensa Anti-Nuke',
      'risk-engine': 'Motor de Riesgo',
      quarantine: 'Cuarentena',
      lockdown: 'Lockdown de Emergencia',
      whitelist: 'Whitelist',
      verification: 'Verificación',
      'log-channel': 'Canal de Logs',
      backups: 'Backups',
      'two-factor': 'Gestionar 2FA',
      'secondary-owner': 'Segundo Owner',
      'audit-logs': 'Auditoría del Sistema',
      'admin-panel': 'Panel Administrativo',
      settings: 'Ajustes',
    },
    header: {
      selectServer: 'Seleccionar servidor',
      searchPlaceholder: 'Buscar incidentes, Discord ID, sanciones...',
      notifications: 'Centro de Notificaciones',
      markAllRead: 'Marcar todo como leído',
      noNotifications: 'Sin notificaciones recientes.',
      connectionOnline: 'Stream en Vivo',
      connectionDegraded: 'Modo Degradado',
      connectionOffline: 'Sin Conexión',
      logout: 'Cerrar Sesión',
      language: 'Idioma',
      theme: 'Tema',
      themeDark: 'Oscuro',
      themeLight: 'Claro',
      themeSystem: 'Sistema',
    },
    periods: {
      '24h': '24 Horas',
      '7d': '7 Días',
      '30d': '30 Días',
      '90d': '90 Días',
    },
    overview: {
      title: 'Panel General',
      subtitle:
        'Estadísticas de protección en tiempo real, mitigación de amenazas y telemetría aislada de este servidor.',
      cards: {
        totalRaidsDetected: 'Raids Detectados',
        attacksPrevented: 'Ataques Mitigados',
        suspiciousJoins: 'Ingresos Sospechosos',
        criticalIncidents: 'Incidentes Críticos',
        usersQuarantined: 'En Cuarentena',
        activeProtection: 'Protección Activa',
        globalBansApplied: 'Bloqueos Automáticos',
        participatingServers: 'Servidores Autorizados',
      },
      securityActivityTitle: 'Actividad de Seguridad',
      threatDistributionTitle: 'Distribución de Amenazas',
      recentIncidentsTitle: 'Incidentes Recientes',
      systemStatusTitle: 'Estado de Infraestructura en Tiempo Real',
      series: {
        detectedRaids: 'Raids Detectados',
        preventedAttacks: 'Ataques Mitigados',
        suspiciousJoins: 'Cuentas Sospechosas',
        criticalEvents: 'Eventos Críticos',
      },
      distribution: {
        raidAttempts: 'Intentos de Raid',
        suspiciousAccounts: 'Cuentas Sospechosas',
        quarantinedUsers: 'En Cuarentena',
        globalBanMatches: 'Bloqueos por Seguridad',
      },
      infrastructure: {
        botStatus: 'Estado del Bot',
        apiStatus: 'Estado de la API',
        mongodbStatus: 'Estado MongoDB',
        redisStatus: 'Estado Redis',
        lastSync: 'Última Sincronización',
        l1Cache: 'Caché L1 en Memoria',
      },
    },
    servers: {
      title: 'Mis Servidores de Discord',
      subtitle:
        'Gestiona la vinculación del bot AEGIS, verifica permisos de administración y selecciona el servidor activo.',
      addBot: 'Añadir AEGIS al Servidor',
      verifyConnection: 'Verificar Instalación',
      selectWorkspace: 'Administrar Servidor',
      confirmedTitle: 'AEGIS conectado correctamente.',
      confirmedServer: 'Servidor',
      confirmedBot: 'Bot',
      confirmedSecurity: 'Seguridad',
      confirmedReady: 'Listo para configurar.',
      states: {
        BOT_CONNECTED: 'Bot Conectado',
        BOT_NOT_INSTALLED: 'Bot No Instalado',
        INSUFFICIENT_PERMISSIONS: 'Permisos Insuficientes',
        PROTECTION_ENABLED: 'Protección Activa',
        PROTECTION_DISABLED: 'Protección Inactiva',
      },
      membersLabel: 'miembros',
      membersUnknown: 'Sincronizando miembros',
      roles: {
        PROPIETARIO: 'PROPIETARIO',
        'SEGUNDO DUEÑO': 'SEGUNDO DUEÑO',
        ADMINISTRADOR: 'ADMINISTRADOR',
        MIEMBRO: 'MIEMBRO',
      },
      botStates: {
        ACTIVE: 'ACTIVO',
        NOT_INSTALLED: 'NO INSTALADO',
      },
      configureBot: 'Configurar server',
      manageBot: 'Configurar server',
      inviteBot: '+ Invitar al Bot',
      memberReadOnlyNote: 'Participas como miembro (sin privilegios de administrador en este servidor).',
      priorities: {
        ownedBadge: 'Prioridad 1',
        ownedTitle: 'Servidores Propietarios',
        ownedDesc: 'Servidores donde tu cuenta figura como Dueño de Discord.',
        adminBadge: 'Prioridad 2',
        adminTitle: 'Servidores Administrados',
        adminDesc: 'Servidores donde posees permisos administrativos.',
        inviteBadge: 'Prioridad 3',
        inviteTitle: 'Servidores para Instalar Bot',
        inviteDesc: 'Servidores donde participas pero el bot AEGIS aún no está instalado.',
        memberBadge: 'Miembros',
        memberTitle: 'Servidores con AEGIS Conectado',
        memberDesc: 'Servidores donde participas como miembro estándar.',
      },
      welcomeTitle: '¡Bienvenido de nuevo!',
      welcomeSubtitle: 'Todo tu universo de servidores organizado con clasificación inteligente por propietarios, administradores e invitaciones para el bot.',
      filters: {
        all: 'Todos',
        owned: 'Propietario',
        admin: 'Admin',
        invite: 'Invitar Bot',
      },
      syncingDiscord: 'Sincronizando Discord...',
      syncDiscord: 'Sincronizar Servidores',
      retry: 'Reintentar',
      loadingMessage: 'Obteniendo servidores de Discord en tiempo real...',
      errorTitle: 'No se pudo sincronizar la lista de Discord',
    },
    botHub: {
      title: 'Bot de Discord y Clúster de Sharding',
      subtitle:
        'Gestión del cliente Gateway, arquitectura de Sharding en clúster, caché acotada de baja latencia y sincronización global de comandos slash.',
      onlineBadge: 'EN LÍNEA',
      degradedBadge: 'CONEXIÓN PARCIAL',
      offlineBadge: 'DESCONECTADO',
      unconfiguredBadge: 'SIN TOKEN CONFIGURADO',
      connectBot: 'Conectar Bot',
      connecting: 'Conectando Gateway...',
      connectSuccess: 'Bot de Discord conectado y comandos slash sincronizados.',
      deployCommands: 'Desplegar Comandos Slash',
      deploying: 'Sincronizando Comandos...',
      deploySuccess: 'Grupos de Comandos Slash desplegados y sincronizados en todos los servidores.',
      rebootCluster: 'Reiniciar Clúster & Shards',
      rebooting: 'Reiniciando Clúster...',
      rebootSuccess: 'Clúster y Shards reiniciados correctamente.',
      ultraLowPing: 'Latencia WS',
      clusterTitle: 'Clúster Distribuido',
      clusterDesc: 'Nodo maestro con workers paralelos y balanceo por hash de Guild ID.',
      shardsTitle: 'Partición de Shards de Gateway',
      shardsDesc: 'Conexiones WebSocket concurrentes optimizadas para respuesta en tiempo real.',
      slashTitle: 'Comandos Slash Registrados',
      slashDesc: 'Suites de comandos con subcomandos desplegados globalmente y por servidor.',
      measuresTitle: 'Arquitectura de Baja Latencia y Escalabilidad',
      measuresDesc: 'Capas activas diseñadas para minimizar el tiempo de respuesta del Gateway y API.',
      subcommands: 'subcomandos',
      registeredGlobal: 'SINCRONIZADO GLOBALMENTE',
      pingLatency: 'Latencia WebSocket',
      memoryAllocated: 'Memoria RAM',
      eventLoopLag: 'Lag de Event Loop',
      uptimeLabel: 'Tiempo Activo',
      assignedGuilds: 'Servidores Asignados',
    },
    common: {
      saveChanges: 'Guardar Cambios',
      saving: 'Sincronizando...',
      savedConfirmed: 'Cambios persistidos y sincronizados',
      cancel: 'Cancelar',
      confirm: 'Confirmar',
      refresh: 'Actualizar',
      exportJson: 'Exportar JSON',
      filter: 'Filtrar',
      all: 'Todos',
      search: 'Buscar',
      noData: 'No hay registros que coincidan con los filtros actuales.',
      loading: 'Cargando datos de seguridad...',
      actions: 'Acciones',
      status: 'Estado',
      date: 'Fecha',
      server: 'Servidor',
      user: 'Usuario',
      moderator: 'Moderador',
      reason: 'Motivo',
      evidence: 'Evidencia',
      riskScore: 'Riesgo',
      previous: 'Anterior',
      next: 'Siguiente',
      enabled: 'Habilitado',
      disabled: 'Deshabilitado',
      insufficientRole: 'Permisos insuficientes para realizar esta operación.',
      syncConfirmed: 'Sincronización confirmada por el backend',
    },
  },
  en: {
    brandName: 'AEGIS SECURITY',
    brandSubtitle: 'Advanced Discord Anti-Raid Protection',
    login: {
      title: 'AEGIS SECURITY',
      subtitle: 'Advanced protection for your Discord community.',
      description:
        'Specialized security operations platform: real-time Anti-Raid detection, Anti-Nuke defense, automated Quarantine, and strict per-server configuration isolation.',
      continueDiscord: 'Continue with Discord',
      linkingNoteTitle: 'Verified OAuth2 Binding',
      linkingNote:
        'Authenticated via official Discord Authorization Code & PKCE. We strictly request identify and guilds scopes to verify your identity and managed servers.',
      securityNoticeTitle: 'Zero-Trust Architecture',
      securityNotice:
        'We never ask for your Discord password or store access tokens in browser storage. Sessions run on signed HttpOnly cookies with server-side RBAC enforcement.',
      welcomeBack: 'Welcome back',
      preparingWorkspace: 'Preparing your security workspace...',
      retry: 'Retry authentication',
    },
    navCategories: {
      general: 'GENERAL',
      antiRaid: 'SECURITY',
      system: 'SYSTEM',
    },
    navItems: {
      overview: 'Overview',
      premium: 'Premium',
      servers: 'Switch Server',
      monitor: 'Live Monitor',
      incidents: 'Server Logs',
      'protection-overview': 'Anti-Raid System',
      'additional-security': 'Additional Security',
      'bot-permissions': 'Bot Permissions',
      'join-protection': 'Join Protection',
      'anti-nuke': 'Anti-Nuke Defense',
      'risk-engine': 'Risk Engine',
      quarantine: 'Quarantine',
      lockdown: 'Emergency Lockdown',
      whitelist: 'Whitelist',
      verification: 'Verification',
      'log-channel': 'Log Channel',
      backups: 'Backups',
      'two-factor': 'Manage 2FA',
      'secondary-owner': 'Secondary Owner',
      'audit-logs': 'System Audit',
      'admin-panel': 'Admin Panel',
      settings: 'Settings',
    },
    header: {
      selectServer: 'Select server',
      searchPlaceholder: 'Search incidents, Discord ID, sanctions...',
      notifications: 'Notification Center',
      markAllRead: 'Mark all as read',
      noNotifications: 'No recent notifications.',
      connectionOnline: 'Stream Connected',
      connectionDegraded: 'Degraded Mode',
      connectionOffline: 'Offline',
      logout: 'Sign Out',
      language: 'Language',
      theme: 'Theme',
      themeDark: 'Dark',
      themeLight: 'Light',
      themeSystem: 'System',
    },
    periods: {
      '24h': '24 Hours',
      '7d': '7 Days',
      '30d': '30 Days',
      '90d': '90 Days',
    },
    overview: {
      title: 'Overview',
      subtitle:
        'Real-time protection statistics, threat mitigation, and isolated telemetry for this server.',
      cards: {
        totalRaidsDetected: 'Total Raids Detected',
        attacksPrevented: 'Attacks Mitigated',
        suspiciousJoins: 'Suspicious Joins',
        criticalIncidents: 'Critical Incidents',
        usersQuarantined: 'Users Quarantined',
        activeProtection: 'Active Protection',
        globalBansApplied: 'Auto-Blocks Applied',
        participatingServers: 'Authorized Servers',
      },
      securityActivityTitle: 'Security Activity',
      threatDistributionTitle: 'Threat Distribution',
      recentIncidentsTitle: 'Recent Incidents',
      systemStatusTitle: 'Live Infrastructure Health',
      series: {
        detectedRaids: 'Detected Raids',
        preventedAttacks: 'Mitigated Attacks',
        suspiciousJoins: 'Suspicious Joins',
        criticalEvents: 'Critical Events',
      },
      distribution: {
        raidAttempts: 'Raid Attempts',
        suspiciousAccounts: 'Suspicious Accounts',
        quarantinedUsers: 'Quarantined Users',
        globalBanMatches: 'Security Auto-Blocks',
      },
      infrastructure: {
        botStatus: 'Bot Status',
        apiStatus: 'API Status',
        mongodbStatus: 'MongoDB Status',
        redisStatus: 'Redis Status',
        lastSync: 'Last Synchronization',
        l1Cache: 'L1 Memory Cache',
      },
    },
    servers: {
      title: 'My Discord Servers',
      subtitle:
        'Manage AEGIS bot binding, verify administrative permissions, and switch active server context.',
      addBot: 'Add AEGIS to Server',
      verifyConnection: 'Verify Installation',
      selectWorkspace: 'Manage Server',
      confirmedTitle: 'AEGIS successfully connected.',
      confirmedServer: 'Server',
      confirmedBot: 'Bot',
      confirmedSecurity: 'Security',
      confirmedReady: 'Ready to configure.',
      states: {
        BOT_CONNECTED: 'BOT CONNECTED',
        BOT_NOT_INSTALLED: 'BOT NOT INSTALLED',
        INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT PERMISSIONS',
        PROTECTION_ENABLED: 'PROTECTION ENABLED',
        PROTECTION_DISABLED: 'PROTECTION DISABLED',
      },
      membersLabel: 'members',
      membersUnknown: 'Syncing members',
      roles: {
        PROPIETARIO: 'OWNER',
        'SEGUNDO DUEÑO': 'SECONDARY OWNER',
        ADMINISTRADOR: 'ADMINISTRATOR',
        MIEMBRO: 'MEMBER',
      },
      botStates: {
        ACTIVE: 'ACTIVE',
        NOT_INSTALLED: 'NOT INSTALLED',
      },
      configureBot: 'Configure server',
      manageBot: 'Configure server',
      inviteBot: '+ Invite Bot',
      memberReadOnlyNote: 'You are participating as a member (no administrator privileges in this server).',
      priorities: {
        ownedBadge: 'Priority 1',
        ownedTitle: 'Owned Servers',
        ownedDesc: 'Servers where your account is the Discord Owner.',
        adminBadge: 'Priority 2',
        adminTitle: 'Admin Servers',
        adminDesc: 'Servers where you hold administrative permissions.',
        inviteBadge: 'Priority 3',
        inviteTitle: 'Bot Invite Required',
        inviteDesc: 'Servers where you participate but AEGIS bot is not yet installed.',
        memberBadge: 'Members',
        memberTitle: 'Connected Member Servers',
        memberDesc: 'Servers where you participate as a standard member.',
      },
      welcomeTitle: 'Welcome back!',
      welcomeSubtitle: 'All your server workspace organized with smart classification for owners, administrators, and bot invitations.',
      filters: {
        all: 'All',
        owned: 'Owned',
        admin: 'Admin',
        invite: 'Invite Bot',
      },
      syncingDiscord: 'Syncing Discord...',
      syncDiscord: 'Sync Servers',
      retry: 'Retry',
      loadingMessage: 'Fetching real-time Discord servers...',
      errorTitle: 'Could not synchronize Discord server list',
    },
    botHub: {
      title: 'Discord Bot & Clustered Sharding',
      subtitle:
        'Gateway client lifecycle, multi-shard cluster architecture, bounded low-latency caching, and global + per-guild slash command sync.',
      onlineBadge: 'ONLINE',
      degradedBadge: 'DEGRADED',
      offlineBadge: 'OFFLINE',
      unconfiguredBadge: 'UNCONFIGURED',
      connectBot: 'Connect Bot',
      connecting: 'Connecting Gateway...',
      connectSuccess: 'Discord bot connected and slash commands synchronized.',
      deployCommands: 'Deploy Slash Commands',
      deploying: 'Syncing Commands...',
      deploySuccess: 'Slash command suites deployed & synchronized across all servers.',
      rebootCluster: 'Reboot Cluster & Shards',
      rebooting: 'Rebooting Cluster...',
      rebootSuccess: 'Cluster & Shards rebooted cleanly.',
      ultraLowPing: 'WS Latency',
      clusterTitle: 'Distributed Cluster',
      clusterDesc: 'Master node orchestrating parallel workers with Guild ID hash sharding.',
      shardsTitle: 'Gateway Shard Partitioning',
      shardsDesc: 'Concurrent WebSocket connections tuned for low-latency event dispatch.',
      slashTitle: 'Registered Slash Commands',
      slashDesc: 'Command suites with subcommands deployed globally and across guilds.',
      measuresTitle: 'Low-Latency & Scalability Architecture',
      measuresDesc: 'Active safeguards engineered for fast Gateway and REST response.',
      subcommands: 'subcommands',
      registeredGlobal: 'GLOBAL SYNCED',
      pingLatency: 'WebSocket Latency',
      memoryAllocated: 'RAM Allocation',
      eventLoopLag: 'Event Loop Lag',
      uptimeLabel: 'Uptime',
      assignedGuilds: 'Assigned Guilds',
    },
    common: {
      saveChanges: 'Save Changes',
      saving: 'Synchronizing...',
      savedConfirmed: 'Changes persisted and synchronized',
      cancel: 'Cancel',
      confirm: 'Confirm',
      refresh: 'Refresh',
      exportJson: 'Export JSON',
      filter: 'Filter',
      all: 'All',
      search: 'Search',
      noData: 'No records match the current filters.',
      loading: 'Loading security data...',
      actions: 'Actions',
      status: 'Status',
      date: 'Date',
      server: 'Server',
      user: 'User',
      moderator: 'Moderator',
      reason: 'Reason',
      evidence: 'Evidence',
      riskScore: 'Risk Score',
      previous: 'Previous',
      next: 'Next',
      enabled: 'Enabled',
      disabled: 'Disabled',
      insufficientRole: 'Insufficient role permissions for this operation.',
      syncConfirmed: 'Synchronization confirmed by backend',
    },
  },
};

export function getDict(lang: LanguageCode): TranslationDictionary {
  return DICTIONARIES[lang] ?? DICTIONARIES.es;
}
