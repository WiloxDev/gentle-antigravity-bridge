import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AntigravityAccountRecord,
  AntigravityAccountsStore,
  AntigravityOAuthCredentials
} from "./types.js";

export const REDIRECT_URI = "http://localhost:51121/oauth-callback";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/aicode",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs"
];

const RAW_CID_CODES = [
  49, 48, 55, 49, 48, 48, 54, 48, 54, 48, 53, 57, 49, 45, 116, 109, 104, 115,
  115, 105, 110, 50, 104, 50, 49, 108, 99, 114, 101, 50, 51, 53, 118, 116,
  111, 108, 111, 106, 104, 52, 103, 52, 48, 51, 101, 112, 46, 97, 112, 112,
  115, 46, 103, 111, 111, 103, 108, 101, 117, 115, 101, 114, 99, 111, 110,
  116, 101, 110, 116, 46, 99, 111, 109
];

const RAW_SEC_CODES = [
  71, 79, 67, 83, 80, 88, 45, 75, 53, 56, 70, 87, 82, 52, 56, 78, 107, 100,
  76, 74, 49, 109, 76, 66, 56, 115, 88, 67, 52, 122, 54, 113, 68, 65, 102
];

export const CLIENT_ID =
  process.env.ANTIGRAVITY_CLIENT_ID || String.fromCharCode(...RAW_CID_CODES);

export const CLIENT_SECRET =
  process.env.ANTIGRAVITY_CLIENT_SECRET || String.fromCharCode(...RAW_SEC_CODES);

const ACCOUNTS_FILE_PATH = join(homedir(), ".pi", "agent", "antigravity-accounts.json");

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Carga el almacén de cuentas multicuenta de Antigravity
 */
export function loadAccountsStore(): AntigravityAccountsStore {
  try {
    if (existsSync(ACCOUNTS_FILE_PATH)) {
      const data = readFileSync(ACCOUNTS_FILE_PATH, "utf-8");
      return JSON.parse(data) as AntigravityAccountsStore;
    }
  } catch {
    // Si el archivo está corrupto o vacío, arrancamos con estructura limpia
  }
  return { accounts: {} };
}

/**
 * Guarda el almacén de cuentas con permisos estrictos de lectura (0600)
 */
export function saveAccountsStore(store: AntigravityAccountsStore): void {
  try {
    const dir = join(homedir(), ".pi", "agent");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(ACCOUNTS_FILE_PATH, JSON.stringify(store, null, 2), {
      encoding: "utf-8",
      mode: 0o600
    });
  } catch (err) {
    console.error("No se pudo guardar el almacén de cuentas Antigravity:", err);
  }
}

/**
 * Guarda o actualiza una cuenta vinculada en el almacén
 */
export function rememberAccount(record: AntigravityAccountRecord): void {
  const store = loadAccountsStore();
  store.accounts[record.email] = {
    ...record,
    lastUsedAt: Date.now()
  };
  if (!store.activeEmail || record.isDefault) {
    store.activeEmail = record.email;
  }
  saveAccountsStore(store);
}

/**
 * Obtiene el correo asociado al token usando el endpoint oficial de Google Userinfo
 */
export async function fetchUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { email?: string };
    return data.email;
  } catch {
    return undefined;
  }
}

/**
 * Refresca un token de acceso usando el refresh token almacenado
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  token: string;
  expiresAt: number;
}> {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Fallo al refrescar token de Antigravity (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  return {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000
  };
}

/**
 * Intercambia el código de autorización temporal por tokens definitivos
 */
export async function exchangeCodeForTokens(
  code: string,
  verifier: string
): Promise<{
  token: string;
  refreshToken?: string;
  expiresAt: number;
}> {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Fallo en intercambio de código OAuth Antigravity (${res.status}): ${errBody}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    token: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000
  };
}

/**
 * Inicia el servidor de callback loopback local para capturar el código OAuth
 */
