/*
 * MARGA shared company meeting helper
 */
(function () {
    const COLLECTION = 'tbl_field_call_requests';
    const DOMAIN = 'call.wotgonline.com';
    const POLL_MS = 10000;
    const SCRIPT_TIMEOUT_MS = 4500;

    const state = {
        pollTimer: null,
        activeDoc: null,
        activeApi: null,
        activeRoomUrl: '',
        scriptPromise: null
    };

    function localDateYmd() {
        const date = new Date();
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, '0');
        const day = `${date.getDate()}`.padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function cleanRoomName(value, fallback = 'MargaCompanyMeeting') {
        const cleaned = String(value || '').replace(/[^a-zA-Z0-9]+/g, '');
        return cleaned || fallback;
    }

    function companyMeetingId(date = localDateYmd()) {
        return `company_meeting_${String(date).replace(/[^0-9]/g, '')}`;
    }

    function companyRoomName(date = localDateYmd()) {
        return `MargaCompanyMeeting${String(date).replace(/[^0-9]/g, '')}`;
    }

    function currentUser() {
        return window.MargaAuth?.getUser?.() || null;
    }

    function displayName() {
        const user = currentUser();
        return String(user?.name || user?.displayName || user?.username || user?.email || 'MARGA User').trim();
    }

    function userEmail() {
        return String(currentUser()?.email || '').trim();
    }

    function staffId() {
        return Number(currentUser()?.staff_id || 0) || 0;
    }

    function escapeHtml(value) {
        if (window.MargaUtils?.escapeHtml) return window.MargaUtils.escapeHtml(String(value ?? ''));
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function parseFirestoreValue(value) {
        if (!value || typeof value !== 'object') return null;
        if (value.stringValue !== undefined) return value.stringValue;
        if (value.integerValue !== undefined) return Number(value.integerValue);
        if (value.doubleValue !== undefined) return Number(value.doubleValue);
        if (value.booleanValue !== undefined) return value.booleanValue;
        if (value.timestampValue !== undefined) return value.timestampValue;
        if (value.arrayValue !== undefined) return (value.arrayValue.values || []).map(parseFirestoreValue);
        if (value.mapValue !== undefined) {
            const parsed = {};
            Object.entries(value.mapValue.fields || {}).forEach(([key, raw]) => {
                parsed[key] = parseFirestoreValue(raw);
            });
            return parsed;
        }
        return null;
    }

    function parseFirestoreDoc(doc) {
        if (!doc?.fields) return null;
        const parsed = {};
        Object.entries(doc.fields).forEach(([key, raw]) => {
            parsed[key] = parseFirestoreValue(raw);
        });
        if (doc.name) parsed._docId = doc.name.split('/').pop();
        return parsed;
    }

    function toFirestoreFieldValue(value) {
        if (value === null) return { nullValue: null };
        if (typeof value === 'boolean') return { booleanValue: value };
        if (typeof value === 'number' && Number.isFinite(value)) return { integerValue: String(Math.trunc(value)) };
        return { stringValue: String(value ?? '') };
    }

    async function fetchDoc(collection, docId) {
        const config = window.FIREBASE_CONFIG;
        if (!config?.baseUrl || !config?.apiKey) return null;
        const response = await fetch(`${config.baseUrl}/${collection}/${docId}?key=${config.apiKey}`);
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.error) return null;
        return parseFirestoreDoc(payload);
    }

    async function patchDoc(collection, docId, fields) {
        const config = window.FIREBASE_CONFIG;
        if (!config?.baseUrl || !config?.apiKey) throw new Error('MARGA data connection is not ready.');
        const updateKeys = Object.keys(fields || {});
        if (!updateKeys.length) return null;
        const params = updateKeys.map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&');
        const body = { fields: {} };
        updateKeys.forEach((key) => {
            body.fields[key] = toFirestoreFieldValue(fields[key]);
        });
        const response = await fetch(`${config.baseUrl}/${collection}/${docId}?key=${config.apiKey}&${params}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.error) {
            throw new Error(payload?.error?.message || 'Unable to save meeting status.');
        }
        return payload;
    }

    async function setDoc(collection, docId, fields) {
        const config = window.FIREBASE_CONFIG;
        if (!config?.baseUrl || !config?.apiKey) throw new Error('MARGA data connection is not ready.');
        const body = { fields: {} };
        Object.entries(fields || {}).forEach(([key, value]) => {
            body.fields[key] = toFirestoreFieldValue(value);
        });
        const response = await fetch(`${config.baseUrl}/${collection}/${docId}?key=${config.apiKey}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.error) {
            throw new Error(payload?.error?.message || 'Unable to start meeting.');
        }
        return payload;
    }

    function activeCompanyMeeting(doc) {
        if (!doc || String(doc.type || '') !== 'meeting') return false;
        if (String(doc.audience || '') !== 'all') return false;
        if (!['active', 'ringing'].includes(String(doc.status || ''))) return false;
        return true;
    }

    function setStatus(text) {
        document.querySelectorAll('[data-marga-meeting-status]').forEach((el) => {
            el.textContent = text || 'No active company meeting.';
        });
    }

    function setLiveState(isLive) {
        document.querySelectorAll('[data-marga-meeting-live]').forEach((el) => {
            el.hidden = !isLive;
        });
        document.querySelectorAll('[data-marga-meeting-action="join-company"]').forEach((button) => {
            const liveLabel = button.dataset.margaMeetingLiveLabel || 'Join Company Meeting';
            const idleLabel = button.dataset.margaMeetingIdleLabel || 'Start Company Meeting';
            button.textContent = isLive ? liveLabel : idleLabel;
        });
        const launcher = document.getElementById('margaCompanyMeetingLauncher');
        if (launcher) launcher.hidden = isLive;
    }

    function ensureGlobalLauncher() {
        if (document.querySelector('[data-marga-meeting-action="join-company"]')) return;
        if (document.getElementById('margaCompanyMeetingLauncher')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'margaCompanyMeetingLauncher';
        button.className = 'btn btn-secondary btn-sm marga-company-meeting-launcher';
        button.dataset.margaMeetingAction = 'join-company';
        button.dataset.margaMeetingIdleLabel = 'Meeting';
        button.dataset.margaMeetingLiveLabel = 'Join Meeting';
        button.textContent = 'Meeting';
        document.body.appendChild(button);
    }

    function renderBanner(doc) {
        const existing = document.getElementById('margaCompanyMeetingBanner');
        if (!doc) {
            existing?.remove();
            return;
        }
        const startedBy = doc.caller_name || doc.created_by_name || 'MARGA';
        const banner = existing || document.createElement('div');
        banner.id = 'margaCompanyMeetingBanner';
        banner.className = 'marga-company-meeting-banner';
        banner.innerHTML = `
            <div>
                <span>Company meeting is live</span>
                <strong>${escapeHtml(doc.title || 'MARGA Company Meeting')}</strong>
                <p>Started by ${escapeHtml(startedBy)}</p>
            </div>
            <button type="button" class="btn btn-primary btn-sm" data-marga-meeting-action="join-company">Join</button>
        `;
        if (!existing) document.body.appendChild(banner);
        banner.querySelector('[data-marga-meeting-action="join-company"]')?.addEventListener('click', () => {
            void joinCompanyMeeting();
        });
    }

    async function refreshCompanyMeeting() {
        try {
            const doc = await fetchDoc(COLLECTION, companyMeetingId());
            state.activeDoc = activeCompanyMeeting(doc) ? doc : null;
            const live = Boolean(state.activeDoc);
            setLiveState(live);
            setStatus(live ? `Live now: ${state.activeDoc.title || 'MARGA Company Meeting'}` : 'No active company meeting.');
            renderBanner(state.activeDoc);
        } catch (error) {
            console.warn('Company meeting refresh failed:', error);
        }
    }

    function loadJitsiScript(domain = DOMAIN) {
        if (window.JitsiMeetExternalAPI) return Promise.resolve();
        if (state.scriptPromise) return state.scriptPromise;
        const urls = [`https://${domain}/external_api.js`, `https://${domain}/libs/external_api.min.js`];
        state.scriptPromise = new Promise((resolve, reject) => {
            const loadAt = (index) => {
                if (window.JitsiMeetExternalAPI) {
                    resolve();
                    return;
                }
                if (index >= urls.length) {
                    reject(new Error('Unable to load meeting tools.'));
                    return;
                }
                const script = document.createElement('script');
                script.src = urls[index];
                script.async = true;
                const timer = setTimeout(() => {
                    script.remove();
                    loadAt(index + 1);
                }, SCRIPT_TIMEOUT_MS);
                script.onload = () => {
                    clearTimeout(timer);
                    if (window.JitsiMeetExternalAPI) resolve();
                    else {
                        script.remove();
                        loadAt(index + 1);
                    }
                };
                script.onerror = () => {
                    clearTimeout(timer);
                    script.remove();
                    loadAt(index + 1);
                };
                document.head.appendChild(script);
            };
            loadAt(0);
        }).finally(() => {
            state.scriptPromise = null;
        });
        return state.scriptPromise;
    }

    function showMeetingModal(doc) {
        document.getElementById('margaCompanyMeetingModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'margaCompanyMeetingModal';
        modal.className = 'marga-company-meeting-modal';
        modal.innerHTML = `
            <div class="marga-company-meeting-header">
                <div>
                    <h2>${escapeHtml(doc.title || 'MARGA Company Meeting')}</h2>
                    <p>${escapeHtml(doc.room_domain || DOMAIN)} / ${escapeHtml(doc.room_name || '')}</p>
                </div>
                <div class="marga-company-meeting-actions">
                    <button type="button" class="btn btn-secondary btn-sm" id="margaMeetingCopyBtn">Copy Link</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="margaMeetingLeaveBtn">Leave</button>
                </div>
            </div>
            <div class="marga-company-meeting-status" id="margaMeetingStatus">Connecting...</div>
            <div class="marga-company-meeting-frame" id="margaMeetingFrame"></div>
        `;
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        document.getElementById('margaMeetingLeaveBtn')?.addEventListener('click', leaveCompanyMeeting);
        document.getElementById('margaMeetingCopyBtn')?.addEventListener('click', copyCompanyMeetingLink);
    }

    function setModalStatus(text) {
        const el = document.getElementById('margaMeetingStatus');
        if (el) el.textContent = text || '';
    }

    async function ensureMedia() {
        if (!navigator.mediaDevices?.getUserMedia) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: { width: { ideal: 480, max: 720 }, height: { ideal: 480, max: 720 }, facingMode: 'user' }
            });
            stream.getTracks().forEach((track) => track.stop());
        } catch (error) {
            console.warn('Meeting media permission probe failed:', error);
        }
    }

    async function openCompanyMeeting(doc) {
        const domain = String(doc.room_domain || DOMAIN).trim() || DOMAIN;
        const roomName = cleanRoomName(doc.room_name, companyRoomName());
        state.activeRoomUrl = `https://${domain}/${roomName}`;
        try {
            state.activeApi?.dispose?.();
        } catch (_) {}
        state.activeApi = null;
        showMeetingModal({ ...doc, room_domain: domain, room_name: roomName });
        setModalStatus('Requesting camera and microphone permission...');
        await ensureMedia();
        setModalStatus(`Connecting to ${domain}...`);
        await loadJitsiScript(domain);
        if (!window.JitsiMeetExternalAPI) throw new Error('Meeting API is not available.');
        const container = document.getElementById('margaMeetingFrame');
        if (!container) throw new Error('Meeting container is missing.');
        container.innerHTML = '';
        state.activeApi = new JitsiMeetExternalAPI(domain, {
            roomName,
            parentNode: container,
            width: '100%',
            height: '100%',
            userInfo: {
                displayName: displayName(),
                email: userEmail()
            },
            configOverwrite: {
                prejoinPageEnabled: true,
                prejoinConfig: { enabled: true },
                startWithAudioMuted: false,
                startWithVideoMuted: false,
                disableDeepLinking: true,
                disableInviteFunctions: true,
                enableWelcomePage: false,
                enableClosePage: false,
                enableLobby: false,
                fileRecordingsEnabled: false,
                liveStreamingEnabled: false,
                localRecording: { enabled: false },
                resolution: 480,
                p2p: { enabled: true },
                toolbarButtons: ['microphone', 'camera', 'desktop', 'overflowmenu', 'hangup', 'tileview', 'chat']
            },
            interfaceConfigOverwrite: {
                TOOLBAR_BUTTONS: ['microphone', 'camera', 'desktop', 'overflowmenu', 'hangup', 'tileview', 'chat'],
                MAIN_TOOLBAR_BUTTONS: ['microphone', 'camera', 'desktop', 'overflowmenu', 'hangup'],
                SHOW_JITSI_WATERMARK: false,
                SHOW_WATERMARK_FOR_GUESTS: false,
                SHOW_BRAND_WATERMARK: false,
                SHOW_POWERED_BY: false,
                MOBILE_APP_PROMO: false,
                DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
                HIDE_INVITE_MORE_HEADER: true,
                SETTINGS_SECTIONS: ['devices']
            }
        });
        state.activeApi.addListener('videoConferenceJoined', () => {
            setModalStatus('');
            patchDoc(COLLECTION, companyMeetingId(), {
                status: 'active',
                last_joined_by_staff_id: staffId(),
                last_joined_by_name: displayName(),
                last_joined_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }).catch((error) => console.warn('Unable to update meeting join:', error));
        });
        state.activeApi.addListener('videoConferenceLeft', leaveCompanyMeeting);
        state.activeApi.addListener('readyToClose', leaveCompanyMeeting);
        state.activeApi.addListener('errorOccurred', () => setModalStatus('Meeting error. Copy the link or leave and rejoin.'));
        state.activeApi.addListener('connectionFailed', () => setModalStatus('Connection failed. Copy the link or leave and rejoin.'));
    }

    async function joinCompanyMeeting() {
        const date = localDateYmd();
        const docId = companyMeetingId(date);
        const roomName = companyRoomName(date);
        const nowIso = new Date().toISOString();
        const existing = await fetchDoc(COLLECTION, docId);
        const payload = activeCompanyMeeting(existing) ? existing : {
            id: docId,
            type: 'meeting',
            source: 'marga_desktop',
            audience: 'all',
            mode: 'video',
            room_name: roomName,
            room_domain: DOMAIN,
            room_url: `https://${DOMAIN}/${roomName}`,
            title: `MARGA Company Meeting ${date}`,
            status: 'active',
            caller_staff_id: staffId(),
            caller_name: displayName(),
            caller_email: userEmail(),
            created_by_staff_id: staffId(),
            created_by_name: displayName(),
            created_at: nowIso,
            updated_at: nowIso
        };
        if (!activeCompanyMeeting(existing)) {
            await setDoc(COLLECTION, docId, payload);
        }
        state.activeDoc = { ...payload, _docId: docId };
        setLiveState(true);
        setStatus(`Live now: ${payload.title}`);
        renderBanner(state.activeDoc);
        await openCompanyMeeting(state.activeDoc);
    }

    function copyCompanyMeetingLink() {
        if (!state.activeRoomUrl) return;
        navigator.clipboard?.writeText(state.activeRoomUrl)
            .then(() => setModalStatus('Meeting link copied.'))
            .catch(() => {
                window.prompt('Copy meeting link:', state.activeRoomUrl);
            });
    }

    function leaveCompanyMeeting() {
        try {
            state.activeApi?.dispose?.();
        } catch (_) {}
        state.activeApi = null;
        document.getElementById('margaCompanyMeetingModal')?.remove();
        document.body.style.overflow = '';
        patchDoc(COLLECTION, companyMeetingId(), {
            last_left_by_staff_id: staffId(),
            last_left_by_name: displayName(),
            last_left_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }).catch((error) => console.warn('Unable to update meeting leave:', error));
    }

    function bindButtons() {
        document.querySelectorAll('[data-marga-meeting-action="join-company"]').forEach((button) => {
            if (button.dataset.margaMeetingBound === '1') return;
            button.dataset.margaMeetingBound = '1';
            button.addEventListener('click', () => {
                void joinCompanyMeeting().catch((error) => {
                    console.error('Company meeting failed:', error);
                    alert(`Unable to open company meeting: ${error?.message || error}`);
                });
            });
        });
    }

    function init() {
        if (!window.MargaAuth?.getUser?.()) return;
        ensureGlobalLauncher();
        bindButtons();
        void refreshCompanyMeeting();
        if (state.pollTimer) clearInterval(state.pollTimer);
        state.pollTimer = setInterval(refreshCompanyMeeting, POLL_MS);
    }

    window.MargaMeetings = {
        init,
        refreshCompanyMeeting,
        joinCompanyMeeting,
        leaveCompanyMeeting
    };

    document.addEventListener('DOMContentLoaded', init);
}());
