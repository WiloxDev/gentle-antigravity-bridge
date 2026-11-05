import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { PROVIDER_ID } from "./types.js";
import { DEFAULT_ENDPOINT, fetchAvailableModels } from "./client.js";

const MODELS_CACHE_FILE = join(homedir(), ".pi", "agent", "antigravity-models-cache.json");

const ZERO_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0
};

export interface AntigravityModelDefinition extends Model<any> {
  runtimeId: string;
  defaultThinkingBudget?: number;
}

/**
 * Catálogo base predeterminado de modelos optimizados para Pi y Gentle Shell
 */
export const BASE_ANTIGRAVITY_MODELS: AntigravityModelDefinition[] = [
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash (Google Antigravity)",
    provider: PROVIDER_ID,
    api: "custom" as any,
    baseUrl: DEFAULT_ENDPOINT,
    runtimeId: "gemini-3.8-flash",
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST
  },
  {
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash (Google Antigravity)",
    provider: PROVIDER_ID,
    api: "custom" as any,
    baseUrl: DEFAULT_ENDPOINT,
    runtimeId: "gemini-3.7-flash",
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash (Google Antigravity)",
    provider: PROVIDER_ID,
    api: "custom" as any,
    baseUrl: DEFAULT_ENDPOINT,
    runtimeId: "gemini-3.6-flash",
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash (Google Antigravity)",
    provider: PROVIDER_ID,
    api: "custom" as any,
    baseUrl: DEFAULT_ENDPOINT,
    runtimeId: "gemini-3.5-flash",
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro (Google Antigravity)",
    provider: PROVIDER_ID,
    api: "custom" as any,
    baseUrl: DEFAULT_ENDPOINT,
    runtimeId: "gemini-3.1-pro",
    contextWindow: 1048576,
    maxTokens: 65535,
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST
  },
  // Modelos Claude provistos mediante la suscripción de Google Antigravity
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Google Antigravity)",
    provider: PROVIDER_ID,
    api: "custom" as any,
    baseUrl: DEFAULT_ENDPOINT,
    runtimeId: "claude-sonnet-4-6",
    contextWindow: 200000,
    maxTokens: 64000,
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6 (Google Antigravity)",
    provider: PROVIDER_ID,
    api: "custom" as any,
    baseUrl: DEFAULT_ENDPOINT,
    runtimeId: "claude-opus-4-6-thinking",
    contextWindow: 200000,
    maxTokens: 64000,
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST
  },
  // Modelo Open Source de OpenAI provisto por Google Antigravity
  {
    id: "gpt-oss-120b",
    name: "GPT-OSS 120B (Google Antigravity)",
    provider: PROVIDER_ID,
    api: "custom" as any,
    baseUrl: DEFAULT_ENDPOINT,
    runtimeId: "gpt-oss-120b-medium",
    contextWindow: 128000,
    maxTokens: 32768,
    reasoning: true,
    input: ["text"],
    cost: ZERO_COST
  }
];

let activeCatalog: AntigravityModelDefinition[] = [...BASE_ANTIGRAVITY_MODELS];

/**
 * Carga el catálogo persistido de modelos en disco para arranque offline inmediato
 */
export function loadCachedModels(): AntigravityModelDefinition[] {
  try {
    if (existsSync(MODELS_CACHE_FILE)) {
      const data = readFileSync(MODELS_CACHE_FILE, "utf-8");
      const list = JSON.parse(data) as AntigravityModelDefinition[];
      if (Array.isArray(list) && list.length > 0) {
        activeCatalog = list;
        return list;
      }
    }
  } catch {
    // Si falla el caché usamos el catálogo base
  }
  return BASE_ANTIGRAVITY_MODELS;
}

/**
 * Guarda el catálogo descubierto en caché local
 */
export function persistCachedModels(models: AntigravityModelDefinition[]): void {
  try {
    writeFileSync(MODELS_CACHE_FILE, JSON.stringify(models, null, 2), "utf-8");
  } catch {
    // Ignoramos errores de escritura en caché
  }
}

/**
 * Obtiene el catálogo actual en memoria
 */
export function getActiveModels(): AntigravityModelDefinition[] {
  return activeCatalog;
}

/**
 * Sincroniza dinámicamente los modelos reportados por el backend de Google
 */
