import type { AntiRaidRuleKey, BotCommandPermission, LanguageCode } from './types';

export interface SuiteCopy {
  common: {
    free: string;
    premium: string;
    enabled: string;
    disabled: string;
    activatePremium: string;
    premiumRequiredNote: string;
    save: string;
    saved: string;
    delete: string;
    add: string;
    cancel: string;
    noServerTitle: string;
    noServerDesc: string;
    goToServers: string;
  };
  overviewExtras: {
    secondOwnerMissingTitle: string;
    secondOwnerMissingBody: string;
    secondOwnerMissingLink: string;
    secondOwnerAssignedTitle: string;
    maliciousOkTitle: string;
    maliciousDetectedTitle: string;
    maliciousDesc: string;
    backupsTitle: string;
    backupsZeroWarn: string;
    backupsDesc: string;
    whitelistTitle: string;
    whitelistRecommended: string;
    whitelistDesc: string;
    moreInfo: string;
  };
  antiRaidSuite: {
    title: string;
    subtitle: string;
    punishmentLabel: string;
    punishments: Record<'STRIP_ROLES' | 'QUARANTINE' | 'KICK' | 'BAN', string>;
    systemState: string;
    actionsPerMinute: string;
    rules: Record<AntiRaidRuleKey, { title: string; desc: string }>;
  };
  additionalSecurity: {
    title: string;
    subtitle: string;
    autoModCounter: string;
    banMalicious: { title: string; desc: string; off: string; on: string };
    antiFlood: {
      title: string;
      desc: string;
      off: string;
      on: string;
      premiumHint: string;
      maxMsgs: string;
      windowSec: string;
      muteMin: string;
    };
    antiScam: {
      title: string;
      desc: string;
      off: string;
      on: string;
      premiumHint: string;
      muteMin: string;
    };
    antiEveryone: { title: string; desc: string; off: string; on: string };
    antiWebhook: { title: string; desc: string; off: string; on: string };
    antiMassMute: { title: string; desc: string; maxMutes: string };
    antiAlts: { title: string; desc: string; minDays: string };
    antiBots: {
      title: string;
      desc: string;
      offTitle: string;
      offDesc: string;
      unverifiedTitle: string;
      unverifiedDesc: string;
      allTitle: string;
      allDesc: string;
    };
    antiInvites: { title: string; desc: string; off: string; on: string };
    antiLinks: {
      title: string;
      desc: string;
      off: string;
      on: string;
      allowedDomains: string;
      domainPlaceholder: string;
    };
  };
  botPermissions: {
    title: string;
    infoTitle: string;
    infoDesc: string;
    bullets: string[];
    usersBadge: string;
    rolesBadge: string;
    addBtn: string;
    addNowBtn: string;
    emptyText: string;
    targetType: string;
    userOption: string;
    roleOption: string;
    targetIdLabel: string;
    targetNameLabel: string;
    rateLimitLabel: string;
    actionsWindow: string;
    permsLabel: string;
    permLabels: Record<BotCommandPermission, string>;
    tableTarget: string;
    tablePerms: string;
    tableRateLimit: string;
    tableActions: string;
  };
  whitelistExtra: {
    title: string;
    usersCardTitle: string;
    usersCardDesc: string;
    channelsCardTitle: string;
    channelsCardDesc: string;
    usersSection: string;
    channelsSection: string;
    emptyUsers: string;
    emptyChannels: string;
    addUserBtn: string;
    addChannelBtn: string;
    channelIdLabel: string;
    channelNameLabel: string;
    reasonLabel: string;
    removeBtn: string;
  };
  verification: {
    title: string;
    subtitle: string;
    statusLabel: string;
    modeLabel: string;
    modes: Record<'BUTTON' | 'CAPTCHA' | 'REACTION' | 'STRICT_2FA', { title: string; desc: string }>;
    channelLabel: string;
    roleLabel: string;
    blockSuspicious: string;
    autoKickMin: string;
    panelTitleLabel: string;
    panelDescLabel: string;
    previewTitle: string;
  };
  logChannel: {
    title: string;
    configTitle: string;
    availableChannels: string;
    manualChannelPlaceholder: string;
    sendTestBtn: string;
    testSentOk: string;
    eventsTitle: string;
    eventLabels: Record<'moderation' | 'antiRaid' | 'antiNuke' | 'verification' | 'backups', string>;
    faqTitle: string;
    faqs: Array<{ q: string; a: string }>;
  };
  backups: {
    title: string;
    subtitle: string;
    createBtn: string;
    namePlaceholder: string;
    emptyTitle: string;
    autoScheduleLabel: string;
    scheduleOff: string;
    scheduleDaily: string;
    scheduleWeekly: string;
    downloadJson: string;
    restoreBtn: string;
    faqTitle: string;
    faqs: Array<{ q: string; a: string }>;
  };
  twoFactor: {
    title: string;
    subtitle: string;
    statusActive: string;
    statusInactive: string;
    startSetupBtn: string;
    secretLabel: string;
    otpUriLabel: string;
    enterCodeLabel: string;
    confirmEnableBtn: string;
    recoveryTitle: string;
    recoveryDesc: string;
    verifyActionTitle: string;
    verifyBtn: string;
    disableBtn: string;
  };
  secondaryOwner: {
    title: string;
    subtitle: string;
    whyTitle: string;
    whyDesc: string;
    primaryOwnerOnly: string;
    discordIdLabel: string;
    usernameLabel: string;
    noteLabel: string;
    assignBtn: string;
    revokeBtn: string;
    currentTitle: string;
    noneTitle: string;
  };
  premium: {
    title: string;
    subtitle: string;
    activeBadge: string;
    freeBadge: string;
    activateBtn: string;
    deactivateBtn: string;
    licensePlaceholder: string;
    compareTitle: string;
    features: Array<{ name: string; free: string; pro: string }>;
  };
  help: {
    supportTitle: string;
    supportSubtitle: string;
    docsTitle: string;
    docsSubtitle: string;
    cards: Array<{ title: string; desc: string; badge: string }>;
    guides: Array<{ title: string; summary: string; steps: string[] }>;
  };
}

