const config = window.MARGA_CARE_CONFIG || {};

const views = [
  { key: "dashboard", label: "Dashboard", title: "Managed Care Dashboard", eyebrow: "Overview", icon: "grid" },
  { key: "service", label: "Service Requests", title: "Service Requests", eyebrow: "Support", icon: "support" },
  { key: "acknowledgement", label: "Work Acknowledgement", title: "Customer Work Acknowledgement", eyebrow: "Service", icon: "check" },
  { key: "billing", label: "Billing History", title: "Billing History", eyebrow: "Account", icon: "invoice" },
  { key: "payments", label: "Payment Records", title: "Payment Records", eyebrow: "Account", icon: "payment" },
  { key: "usage", label: "Printer Usage", title: "Printer Usage", eyebrow: "Monitoring", icon: "chart" },
  { key: "toner", label: "Toner / Ink", title: "Toner / Ink Monitoring", eyebrow: "Supplies", icon: "drop" },
  { key: "updates", label: "Support Updates", title: "Support Updates", eyebrow: "Timeline", icon: "bell" }
];

const demoData = {
  account: "Singapore Medical Diagnostics",
  devices: [
    { serial: "882026041158", model: "Brother DCP-L2540DW", branch: "Front Desk Head Office", usage: 2540, toner: "Low", status: "Active" },
    { serial: "CNB7K51044", model: "HP LaserJet M404dn", branch: "Billing Office", usage: 1182, toner: "Good", status: "Active" },
    { serial: "X9K2108831", model: "Canon IR 2525", branch: "Records Room", usage: 6930, toner: "Watch", status: "Service Due" },
    { serial: "E69909A4N500567", model: "Brother MFC-7860DW", branch: "Makati Accounting and Purchasing", usage: 0, toner: "Good", status: "Active" },
    { serial: "LP06524695", model: "M8650DN", branch: "Makati Accounting and Purchasing", usage: 0, toner: "Good", status: "Active" },
    { serial: "E80729L1H811187", model: "Brother DCP-T820DW", branch: "Quality Control", usage: 0, toner: "Good", status: "Active" },
    { serial: "CNPNC17634", model: "HP3035", branch: "Quality Control Additional 3035", usage: 0, toner: "Good", status: "Active" }
  ],
  tickets: [
    { id: "SR-1042", serial: "882026041158", branch: "Front Desk Head Office", issue: "Paper jam and faint print", status: "In Progress", updated: "Today 3:12 PM" },
    { id: "SR-1037", serial: "X9K2108831", branch: "Records Room", issue: "Preventive maintenance request", status: "Scheduled", updated: "Yesterday 9:40 AM" }
  ],
  invoices: [
    { no: "INV-2026-0412", period: "April 2026", amount: 12850, status: "Unpaid", due: "May 10, 2026" },
    { no: "INV-2026-0314", period: "March 2026", amount: 11720, status: "Paid", due: "Apr 10, 2026" }
  ],
  payments: [
    { or: "OR-88420", invoice: "INV-2026-0314", amount: 11720, date: "Apr 8, 2026", method: "Bank Transfer" },
    { or: "OR-87991", invoice: "INV-2026-0211", amount: 12300, date: "Mar 7, 2026", method: "Check" }
  ],
  updates: [
    { title: "Service request SR-1042 assigned", body: "A technician has been assigned and will confirm the site visit window.", time: "Today" },
    { title: "April invoice posted", body: "Your April billing statement is now available for review.", time: "Yesterday" }
  ],
  workAcknowledgements: [
    {
      id: "WA-2407",
      ticket: "SR-1042",
      type: "Repair / Cleaning",
      status: "Awaiting Acknowledgement",
      serial: "882026041158",
      machine: "882026041158 - Brother DCP-L2540DW",
      branch: "Front Desk Head Office",
      technician: "R. Santos",
      completedAt: "Today 4:18 PM",
      work: "Cleared paper path, cleaned rollers, tested print output, and checked toner level.",
      notes: "Print is now clear. Customer reported occasional jam on thick paper; technician advised monitoring.",
      followUp: "No parts requested.",
      proof: "2 service photos attached"
    },
    {
      id: "WA-2406",
      ticket: "SR-1037",
      type: "Preventive Maintenance",
      status: "Acknowledged",
      serial: "X9K2108831",
      machine: "X9K2108831 - Canon IR 2525",
      branch: "Records Room",
      technician: "M. Dela Cruz",
      completedAt: "Yesterday 11:25 AM",
      work: "Performed preventive maintenance, cleaned scanner glass, checked feeder, and verified meter reading.",
      notes: "Machine is operational. Customer was informed that feed rollers may need future replacement.",
      followUp: "Service team to monitor roller condition.",
      proof: "PM checklist attached"
    }
  ]
};

