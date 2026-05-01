import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as crypto from 'crypto';
import { exec } from 'child_process';

export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_ENDPOINT = 'https://auth.openai.com/oauth/authorize';
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';
const SCOPES = 'openid profile email offline_access';
const CALLBACK_PORT = 1455;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;

export interface CodexTokens {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  account_id?: string;
  expires_at: number; // Unix seconds
}

export interface CodexCredentials {
  accessToken: string;
  accountId: string;
}

export function defaultAuthPath(): string {
  return path.join(os.homedir(), '.nanocontext', 'auth.json');
}

function decodeJwtClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === 'win32' ? `start "" "${url}"` : platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}

export class CodexAuthStore {
  private readonly authPath: string;

  constructor(authPath?: string) {
    this.authPath = authPath ?? defaultAuthPath();
  }

  isAvailable(): boolean {
    return !!(this.readFile()?.access_token);
  }

  async getCredentials(): Promise<CodexCredentials> {
    const tokens = this.readFile();
    if (!tokens?.access_token) {
      throw new Error('Not authenticated. Run `nc codex login` first.');
    }

    const isExpired = (tokens.expires_at - 300) * 1000 < Date.now();
    if (isExpired) {
      if (!tokens.refresh_token) {
        throw new Error('Session expired. Run `nc codex login` to re-authenticate.');
      }
      return this.refreshAndSave(tokens.refresh_token, tokens.account_id ?? '');
    }

    return { accessToken: tokens.access_token, accountId: tokens.account_id ?? '' };
  }

  getStatus(): { authenticated: boolean; expired: boolean; expiresAt: Date | null; accountId: string } {
    const tokens = this.readFile();
    if (!tokens?.access_token) {
      return { authenticated: false, expired: true, expiresAt: null, accountId: '' };
    }
    const expiresAt = new Date(tokens.expires_at * 1000);
    const expired = tokens.expires_at * 1000 < Date.now();
    return { authenticated: true, expired, expiresAt, accountId: tokens.account_id ?? '' };
  }

  logout(): void {
    if (fs.existsSync(this.authPath)) {
      fs.unlinkSync(this.authPath);
    }
  }

  async login(onUrl?: (url: string) => void): Promise<void> {
    const { verifier, challenge } = generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CODEX_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
    });

    const authUrl = `${AUTH_ENDPOINT}?${params.toString()}`;

    const code = await this.waitForCallback(state, () => {
      if (onUrl) {
        onUrl(authUrl);
      } else {
        openBrowser(authUrl);
      }
    });

    await this.exchangeCodeForTokens(code, verifier);
  }

  private waitForCallback(expectedState: string, onReady: () => void): Promise<string> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`);
        if (url.pathname !== '/auth/callback') {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Authentication failed.</h2><p>You can close this tab.</p></body></html>');
          server.close();
          clearTimeout(timer);
          reject(new Error(`OAuth error: ${error} — ${url.searchParams.get('error_description') ?? ''}`));
          return;
        }

        if (!code || state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Invalid callback.</h2></body></html>');
          server.close();
          clearTimeout(timer);
          reject(new Error('OAuth callback had invalid state or missing code.'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Authenticated successfully!</h2><p>You can close this tab and return to the terminal.</p></body></html>');
        server.close();
        clearTimeout(timer);
        resolve(code);
      });

      server.listen(CALLBACK_PORT, '127.0.0.1', () => {
        onReady();
      });

      server.on('error', (err) => {
        clearTimeout(timer);
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'EACCES') {
          reject(new Error(
            `Port ${CALLBACK_PORT} is blocked (Windows reserved port range).\n` +
            `Fix: run this command as Administrator and retry:\n` +
            `  netsh int ipv4 delete excludedportrange protocol=tcp numberofports=1 startport=${CALLBACK_PORT}`,
          ));
        } else if (e.code === 'EADDRINUSE') {
          reject(new Error(`Port ${CALLBACK_PORT} is already in use. Close the process using it and try again.`));
        } else {
          reject(new Error(`Could not start callback server on port ${CALLBACK_PORT}: ${e.message}`));
        }
      });

      timer = setTimeout(() => {
        server.close();
        reject(new Error('Authentication timed out. Please try again.'));
      }, 5 * 60 * 1000);
    });
  }

  private async exchangeCodeForTokens(code: string, verifier: string): Promise<void> {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CODEX_CLIENT_ID,
        code_verifier: verifier,
      }).toString(),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${body}`);
    }

    const data = await res.json() as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error('Token exchange returned no access_token.');
    }

    const claims = decodeJwtClaims(data.access_token);
    const auth = claims['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
    const accountId = (auth?.chatgpt_account_id as string | undefined) ?? '';
    const expiresAt = typeof claims.exp === 'number' ? claims.exp : Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600);

    this.saveTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? '',
      id_token: data.id_token,
      account_id: accountId,
      expires_at: expiresAt,
    });
  }

  private async refreshAndSave(refreshToken: string, accountId: string): Promise<CodexCredentials> {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CODEX_CLIENT_ID,
      }).toString(),
    });

    if (!res.ok) {
      throw new Error(`Token refresh failed (${res.status}). Run \`nc codex login\` to re-authenticate.`);
    }

    const data = await res.json() as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error('Token refresh returned no access_token. Run `nc codex login` to re-authenticate.');
    }

    const claims = decodeJwtClaims(data.access_token);
    const auth = claims['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
    const newAccountId = (auth?.chatgpt_account_id as string | undefined) ?? accountId;
    const expiresAt = typeof claims.exp === 'number' ? claims.exp : Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600);

    this.saveTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? refreshToken,
      id_token: data.id_token,
      account_id: newAccountId,
      expires_at: expiresAt,
    });

    return { accessToken: data.access_token, accountId: newAccountId };
  }

  private readFile(): CodexTokens | null {
    if (!fs.existsSync(this.authPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.authPath, 'utf-8')) as CodexTokens;
    } catch {
      return null;
    }
  }

  private saveTokens(tokens: CodexTokens): void {
    const dir = path.dirname(this.authPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.authPath, JSON.stringify(tokens, null, 2), 'utf-8');
  }
}
