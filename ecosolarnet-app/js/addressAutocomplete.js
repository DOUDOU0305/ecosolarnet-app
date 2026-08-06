import { escapeHtml } from "./toast.js";

const MIN_QUERY_LEN = 4;
const DEBOUNCE_MS = 450;

async function nominatimSearch(params) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=be&${params}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  return res.json();
}

function cityFromAddress(a) {
  return a.city || a.town || a.village || a.municipality || a.county || "";
}

// Autocomplete plein-texte sur le champ adresse : suggestions d'adresses
// complètes (rue + numéro + code postal + ville), sélection en un clic.
export function wireAddressAutocomplete({ addressInput, postalInput, cityInput, onPick } = {}) {
  if (!addressInput) return;

  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  addressInput.parentNode.insertBefore(wrapper, addressInput);
  wrapper.appendChild(addressInput);
  const dropdown = document.createElement("div");
  dropdown.className = "address-suggestions";
  wrapper.appendChild(dropdown);

  let debounceTimer;
  let requestToken = 0;

  addressInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const query = addressInput.value.trim();
    if (query.length < MIN_QUERY_LEN) {
      dropdown.innerHTML = "";
      return;
    }
    debounceTimer = setTimeout(() => fetchSuggestions(query), DEBOUNCE_MS);
  });

  async function fetchSuggestions(query) {
    const token = ++requestToken;
    try {
      const results = await nominatimSearch(`limit=5&q=${encodeURIComponent(query + ", Belgique")}`);
      if (token !== requestToken) return; // une saisie plus récente a pris le dessus
      renderSuggestions(results);
    } catch {
      if (token === requestToken) dropdown.innerHTML = "";
    }
  }

  function renderSuggestions(results) {
    if (!results.length) {
      dropdown.innerHTML = "";
      return;
    }
    dropdown.innerHTML = results.map((r, i) => `<div class="address-suggestion" data-idx="${i}">${escapeHtml(r.display_name)}</div>`).join("");
    dropdown.querySelectorAll(".address-suggestion").forEach((el) => {
      el.addEventListener("click", () => {
        const r = results[Number(el.dataset.idx)];
        applyResult(r);
        dropdown.innerHTML = "";
      });
    });
  }

  function applyResult(r) {
    const a = r.address || {};
    const road = a.road || a.pedestrian || a.footway || a.residential || "";
    const houseNumber = a.house_number || "";
    if (road) addressInput.value = [road, houseNumber].filter(Boolean).join(" ");
    if (postalInput && a.postcode) postalInput.value = a.postcode;
    const city = cityFromAddress(a);
    if (cityInput && city) cityInput.value = city;
    if (typeof onPick === "function") {
      onPick({ lat: parseFloat(r.lat), lng: parseFloat(r.lon) });
    }
  }

  document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target)) dropdown.innerHTML = "";
  });
}

// Remplissage croisé code postal <-> ville, indépendant de l'autocomplete
// d'adresse (utile quand on connaît l'un avant l'autre).
export function wirePostalCityCross({ postalInput, cityInput } = {}) {
  if (!postalInput || !cityInput) return;
  let programmatic = false;
  let postalTimer;
  let cityTimer;

  postalInput.addEventListener("input", () => {
    if (programmatic) return;
    clearTimeout(postalTimer);
    const pc = postalInput.value.trim();
    if (!/^\d{4}$/.test(pc)) return;
    postalTimer = setTimeout(async () => {
      try {
        const results = await nominatimSearch(`postalcode=${encodeURIComponent(pc)}&limit=1`);
        const city = results[0] ? cityFromAddress(results[0].address || {}) : "";
        if (city && !cityInput.value.trim()) {
          programmatic = true;
          cityInput.value = city;
          programmatic = false;
        }
      } catch {
        // pas grave, l'utilisateur peut toujours taper la ville lui-même
      }
    }, DEBOUNCE_MS);
  });

  cityInput.addEventListener("input", () => {
    if (programmatic) return;
    clearTimeout(cityTimer);
    const city = cityInput.value.trim();
    if (city.length < 3) return;
    cityTimer = setTimeout(async () => {
      try {
        const results = await nominatimSearch(`city=${encodeURIComponent(city)}&limit=5`);
        const withPostcode = results.find((r) => r.address?.postcode);
        const pc = withPostcode?.address?.postcode || "";
        if (pc && !postalInput.value.trim()) {
          programmatic = true;
          postalInput.value = pc;
          programmatic = false;
        }
      } catch {
        // idem, échec silencieux
      }
    }, DEBOUNCE_MS);
  });
}
