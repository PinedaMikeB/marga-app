import { DataService } from './lib/data-service.js';
import { getQueue, enqueue, queueSize, removeQueueItem } from './lib/offline-queue.js';
import { hashSignerPin } from './lib/pin-security.js';
import { setupInstallGuide } from './lib/install-guide.js';
import { setupPwa } from './lib/pwa.js';
import { clearSession, loadSession, saveSession } from './lib/session.js';
import { escapeHtml, formatDate, statusClass, toBase64 } from './lib/utils.js';

const service = new DataService();

const state = {
  user: null,
  tickets: [],
  selectedTicketId: null,
  filter: 'assigned',
  signers: []
};

const authView = document.getElementById('techAuthView');
const appView = document.getElementById('techAppView');
const techLoginForm = document.getElementById('techLoginForm');
const techAuthMessage = document.getElementById('techAuthMessage');
const techTicketList = document.getElementById('techTicketList');
const techDetailBody = document.getElementById('techDetailBody');
const techDetailTicketNo = document.getElementById('techDetailTicketNo');
const techFilter = document.getElementById('techFilter');
const techRefresh = document.getElementById('techRefresh');
const completionForm = document.getElementById('ticketCompleteForm');
const ackSignerSelect = document.getElementById('ackSignerId');
const completionMessage = document.getElementById('completionMessage');
const queueBadge = document.getElementById('queueBadge');
const techWelcome = document.getElementById('techWelcome');
const clearSignatureBtn = document.getElementById('clearSignature');
const signaturePad = document.getElementById('signaturePad');
const techInstallBtn = document.getElementById('techInstallBtn');

let isDrawing = false;
let hasSignatureStroke = false;

function setAuthMessage(text, type = 'info') {
  techAuthMessage.textContent = text;
  techAuthMessage.style.color = type === 'error' ? '#b91c1c' : '#335d86';
}

function setCompletionMessage(text, type = 'info') {
  completionMessage.textContent = text;
  completionMessage.style.color = type === 'error' ? '#b91c1c' : type === 'success' ? '#065f46' : '#335d86';
}

function activeTicket() {
  return state.tickets.find((ticket) => ticket.id === state.selectedTicketId) || null;
}

function updateQueueBadge() {
  queueBadge.textContent = `Pending Sync: ${queueSize()}`;
}

function renderTicketList() {
  if (!state.tickets.length) {
    techTicketList.innerHTML = '<div class="empty-state">No tickets for this filter.</div>';
    return;
  }

  techTicketList.innerHTML = state.tickets
    .map(
      (ticket) => `<article class="ticket-card ${ticket.id === state.selectedTicketId ? 'active' : ''}" data-ticket-id="${ticket.id}">
      <h4>${escapeHtml(ticket.ticketNo || ticket.id)}</h4>
      <div class="ticket-meta">
        <span class="tag ${statusClass(ticket.status)}">${escapeHtml(ticket.status || '-')}</span>
        <span class="tag">${escapeHtml(ticket.priority || 'Normal')}</span>
      </div>
      <p class="muted">${escapeHtml(ticket.category || '')} · ${formatDate(ticket.updatedAt || ticket.createdAt)}</p>
      <p class="muted">${escapeHtml(ticket.description || '')}</p>
    </article>`
    )
    .join('');

  techTicketList.querySelectorAll('[data-ticket-id]').forEach((card) => {
    card.addEventListener('click', async () => {
      state.selectedTicketId = card.getAttribute('data-ticket-id');
      renderTicketList();
      await renderTicketDetail();
    });
  });
}

async function loadSignersForTicket(ticket) {
  if (!ticket) {
    state.signers = [];
    ackSignerSelect.innerHTML = '<option value="">Select ticket first</option>';
    return;
  }

  try {
    state.signers = await service.listAuthorizedSigners(state.user, {
      branchId: ticket.branchId,
      companyId: ticket.companyId
    });
    ackSignerSelect.innerHTML = state.signers.length
      ? `<option value="">Select signer</option>${state.signers
          .map((signer) => `<option value="${signer.id}">${escapeHtml(signer.name)} (${escapeHtml(signer.email || signer.phone || '')})</option>`)
          .join('')}`
      : '<option value="">No active signers</option>';
  } catch (error) {
    ackSignerSelect.innerHTML = '<option value="">Unable to load signers</option>';
  }
}

