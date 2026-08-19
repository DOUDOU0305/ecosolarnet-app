const GOOGLE_CLIENT_ID = "278842755387-vjde1sa3n0ipua3ici7gan2540i6ocm3.apps.googleusercontent.com";
const GOOGLE_IOS_CLIENT_ID = "278842755387-6alul7gv7522fv6t8j8vhcg80aepf0tm.apps.googleusercontent.com";
const IOS_REDIRECT_URI = "com.googleusercontent.apps.278842755387-6alul7gv7522fv6t8j8vhcg80aepf0tm:/oauth2redirect";
const REDIRECT_URI = "https://frabjous-treacle-60d239.netlify.app";
const REDIRECT_STATE_KEY = "gmailAuthState";
const NATIVE_TOKEN_KEY = "gmailNativeTokens"; // { access_token, refresh_token, expiresAt }
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

function isNative() {
  return typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();
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

// PKCE : le "code_verifier" est un secret généré localement, jamais envoyé tel
// quel ; seul son empreinte SHA-256 ("code_challenge") part vers Google avec
// la demande d'autorisation. Ça permet d'utiliser le flux "Authorization
// Code" sans avoir de client_secret à cacher (impossible dans une app iOS
// dont le code est sur l'appareil de l'utilisateur) — c'est le flux que
// Google impose pour les clients OAuth de type "iOS".
function randomVerifier() {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes) {
  let str = "";
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function codeChallengeFor(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
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
    prompt: "select_account",
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

function loadNativeTokens() {
  try {
    const raw = localStorage.getItem(NATIVE_TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveNativeTokens(tokens) {
  localStorage.setItem(NATIVE_TOKEN_KEY, JSON.stringify(tokens));
}

// Le WKWebView natif d'iOS n'est pas un vrai Safari : Google le détecte comme
// "navigateur non sécurisé" et bloque toute tentative de connexion, que ce
// soit en redirection plein écran ou en pop-up (erreur "disallowed_useragent").
// La seule solution supportée par Google pour une app iOS est d'ouvrir la
// page de connexion dans le VRAI Safari (via le plugin Browser, qui utilise
// SFSafariViewController — explicitement autorisé par Google), puis de
// récupérer la main quand Safari redirige vers un lien spécial à l'app
// (com.googleusercontent.apps...:/oauth2redirect) que iOS route directement
// vers cette app plutôt que vers un site web.
async function nativeInteractiveLogin() {
  const verifier = randomVerifier();
  const challenge = await codeChallengeFor(verifier);
  const state = randomState();

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", GOOGLE_IOS_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", IOS_REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "consent");

  const code = await new Promise((resolve, reject) => {
    let settled = false;
    const handle = window.NativeApp.addListener("appUrlOpen", ({ url }) => {
      if (!url || !url.startsWith(IOS_REDIRECT_URI)) return;
      settled = true;
      handle.then((h) => h.remove());
      window.NativeBrowser.close().catch(() => {});
      const returned = new URL(url.replace(":/oauth2redirect", ":///oauth2redirect"));
      const returnedState = returned.searchParams.get("state");
      const returnedCode = returned.searchParams.get("code");
      const error = returned.searchParams.get("error");
      if (error) {
        reject(new Error(error));
      } else if (!returnedCode || returnedState !== state) {
        reject(new Error("Réponse de connexion invalide"));
      } else {
        resolve(returnedCode);
      }
    });
    window.NativeBrowser.open({ url: authUrl.toString() });
    // Filet de sécurité : si l'utilisateur ferme Safari sans se connecter,
    // ne pas laisser la promesse pendre indéfiniment.
    window.NativeBrowser.addListener("browserFinished", () => {
      if (!settled) reject(new Error("Connexion annulée"));
    });
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_IOS_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: IOS_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) throw new Error("Échec de l'échange du code Google");
  const data = await tokenRes.json();

  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || loadNativeTokens()?.refresh_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  saveNativeTokens(tokens);
  currentToken = { access_token: tokens.access_token, expiresAt: tokens.expiresAt };
  return tokens.access_token;
}

async function nativeSilentRefresh() {
  const stored = loadNativeTokens();
  if (!stored?.refresh_token) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_IOS_CLIENT_ID,
      refresh_token: stored.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const tokens = {
    access_token: data.access_token,
    refresh_token: stored.refresh_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  saveNativeTokens(tokens);
  currentToken = { access_token: tokens.access_token, expiresAt: tokens.expiresAt };
  return tokens.access_token;
}

export function isConnected() {
  if (isNative()) return !!(loadNativeTokens()?.refresh_token);
  return !!(currentToken && currentToken.expiresAt > Date.now() + 5000);
}

export async function getAccessToken({ interactive = false } = {}) {
  if (isNative()) {
    if (currentToken && currentToken.expiresAt > Date.now() + 5000) return currentToken.access_token;
    const refreshed = await nativeSilentRefresh();
    if (refreshed) return refreshed;
    if (!interactive) throw new Error("Reconnexion Gmail nécessaire");
    return nativeInteractiveLogin();
  }

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
  if (isNative()) {
    localStorage.removeItem(NATIVE_TOKEN_KEY);
    currentToken = null;
    return;
  }
  if (currentToken?.access_token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(currentToken.access_token, () => {});
  }
  currentToken = null;
}
