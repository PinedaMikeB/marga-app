if (!MargaAuth.requireAccess('hr')) {
    throw new Error('Unauthorized access to HR module.');
}

const WORK_LOCATIONS_COLLECTION = 'marga_hr_work_locations';
const OFFICE_MAX_METERS = 30;
const PRODUCTION_MAX_METERS = 30;
const CUSTOMER_SITE_MAX_METERS = 100;

const DEFAULT_WORK_LOCATIONS = [
    {
        id: 'havila-office',
        name: 'Havila Office',
        type: 'office',
        address: 'MARGA office / Havila, Antipolo',
        latitude: '',
        longitude: '',
        allowedMeters: 20,
        requiresPincode: true,
        isActive: true
    },
    {
        id: 'production-office',
        name: 'Production Office',
        type: 'production',
        address: '',
        latitude: '',
        longitude: '',
        allowedMeters: 20,
        requiresPincode: true,
        isActive: true
    }
];

const TYPE_LABELS = {
    office: 'Office',
    production: 'Production',
    customer_site: 'Customer Site',
    temporary_site: 'Temporary Site'
};

const HR_STATE = {
    employees: [],
    positions: new Map(),
    locations: []
};

document.addEventListener('DOMContentLoaded', () => {
    const user = MargaAuth.getUser();
    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    if (user) {
        document.getElementById('userName').textContent = user.name || user.username || 'User';
        document.getElementById('userRole').textContent = MargaAuth.getDisplayRoles(user);
        document.getElementById('userAvatar').textContent = String(user.name || user.username || 'U').charAt(0).toUpperCase();
    }

    document.getElementById('refreshHrBtn').addEventListener('click', () => loadHrModule());
    document.getElementById('employeeSearch').addEventListener('input', renderEmployees);
    document.getElementById('employeeStatusFilter').addEventListener('change', renderEmployees);
    document.getElementById('locationType').addEventListener('change', updateMeterLimit);
    document.getElementById('allowedMeters').addEventListener('input', updateMeterLabel);
    document.getElementById('locationForm').addEventListener('submit', (event) => {
        event.preventDefault();
        saveLocationForm();
    });
    document.getElementById('newLocationBtn').addEventListener('click', () => resetLocationForm());
    document.getElementById('useCurrentLocationBtn').addEventListener('click', () => fillCurrentGps('latitude', 'longitude', 'formNotice'));
    document.getElementById('useEmployeeGpsBtn').addEventListener('click', () => fillCurrentGps('employeeLatitude', 'employeeLongitude', 'eligibilityResult'));
    document.getElementById('checkEligibilityBtn').addEventListener('click', previewEligibility);

    loadHrModule();
});

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

window.toggleSidebar = toggleSidebar;

async function loadHrModule() {
    const status = document.getElementById('hrDirectoryStatus');
    status.textContent = 'Loading HR records...';
    try {
        const [employees, positions, locations] = await Promise.all([
            MargaUtils.fetchCollection('tbl_employee', 500),
            MargaUtils.fetchCollection('tbl_position', 200).catch(() => []),
            loadWorkLocations()
        ]);
        HR_STATE.employees = employees;
        HR_STATE.positions = new Map(positions.map((position) => [
            String(position.id || position._docId || ''),
            position
        ]));
        HR_STATE.locations = locations;
        status.textContent = `${employees.length.toLocaleString()} employee record(s) loaded.`;
        renderEmployees();
        renderLocations();
        resetLocationForm(HR_STATE.locations[0] || DEFAULT_WORK_LOCATIONS[0]);
        updateOverview();
    } catch (error) {
        console.error('HR module load failed:', error);
        status.textContent = `Unable to load HR records: ${error.message || error}`;
    }
}

async function loadWorkLocations() {
    try {
        const locations = await MargaUtils.fetchCollection(WORK_LOCATIONS_COLLECTION, 100);
        if (locations.length) return locations.map(normalizeLocation).sort(sortLocations);
    } catch (error) {
        console.warn('Work locations unavailable; using local defaults.', error);
    }
    return DEFAULT_WORK_LOCATIONS.map(normalizeLocation);
}