const pilotAccess = [
  {
    serial: "882026041158",
    pin: "483921",
    account: "Singapore Medical Diagnostics",
    accessType: "Standalone Account",
    companyId: "demo-smd",
    allowedSerials: ["882026041158"],
    contactName: "Front Desk Representative",
    officialEmail: "service@marga.biz"
  },
  {
    serial: "X9K2108831",
    pin: "274611",
    account: "Singapore Medical Diagnostics",
    accessType: "Branch-Managed Account",
    companyId: "demo-smd",
    allowedSerials: ["X9K2108831"],
    contactName: "Records Room Representative",
    officialEmail: "service@marga.biz"
  },
  {
    serial: "CNB7K51044",
    pin: "905144",
    account: "Singapore Medical Diagnostics",
    accessType: "Centralized Procurement Account",
    companyId: "demo-smd",
    allowedSerials: ["CNB7K51044", "882026041158", "X9K2108831"],
    contactName: "Purchasing",
    officialEmail: "service@marga.biz"
  },
  {
    serial: "LP06524695",
    pin: "785230",
    account: "Liberty Flour Mills",
    accessType: "Account Coordinator",
    companyId: "liberty-flour",
    allowedSerials: ["E69909A4N500567", "LP06524695", "E80729L1H811187", "CNPNC17634"],
    contactName: "Ms. Mary Jaen",
    officialEmail: "service@marga.biz"
  },
  {
    serial: "E69909A4N500567",
    pin: "493812",
    account: "Liberty Flour Mills",
    accessType: "Branch Requester",
    companyId: "liberty-flour",
    allowedSerials: ["E69909A4N500567"],
    contactName: "Makati Accounting and Purchasing",
    officialEmail: "service@marga.biz"
  },
  {
    serial: "LP06524695",
    pin: "726184",
    account: "Liberty Flour Mills",
    accessType: "Branch Requester",
    companyId: "liberty-flour",
    allowedSerials: ["LP06524695"],
    contactName: "Makati Accounting and Purchasing",
    officialEmail: "service@marga.biz"
  },
  {
    serial: "E80729L1H811187",
    pin: "218604",
    account: "Liberty Flour Mills Quality Control",
    accessType: "Department Requester",
    companyId: "liberty-flour-qc",
    allowedSerials: ["E80729L1H811187"],
    contactName: "Quality Control",
    officialEmail: "service@marga.biz"
  },
  {
    serial: "CNPNC17634",
    pin: "639205",
    account: "Liberty Flour Mills Quality Control",
    accessType: "Department Requester",
    companyId: "liberty-flour-qc",
    allowedSerials: ["CNPNC17634"],
    contactName: "Quality Control Additional 3035",
    officialEmail: "service@marga.biz"
  }
];

const customerTroubles = [
  { id: 49, label: "Paper jam", serviceLabel: "Jamming" },
  { id: 175, label: "Blurred print", serviceLabel: "Blurred Print" },
  { id: 22, label: "Blurred copy", serviceLabel: "Blurred Copy" },
  { id: 50, label: "Light print or faded output", serviceLabel: "Light Print" },
  { id: 183, label: "Dark print", serviceLabel: "Dark Print" },
  { id: 263, label: "Dark copy", serviceLabel: "Dark Copy" },
  { id: 123, label: "Lines on print or copy", serviceLabel: "Lines" },
  { id: 32, label: "Spots on print or copy", serviceLabel: "Dark Spot" },
  { id: 107, label: "Error code / warning message", serviceLabel: "Error Code" },
  { id: 58, label: "No power", serviceLabel: "No Power" },
  { id: 177, label: "Cannot print", serviceLabel: "Unable to Print" },
  { id: 73, label: "Slow printing or copying", serviceLabel: "Slow Print" },
  { id: 56, label: "Noisy machine", serviceLabel: "Noisy" },
  { id: 216, label: "Scanner problem", serviceLabel: "Scanner Problem" },
  { id: 62, label: "Paper feed problem", serviceLabel: "Paper Feed Problem" },
  { id: 172, label: "Connection problem", serviceLabel: "Connection" },
  { id: 362, label: "Network problem", serviceLabel: "Network" },
  { id: 148, label: "Offline", serviceLabel: "Off Line" },
  { id: 102, label: "Other concern", serviceLabel: "Others" }
];

const MANUAL_ERROR_VALUE = "__manual_error__";
const CUSTOMER_REVIEW_COLLECTION = "marga_care_customer_reviews";

const modelErrorCodes = window.MARGA_MODEL_ERROR_GUIDES || [];

const reviewCriteria = [
  { key: "professionalism", label: "Professionalism", help: "Grooming, ID/uniform, neatness, and proper conduct." },
  { key: "courtesy", label: "Respect / Courtesy", help: "Polite, patient, and respectful while inside the customer site." },
  { key: "communication", label: "Communication", help: "Explained the issue, work done, pending items, and next step clearly." },
  { key: "accuracy", label: "Work Accuracy", help: "The requested work was handled correctly and completely." },
  { key: "timeliness", label: "Timeliness", help: "Arrived or updated the customer within a reasonable service window." },
  { key: "confidence", label: "Customer Confidence", help: "Customer feels the machine/request was handled properly." }
];

const complaintPatterns = [
  "complaint",
  "rude",
  "disrespect",
  "argument",
  "late",
  "no show",
  "not fixed",
  "same problem",
  "backjob",
  "dirty",
  "careless",
  "unprofessional",
  "poor",
  "bad",
  "angry",
  "disappointed",
  "not satisfied"
];

const state = {
  authed: false,
  currentView: "dashboard",
  data: demoData,
  access: null
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function toFirestoreFieldValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value)
    ? { integerValue: String(value) }
    : { doubleValue: value };
  return { stringValue: String(value ?? "") };
}

