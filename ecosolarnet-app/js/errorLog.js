import { Store, uid } from "./db.js";

const MAX_ENTRIES = 150;

// N'est jamais montré à Steve — sert uniquement à ce que l'IA repère les
// bugs avant lui (via netlify/functions/get-error-logs.js), en arrière-plan.
export async function logError(message, extra = {}) {
  try {
    await Store.put("errorLogs", {
      id: uid(),
      message: String(message).slice(0, 2000),
      stack: extra.stack ? String(extra.stack).slice(0, 4000) : "",
      context: extra.context || location.hash || "",
      createdAt: new Date().toISOString(),
    });
    const all = await Store.getAll("errorLogs");
    if (all.length > MAX_ENTRIES) {
      const oldest = all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, all.length - MAX_ENTRIES);
      for (const e of oldest) await Store.delete("errorLogs", e.id);
    }
  } catch {
    // le logging d'erreur ne doit jamais lui-même faire planter l'app
  }
}

// À appeler une seule fois, tôt au démarrage — capture les erreurs non
// interceptées, les promesses rejetées sans .catch(), et (en interceptant
// console.error) tous les innombrables `catch (err) { console.error(err) }`
// déjà présents dans le code, sans devoir toucher chaque fichier un par un.
export function installGlobalErrorLogging() {
  window.addEventListener("error", (e) => {
    logError(e.message || "Erreur inconnue", { stack: e.error?.stack || "" });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    logError(reason?.message || String(reason), { stack: reason?.stack || "" });
  });
  const originalConsoleError = console.error.bind(console);
  console.error = (...args) => {
    originalConsoleError(...args);
    logError(
      args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "),
      { stack: args.find((a) => a instanceof Error)?.stack || "" }
    );
  };
}
