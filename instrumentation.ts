export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureBotStarted } = await import('./lib/server/bot-runner');
    ensureBotStarted();
  }
}
