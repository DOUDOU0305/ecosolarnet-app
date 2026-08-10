const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailFetch(token, path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail API ${res.status} : ${text.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function getProfile(token) {
  return gmailFetch(token, "/profile");
}

export async function listInboxMessages(token, { maxResults = 15, query = "in:inbox newer_than:14d" } = {}) {
  const data = await gmailFetch(token, `/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`);
  return data.messages || [];
}

function decodeBase64Url(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64);
  const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function extractBody(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decodeBase64Url(plain.body.data);
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}

export async function getMessage(token, id) {
  const data = await gmailFetch(token, `/messages/${id}?format=full`);
  const headers = data.payload?.headers || [];
  const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
  const body = extractBody(data.payload).slice(0, 6000);
  return {
    id: data.id,
    threadId: data.threadId,
    subject: getHeader("Subject"),
    from: getHeader("From"),
    to: getHeader("To"),
    cc: getHeader("Cc"),
    messageIdHeader: getHeader("Message-ID"),
    date: getHeader("Date"),
    snippet: data.snippet || "",
    body: body || data.snippet || "",
  };
}

export async function trashMessage(token, id) {
  await gmailFetch(token, `/messages/${id}/trash`, { method: "POST" });
}

export async function untrashMessage(token, id) {
  await gmailFetch(token, `/messages/${id}/untrash`, { method: "POST" });
}

function base64UrlEncodeUnicode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function extractEmailAddress(fromHeader) {
  const match = String(fromHeader || "").match(/<([^>]+)>/);
  return match ? match[1] : String(fromHeader || "").trim();
}

export async function sendReply(token, { threadId, to, subject, body, messageIdHeader }) {
  const toAddress = extractEmailAddress(to);
  const replySubject = /^re:/i.test(subject || "") ? subject : `Re: ${subject || ""}`;
  const lines = [
    `To: ${toAddress}`,
    `Subject: ${replySubject}`,
    messageIdHeader ? `In-Reply-To: ${messageIdHeader}` : null,
    messageIdHeader ? `References: ${messageIdHeader}` : null,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].filter((l) => l !== null);
  const raw = base64UrlEncodeUnicode(lines.join("\r\n"));
  return gmailFetch(token, "/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw, threadId }),
  });
}
