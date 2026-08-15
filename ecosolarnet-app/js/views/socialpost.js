import { Store, uid } from "../db.js";
import { resizeImage, blobToDataURL } from "../photo.js";
import { escapeHtml, showToast } from "../toast.js";
import { FUNCTIONS_BASE, SITE_ORIGIN } from "../config.js";
import { MUSIC_LIBRARY } from "../musicLibrary.js";

const MAX_MONTAGE_PHOTOS = 6;

let photos = [];
let video = null;
let montageBlob = null;
let montageUrl = null;

function resetDraft() {
  photos.forEach((p) => URL.revokeObjectURL(p.url));
  photos = [];
  video = null;
  if (montageUrl) URL.revokeObjectURL(montageUrl);
  montageBlob = null;
  montageUrl = null;
}

function getVideoDuration(file) {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(el.src);
      resolve(el.duration || 5);
    };
    el.onerror = () => resolve(5);
    el.src = URL.createObjectURL(file);
  });
}

// Uploads one file to Shotstack (request a signed URL, PUT the bytes, then
// poll until Shotstack has finished ingesting it) and returns the resulting
// Shotstack-hosted URL — the only kind of URL their renderer can fetch from,
// since our photos start out as local blobs with no public address.
async function uploadToShotstack(blob, onProgress) {
  const upRes = await fetch(`${FUNCTIONS_BASE}/shotstack-ingest`, { method: "POST" });
  if (!upRes.ok) throw new Error("Impossible de préparer l'envoi");
  const { uploadUrl, sourceId } = await upRes.json();

  const putRes = await fetch(uploadUrl, { method: "PUT", body: blob });
  if (!putRes.ok) throw new Error("Échec de l'envoi du fichier");

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const statusRes = await fetch(`${FUNCTIONS_BASE}/shotstack-status?type=source&id=${sourceId}`);
    const data = await statusRes.json();
    if (data.status === "ready") return data.url;
    if (data.status === "failed") throw new Error("Échec du traitement du fichier");
    onProgress?.();
  }
  throw new Error("Délai dépassé pendant l'envoi");
}

