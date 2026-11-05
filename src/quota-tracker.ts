import { retrieveUserQuotaSummary } from "./client.js";
import { resolveActiveCredentials } from "./auth.js";
import type {
  AccountQuotaSummary,
  GentleShellUsageModel,
  GentleShellUsageSegment,
  QuotaGroup,
  QuotaWindow
} from "./types.js";

let lastQuotaSummary: AccountQuotaSummary | null = null;
let lastFetchTime = 0;
const QUOTA_CACHE_TTL_MS = 60 * 1000; // 1 minuto de caché para no saturar el endpoint

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "inminente";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Consulta el estado de las cuotas del usuario en Google Cloud Code Assist
 */
export async function getAccountQuotaSummary(forceRefresh = false): Promise<AccountQuotaSummary> {
  const now = Date.now();
  if (!forceRefresh && lastQuotaSummary && now - lastFetchTime < QUOTA_CACHE_TTL_MS) {
    return lastQuotaSummary;
  }

  try {
    const creds = await resolveActiveCredentials();
    const raw = await retrieveUserQuotaSummary(creds.token);

    const groups: QuotaGroup[] = [];
    const rawGroups = raw?.quotaGroups || raw?.groups || [];

    if (Array.isArray(rawGroups)) {
      for (const g of rawGroups) {
        const groupId = g.groupId || g.id || "general";
        const displayName = g.displayName || g.name || groupId;

        let fiveHour: QuotaWindow | undefined;
        let weekly: QuotaWindow | undefined;

        if (Array.isArray(g.windows || g.quotaWindows)) {
          for (const w of g.windows || g.quotaWindows) {
            const duration = Number(w.durationSeconds || w.duration || 0);
            const remaining = Number(w.remainingFraction ?? 1.0);
            const usedTokens = Number(w.usedTokens || 0);
            const maxTokens = Number(w.maxTokens || 0);
            const resetAt = w.resetAtEpochMs || (w.resetTime ? new Date(w.resetTime).getTime() : undefined);

            const windowObj: QuotaWindow = {
              durationSeconds: duration,
              remainingFraction: remaining,
              usedTokens,
              maxTokens,
              resetAtEpochMs: resetAt
            };

            // Ventana de 5 horas (~18000s) vs Semanal (~604800s)
            if (duration <= 21600) {
              fiveHour = windowObj;
            } else {
              weekly = windowObj;
            }
          }
        }

        groups.push({ groupId, displayName, fiveHourWindow: fiveHour, weeklyWindow: weekly });
      }
    }

    lastQuotaSummary = {
      planLabel: raw?.planLabel || raw?.subscriptionTier || "Google AI Subscription",
      groups,
      fetchedAt: now
    };
    lastFetchTime = now;
    return lastQuotaSummary;
  } catch (err) {
    if (lastQuotaSummary) return lastQuotaSummary;
    return {
      planLabel: "Google Antigravity",
      groups: [],
      fetchedAt: now
    };
  }
}

/**
 * Formatea el modelo de uso para la barra de estado inferior de Gentle Shell
 */
export async function getGentleShellUsageModel(): Promise<GentleShellUsageModel> {
  const summary = await getAccountQuotaSummary();
  const segments: GentleShellUsageSegment[] = [];

  // Buscamos el grupo de modelos principal (Gemini o primero disponible)
  const primaryGroup = summary.groups.find(g => /gemini/i.test(g.groupId)) || summary.groups[0];

  let displayLine = "♊ Antigravity: Activo";
  let resetText: string | undefined;

  if (primaryGroup) {
    if (primaryGroup.fiveHourWindow) {
      const remaining = primaryGroup.fiveHourWindow.remainingFraction;
      const usedPct = Math.round((1 - remaining) * 100);
      const timeLeft = primaryGroup.fiveHourWindow.resetAtEpochMs
        ? formatTimeRemaining(primaryGroup.fiveHourWindow.resetAtEpochMs - Date.now())
        : undefined;

      const status: "normal" | "warning" | "critical" =
        remaining > 0.3 ? "normal" : remaining > 0.1 ? "warning" : "critical";

      segments.push({
        label: "5h",
        percentUsed: usedPct,
        timeRemaining: timeLeft,
        status
      });

      displayLine = `♊ 5h: ${100 - usedPct}% disp.${timeLeft ? ` (${timeLeft})` : ""}`;
      resetText = timeLeft;
    }

    if (primaryGroup.weeklyWindow) {
      const remaining = primaryGroup.weeklyWindow.remainingFraction;
      const usedPct = Math.round((1 - remaining) * 100);
      const timeLeft = primaryGroup.weeklyWindow.resetAtEpochMs
        ? formatTimeRemaining(primaryGroup.weeklyWindow.resetAtEpochMs - Date.now())
        : undefined;

      segments.push({
        label: "Semanal",
        percentUsed: usedPct,
        timeRemaining: timeLeft,
        status: remaining > 0.3 ? "normal" : remaining > 0.1 ? "warning" : "critical"
      });
    }
  }

  return {
    providerId: "gentle-antigravity",
    badge: "♊ Antigravity",
    displayLine,
    segments,
    resetAtText: resetText
  };
}

/**
 * Genera el informe visual para el comando /agy quota
 */
export async function formatQuotaReport(): Promise<string> {
  const summary = await getAccountQuotaSummary(true);

  if (summary.groups.length === 0) {
    return `📊 Cuota Antigravity (${summary.planLabel}):\nℹ️ No se pudieron obtener grupos de cuota agregados (es posible que la cuenta requiera una consulta directa de modelo o sea free-tier).`;
  }

  const lines: string[] = [`📊 Estado de Cuota Antigravity [${summary.planLabel}]:`];

  for (const g of summary.groups) {
    lines.push(`\n• Pool: ${g.displayName}`);

    if (g.fiveHourWindow) {
      const rem = Math.round(g.fiveHourWindow.remainingFraction * 100);
      const used = 100 - rem;
      const bar = createProgressBar(rem);
      const time = g.fiveHourWindow.resetAtEpochMs
        ? formatTimeRemaining(g.fiveHourWindow.resetAtEpochMs - Date.now())
        : "N/A";
      lines.push(`  Ventana 5h: [${bar}] ${rem}% disponible (${used}% usado) | Reinicia en: ${time}`);
    }

    if (g.weeklyWindow) {
      const rem = Math.round(g.weeklyWindow.remainingFraction * 100);
      const used = 100 - rem;
      const bar = createProgressBar(rem);
      const time = g.weeklyWindow.resetAtEpochMs
        ? formatTimeRemaining(g.weeklyWindow.resetAtEpochMs - Date.now())
        : "N/A";
      lines.push(`  Semanal:    [${bar}] ${rem}% disponible (${used}% usado) | Reinicia en: ${time}`);
    }
  }

  lines.push(
    "\n💡 Recomendación Pro: Para trabajo continuo de alta intensidad y conmutación invisible de cuentas ante límites de 5h, usa CPAMC y Auto Switcher Pro (WiloxDev/cpamc-auto-switcher-pro) para rotación ininterrumpida."
  );

  return lines.join("\n");
}

function createProgressBar(percentAvailable: number, width = 12): string {
  const filled = Math.round((percentAvailable / 100) * width);
  const empty = width - filled;
  return `${"#".repeat(Math.max(0, filled))}${"-".repeat(Math.max(0, empty))}`;
}
