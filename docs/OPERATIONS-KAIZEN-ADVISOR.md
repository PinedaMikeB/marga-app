# Operations Kaizen Advisor

Daily and weekly owner/team-leader advisor for field operations, route waste, petty cash, time logs, and continuous improvement.

## Run

```bash
node tools/operations-kaizen-advisor.mjs --date 2026-05-12
```

Useful modes:

```bash
# Team leader, before finalizing tomorrow's schedule
node tools/operations-kaizen-advisor.mjs --date 2026-05-13 --mode schedule

# Owner report with AI interpretation
node tools/operations-kaizen-advisor.mjs --date 2026-05-12 --mode owner --ai

# Weekly owner report
node tools/operations-kaizen-advisor.mjs --date 2026-05-12 --weekly --ai

# Email report
node tools/operations-kaizen-advisor.mjs --date 2026-05-12 --mode owner --ai --email
```

Reports are written to `reports/operations-kaizen/`.

## Email / AI Env

Keep secrets outside git. The script loads `.env`, `.env.local`, and `~/.codex/env/marga-app.env`.

```bash
RESEND_API_KEY=...
MARGA_KAIZEN_EMAIL_TO=owner@example.com
MARGA_KAIZEN_EMAIL_FROM="Marga Kaizen <noreply@marga.biz>"

# Optional AI owner advisor
OPENAI_API_KEY=...
MARGA_KAIZEN_OPENAI_MODEL=gpt-4.1-mini
```

If AI is not configured, the report still produces rule-based recommendations.

## What It Measures

- same customer/location duplicate trips
- schedule transfer recommendations before finalizing
- staff route density and pending load
- field time-in/time-out discipline
- early stop with pending tasks
- petty cash by field staff
- petty cash without same-day route assignment
- estimated savings from avoided trips

## Kaizen Principle

The report should end with concrete next steps:

- what the team leader should correct before dispatch
- what field-control issue needs action today
- what owner policy should be tested next
- estimated savings where possible