function renderEmployees() {
    const tbody = document.querySelector('#hrEmployeesTable tbody');
    const query = String(document.getElementById('employeeSearch').value || '').trim().toLowerCase();
    const statusFilter = document.getElementById('employeeStatusFilter').value;
    const rows = HR_STATE.employees
        .filter((employee) => {
            const isActive = MargaUtils.isOfficialActiveEmployee(employee);
            if (statusFilter === 'active' && !isActive) return false;
            if (statusFilter === 'inactive' && isActive) return false;
            if (!query) return true;
            return [
                employee.id,
                employee._docId,
                MargaUtils.getEmployeeFullName(employee, ''),
                getPositionLabel(employee),
                employee.email,
                employee.marga_login_email,
                employee.username
            ].some((value) => String(value || '').toLowerCase().includes(query));
        })
        .sort((left, right) => MargaUtils.getEmployeeFullName(left, '').localeCompare(MargaUtils.getEmployeeFullName(right, '')));

    tbody.innerHTML = rows.slice(0, 250).map((employee) => {
        const id = sanitize(employee.id || employee._docId || '');
        const name = sanitize(MargaUtils.getEmployeeFullName(employee, id));
        const email = sanitize(employee.email || employee.marga_login_email || employee.username || '-');
        const position = sanitize(getPositionLabel(employee));
        const active = MargaUtils.isOfficialActiveEmployee(employee);
        return `
            <tr>
                <td data-label="ID">${id || '-'}</td>
                <td data-label="Name"><strong>${name}</strong></td>
                <td data-label="Position">${position}</td>
                <td data-label="Email">${email}</td>
                <td data-label="Status"><span class="status-badge ${active ? 'success' : 'neutral'}">${active ? 'Active' : 'Inactive'}</span></td>
            </tr>
        `;
    }).join('');

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="5">No employees match the current filter.</td></tr>';
    }

    document.getElementById('hrDirectoryStatus').textContent = `${rows.length.toLocaleString()} employee(s) shown.`;
    updateOverview();
}

function getPositionLabel(employee) {
    const position = HR_STATE.positions.get(String(employee.position_id || ''));
    return MargaUtils.getEmployeeDesignation(employee, position ? new Map([[String(employee.position_id || ''), position]]) : null);
}

function renderLocations() {
    const list = document.getElementById('locationList');
    const preview = document.getElementById('previewLocation');
    list.innerHTML = '';
    preview.innerHTML = '';

    HR_STATE.locations.forEach((location) => {
        const item = document.createElement('article');
        item.className = 'hr-location-item';
        item.innerHTML = `
            <header>
                <div>
                    <h4>${sanitize(location.name)}</h4>
                    <p>${sanitize(location.address || 'No address set yet')}</p>
                </div>
                <span class="hr-pill ${location.isActive ? '' : 'inactive'}">${location.isActive ? 'Active' : 'Inactive'}</span>
            </header>
            <div class="hr-location-meta">
                <span class="hr-pill">${sanitize(TYPE_LABELS[location.type] || location.type)}</span>
                <span class="hr-pill">${clampAllowedMeters(location.type, location.allowedMeters)}m max</span>
                <span class="hr-pill ${hasCoordinates(location) ? '' : 'warning'}">${hasCoordinates(location) ? `${sanitize(location.latitude)}, ${sanitize(location.longitude)}` : 'Needs GPS pin'}</span>
                <span class="hr-pill">${location.requiresPincode ? 'Pincode required' : 'No pincode'}</span>
            </div>
            <div class="hr-row-actions">
                <button type="button" class="hr-text-btn" data-edit="${sanitize(location.id)}">Edit</button>
                <button type="button" class="hr-text-btn" data-toggle="${sanitize(location.id)}">${location.isActive ? 'Disable' : 'Enable'}</button>
            </div>
        `;
        list.appendChild(item);

        const option = document.createElement('option');
        option.value = location.id;
        option.textContent = location.name;
        preview.appendChild(option);
    });

    list.querySelectorAll('[data-edit]').forEach((button) => {
        button.addEventListener('click', () => resetLocationForm(HR_STATE.locations.find((location) => location.id === button.dataset.edit)));
    });
    list.querySelectorAll('[data-toggle]').forEach((button) => {
        button.addEventListener('click', () => toggleLocation(button.dataset.toggle));
    });

    if (!HR_STATE.locations.length) {
        list.innerHTML = '<div class="ops-subtext">No work locations saved yet.</div>';
    }
    updateOverview();
}

function updateOverview() {
    const activeEmployees = HR_STATE.employees.filter((employee) => MargaUtils.isOfficialActiveEmployee(employee)).length;
    const activeLocations = HR_STATE.locations.filter((location) => location.isActive !== false).length;
    const strictest = HR_STATE.locations.length
        ? Math.min(...HR_STATE.locations.map((location) => clampAllowedMeters(location.type, location.allowedMeters)))
        : OFFICE_MAX_METERS;
    document.getElementById('activeEmployeeCount').textContent = activeEmployees.toLocaleString();
    document.getElementById('workLocationCount').textContent = activeLocations.toLocaleString();
    document.getElementById('strictestGate').textContent = `${strictest}m`;
}

