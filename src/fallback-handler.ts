import { loadAccountsStore, saveAccountsStore } from "./auth.js";
import type { AntigravityAccountRecord } from "./types.js";

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
 * Verifica si CPAMC / CLIProxyAPI está corriendo localmente en el puerto 8317
 */
export async function checkCpamcStatus(baseUrl = "http://127.0.0.1:8317"): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      method: "GET",
      signal: AbortSignal.timeout(1500)
    });
    return res.ok || res.status === 401; // Si responde 401 o 200, el servidor existe
  } catch {
    return false;
  }
}
