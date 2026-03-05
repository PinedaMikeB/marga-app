# Collections API for OpenClaw

Endpoint:
- `GET /api/collections`

Auth:
- Optional API key via env `OPENCLAW_API_KEY`.
- If enabled, send one of:
  - Header `x-api-key: <key>`
  - Header `Authorization: Bearer <key>`
  - Query `?api_key=<key>`

Core query params:
- `from=YYYY-MM-DD`
- `to=YYYY-MM-DD`
- `search=<company|invoice>`
- `priority=urgent,high,medium,current,review,baddebt,doubtful`
- `company=<name>`
- `branch=<name>`
- `invoice_id=<invoice id/no>`
- `year=<YYYY>`
- `month=<january...december>`
- `min_age=<days>`
- `max_age=<days>`
- `include_paid=true|false` (default `true`)
- `include_history=true|false` (default `true`)
- `page=<number>` (default `1`)
- `page_size=<number>` (default `200`, max `1000`)
- `refresh_cache=true|false`

Example:

```bash
curl "https://margaapp.netlify.app/api/collections?from=2026-02-01&to=2026-02-28&page=1&page_size=100" \
  -H "x-api-key: YOUR_OPENCLAW_API_KEY"
```

Response shape:
- `meta`: pagination + cache metadata
- `filters`: applied filters
- `summary`:
  - `total_invoices`, `total_amount`, `total_unpaid_amount`, `total_paid_amount`
  - `average_age_days`
  - `by_priority`
  - `duration`:
    - `total_bill`
    - `total_collections`
    - `need_to_collect`
    - `bill_invoice_count`
    - `payment_count`
    - `unpaid_invoice_count`
- `data[]` (invoice-level):
  - invoice details: invoice no/id, dates, company, branch/department, category, amount, age, priority
  - call-follow up details: last remarks, last contact person/number/date, next follow-up, schedule status
  - full follow-up history when `include_history=true`
