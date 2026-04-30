const config = window.MARGA_CARE_CONFIG || {};

const views = [
  { key: "dashboard", label: "Dashboard", title: "Managed Care Dashboard", eyebrow: "Overview", icon: "grid" },
  { key: "service", label: "Service Requests", title: "Service Requests", eyebrow: "Support", icon: "support" },
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
    { serial: "X9K2108831", model: "Canon IR 2525", branch: "Records Room", usage: 6930, toner: "Watch", status: "Service Due" }
  ],
  tickets: [
    { id: "SR-1042", branch: "Front Desk Head Office", issue: "Paper jam and faint print", status: "In Progress", updated: "Today 3:12 PM" },
    { id: "SR-1037", branch: "Records Room", issue: "Preventive maintenance request", status: "Scheduled", updated: "Yesterday 9:40 AM" }
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
  ]
};

const state = {
  authed: false,
  currentView: "dashboard",
  data: demoData
};

const $ = (selector) => document.querySelector(selector);

function icon(name) {
  const icons = {
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>',
    support: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 16 0v4a3 3 0 0 1-3 3h-2"/><path d="M6 13H4v-2h2zM20 13h-2v-2h2zM9 18h6"/></svg>',
    invoice: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v18l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    payment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v10H4z"/><path d="M4 10h16M7 15h4"/></svg>',
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V5M5 19h14"/><path d="M9 16v-5M13 16V8M17 16v-8"/></svg>',
    drop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.2 6 11a6 6 0 0 1-12 0c0-4.8 6-11 6-11z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17h12l-1.5-2v-4a4.5 4.5 0 0 0-9 0v4z"/><path d="M10 20h4"/></svg>'
  };
  return icons[name] || icons.grid;
}

function money(value) {
  return Number(value || 0).toLocaleString("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
}

function badgeClass(status) {
  const normalized = String(status || "").toLowerCase();
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
  const openTickets = state.data.tickets.filter((ticket) => ticket.status !== "Closed").length;
  const unpaid = state.data.invoices.filter((invoice) => invoice.status !== "Paid");
  const lowToner = state.data.devices.filter((device) => device.toner !== "Good").length;

  return `
    <section class="hero-panel">
      <div>
        <p class="eyebrow">Live Account</p>
        <h2>${state.data.account}</h2>
        <p>Track service, billing, payments, meter usage, and supplies in one customer workspace.</p>
      </div>
      <button class="primary-action" type="button" data-view="service">New service request</button>
    </section>
    <section class="metric-row">
      ${metric("Active Machines", state.data.devices.length)}
      ${metric("Open Requests", openTickets)}
      ${metric("Unpaid Balance", money(unpaid.reduce((sum, invoice) => sum + invoice.amount, 0)))}
      ${metric("Supply Alerts", lowToner)}
    </section>
    <section class="split-grid">
      ${card("Recent Service", timeline(state.data.tickets, "issue"))}
      ${card("Support Updates", timeline(state.data.updates, "body"))}
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
  return `
    ${card("Create Request", `
      <form class="request-form">
        <label>Branch <select><option>Front Desk Head Office</option><option>Billing Office</option><option>Records Room</option></select></label>
        <label>Machine <select>${state.data.devices.map((device) => `<option>${device.serial} - ${device.model}</option>`).join("")}</select></label>
        <label>Concern <textarea placeholder="Describe the issue or request"></textarea></label>
        <button class="primary-action" type="button">Prepare request</button>
      </form>
    `, "wide")}
    ${card("Open Requests", table(["Request", "Branch", "Issue", "Status", "Updated"], state.data.tickets.map((ticket) => [
      ticket.id, ticket.branch, ticket.issue, statusBadge(ticket.status), ticket.updated
    ])))}
  `;
}

function renderBilling() {
  return card("Invoices", table(["Invoice", "Period", "Amount", "Status", "Due"], state.data.invoices.map((invoice) => [
    invoice.no, invoice.period, money(invoice.amount), statusBadge(invoice.status), invoice.due
  ])), "wide");
}

function renderPayments() {
  return card("Payment Records", table(["OR No.", "Invoice", "Amount", "Date", "Method"], state.data.payments.map((payment) => [
    payment.or, payment.invoice, money(payment.amount), payment.date, payment.method
  ])), "wide");
}

function renderUsage() {
  return card("Printer Usage", table(["Serial", "Model", "Branch", "Monthly Usage", "Status"], state.data.devices.map((device) => [
    device.serial, device.model, device.branch, device.usage.toLocaleString(), statusBadge(device.status)
  ])), "wide");
}

function renderToner() {
  return `
    ${card("Supply Status", table(["Serial", "Model", "Branch", "Toner / Ink"], state.data.devices.map((device) => [
      device.serial, device.model, device.branch, statusBadge(device.toner)
    ])), "wide")}
    ${card("Request Toner / Ink", `
      <form class="request-form compact">
        <label>Machine <select>${state.data.devices.map((device) => `<option>${device.serial} - ${device.model}</option>`).join("")}</select></label>
        <label>Notes <textarea placeholder="Quantity, cartridge color, or print issue"></textarea></label>
        <button class="primary-action" type="button">Prepare supply request</button>
      </form>
    `)}
  `;
}

function renderUpdates() {
  return card("Support Timeline", timeline(state.data.updates, "body"), "wide");
}

function table(headers, rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function statusBadge(status) {
  return `<span class="badge ${badgeClass(status)}">${status}</span>`;
}

function renderContent() {
  const renderers = {
    dashboard: renderDashboard,
    service: renderService,
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
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#accountName").textContent = state.data.account;
  $("#firebaseStatus").textContent = config.demoMode ? "Demo data" : "Marga Firebase";
  setView("dashboard");
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    $("#loginMessage").textContent = "Customer authentication will be enabled after Firebase rules are scoped.";
  });
  $("#demoButton").addEventListener("click", enterApp);
  $("#logoutButton").addEventListener("click", () => location.reload());
  $("#refreshButton").addEventListener("click", renderContent);
  $("#menuButton").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
  document.body.addEventListener("click", (event) => {
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
