/*
 * MARGA Service Dispatch Sample UI
 * Snapshot source: /Users/mike/Downloads/Dump20260204.sql
 */

const SERVICE_REQUEST_STATUS = {
    0: { label: 'Queued', className: 'status-queued' },
    1: { label: 'Assigned', className: 'status-assigned' },
    2: { label: 'In Progress', className: 'status-progress' },
    3: { label: 'Resolved', className: 'status-resolved' }
};

const STAFF = [
    { id: 6, name: 'Reygol Allon', role: 'Technician', active: true },
    { id: 18, name: 'Crispin Escaraman Jr', role: 'Technician', active: true },
    { id: 22, name: 'Emmanuel Genova', role: 'Technician', active: true },
    { id: 27, name: 'Richard Laurenciano', role: 'Technician', active: true },
    { id: 31, name: 'Marlon Magdaraog', role: 'Technician', active: true },
    { id: 54, name: 'Hener Claveria', role: 'Technician', active: true },
    { id: 135, name: 'Jemuel Toledo', role: 'Technician', active: true },
    { id: 176, name: 'John Philip Capinpin', role: 'Technician', active: true },

    { id: 15, name: 'Jonathan De Guzman', role: 'Messenger', active: true },
    { id: 20, name: 'Carlos Edano', role: 'Messenger', active: true },
    { id: 41, name: 'Reymark Saranilla', role: 'Messenger', active: true },
    { id: 156, name: 'Mark Edison Rio', role: 'Messenger', active: true },
    { id: 181, name: 'Alexander Pacion', role: 'Messenger', active: true }
];

const STAFF_BY_ID = STAFF.reduce((acc, person) => {
    acc[person.id] = person;
    return acc;
}, {});

const MACHINES = {
    6: { serial: 'E66064GON314610', description: 'DCP-7040' },
    69: { serial: 'E69895D4N856940', description: 'DCP-7065DN' },
    127: { serial: 'E69895K2N621534', description: 'DCP-7065DN' },
    490: { serial: 'E73807D6N426099', description: 'MFC-2740' },
    552: { serial: 'E69906H3N796413', description: 'MFC-7360' },
    2391: { serial: 'V9724400997', description: 'COPIER MPC-2051' }
};

const BRANCHES = {
    152: { branch: 'San Fernando - Bayan (CBS)', company: 'China Bank Savings - Branches' },
    169: { branch: 'Subic (CBS)', company: 'China Bank Savings - Branches' },
    227: { branch: 'Dagupan (CBS)', company: 'China Bank Savings - Branches' },
    231: { branch: 'La Union (CBS)', company: 'China Bank Savings - Branches' },
    500: { branch: 'KR Printing', company: 'KR Printing' },
    987: { branch: 'Marsaman Manning Agency - Documentation', company: 'Marsaman Manning Agency' },
    2880: { branch: 'LINFRA CORP. Finance Dept.', company: 'LINFRA CORP.' },
    3359: { branch: 'Simbayanan ni Maria Multipurpose Cooperative - Lower Bicutan', company: 'Simbayanan ni Maria Multipurpose Cooperative' }
};

const REQUESTS = [
    {
        id: 7371,
        branch_id: 3359,
        mach_id: 69,
        request_type: 2,
        status_id: 1,
        remarks: 'Change Unit',
        requested_at: '2026-01-28 08:54:10'
    },
    {
        id: 7372,
        branch_id: 500,
        mach_id: 0,
        request_type: 2,
        status_id: 0,
        remarks: 'Change Unit. Head prob. Cooling down',
        requested_at: '2026-01-30 03:14:26'
    },
    {
        id: 7373,
        branch_id: 169,
        mach_id: 0,
        request_type: 2,
        status_id: 0,
        remarks: 'Change Unit, self diagnostic.',
        requested_at: '2026-01-30 08:31:59'
    },
    {
        id: 7374,
        branch_id: 231,
        mach_id: 0,
        request_type: 2,
        status_id: 0,
        remarks: 'change unit. dirty print, may problem ang Heat roller.',
        requested_at: '2026-01-30 12:21:07'
    },
    {
        id: 7375,
        branch_id: 2880,
        mach_id: 0,
        request_type: 2,
        status_id: 0,
        remarks: 'Change Unit. Head prob',
        requested_at: '2026-02-02 02:37:03'
    },
    {
        id: 7376,
        branch_id: 987,
        mach_id: 0,
        request_type: 2,
        status_id: 0,
        remarks: 'Change Unit to brandnew. Laging colling down',
        requested_at: '2026-02-02 06:19:10'
    },
    {
        id: 7377,
        branch_id: 152,
        mach_id: 0,
        request_type: 2,
        status_id: 0,
        remarks: 'change unit, ayaw mag print nag jamming din.',
        requested_at: '2026-02-02 07:19:45'
    },
    {
        id: 7378,
        branch_id: 227,
        mach_id: 490,
        request_type: 2,
        status_id: 1,
        remarks: 'Change Unit, dumikt ang papel sa heat roller.',
        requested_at: '2026-02-03 07:52:52'
    }
];

