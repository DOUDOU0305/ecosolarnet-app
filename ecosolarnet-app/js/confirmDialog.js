import { escapeHtml } from "./toast.js";

// Petite alerte façon iOS (fond flouté + carte centrée, deux boutons) pour
// demander une confirmation Oui/Non à l'utilisateur, ex. quand le GPS n'est
// pas sûr à 100% de l'endroit où il se trouve.
export function askYesNo(message, { title = "Confirmation" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-card">
        <p class="confirm-title">${escapeHtml(title)}</p>
        <p class="confirm-message">${escapeHtml(message)}</p>
        <div class="confirm-actions">
          <button type="button" class="confirm-btn confirm-no">Non</button>
          <button type="button" class="confirm-btn confirm-yes">Oui</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const finish = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector(".confirm-no").addEventListener("click", () => finish(false));
    overlay.querySelector(".confirm-yes").addEventListener("click", () => finish(true));
  });
}
