import { Store, STORES } from "./db.js";

const BACKUP_STORES = STORES.filter((s) => s !== "activeTimer");

export async function buildBackup() {
  const data = {};
  for (const storeName of BACKUP_STORES) {
    data[storeName] = await Store.getAll(storeName);
  }
  return {
    app: "ecosolarnet",
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export async function exportBackup() {
  const backup = await buildBackup();
  const json = JSON.stringify(backup, null, 2);
  const filename = `ecosolarnet-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], filename, { type: "application/json" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled";
      // sinon on retente avec le téléchargement classique ci-dessous
    }
  }

  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "downloaded";
}

export async function importBackupFromFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Ce fichier n'est pas un fichier de sauvegarde valide.");
  }
  if (!parsed || parsed.app !== "ecosolarnet" || !parsed.data) {
    throw new Error("Ce fichier ne semble pas être une sauvegarde ECOSOLARNET.");
  }

  let count = 0;
  for (const storeName of BACKUP_STORES) {
    const records = parsed.data[storeName];
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      if (record && record.id) {
        await Store.put(storeName, record);
        count++;
      }
    }
  }
  return count;
}