async function setFirestoreDocument(collection, docId, fields) {
  const firebase = config.firebase || {};
  if (!firebase.baseUrl || !firebase.apiKey) throw new Error("Firebase config is not available.");
  const body = { fields: {} };
  Object.entries(fields).forEach(([key, value]) => {
    body.fields[key] = toFirestoreFieldValue(value);
  });
  const response = await fetch(`${firebase.baseUrl}/${collection}/${docId}?key=${firebase.apiKey}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message || `Failed to save ${collection}/${docId}`);
  }
  return payload;
}

function average(values) {
  const clean = values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function reviewScoreLabel(score) {
  if (score >= 4.75) return "Excellent";
  if (score >= 4.25) return "Good";
  if (score >= 3.5) return "Fair";
  if (score >= 2.75) return "Needs Improvement";
  return "Poor";
}

function detectComplaint(text = "") {
  const normalized = String(text || "").toLowerCase();
  return complaintPatterns.some((pattern) => normalized.includes(pattern));
}

function sentimentLabel(text = "") {
  const normalized = String(text || "").toLowerCase();
  if (detectComplaint(normalized)) return "Complaint / Negative";
  if (/thank|satisfied|good|great|excellent|okay|ok|fixed|resolved|appreciate/.test(normalized)) return "Positive";
  return "Neutral";
}

function icon(name) {
  const icons = {
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>',
    support: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 16 0v4a3 3 0 0 1-3 3h-2"/><path d="M6 13H4v-2h2zM20 13h-2v-2h2zM9 18h6"/></svg>',
    invoice: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v18l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    payment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v10H4z"/><path d="M4 10h16M7 15h4"/></svg>',
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V5M5 19h14"/><path d="M9 16v-5M13 16V8M17 16v-8"/></svg>',
    drop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.2 6 11a6 6 0 0 1-12 0c0-4.8 6-11 6-11z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17h12l-1.5-2v-4a4.5 4.5 0 0 0-9 0v4z"/><path d="M10 20h4"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5 9.2 18 20 6"/><path d="M20 12a8 8 0 1 1-3.2-6.4"/></svg>'
  };
  return icons[name] || icons.grid;
}

function money(value) {
  return Number(value || 0).toLocaleString("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
}

function normalizeSerial(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeModel(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function modelMatches(entryModel, selectedModel) {
  const entryKey = normalizeModel(entryModel);
  const selectedKey = normalizeModel(selectedModel);
  return Boolean(entryKey && selectedKey && (entryKey === selectedKey || entryKey.includes(selectedKey) || selectedKey.includes(entryKey)));
}

function requestStoreKey() {
  return `marga_care_requests_${state.access?.companyId || "demo"}_${normalizeSerial(state.access?.serial || "all")}`;
}

function scopedDevices() {
  if (!state.access) return state.data.devices;
  const allowed = new Set((state.access.allowedSerials || []).map(normalizeSerial));
  return state.data.devices.filter((device) => allowed.has(normalizeSerial(device.serial)));
}

function isDemoAccount() {
  return state.access?.companyId === "demo-smd";
}

function accountInvoices() {
  return isDemoAccount() ? state.data.invoices : [];
}

function accountPayments() {
  return isDemoAccount() ? state.data.payments : [];
}

function accountUpdates() {
  return isDemoAccount() ? state.data.updates : [];
}

function loadPortalRequests() {
  try {
    return JSON.parse(localStorage.getItem(requestStoreKey()) || "[]");
  } catch (error) {
    return [];
  }
}

function savePortalRequests(requests) {
  localStorage.setItem(requestStoreKey(), JSON.stringify(requests));
}

function createPortalRequest(payload) {
  const requests = loadPortalRequests();
  const now = new Date();
  const request = {
    id: `MC-${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}-${String(requests.length + 1).padStart(3, "0")}`,
    source: "Managed Care App",
    status: "Submitted",
    createdAt: now.toISOString(),
    updated: "Just now",
    account: state.access?.account || state.data.account,
    requester: state.access?.contactName || "Customer",
    ...payload
  };
  savePortalRequests([request, ...requests]);
  return request;
}

function matchingModelErrorGuides(device, troubleId) {
  const matches = modelErrorCodes.filter((entry) => (
    (entry.models || []).some((model) => modelMatches(model, device?.model))
    && Number(entry.troubleId) === Number(troubleId)
  ));
  return matches;
}

function modelTroubleErrorOptions(device, troubleId) {
  const matches = matchingModelErrorGuides(device, troubleId);
  return [
    { value: "None", label: "None" },
    ...matches.map((entry) => ({
      value: entry.code,
      label: entry.message
    })),
    { value: MANUAL_ERROR_VALUE, label: "Other / not listed" }
  ];
}

function selectedErrorGuide(device, troubleId, code) {
  return modelErrorCodes.find((entry) => (
    (entry.models || []).some((model) => modelMatches(model, device?.model))
    && Number(entry.troubleId) === Number(troubleId)
    && entry.code === code
  )) || null;
}

function errorOptionsMarkup(device, troubleId) {
  const hasMatches = matchingModelErrorGuides(device, troubleId).length > 0;
  const placeholder = hasMatches ? '<option value="">Select error status...</option>' : "";
  return `${placeholder}${modelTroubleErrorOptions(device, troubleId)
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join("")}`;
}

function refreshErrorOptions(form) {
  const serial = form?.querySelector('[name="serial"]')?.value;
  const troubleId = Number(form?.querySelector('[name="trouble"]')?.value || 0);
  const device = scopedDevices().find((item) => item.serial === serial) || scopedDevices()[0];
  const errorSelect = form?.querySelector('[name="errorCode"]');
  const manualField = form?.querySelector("[data-manual-error-field]");
  if (!errorSelect) return;
  const hasMatches = matchingModelErrorGuides(device, troubleId).length > 0;
  errorSelect.innerHTML = errorOptionsMarkup(device, troubleId);
  errorSelect.disabled = Boolean(troubleId && !hasMatches);
  if (troubleId && !hasMatches) errorSelect.value = "None";
  renderErrorGuide(form);
  if (manualField) {
    manualField.classList.add("hidden");
    const input = manualField.querySelector("input");
    if (input) {
      input.required = false;
      input.value = "";
    }
  }
}

function renderErrorGuide(form) {
  const serial = form?.querySelector('[name="serial"]')?.value;
  const troubleId = Number(form?.querySelector('[name="trouble"]')?.value || 0);
  const code = form?.querySelector('[name="errorCode"]')?.value || "";
  const device = scopedDevices().find((item) => item.serial === serial) || scopedDevices()[0];
  const guide = selectedErrorGuide(device, troubleId, code);
  const hasGuides = matchingModelErrorGuides(device, troubleId).length > 0;
  const guideEl = form?.querySelector("[data-error-guide]");
  if (!guideEl) return;
  if (!guide) {
    if (troubleId && !hasGuides) {
      const trouble = customerTroubles.find((item) => item.id === troubleId);
      guideEl.classList.remove("hidden");
      guideEl.innerHTML = `
        <span>No LCD error required</span>
        <strong>${escapeHtml(trouble?.label || "Selected trouble")}</strong>
        <p>No model-specific LCD message is listed for this trouble, so the error field is set to None. Please upload a control panel photo or sample print if it helps show the issue.</p>
      `;
      return;
    }
    guideEl.classList.add("hidden");
    guideEl.innerHTML = "";
    return;
  }
  guideEl.classList.remove("hidden");
  guideEl.innerHTML = `
    <span>Initial remedy</span>
    <strong>${escapeHtml(guide.message)}</strong>
    <p>${escapeHtml(guide.meaning)}</p>
    <p>${escapeHtml(guide.remedy)}</p>
  `;
}

function serviceTickets() {
  const allowed = new Set(scopedDevices().map((device) => normalizeSerial(device.serial)));
  const saved = loadPortalRequests().map((request) => ({
    id: request.id,
    serial: request.serial,
    branch: request.branch,
    issue: request.errorCode && request.errorCode !== "None" ? `${request.trouble}: ${request.errorCode}` : (request.trouble || request.concern || request.notes || request.type),
    status: request.status,
    updated: request.updated || "Just now",
    source: request.source,
    sentiment: request.sentiment || "Neutral",
    complaintFlag: Boolean(request.complaintFlag)
  }));
  const demoTickets = state.data.tickets.filter((ticket) => allowed.has(normalizeSerial(ticket.serial)));
  return [...saved, ...demoTickets];
}

function badgeClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("acknowledged")) return "good";
  if (normalized.includes("concern")) return "danger";
  if (normalized.includes("awaiting")) return "watch";
  if (normalized.includes("paid") && !normalized.includes("unpaid")) return "good";
  if (normalized.includes("progress") || normalized.includes("scheduled") || normalized.includes("watch")) return "watch";
  if (normalized.includes("low") || normalized.includes("unpaid") || normalized.includes("due")) return "danger";
  return "neutral";
}

function card(title, body, accent = "") {
  return `<article class="panel ${accent}"><h3>${title}</h3>${body}</article>`;
}

function renderNav() {
  const nav = views.map((view) => `
    <button class="${state.currentView === view.key ? "active" : ""}" type="button" data-view="${view.key}">
      <span class="nav-icon">${icon(view.icon)}</span>
      <span>${view.label}</span>
    </button>
  `).join("");
  $("#sideNav").innerHTML = nav;
  $("#bottomNav").innerHTML = nav;
  document.querySelectorAll("#sideNav [data-view], #bottomNav [data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      setView(button.dataset.view);
      $(".sidebar").classList.remove("open");
    });
  });
}

function setView(viewKey) {
  state.currentView = views.some((view) => view.key === viewKey) ? viewKey : "dashboard";
  const view = views.find((item) => item.key === state.currentView);
  $("#sectionTitle").textContent = view.title;
  $("#sectionEyebrow").textContent = view.eyebrow;
  renderNav();
  renderContent();
}

function renderDashboard() {
  const tickets = serviceTickets();
  const devices = scopedDevices();
  const openTickets = tickets.filter((ticket) => ticket.status !== "Closed").length;
  const unpaid = accountInvoices().filter((invoice) => invoice.status !== "Paid");
  const pendingAck = acknowledgementJobs().filter((job) => String(job.status || "").toLowerCase().includes("awaiting")).length;

  return `
    <section class="hero-panel">
      <div>
        <p class="eyebrow">${escapeHtml(state.access?.accessType || "Live Account")}</p>
        <h2>${escapeHtml(state.access?.account || state.data.account)}</h2>
        <p>Track assigned machines, requests, work acknowledgement, and Marga service updates in one customer workspace.</p>
      </div>
      <button class="primary-action" type="button" data-view="service">New service request</button>
    </section>
    <section class="metric-row">
      ${metric("Assigned Machines", devices.length)}
      ${metric("Open Requests", openTickets)}
      ${metric("Work Acknowledgement", pendingAck)}
      ${metric("Unpaid Balance", money(unpaid.reduce((sum, invoice) => sum + invoice.amount, 0)))}
    </section>
    <section class="split-grid">
      ${card("Recent Service", timeline(tickets.slice(0, 5), "issue"))}
      ${card("Official Marga Contact", `
        <div class="contact-panel">
          <span>${icon("support")}</span>
          <div>
            <strong>${escapeHtml(state.access?.officialEmail || "service@marga.biz")}</strong>
            <p>Email requests are accepted. Include the machine serial number when the request is machine-related.</p>
          </div>
        </div>
      `)}
    </section>
  `;
}

function metric(label, value) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`;
}

function timeline(items, textKey) {
  return `<div class="timeline">${items.map((item) => `
    <div class="timeline-item">
      <span>${item.updated || item.time || item.date}</span>
      <strong>${item.id || item.title || item.no}</strong>
      <p>${item[textKey] || ""}</p>
      ${item.status ? `<em class="badge ${badgeClass(item.status)}">${item.status}</em>` : ""}
    </div>
  `).join("")}</div>`;
}

function renderService() {
  const devices = scopedDevices();
  const requests = serviceTickets();
  const firstDevice = devices[0];
  const firstTroubleId = 0;
  return `
    ${card("Create Request", `
      <form class="request-form" data-request-form="service">
        <label>Machine <select name="serial" data-machine-select required>${devices.map((device) => `<option value="${escapeHtml(device.serial)}">${escapeHtml(device.serial)} - ${escapeHtml(device.model)} / ${escapeHtml(device.branch)}</option>`).join("")}</select></label>
        <div class="form-pair">
          <label>Trouble <select name="trouble" data-trouble-select required>
            <option value="">Select observed problem...</option>
            ${customerTroubles.map((trouble) => `<option value="${trouble.id}" data-service-label="${escapeHtml(trouble.serviceLabel)}">${escapeHtml(trouble.label)}</option>`).join("")}
          </select></label>
          <label>Error code / message <select name="errorCode" data-error-code-select required>${errorOptionsMarkup(firstDevice, firstTroubleId)}</select></label>
        </div>
        <label class="manual-error-field hidden" data-manual-error-field>Manual error code / message <input name="manualErrorCode" type="text" placeholder="Type the exact error shown on the machine"></label>
        <div class="error-guide hidden" data-error-guide></div>
        <label>Details <textarea name="concern" placeholder="Tell us what happened, when it started, and anything the machine displays. Clear details help us prepare the right parts or tools before dispatch." required></textarea></label>
        <div class="attachment-guide">
          <span>Attachments</span>
          <p>Please upload one clear image if available. Photos help us identify possible parts to bring, reduce repeat visits, and get your unit running sooner.</p>
          <div class="attachment-grid">
            <label>Control Panel <input name="controlPanelImage" type="file" accept="image/*" capture="environment"></label>
            <label>Sample Print <input name="samplePrintImage" type="file" accept="image/*" capture="environment"></label>
            <label>Others <input name="otherAttachment" type="file" accept="image/*,.pdf"></label>
          </div>
        </div>
        <button class="primary-action" type="submit">Submit request</button>
      </form>
    `, "wide")}
    ${card("Open Requests", table(["Request", "Branch", "Issue", "Status", "Updated"], requests.map((ticket) => [
      escapeHtml(ticket.id), escapeHtml(ticket.branch), escapeHtml(ticket.issue), statusBadge(ticket.status), escapeHtml(ticket.updated)
    ])))}
  `;
}

function renderBilling() {
  const invoices = accountInvoices();
  if (!invoices.length) {
    return card("Invoices", emptyState("No billing history is available yet for this beta account."), "wide");
  }
  return card("Invoices", table(["Invoice", "Period", "Amount", "Status", "Due"], invoices.map((invoice) => [
    invoice.no, invoice.period, money(invoice.amount), statusBadge(invoice.status), invoice.due
  ])), "wide");
}

function renderPayments() {
  const payments = accountPayments();
  if (!payments.length) {
    return card("Payment Records", emptyState("No payment records are available yet for this beta account."), "wide");
  }
  return card("Payment Records", table(["OR No.", "Invoice", "Amount", "Date", "Method"], payments.map((payment) => [
    payment.or, payment.invoice, money(payment.amount), payment.date, payment.method
  ])), "wide");
}

function renderUsage() {
  return card("Printer Usage", table(["Serial", "Model", "Branch", "Monthly Usage", "Status"], scopedDevices().map((device) => [
    escapeHtml(device.serial), escapeHtml(device.model), escapeHtml(device.branch), device.usage.toLocaleString(), statusBadge(device.status)
  ])), "wide");
}

function renderToner() {
  const devices = scopedDevices();
  return `
    ${card("Supply Status", table(["Serial", "Model", "Branch", "Toner / Ink"], devices.map((device) => [
      escapeHtml(device.serial), escapeHtml(device.model), escapeHtml(device.branch), statusBadge(device.toner)
    ])), "wide")}
    ${card("Request Toner / Ink", `
      <form class="request-form compact" data-request-form="toner">
        <label>Machine <select name="serial" required>${devices.map((device) => `<option value="${escapeHtml(device.serial)}">${escapeHtml(device.serial)} - ${escapeHtml(device.model)} / ${escapeHtml(device.branch)}</option>`).join("")}</select></label>
        <label>Supply type <select name="category" required><option>Toner / Ink Request</option><option>Low Supply Alert</option><option>Cartridge Issue</option></select></label>
        <label>Notes <textarea name="concern" placeholder="Quantity, cartridge color, or print issue" required></textarea></label>
        <button class="primary-action" type="submit">Submit supply request</button>
      </form>
    `)}
  `;
}

function renderUpdates() {
  const updates = accountUpdates();
  if (!updates.length) {
    return card("Support Timeline", emptyState("No support updates yet. New Marga service activity will appear here."), "wide");
  }
  return card("Support Timeline", timeline(updates, "body"), "wide");
}

function emptyState(message) {
  return `<div class="empty-state"><p>${escapeHtml(message)}</p></div>`;
}

function table(headers, rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function statusBadge(status) {
  return `<span class="badge ${badgeClass(status)}">${escapeHtml(status)}</span>`;
}

function loadAcknowledgementOverrides() {
  try {
    return JSON.parse(localStorage.getItem("marga_care_work_acknowledgements") || "{}");
  } catch (error) {
    return {};
  }
}

function saveAcknowledgementOverride(id, payload) {
  const saved = loadAcknowledgementOverrides();
  saved[id] = { ...saved[id], ...payload };
  localStorage.setItem("marga_care_work_acknowledgements", JSON.stringify(saved));
}

function collectReviewPayload(job, mode = "acknowledged") {
  const scores = {};
  reviewCriteria.forEach((criterion) => {
    scores[criterion.key] = Number(document.querySelector(`[data-review-score="${job.id}:${criterion.key}"]`)?.value || 0);
  });
  const remarks = String(document.querySelector(`[data-ack-remarks="${job.id}"]`)?.value || "").trim();
  const score = average(Object.values(scores));
  const complaintFlag = mode === "concern" || detectComplaint(remarks) || Object.values(scores).some((value) => Number(value || 0) <= 2);
  return {
    scores,
    score,
    scorePercent: Math.round((score / 5) * 100),
    starRating: Math.round(score * 10) / 10,
    ratingLabel: reviewScoreLabel(score),
    remarks,
    complaintFlag,
    reviewStatus: mode === "concern" ? "Concern Reported" : "Acknowledged"
  };
}

async function saveCustomerReview(job, review) {
  const now = new Date();
  const docId = `care_review_${String(job.id || "job").replace(/[^A-Za-z0-9_-]/g, "_")}_${Date.now()}`;
  const payload = {
    id: docId,
    source: "care.marga.biz",
    acknowledgement_id: String(job.id || ""),
    ticket_id: String(job.ticket || ""),
    schedule_id: Number(job.scheduleId || job.schedule_id || 0) || 0,
    account: state.access?.account || state.data.account || "",
    company_id: String(state.access?.companyId || ""),
    serial: String(job.serial || ""),
    branch: String(job.branch || ""),
    machine: String(job.machine || ""),
    technician_name: String(job.technician || ""),
    review_status: review.reviewStatus,
    rating: review.starRating,
    rating_percent: review.scorePercent,
    rating_label: review.ratingLabel,
    complaint_flag: review.complaintFlag,
    remarks: review.remarks,
    professionalism: review.scores.professionalism || 0,
    courtesy: review.scores.courtesy || 0,
    communication: review.scores.communication || 0,
    accuracy: review.scores.accuracy || 0,
    timeliness: review.scores.timeliness || 0,
    confidence: review.scores.confidence || 0,
    review_date: now.toISOString().slice(0, 10),
    reviewed_at: now.toISOString(),
    reviewed_by: state.access?.contactName || "Customer"
  };
  await setFirestoreDocument(CUSTOMER_REVIEW_COLLECTION, docId, payload);
  return payload;
}

function acknowledgementJobs() {
  const saved = loadAcknowledgementOverrides();
  const allowed = new Set(scopedDevices().map((device) => normalizeSerial(device.serial)));
  return state.data.workAcknowledgements
    .filter((job) => allowed.has(normalizeSerial(job.serial)))
    .map((job) => ({ ...job, ...(saved[job.id] || {}) }));
}

function renderAcknowledgement() {
  const jobs = acknowledgementJobs();
  const pending = jobs.filter((job) => String(job.status || "").toLowerCase().includes("awaiting")).length;

  return `
    <section class="ack-summary">
      <article class="panel ack-intro">
        <div>
          <p class="eyebrow">Customer Sign-off</p>
          <h3>Review work details before the field visit is closed.</h3>
          <p>Confirm the technician or messenger presented the work performed, findings, proof, and any noted follow-up items.</p>
        </div>
        <div class="ack-count">
          <span>Pending</span>
          <strong>${pending}</strong>
        </div>
      </article>
    </section>
    <section class="ack-list">
      ${jobs.map(renderAcknowledgementCard).join("")}
    </section>
  `;
}

function renderAcknowledgementCard(job) {
  const isPending = String(job.status || "").toLowerCase().includes("awaiting");
  const isConcern = String(job.status || "").toLowerCase().includes("concern");
  const disabled = !isPending;
  const actionLabel = isConcern ? "Concern Reported" : "Work Acknowledged";

  return `
    <article class="panel work-card">
      <div class="work-card-head">
        <div>
          <p class="eyebrow">${escapeHtml(job.type)}</p>
          <h3>${escapeHtml(job.ticket)} · ${escapeHtml(job.machine)}</h3>
          <p>${escapeHtml(job.branch)}</p>
        </div>
        ${statusBadge(job.status)}
      </div>

      <div class="work-meta">
        <span>${icon("support")} ${escapeHtml(job.technician)}</span>
        <span>${icon("bell")} ${escapeHtml(job.completedAt)}</span>
        <span>${icon("invoice")} ${escapeHtml(job.proof)}</span>
      </div>

      <div class="work-detail-grid">
        <div>
          <span>Work Performed</span>
          <p>${escapeHtml(job.work)}</p>
        </div>
        <div>
          <span>Technician Notes</span>
          <p>${escapeHtml(job.notes)}</p>
        </div>
        <div>
          <span>Parts / Follow-up</span>
          <p>${escapeHtml(job.followUp)}</p>
        </div>
      </div>

      <label class="ack-remarks">
        Customer remarks
        <textarea data-ack-remarks="${escapeHtml(job.id)}" placeholder="Optional: add a note for Marga service staff">${escapeHtml(job.customerRemark || "")}</textarea>
      </label>

      <div class="review-block">
        <div class="review-block-head">
          <div>
            <span>Customer Satisfaction Review</span>
            <strong>Rate 1 poor to 5 excellent</strong>
          </div>
          <em>${escapeHtml(job.ratingLabel || "Not rated yet")}</em>
        </div>
        <div class="review-grid">
          ${reviewCriteria.map((criterion) => {
            const savedScore = Number(job.reviewScores?.[criterion.key] || 0);
            return `
              <label>
                <span>${escapeHtml(criterion.label)}</span>
                <select data-review-score="${escapeHtml(job.id)}:${escapeHtml(criterion.key)}" ${disabled ? "disabled" : ""} required>
                  <option value="">Select</option>
                  ${[5, 4, 3, 2, 1].map((score) => `<option value="${score}" ${savedScore === score ? "selected" : ""}>${score} - ${escapeHtml(reviewScoreLabel(score))}</option>`).join("")}
                </select>
                <small>${escapeHtml(criterion.help)}</small>
              </label>
            `;
          }).join("")}
        </div>
        <p class="review-note">Any complaint or low rating is treated as a service incident for Marga review.</p>
      </div>

      <div class="work-actions">
        <button class="primary-action" type="button" data-ack-id="${escapeHtml(job.id)}" ${disabled ? "disabled" : ""}>
          ${disabled ? actionLabel : "Acknowledge Work"}
        </button>
        <button class="ghost-action inline" type="button" data-concern-id="${escapeHtml(job.id)}" ${disabled ? "disabled" : ""}>
          Report Concern
        </button>
      </div>
    </article>
  `;
}

function renderContent() {
  const renderers = {
    dashboard: renderDashboard,
    service: renderService,
    acknowledgement: renderAcknowledgement,
    billing: renderBilling,
    payments: renderPayments,
    usage: renderUsage,
    toner: renderToner,
    updates: renderUpdates
  };
  $("#content").innerHTML = renderers[state.currentView]();
}

function enterApp() {
  state.authed = true;
  if (!state.access) state.access = pilotAccess[0];
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#accountName").textContent = state.access?.account || state.data.account;
  $("#firebaseStatus").textContent = state.access ? `Serial ${state.access.serial}` : (config.demoMode ? "Demo data" : "Marga Firebase");
  localStorage.setItem("marga_care_session", JSON.stringify(state.access));
  setView("dashboard");
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const serial = normalizeSerial($("#emailInput").value);
    const pin = String($("#passwordInput").value || "").trim();
    const access = pilotAccess.find((entry) => normalizeSerial(entry.serial) === serial && entry.pin === pin);
    if (!access) {
      $("#loginMessage").textContent = "Serial number or PIN was not recognized. Please check the Marga-issued access details.";
      return;
    }
    state.access = access;
    enterApp();
  });
  $("#demoButton").addEventListener("click", () => {
    state.access = pilotAccess[0];
    enterApp();
  });
  $("#logoutButton").addEventListener("click", () => {
    localStorage.removeItem("marga_care_session");
    location.reload();
  });
  $("#refreshButton").addEventListener("click", renderContent);
  $("#menuButton").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
  document.body.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-request-form]");
    if (!form) return;
    event.preventDefault();
    const formData = new FormData(form);
    const serial = formData.get("serial");
    const device = scopedDevices().find((item) => item.serial === serial) || scopedDevices()[0];
    const troubleId = Number(formData.get("trouble") || 0);
    const trouble = customerTroubles.find((item) => item.id === troubleId) || null;
    const selectedError = formData.get("errorCode");
    const manualError = String(formData.get("manualErrorCode") || "").trim();
    const errorCode = selectedError === MANUAL_ERROR_VALUE ? manualError : selectedError;
    const guide = selectedErrorGuide(device, troubleId, errorCode);
    const attachmentSummary = ["controlPanelImage", "samplePrintImage", "otherAttachment"]
      .map((name) => form.querySelector(`[name="${name}"]`)?.files?.[0]?.name)
      .filter(Boolean);
    const request = createPortalRequest({
      type: form.dataset.requestForm === "toner" ? "Toner / Ink" : "Service",
      category: form.dataset.requestForm === "toner" ? formData.get("category") : "Customer Reported Trouble",
      troubleId,
      trouble: trouble?.serviceLabel || formData.get("category"),
      customerTrouble: trouble?.label || "",
      errorCode,
      errorCodeSource: selectedError === MANUAL_ERROR_VALUE ? "Manual" : "Model Error Table",
      errorMeaning: guide?.meaning || "",
      customerRemedy: guide?.remedy || "",
      serial,
      model: device?.model || "",
      branch: device?.branch || "Assigned machine",
      machine: device ? `${device.serial} - ${device.model}` : serial,
      concern: formData.get("concern"),
      notes: formData.get("concern"),
      sentiment: sentimentLabel(formData.get("concern")),
      complaintFlag: detectComplaint(formData.get("concern")),
      attachments: attachmentSummary
    });
    form.reset();
    setView("service");
    $("#sectionTitle").textContent = "Service Requests";
    $("#sectionEyebrow").textContent = "Submitted";
    const notice = document.createElement("div");
    notice.className = "portal-notice";
    notice.textContent = `${request.id} was saved and queued for Marga Service.`;
    $("#content").prepend(notice);
  });
  document.body.addEventListener("change", (event) => {
    const form = event.target.closest("[data-request-form]");
    if (!form) return;

    if (event.target.closest("[data-machine-select], [data-trouble-select]")) {
      refreshErrorOptions(form);
      return;
    }

    const errorSelect = event.target.closest("[data-error-code-select]");
    if (!errorSelect) return;
    const manualField = form.querySelector("[data-manual-error-field]");
    const input = manualField?.querySelector("input");
    const shouldShowManual = errorSelect.value === MANUAL_ERROR_VALUE;
    manualField?.classList.toggle("hidden", !shouldShowManual);
    if (input) {
      input.required = shouldShowManual;
      if (!shouldShowManual) input.value = "";
    }
    renderErrorGuide(form);
  });
  document.body.addEventListener("click", async (event) => {
    const acknowledgeButton = event.target.closest("[data-ack-id]");
    if (acknowledgeButton) {
      const id = acknowledgeButton.dataset.ackId;
      const job = acknowledgementJobs().find((item) => String(item.id) === String(id));
      if (!job) return;
      const review = collectReviewPayload(job, "acknowledged");
      if (Object.values(review.scores).some((value) => !Number(value))) {
        alert("Please complete the 1 to 5 customer satisfaction review before acknowledging.");
        return;
      }
      acknowledgeButton.disabled = true;
      saveAcknowledgementOverride(id, {
        status: "Acknowledged",
        customerRemark: review.remarks,
        reviewScores: review.scores,
        rating: review.starRating,
        ratingLabel: review.ratingLabel,
        complaintFlag: review.complaintFlag,
        acknowledgedAt: new Date().toISOString()
      });
      saveCustomerReview(job, review).catch((error) => {
        console.warn("Customer review sync failed", error);
      });
      renderContent();
      return;
    }

    const concernButton = event.target.closest("[data-concern-id]");
    if (concernButton) {
      const id = concernButton.dataset.concernId;
      const job = acknowledgementJobs().find((item) => String(item.id) === String(id));
      if (!job) return;
      const review = collectReviewPayload(job, "concern");
      if (!review.remarks) {
        alert("Please write the concern in customer remarks so Marga can review it.");
        return;
      }
      concernButton.disabled = true;
      saveAcknowledgementOverride(id, {
        status: "Concern Reported",
        customerRemark: review.remarks || "Customer reported a concern after reviewing the work.",
        reviewScores: review.scores,
        rating: review.starRating,
        ratingLabel: review.ratingLabel,
        complaintFlag: true,
        acknowledgedAt: new Date().toISOString()
      });
      saveCustomerReview(job, { ...review, complaintFlag: true, reviewStatus: "Concern Reported" }).catch((error) => {
        console.warn("Customer concern sync failed", error);
      });
      renderContent();
      return;
    }

    const target = event.target.closest("[data-view]");
    if (!target) return;
    setView(target.dataset.view);
    $(".sidebar").classList.remove("open");
  });
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./service-worker.js");
    } catch (error) {
      console.warn("Service worker registration failed", error);
    }
  }
}

bindEvents();
registerServiceWorker();

try {
  const savedSession = JSON.parse(localStorage.getItem("marga_care_session") || "null");
  if (savedSession?.serial) {
    state.access = savedSession;
    enterApp();
  }
} catch (error) {
  localStorage.removeItem("marga_care_session");
}