// ── Field-staff status actions + live GPS ping (spec §16, §24, §30) ──────────
// Buttons are derived from the ticket's route_status so a tech can only move a
// job to a valid next state — the server enforces this too via updateTicketStatus.
const STATUS_ACTION_NOTES = {
  included_in_route: 'Your request has been included in today\u2019s service route.',
  next_destination: 'You are now the next destination for your assigned field staff.',
  arrived: '',
  in_progress: 'Service has started.',
  waiting_customer: 'Our technician is waiting for access to the machine or service area.',
  waiting_parts: 'A required part is being prepared. We will notify you when the follow-up visit is scheduled.',
  for_follow_up: 'A follow-up visit is being scheduled.',
  completed: 'Your service request has been completed.'
};

function techStatusActionButtons(ticket) {
  if (!ticket.assignedStaffName) {
    return `<button class="btn btn-secondary btn-sm" data-status-action="assign">Assign to Me</button>`;
  }
  const routeStatus = ticket.customerStatus?.routeStatus || 'submitted';
  const nextActions = {
    assigned: [['included_in_route', 'Include in Today\u2019s Route'], ['next_destination', 'Set as Next Destination']],
    queued: [['included_in_route', 'Include in Today\u2019s Route'], ['next_destination', 'Set as Next Destination']],
    included_in_route: [['next_destination', 'Set as Next Destination']],
    next_destination: [['on_the_way', 'Start Travel (On the Way)']],
    on_the_way: [['arrived', 'Arrived']],
    arrived: [['in_progress', 'Start Service']],
    in_progress: [['waiting_customer', 'Waiting for Customer'], ['waiting_parts', 'Waiting for Parts'], ['completed', 'Mark Completed']],
    waiting_customer: [['in_progress', 'Resume Service']],
    waiting_parts: [['for_follow_up', 'Schedule Follow-up'], ['in_progress', 'Resume Service']],
    for_follow_up: [['on_the_way', 'Reopen \u2014 On the Way']]
  };
  const actions = nextActions[routeStatus] || [];
  const buttonsHtml = actions
    .map(([action, label]) => `<button class="btn btn-secondary btn-sm" data-status-action="${action}">${escapeHtml(label)}</button>`)
    .join('');
  const cancelHtml = !['completed', 'cancelled'].includes(routeStatus)
    ? `<button class="btn btn-secondary btn-sm" data-status-action="cancel">Cancel Ticket</button>`
    : '';
  return buttonsHtml + cancelHtml || '<p class="muted">No further actions for this status.</p>';
}

let locationPingTimer = null;

function stopLocationPing() {
  if (locationPingTimer) {
    clearInterval(locationPingTimer);
    locationPingTimer = null;
  }
}

function startLocationPing(ticketId) {
  stopLocationPing();
  if (!navigator.geolocation) return;
  const ping = () => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await service.pingTicketLocation(state.user, ticketId, {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude
          });
        } catch (error) {
          // Server auto-disables tracking once the ticket leaves on_the_way (spec §30);
          // stop pinging quietly rather than surfacing an error toast every 20s.
          stopLocationPing();
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }
    );
  };
  ping();
  locationPingTimer = setInterval(ping, 20000);
}

