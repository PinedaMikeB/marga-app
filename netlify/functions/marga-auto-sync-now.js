function toJson(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Auto-Sync-Token",
    },
    body: JSON.stringify(body),
  };
}

function authorized(event) {
  const expected = String(process.env.MARGA_SYNC_TRIGGER_TOKEN || "").trim();
  if (!expected) return true;
  const fromHeader =
    event.headers?.["x-auto-sync-token"] ||
    event.headers?.["X-Auto-Sync-Token"] ||
    "";
  const fromQuery = event.queryStringParameters?.token || "";
  const provided = String(fromHeader || fromQuery || "").trim();
  return provided && provided === expected;
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
  if (!["GET", "POST"].includes(String(event.httpMethod || "GET").toUpperCase())) {
    return toJson(405, { error: "Method not allowed." });
  }
  if (!authorized(event)) {
    return toJson(401, { error: "Unauthorized trigger." });
  }

  const modeRaw = String(event.queryStringParameters?.mode || "manual").trim().toLowerCase();
  const mode = ["manual", "evening", "morning"].includes(modeRaw) ? modeRaw : "manual";
  const force = ["1", "true", "yes"].includes(String(event.queryStringParameters?.force || "").toLowerCase());

  const qs = new URLSearchParams();
  qs.set("mode", mode);
  if (force) qs.set("force", "1");

  const baseUrl = getSiteBaseUrl(event);
  const triggerUrl = `${baseUrl}/.netlify/functions/marga-auto-sync-now-background?${qs.toString()}`;
  const headers = {};
  const token = String(process.env.MARGA_SYNC_TRIGGER_TOKEN || "").trim();
  if (token) headers["x-auto-sync-token"] = token;

  let status = 0;
  let payload = {};
  let raw = "";
  try {
    const response = await fetch(triggerUrl, {
      method: "POST",
      headers,
    });
    status = response.status;
    raw = await response.text();
    payload = raw ? JSON.parse(raw) : {};
  } catch (err) {
    return toJson(500, {
      error: "Failed to trigger background sync.",
      detail: err?.message || String(err),
      triggerUrl,
    });
  }

  if (status >= 400) {
    return toJson(status, {
      error: "Background sync trigger failed.",
      triggerUrl,
      backgroundStatus: status,
      payload,
      raw,
    });
  }

  return toJson(202, {
    ok: true,
    queued: true,
    mode,
    force,
    triggerUrl,
    backgroundStatus: status,
    backgroundPayload: payload,
  });
};
