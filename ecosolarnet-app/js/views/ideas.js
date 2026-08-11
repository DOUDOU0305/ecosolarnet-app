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

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric" }) +
    " à " + new Date(ts).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit" }).replace(":", "H");
}

export async function render(container) {
  const ideas = await Store.getAll("ideas");
  ideas.sort((a, b) => b.createdAt - a.createdAt);

  container.innerHTML = `
    <h1>Idées</h1>
    <p class="muted" style="margin-top:-10px">Dictez une idée depuis l'onglet Assistant ("Je viens d'avoir une idée, prends note..."), ou notez-en une ici.</p>

    <div class="card">
      <textarea id="idea-input" rows="2" placeholder="Ex : Proposer un abonnement trimestriel aux clients ponctuels"></textarea>
      <button type="button" class="btn block" id="idea-add-btn" style="margin-top:8px">🎤 Ajouter</button>
    </div>

    ${ideas.length === 0 ? `
      <div class="empty-state">
        <div class="big">💡</div>
        <p>Aucune idée notée pour l'instant.</p>
      </div>
    ` : `
      <p class="muted" style="font-size:12px">Glissez une ligne vers la gauche pour la supprimer.</p>
      <div class="card">
        ${ideas.map((idea) => `
          <div class="swipe-row" style="border-radius:var(--radius-lg);margin-bottom:8px" data-id="${idea.id}">
            <button type="button" class="swipe-delete-btn">Supprimer</button>
            <div class="swipe-content" style="border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:12px">
              <span class="muted" style="font-size:11px">${fmtDate(idea.createdAt)}</span>
              <p class="idea-text" data-edit="${idea.id}" style="margin:4px 0 0">${escapeHtml(idea.text)}</p>
            </div>
          </div>
        `).join("")}
      </div>
    `}
  `;

  const input = container.querySelector("#idea-input");
  container.querySelector("#idea-add-btn").addEventListener("click", async () => {
    const text = input.value.trim();
    if (!text) return;
    await Store.put("ideas", { text, createdAt: Date.now() });
    showToast("Idée enregistrée");
    render(container);
  });

  openSwipeRow = null;
  wireSwipeRows(container, async (id) => {
    await Store.delete("ideas", id);
    showToast("Idée supprimée");
    render(container);
  });

  container.querySelectorAll(".idea-text").forEach((p) => {
    p.addEventListener("click", (e) => {
      if (container.querySelector(".swipe-row.swipe-open")) return;
      e.stopPropagation();
      const id = p.dataset.edit;
      const textarea = document.createElement("textarea");
      textarea.value = p.textContent;
      textarea.rows = 2;
      textarea.style.margin = "4px 0 0";
      p.replaceWith(textarea);
      textarea.focus();

      async function save() {
        const newText = textarea.value.trim();
        if (newText) {
          const idea = await Store.get("ideas", id);
          if (idea) await Store.put("ideas", { ...idea, text: newText });
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