export async function refreshModelsCatalog(
  token: string,
  projectId: string
): Promise<AntigravityModelDefinition[]> {
  try {
    const response = await fetchAvailableModels(token, projectId);
    if (!response.models) return activeCatalog;

    const merged = new Map<string, AntigravityModelDefinition>();

    // 1. Cargamos catálogo base
    for (const m of BASE_ANTIGRAVITY_MODELS) {
      merged.set(m.id, { ...m });
    }

    // 2. Incorporamos modelos reportados por Google
    for (const [key, info] of Object.entries(response.models)) {
      if (/MODEL_PLACEHOLDER|chat_|tab_/i.test(key)) continue;

      const baseKey = key.replace(/-(low|medium|high|extra-low)$/i, "");
      const existing = merged.get(baseKey);

      if (existing) {
        if (info.maxOutputTokens && info.maxOutputTokens > existing.maxTokens) {
          existing.maxTokens = info.maxOutputTokens;
        }
        if (info.contextWindow && info.contextWindow > existing.contextWindow) {
          existing.contextWindow = info.contextWindow;
        }
      } else if (key.startsWith("gemini-") || key.startsWith("claude-") || key.startsWith("gpt-")) {
        merged.set(key, {
          id: key,
          name: info.displayName || `${key} (Google Antigravity)`,
          provider: PROVIDER_ID,
          api: "custom" as any,
          baseUrl: DEFAULT_ENDPOINT,
          runtimeId: key,
          contextWindow: info.contextWindow || 1048576,
          maxTokens: info.maxOutputTokens || 65536,
          reasoning: true,
          input: ["text", "image"],
          cost: ZERO_COST
        });
      }
    }

    activeCatalog = Array.from(merged.values());
    persistCachedModels(activeCatalog);
    return activeCatalog;
  } catch {
    return activeCatalog;
  }
}

/**
 * Resuelve el modelo exacto en tiempo de ejecución y el presupuesto de pensamiento (thinking)
 */
export function resolveRuntimeModelConfig(
  modelId: string,
  reasoningEffort: string = "off"
): {
  runtimeModelId: string;
  thinkingBudget: number;
} {
  const normalizedId = modelId.replace(/^gentle-antigravity\//, "").replace(/^antigravity\//, "");
  const effort = reasoningEffort.toLowerCase();

  // 1. Familia Gemini 3.8 / 3.7 / 3.6
  if (/^gemini-3\.[678]-flash/i.test(normalizedId)) {
    if (effort === "high") {
      return { runtimeModelId: `${normalizedId}-high`, thinkingBudget: -1 };
    }
    if (effort === "medium") {
      return { runtimeModelId: `${normalizedId}-medium`, thinkingBudget: 4000 };
    }
    if (effort === "low") {
      return { runtimeModelId: `${normalizedId}-low`, thinkingBudget: 1000 };
    }
    return { runtimeModelId: `${normalizedId}-low`, thinkingBudget: 0 };
  }

  // 2. Gemini 3.5 Flash
  if (/^gemini-3\.5-flash/i.test(normalizedId)) {
    if (effort === "high") {
      return { runtimeModelId: "gemini-3-flash-agent", thinkingBudget: 10000 };
    }
    if (effort === "medium") {
      return { runtimeModelId: "gemini-3.5-flash-low", thinkingBudget: 4000 };
    }
    if (effort === "low") {
      return { runtimeModelId: "gemini-3.5-flash-extra-low", thinkingBudget: 1000 };
    }
    return { runtimeModelId: "gemini-3.5-flash-extra-low", thinkingBudget: 0 };
  }

  // 3. Gemini 3.1 Pro
  if (/^gemini-3\.1-pro/i.test(normalizedId)) {
    if (effort === "high") {
      return { runtimeModelId: "gemini-pro-agent", thinkingBudget: 10001 };
    }
    if (effort === "low" || effort === "medium") {
      return { runtimeModelId: "gemini-3.1-pro-low", thinkingBudget: 1001 };
    }
    return { runtimeModelId: "gemini-3.1-pro-low", thinkingBudget: 0 };
  }

  // 4. Claude Sonnet / Opus
  if (/^claude-/i.test(normalizedId)) {
    const isOpus = normalizedId.includes("opus");
    const runtime = isOpus ? `${normalizedId}-thinking` : normalizedId;
    const budget = effort === "off" ? 0 : 1024;
    return { runtimeModelId: runtime, thinkingBudget: budget };
  }

  // 5. GPT-OSS 120b
  if (/^gpt-oss-/i.test(normalizedId)) {
    const budget = effort === "off" ? 0 : 8192;
    return { runtimeModelId: `${normalizedId}-medium`, thinkingBudget: budget };
  }

  return { runtimeModelId: normalizedId, thinkingBudget: 0 };
}