const REPAIR_ROWS = [
    { id: 5667, mach_id: 229, tech_id: 0, status_id: 1 },
    { id: 5668, mach_id: 739, tech_id: 156, status_id: 0 },
    { id: 5669, mach_id: 2905, tech_id: 156, status_id: 1 },
    { id: 5670, mach_id: 2491, tech_id: 0, status_id: 1 },
    { id: 5671, mach_id: 3308, tech_id: 0, status_id: 1 },
    { id: 5672, mach_id: 2250, tech_id: 0, status_id: 1 },
    { id: 5673, mach_id: 732, tech_id: 192, status_id: 1 },
    { id: 5674, mach_id: 490, tech_id: 0, status_id: 1 }
];

const HISTORY_ROWS = [
    { id: 26621, mach_id: 2250, status_id: 8, tech_id: 0, remarks: '' },
    { id: 26622, mach_id: 2250, status_id: 1, tech_id: 0, remarks: '' },
    { id: 26623, mach_id: 732, status_id: 7, tech_id: 0, remarks: 'PULL OUT' },
    { id: 26624, mach_id: 732, status_id: 8, tech_id: 192, remarks: '' },
    { id: 26625, mach_id: 732, status_id: 1, tech_id: 0, remarks: '' },
    { id: 26626, mach_id: 732, status_id: 2, tech_id: 54, remarks: 'For Delivery' },
    { id: 26627, mach_id: 490, status_id: 8, tech_id: 0, remarks: '' },
    { id: 26628, mach_id: 490, status_id: 1, tech_id: 0, remarks: '' }
];

const state = {
    statusFilter: 'all',
    assigneeFilter: 'all',
    search: '',
    assignmentMap: {}
};

const ASSIGNMENT_STORAGE_KEY = 'marga_service_assignments_v1';

function staffNameById(id) {
    if (!id) return 'Unassigned';
    const person = STAFF_BY_ID[id];
    return person ? person.name : `Staff #${id}`;
}

function getStatusMeta(statusId) {
    return SERVICE_REQUEST_STATUS[statusId] || { label: `Status ${statusId}`, className: 'status-default' };
}

