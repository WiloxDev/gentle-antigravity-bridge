import { createHash } from "node:crypto";
import type {
  AvailableModelsResponse,
  LoadCodeAssistResponse
} from "./types.js";

export const DEFAULT_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
export const ENDPOINT_FALLBACKS = [
  DEFAULT_ENDPOINT,
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://cloudcode-pa.googleapis.com"
];

export const CLIENT_USER_AGENT =
  "antigravity/cli/1.4.0 (aidev_client; os_type=linux; arch=amd64; cl=982146307; auth_method=consumer)";

let lastResolvedEndpoint = DEFAULT_ENDPOINT;
let prewarmed = false;

// Caché de proyectos y modelos en memoria
const projectCache = new Map<string, { projectId: string; expiresAt: number }>();

export function getActiveEndpoint(): string {
  return process.env.ANTIGRAVITY_BASE_URL || lastResolvedEndpoint;
}

export function setActiveEndpoint(endpoint: string): void {
  lastResolvedEndpoint = endpoint;
}

export function getClientHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": process.env.ANTIGRAVITY_USER_AGENT || CLIENT_USER_AGENT
  };
}

/**
 * Precalentamiento de socket TLS para reducir la latencia del primer token (TTFT)
 */
export function prewarmTlsConnection(endpoint = getActiveEndpoint()): void {
  if (prewarmed || process.env.ANTIGRAVITY_NO_PREWARM === "1") return;
  prewarmed = true;
  // Disparamos un OPTIONS/HEAD no bloqueante para pre-establecer el apretón de manos TLS
  fetch(`${endpoint}/v1internal:loadCodeAssist`, {
    method: "OPTIONS",
    signal: AbortSignal.timeout(3000)
  }).catch(() => {
    // Ignoramos errores de prewarm
  });
}

/**
 * Genera un ID de proyecto determinista a partir del email o token
 */
export function generateStableProjectId(seed: string): string {
  const hash = createHash("sha256").update(`antigravity:${seed}`).digest("hex");
  return `agy-${hash.slice(0, 12)}`;
}

/**
 * Ejecuta una llamada HTTP a los endpoints internos de Google con conmutación inteligente
 */
export async function executeCloudCodeRpc<T>(
  rpcPath: string,
  token: string,
  body: Record<string, unknown> = {},
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<{ data: T; endpoint: string }> {
  const endpoints = process.env.ANTIGRAVITY_BASE_URL
    ? [process.env.ANTIGRAVITY_BASE_URL]
    : ENDPOINT_FALLBACKS;

  let lastError: Error | undefined;

  for (const endpoint of endpoints) {
    try {
      const url = `${endpoint}${rpcPath.startsWith("/") ? rpcPath : `/${rpcPath}`}`;
      const timeoutSignal = AbortSignal.timeout(options?.timeoutMs || 10000);
      const combinedSignal = options?.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal;

      const res = await fetch(url, {
        method: "POST",
        headers: getClientHeaders(token),
        body: JSON.stringify(body),
        signal: combinedSignal
      });

      if (res.ok) {
        lastResolvedEndpoint = endpoint;
        const data = (await res.json()) as T;
        return { data, endpoint };
      }

      const errText = await res.text();
      // Si recibimos 401/403 o 429 cuota agotada, no tiene sentido recorrer otros endpoints
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw new Error(`Google Cloud Code error (${res.status}): ${errText}`);
      }

      lastError = new Error(`Endpoint ${endpoint} retornó HTTP ${res.status}: ${errText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Si fue abortado por el llamador, salimos inmediatamente
      if (options?.signal?.aborted) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error(`No se pudo conectar a ningún endpoint de Antigravity (${rpcPath})`);
}

/**
 * Carga metadatos de usuario y tier mediante /v1internal:loadCodeAssist
 */
export async function loadCodeAssist(token: string): Promise<LoadCodeAssistResponse | null> {
  try {
    const { data } = await executeCloudCodeRpc<LoadCodeAssistResponse>(
      "/v1internal:loadCodeAssist",
      token,
      {
        metadata: {
          ideType: "ANTIGRAVITY",
          platform: "PLATFORM_UNSPECIFIED",
          pluginType: "GEMINI",
          version: "1.4.0"
        }
      },
      { timeoutMs: 6000 }
    );
    return data;
  } catch {
    return null;
  }
}

/**
 * Resuelve y extrae el ID de proyecto activo
 */
export async function resolveProjectId(
  token: string,
  explicitProjectId?: string,
  seedEmail?: string
): Promise<string> {
  if (explicitProjectId) return explicitProjectId;
  if (process.env.ANTIGRAVITY_PROJECT_ID) return process.env.ANTIGRAVITY_PROJECT_ID;

  const cacheKey = seedEmail || token.slice(-16);
  const cached = projectCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.projectId;
  }

  // 1. Intentamos leerlo de loadCodeAssist
  const assist = await loadCodeAssist(token);
  if (assist) {
    const detected =
      assist.antigravityProjectId ||
      assist.projectId ||
      (typeof assist.cloudaicompanionProject === "string"
        ? assist.cloudaicompanionProject
        : assist.cloudaicompanionProject?.id);

    if (detected) {
      projectCache.set(cacheKey, {
        projectId: detected,
        expiresAt: Date.now() + 30 * 60 * 1000
      });
      return detected;
    }
  }

  // 2. Fallback determinista seguro
  const fallback = generateStableProjectId(seedEmail || "default-user");
  projectCache.set(cacheKey, {
    projectId: fallback,
    expiresAt: Date.now() + 30 * 60 * 1000
  });
  return fallback;
}

/**
 * Consulta el catálogo de modelos disponibles para la cuenta
 */
export async function fetchAvailableModels(
  token: string,
  projectId: string
): Promise<AvailableModelsResponse> {
  const { data } = await executeCloudCodeRpc<AvailableModelsResponse>(
    "/v1internal:fetchAvailableModels",
    token,
    { project: projectId },
    { timeoutMs: 8000 }
  );
  return data;
}

/**
 * Consulta el resumen de cuota del usuario
 */
export async function retrieveUserQuotaSummary(token: string): Promise<any> {
  const { data } = await executeCloudCodeRpc<any>(
    "/v1internal:retrieveUserQuotaSummary",
    token,
    {},
    { timeoutMs: 8000 }
  );
  return data;
}

/**
 * Enmascara secretos y credenciales para logs y diagnósticos seguros
 */
export function maskSecret(secret?: string, keepVisible = 4): string {
  if (!secret) return "n/a";
  if (secret.length <= keepVisible * 2) return "***";
  return `${secret.slice(0, keepVisible)}...${secret.slice(-keepVisible)}`;
}
