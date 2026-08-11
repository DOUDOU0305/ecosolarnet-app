import { Store } from "../db.js";
import { escapeHtml, showToast } from "../toast.js";

const SWIPE_OPEN_X = -84;
let openSwipeRow = null;

function closeSwipeRow(row) {
  if (!row) return;
  const content = row.querySelector(".swipe-content");
  if (content) content.style.transform = "translateX(0)";
  row.classList.remove("swipe-open");
  if (openSwipeRow === row) openSwipeRow = null;
}

function wireSwipeRows(container, onDelete) {
  container.querySelectorAll(".swipe-row").forEach((row) => {
    const content = row.querySelector(".swipe-content");
    const deleteBtn = row.querySelector(".swipe-delete-btn");
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let dragging = false;
    let axis = null;

    content.addEventListener("pointerdown", (e) => {
      if (e.target.closest("input, textarea")) return;
      if (openSwipeRow && openSwipeRow !== row) closeSwipeRow(openSwipeRow);
      startX = e.clientX;
      startY = e.clientY;
      baseX = row.classList.contains("swipe-open") ? SWIPE_OPEN_X : 0;
      dragging = true;
      axis = null;
      content.style.transition = "none";
      content.setPointerCapture(e.pointerId);
    });

    content.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (axis === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (axis !== "x") return;
      const x = Math.min(0, Math.max(SWIPE_OPEN_X, baseX + dx));
      content.style.transform = `translateX(${x}px)`;
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      content.style.transition = "";
      if (axis !== "x") return;
      const dx = e.clientX - startX;
      const finalX = baseX + dx;
      if (finalX < SWIPE_OPEN_X / 2) {
        content.style.transform = `translateX(${SWIPE_OPEN_X}px)`;
        row.classList.add("swipe-open");
        openSwipeRow = row;
      } else {
        closeSwipeRow(row);
      }
    }

    content.addEventListener("pointerup", endDrag);
    content.addEventListener("pointercancel", endDrag);

    content.addEventListener("click", (e) => {
      if (row.classList.contains("swipe-open")) {
        e.preventDefault();
        e.stopPropagation();
        closeSwipeRow(row);
      }
    });

    deleteBtn.addEventListener("click", () => onDelete(row.dataset.id));
  });
}

export async function render(container) {
  const reminders = await Store.getAll("reminders");
  reminders.sort((a, b) => (a.done === b.done ? b.createdAt - a.createdAt : a.done ? 1 : -1));

  container.innerHTML = `
    <h1>Rappels</h1>
    <p class="muted" style="margin-top:-10px">Dictez un rappel depuis l'onglet Assistant ("Fais-moi un rappel de..."), ou ajoutez-en un ici. Ce sont des notes à consulter — l'application n'envoie pas d'alerte automatique quand vous rentrez à la maison ou à une heure précise.</p>

    <div class="card">
      <textarea id="reminder-input" rows="2" placeholder="Ex : Mettre les loques à laver en rentrant ce soir"></textarea>
      <button type="button" class="btn block" id="reminder-add-btn" style="margin-top:8px">🎤 Ajouter</button>
    </div>

    ${reminders.length === 0 ? `
      <div class="empty-state">
        <div class="big">📝</div>
        <p>Aucun rappel pour l'instant.</p>
      </div>
    ` : `
      <p class="muted" style="font-size:12px">Glissez une ligne vers la gauche pour la supprimer.</p>
      <div class="card">
        ${reminders.map((r) => `
          <div class="swipe-row" style="border-radius:var(--radius-lg);margin-bottom:8px" data-id="${r.id}">
            <button type="button" class="swipe-delete-btn">Supprimer</button>
            <div class="swipe-content" style="border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:12px;display:flex;gap:10px;align-items:flex-start">
              <input type="checkbox" data-done="${r.id}" ${r.done ? "checked" : ""} style="width:20px;height:20px;flex:none;margin:2px 0 0;accent-color:var(--teal)">
              <p class="reminder-text" data-edit="${r.id}" style="margin:0;flex:1;${r.done ? "text-decoration:line-through;opacity:0.55" : ""}">${escapeHtml(r.text)}</p>
            </div>
          </div>
        `).join("")}
      </div>
    `}
  `;

  const input = container.querySelector("#reminder-input");
  container.querySelector("#reminder-add-btn").addEventListener("click", async () => {
    const text = input.value.trim();
    if (!text) return;
    await Store.put("reminders", { text, done: false, createdAt: Date.now() });
    showToast("Rappel ajouté");
    render(container);
  });

  openSwipeRow = null;
  wireSwipeRows(container, async (id) => {
    await Store.delete("reminders", id);
    showToast("Rappel supprimé");
    render(container);
  });

  container.querySelectorAll("[data-done]").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const r = await Store.get("reminders", checkbox.dataset.done);
      if (r) await Store.put("reminders", { ...r, done: checkbox.checked });
      render(container);
    });
  });

  container.querySelectorAll(".reminder-text").forEach((p) => {
    p.addEventListener("click", (e) => {
      if (container.querySelector(".swipe-row.swipe-open")) return;
      e.stopPropagation();
      const id = p.dataset.edit;
      const textarea = document.createElement("textarea");
      textarea.value = p.textContent;
      textarea.rows = 2;
      textarea.style.flex = "1";
      textarea.style.margin = "0";
      p.replaceWith(textarea);
      textarea.focus();

      async function save() {
        const newText = textarea.value.trim();
        if (newText) {
          const r = await Store.get("reminders", id);
          if (r) await Store.put("reminders", { ...r, text: newText });
        }
        render(container);
      }
      textarea.addEventListener("blur", save);
      textarea.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
          ev.preventDefault();
          textarea.blur();
        }
      });
    });
  });
}
