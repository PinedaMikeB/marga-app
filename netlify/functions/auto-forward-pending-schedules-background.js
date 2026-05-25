const { runAutoForwardPendingSchedules } = require("../../tools/auto-forward-pending-schedules-core.cjs");

function toJson(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

exports.config = {
  // 18:00 Asia/Manila == 10:00 UTC. Run Mon-Sat (match prior Codex automation).
  schedule: "0 10 * * 1-6",
};

exports.handler = async (event = {}) => {
  if (event.httpMethod === "OPTIONS") return toJson(204, {});

  try {
    const result = await runAutoForwardPendingSchedules({
      envFilePath: "",
      dryRun: false,
    });
    return toJson(200, result);
  } catch (error) {
    return toJson(500, {
      ok: false,
      error: error?.message || String(error),
    });
  }
};
