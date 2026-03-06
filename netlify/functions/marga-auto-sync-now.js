const { runAutoSyncWithFailureHandling } = require("./_marga-auto-sync-core");

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
  const result = await runAutoSyncWithFailureHandling(mode, { force });

  if (!result.ok) return toJson(500, result);
  return toJson(200, result);
};