function parseDateSafe(value) {
    if (!value) return null;
    const formatted = String(value).replace(' ', 'T');
    const parsed = new Date(formatted);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(value) {
    const date = parseDateSafe(value);
    if (!date) return '-';
    return date.toLocaleString('en-PH', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function buildDefaultAssignments() {
    const defaults = {};
    const messengerPool = STAFF.filter((s) => s.role === 'Messenger' && s.active);

    REQUESTS.forEach((request, index) => {
        let technicianId = null;
        let messengerId = null;

        const latestHistory = HISTORY_ROWS
            .filter((row) => row.mach_id === request.mach_id)
            .sort((a, b) => b.id - a.id)[0];

        const latestRepair = REPAIR_ROWS
            .filter((row) => row.mach_id === request.mach_id)
            .sort((a, b) => b.id - a.id)[0];

        if (latestHistory && latestHistory.tech_id > 0) {
            const person = STAFF_BY_ID[latestHistory.tech_id];
            if (person && person.role === 'Technician') {
                technicianId = person.id;
            }
            if (person && person.role === 'Messenger') {
                messengerId = person.id;
            }
        }

        if (!technicianId && latestRepair && latestRepair.tech_id > 0) {
            const person = STAFF_BY_ID[latestRepair.tech_id];
            if (person && person.role === 'Technician') {
                technicianId = person.id;
            }
        }

        if (!messengerId && request.status_id === 1 && messengerPool.length > 0) {
            messengerId = messengerPool[index % messengerPool.length].id;
        }

        defaults[request.id] = { technicianId, messengerId };
    });

    return defaults;
}

function loadAssignments() {
    const defaults = buildDefaultAssignments();

    try {
        const raw = localStorage.getItem(ASSIGNMENT_STORAGE_KEY);
        if (!raw) {
            state.assignmentMap = defaults;
            return;
        }

        const parsed = JSON.parse(raw);
        state.assignmentMap = { ...defaults, ...parsed };
    } catch (error) {
        console.warn('Failed to load assignment cache:', error);
        state.assignmentMap = defaults;
    }
}

function saveAssignments() {
    localStorage.setItem(ASSIGNMENT_STORAGE_KEY, JSON.stringify(state.assignmentMap));
}

function buildTaskRows() {
    return REQUESTS.map((request) => {
        const branch = BRANCHES[request.branch_id] || {
            company: 'Unknown Company',
            branch: `Branch #${request.branch_id}`
        };

        const machine = MACHINES[request.mach_id] || null;

        const assignment = state.assignmentMap[request.id] || { technicianId: null, messengerId: null };

        return {
            ...request,
            company: branch.company,
            branch: branch.branch,
            machine,
            technicianId: assignment.technicianId || null,
            messengerId: assignment.messengerId || null,
            searchText: `${branch.company} ${branch.branch} ${request.remarks} ${machine ? `${machine.serial} ${machine.description}` : ''}`.toLowerCase()
        };
    });
}

function filteredTasks(tasks) {
    return tasks.filter((task) => {
        if (state.statusFilter !== 'all' && String(task.status_id) !== state.statusFilter) {
            return false;
        }

        if (state.assigneeFilter === 'with-tech' && !task.technicianId) {
            return false;
        }

        if (state.assigneeFilter === 'with-messenger' && !task.messengerId) {
            return false;
        }

        if (state.assigneeFilter === 'unassigned' && (task.technicianId || task.messengerId)) {
            return false;
        }

        if (state.search && !task.searchText.includes(state.search)) {
            return false;
        }

        return true;
    });
}

function renderStatusOptions() {
    const statusFilter = document.getElementById('statusFilter');
    const statuses = Object.entries(SERVICE_REQUEST_STATUS)
        .map(([id, meta]) => `<option value="${id}">${meta.label}</option>`)
        .join('');

    statusFilter.innerHTML = `<option value="all">All Statuses</option>${statuses}`;
    statusFilter.value = state.statusFilter;
}

function renderKpis(tasks) {
    const total = tasks.length;
    const queued = tasks.filter((task) => task.status_id === 0).length;
    const assigned = tasks.filter((task) => task.status_id === 1).length;
    const withTech = tasks.filter((task) => Boolean(task.technicianId)).length;
    const withMessenger = tasks.filter((task) => Boolean(task.messengerId)).length;

    const kpis = [
        { label: 'Service Tickets', value: total },
        { label: 'Queued', value: queued },
        { label: 'Assigned', value: assigned },
        { label: 'With Technician', value: withTech },
        { label: 'With Messenger', value: withMessenger }
    ];

    const html = kpis
        .map((kpi) => {
            return `
                <div class="service-kpi">
                    <div class="kpi-label">${kpi.label}</div>
                    <div class="kpi-value">${kpi.value}</div>
                </div>
            `;
        })
        .join('');

    document.getElementById('kpiGrid').innerHTML = html;
}

function assignmentSelect(role, taskId, selectedId) {
    const candidates = STAFF.filter((person) => person.role === role && person.active);
    const options = [`<option value="">Unassigned</option>`]
        .concat(
            candidates.map((person) => {
                const selected = Number(selectedId) === person.id ? 'selected' : '';
                return `<option value="${person.id}" ${selected}>${person.name}</option>`;
            })
        )
        .join('');

    return `
        <select class="assign-select" data-task-id="${taskId}" data-role="${role.toLowerCase()}">
            ${options}
        </select>
    `;
}

function renderTable(tasks) {
    const tbody = document.getElementById('serviceTableBody');
    const countLabel = document.getElementById('taskCountLabel');

    countLabel.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;

    if (!tasks.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No tasks match the current filters.</td></tr>';
        return;
    }

    const rows = tasks
        .map((task) => {
            const status = getStatusMeta(task.status_id);
            const machineHtml = task.machine
                ? `<div class="machine-main">${task.machine.description}</div><div class="machine-sub">${task.machine.serial}</div>`
                : `<div class="machine-sub">Machine not tagged in request</div>`;

            return `
                <tr>
                    <td>#${task.id}</td>
                    <td>${formatDateTime(task.requested_at)}</td>
                    <td class="client-cell">
                        <div class="client-main">${MargaUtils.escapeHtml(task.company)}</div>
                        <div class="client-sub">${MargaUtils.escapeHtml(task.branch)}</div>
                    </td>
                    <td class="concern-cell">
                        <div class="concern-text">${MargaUtils.escapeHtml(task.remarks)}</div>
                    </td>
                    <td>${machineHtml}</td>
                    <td>
                        <span class="status-badge ${status.className}">
                            <span class="status-dot"></span>
                            ${MargaUtils.escapeHtml(status.label)}
                        </span>
                    </td>
                    <td>${assignmentSelect('Technician', task.id, task.technicianId)}</td>
                    <td>${assignmentSelect('Messenger', task.id, task.messengerId)}</td>
                </tr>
            `;
        })
        .join('');

    tbody.innerHTML = rows;
}

function summarizeByRole(tasks, role) {
    const people = STAFF.filter((person) => person.role === role && person.active);

    return people
        .map((person) => {
            const assigned = tasks
                .filter((task) => (role === 'Technician' ? task.technicianId === person.id : task.messengerId === person.id))
                .map((task) => task.id);

            return {
                person,
                assigned
            };
        })
        .sort((a, b) => b.assigned.length - a.assigned.length || a.person.name.localeCompare(b.person.name));
}

function renderTeamPanel(tasks, role, elementId) {
    const summary = summarizeByRole(tasks, role);
    const container = document.getElementById(elementId);

    if (!summary.length) {
        container.innerHTML = '<div class="empty-panel">No team members configured.</div>';
        return;
    }

    container.innerHTML = summary
        .map(({ person, assigned }) => {
            const tags = assigned.length
                ? assigned.map((id) => `<span class="ticket-tag">#${id}</span>`).join('')
                : '<span class="ticket-tag">No assigned ticket</span>';

            return `
                <div class="team-card">
                    <div class="team-name">${MargaUtils.escapeHtml(person.name)}</div>
                    <div class="team-meta">${role} - ${assigned.length} task${assigned.length === 1 ? '' : 's'}</div>
                    <div class="ticket-tags">${tags}</div>
                </div>
            `;
        })
        .join('');
}

function attachAssignmentHandlers() {
    document.querySelectorAll('.assign-select').forEach((select) => {
        select.addEventListener('change', (event) => {
            const taskId = Number(event.target.dataset.taskId);
            const role = event.target.dataset.role;
            const value = event.target.value ? Number(event.target.value) : null;

            const existing = state.assignmentMap[taskId] || { technicianId: null, messengerId: null };
            state.assignmentMap[taskId] = {
                ...existing,
                ...(role === 'technician' ? { technicianId: value } : { messengerId: value })
            };

            saveAssignments();
            render();
        });
    });
}

function render() {
    const allTasks = buildTaskRows();
    const visibleTasks = filteredTasks(allTasks);

    renderKpis(allTasks);
    renderTable(visibleTasks);
    renderTeamPanel(allTasks, 'Technician', 'technicianPanel');
    renderTeamPanel(allTasks, 'Messenger', 'messengerPanel');
    attachAssignmentHandlers();
}

function bindEvents() {
    const statusFilter = document.getElementById('statusFilter');
    const assigneeFilter = document.getElementById('assigneeFilter');
    const searchInput = document.getElementById('searchInput');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');

    statusFilter.addEventListener('change', (event) => {
        state.statusFilter = event.target.value;
        render();
    });

    assigneeFilter.addEventListener('change', (event) => {
        state.assigneeFilter = event.target.value;
        render();
    });

    searchInput.addEventListener(
        'input',
        MargaUtils.debounce((event) => {
            state.search = event.target.value.trim().toLowerCase();
            render();
        }, 220)
    );

    clearFiltersBtn.addEventListener('click', () => {
        state.statusFilter = 'all';
        state.assigneeFilter = 'all';
        state.search = '';

        statusFilter.value = 'all';
        assigneeFilter.value = 'all';
        searchInput.value = '';
        render();
    });
}

function applyUserContext() {
    if (!MargaAuth.requireAccess('service')) return false;

    const user = MargaAuth.getUser();
    if (user) {
        const avatar = document.getElementById('userAvatar');
        const userName = document.getElementById('userName');
        const userRole = document.getElementById('userRole');

        if (avatar) avatar.textContent = (user.name || user.username || 'U').charAt(0).toUpperCase();
        if (userName) userName.textContent = user.name || user.username || 'User';
        if (userRole) userRole.textContent = user.role || 'user';
    }

    return true;
}

function initSnapshotTag() {
    const latestDate = REQUESTS.reduce((max, request) => {
        const current = parseDateSafe(request.requested_at);
        if (!current) return max;
        return current > max ? current : max;
    }, new Date('1900-01-01T00:00:00'));

    const tag = document.getElementById('snapshotTag');
    if (tag) {
        tag.textContent = `Source: Dump20260204.sql - Latest request: ${latestDate.toLocaleDateString('en-PH')}`;
    }
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('show');
}

window.toggleSidebar = toggleSidebar;

document.addEventListener('DOMContentLoaded', () => {
    if (!applyUserContext()) return;

    loadAssignments();
    initSnapshotTag();
    renderStatusOptions();
    bindEvents();
    render();
});
