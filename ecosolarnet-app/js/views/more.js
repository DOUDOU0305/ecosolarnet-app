const ITEMS = [
  { route: `planning/year-${new Date().getFullYear()}`, icon: "📅", label: "Agenda" },
  { route: "waitlist", icon: "⏳", label: "Liste d'attente" },
  { route: "emails", icon: "✉️", label: "Emails" },
  { route: "whatsapp", icon: "💬", label: "WhatsApp" },
  { route: "socialpost", icon: "📣", label: "Réseaux sociaux" },
  { route: "qrcodes", icon: "🔳", label: "QR Code" },
  { route: "assistant", icon: "🎙️", label: "Assistant" },
  { route: "reminders", icon: "📝", label: "Rappels" },
  { route: "settings", icon: "⚙️", label: "Réglages" },
];

export async function render(container) {
  container.innerHTML = `
    <h1>Plus</h1>
    <div class="card">
      ${ITEMS.map((item) => `
        <div class="list-item" data-route="${item.route}" style="cursor:pointer">
          <span style="display:flex;align-items:center;gap:10px"><span style="font-size:19px">${item.icon}</span><strong style="font-weight:500">${item.label}</strong></span>
          <span class="muted">›</span>
        </div>
      `).join("")}
    </div>
  `;

  container.querySelectorAll("[data-route]").forEach((el) => {
    el.addEventListener("click", () => {
      location.hash = `#/${el.dataset.route}`;
    });
  });
}
