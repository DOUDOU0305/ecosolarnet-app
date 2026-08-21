import { getSettings, saveSettings } from "./db.js";
import { buildBackup } from "./backup.js";
import { FUNCTIONS_BASE, APP_SHARED_SECRET } from "./config.js";

// Sauvegarde automatique et invisible pour Steve — au plus une fois par
// jour, pour que l'IA puisse retrouver et restaurer ses données en cas de
// problème sans qu'il ait besoin d'y penser lui-même.
export async function runAutoBackupIfDue() {
  const settings = await getSettings();
  const todayStr = new Date().toISOString().slice(0, 10);
  if (settings.lastAutoBackupDate === todayStr) return;

  try {
    const backup = await buildBackup();
    const res = await fetch(`${FUNCTIONS_BASE}/save-backup`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-App-Secret": APP_SHARED_SECRET },
      body: JSON.stringify({ dateStr: todayStr, backup }),
    });
    if (!res.ok) throw new Error(`save-backup a échoué (${res.status})`);
    await saveSettings({ lastAutoBackupDate: todayStr });
  } catch (err) {
    console.error("[auto-backup] échec", err);
  }
}
