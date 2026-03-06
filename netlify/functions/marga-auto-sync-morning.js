const { runAutoSyncWithFailureHandling } = require("./_marga-auto-sync-core");

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

exports.config = {
  schedule: "15 0 * * *",
};

exports.handler = async (event = {}) => {
  if (event.httpMethod === "OPTIONS") {
    return toJson(204, {});
  }

  const result = await runAutoSyncWithFailureHandling("morning");
  if (!result.ok) return toJson(500, result);
  return toJson(200, result);
};

