import { loadAccountsStore, saveAccountsStore } from "./auth.js";
import type { AntigravityAccountRecord } from "./types.js";
import { existsSync, readFileSync } from "node:fs";

/**
 * Conmuta automáticamente a la siguiente cuenta vinculada si la actual agota cuota (HTTP 429)
 */
export async function handleQuotaExhaustedFailover(
  exhaustedEmail?: string
): Promise<{ token: string; email: string } | null> {
  const store = loadAccountsStore();
  const emails = Object.keys(store.accounts);

  if (emails.length <= 1) {
    return null;
  }

  // Buscamos otra cuenta que no sea la que acaba de fallar
  const alternateEmail = emails.find(e => e !== exhaustedEmail);
  if (!alternateEmail) return null;

  const candidate: AntigravityAccountRecord = store.accounts[alternateEmail];
  if (!candidate || !candidate.token) return null;

  // Actualizamos la cuenta activa en el almacén
  store.activeEmail = alternateEmail;
  saveAccountsStore(store);

  console.log(`\n🔄 [Antigravity Failover]: Conmutando automáticamente a la cuenta alternativa: ${alternateEmail}\n`);

  return {
    token: candidate.token,
    email: candidate.email
  };
}

/**
 * Detecta si el entorno es WSL2 y obtiene la IP del Host de Windows para resolver el "Abismo de Red"
 */
function getWslHostCandidates(port = 8317): string[] {
  const candidates: string[] = [];
  if (process.platform === "linux") {
    try {
      if (existsSync("/proc/version")) {
        const v = readFileSync("/proc/version", "utf-8").toLowerCase();
        if (v.includes("microsoft") || v.includes("wsl")) {
          if (existsSync("/etc/resolv.conf")) {
            const resolv = readFileSync("/etc/resolv.conf", "utf-8");
            const match = resolv.match(/nameserver\s+([0-9.]+)/);
            if (match && match[1]) {
              candidates.push(`http://${match[1]}:${port}`);
            }
          }
          candidates.push(`http://host.docker.internal:${port}`);
        }
      }
    } catch {
      // Ignorar error de lectura
    }
  }
  return candidates;
}

/**
 * Verifica si CPAMC / CLIProxyAPI está corriendo en el puerto 8317,
 * con sondeo automático a Windows Host si corre dentro de WSL2.
 */
export async function checkCpamcStatus(baseUrl = "http://127.0.0.1:8317"): Promise<boolean> {
  // 1. Probar URL directa
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      method: "GET",
      signal: AbortSignal.timeout(1200)
    });
    if (res.ok || res.status === 401) return true;
  } catch {
    // Si falla y es localhost, probar candidatos WSL2
  }

  // 2. Fallback de red WSL2 hacia Windows Host
  if (baseUrl.includes("127.0.0.1") || baseUrl.includes("localhost")) {
    const wslCandidates = getWslHostCandidates(8317);
    for (const cand of wslCandidates) {
      try {
        const res = await fetch(`${cand}/v1/models`, {
          method: "GET",
          signal: AbortSignal.timeout(800)
        });
        if (res.ok || res.status === 401) return true;
      } catch {
        // Seguir probando
      }
    }
  }

  return false;
}