async function renderTicketDetail() {
  const ticket = activeTicket();
  if (!ticket) {
    techDetailTicketNo.textContent = 'Select a ticket';
    techDetailBody.className = 'detail-body empty-state';
    techDetailBody.textContent = 'Choose a ticket to view details.';
    stopLocationPing();
    await loadSignersForTicket(null);
    return;
  }

  techDetailTicketNo.textContent = ticket.ticketNo || ticket.id;

  const device = ticket.deviceId ? await service.getDeviceById(ticket.deviceId) : null;
  const attachments = Array.isArray(ticket.attachments) ? ticket.attachments : [];
  const workNotes = Array.isArray(ticket.workNotes) ? ticket.workNotes : [];

  techDetailBody.className = 'detail-body';
  techDetailBody.innerHTML = `
    <article class="detail-row">
      <h4>Issue Summary</h4>
      <p>${escapeHtml(ticket.description || 'No details')}</p>
      <p><strong>Category:</strong> ${escapeHtml(ticket.category || '-')} · <strong>Priority:</strong> ${escapeHtml(ticket.priority || '-')}</p>
    </article>

    <article class="detail-row">
      <h4>Device</h4>
      <p>${device ? `${escapeHtml(device.model)} (${escapeHtml(device.serial)})` : 'No device linked'}</p>
      <p>${device ? escapeHtml(device.location || '-') : ''}</p>
    </article>

    <article class="detail-row">
      <h4>Status Actions</h4>
      <div class="panel-actions" id="statusActionButtons">${techStatusActionButtons(ticket)}</div>
      <form id="workNoteForm" class="form-grid" style="margin-top:.6rem;">
        <label class="full">Work Note<textarea name="workNote" rows="2" required placeholder="Add diagnostics or actions taken"></textarea></label>
        <button class="btn btn-primary full" type="submit">Save Work Note</button>
      </form>
    </article>

    <article class="detail-row">
      <h4>Attachments</h4>
      ${
        attachments.length
          ? attachments
              .map((url) => `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener">Open attachment</a></p>`)
              .join('')
          : '<p>No attachments</p>'
      }
    </article>

    <article class="detail-row">
      <h4>Work Notes</h4>
      ${
        workNotes.length
          ? workNotes.map((note) => `<p>• ${escapeHtml(note)}</p>`).join('')
          : '<p>No notes yet.</p>'
      }
    </article>
  `;

  document.getElementById('statusActionButtons')?.querySelectorAll('[data-status-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-status-action');
      btn.disabled = true;
      try {
        if (action === 'assign') {
          await service.assignTicketToMe(state.user, ticket.id);
          setCompletionMessage('Ticket assigned to you.', 'success');
        } else if (action === 'cancel') {
          const reason = window.prompt('Reason for cancelling this ticket?') || '';
          await service.updateTicketStatus(state.user, ticket.id, {
            routeStatus: 'cancelled', cancelReason: reason, internalNote: 'Cancelled by field staff'
          });
          setCompletionMessage('Ticket cancelled.', 'success');
        } else if (action === 'on_the_way') {
          // Capture GPS as part of the tap so the browser permission prompt is tied
          // to a real user gesture; fall back to no coords if permission is denied.
          const coords = await new Promise((resolve) => {
            if (!navigator.geolocation) return resolve(null);
            navigator.geolocation.getCurrentPosition(
              (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
              () => resolve(null),
              { enableHighAccuracy: true, timeout: 8000 }
            );
          });
          await service.updateTicketStatus(state.user, ticket.id, {
            routeStatus: 'on_the_way',
            customerVisibleNote: 'Your assigned field staff is now on the way.'
          });
          if (coords) await service.pingTicketLocation(state.user, ticket.id, coords).catch(() => {});
          setCompletionMessage('Status updated: On the Way. Live location sharing started.', 'success');
        } else {
          await service.updateTicketStatus(state.user, ticket.id, {
            routeStatus: action,
            customerVisibleNote: STATUS_ACTION_NOTES[action] || ''
          });
          setCompletionMessage('Status updated.', 'success');
        }
        await refreshTickets();
      } catch (error) {
        setCompletionMessage(error.message || 'Action failed.', 'error');
        btn.disabled = false;
      }
    });
  });

  document.getElementById('workNoteForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const note = new FormData(event.currentTarget).get('workNote');
    try {
      await service.addTechWorkNote(state.user, ticket.id, String(note));
      await refreshTickets();
      setCompletionMessage('Work note saved.', 'success');
    } catch (error) {
      setCompletionMessage(error.message || 'Unable to save note.', 'error');
    }
  });

  if (ticket.customerStatus?.routeStatus === 'on_the_way') {
    startLocationPing(ticket.id);
  } else {
    stopLocationPing();
  }

  await loadSignersForTicket(ticket);
}

async function refreshTickets() {
  state.tickets = await service.listTickets(state.user, { mode: state.filter });
  if (!state.selectedTicketId && state.tickets.length) {
    state.selectedTicketId = state.tickets[0].id;
  }
  if (state.selectedTicketId && !state.tickets.some((ticket) => ticket.id === state.selectedTicketId)) {
    state.selectedTicketId = state.tickets[0]?.id || null;
  }
  renderTicketList();
  await renderTicketDetail();
}

function clearSignaturePad() {
  const ctx = signaturePad.getContext('2d');
  ctx.clearRect(0, 0, signaturePad.width, signaturePad.height);
  hasSignatureStroke = false;
}

function setupSignaturePad() {
  const ctx = signaturePad.getContext('2d');
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#123b67';

  const getPosition = (event) => {
    const rect = signaturePad.getBoundingClientRect();
    const touch = event.touches?.[0];
    const clientX = touch ? touch.clientX : event.clientX;
    const clientY = touch ? touch.clientY : event.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * signaturePad.width,
      y: ((clientY - rect.top) / rect.height) * signaturePad.height
    };
  };

  const start = (event) => {
    isDrawing = true;
    const { x, y } = getPosition(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    hasSignatureStroke = true;
  };

  const draw = (event) => {
    if (!isDrawing) return;
    event.preventDefault();
    const { x, y } = getPosition(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    isDrawing = false;
    ctx.closePath();
  };

  signaturePad.addEventListener('mousedown', start);
  signaturePad.addEventListener('mousemove', draw);
  window.addEventListener('mouseup', end);
  signaturePad.addEventListener('touchstart', start, { passive: false });
  signaturePad.addEventListener('touchmove', draw, { passive: false });
  signaturePad.addEventListener('touchend', end);
}

async function queueCompletionOffline({ ticket, signerId, pinHash, formData, signatureDataUrl, photoDataUrl }) {
  enqueue({
    type: 'complete_ticket',
    ticketId: ticket.id,
    signerId,
    pinHash,
    resolutionNotes: String(formData.get('resolutionNotes') || ''),
    followUpNeeded: formData.get('status') === 'Follow Up',
    followUpNotes: String(formData.get('followUpNotes') || ''),
    signatureDataUrl,
    photoDataUrl,
    workNote: `Completed offline by ${state.user.name} on ${new Date().toLocaleString()}`
  });

  updateQueueBadge();
  setCompletionMessage('Offline completion queued. It will sync when online.', 'success');

  try {
    await service.updateTicket(state.user, ticket.id, {
      status: 'Pending Sync',
      assignedTechId: state.user.id,
      workNote: `Completion queued offline at ${new Date().toISOString()}`
    });
  } catch (error) {
    console.warn('Local pending status failed', error);
  }

  await refreshTickets();
}

async function trySyncQueue() {
  if (!navigator.onLine) return;
  const queue = getQueue();
  if (!queue.length) {
    updateQueueBadge();
    return;
  }

  for (const item of queue) {
    try {
      if (item.type === 'complete_ticket') {
        await service.syncQueuedCompletion(state.user, item);
      }
      removeQueueItem(item.id);
    } catch (error) {
      console.warn('Queue sync item failed', item.id, error);
    }
  }

  updateQueueBadge();
  await refreshTickets();
}

async function handleCompletionSubmit(event) {
  event.preventDefault();
  const ticket = activeTicket();
  if (!ticket) {
    setCompletionMessage('Select a ticket first.', 'error');
    return;
  }

  const formData = new FormData(completionForm);
  const signerId = String(formData.get('ackSignerId') || '');
  const pin = String(formData.get('ackPin') || '');

  if (!signerId) {
    setCompletionMessage('Select an acknowledging signer.', 'error');
    return;
  }

  let signatureDataUrl = '';
  if (hasSignatureStroke) {
    signatureDataUrl = signaturePad.toDataURL('image/png');
  }

  const photoFile = formData.get('ackPhoto');
  const hasPhotoFile = photoFile && photoFile.size > 0;

  try {
    const pinHash = await hashSignerPin(signerId, pin);

    if (!navigator.onLine) {
      const signer = await service.canQueueCompletionOffline({ signerId, pinHash, ticket });
      if (!signer) throw new Error('Unable to validate signer while offline.');

      const photoDataUrl = hasPhotoFile ? await toBase64(photoFile) : '';
      await queueCompletionOffline({ ticket, signerId, pinHash, formData, signatureDataUrl, photoDataUrl });
      completionForm.reset();
      clearSignaturePad();
      return;
    }

    const verification = await service.verifySignerPin({
      signerId,
      enteredPin: pin,
      techUser: state.user,
      ticket
    });

    await service.completeTicket({
      techUser: state.user,
      ticket,
      signer: verification.signer,
      pinHash: verification.pinHash,
      resolutionNotes: String(formData.get('resolutionNotes') || ''),
      followUpNeeded: formData.get('status') === 'Follow Up',
      followUpNotes: String(formData.get('followUpNotes') || ''),
      signatureDataUrl,
      photoFile: hasPhotoFile ? photoFile : null,
      workNote: `Completed onsite by ${state.user.name} at ${new Date().toLocaleString()}`
    });

    setCompletionMessage('Ticket completion saved successfully.', 'success');
    completionForm.reset();
    clearSignaturePad();
    await refreshTickets();
  } catch (error) {
    setCompletionMessage(error.message || 'Completion failed.', 'error');
  }
}

async function showApp(user) {
  state.user = user;
  saveSession(user);

  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  techWelcome.textContent = `${user.name} · ${service.usingDemo ? 'Demo Mode' : 'Live Mode'}`;

  updateQueueBadge();
  await refreshTickets();
  await trySyncQueue();
}

async function restoreSession() {
  const session = loadSession();
  if (!session || session.role !== 'tech') return false;
  const profile = await service.getUserById(session.id || session.uid);
  if (!profile || profile.role !== 'tech') {
    clearSession();
    return false;
  }
  await showApp(profile);
  return true;
}

function bindEvents() {
  techLoginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(techLoginForm);
    try {
      const user = await service.login(formData.get('email'), formData.get('password'), { techOnly: true });
      await showApp(user);
    } catch (error) {
      setAuthMessage(error.message || 'Login failed.', 'error');
    }
  });

  techFilter.addEventListener('change', async () => {
    state.filter = techFilter.value;
    await refreshTickets();
  });

  techRefresh.addEventListener('click', async () => {
    await refreshTickets();
    await trySyncQueue();
  });

  completionForm.addEventListener('submit', handleCompletionSubmit);

  clearSignatureBtn.addEventListener('click', clearSignaturePad);

  document.getElementById('techLogoutBtn').addEventListener('click', async () => {
    await service.logout();
    clearSession();
    location.href = '/tech/';
  });

  window.addEventListener('online', trySyncQueue);
}

async function init() {
  await service.init();

  setupInstallGuide({
    appName: 'MARGA Technician Service Schedule',
    tagline: 'View your service schedule, complete tickets, and sync in the field.',
    appIcon: '/public/assets/icons/tech-icon-192.svg',
    storagePrefix: 'msp-tech',
    installHelpUrl: '/install/?target=tech'
  });

  setupPwa({
    installButton: techInstallBtn,
    onConnectivityChange: (isOnline) => {
      queueBadge.className = `status-badge ${isOnline ? 'neutral' : 'warn'}`;
      updateQueueBadge();
    }
  });

  bindEvents();
  setupSignaturePad();
  updateQueueBadge();

  if (service.usingDemo) {
    setAuthMessage('Demo mode active. Use tech@marga-demo.com / demo1234.');
  }

  const restored = await restoreSession();
  if (!restored) {
    authView.classList.remove('hidden');
    appView.classList.add('hidden');
  }
}

init().catch((error) => {
  console.error(error);
  setAuthMessage(`Startup error: ${error.message}`, 'error');
});
