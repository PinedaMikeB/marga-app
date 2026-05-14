(function () {
    const WEBSITE_INQUIRIES_API = 'https://marga.biz/.netlify/functions/website-inquiries';
    const SETTINGS_COLLECTION = 'ai_product_consultant_settings';
    const SETTINGS_DOC_ID = 'default';
    const SETTINGS_STORAGE_KEY = 'marga_ai_product_consultant_settings_v1';
    const VOICE_OPTIONS = [
        { id: 'marin', label: 'Marin - balanced', description: 'Natural, clear sales-consultant voice.', previewPitch: 1, previewRate: 0.86, hints: ['samantha', 'google us english'] },
        { id: 'cedar', label: 'Cedar - male-leaning', description: 'Warm, steady, and professional with a lower tone.', previewPitch: 0.78, previewRate: 0.84, hints: ['daniel', 'alex', 'fred', 'google uk english male', 'microsoft david'] },
        { id: 'ash', label: 'Ash - male-leaning', description: 'Even, confident, and businesslike.', previewPitch: 0.82, previewRate: 0.84, hints: ['alex', 'daniel', 'google uk english male', 'microsoft david'] },
        { id: 'echo', label: 'Echo - male-leaning', description: 'Clear, familiar, and slightly deeper.', previewPitch: 0.8, previewRate: 0.86, hints: ['fred', 'alex', 'daniel', 'microsoft mark'] },
        { id: 'sage', label: 'Sage - calm neutral', description: 'Calm, composed, and advisory.', previewPitch: 0.92, previewRate: 0.82, hints: ['daniel', 'alex', 'google us english'] },
        { id: 'alloy', label: 'Alloy - neutral', description: 'Balanced, neutral, and direct.', previewPitch: 0.96, previewRate: 0.86, hints: ['google us english', 'samantha', 'alex'] },
        { id: 'coral', label: 'Coral - warm bright', description: 'Friendly and bright for warmer conversations.', previewPitch: 1.08, previewRate: 0.88, hints: ['samantha', 'victoria', 'google us english'] },
        { id: 'shimmer', label: 'Shimmer - soft bright', description: 'Soft, approachable, and gentle.', previewPitch: 1.12, previewRate: 0.88, hints: ['samantha', 'victoria', 'karen'] },
        { id: 'ballad', label: 'Ballad - expressive', description: 'Expressive and smooth.', previewPitch: 1.02, previewRate: 0.86, hints: ['samantha', 'google us english'] },
        { id: 'verse', label: 'Verse - energetic', description: 'Conversational and energetic.', previewPitch: 1, previewRate: 0.9, hints: ['google us english', 'samantha'] }
    ];
    const DEFAULT_SETTINGS = {
        language: 'taglish',
        voice: 'marin',
        realtimeModel: 'gpt-realtime',
        transcriptionModel: 'gpt-4o-mini-transcribe',
        greeting: 'Greet the customer warmly. In Taglish, say: "Hi, kumusta po? I’m Marga’s Product Consultant. How can I help po, are you planning to rent a copier or printer?" Do not ask why they need a quotation yet.',
        prompt: [
            'Tone: warm, calm, helpful, empathetic, reassuring, interested, and not robotic.',
            'Pacing: slower, with short natural pauses.',
            'Sentence length: short spoken sentences, not long paragraphs.',
            'Conversation style: listen first, confirm what the prospect said, then answer.',
            'Sales behavior: helpful consultant, not pushy salesperson.',
            'Opening flow: greet warmly, ask how they are doing, then ask how you can help or whether they are planning to rent a copier or printer.',
            'Do not open by asking if they have a problem or why they want a quotation.',
            'After rental interest is confirmed, ask monthly pages, number of users, location, black-only or color, A4/legal or A3, scan/copy needs, and target start date.',
            'After the practical basics, ask whether they already have a rental or purchased machine and what brand/model it is.',
            'If they name an existing machine, acknowledge it positively, then ask why they are considering another supplier or another rental option.',
            'Only explore pain after context is clear. If they mention bad service, toner delays, downtime, billing, or lower-rate needs, validate it naturally.',
            'If volume is very low, warn honestly that rental may be expensive and buying a small printer may be better.',
            'Official quotation must be approved by Mike before sending to the prospect.'
        ].join('\n')
    };
    const state = {
        leads: [],
        selectedId: '',
        filter: 'all',
        language: 'all',
        service: 'all',
        query: '',
        activeTab: 'home',
        settings: { ...DEFAULT_SETTINGS },
        initialized: false,
        knownLeadIds: new Set()
    };

    const els = {};

    function byId(id) {
        return document.getElementById(id);
    }

    function clean(value) {
        return String(value || '').trim();
    }

    function escapeHtml(value) {
        return MargaUtils.escapeHtml(clean(value));
    }

    function formatLabel(value) {
        return clean(value)
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'N/A';
    }

    function formatDateTime(value) {
        if (!value) return 'N/A';
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return 'N/A';
        return date.toLocaleString('en-PH', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function formatDuration(seconds) {
        const total = Math.max(0, Math.round(Number(seconds || 0)));
        if (!total) return 'N/A';
        const mins = Math.floor(total / 60);
        const secs = total % 60;
        if (!mins) return `${secs}s`;
        return `${mins}m ${String(secs).padStart(2, '0')}s`;
    }

    function formatUsd(value) {
        const amount = Number(value || 0);
        if (!amount) return '$0.0000';
        return `$${amount.toFixed(amount < 0.01 ? 4 : 2)}`;
    }

    function formatPhp(value) {
        const amount = Number(value || 0);
        if (!amount) return 'PHP 0.00';
        return `PHP ${amount.toFixed(2)}`;
    }

    function firestoreValue(value) {
        if (value === null || value === undefined) return { nullValue: null };
        if (value instanceof Date) return { timestampValue: value.toISOString() };
        if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
        if (typeof value === 'boolean') return { booleanValue: value };
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
        }
        if (typeof value === 'object') {
            const fields = {};
            Object.entries(value).forEach(([key, child]) => {
                fields[key] = firestoreValue(child);
            });
            return { mapValue: { fields } };
        }
        return { stringValue: String(value) };
    }

    function firestoreFields(fields) {
        const mapped = {};
        Object.entries(fields || {}).forEach(([key, value]) => {
            mapped[key] = firestoreValue(value);
        });
        return mapped;
    }

    function relativeTime(value) {
        if (!value) return 'N/A';
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return 'N/A';
        const diffMs = Date.now() - date.getTime();
        const mins = Math.max(1, Math.round(diffMs / 60000));
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.round(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.round(hours / 24)}d ago`;
    }

    async function fetchWebsiteInquiries() {
        const response = await fetch(`${WEBSITE_INQUIRIES_API}?limit=160`);
        if (!response.ok) throw new Error(`Website inquiries API failed: HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload.success) throw new Error(payload.error || 'Unable to load website inquiries');
        return Array.isArray(payload.leads) ? payload.leads : [];
    }

    async function updateLead(docId, updates) {
        const response = await fetch(WEBSITE_INQUIRIES_API, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadId: docId, updates })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) throw new Error(payload.error || `Lead update failed: HTTP ${response.status}`);
    }

    async function fetchSettings() {
        const cached = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (cached) {
            try {
                state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(cached) };
            } catch (error) {
                state.settings = { ...DEFAULT_SETTINGS };
            }
        }

        try {
            const doc = await MargaUtils.fetchDoc(SETTINGS_COLLECTION, SETTINGS_DOC_ID);
            if (doc) {
                state.settings = {
                    ...DEFAULT_SETTINGS,
                    ...doc,
                    language: clean(doc.language || DEFAULT_SETTINGS.language),
                    voice: clean(doc.voice || DEFAULT_SETTINGS.voice)
                };
                localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
            }
        } catch (error) {
            console.warn('Using local AI consultant settings fallback.', error);
        }
    }

    async function saveSettings(nextSettings) {
        const settings = {
            ...DEFAULT_SETTINGS,
            ...nextSettings,
            updatedAt: new Date().toISOString(),
            updatedBy: MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'admin'
        };
        state.settings = settings;
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));

        const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${SETTINGS_COLLECTION}/${SETTINGS_DOC_ID}?key=${FIREBASE_CONFIG.apiKey}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: firestoreFields(settings) })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.error) {
            throw new Error(payload?.error?.message || `Settings save failed: HTTP ${response.status}`);
        }
        return settings;
    }

    async function loadLeads() {
        els.status.textContent = 'Loading';
        const rows = await fetchWebsiteInquiries();
        const previousIds = state.knownLeadIds;
        const nextIds = new Set(rows.map((lead) => lead._docId).filter(Boolean));
        const freshLeads = state.initialized
            ? rows.filter((lead) => lead._docId && !previousIds.has(lead._docId))
            : [];

        state.leads = rows;
        state.knownLeadIds = nextIds;
        state.initialized = true;

        if (!state.selectedId && rows.length) state.selectedId = rows[0]._docId;
        hydrateServiceFilter();
        render();
        els.status.textContent = `${rows.length} leads`;

        if (freshLeads.length) {
            const lead = freshLeads[0];
            MargaUtils.showToast(`New website inquiry: ${lead.fullName || lead.company || 'New lead'}`, 'info', 6000);
        }
    }

    function hydrateServiceFilter() {
        const services = [...new Set(state.leads.map((lead) => clean(lead.service)).filter(Boolean))].sort();
        const current = els.serviceFilter.value || 'all';
        els.serviceFilter.innerHTML = '<option value="all">All services</option>' + services
            .map((service) => `<option value="${escapeHtml(service)}">${escapeHtml(service)}</option>`)
            .join('');
        els.serviceFilter.value = services.includes(current) ? current : 'all';
        state.service = els.serviceFilter.value;
    }

    function statusChipClass(lead) {
        const callStatus = clean(lead.aiCallStatus);
        if (callStatus === 'pending_call') return 'red';
        if (callStatus === 'waiting_for_call_consent') return 'amber';
        if (['called', 'qualified', 'completed', 'browser_voice_connected'].includes(callStatus)) return 'green';
        return 'blue';
    }

    function filteredLeads() {
        const query = state.query.toLowerCase();
        return state.leads.filter((lead) => {
            const callStatus = clean(lead.aiCallStatus);
            const consultantStatus = clean(lead.aiConsultantStatus);
            const filterMatch = state.filter === 'all'
                || callStatus === state.filter
                || consultantStatus === state.filter
                || clean(lead.leadStatus) === state.filter;
            const languageMatch = state.language === 'all' || clean(lead.languageMode) === state.language;
            const serviceMatch = state.service === 'all' || clean(lead.service) === state.service;
            const haystack = [
                lead.fullName,
                lead.company,
                lead.phone,
                lead.email,
                lead.service,
                lead.message
            ].join(' ').toLowerCase();
            return filterMatch && languageMatch && serviceMatch && (!query || haystack.includes(query));
        });
    }

    function updateStats() {
        const all = state.leads.length;
        const pendingCall = state.leads.filter((lead) => ['pending_call', 'browser_voice_requested', 'browser_voice_connected'].includes(lead.aiCallStatus)).length;
        const newCount = state.leads.filter((lead) => lead.aiConsultantStatus === 'new_inquiry').length;
        const human = state.leads.filter((lead) => lead.leadStatus === 'needs_human' || lead.aiConsultantStatus === 'needs_human').length;
        const noConsent = state.leads.filter((lead) => lead.aiCallStatus === 'waiting_for_call_consent').length;
        byId('statAll').textContent = all;
        byId('statPendingCall').textContent = pendingCall;
        byId('statNew').textContent = newCount;
        byId('statHuman').textContent = human;
        byId('statConsent').textContent = noConsent;
        const languageDefault = byId('languageDefault');
        if (languageDefault) languageDefault.textContent = state.settings.language === 'english' ? 'English' : 'Taglish';
    }

    function renderTabs() {
        document.querySelectorAll('.consultant-tab').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.tab === state.activeTab);
        });
        document.querySelectorAll('.tab-panel').forEach((panel) => {
            panel.classList.toggle('active', panel.id === `tab-${state.activeTab}`);
        });
    }

    function renderList() {
        const rows = filteredLeads();
        if (!rows.length) {
            els.list.innerHTML = '<div class="empty-state">No website inquiries match this view.</div>';
            return;
        }

        els.list.innerHTML = rows.map((lead) => {
            const active = lead._docId === state.selectedId ? ' active' : '';
            const callStatus = formatLabel(lead.aiCallStatus);
            const language = clean(lead.languageMode) === 'english' ? 'English' : 'Taglish';
            return `
                <button class="lead-card${active}" data-lead-id="${escapeHtml(lead._docId)}">
                    <div class="lead-card-top">
                        <div>
                            <div class="lead-name">${escapeHtml(lead.fullName || 'Unnamed Lead')}</div>
                            <div class="lead-company">${escapeHtml(lead.company || 'No company')} - ${escapeHtml(lead.service || 'No service')}</div>
                        </div>
                        <div class="lead-time">${escapeHtml(relativeTime(lead.createdAt))}</div>
                    </div>
                    <div class="lead-meta">
                        <span class="chip ${statusChipClass(lead)}">${escapeHtml(callStatus)}</span>
                        <span class="chip">${escapeHtml(language)}</span>
                        <span class="chip ${lead.callConsent ? 'green' : 'amber'}">${lead.callConsent ? 'Call consent' : 'No consent'}</span>
                    </div>
                </button>
            `;
        }).join('');

        els.list.querySelectorAll('.lead-card').forEach((card) => {
            card.addEventListener('click', () => {
                state.selectedId = card.dataset.leadId;
                render();
            });
        });
    }

    function renderDetail() {
        const lead = state.leads.find((entry) => entry._docId === state.selectedId);
        if (!lead) {
            els.detail.innerHTML = `
                <div class="empty-detail">
                    <strong>Select a lead</strong>
                    <span>View inquiry details, call readiness, and next action.</span>
                </div>
            `;
            return;
        }

        const phoneHref = clean(lead.phone).startsWith('+') ? lead.phone : lead.rawPhone || lead.phone;
        const transcript = Array.isArray(lead.transcript) ? lead.transcript : [];
        const usage = lead.usage && typeof lead.usage === 'object' ? lead.usage : {};
        const realtimeModel = clean(lead.realtimeModel || usage.realtimeModel || 'gpt-realtime');
        const transcriptionModel = clean(lead.transcriptionModel || usage.transcriptionModel || 'gpt-4o-mini-transcribe');
        const estimatedUsd = Number(lead.estimatedCostUsd || usage.estimatedCostUsd || 0);
        const estimatedPhp = Number(lead.estimatedCostPhp || usage.estimatedCostPhp || 0);
        els.detail.innerHTML = `
            <div class="detail-head">
                <div>
                    <h2>${escapeHtml(lead.fullName || 'Unnamed Lead')}</h2>
                    <p>${escapeHtml(lead.company || 'No company')} - ${escapeHtml(lead.service || 'No service')}</p>
                </div>
                <span class="chip ${statusChipClass(lead)}">${escapeHtml(formatLabel(lead.aiCallStatus))}</span>
            </div>

            <div class="detail-grid">
                <div class="detail-field"><span>Mobile</span><a href="tel:${escapeHtml(phoneHref)}">${escapeHtml(lead.phone || lead.rawPhone || 'N/A')}</a></div>
                <div class="detail-field"><span>Email</span><a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email || 'N/A')}</a></div>
                <div class="detail-field"><span>Language</span><strong>${escapeHtml(clean(lead.languageMode) === 'english' ? 'Pure English' : 'Taglish')}</strong></div>
                <div class="detail-field"><span>Received</span><strong>${escapeHtml(formatDateTime(lead.createdAt))}</strong></div>
                <div class="detail-field"><span>Lead Status</span><strong>${escapeHtml(formatLabel(lead.leadStatus))}</strong></div>
                <div class="detail-field"><span>Call Consent</span><strong>${lead.callConsent ? 'Yes' : 'No'}</strong></div>
                <div class="detail-field"><span>Duration</span><strong>${escapeHtml(formatDuration(lead.conversationDurationSeconds))}</strong></div>
                <div class="detail-field"><span>Estimated AI Cost</span><strong>${escapeHtml(`${formatUsd(estimatedUsd)} / ${formatPhp(estimatedPhp)}`)}</strong></div>
            </div>

            <div class="usage-box">
                <div>
                    <span>Realtime Model</span>
                    <strong>${escapeHtml(realtimeModel)}</strong>
                </div>
                <div>
                    <span>Transcript Model</span>
                    <strong>${escapeHtml(transcriptionModel)}</strong>
                </div>
                <div>
                    <span>Responses</span>
                    <strong>${escapeHtml(String(usage.responseCount || 0))}</strong>
                </div>
            </div>

            <div class="message-box">
                <span>Inquiry Message</span>
                <p>${escapeHtml(lead.message || 'No message provided.')}</p>
            </div>

            <div class="transcript-box">
                <div class="transcript-head">
                    <span>Conversation Transcript</span>
                    <small>${escapeHtml(transcript.length ? `${transcript.length} turn(s)` : 'No transcript captured yet')}</small>
                </div>
                <div class="transcript-list">
                    ${renderTranscript(transcript)}
                </div>
            </div>

            <div class="next-action-box">
                <span>Next Action</span>
                <p>${escapeHtml(lead.nextAction || 'Review this website inquiry.')}</p>
            </div>

            <div class="action-grid">
                <button class="btn btn-primary" data-action="request-sales-call">Request Sales Call</button>
                <button class="btn btn-secondary" data-action="queue-call">Queue Mobile AI Call</button>
                <button class="btn btn-secondary" data-action="needs-human">Needs Human</button>
                <button class="btn btn-secondary" data-action="quote-ready">Quote Ready</button>
                <button class="btn btn-secondary" data-action="mark-contacted">Mark Contacted</button>
            </div>
        `;

        els.detail.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', () => handleAction(button.dataset.action, lead));
        });
    }

    function renderSettings() {
        if (!els.settingVoice) return;
        if (!els.settingVoice.options.length) {
            els.settingVoice.innerHTML = VOICE_OPTIONS
                .map((voice) => `<option value="${escapeHtml(voice.id)}">${escapeHtml(voice.label)}</option>`)
                .join('');
        }

        els.settingLanguage.value = state.settings.language === 'english' ? 'english' : 'taglish';
        els.settingVoice.value = VOICE_OPTIONS.some((voice) => voice.id === state.settings.voice) ? state.settings.voice : DEFAULT_SETTINGS.voice;
        els.settingRealtimeModel.value = state.settings.realtimeModel || DEFAULT_SETTINGS.realtimeModel;
        els.settingTranscriptionModel.value = state.settings.transcriptionModel || DEFAULT_SETTINGS.transcriptionModel;
        els.settingGreeting.value = state.settings.greeting || DEFAULT_SETTINGS.greeting;
        els.settingPrompt.value = state.settings.prompt || DEFAULT_SETTINGS.prompt;
        updateVoicePreview();
        if (els.settingsStatus) {
            els.settingsStatus.textContent = state.settings.updatedAt
                ? `Saved ${formatDateTime(state.settings.updatedAt)}`
                : 'Draft settings loaded';
        }
    }

    function updateVoicePreview() {
        const selected = VOICE_OPTIONS.find((voice) => voice.id === els.settingVoice?.value) || VOICE_OPTIONS[0];
        if (byId('voicePreviewName')) byId('voicePreviewName').textContent = selected.label;
        if (byId('voicePreviewDescription')) byId('voicePreviewDescription').textContent = selected.description;
    }

    function findBrowserVoice(selected) {
        const voices = window.speechSynthesis?.getVoices?.() || [];
        if (!voices.length) return null;
        const hints = selected.hints || [];
        const byHint = voices.find((voice) => {
            const name = voice.name.toLowerCase();
            return hints.some((hint) => name.includes(hint));
        });
        if (byHint) return byHint;
        return voices.find((voice) => /^en[-_]/i.test(voice.lang)) || voices[0] || null;
    }

    function collectSettingsForm() {
        return {
            language: els.settingLanguage.value === 'english' ? 'english' : 'taglish',
            voice: els.settingVoice.value || DEFAULT_SETTINGS.voice,
            realtimeModel: clean(els.settingRealtimeModel.value) || DEFAULT_SETTINGS.realtimeModel,
            transcriptionModel: clean(els.settingTranscriptionModel.value) || DEFAULT_SETTINGS.transcriptionModel,
            greeting: clean(els.settingGreeting.value) || DEFAULT_SETTINGS.greeting,
            prompt: clean(els.settingPrompt.value) || DEFAULT_SETTINGS.prompt
        };
    }

    function previewBrowserVoice() {
        if (!('speechSynthesis' in window)) {
            MargaUtils.showToast('Browser voice preview is not supported on this device.', 'warning');
            return;
        }
        window.speechSynthesis.cancel();
        const selected = VOICE_OPTIONS.find((voice) => voice.id === els.settingVoice.value) || VOICE_OPTIONS[0];
        const utterance = new SpeechSynthesisUtterance(clean(els.voiceTestText.value) || DEFAULT_SETTINGS.greeting);
        utterance.lang = els.settingLanguage.value === 'english' ? 'en-PH' : 'fil-PH';
        utterance.rate = selected.previewRate || 0.86;
        utterance.pitch = selected.previewPitch || 1;
        const browserVoice = findBrowserVoice(selected);
        if (browserVoice) utterance.voice = browserVoice;
        window.speechSynthesis.speak(utterance);
    }

    function renderTranscript(transcript) {
        if (!Array.isArray(transcript) || !transcript.length) {
            return '<div class="transcript-empty">Transcript will appear here after the browser voice call captures speech.</div>';
        }
        return transcript.map((entry) => {
            const role = clean(entry.role) === 'assistant' ? 'assistant' : 'customer';
            const label = role === 'assistant' ? 'AI Product Consultant' : 'Customer';
            return `
                <div class="transcript-turn ${role}">
                    <div class="transcript-speaker">${escapeHtml(entry.label || label)}</div>
                    <p>${escapeHtml(entry.text || '')}</p>
                </div>
            `;
        }).join('');
    }

    async function handleAction(action, lead) {
        const actions = {
            'request-sales-call': {
                aiConsultantStatus: 'needs_human',
                leadStatus: 'needs_human',
                salesCallRequested: true,
                salesCallRequestedAt: new Date().toISOString(),
                nextAction: 'Sales team should call this prospect'
            },
            'queue-call': {
                aiCallStatus: lead.callConsent ? 'pending_call' : 'waiting_for_call_consent',
                aiConsultantStatus: 'call_queued',
                leadStatus: 'new',
                nextAction: lead.callConsent
                    ? 'AI Product Consultant call queued'
                    : 'Get phone consent before placing an AI call'
            },
            'needs-human': {
                aiConsultantStatus: 'needs_human',
                leadStatus: 'needs_human',
                nextAction: 'Sales team should follow up manually'
            },
            'quote-ready': {
                aiConsultantStatus: 'quote_ready',
                leadStatus: 'qualified',
                nextAction: 'Prepare quote based on the inquiry and consultation notes'
            },
            'mark-contacted': {
                aiCallStatus: 'called',
                aiConsultantStatus: 'contacted',
                leadStatus: 'contacted',
                nextAction: 'Review consultation result and schedule next follow-up'
            }
        };

        const updates = actions[action];
        if (!updates) return;

        try {
            await updateLead(lead._docId, updates);
            MargaUtils.showToast('Lead status updated.', 'success');
            await loadLeads();
            state.selectedId = lead._docId;
            render();
        } catch (error) {
            console.error(error);
            MargaUtils.showToast(`Unable to update lead: ${error.message}`, 'error');
        }
    }

    function render() {
        renderTabs();
        updateStats();
        renderList();
        renderDetail();
        renderSettings();
        document.querySelectorAll('.stat-card').forEach((card) => {
            card.classList.toggle('active', card.dataset.filter === state.filter);
        });
    }

    function bindEvents() {
        els.refresh.addEventListener('click', () => loadLeads().catch(showLoadError));
        els.search.addEventListener('input', MargaUtils.debounce((event) => {
            state.query = event.target.value;
            render();
        }, 180));
        els.languageFilter.addEventListener('change', (event) => {
            state.language = event.target.value;
            render();
        });
        els.serviceFilter.addEventListener('change', (event) => {
            state.service = event.target.value;
            render();
        });
        document.querySelectorAll('.stat-card').forEach((card) => {
            card.addEventListener('click', () => {
                state.filter = card.dataset.filter;
                state.activeTab = 'leads';
                render();
            });
        });
        document.querySelectorAll('.consultant-tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                state.activeTab = tab.dataset.tab || 'home';
                render();
            });
        });
        els.settingsForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            els.settingsStatus.textContent = 'Saving settings...';
            els.saveSettings.disabled = true;
            try {
                await saveSettings(collectSettingsForm());
                MargaUtils.showToast('AI Product Consultant settings saved.', 'success');
                renderSettings();
            } catch (error) {
                console.error(error);
                els.settingsStatus.textContent = 'Saved locally. Firestore save failed.';
                MargaUtils.showToast(`Settings saved locally, but Firestore failed: ${error.message}`, 'warning', 6000);
            } finally {
                els.saveSettings.disabled = false;
            }
        });
        els.resetSettings.addEventListener('click', () => {
            state.settings = { ...DEFAULT_SETTINGS };
            renderSettings();
        });
        els.settingVoice.addEventListener('change', updateVoicePreview);
        window.speechSynthesis?.addEventListener?.('voiceschanged', updateVoicePreview);
        els.testBrowserVoice.addEventListener('click', previewBrowserVoice);
        els.stopBrowserVoice.addEventListener('click', () => window.speechSynthesis?.cancel());
    }

    function showLoadError(error) {
        console.error(error);
        els.status.textContent = 'Error';
        els.list.innerHTML = `<div class="empty-state">Unable to load website inquiries: ${escapeHtml(error.message)}</div>`;
    }

    function init() {
        if (!MargaAuth.requireAccess('ai-product-consultant')) return;
        const user = MargaAuth.getUser();
        if (user) {
            const userName = byId('userName');
            const userRole = byId('userRole');
            const userAvatar = byId('userAvatar');
            if (userName) userName.textContent = user.name;
            if (userRole) userRole.textContent = MargaAuth.getDisplayRoles(user);
            if (userAvatar) userAvatar.textContent = clean(user.name).charAt(0).toUpperCase() || 'A';
        }

        els.status = byId('consultantStatus');
        els.refresh = byId('refreshLeadsBtn');
        els.list = byId('leadList');
        els.detail = byId('leadDetail');
        els.search = byId('leadSearch');
        els.languageFilter = byId('languageFilter');
        els.serviceFilter = byId('serviceFilter');
        els.settingsForm = byId('consultantSettingsForm');
        els.settingLanguage = byId('settingLanguage');
        els.settingVoice = byId('settingVoice');
        els.settingRealtimeModel = byId('settingRealtimeModel');
        els.settingTranscriptionModel = byId('settingTranscriptionModel');
        els.settingGreeting = byId('settingGreeting');
        els.settingPrompt = byId('settingPrompt');
        els.saveSettings = byId('saveSettingsBtn');
        els.resetSettings = byId('resetSettingsBtn');
        els.settingsStatus = byId('settingsStatus');
        els.voiceTestText = byId('voiceTestText');
        els.testBrowserVoice = byId('testBrowserVoiceBtn');
        els.stopBrowserVoice = byId('stopBrowserVoiceBtn');
        bindEvents();
        fetchSettings().then(renderSettings).catch((error) => console.warn('Settings load failed:', error));
        loadLeads().catch(showLoadError);
        setInterval(() => loadLeads().catch((error) => console.warn('Lead polling failed:', error)), 60000);
    }

    document.addEventListener('DOMContentLoaded', init);
    window.toggleSidebar = function toggleSidebar() {
        byId('sidebar')?.classList.toggle('open');
    };
})();
