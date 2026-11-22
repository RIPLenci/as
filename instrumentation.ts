export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.AEGIS_EMBEDDED_BOT === 'true' &&
    process.env.AEGIS_STANDALONE_BOT !== 'true'
  ) {
    const { ensureBotStarted } = await import('./lib/server/bot-runner');
    ensureBotStarted();
  }
}

