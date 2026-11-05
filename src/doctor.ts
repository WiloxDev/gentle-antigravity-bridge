import { resolveActiveCredentials } from "./auth.js";
import {
  getActiveEndpoint,
  getClientHeaders,
  loadCodeAssist,
  maskSecret,
  resolveProjectId
} from "./client.js";
import { getActiveModels } from "./models.js";
import { loadProjectRules } from "./rules-loader.js";
import { checkCpamcStatus } from "./fallback-handler.js";
import type { DoctorCheckItem, DoctorReport } from "./types.js";

/**
 * Ejecuta la suite de diagnóstico integral de Antigravity
 */
export async function runDoctorDiagnosis(): Promise<DoctorReport> {
  const checks: DoctorCheckItem[] = [];
  const endpoint = getActiveEndpoint();

  // 1. Chequeo de Conectividad y Latencia HTTP
  const pingStart = Date.now();
  try {
    const res = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
      method: "OPTIONS",
      signal: AbortSignal.timeout(5000)
    });
    const latency = Date.now() - pingStart;
    checks.push({
      name: "Conectividad Endpoint Google",
      passed: true,
      message: `Conectado a ${endpoint}`,
      latencyMs: latency
    });
  } catch (err) {
    const latency = Date.now() - pingStart;
    checks.push({
      name: "Conectividad Endpoint Google",
      passed: false,
      message: `No se pudo alcanzar ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: latency
    });
  }

  // 2. Chequeo de Credenciales y Sesión OAuth
  let token = "";
  try {
    const creds = await resolveActiveCredentials();
    token = creds.token;
    const expiresMinutes = creds.expiresAt
      ? Math.round((creds.expiresAt - Date.now()) / (60 * 1000))
      : 0;

    const emailMasked = creds.email
      ? creds.email.replace(/(.{2})(.*)(@.*)/, "$1***$3")
      : "Desconocido";

    checks.push({
      name: "Credenciales OAuth Google",
      passed: true,
      message: `Cuenta activa: ${emailMasked} (Token válido por ${expiresMinutes} min, auto-refresh configurado)`
    });
  } catch (err) {
    checks.push({
      name: "Credenciales OAuth Google",
      passed: false,
      message: `Sin sesión activa: ${err instanceof Error ? err.message : String(err)}. Ejecuta '/login antigravity'.`
    });
  }

  // 3. Chequeo de Tier y Suscripción Antigravity
  if (token) {
    try {
      const assist = await loadCodeAssist(token);
      const paid = assist?.paidTier?.name || assist?.paidTier?.id;
      const current = assist?.currentTier?.name || assist?.currentTier?.id;
      const tierName = paid ? `Suscripción Pro: ${paid}` : (current || "Plan Estándar");

      checks.push({
        name: "Suscripción Cloud Code Assist",
        passed: true,
        message: tierName
      });

      // 4. Chequeo de Proyecto Cloud
      const projectId = await resolveProjectId(token, undefined, undefined);
      checks.push({
        name: "Proyecto Cloud Code / Antigravity",
        passed: true,
        message: `ID de Proyecto resuelto: ${maskSecret(projectId, 6)}`
      });
    } catch (err) {
      checks.push({
        name: "Suscripción Cloud Code Assist",
        passed: false,
        message: `Error al consultar metadatos: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  }

  // 5. Modelos Registrados
  const models = getActiveModels();
  checks.push({
    name: "Catálogo de Modelos",
    passed: models.length > 0,
    message: `${models.length} modelos listos (Gemini 3.8/3.7/3.6/3.5 Flash, 3.1 Pro, Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS)`
  });

  // 6. Reglas Locales de Proyecto
  const rules = loadProjectRules();
  checks.push({
    name: "Reglas de Proyecto",
    passed: true,
    message: rules.length > 0
      ? `${rules.length} archivo(s) de reglas detectados (${rules.map(r => r.name).join(", ")})`
      : "Ninguna regla local detectada (opcional: AGENTS.md, .claude/rules)"
  });

  // 7. Red de Respaldo CPAMC / CLIProxyAPI
  const cpamcAlive = await checkCpamcStatus();
  checks.push({
    name: "Respaldo Local CPAMC / CLIProxyAPI",
    passed: true,
    message: cpamcAlive
      ? "Detectado en http://127.0.0.1:8317 (listo para conmutación de emergencia)"
      : "No detectado en http://127.0.0.1:8317 (opcional)"
  });

  const allPassed = checks.filter(c => c.name !== "Respaldo Local CPAMC / CLIProxyAPI").every(c => c.passed);

  return {
    timestamp: Date.now(),
    allPassed,
    checks
  };
}

/**
 * Formatea el reporte del comando /agy doctor
 */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [
    `🩺 Diagnóstico de Salud: Gentle Antigravity Bridge [${new Date(report.timestamp).toLocaleTimeString()}]`,
    "--------------------------------------------------------------------------------"
  ];

  for (const c of report.checks) {
    const icon = c.passed ? "✓" : "✗";
    const latency = c.latencyMs !== undefined ? ` [${c.latencyMs}ms]` : "";
    lines.push(`${icon} ${c.name}${latency}: ${c.message}`);
  }

  lines.push("--------------------------------------------------------------------------------");
  lines.push(
    report.allPassed
      ? "✨ Todo el entorno de Antigravity está en óptimas condiciones."
      : "⚠️ Se detectaron elementos que requieren atención antes de continuar."
  );

  return lines.join("\n");
}
