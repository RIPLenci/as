import { SlashCommandBuilder } from 'discord.js';

/**
 * AEGIS SECURITY — Registro de Comandos Slash en Español
 * Nombres limpios en español y descripciones uniformes con formato `Emoji | Descripción`.
 * Sin restricciones rígidas de Administrador para permitir operar al Dueño y Segundo Dueño.
 */
export function buildAegisSlashCommands() {
  const antiraid = new SlashCommandBuilder()
    .setName('antiraid')
    .setDescription('🛡️ | Protección Anti-Raid automática y escudos en tiempo real')
    .addSubcommand((s) =>
      s.setName('estado').setDescription('📊 | Ver el estado actual y nivel del escudo Anti-Raid')
    )
    .addSubcommand((s) =>
      s.setName('activar').setDescription('🟢 | Activar la protección automática Anti-Raid en este servidor')
    )
    .addSubcommand((s) =>
      s.setName('desactivar').setDescription('🔴 | Desactivar la protección automática Anti-Raid')
    )
    .addSubcommand((s) =>
      s
        .setName('modo')
        .setDescription('⚡ | Cambiar el modo de sensibilidad (Normal, Estricto o Emergencia)')
        .addStringOption((o) =>
          o
            .setName('modo')
            .setDescription('Nivel de sensibilidad del motor')
            .setRequired(true)
            .addChoices(
              { name: '👁️ Observación (MONITORING — solo registrar)', value: 'MONITORING' },
              { name: '🔔 Solo Alerta (ALERT_ONLY — sin sanciones)', value: 'ALERT_ONLY' },
              { name: '🟢 Normal (Equilibrado)', value: 'NORMAL' },
              { name: '🟠 Estricto (Alta sensibilidad)', value: 'STRICT' },
              { name: '🔴 Emergencia (Tolerancia cero)', value: 'EMERGENCY' }
            )
        )
    )
    .addSubcommand((s) =>
      s
        .setName('configurar')
        .setDescription('⚙️ | Ajustar límite de ingresos, ventana y antigüedad mínima')
        .addIntegerOption((o) =>
          o.setName('ingresos').setDescription('Máximo de ingresos permitidos').setMinValue(2).setMaxValue(200)
        )
        .addIntegerOption((o) =>
          o.setName('ventana').setDescription('Ventana de tiempo en segundos').setMinValue(2).setMaxValue(300)
        )
        .addIntegerOption((o) =>
          o
            .setName('dias_minimos')
            .setDescription('Antigüedad mínima de cuenta en días')
            .setMinValue(0)
            .setMaxValue(365)
        )
    )
    .addSubcommand((s) =>
      s.setName('probar').setDescription('🧪 | Ejecutar simulación diagnóstica del Motor de Riesgo')
    )
    .addSubcommand((s) =>
      s.setName('incidentes').setDescription('🚨 | Listar incidentes recientes de seguridad Anti-Raid')
    );

  const antinuke = new SlashCommandBuilder()
    .setName('antinuke')
    .setDescription('💣 | Defensa Anti-Nuke contra destrucción masiva de canales y roles')
    .addSubcommand((s) =>
      s.setName('estado').setDescription('📊 | Consultar el estado y métricas del escudo Anti-Nuke')
    )
    .addSubcommand((s) =>
      s.setName('activar').setDescription('🟢 | Activar defensa Anti-Nuke con contención inmediata')
    )
    .addSubcommand((s) =>
      s.setName('desactivar').setDescription('🔴 | Desactivar temporalmente la defensa Anti-Nuke')
    )
    .addSubcommand((s) =>
      s
        .setName('configurar')
        .setDescription('⚙️ | Definir límites máximos de canales y roles modificados')
        .addIntegerOption((o) =>
          o
            .setName('max_canales_borrados')
            .setDescription('Máximo de eliminaciones de canales')
            .setMinValue(1)
            .setMaxValue(50)
        )
        .addIntegerOption((o) =>
          o
            .setName('max_cambios_roles')
            .setDescription('Máximo de cambios de roles')
            .setMinValue(1)
            .setMaxValue(50)
        )
    )
    .addSubcommand((s) =>
      s.setName('incidentes').setDescription('🚨 | Mostrar alertas críticas recientes de Anti-Nuke')
    );

  const seguridad = new SlashCommandBuilder()
    .setName('seguridad')
    .setDescription('🔐 | Módulos de seguridad (Anti-Alts, Anti-Bots, Anti-Scam y Anti-Flood)')
    .addSubcommand((s) =>
      s.setName('estado').setDescription('📊 | Ver el estado de todas las capas de seguridad adicional')
    )
    .addSubcommand((s) =>
      s
        .setName('antialts')
        .setDescription('🕵️ | Configurar filtro Anti-Alts por antigüedad mínima de cuenta')
        .addBooleanOption((o) => o.setName('activo').setDescription('Activar o desactivar').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('dias_minimos').setDescription('Días mínimos de cuenta (1-730)').setMinValue(1).setMaxValue(730)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('antibots')
        .setDescription('🤖 | Configurar política de admisión y bloqueo de bots')
        .addStringOption((o) =>
          o
            .setName('politica')
            .setDescription('Política de filtrado de bots')
            .setRequired(true)
            .addChoices(
              { name: '⚪ Desactivado', value: 'DISABLED' },
              { name: '🟡 Solo bots no verificados', value: 'UNVERIFIED_ONLY' },
              { name: '🔴 Banear todos los bots', value: 'BAN_ALL' }
            )
        )
    )
    .addSubcommand((s) =>
      s
        .setName('antiinvitaciones')
        .setDescription('🚫 | Activar o desactivar el bloqueo de invitaciones de Discord')
        .addBooleanOption((o) => o.setName('activo').setDescription('Activar o desactivar').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('antienlaces')
        .setDescription('🔗 | Activar o desactivar el filtro de enlaces externos')
        .addBooleanOption((o) => o.setName('activo').setDescription('Activar o desactivar').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('antiflood')
        .setDescription('🌊 | Activar o desactivar la mitigación rápida Anti-Flood')
        .addBooleanOption((o) => o.setName('activo').setDescription('Activar o desactivar').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('antiscam')
        .setDescription('🎣 | Activar o desactivar la detección de estafas y phishing')
        .addBooleanOption((o) => o.setName('activo').setDescription('Activar o desactivar').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('antieveryone')
        .setDescription('📢 | Proteger el rol @everyone contra escalamiento de permisos')
        .addBooleanOption((o) => o.setName('activo').setDescription('Activar o desactivar').setRequired(true))
    );

  const cuarentena = new SlashCommandBuilder()
    .setName('cuarentena')
    .setDescription('⛓️ | Gestión de cuarentena y aislamiento inmediato de cuentas')
    .addSubcommand((s) =>
      s
        .setName('aislar')
        .setDescription('🔒 | Aislar a un usuario sospechoso en cuarentena de seguridad')
        .addUserOption((o) => o.setName('usuario').setDescription('Miembro objetivo').setRequired(true))
        .addStringOption((o) => o.setName('motivo').setDescription('Motivo de cuarentena').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('horas').setDescription('Duración en horas').setMinValue(1).setMaxValue(720)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('liberar')
        .setDescription('🔓 | Liberar a un usuario de la cuarentena activa')
        .addUserOption((o) => o.setName('usuario').setDescription('Miembro objetivo').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('lista').setDescription('📋 | Listar las cuentas actualmente aisladas en cuarentena')
    )
    .addSubcommand((s) =>
      s
        .setName('detalle')
        .setDescription('🔍 | Consultar el historial y motivo de cuarentena de un usuario')
        .addUserOption((o) => o.setName('usuario').setDescription('Miembro objetivo').setRequired(true))
    );

  const bloqueo = new SlashCommandBuilder()
    .setName('bloqueo')
    .setDescription('🚨 | Bloqueo de emergencia (Lockdown) reversible por servidor')
    .addSubcommand((s) =>
      s
        .setName('activar')
        .setDescription('🔒 | Activar bloqueo de emergencia en los canales del servidor')
        .addStringOption((o) => o.setName('motivo').setDescription('Motivo del bloqueo'))
        .addIntegerOption((o) =>
          o.setName('minutos').setDescription('Duración en minutos').setMinValue(1).setMaxValue(1440)
        )
    )
    .addSubcommand((s) =>
      s.setName('desactivar').setDescription('🔓 | Desactivar el bloqueo y restaurar los permisos previos')
    )
    .addSubcommand((s) =>
      s.setName('estado').setDescription('📊 | Consultar el estado actual del bloqueo y canales cerrados')
    )
    .addSubcommand((s) =>
      s
        .setName('configurar')
        .setDescription('⚙️ | Ajustar restricciones de texto y voz durante el bloqueo')
        .addBooleanOption((o) =>
          o.setName('bloquear_mensajes').setDescription('Bloquear envío de mensajes')
        )
        .addBooleanOption((o) =>
          o.setName('bloquear_voz').setDescription('Bloquear conexión a canales de voz')
        )
    );

  const whitelist = new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('📜 | Gestión de lista blanca y excepciones de seguridad por regla')
    .addSubcommand((s) =>
      s
        .setName('agregar')
        .setDescription('✅ | Añadir un usuario o bot de confianza a la lista blanca')
        .addUserOption((o) => o.setName('usuario').setDescription('Usuario o bot').setRequired(true))
        .addStringOption((o) => o.setName('motivo').setDescription('Justificación').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('regla')
            .setDescription('Regla excluida')
            .setRequired(true)
            .addChoices(
              { name: '⚡ Ráfaga de ingresos (JOIN_BURST)', value: 'JOIN_BURST' },
              { name: '📅 Antigüedad de cuenta (ACCOUNT_AGE)', value: 'ACCOUNT_AGE' },
              { name: '🤖 Detección de bots (BOT_DETECTION)', value: 'BOT_DETECTION' },
              { name: '💣 Defensa Anti-Nuke (ANTI_NUKE)', value: 'ANTI_NUKE' },
              { name: '🚨 Bypass de Lockdown (LOCKDOWN_BYPASS)', value: 'LOCKDOWN_BYPASS' }
            )
        )
    )
    .addSubcommand((s) =>
      s
        .setName('quitar')
        .setDescription('🗑️ | Revocar una excepción activa de la lista blanca')
        .addStringOption((o) => o.setName('id_objetivo').setDescription('ID de Discord').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('lista').setDescription('📋 | Listar todas las excepciones activas del servidor')
    )
    .addSubcommand((s) =>
      s
        .setName('verificar')
        .setDescription('🔍 | Consultar las excepciones asignadas a un ID de Discord')
        .addStringOption((o) => o.setName('id_objetivo').setDescription('ID de Discord').setRequired(true))
    );

  const premium = new SlashCommandBuilder()
    .setName('premium')
    .setDescription('👑 | Membresías Plan Oro y Diamante, canje de códigos y gestión')
    .addSubcommand((s) =>
      s
        .setName('anadir')
        .setDescription('➕ | [Staff] Añadir tiempo de Plan Oro o Diamante a un usuario')
        .addUserOption((o) =>
          o.setName('usuario').setDescription('Usuario beneficiario').setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName('tipo')
            .setDescription('Plan Premium')
            .setRequired(true)
            .addChoices(
              { name: '🥇 Plan Oro (1 servidor)', value: 'ORO' },
              { name: '💎 Plan Diamante (5 servidores)', value: 'DIAMANTE' }
            )
        )
        .addStringOption((o) =>
          o
            .setName('tiempo')
            .setDescription('Duración (1s=seg, 1m=min, 1h=hora, 1d=día, 1y=año)')
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('ver')
        .setDescription('👁️ | Consultar tu plan activo, tiempo restante y servidores')
        .addUserOption((o) =>
          o.setName('usuario').setDescription('Usuario a consultar (opcional)')
        )
    )
    .addSubcommand((s) =>
      s
        .setName('eliminar')
        .setDescription('🗑️ | [Staff] Revocar membresía Premium y desactivar beneficios')
        .addUserOption((o) =>
          o.setName('usuario').setDescription('Usuario objetivo').setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('codigo')
        .setDescription('🎟️ | [Staff] Generar código canjeable para Plan Oro o Diamante')
        .addStringOption((o) =>
          o
            .setName('tipo')
            .setDescription('Tipo de plan que otorga el código')
            .setRequired(true)
            .addChoices(
              { name: '🥇 Plan Oro', value: 'ORO' },
              { name: '💎 Plan Diamante', value: 'DIAMANTE' }
            )
        )
        .addStringOption((o) =>
          o
            .setName('tiempo')
            .setDescription('Duración (1s=seg, 1m=min, 1h=hora, 1d=día, 1y=año)')
            .setRequired(true)
        )
        .addIntegerOption((o) =>
          o.setName('usos').setDescription('Máximo de canjes permitidos').setMinValue(1).setMaxValue(500)
        )
        .addStringOption((o) =>
          o.setName('codigo').setDescription('Código personalizado opcional (mín. 4 caracteres)')
        )
    )
    .addSubcommand((s) =>
      s
        .setName('canjear')
        .setDescription('🎁 | Canjear un código Premium y acumular tiempo en tu cuenta')
        .addStringOption((o) =>
          o.setName('codigo').setDescription('Código recibido').setRequired(true)
        )
    );

  const aegis = new SlashCommandBuilder()
    .setName('aegis')
    .setDescription('⚡ | Centro de control interactivo y diagnóstico de AEGIS SECURITY')
    .addSubcommand((s) =>
      s.setName('panel').setDescription('🎛️ | Abrir el panel interactivo Components V2 del servidor')
    )
    .addSubcommand((s) =>
      s.setName('estado').setDescription('📊 | Ver el resumen general de seguridad y plan del servidor')
    )
    .addSubcommand((s) =>
      s.setName('diagnostico').setDescription('🩺 | Verificar permisos del bot, latencia y caché en vivo')
    )
    .addSubcommand((s) =>
      s.setName('ayuda').setDescription('📖 | Mostrar la guía completa de comandos slash disponibles')
    );

  return [antiraid, antinuke, seguridad, cuarentena, bloqueo, whitelist, premium, aegis].map((c) =>
    c.toJSON()
  );
}
