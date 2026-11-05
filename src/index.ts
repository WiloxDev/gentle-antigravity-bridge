import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  COMMAND_ALIAS,
  COMMAND_ROOT,
  PROVIDER_ID,
  PROVIDER_LABEL
} from "./types.js";
import {
  getActiveModels,
  loadCachedModels,
  refreshModelsCatalog
} from "./models.js";
import { createAntigravityStream } from "./provider.js";
import {
  loginAntigravityOAuth,
  loadAccountsStore,
  resolveActiveCredentials,
  saveAccountsStore
} from "./auth.js";
import { prewarmTlsConnection, resolveProjectId } from "./client.js";
import { formatDoctorReport, runDoctorDiagnosis } from "./doctor.js";
import {
  formatQuotaReport,
  getGentleShellUsageModel
} from "./quota-tracker.js";
import { loadProjectRules } from "./rules-loader.js";

export default function activate(api: ExtensionAPI): void {
  // Carga inicial de catálogo persistido
  const initialModels = loadCachedModels();

  // 1. Registro del Proveedor en Pi y Gentle Shell
  api.registerProvider(PROVIDER_ID, {
    name: PROVIDER_LABEL,
    models: initialModels,
    streamSimple: createAntigravityStream,
    oauth: {
      name: PROVIDER_LABEL,
      isSubscription: true,
      login: async (callbacks: any) => {
        return loginAntigravityOAuth(callbacks);
      },
      refreshToken: async (credentials: any) => {
        return resolveActiveCredentials(credentials);
      },
      getApiKey: async () => {
        const creds = await resolveActiveCredentials();
        return JSON.stringify(creds);
      }
    }
  } as any);

  // 2. Manejador unificado para los comandos /agy y /antigravity
  const executeAgyCommand = async (args: string, ctx: ExtensionContext) => {
    const parts = args.trim().split(/\s+/);
    const sub = (parts[0] || "").toLowerCase();
    const param = parts[1];

    if (sub === "doctor") {
      ctx.ui?.notify("Ejecutando diagnóstico sanitario de Antigravity...", "info");
      const report = await runDoctorDiagnosis();
      const text = formatDoctorReport(report);
      ctx.ui?.notify(text, report.allPassed ? "info" : "warning");
      return;
    }

    if (sub === "quota") {
      ctx.ui?.notify("Consultando cuota en Google Cloud Code Assist...", "info");
      const report = await formatQuotaReport();
      ctx.ui?.notify(report, "info");
      return;
    }

    if (sub === "models") {
      const models = getActiveModels();
      const lines = [
        `📋 Modelos Antigravity disponibles (${models.length}):`,
        ...models.map(m => `• ${m.id} [Ventana: ${m.contextWindow.toLocaleString()} tokens | MaxOut: ${m.maxTokens.toLocaleString()}]`)
      ];
      ctx.ui?.notify(lines.join("\n"), "info");
      return;
    }

    if (sub === "refresh") {
      ctx.ui?.notify("Sincronizando catálogo con Google Antigravity...", "info");
      try {
        const creds = await resolveActiveCredentials();
        const projId = await resolveProjectId(creds.token, creds.projectId, creds.email);
        const updated = await refreshModelsCatalog(creds.token, projId);
        ctx.ui?.notify(`✓ Catálogo actualizado: ${updated.length} modelos disponibles.`, "info");
      } catch (err) {
        ctx.ui?.notify(`No se pudo refrescar el catálogo: ${err instanceof Error ? err.message : String(err)}`, "warning");
      }
      return;
    }

    if (sub === "accounts") {
      const store = loadAccountsStore();
      const emails = Object.keys(store.accounts);

      if (emails.length === 0) {
        ctx.ui?.notify("No hay cuentas vinculadas. Usa '/login antigravity'.", "info");
        return;
      }

      if (param && emails.includes(param)) {
        store.activeEmail = param;
        saveAccountsStore(store);
        ctx.ui?.notify(`✓ Cuenta activa cambiada a: ${param}`, "info");
        return;
      }

      const list = emails.map(e => `${e === store.activeEmail ? "★ (Activa) " : "• "}${e}`);
      ctx.ui?.notify(
        `👥 Cuentas Antigravity vinculadas:\n${list.join("\n")}\n\nPara alternar: /agy accounts <email>`,
        "info"
      );
      return;
    }

    if (sub === "rules") {
      const rules = loadProjectRules();
      if (rules.length === 0) {
        ctx.ui?.notify("No se detectaron reglas locales de proyecto (.claude/rules, AGENTS.md, CLAUDE.md).", "info");
      } else {
        const text = rules.map(r => `• ${r.name} (${r.content.length} caracteres)`).join("\n");
        ctx.ui?.notify(`📋 Reglas locales detectadas:\n${text}`, "info");
      }
      return;
    }

    ctx.ui?.notify(
      "Uso de /agy:\n" +
      "  /agy doctor     — Diagnóstico completo de latencia, cuenta y cuota\n" +
      "  /agy quota      — Muestra consumo de ventana 5h y semanal\n" +
      "  /agy models     — Lista modelos listos y límites de contexto\n" +
      "  /agy accounts   — Ver y alternar cuentas Google vinculadas\n" +
      "  /agy refresh    — Forzar actualización dinámica del catálogo\n" +
      "  /agy rules      — Ver reglas de proyecto activas",
      "info"
    );
  };

  // Registro del comando primario corto (/agy)
  api.registerCommand(COMMAND_ROOT, {
    description: "Comandos para Google Antigravity (/agy doctor, /agy quota, /agy models)",
    handler: executeAgyCommand
  });

  // Registro del alias completo (/antigravity) para máxima ergonomía
  api.registerCommand(COMMAND_ALIAS, {
    description: "Alias de /agy",
    handler: executeAgyCommand
  });

  // 3. Telemetría Nativa para la Barra de Estado de Gentle Shell
  if ((api as any).registerUsageSource) {
    try {
      (api as any).registerUsageSource(PROVIDER_ID, () => getGentleShellUsageModel());
    } catch {
      // Degrada silenciosamente si el host no expone la API
    }
  }

  // 4. Precalentamiento de sockets y refresco sutil en arranque de sesión
  api.on("session_start", async () => {
    prewarmTlsConnection();
  });
}