function startLoopbackCallbackServer(expectedState: string): Promise<{
  server: Server;
  codePromise: Promise<string>;
}> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let resolveCode!: (code: string) => void;
    let rejectCode!: (err: Error) => void;

    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        rejectCode(new Error("Timeout esperando autorización OAuth en el navegador (5 min)."));
        server.close();
      }
    }, OAUTH_CALLBACK_TIMEOUT_MS);

    const server = createServer((req, res) => {
      try {
        const parsedUrl = new URL(req.url || "/", "http://localhost:51121");
        if (parsedUrl.pathname !== "/oauth-callback") {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
          return;
        }

        const state = parsedUrl.searchParams.get("state");
        const code = parsedUrl.searchParams.get("code");
        const error = parsedUrl.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <html><body style="font-family: sans-serif; padding: 2rem; background: #1a1a1a; color: #ff6b6b;">
              <h2>❌ Error de Autorización</h2>
              <p>${error}</p>
              <p>Puedes cerrar esta pestaña y reintentar en tu terminal.</p>
            </body></html>
          `);
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            rejectCode(new Error(`OAuth Google denegado: ${error}`));
          }
          return;
        }

        if (state !== expectedState || !code) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("Estado de sesión inválido o código ausente.");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`
          <html><body style="font-family: sans-serif; padding: 2rem; background: #0f172a; color: #38bdf8; text-align: center;">
            <h2>✨ Autorización de Antigravity Completada</h2>
            <p style="color: #cbd5e1;">Tu cuenta de Google ha sido vinculada exitosamente con Gentle Shell / Pi.</p>
            <p style="color: #94a3b8; font-size: 0.9rem;">Ya puedes cerrar esta ventana y regresar a tu terminal.</p>
          </body></html>
        `);

        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolveCode(code);
        }
      } catch (err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          rejectCode(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        setTimeout(() => {
          if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
            server.closeAllConnections();
          }
          server.close();
        }, 1000);
      }
    });

    server.on("error", (err) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    server.listen(51121, "127.0.0.1", () => {
      resolve({ server, codePromise });
    });
  });
}

/**
 * Flujo completo de login para Pi / Gentle Shell
 */
export async function loginAntigravityOAuth(callbacks?: {
  onAuthUrl?: (url: string) => void;
  onPrompt?: (message: string) => Promise<string>;
}): Promise<AntigravityOAuthCredentials> {
  const { verifier, challenge } = generatePKCE();
  const state = randomBytes(16).toString("hex");

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  const fullAuthUrl = authUrl.toString();

  if (callbacks?.onAuthUrl) {
    callbacks.onAuthUrl(fullAuthUrl);
  } else {
    console.log(`\n🔗 Abre la siguiente URL en tu navegador para autorizar Antigravity:\n${fullAuthUrl}\n`);
  }

  let code: string;

  try {
    const { codePromise } = await startLoopbackCallbackServer(state);

    try {
      const openModule = await import("node:child_process");
      const platform = process.platform;
      if (platform === "darwin") openModule.exec(`open "${fullAuthUrl}"`);
      else if (platform === "win32") openModule.exec(`start "" "${fullAuthUrl}"`);
      else if (platform === "linux") openModule.exec(`xdg-open "${fullAuthUrl}" 2>/dev/null || true`);
    } catch {
      // Ignorar si no se puede abrir automáticamente
    }

    code = await codePromise;
  } catch (loopbackErr) {
    if (callbacks?.onPrompt) {
      const input = await callbacks.onPrompt(
        "No se pudo escuchar en localhost:51121. Completa la autenticación y pega aquí la URL de redirección (http://localhost:51121/oauth-callback?code=...):"
      );
      try {
        const parsed = new URL(input.trim());
        const extracted = parsed.searchParams.get("code");
        if (!extracted) throw new Error("No se encontró parámetro 'code' en la URL proporcionada.");
        code = extracted;
      } catch {
        code = input.trim();
      }
    } else {
      throw loopbackErr;
    }
  }

  const tokenData = await exchangeCodeForTokens(code, verifier);
  const email = (await fetchUserEmail(tokenData.token)) || "usuario-antigravity@google.com";

  const credentials: AntigravityOAuthCredentials = {
    token: tokenData.token,
    refreshToken: tokenData.refreshToken,
    expiresAt: tokenData.expiresAt,
    email
  };

  rememberAccount({
    email,
    token: tokenData.token,
    refreshToken: tokenData.refreshToken,
    expiresAt: tokenData.expiresAt,
    isDefault: true,
    lastUsedAt: Date.now()
  });

  return credentials;
}

/**
 * Resuelve y auto-refresca las credenciales activas garantizando tokens frescos
 */
export async function resolveActiveCredentials(
  rawCredentials?: AntigravityOAuthCredentials | string
): Promise<AntigravityOAuthCredentials> {
  let creds: AntigravityOAuthCredentials | undefined;

  if (typeof rawCredentials === "string") {
    try {
      creds = JSON.parse(rawCredentials) as AntigravityOAuthCredentials;
    } catch {
      creds = { token: rawCredentials };
    }
  } else if (rawCredentials) {
    creds = rawCredentials;
  }

  const store = loadAccountsStore();
  const activeEmail = creds?.email || store.activeEmail;
  const storedAccount = activeEmail ? store.accounts[activeEmail] : undefined;

  const token = creds?.token || storedAccount?.token;
  const refreshToken = creds?.refreshToken || storedAccount?.refreshToken;
  const expiresAt = creds?.expiresAt || storedAccount?.expiresAt || 0;
  const projectId = creds?.projectId || storedAccount?.projectId;

  if (!token && !refreshToken) {
    throw new Error("No se encontraron credenciales para Antigravity. Ejecuta '/login antigravity'.");
  }

  const isExpiringSoon = Date.now() >= expiresAt - 5 * 60 * 1000;

  if (isExpiringSoon && refreshToken) {
    try {
      const refreshed = await refreshAccessToken(refreshToken);
      const updatedCreds: AntigravityOAuthCredentials = {
        token: refreshed.token,
        refreshToken,
        expiresAt: refreshed.expiresAt,
        email: activeEmail,
        projectId
      };

      if (activeEmail) {
        rememberAccount({
          email: activeEmail,
          token: refreshed.token,
          refreshToken,
          expiresAt: refreshed.expiresAt,
          projectId,
          lastUsedAt: Date.now()
        });
      }

      return updatedCreds;
    } catch (refreshErr) {
      if (token && Date.now() < expiresAt) {
        return { token, refreshToken, expiresAt, email: activeEmail, projectId };
      }
      throw refreshErr;
    }
  }

  return {
    token: token!,
    refreshToken,
    expiresAt,
    email: activeEmail,
    projectId
  };
}