const SUITE_DICT: Record<LanguageCode, SuiteCopy> = {
  es: {
      common: {
      free: 'GRATUITO',
      premium: 'PREMIUM',
      enabled: 'Activado',
      disabled: 'Desactivado',
      activatePremium: 'Ver Planes Premium',
      premiumRequiredNote: 'Requiere Plan Oro o Diamante activo',
      save: 'Guardar configuración',
      saved: 'Configuración guardada correctamente',
      delete: 'Eliminar',
      add: 'Agregar',
      cancel: 'Cancelar',
      noServerTitle: 'Selecciona un servidor administrable',
      noServerDesc:
        'Para configurar módulos de seguridad, ingresa desde un servidor donde seas Propietario o Segundo Dueño.',
      goToServers: 'Ir a Servidores',
    },
    overviewExtras: {
      secondOwnerMissingTitle: '¡Segundo Owner sin asignar!',
      secondOwnerMissingBody:
        'Asigna un Segundo Owner para no perder nunca el acceso a la configuración de AEGIS SECURITY. Recomendamos asignarlo a una cuenta secundaria de confianza.',
      secondOwnerMissingLink: 'Asigna un Segundo Owner desde aquí',
      secondOwnerAssignedTitle: 'Segundo Owner protegido',
      maliciousOkTitle: 'No se detectaron acciones maliciosas',
      maliciousDetectedTitle: 'Acciones maliciosas bloqueadas',
      maliciousDesc: 'Historial semanal en tiempo real de amenazas evaluadas en tu servidor.',
      backupsTitle: 'Copias de Seguridad',
      backupsZeroWarn: '(No podrás recuperar tu servidor si lo pierdes)',
      backupsDesc: 'Es recomendable mantener copias de seguridad actualizadas de políticas y roles.',
      whitelistTitle: 'Usuarios en Whitelist',
      whitelistRecommended: '(Recomendado)',
      whitelistDesc: 'Mantén en whitelist únicamente cuentas y bots estrictamente verificados.',
      moreInfo: 'Ver detalle',
    },
    antiRaidSuite: {
      title: 'Sistema Antiraid',
      subtitle:
        'Control granular por acción por minuto. Si un usuario o bot excede el umbral configurado, AEGIS aplica la sanción automáticamente.',
      punishmentLabel: 'Sanción automática al dispararse',
      punishments: {
        STRIP_ROLES: 'Remover roles peligrosos',
        QUARANTINE: 'Mover a Cuarentena',
        KICK: 'Expulsar del servidor',
        BAN: 'Banear permanentemente',
      },
      systemState: 'Estado sistema',
      actionsPerMinute: 'Acciones por minuto',
      rules: {
        channelCreate: {
          title: 'Crear Canales',
          desc: 'Limita el número máximo de canales que podrá crear un usuario por minuto.',
        },
        channelDelete: {
          title: 'Borrar Canales',
          desc: 'Limita el número máximo de canales que podrá borrar un usuario por minuto.',
        },
        channelEdit: {
          title: 'Editar Canales',
          desc: 'Limita el número máximo de canales que podrá editar un usuario por minuto.',
        },
        roleCreate: {
          title: 'Crear Roles',
          desc: 'Limita el número máximo de roles que podrá crear un usuario por minuto.',
        },
        roleDelete: {
          title: 'Borrar Roles',
          desc: 'Limita el número máximo de roles que podrá borrar un usuario por minuto.',
        },
        roleEdit: {
          title: 'Editar Roles',
          desc: 'Limita el número máximo de roles que podrá editar un usuario por minuto.',
        },
        emojiCreate: {
          title: 'Crear Emojis',
          desc: 'Limita el número máximo de emojis que podrá crear un usuario por minuto.',
        },
        emojiDelete: {
          title: 'Borrar Emojis',
          desc: 'Limita el número máximo de emojis que podrá borrar un usuario por minuto.',
        },
        memberKick: {
          title: 'Expulsar Usuarios',
          desc: 'Limita el número máximo de usuarios que podrá expulsar un moderador por minuto.',
        },
        memberBan: {
          title: 'Banear Usuarios',
          desc: 'Limita el número máximo de usuarios que podrá banear un moderador por minuto.',
        },
        memberUnban: {
          title: 'Desbanear Usuarios',
          desc: 'Limita el número máximo de usuarios que podrá desbanear una cuenta por minuto.',
        },
        webhookEdit: {
          title: 'Editar Webhooks',
          desc: 'Limita el número máximo de webhooks que podrá modificar un usuario por minuto.',
        },
      },
    },
    additionalSecurity: {
      title: 'Seguridad Adicional',
      subtitle:
        'Capas de seguridad preventiva: protección contra enlaces, invites, bots no verificados, cuentas secundarias, phishing y webhooks.',
      autoModCounter: 'Reglas de AutoMod usadas en este servidor:',
      banMalicious: {
        title: 'Banear usuarios maliciosos',
        desc: 'Banea automáticamente a los usuarios que estén en listas negras globales o con historial de ataques.',
        off: 'No se baneará a los usuarios maliciosos.',
        on: 'Se baneará automáticamente a los usuarios maliciosos.',
      },
      antiFlood: {
        title: 'Anti Flood',
        desc: 'Evita que los miembros envíen mensajes de forma excesivamente rápida en los canales de texto.',
        off: 'No se limitará el envío de mensajes.',
        on: 'Se silenciará a los miembros que envíen mensajes masivos.',
        premiumHint: 'Puedes cambiar estos parámetros con la membresía Premium',
        maxMsgs: 'Mensajes máx.',
        windowSec: 'Ventana (seg)',
        muteMin: 'Mute (min)',
      },
      antiScam: {
        title: 'Anti Scam',
        desc: 'Detecta y elimina enlaces sospechosos o estafas conocidas tipo Nitro gratis o phishing.',
        off: 'No se analizarán los enlaces en busca de estafas.',
        on: 'Se eliminarán los enlaces de estafa y se sancionará al autor.',
        premiumHint: 'Puedes cambiar estos parámetros con la membresía Premium',
        muteMin: 'Duración mute (min)',
      },
      antiEveryone: {
        title: 'Anti Everyone Permisos',
        desc: 'Evita que el rol @everyone tenga permisos de Administrador, Gestionar Servidor, etc.',
        off: 'No se bloquearán los permisos peligrosos.',
        on: 'Se revocarán automáticamente los permisos peligrosos de @everyone.',
      },
      antiWebhook: {
        title: 'Anti Spam Webhooks',
        desc: 'Detecta y bloquea ataques masivos de spam a través de webhooks creados sin autorización.',
        off: 'No se limitará el uso de webhooks.',
        on: 'Se eliminarán webhooks sospechosos y se bloqueará el spam.',
      },
      antiMassMute: {
        title: 'Anti Mass Mute',
        desc: 'Evita que un administrador o atacante silencie o expulse masivamente a usuarios.',
        maxMutes: 'Mutes máximos por minuto',
      },
      antiAlts: {
        title: 'Anti Alts',
        desc: 'Evita la entrada de cuentas secundarias o recién creadas que puedan pertenecer a un atacante.',
        minDays: 'Mínimo de días requeridos',
      },
      antiBots: {
        title: 'Anti Bots',
        desc: 'Bloquea la entrada de bots maliciosos o no verificados a tu servidor.',
        offTitle: 'Desactivado',
        offDesc: 'No se aplicará ninguna restricción a los bots.',
        unverifiedTitle: 'Bots sin verificar',
        unverifiedDesc: 'Se expulsarán los bots que no estén verificados por Discord.',
        allTitle: 'Banear todos los bots',
        allDesc: 'Se banearán todos los bots que sean añadidos al servidor.',
      },
      antiInvites: {
        title: 'Anti Invites',
        desc: 'Bloquea automáticamente cualquier invitación a otros servidores de Discord.',
        off: 'No se bloquearán las invitaciones de Discord.',
        on: 'Se bloquearán automáticamente las invitaciones de Discord.',
      },
      antiLinks: {
        title: 'Anti Links',
        desc: 'Bloquea automáticamente cualquier enlace externo.',
        off: 'No se bloquearán los enlaces externos.',
        on: 'Se bloquearán automáticamente todos los enlaces externos.',
        allowedDomains: 'Dominios permitidos (Premium)',
        domainPlaceholder: 'ejemplo.com',
      },
    },
    botPermissions: {
      title: 'Permisos del Bot',
      infoTitle: '¿Qué son los Permisos del Bot?',
      infoDesc:
        'Asigna permisos internos del bot a usuarios o roles sin necesidad de otorgarles permisos nativos peligrosos de Discord.',
      bullets: [
        '6 permisos disponibles: Banear, Desbanear, Mutear, Desmutear, Limpiar mensajes y Expulsar.',
        'Soporte granular para usuarios y roles de Discord.',
        'Rate-limit configurable por ventana de tiempo para evitar abusos.',
        'Todas las acciones quedan auditadas en el canal de logs.',
      ],
      usersBadge: 'USUARIOS',
      rolesBadge: 'ROLES',
      addBtn: '+ Agregar permiso',
      addNowBtn: '+ Agregar ahora',
      emptyText: 'Aún no hay usuarios ni roles con permisos internos del bot.',
      targetType: 'Tipo de objetivo',
      userOption: 'Usuario de Discord',
      roleOption: 'Rol de Discord',
      targetIdLabel: 'ID de Discord (Snowflake)',
      targetNameLabel: 'Nombre o etiqueta',
      rateLimitLabel: 'Límite de acciones por ventana',
      actionsWindow: 'acciones / min ventana',
      permsLabel: 'Permisos autorizados',
      permLabels: {
        BAN: 'Banear',
        UNBAN: 'Desbanear',
        MUTE: 'Mutear',
        UNMUTE: 'Desmutear',
        CLEAR_MESSAGES: 'Limpiar mensajes',
        KICK: 'Expulsar',
      },
      tableTarget: 'Objetivo',
      tablePerms: 'Permisos',
      tableRateLimit: 'Rate-Limit',
      tableActions: 'Acciones',
    },
    whitelistExtra: {
      title: 'Whitelist de Seguridad',
      usersCardTitle: 'Usuarios y Roles en Whitelist',
      usersCardDesc:
        'Las cuentas en whitelist no pueden ser sancionadas automáticamente por el sistema Anti-Raid ni el motor de defensa.',
      channelsCardTitle: 'Canales en Whitelist',
      channelsCardDesc:
        'En los canales incluidos en whitelist, el Anti Flood y las protecciones automáticas de spam no se aplican.',
      usersSection: 'Usuarios, Roles y Bots',
      channelsSection: 'Canales Excluidos',
      emptyUsers: 'No hay usuarios o roles en la whitelist.',
      emptyChannels: 'No hay canales en la whitelist.',
      addUserBtn: '+ Agregar objetivo',
      addChannelBtn: '+ Agregar canal',
      channelIdLabel: 'Canal o ID (Snowflake)',
      channelNameLabel: 'Nombre del canal',
      reasonLabel: 'Motivo de exclusión',
      removeBtn: 'Eliminar',
    },
    verification: {
      title: 'Verificación de Ingreso',
      subtitle:
        'Asegura tu comunidad obligando a los nuevos miembros a superar un filtro antes de acceder a los canales.',
      statusLabel: 'Estado de Verificación',
      modeLabel: 'Método de verificación',
      modes: {
        BUTTON: { title: 'Botón Instantáneo', desc: 'Verificación rápida con un clic para comunidades activas.' },
        CAPTCHA: { title: 'Captcha Numérico/Visual', desc: 'Desafío interactivo anti-selfbot antes de dar acceso.' },
        REACTION: { title: 'Reacción en Panel', desc: 'Embed fijado con verificación mediante reacción controlada.' },
        STRICT_2FA: { title: 'Verificación Estricta (Premium)', desc: 'Filtro avanzado + puntuación del Risk Engine.' },
      },
      channelLabel: 'Canal del panel de verificación',
      roleLabel: 'Rol al verificar',
      blockSuspicious: 'Bloquear cuentas con riesgo alto detectado automáticamente',
      autoKickMin: 'Expulsar si no se verifica en (minutos · Premium)',
      panelTitleLabel: 'Título del embed de verificación',
      panelDescLabel: 'Mensaje para nuevos miembros',
      previewTitle: 'Vista previa en Discord',
    },
    logChannel: {
      title: 'Canal de Logs',
      configTitle: 'Configurar Logs',
      availableChannels: 'Canales disponibles en el servidor',
      manualChannelPlaceholder: 'ID del canal de logs (17-20 dígitos)',
      sendTestBtn: 'Enviar mensaje de prueba',
      testSentOk: 'Embed de prueba enviado al canal de Discord.',
      eventsTitle: 'Eventos enviados al canal',
      eventLabels: {
        moderation: 'Acciones de Moderación',
        antiRaid: 'Alertas y Mitigación Anti-Raid',
        antiNuke: 'Detección Anti-Nuke y Auditoría',
        verification: 'Registros de Verificación',
        backups: 'Creación y Restauración de Backups',
      },
      faqTitle: 'Preguntas frecuentes',
      faqs: [
        {
          q: '¿Qué se envía al canal de Logs?',
          a: 'Se envían alertas de seguridad en tiempo real, acciones automáticas de AEGIS y registros de moderación ejecutados con permisos internos.',
        },
        {
          q: '¿Qué tipo de alertas recibo?',
          a: 'Intentos de raid, mutaciones sospechosas de canales o roles, cuentas bloqueadas por Global Ban y cambios críticos de configuración.',
        },
        {
          q: '¿Qué canal de Logs debo elegir?',
          a: 'Recomendamos un canal privado exclusivo para administradores y staff de confianza para evitar filtración de evidencias.',
        },
      ],
    },
    backups: {
      title: 'Copias de Seguridad',
      subtitle:
        'Resguarda la configuración de roles, canales, whitelist y políticas de seguridad en respaldos independientes por servidor.',
      createBtn: 'Crear Copia Ahora',
      namePlaceholder: 'Nombre del respaldo (ej: Pre-evento semanal)',
      emptyTitle: 'Aún no hay copias de seguridad guardadas en este servidor.',
      autoScheduleLabel: 'Respaldo Automático',
      scheduleOff: 'Desactivado',
      scheduleDaily: 'Automático según plan',
      scheduleWeekly: 'Automático según plan',
      downloadJson: 'Descargar JSON',
      restoreBtn: 'Restaurar Políticas',
      faqTitle: 'Preguntas frecuentes sobre Copias de Seguridad',
      faqs: [
        {
          q: '¿Cuántas copias y cada cuánto se crean automáticamente?',
          a: 'Plan Gratuito: máximo 1 copia (automática cada 7 días). Plan Oro: máximo 5 copias (cada 3 días). Plan Diamante: máximo 10 copias (cada 1 día). Al alcanzar el límite, la creación se detiene hasta eliminar una copia.',
        },
        {
          q: '¿Cómo puedo crear una copia manual?',
          a: 'Escribe un nombre descriptivo arriba y pulsa "Crear Copia Ahora". AEGIS guardará los roles, canales reales y todas las políticas de seguridad de este servidor.',
        },
        {
          q: '¿Qué ocurre si llego al límite de copias de mi plan?',
          a: 'Cuando el servidor alcanza su cuota máxima (1, 5 o 10 copias), el sistema detiene las copias automáticas y manuales hasta que liberes espacio eliminando una copia anterior.',
        },
        {
          q: '¿Se guardan los mensajes en las copias de seguridad?',
          a: 'No. Por privacidad y límites de la API de Discord, los respaldos almacenan estructura (canales, roles, permisos) y reglas de seguridad, nunca historial privado de mensajes.',
        },
      ],
    },
    twoFactor: {
      title: 'Gestionar 2FA (Autenticación en Dos Pasos)',
      subtitle:
        'Protege tu acceso y operaciones críticas del dashboard mediante códigos TOTP RFC-6238 compatibles con Google Authenticator, Authy o 1Password.',
      statusActive: '2FA ACTIVO Y PROTEGIDO',
      statusInactive: '2FA NO CONFIGURADO',
      startSetupBtn: 'Generar clave TOTP 2FA',
      secretLabel: 'Clave secreta Base32 (añadir manualmente en tu app)',
      otpUriLabel: 'URI otpauth:// (compatible con gestores)',
      enterCodeLabel: 'Código de 6 dígitos de tu app',
      confirmEnableBtn: 'Verificar y Activar 2FA',
      recoveryTitle: 'Códigos de recuperación de un solo uso',
      recoveryDesc: 'Guárdalos en un lugar seguro. Cada código solo puede utilizarse una vez.',
      verifyActionTitle: 'Probar o verificar código actual',
      verifyBtn: 'Validar código',
      disableBtn: 'Desactivar 2FA',
    },
    secondaryOwner: {
      title: 'Segundo Owner',
      subtitle:
        'Designa una cuenta secundaria de respaldo para administrar la configuración de este servidor si pierdes acceso a tu cuenta principal.',
      whyTitle: 'Continuidad Operativa Zero-Trust',
      whyDesc:
        'Solo el Propietario Principal verificado en Discord puede asignar o revocar al Segundo Owner. Si pierdes acceso a tu cuenta principal, la cuenta designada conservará control administrativo en AEGIS.',
      primaryOwnerOnly: 'Solo el Propietario Principal de Discord puede modificar este ajuste.',
      discordIdLabel: 'ID de Discord del Segundo Owner (Snowflake)',
      usernameLabel: 'Nombre de usuario',
      noteLabel: 'Nota de verificación (opcional)',
      assignBtn: 'Asignar Segundo Owner',
      revokeBtn: 'Revocar Segundo Owner',
      currentTitle: 'Segundo Owner Activo',
      noneTitle: 'Sin Segundo Owner asignado',
    },
    premium: {
      title: 'Planes y Membresías AEGIS',
      subtitle:
        'Canjea códigos de licencia o recibe tiempo asignado por el Staff. El tiempo activo se acumula automáticamente y se distribuye entre tus servidores autorizados.',
      activeBadge: 'MEMBRESÍA ACTIVA',
      freeBadge: 'PLAN GRATUITO',
      activateBtn: 'Activar en este servidor',
      deactivateBtn: 'Liberar cupo de este servidor',
      licensePlaceholder: 'Ingresa tu código (ej: AEGIS-XXXX-XXXX)',
      compareTitle: 'Comparativa Detallada de Planes',
      features: [
        { name: 'Servidores Premium activables simultáneamente', free: '0 servidores', pro: 'Oro: 1 · Diamante: 5' },
        { name: 'Copias de seguridad automáticas y cuota máxima', free: '1 copia máx. (cada 7 días)', pro: 'Oro: 5 (cada 3d) · Diamante: 10 (cada 1d)' },
        { name: 'Antiraid Granular (Editar Canales/Roles, Emojis, Webhooks)', free: 'Básico (8 reglas)', pro: 'Completo (12 reglas)' },
        { name: 'Anti Mass Mute y límites personalizados Flood/Scam', free: 'Estándar', pro: 'Personalizable + Mass Mute' },
        { name: 'Whitelist de Dominios en Anti Links', free: 'Bloqueo total', pro: 'Oro: 15 · Diamante: 50 dominios' },
        { name: 'Usuarios / Canales en Whitelist', free: '10 usuarios / 3 canales', pro: 'Oro: 50/20 · Diamante: 250/100' },
        { name: 'Permisos internos del Bot (Usuarios / Roles)', free: '5 usuarios / 3 roles', pro: 'Oro: 25/12 · Diamante: 100/50' },
      ],
    },
    help: {
      supportTitle: 'Centro de Soporte AEGIS',
      supportSubtitle: 'Diagnóstico en vivo, mejores prácticas ante incidentes y soporte operativo.',
      docsTitle: 'Documentación y Arquitectura',
      docsSubtitle: 'Guías paso a paso para blindar servidores de Discord sin falsos positivos.',
      cards: [
        {
          title: 'Protocolo ante Raid Activo',
          desc: 'Activa Lockdown de Emergencia, cambia modo Anti-Raid a STRICT y verifica canales recientes en Backups.',
          badge: 'Respuesta < 30s',
        },
        {
          title: 'Configuración Segura de Whitelist',
          desc: 'Añade solo bots oficiales verificados y canales de comandos para evitar brechas laterales.',
          badge: 'Zero-Trust',
        },
        {
          title: 'Verificación de Permisos del Bot',
          desc: 'Mantén el rol de AEGIS por encima de roles de moderación para garantizar aislamiento y anti-nuke.',
          badge: 'Jerarquía Discord',
        },
      ],
      guides: [
        {
          title: '1. Blindaje Inicial en 5 Minutos',
          summary: 'Secuencia recomendada al añadir AEGIS a un servidor nuevo.',
          steps: [
            'Asigna un Canal de Logs privado para el staff.',
            'Activa Sistema Antiraid con sanción Cuarentena o Remover Roles.',
            'Activa Anti Bots (Bots sin verificar), Anti Everyone y Anti Scam.',
            'Crea tu primer Backup manual y asigna un Segundo Owner.',
          ],
        },
        {
          title: '2. Permisos Internos sin Riesgo',
          summary: 'Cómo delegar moderación sin entregar Administrador de Discord.',
          steps: [
            'Accede a Permisos del Bot y agrega el rol de tu equipo de moderación.',
            'Marca únicamente los comandos necesarios (Mutear, Expulsar, Limpiar).',
            'Define un Rate-Limit estricto (ej. 5 acciones cada 10 minutos).',
          ],
        },
      ],
    },
  },
  en: {
    common: {
      free: 'FREE',
      premium: 'PREMIUM',
      enabled: 'Enabled',
      disabled: 'Disabled',
      activatePremium: 'Activate Premium',
      premiumRequiredNote: 'Premium is required for this feature',
      save: 'Save settings',
      saved: 'Settings saved successfully',
      delete: 'Remove',
      add: 'Add',
      cancel: 'Cancel',
      noServerTitle: 'Select a manageable server',
      noServerDesc:
        'To configure security modules, link or select a server where the bot is active.',
      goToServers: 'Go to Servers',
    },
    overviewExtras: {
      secondOwnerMissingTitle: 'Secondary Owner not assigned!',
      secondOwnerMissingBody:
        'Assign a Secondary Owner so you never lose access to AEGIS SECURITY settings if anything happens to your primary account.',
      secondOwnerMissingLink: 'Assign a Secondary Owner here',
      secondOwnerAssignedTitle: 'Secondary Owner protected',
      maliciousOkTitle: 'No malicious actions detected',
      maliciousDetectedTitle: 'Malicious actions mitigated',
      maliciousDesc: 'Weekly timeline of evaluated threats across your server.',
      backupsTitle: 'Server Backups',
      backupsZeroWarn: '(You will not be able to recover your server if lost)',
      backupsDesc: 'We recommend maintaining up-to-date backups of policies and structure.',
      whitelistTitle: 'Whitelisted Users',
      whitelistRecommended: '(Recommended)',
      whitelistDesc: 'Keep the number of whitelisted accounts as minimal as possible.',
      moreInfo: 'View details',
    },
    antiRaidSuite: {
      title: 'Anti-Raid System',
      subtitle:
        'Granular per-minute rate limits across destructive actions. Exceeding any threshold triggers automatic sanction.',
      punishmentLabel: 'Automatic sanction on trigger',
      punishments: {
        STRIP_ROLES: 'Strip dangerous roles',
        QUARANTINE: 'Move to Quarantine',
        KICK: 'Kick from server',
        BAN: 'Permanent Ban',
      },
      systemState: 'System state',
      actionsPerMinute: 'Actions per minute',
      rules: {
        channelCreate: {
          title: 'Create Channels',
          desc: 'Limits the maximum number of channels a user can create per minute.',
        },
        channelDelete: {
          title: 'Delete Channels',
          desc: 'Limits the maximum number of channels a user can delete per minute.',
        },
        channelEdit: {
          title: 'Edit Channels',
          desc: 'Limits the maximum number of channels a user can edit per minute.',
        },
        roleCreate: {
          title: 'Create Roles',
          desc: 'Limits the maximum number of roles a user can create per minute.',
        },
        roleDelete: {
          title: 'Delete Roles',
          desc: 'Limits the maximum number of roles a user can delete per minute.',
        },
        roleEdit: {
          title: 'Edit Roles',
          desc: 'Limits the maximum number of roles a user can edit per minute.',
        },
        emojiCreate: {
          title: 'Create Emojis',
          desc: 'Limits the maximum number of emojis a user can create per minute.',
        },
        emojiDelete: {
          title: 'Delete Emojis',
          desc: 'Limits the maximum number of emojis a user can delete per minute.',
        },
        memberKick: {
          title: 'Kick Users',
          desc: 'Limits the maximum number of users a moderator can kick per minute.',
        },
        memberBan: {
          title: 'Ban Users',
          desc: 'Limits the maximum number of users a moderator can ban per minute.',
        },
        memberUnban: {
          title: 'Unban Users',
          desc: 'Limits the maximum number of users an account can unban per minute.',
        },
        webhookEdit: {
          title: 'Edit Webhooks',
          desc: 'Limits the maximum number of webhooks a user can modify per minute.',
        },
      },
    },
    additionalSecurity: {
      title: 'Additional Security',
      subtitle:
        'Preventive defense layers against malicious accounts, spam floods, scam links, rogue bots, invites, and external URLs.',
      autoModCounter: 'AutoMod rules used in this server:',
      banMalicious: {
        title: 'Ban Malicious Users',
        desc: 'Automatically ban joining users listed in the Global Ban Network.',
        off: 'Malicious users will not be auto-banned on join',
        on: 'Malicious users will be auto-banned on join',
      },
      antiFlood: {
        title: 'Anti Flood',
        desc: 'Sanction members sending rapid consecutive messages outside whitelisted channels.',
        off: 'Rapid message floods will not be sanctioned',
        on: 'Rapid consecutive floods will be automatically muted',
        premiumHint: 'Activate Premium to customize messages, window & mute duration',
        maxMsgs: 'Max messages',
        windowSec: 'Window (sec)',
        muteMin: 'Mute (min)',
      },
      antiScam: {
        title: 'Anti Scam',
        desc: 'Automatically detect and sanction scam images, phishing, and malicious URLs.',
        off: 'Scam content detection is disabled',
        on: 'Scam messages are deleted and authors sanctioned',
        premiumHint: 'Activate Premium to customize mute duration',
        muteMin: 'Mute duration (min)',
      },
      antiEveryone: {
        title: 'Anti Everyone Permissions',
        desc: 'Prevent dangerous privileges from being granted to the @everyone role.',
        off: '@everyone role changes will not trigger sanctions',
        on: 'Dangerous permissions are reverted and actor sanctioned',
      },
      antiWebhook: {
        title: 'Anti Webhook Spam',
        desc: 'Prevent mass spam attacks sent via compromised Discord webhooks.',
        off: 'Webhook spam protection is disabled',
        on: 'Compromised webhooks are purged and creators sanctioned',
      },
      antiMassMute: {
        title: 'Anti Mass Mute',
        desc: 'Prevent moderators or compromised accounts from mass-muting members.',
        maxMutes: 'Max mutes per minute',
      },
      antiAlts: {
        title: 'Anti Alts',
        desc: 'Kick newly created accounts younger than the minimum required age in days (max 730).',
        minDays: 'Minimum required days',
      },
      antiBots: {
        title: 'Anti Bots',
        desc: 'Control new bot additions and sanction the user who invited unauthorized bots.',
        offTitle: 'Disabled',
        offDesc: 'Added bots will not be banned automatically',
        unverifiedTitle: 'Unverified Bots',
        unverifiedDesc: 'Ban unverified bots and their inviter',
        allTitle: 'Ban All Bots',
        allDesc: 'Ban every newly added bot unless whitelisted',
      },
      antiInvites: {
        title: 'Anti Invites',
        desc: 'Automatically block external Discord server invite links.',
        off: 'Discord invites will not be blocked',
        on: 'Discord invite links will be automatically deleted',
      },
      antiLinks: {
        title: 'Anti Links',
        desc: 'Automatically block unauthorized external URLs across chat channels.',
        off: 'External links will not be blocked',
        on: 'All external links are blocked automatically',
        allowedDomains: 'Allowed domains (Premium)',
        domainPlaceholder: 'example.com',
      },
    },
    botPermissions: {
      title: 'Bot Permissions',
      infoTitle: 'What are Internal Bot Permissions?',
      infoDesc:
        'Grant internal moderation commands to Discord users or roles without giving them risky native Discord permissions.',
      bullets: [
        '6 available permissions: Ban, Unban, Mute, Unmute, Clear Messages, Kick.',
        'Granular support for both Discord users and roles.',
        'Configurable rate-limit per time window to prevent staff abuse.',
        'Every command is logged to your configured Log Channel.',
      ],
      usersBadge: 'USERS',
      rolesBadge: 'ROLES',
      addBtn: '+ Add permission',
      addNowBtn: '+ Add now',
      emptyText: 'No users or roles have internal bot permissions yet.',
      targetType: 'Target Type',
      userOption: 'Discord User',
      roleOption: 'Discord Role',
      targetIdLabel: 'Discord ID (Snowflake)',
      targetNameLabel: 'Name or label',
      rateLimitLabel: 'Rate-limit actions per window',
      actionsWindow: 'actions / min window',
      permsLabel: 'Authorized permissions',
      permLabels: {
        BAN: 'Ban',
        UNBAN: 'Unban',
        MUTE: 'Mute',
        UNMUTE: 'Unmute',
        CLEAR_MESSAGES: 'Clear messages',
        KICK: 'Kick',
      },
      tableTarget: 'Target',
      tablePerms: 'Permissions',
      tableRateLimit: 'Rate-Limit',
      tableActions: 'Actions',
    },
    whitelistExtra: {
      title: 'Security Whitelist',
      usersCardTitle: 'Whitelisted Users & Roles',
      usersCardDesc:
        'Whitelisted accounts are exempt from automatic Anti-Raid and protection sanctions.',
      channelsCardTitle: 'Whitelisted Channels',
      channelsCardDesc:
        'Anti-flood and spam protections are bypassed in whitelisted channels.',
      usersSection: 'Users, Roles & Bots',
      channelsSection: 'Whitelisted Channels',
      emptyUsers: 'No whitelisted users or roles.',
      emptyChannels: 'No whitelisted channels.',
      addUserBtn: '+ Add target',
      addChannelBtn: '+ Add channel',
      channelIdLabel: 'Channel or ID (Snowflake)',
      channelNameLabel: 'Channel name',
      reasonLabel: 'Exclusion reason',
      removeBtn: 'Remove',
    },
    verification: {
      title: 'Member Verification',
      subtitle:
        'Protect your community by requiring new members to pass a verification gate before accessing channels.',
      statusLabel: 'Verification Status',
      modeLabel: 'Verification Method',
      modes: {
        BUTTON: { title: 'Instant Button', desc: 'Fast one-click verification for active communities.' },
        CAPTCHA: { title: 'Visual/Numeric Captcha', desc: 'Interactive anti-selfbot challenge before granting access.' },
        REACTION: { title: 'Panel Reaction', desc: 'Pinned embed with controlled reaction verification.' },
        STRICT_2FA: { title: 'Strict Verification (Premium)', desc: 'Enhanced gate combined with Risk Engine scoring.' },
      },
      channelLabel: 'Verification panel channel',
      roleLabel: 'Verified role to grant',
      blockSuspicious: 'Automatically block high-risk accounts detected by the Risk Engine',
      autoKickMin: 'Auto-kick if unverified after (minutes · Premium)',
      panelTitleLabel: 'Verification embed title',
      panelDescLabel: 'Welcome instructions',
      previewTitle: 'Discord Panel Preview',
    },
    logChannel: {
      title: 'Log Channel',
      configTitle: 'Configure Logs',
      availableChannels: 'Available server channels',
      manualChannelPlaceholder: 'Log channel ID (17-20 digits)',
      sendTestBtn: 'Send test message',
      testSentOk: 'Test embed delivered to the Discord channel.',
      eventsTitle: 'Events routed to channel',
      eventLabels: {
        moderation: 'Moderation Actions',
        antiRaid: 'Anti-Raid Alerts & Mitigations',
        antiNuke: 'Anti-Nuke & Audit Detections',
        verification: 'Verification Logs',
        backups: 'Backup Creation & Restorations',
      },
      faqTitle: 'Frequently Asked Questions',
      faqs: [
        {
          q: 'What gets sent to the Log Channel?',
          a: 'Real-time security warnings, automated AEGIS mitigations, and moderation actions executed via internal bot permissions.',
        },
        {
          q: 'What alert types will I receive?',
          a: 'Raid bursts, suspicious channel or role mutations, Global Ban blocks, and critical configuration changes.',
        },
        {
          q: 'Which channel should I pick?',
          a: 'Use a private staff-only channel so moderation evidence and raid diagnostics remain confidential.',
        },
      ],
    },
    backups: {
      title: 'Server Backups',
      subtitle:
        'Safeguard server roles, channels, whitelists, and security policies in isolated per-server JSON snapshots.',
      createBtn: 'Create Backup Now',
      namePlaceholder: 'Snapshot name (e.g., Pre-event snapshot)',
      emptyTitle: 'No backups saved for this server yet.',
      autoScheduleLabel: 'Automated Backups',
      scheduleOff: 'Disabled',
      scheduleDaily: 'Auto (Plan cadence)',
      scheduleWeekly: 'Auto (Plan cadence)',
      downloadJson: 'Download JSON',
      restoreBtn: 'Restore Policies',
      faqTitle: 'Backups FAQ',
      faqs: [
        {
          q: 'How many backups can I keep and how often do auto-backups run?',
          a: 'Free Plan: max 1 snapshot (auto every 7 days). Gold Plan: max 5 (every 3 days). Diamond Plan: max 10 (every 1 day). Creation stops automatically once the cap is reached until a snapshot is deleted.',
        },
        {
          q: 'How do I create a manual backup?',
          a: 'Enter a descriptive snapshot name above and click "Create Backup Now". AEGIS saves roles, channels, and full security policies for this server.',
        },
        {
          q: 'What happens when I reach my backup limit?',
          a: 'Both automated and manual backups pause once your server reaches its tier limit (1, 5, or 10) until you delete an existing snapshot.',
        },
        {
          q: 'Are chat messages saved inside Backups?',
          a: 'No. Due to privacy and Discord API boundaries, backups store server structure and security rules—never private message history.',
        },
      ],
    },
    twoFactor: {
      title: 'Manage 2FA (Two-Factor Authentication)',
      subtitle:
        'Protect your account and critical dashboard operations with RFC-6238 TOTP codes compatible with Google Authenticator, Authy, or 1Password.',
      statusActive: '2FA ACTIVE & PROTECTED',
      statusInactive: '2FA NOT CONFIGURED',
      startSetupBtn: 'Generate TOTP 2FA Secret',
      secretLabel: 'Base32 Secret Key (enter manually in your authenticator app)',
      otpUriLabel: 'otpauth:// URI (password manager compatible)',
      enterCodeLabel: '6-digit code from your authenticator app',
      confirmEnableBtn: 'Verify & Enable 2FA',
      recoveryTitle: 'Single-use recovery codes',
      recoveryDesc: 'Store these safely. Each code can only be used once.',
      verifyActionTitle: 'Test or validate current code',
      verifyBtn: 'Validate code',
      disableBtn: 'Disable 2FA',
    },
    secondaryOwner: {
      title: 'Secondary Owner',
      subtitle:
        'Assign a trusted backup account so you can retain full AEGIS control over this server if you ever lose access to your primary Discord account.',
      whyTitle: 'Zero-Trust Operational Continuity',
      whyDesc:
        'Only the verified Discord Primary Owner can assign or revoke the Secondary Owner. If primary access is lost, the backup owner keeps full dashboard administration.',
      primaryOwnerOnly: 'Only the Primary Discord Server Owner can modify this setting.',
      discordIdLabel: 'Secondary Owner Discord ID (Snowflake)',
      usernameLabel: 'Discord username',
      noteLabel: 'Verification note (optional)',
      assignBtn: 'Assign Secondary Owner',
      revokeBtn: 'Revoke Secondary Owner',
      currentTitle: 'Active Secondary Owner',
      noneTitle: 'No Secondary Owner assigned',
    },
    premium: {
      title: 'AEGIS Plans & Memberships',
      subtitle:
        'Redeem license codes or receive Staff grants. Active duration accumulates automatically and can be assigned across your authorized servers.',
      activeBadge: 'ACTIVE MEMBERSHIP',
      freeBadge: 'FREE PLAN',
      activateBtn: 'Activate on this server',
      deactivateBtn: 'Release slot from server',
      licensePlaceholder: 'Enter redemption code (e.g., AEGIS-XXXX-XXXX)',
      compareTitle: 'Detailed Plan Comparison',
      features: [
        { name: 'Simultaneous Premium server slots', free: '0 servers', pro: 'Gold: 1 · Diamond: 5' },
        { name: 'Automated backups & snapshot capacity', free: '1 max (every 7 days)', pro: 'Gold: 5 (every 3d) · Diamond: 10 (every 1d)' },
        { name: 'Granular Anti-Raid (Channel/Role Edit, Emojis, Webhooks)', free: 'Core (8 rules)', pro: 'Full Suite (12 rules)' },
        { name: 'Anti Mass Mute & custom Flood/Scam thresholds', free: 'Standard', pro: 'Custom + Mass Mute' },
        { name: 'Anti Links Domain Whitelist', free: 'Block all', pro: 'Gold: 15 · Diamond: 50 domains' },
        { name: 'Whitelist Quotas (Users / Channels)', free: '10 users / 3 channels', pro: 'Gold: 50/20 · Diamond: 250/100' },
        { name: 'Internal Bot Permissions (Users / Roles)', free: '5 users / 3 roles', pro: 'Gold: 25/12 · Diamond: 100/50' },
      ],
    },
    help: {
      supportTitle: 'AEGIS Support Center',
      supportSubtitle: 'Live incident playbooks, diagnostics, and security operations guidance.',
      docsTitle: 'Documentation & Architecture',
      docsSubtitle: 'Step-by-step guides to harden Discord communities with zero false positives.',
      cards: [
        {
          title: 'Active Raid Response',
          desc: 'Enable Emergency Lockdown, switch Anti-Raid to STRICT, and verify recent channel snapshots in Backups.',
          badge: 'Response < 30s',
        },
        {
          title: 'Safe Whitelist Hygiene',
          desc: 'Whitelist only verified bots and trusted staff channels to prevent lateral bypasses.',
          badge: 'Zero-Trust',
        },
        {
          title: 'Bot Role Hierarchy',
          desc: 'Keep the AEGIS role positioned above moderation roles to guarantee Anti-Nuke isolation.',
          badge: 'Discord Hierarchy',
        },
      ],
      guides: [
        {
          title: '1. 5-Minute Server Hardening',
          summary: 'Recommended checklist when connecting AEGIS to a server.',
          steps: [
            'Assign a private staff-only Log Channel.',
            'Enable Anti-Raid System rules with Quarantine or Strip Roles.',
            'Enable Anti Bots (Unverified Bots), Anti Everyone, and Anti Scam.',
            'Create your first Backup snapshot and assign a Secondary Owner.',
          ],
        },
        {
          title: '2. Zero-Risk Internal Bot Permissions',
          summary: 'Delegate moderation without granting native Discord Administrator.',
          steps: [
            'Open Bot Permissions and add your moderation team role.',
            'Grant only needed commands (Mute, Kick, Clear Messages).',
            'Set a strict per-minute rate limit (e.g., 5 actions / 10 mins).',
          ],
        },
      ],
    },
  },
};

export function getSuiteCopy(language: LanguageCode): SuiteCopy {
  return SUITE_DICT[language] ?? SUITE_DICT.es;
}