async function saveLocationForm() {
    const notice = document.getElementById('formNotice');
    const type = document.getElementById('locationType').value;
    const location = normalizeLocation({
        id: document.getElementById('locationId').value || slugify(document.getElementById('locationName').value),
        name: document.getElementById('locationName').value.trim(),
        type,
        address: document.getElementById('locationAddress').value.trim(),
        latitude: document.getElementById('latitude').value,
        longitude: document.getElementById('longitude').value,
        allowedMeters: clampAllowedMeters(type, document.getElementById('allowedMeters').value),
        requiresPincode: document.getElementById('requiresPincode').checked,
        isActive: document.getElementById('isActive').checked,
        updatedAt: new Date().toISOString(),
        updatedBy: MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr'
    });

    if (!location.name) {
        setNotice(notice, 'Location name is required.', 'error');
        return;
    }
    if (!hasCoordinates(location)) {
        setNotice(notice, 'Latitude and longitude are required before this pin can be used for time-in.', 'error');
        return;
    }

    try {
        await setDocument(WORK_LOCATIONS_COLLECTION, location.id, {
            name: location.name,
            type: location.type,
            address: location.address,
            latitude: location.latitude,
            longitude: location.longitude,
            allowed_meters: location.allowedMeters,
            requires_pincode: location.requiresPincode,
            active: location.isActive,
            updated_at: location.updatedAt,
            updated_by: location.updatedBy
        });
        const index = HR_STATE.locations.findIndex((item) => item.id === location.id);
        if (index >= 0) HR_STATE.locations[index] = location;
        else HR_STATE.locations.push(location);
        HR_STATE.locations.sort(sortLocations);
        renderLocations();
        resetLocationForm(location);
        setNotice(notice, `${location.name} saved with a ${location.allowedMeters}m limit.`, 'success');
    } catch (error) {
        console.error('Save location failed:', error);
        setNotice(notice, `Save failed: ${error.message || error}`, 'error');
    }
}

async function toggleLocation(locationId) {
    const location = HR_STATE.locations.find((item) => item.id === locationId);
    if (!location) return;
    const nextActive = location.isActive === false;
    try {
        await setDocument(WORK_LOCATIONS_COLLECTION, location.id, {
            active: nextActive,
            updated_at: new Date().toISOString(),
            updated_by: MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr'
        });
        location.isActive = nextActive;
        renderLocations();
    } catch (error) {
        alert(`Failed to update location: ${error.message || error}`);
    }
}

function resetLocationForm(location = null) {
    const current = normalizeLocation(location || {
        id: '',
        name: '',
        type: 'office',
        address: '',
        latitude: '',
        longitude: '',
        allowedMeters: 20,
        requiresPincode: true,
        isActive: true
    });
    document.getElementById('locationId').value = current.id || '';
    document.getElementById('locationName').value = current.name || '';
    document.getElementById('locationType').value = current.type || 'office';
    document.getElementById('locationAddress').value = current.address || '';
    document.getElementById('latitude').value = current.latitude || '';
    document.getElementById('longitude').value = current.longitude || '';
    document.getElementById('allowedMeters').value = clampAllowedMeters(current.type, current.allowedMeters);
    document.getElementById('requiresPincode').checked = current.requiresPincode !== false;
    document.getElementById('isActive').checked = current.isActive !== false;
    setNotice(document.getElementById('formNotice'), '', '');
    updateMeterLimit();
}

function updateMeterLimit() {
    const type = document.getElementById('locationType').value;
    const input = document.getElementById('allowedMeters');
    input.max = String(maxMetersForType(type));
    input.value = String(clampAllowedMeters(type, input.value));
    updateMeterLabel();
}

function updateMeterLabel() {
    document.getElementById('allowedMetersLabel').textContent = `${document.getElementById('allowedMeters').value}m`;
}

function previewEligibility() {
    const location = HR_STATE.locations.find((item) => item.id === document.getElementById('previewLocation').value);
    const result = validateTimeIn(location, {
        latitude: document.getElementById('employeeLatitude').value,
        longitude: document.getElementById('employeeLongitude').value
    });
    const element = document.getElementById('eligibilityResult');
    element.className = `hr-eligibility ${result.allowed ? 'allowed' : 'blocked'}`;
    element.textContent = result.reason;
}

