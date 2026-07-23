// RETIRED 2026-07-23: Netlify + Firebase elimination plan (see MASTERPLAN.md
// "Netlify + Firebase Full Elimination Plan"). This scheduled sync must not run.
// Do not restore the schedule or re-wire this to Firebase; Postgres/Margabase
// is the single source of truth going forward.
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

exports.handler = async () => {
  return toJson(200, { ok: true, retired: true, message: "marga-auto-sync-evening-background is retired; Firebase auto-sync is disabled." });
};
