import { colors } from '../utils/colors';
import { CodexAuthStore, defaultAuthPath } from '../../core/llm/auth/CodexAuthStore';

export async function codexLoginCommand(): Promise<void> {
  const store = new CodexAuthStore();

  const existing = store.getStatus();
  if (existing.authenticated && !existing.expired) {
    console.log(colors.green('Already authenticated.'));
    console.log(`  Account:  ${existing.accountId}`);
    console.log(`  Expires:  ${existing.expiresAt?.toLocaleString()}`);
    console.log(colors.dim('  Run `nc codex logout` first to re-authenticate.'));
    return;
  }

  console.log('Opening browser for OpenAI authentication...');
  console.log(colors.dim('If the browser does not open, copy the URL below and open it manually.\n'));

  try {
    await store.login((url) => {
      console.log(colors.cyan(url));
      console.log();
      // also try to open browser
      const { exec } = require('child_process') as typeof import('child_process');
      const platform = process.platform;
      const cmd = platform === 'win32' ? `start "" "${url}"` : platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd);
    });

    const status = store.getStatus();
    console.log(colors.green('\nAuthenticated successfully!'));
    console.log(`  Account:  ${status.accountId}`);
    console.log(`  Expires:  ${status.expiresAt?.toLocaleString()}`);
    console.log(`  Stored:   ${defaultAuthPath()}`);
  } catch (err) {
    console.error(colors.red(`\nAuthentication failed: ${(err as Error).message}`));
    process.exit(1);
  }
}

export function codexStatusCommand(): void {
  const store = new CodexAuthStore();
  const status = store.getStatus();

  console.log(colors.bold('Codex OAuth'));
  console.log(`  Auth file: ${defaultAuthPath()}`);

  if (!status.authenticated) {
    console.log(`  Status:    ${colors.red('Not authenticated')}`);
    console.log(`  Fix:       Run ${colors.cyan('nc codex login')}`);
    return;
  }

  if (status.expired) {
    console.log(`  Status:    ${colors.yellow('Token expired')}`);
    console.log(`  Expired:   ${status.expiresAt?.toLocaleString()}`);
    console.log(`  Fix:       NanoContext will auto-refresh on next use, or run ${colors.cyan('nc codex login')}`);
  } else {
    console.log(`  Status:    ${colors.green('Authenticated')}`);
    console.log(`  Expires:   ${status.expiresAt?.toLocaleString()}`);
  }

  if (status.accountId) {
    console.log(`  Account:   ${status.accountId}`);
  }
}

export function codexLogoutCommand(): void {
  const store = new CodexAuthStore();
  const status = store.getStatus();

  if (!status.authenticated) {
    console.log(colors.dim('Not authenticated — nothing to do.'));
    return;
  }

  store.logout();
  console.log(colors.green('Logged out. Tokens removed from local storage.'));
}
