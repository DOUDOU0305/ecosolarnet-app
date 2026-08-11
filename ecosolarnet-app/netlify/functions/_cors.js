// The Capacitor iOS app calls these functions from a native WebView (not the
// Netlify origin), so responses need CORS headers or the fetch is blocked.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.withCors = function withCors(handler) {
  return async function wrapped(event, context) {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: CORS_HEADERS, body: "" };
    }
    const response = await handler(event, context);
    return { ...response, headers: { ...(response.headers || {}), ...CORS_HEADERS } };
  };
};