export async function render(container) {
  resetDraft();
  const posts = (await Store.getAll("socialPosts")).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  container.innerHTML = `
    <h1>Réseaux sociaux</h1>
    <p class="muted" style="margin-top:-10px">Après un chantier, ajoutez vos photos (et une vidéo si vous en avez une), laissez l'IA rédiger un texte, créez le montage vidéo, puis validez pour publier.</p>

    <div class="card">
      <h3 style="margin-top:0">Nouvelle publication</h3>

      <input type="file" accept="image/*" capture="environment" id="sp-photo-input" multiple style="display:none">
      <input type="file" accept="image/*" id="sp-photo-input-library" multiple style="display:none">
      <button type="button" class="btn secondary" id="sp-add-photo-btn">📷 Photo</button>
      <p class="muted" style="margin:6px 0 0;font-size:12px">Appui court : prendre une photo. Appui long : choisir aussi dans vos photos.</p>
      <div id="sp-photo-grid" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"></div>

      <div id="photo-action-sheet-backdrop" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:50">
        <div style="position:absolute;bottom:0;left:0;right:0;background:var(--card);border-radius:16px 16px 0 0;overflow:hidden">
          <button type="button" id="sheet-camera-btn" style="display:block;width:100%;padding:16px;border:none;background:none;font-size:17px;color:var(--text);border-bottom:0.5px solid var(--border)">📷 Prendre une photo</button>
          <button type="button" id="sheet-library-btn" style="display:block;width:100%;padding:16px;border:none;background:none;font-size:17px;color:var(--text);border-bottom:0.5px solid var(--border)">🖼️ Choisir dans mes photos</button>
          <button type="button" id="sheet-cancel-btn" style="display:block;width:100%;padding:16px;border:none;background:none;font-size:17px;color:var(--muted)">Annuler</button>
        </div>
      </div>

      <input type="file" accept="video/*" capture="environment" id="sp-video-input" style="display:none">
      <button type="button" class="btn secondary" id="sp-add-video-btn" style="margin-top:10px">🎥 Ajouter une vidéo</button>
      <div id="sp-video-status" class="muted" style="margin-top:6px;font-size:13px"></div>

      <button type="button" class="btn block" id="sp-generate-btn" style="display:none;margin-top:14px">🤖 Générer le texte avec l'IA</button>

      <div id="sp-caption-zone" style="display:none;margin-top:14px">
        <label>Texte de publication (modifiable)</label>
        <textarea id="sp-caption-input" rows="6" style="width:100%"></textarea>
      </div>

      <div id="sp-montage-zone" style="display:none;margin-top:14px;border-top:1px solid var(--border);padding-top:14px">
        <label>Musique</label>
        <select id="sp-music-select">
          ${MUSIC_LIBRARY.map((t) => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join("")}
        </select>
        <button type="button" class="btn secondary block" id="sp-montage-btn" style="margin-top:10px">🎬 Créer le montage vidéo</button>
        <p class="muted" id="sp-montage-progress" style="margin-top:8px;font-size:13px"></p>
        <video id="sp-montage-preview" controls playsinline style="display:none;width:100%;max-width:280px;border-radius:12px;margin-top:10px"></video>
      </div>

      <button type="button" class="btn block" id="sp-validate-btn" style="display:none;margin-top:14px">✅ Valider cette publication</button>
    </div>

    <div class="card" style="margin-top:20px">
      <h3 style="margin-top:0">Publications précédentes</h3>
      ${posts.length === 0 ? `<p class="muted">Aucune publication pour le moment.</p>` : posts.map((p) => `
        <div style="border-top:1px solid var(--border);padding:10px 0" data-post="${p.id}">
          <p class="muted" style="font-size:12px;margin:0 0 4px">${new Date(p.createdAt).toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric" })} — ${p.status === "shared" ? "✅ partagée" : "en attente de partage"}${p.montageVideo ? " — 🎬 avec montage vidéo" : ""}</p>
          <p style="margin:0 0 8px;white-space:pre-wrap;font-size:14px">${escapeHtml(p.caption || "")}</p>
          <button type="button" class="btn secondary small sp-share-btn" data-id="${p.id}">📤 Partager</button>
        </div>
      `).join("")}
    </div>
  `;

  function refreshDraftUI() {
    const hasMedia = photos.length > 0 || !!video;
    container.querySelector("#sp-generate-btn").style.display = photos.length > 0 ? "" : "none";
    container.querySelector("#sp-montage-zone").style.display = hasMedia ? "" : "none";
    container.querySelector("#sp-validate-btn").style.display = hasMedia ? "" : "none";
  }

  function renderPhotoGrid() {
    const grid = container.querySelector("#sp-photo-grid");
    if (photos.length === 0) {
      grid.innerHTML = `<p class="muted" style="margin:0">Aucune photo ajoutée.</p>`;
    } else {
      grid.innerHTML = photos.map((p) => `
        <div style="position:relative;width:74px;height:74px">
          <img src="${p.url}" style="width:100%;height:100%;object-fit:cover;border-radius:10px">
          <button type="button" data-remove="${p.id}" style="position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;background:var(--danger);color:white;border:none;font-size:13px;line-height:1">✕</button>
        </div>
      `).join("");
      grid.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = photos.findIndex((p) => p.id === btn.dataset.remove);
          if (idx >= 0) {
            URL.revokeObjectURL(photos[idx].url);
            photos.splice(idx, 1);
            renderPhotoGrid();
          }
        });
      });
    }
    refreshDraftUI();
  }
  renderPhotoGrid();

  const photoBtn = container.querySelector("#sp-add-photo-btn");
  const photoSheet = container.querySelector("#photo-action-sheet-backdrop");
  let longPressTimer;
  let longPressFired = false;
  function openPhotoSheet() {
    photoSheet.style.display = "block";
  }
  function closePhotoSheet() {
    photoSheet.style.display = "none";
  }
  photoBtn.addEventListener("pointerdown", () => {
    longPressFired = false;
    longPressTimer = setTimeout(() => {
      longPressFired = true;
      openPhotoSheet();
    }, 500);
  });
  photoBtn.addEventListener("pointerup", () => {
    clearTimeout(longPressTimer);
    if (!longPressFired) container.querySelector("#sp-photo-input").click();
  });
  photoBtn.addEventListener("pointerleave", () => clearTimeout(longPressTimer));
  photoBtn.addEventListener("pointercancel", () => clearTimeout(longPressTimer));
  photoBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  photoSheet.addEventListener("click", (e) => {
    if (e.target === photoSheet) closePhotoSheet();
  });
  container.querySelector("#sheet-camera-btn").addEventListener("click", () => {
    closePhotoSheet();
    container.querySelector("#sp-photo-input").click();
  });
  container.querySelector("#sheet-library-btn").addEventListener("click", () => {
    closePhotoSheet();
    container.querySelector("#sp-photo-input-library").click();
  });
  container.querySelector("#sheet-cancel-btn").addEventListener("click", closePhotoSheet);

  async function handlePhotoFiles(e) {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      try {
        const blob = await resizeImage(file);
        photos.push({ id: uid(), blob, url: URL.createObjectURL(blob) });
      } catch {
        showToast("Impossible de charger cette photo");
      }
    }
    e.target.value = "";
    renderPhotoGrid();
  }
  container.querySelector("#sp-photo-input").addEventListener("change", handlePhotoFiles);
  container.querySelector("#sp-photo-input-library").addEventListener("change", handlePhotoFiles);

  const videoStatus = container.querySelector("#sp-video-status");
  container.querySelector("#sp-add-video-btn").addEventListener("click", () => {
    container.querySelector("#sp-video-input").click();
  });
  container.querySelector("#sp-video-input").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    video = file;
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    videoStatus.textContent = `🎥 Vidéo ajoutée (${mb} Mo)`;
    refreshDraftUI();
  });

  const generateBtn = container.querySelector("#sp-generate-btn");
  generateBtn.addEventListener("click", async () => {
    if (photos.length === 0) return;
    generateBtn.disabled = true;
    generateBtn.textContent = "🤖 Génération en cours…";
    try {
      const MAX_AI_PHOTOS = 4;
      const photosForAI = photos.slice(0, MAX_AI_PHOTOS);
      const images = await Promise.all(
        photosForAI.map(async (p) => {
          const smaller = await resizeImage(p.blob, 900, 0.65);
          const dataUrl = await blobToDataURL(smaller);
          return dataUrl.split(",")[1];
        })
      );
      const res = await fetch(`${FUNCTIONS_BASE}/generate-social-post`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ images }),
      });
      if (!res.ok) throw new Error("Erreur serveur");
      const result = await res.json();
      container.querySelector("#sp-caption-input").value = result.caption || "";
      container.querySelector("#sp-caption-zone").style.display = "block";
      showToast("Texte généré — relisez et modifiez si besoin");
    } catch {
      showToast("Analyse impossible pour le moment, réessayez");
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = "🤖 Générer le texte avec l'IA";
    }
  });

  const montageBtn = container.querySelector("#sp-montage-btn");
  const montageProgress = container.querySelector("#sp-montage-progress");
  const montagePreview = container.querySelector("#sp-montage-preview");
  montageBtn.addEventListener("click", async () => {
    if (photos.length === 0 && !video) {
      showToast("Ajoutez au moins une photo ou une vidéo");
      return;
    }
    montageBtn.disabled = true;
    montagePreview.style.display = "none";
    try {
      const photosForMontage = photos.slice(0, MAX_MONTAGE_PHOTOS);
      const imageUrls = [];
      for (let i = 0; i < photosForMontage.length; i++) {
        montageProgress.textContent = `Envoi de la photo ${i + 1}/${photosForMontage.length}…`;
        const url = await uploadToShotstack(photosForMontage[i].blob);
        imageUrls.push(url);
      }

      let videoUrl = null;
      let videoLength = 0;
      if (video) {
        montageProgress.textContent = "Envoi de la vidéo…";
        videoUrl = await uploadToShotstack(video);
        videoLength = await getVideoDuration(video);
      }

      montageProgress.textContent = "Assemblage du montage…";
      const track = MUSIC_LIBRARY.find((t) => t.id === container.querySelector("#sp-music-select").value) || MUSIC_LIBRARY[0];
      const submitRes = await fetch(`${FUNCTIONS_BASE}/shotstack-render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          images: imageUrls,
          video: videoUrl,
          videoLength,
          musicUrl: `${SITE_ORIGIN}/audio/${track.file}`,
        }),
      });
      if (!submitRes.ok) throw new Error("Impossible de lancer le montage");
      const { renderId } = await submitRes.json();

      montageProgress.textContent = "Rendu en cours (peut prendre 1 à 2 minutes)…";
      let finalUrl = null;
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusRes = await fetch(`${FUNCTIONS_BASE}/shotstack-status?type=render&id=${renderId}`);
        const data = await statusRes.json();
        if (data.status === "done") {
          finalUrl = data.url;
          break;
        }
        if (data.status === "failed") throw new Error("Le montage a échoué");
      }
      if (!finalUrl) throw new Error("Délai dépassé pendant le rendu");

      montageProgress.textContent = "Téléchargement du résultat…";
      const videoRes = await fetch(finalUrl);
      montageBlob = await videoRes.blob();
      if (montageUrl) URL.revokeObjectURL(montageUrl);
      montageUrl = URL.createObjectURL(montageBlob);
      montagePreview.src = montageUrl;
      montagePreview.style.display = "block";
      montageProgress.textContent = "✅ Montage prêt (aperçu avec filigrane tant que le compte Shotstack est en mode test).";
      showToast("Montage vidéo prêt");
    } catch (err) {
      montageProgress.textContent = "";
      showToast(err.message || "Le montage vidéo a échoué, réessayez");
    } finally {
      montageBtn.disabled = false;
    }
  });

  container.querySelector("#sp-validate-btn").addEventListener("click", async () => {
    const caption = container.querySelector("#sp-caption-input").value.trim();
    if (!caption) {
      showToast("Générez ou écrivez d'abord un texte de publication");
      return;
    }
    if (photos.length === 0) {
      showToast("Ajoutez au moins une photo");
      return;
    }
    const post = {
      id: uid(),
      createdAt: Date.now(),
      caption,
      photos: photos.map((p) => ({ id: p.id, blob: p.blob })),
      video: video || null,
      montageVideo: montageBlob || null,
      status: "validated",
    };
    await Store.put("socialPosts", post);
    showToast("Publication validée");
    await render(container);
  });

  container.querySelectorAll(".sp-share-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const post = await Store.get("socialPosts", btn.dataset.id);
      if (!post) return;
      await sharePost(post, container);
    });
  });
}

async function sharePost(post, container) {
  try {
    const files = post.montageVideo
      ? [new File([post.montageVideo], "ecosolarnet-montage.mp4", { type: "video/mp4" })]
      : (post.photos || []).map((p, i) => new File([p.blob], `ecosolarnet-${i + 1}.jpg`, { type: "image/jpeg" }));

    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, text: post.caption, title: "ECOSOLARNET" });
      await Store.put("socialPosts", { ...post, status: "shared" });
      showToast("Partagé — choisissez Facebook, Instagram ou TikTok");
      await render(container);
      return;
    }
    if (navigator.share) {
      await navigator.share({ text: post.caption, title: "ECOSOLARNET" });
      await Store.put("socialPosts", { ...post, status: "shared" });
      await render(container);
      return;
    }
    await navigator.clipboard.writeText(post.caption);
    showToast("Le partage direct n'est pas disponible ici — le texte a été copié, enregistrez les photos/vidéo manuellement");
  } catch (err) {
    if (err.name !== "AbortError") showToast("Partage annulé ou impossible");
  }
}
