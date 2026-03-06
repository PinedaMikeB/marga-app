function toJson(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Auto-Sync-Token",
    },
    body: JSON.stringify(body),
  };
}

function getSiteBaseUrl(event) {
  const envUrl = String(process.env.URL || "").trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  const host = event.headers?.host || event.headers?.Host || "";
  const proto = event.headers?.["x-forwarded-proto"] || event.headers?.["X-Forwarded-Proto"] || "https";
  if (host) return `${proto}://${host}`;
  return "https://margaapp.netlify.app";
}

exports.handler = async (event = {}) => {
  if (event.httpMethod === "OPTIONS") {
    return toJson(204, {});
  }
  const baseUrl = getSiteBaseUrl(event);
  const triggerUrl = `${baseUrl}/.netlify/functions/marga-auto-sync-evening-background`;
  const token = String(process.env.MARGA_SYNC_TRIGGER_TOKEN || "").trim();
  const headers = token ? { "x-auto-sync-token": token } : {};
  const response = await fetch(triggerUrl, { method: "POST", headers });
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (_) {
    payload = { raw };
  }
  return toJson(response.ok ? 202 : response.status, {
    ok: response.ok,
    queued: response.ok,
    triggerUrl,
    backgroundStatus: response.status,
    backgroundPayload: payload,
  });
};
