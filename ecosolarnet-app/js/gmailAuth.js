const GOOGLE_CLIENT_ID = "278842755387-vjde1sa3n0ipua3ici7gan2540i6ocm3.apps.googleusercontent.com";
const REDIRECT_URI = "https://frabjous-treacle-60d239.netlify.app";
const REDIRECT_STATE_KEY = "gmailAuthState";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

let tokenClient = null;
let currentToken = null; // { access_token, expiresAt }
let gisLoadPromise = null;

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function loadGis() {
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Impossible de charger la connexion Google"));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

function randomState() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function startRedirectFlow() {
  const state = randomState();
  sessionStorage.setItem(REDIRECT_STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "token",
    scope: SCOPES,
    include_granted_scopes: "true",
    state,
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// À appeler une seule fois au démarrage de l'appli, avant le routage par hash,
// pour récupérer le jeton renvoyé par Google après la redirection en plein écran.
export function consumeRedirectToken() {
  const hash = window.location.hash;
  if (!hash || !hash.includes("access_token=")) return false;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  const accessToken = params.get("access_token");
  const expiresIn = params.get("expires_in");
  const state = params.get("state");
  const savedState = sessionStorage.getItem(REDIRECT_STATE_KEY);
  sessionStorage.removeItem(REDIRECT_STATE_KEY);
  if (!accessToken || !state || state !== savedState) return false;
  currentToken = {
    access_token: accessToken,
    expiresAt: Date.now() + (Number(expiresIn) || 3600) * 1000,
  };
  return true;
}

export function isConnected() {
  return !!(currentToken && currentToken.expiresAt > Date.now() + 5000);
}

export async function getAccessToken({ interactive = false } = {}) {
  if (isConnected()) return currentToken.access_token;

  if (isStandalone()) {
    if (!interactive) throw new Error("Reconnexion Gmail nécessaire");
    startRedirectFlow();
    return new Promise(() => {}); // la page va se recharger via la redirection
  }

  await loadGis();
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: () => {},
    });
  }

  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      currentToken = {
        access_token: resp.access_token,
        expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
      };
      resolve(currentToken.access_token);
    };
    try {
      tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
    } catch (err) {
      reject(err);
    }
  });
}

export function disconnect() {
  if (currentToken?.access_token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(currentToken.access_token, () => {});
  }
  currentToken = null;
}
