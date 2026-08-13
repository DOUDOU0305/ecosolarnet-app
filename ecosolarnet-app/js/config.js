// Netlify hosts the serverless functions (AI, Gmail classify, photo analysis).
// In the native app the WebView isn't same-origin with Netlify, so calls must be absolute.
// On the web PWA (served from Netlify itself) a relative path also works fine.
const NETLIFY_ORIGIN = "https://frabjous-treacle-60d239.netlify.app";
const isNative = typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();

export const FUNCTIONS_BASE = isNative ? `${NETLIFY_ORIGIN}/.netlify/functions` : "/.netlify/functions";
