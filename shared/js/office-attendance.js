/**
 * Shared office/production attendance for dashboard users.
 * Writes to tbl_field_attendance so payroll has one attendance source.
 */
(function () {
    const ATTENDANCE_COLLECTION = 'tbl_field_attendance';
    const WORK_LOCATIONS_COLLECTION = 'marga_hr_work_locations';
    const ZERO_DATETIME = '0000-00-00 00:00:00';
    const EMPTY_DATES = new Set(['', ZERO_DATETIME, 'null', 'undefined', 'invalid date']);
    const REGULAR_START = '08:00';
    const REGULAR_END = '18:00';
    const GRACE_MINUTES = 15;
    const WORKDAY_LABEL = 'weekday_8am_6pm_no_saturday';
    const ALLOWED_LOCATION_TYPES = new Set(['office', 'production']);
    const OFFICE_ATTENDANCE_RADIUS_METERS = 100;

    const state = {
        user: null,
        staffId: 0,
        date: '',
        docId: '',
        attendance: null,
        locations: []
    };

    function localDateYmd(date = new Date()) {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function nowDbDateTime() {
        const date = new Date();
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const mi = String(date.getMinutes()).padStart(2, '0');
        const ss = String(date.getSeconds()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
    }

    function normalizeDateTime(value) {
        const text = String(value || '').trim();
        const normalized = text.replace('T', ' ').toLowerCase();
        if (EMPTY_DATES.has(normalized)) return '';
        if (normalized.startsWith('null ') || normalized.startsWith('undefined ')) return '';
        return text;
    }

    function formatTime(value) {
        const normalized = normalizeDateTime(value);
        if (!normalized) return '--:--';
        const time = normalized.replace('T', ' ').slice(11, 16);
        const [hour, minute] = time.split(':').map((part) => Number(part));
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time || '--:--';
        const suffix = hour >= 12 ? 'PM' : 'AM';
        return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
    }

    function attendanceDocId(staffId, date) {
        return `${Number(staffId || 0) || 0}_${String(date || '').replace(/[^0-9]/g, '')}`;
    }

    function getStaffId(user) {
        const candidates = [user?.staff_id, user?.staffId, user?.employee_id, user?.employeeId, user?.id];
        for (const candidate of candidates) {
            const numeric = Number(candidate);
            if (Number.isFinite(numeric) && numeric > 0) return numeric;
        }
        return 0;
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
        if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreFieldValue) } };
        if (typeof value === 'boolean') return { booleanValue: value };
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
        }
        if (value && typeof value === 'object') {
            const fields = {};
            Object.entries(value).forEach(([key, child]) => {
                if (child !== undefined && typeof child !== 'function') fields[key] = toFirestoreFieldValue(child);
            });
            return { mapValue: { fields } };
        }
        return { stringValue: String(value ?? '') };
    }

    async function fetchDoc(collection, docId) {
        const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}/${docId}?key=${FIREBASE_CONFIG.apiKey}`);
        const payload = await response.json();
        if (!response.ok || payload?.error) return null;
        return parseFirestoreDoc(payload);
    }

    async function patchDoc(collection, docId, fields) {
        const keys = Object.keys(fields).filter((key) => fields[key] !== undefined);
        if (!keys.length) return null;
        const mask = keys.map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&');
        const body = { fields: {} };
        keys.forEach((key) => {
            body.fields[key] = toFirestoreFieldValue(fields[key]);
        });
        const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}/${docId}?key=${FIREBASE_CONFIG.apiKey}&${mask}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const payload = await response.json();
        if (!response.ok || payload?.error) throw new Error(payload?.error?.message || 'Attendance save failed.');
        return parseFirestoreDoc(payload);
    }

    function distanceMeters(aLat, aLng, bLat, bLng) {
        const radius = 6371000;
        const toRad = (value) => (value * Math.PI) / 180;
        const dLat = toRad(bLat - aLat);
        const dLng = toRad(bLng - aLng);
        const lat1 = toRad(aLat);
        const lat2 = toRad(bLat);
        const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        return radius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
    }

    function getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('GPS location is not available on this device/browser.'));
                return;
            }
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 0
            });
        });
    }

    function numberFrom(...values) {
        for (const value of values) {
            if (value === null || value === undefined || String(value).trim() === '') continue;
            const numeric = Number(value);
            if (Number.isFinite(numeric)) return numeric;
        }
        return null;
    }

    function locationName(location) {
        return String(location?.name || location?.location_name || location?.label || location?._docId || 'Work location').trim();
    }

    function locationType(location) {
        return String(location?.type || location?.location_type || '').trim().toLowerCase();
    }

    function isActiveLocation(location) {
        if (!location) return false;
        if (location.active === false || location.isActive === false || location.is_active === false) return false;
        return true;
    }

    function locationCoordinates(location) {
        const latitude = numberFrom(location?.latitude, location?.lat);
        const longitude = numberFrom(location?.longitude, location?.lng, location?.lon);
        if (latitude === null || longitude === null) return null;
        return { latitude, longitude };
    }

    function locationAllowedMeters() {
        return OFFICE_ATTENDANCE_RADIUS_METERS;
    }

    function isRegularWorkday(dateText = state.date) {
        const date = new Date(`${dateText || localDateYmd()}T12:00:00`);
        const day = date.getDay();
        return day >= 1 && day <= 5;
    }

    function minutesLate(dateText, timeIn) {
        const normalized = normalizeDateTime(timeIn);
        if (!normalized) return 0;
        const actual = new Date(normalized.replace(' ', 'T'));
        const grace = new Date(`${dateText}T${REGULAR_START}:00`);
        grace.setMinutes(grace.getMinutes() + GRACE_MINUTES);
        if (Number.isNaN(actual.getTime())) return 0;
        return Math.max(0, Math.ceil((actual.getTime() - grace.getTime()) / 60000));
    }

    function minutesEarlyOut(dateText, timeOut) {
        const normalized = normalizeDateTime(timeOut);
        if (!normalized) return 0;
        const actual = new Date(normalized.replace(' ', 'T'));
        const end = new Date(`${dateText}T${REGULAR_END}:00`);
        if (Number.isNaN(actual.getTime())) return 0;
        return Math.max(0, Math.ceil((end.getTime() - actual.getTime()) / 60000));
    }

    function getElements() {
        return {
            root: document.querySelector('[data-office-attendance]'),
            status: document.querySelector('[data-office-attendance-status]'),
            timeIn: document.querySelector('[data-office-attendance-time-in]'),
            timeOut: document.querySelector('[data-office-attendance-time-out]'),
            timeInButton: document.querySelector('[data-office-attendance-action="in"]'),
            timeOutButton: document.querySelector('[data-office-attendance-action="out"]')
        };
    }

    function setStatus(text, tone = 'idle') {
        const { root, status } = getElements();
        if (root) root.dataset.attendanceTone = tone;
        if (status) status.textContent = text;
    }

    function render() {
        const { timeIn, timeOut, timeInButton, timeOutButton } = getElements();
        if (!timeIn || !timeOut || !timeInButton || !timeOutButton) return;
        const attendance = state.attendance || {};
        const hasTimeIn = Boolean(normalizeDateTime(attendance.time_in));
        const hasTimeOut = Boolean(normalizeDateTime(attendance.time_out));
        timeIn.textContent = formatTime(attendance.time_in);
        timeOut.textContent = formatTime(attendance.time_out);
        timeInButton.disabled = !state.staffId || hasTimeIn;
        timeOutButton.disabled = !state.staffId || !hasTimeIn || hasTimeOut;

        if (!state.staffId) {
            setStatus('No staff ID on this login.', 'blocked');
        } else if (!state.locations.length) {
            setStatus('No active office or production pin found.', 'blocked');
        } else if (!isRegularWorkday()) {
            setStatus('Non-regular workday. Regular payroll schedule is Monday-Friday, 8 AM-6 PM.', 'idle');
        } else if (!hasTimeIn) {
            setStatus(`Ready for office/production Time In. Must be within ${OFFICE_ATTENDANCE_RADIUS_METERS}m of a saved work-location pin.`, 'idle');
        } else if (!hasTimeOut) {
            setStatus('Timed in. Time Out before leaving.', 'live');
        } else {
            setStatus('Attendance complete for today.', 'done');
        }
    }

    async function loadLocations() {
        const rows = await MargaUtils.fetchCollection(WORK_LOCATIONS_COLLECTION, 200).catch(() => []);
        state.locations = rows
            .filter((location) => isActiveLocation(location) && ALLOWED_LOCATION_TYPES.has(locationType(location)))
            .filter((location) => locationCoordinates(location));
    }

    async function loadAttendance() {
        if (!state.staffId) return;
        state.docId = attendanceDocId(state.staffId, state.date);
        const doc = await fetchDoc(ATTENDANCE_COLLECTION, state.docId).catch(() => null);
        state.attendance = doc || {
            id: state.docId,
            staff_id: state.staffId,
            staff_name: state.user?.name || '',
            attendance_date: state.date,
            time_in: ZERO_DATETIME,
            time_out: ZERO_DATETIME
        };
    }

    async function matchWorkLocation() {
        if (!state.locations.length) throw new Error('No active office or production location pin is available. Open Human Resource > Work Locations and save the office/production pin first.');
        const position = await getCurrentPosition();
        const latitude = Number(position.coords.latitude);
        const longitude = Number(position.coords.longitude);
        const accuracy = Number(position.coords.accuracy || 0);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('GPS returned an invalid location.');

        const ranked = state.locations
            .map((location) => {
                const coords = locationCoordinates(location);
                return {
                    location,
                    latitude,
                    longitude,
                    accuracy,
                    distance: distanceMeters(latitude, longitude, coords.latitude, coords.longitude),
                    allowedMeters: locationAllowedMeters(location)
                };
            })
            .sort((a, b) => a.distance - b.distance);
        const nearest = ranked[0];
        if (!nearest || nearest.distance > nearest.allowedMeters) {
            const label = nearest ? `${Math.round(nearest.distance)}m from ${locationName(nearest.location)}` : 'No pinned work location nearby';
            throw new Error(`${label}. Office/production attendance requires ${OFFICE_ATTENDANCE_RADIUS_METERS}m maximum. Move closer to the saved office/production pin, turn on browser location permission, then try again. If the pin is wrong, update it in Human Resource > Work Locations.`);
        }
        return nearest;
    }

    function buildLocationFields(prefix, match, nowIso) {
        const location = match.location;
        return {
            [`${prefix}_latitude`]: match.latitude.toFixed(7),
            [`${prefix}_longitude`]: match.longitude.toFixed(7),
            [`${prefix}_accuracy_meters`]: Math.round(match.accuracy),
            [`${prefix}_distance_meters`]: Math.round(match.distance),
            [`${prefix}_allowed_meters`]: OFFICE_ATTENDANCE_RADIUS_METERS,
            [`${prefix}_company_id`]: 0,
            [`${prefix}_branch_id`]: 0,
            [`${prefix}_company_name`]: locationName(location),
            [`${prefix}_branch_name`]: locationType(location),
            [`${prefix}_work_location_id`]: String(location._docId || location.id || ''),
            [`${prefix}_work_location_name`]: locationName(location),
            [`${prefix}_work_location_type`]: locationType(location),
            [`${prefix}_address`]: String(location.address || location.location_address || ''),
            [`${prefix}_location_status`]: 'matched_work_location',
            [`${prefix}_location_checked_at`]: nowIso
        };
    }

    async function mark(direction) {
        const isOut = direction === 'out';
        const button = document.querySelector(`[data-office-attendance-action="${isOut ? 'out' : 'in'}"]`);
        if (!state.staffId || !state.date) return;
        const fieldName = isOut ? 'time_out' : 'time_in';
        if (normalizeDateTime(state.attendance?.[fieldName])) return;
        if (isOut && !normalizeDateTime(state.attendance?.time_in)) {
            alert('Please Time In first before Time Out.');
            return;
        }

        if (button) button.disabled = true;
        setStatus(isOut ? 'Checking office/production location for Time Out...' : 'Checking office/production location for Time In...', 'live');
        try {
            const nowIso = new Date().toISOString();
            const nowDb = nowDbDateTime();
            const match = await matchWorkLocation();
            const previous = state.attendance || {};
            const patch = {
                id: state.docId,
                staff_id: state.staffId,
                staff_name: state.user?.name || previous.staff_name || '',
                attendance_date: state.date,
                time_in: isOut ? (normalizeDateTime(previous.time_in) || ZERO_DATETIME) : nowDb,
                time_out: isOut ? nowDb : (normalizeDateTime(previous.time_out) || ZERO_DATETIME),
                source: previous.source || 'dashboard_office_attendance',
                attendance_mode: previous.attendance_mode || 'office_production',
                attendance_location_required: true,
                attendance_location_policy: `office_production_${OFFICE_ATTENDANCE_RADIUS_METERS}m`,
                attendance_location_radius_meters: OFFICE_ATTENDANCE_RADIUS_METERS,
                regular_schedule_code: WORKDAY_LABEL,
                regular_workday: isRegularWorkday(state.date),
                scheduled_start_time: REGULAR_START,
                scheduled_end_time: REGULAR_END,
                no_saturday_regular_work: true,
                created_at: previous.created_at || nowIso,
                updated_at: nowIso,
                updated_by: state.staffId
            };
            Object.assign(patch, buildLocationFields(isOut ? 'time_out' : 'time_in', match, nowIso));
            if (!isOut) {
                patch.time_in_timeliness_status = minutesLate(state.date, patch.time_in) ? 'late' : 'on_time';
                patch.time_in_late_minutes = minutesLate(state.date, patch.time_in);
            } else {
                patch.time_out_early_minutes = minutesEarlyOut(state.date, patch.time_out);
            }
            await patchDoc(ATTENDANCE_COLLECTION, state.docId, patch);
            state.attendance = { ...previous, ...patch };
            render();
            alert(`${isOut ? 'Time Out' : 'Time In'} saved at ${locationName(match.location)}.`);
        } catch (error) {
            console.error('Office attendance failed:', error);
            const message = error?.message || 'Unable to save office attendance.';
            alert(message);
            render();
            setStatus(message, 'blocked');
        }
    }

    async function init() {
        const root = document.querySelector('[data-office-attendance]');
        if (!root || !window.MargaAuth || !window.MargaUtils || !window.FIREBASE_CONFIG) return;
        state.user = MargaAuth.getUser();
        state.staffId = getStaffId(state.user);
        state.date = localDateYmd();
        render();
        document.querySelector('[data-office-attendance-action="in"]')?.addEventListener('click', () => mark('in'));
        document.querySelector('[data-office-attendance-action="out"]')?.addEventListener('click', () => mark('out'));
        await Promise.all([loadLocations(), loadAttendance()]);
        render();
    }

    document.addEventListener('DOMContentLoaded', () => {
        init().catch((error) => {
            console.error('Office attendance init failed:', error);
            setStatus('Attendance is temporarily unavailable.', 'blocked');
        });
    });
}());