function fillCurrentGps(latitudeId, longitudeId, noticeId) {
    const notice = document.getElementById(noticeId);
    if (!navigator.geolocation) {
        setNotice(notice, 'This browser does not support GPS location.', 'error');
        return;
    }
    setNotice(notice, 'Reading current GPS location...', 'neutral');
    navigator.geolocation.getCurrentPosition((position) => {
        document.getElementById(latitudeId).value = position.coords.latitude.toFixed(6);
        document.getElementById(longitudeId).value = position.coords.longitude.toFixed(6);
        setNotice(notice, `GPS captured with ${Math.round(position.coords.accuracy)}m device accuracy.`, 'success');
    }, () => {
        setNotice(notice, 'GPS permission was denied or unavailable.', 'error');
    }, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0
    });
}

function validateTimeIn(location, employeePoint) {
    if (!location || location.isActive === false) return { allowed: false, reason: 'Assigned work location is inactive or missing.' };
    if (!hasCoordinates(location)) return { allowed: false, reason: `${location.name} has no pinned GPS coordinates yet.` };
    if (!hasCoordinates(employeePoint)) return { allowed: false, reason: 'Employee GPS point is missing.' };
    const allowedMeters = clampAllowedMeters(location.type, location.allowedMeters);
    const actualDistance = distanceMeters(location, employeePoint);
    if (actualDistance <= allowedMeters) {
        return {
            allowed: true,
            distanceMeters: actualDistance,
            allowedMeters,
            reason: `Allowed. Employee is ${actualDistance.toFixed(1)}m from ${location.name}.`
        };
    }
    return {
        allowed: false,
        distanceMeters: actualDistance,
        allowedMeters,
        reason: `Blocked. Employee is ${actualDistance.toFixed(1)}m away; limit is ${allowedMeters}m.`
    };
}

function normalizeLocation(location = {}) {
    return {
        id: String(location.id || location._docId || slugify(location.name || '')).trim(),
        name: String(location.name || '').trim(),
        type: String(location.type || 'office').trim(),
        address: String(location.address || '').trim(),
        latitude: String(location.latitude ?? '').trim(),
        longitude: String(location.longitude ?? '').trim(),
        allowedMeters: clampAllowedMeters(location.type || 'office', location.allowedMeters ?? location.allowed_meters ?? 20),
        requiresPincode: location.requiresPincode ?? location.requires_pincode ?? true,
        isActive: location.isActive ?? location.active ?? true,
        updatedAt: location.updatedAt || location.updated_at || ''
    };
}

function maxMetersForType(type) {
    if (type === 'customer_site' || type === 'temporary_site') return CUSTOMER_SITE_MAX_METERS;
    if (type === 'production') return PRODUCTION_MAX_METERS;
    return OFFICE_MAX_METERS;
}

function clampAllowedMeters(type, value) {
    const numericValue = Number(value) || 5;
    return Math.min(Math.max(Math.round(numericValue), 5), maxMetersForType(type));
}

function distanceMeters(from, to) {
    const earthRadiusMeters = 6371000;
    const lat1 = toRadians(from.latitude);
    const lat2 = toRadians(to.latitude);
    const deltaLat = toRadians(Number(to.latitude) - Number(from.latitude));
    const deltaLng = toRadians(Number(to.longitude) - Number(from.longitude));
    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2)
        + Math.cos(lat1) * Math.cos(lat2)
        * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusMeters * c;
}

function hasCoordinates(value) {
    return value
        && value.latitude !== ''
        && value.longitude !== ''
        && Number.isFinite(Number(value.latitude))
        && Number.isFinite(Number(value.longitude));
}

function toRadians(value) {
    return Number(value) * Math.PI / 180;
}

function setNotice(element, message, mode) {
    element.textContent = message;
    if (element.id === 'eligibilityResult') {
        element.className = `hr-eligibility ${mode === 'success' ? 'allowed' : mode === 'error' ? 'blocked' : 'neutral'}`;
        return;
    }
    element.className = `hr-form-notice ${mode || ''}`;
}

function sortLocations(left, right) {
    return String(left.name || '').localeCompare(String(right.name || ''));
}

function slugify(value) {
    return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `location-${Date.now()}`;
}

function sanitize(value) {
    return MargaUtils.escapeHtml(String(value ?? ''));
}

function toFirestoreFieldValue(value) {
    if (value === null) return { nullValue: null };
    if (Array.isArray(value)) return { arrayValue: { values: value.map((entry) => toFirestoreFieldValue(entry)) } };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    return { stringValue: String(value ?? '') };
}

async function setDocument(collection, docId, fields) {
    const body = { fields: {} };
    Object.entries(fields).forEach(([key, value]) => {
        body.fields[key] = toFirestoreFieldValue(value);
    });
    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_CONFIG.apiKey}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const payload = await response.json();
    if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `Failed to set ${collection}/${docId}`);
    return payload;
}

window.MargaHrWorkLocations = {
    maxMetersForType,
    clampAllowedMeters,
    distanceMeters,
    validateTimeIn
};
