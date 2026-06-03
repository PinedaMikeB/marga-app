if (!MargaAuth.requireAccess('field')) {
    throw new Error('Unauthorized access to field module.');
}

const FIELD_QUERY_LIMIT = 5000;
const FIELD_CARRYOVER_DAYS = 45;
const REQUIRED_PRIORITY_COUNT = 5;
const ATTENDANCE_LOCATION_RADIUS_METERS = 200;
const FIELD_ATTENDANCE_START_TIME = '08:00';
const FIELD_ATTENDANCE_GRACE_MINUTES = 15;
const FIELD_BRANCH_LOCATION_QUERY_LIMIT = 7000;
const FIELD_WORK_LOCATION_TYPES = new Set(['office', 'production']);
const PARTS_CATALOG_QUERY_LIMIT = 12000;
const DELIVERY_RECEIPT_LINE_LIMIT = 100;
const ZERO_DATETIME = '0000-00-00 00:00:00';
const LEGACY_EMPTY_DATETIME_VALUES = new Set([
    '',
    ZERO_DATETIME,
    'undefined',
    'undefined 00:00:00',
    'null',
    'null 00:00:00',
    'invalid date',
    'nan'
]);
const ROUTE_COLLECTION_PRIMARY = 'tbl_printedscheds';
const ROUTE_COLLECTION_FALLBACK = 'tbl_savedscheds';
const SCHEDULE_PLANNER_COLLECTION = 'tbl_schedule_planner';
const SERIAL_CORRECTION_COLLECTION = 'tbl_serial_corrections';
const PRODUCTION_QUEUE_COLLECTION = 'tbl_production_queue';
const FIELD_VISIT_EVENT_COLLECTION = 'tbl_field_visit_events';
const FIELD_ATTENDANCE_COLLECTION = 'tbl_field_attendance';
const FIELD_LOCATION_REQUEST_COLLECTION = 'tbl_field_location_requests';
const FIELD_CALL_COLLECTION = 'tbl_field_call_requests';
const CLOSE_REQUEST_COLLECTION = 'tbl_schedule_close_requests';
const WORK_LOCATIONS_COLLECTION = 'marga_hr_work_locations';
const LOCATION_PHOTO_COLLECTION = 'tbl_location_frontage_photos';
const PETTY_CASH_ENTRY_COLLECTION = 'tbl_pettycash_entries';
const PETTY_CASH_REQUEST_COLLECTION = 'tbl_pettycash_requests';
const PETTY_CASH_AUDIT_COLLECTION = 'tbl_pettycash_audit_logs';
const MODEL_ERROR_GUIDE_COLLECTION = 'marga_model_error_guides';
const SOLUTION_REQUEST_COLLECTION = 'tbl_field_solution_requests';
const CUSTOMER_REVIEW_COLLECTION = 'marga_care_customer_reviews';
const LOCATION_PIN_CLOSE_BYPASS_DATES = new Set(['2026-05-04', '2026-05-05']);
const TEMPORARILY_DISABLED_FIELD_GROUPS = {
    missingSerial: true,
    modelBrand: true,
    machineStatus: true,
    serialMapping: true,
    customerPin: true
};

const PURPOSE_LABELS = {
    1: 'Billing',
    2: 'Collection',
    3: 'Deliver Ink / Toner',
    4: 'Deliver Cartridge',
    5: 'Service',
    6: 'Sales',
    7: 'Purchasing',
    8: 'Reading',
    9: 'Others'
};

const BILLING_PURPOSE_ID = 1;
const COLLECTION_PURPOSE_ID = 2;
const DELIVERY_PURPOSE_IDS = new Set([3, 4]);
const SERVICE_PURPOSE_ID = 5;
const READING_PURPOSE_ID = 8;
const FIELD_SELF_ADD_SCHEDULE_PURPOSE_IDS = [SERVICE_PURPOSE_ID, 3, 4, BILLING_PURPOSE_ID, COLLECTION_PURPOSE_ID, READING_PURPOSE_ID, 9];
const FIELD_FINISH_BLOCK_COLLECTION = 'tbl_field_finish_blocks';
const FIELD_CALL_DOMAIN = 'call.wotgonline.com';
const FIELD_CALL_PUBLIC_DOMAIN = 'meet.jit.si';
const FIELD_CALL_ALLOW_PUBLIC_FALLBACK = false;
const FIELD_CALL_POLL_MS = 7000;
const FIELD_CALL_RING_TIMEOUT_MS = 120000;
const FIELD_CALL_SCRIPT_TIMEOUT_MS = 4500;
const FIELD_MODAL_DRAFT_KEY_PREFIX = 'marga_field_modal_draft_v1';
const FIELD_REIMBURSEMENT_DRAFT_KEY_PREFIX = 'marga_field_reimbursement_draft_v1';
const FIELD_MODAL_DRAFT_INPUT_IDS = [
    'fieldCloseNotes',
    'fieldSolutionNotes',
    'fieldWorkMachineStatus',
    'fieldClosePin',
    'fieldSerialInput',
    'fieldSerialMissingCheck',
    'fieldMissingSerialInput',
    'fieldPartInput',
    'fieldPartQty',
    'fieldDeliveryDetails',
    'fieldEmptyPickupDetails',
    'fieldDeliveryPreviousMeter',
    'fieldDeliveryPresentMeter',
    'fieldCustomerSigner',
    'fieldCustomerContact',
    'fieldFinalSummary',
    'fieldBillingReceivedBy',
    'fieldCollectionInvoiceSearch',
    'fieldCollectionCheckNumber',
    'fieldCollectionCheckBank',
    'fieldCollectionCheckDate',
    'fieldCollectionCheckAmount',
    'fieldCollectionAmount',
    'fieldCollectionPaymentDate',
    'fieldCollectionDepositDate',
    'fieldCollectionOrNumber',
    'fieldCollectionPaymentType',
    'fieldCollectionPaymentStatus',
    'fieldCollectionDeductionType',
    'fieldCollectionDeductionAmount',
    'fieldCollection2307Status',
    'fieldCollectionPaymentRemarks',
    'fieldPreviousMeter',
    'fieldPresentMeter',
    'fieldMaintenancePreviousMeter',
    'fieldMaintenancePresentMeter',
    'fieldTimeIn',
    'fieldTimeOut'
];
const FIELD_MODAL_DRAFT_FILE_IDS = [
    'fieldBeforePhoto',
    'fieldAfterPhoto',
    'fieldCollectionVoucherImage',
    'fieldCollectionCheckImage',
    'fieldLocationPhoto'
];

const FIELD_REIMBURSEMENT_REQUEST_TYPES = [
    'Reimbursement',
    'Cash Advance',
    'Liquidation',
    'Return of Excess Cash',
    'Correction / Additional Receipt'
];

const FIELD_REIMBURSEMENT_PERSISTED_INPUT_IDS = [
    'fieldReimbursementId',
    'fieldReimbursementExpenseDate',
    'fieldReimbursementAdvanceAmount',
    'fieldReimbursementDescription',
    'fieldReimbursementPaymentMethod',
    'fieldReimbursementGcash',
    'fieldReimbursementBankName',
    'fieldReimbursementBankAccountName',
    'fieldReimbursementBankAccountNumber',
    'fieldReimbursementNotes'
];

const FIELD_REIMBURSEMENT_CATEGORIES = [
    'Gasoline / fuel',
    'Meal allowance',
    'Toll',
    'Parking',
    'Transportation / fare',
    'Parts / supplies',
    'Delivery / courier',
    'Emergency purchase',
    'Other'
];

const FIELD_REIMBURSEMENT_ITEM_GROUPS = [
    { id: 'fuel', label: 'Fuel / Gasoline', accountId: 'fuel_expense_motorcycle', category: 'Gasoline / fuel' },
    { id: 'meal', label: 'Meal Allowance', accountId: 'meal_allowance_expense_field_operations', category: 'Meal allowance' },
    { id: 'toll', label: 'Toll', accountId: 'commute_fare_expense', category: 'Toll' },
    { id: 'parking', label: 'Parking', accountId: 'parking_expense', category: 'Parking' },
    { id: 'fare', label: 'Transportation / Fare', accountId: 'commute_fare_expense', category: 'Transportation / fare' },
    { id: 'parts', label: 'Emergency Parts / Supplies', accountId: 'printer_repair_parts_field_expense', category: 'Parts / supplies' },
    { id: 'delivery', label: 'Delivery / Courier', accountId: 'commute_fare_expense', category: 'Delivery / courier' },
    { id: 'emergency', label: 'Emergency Purchase', accountId: 'other_materials_expense', category: 'Emergency purchase' },
    { id: 'other', label: 'Other Field Expense', accountId: 'other_materials_expense', category: 'Other' }
];

const FIELD_REIMBURSEMENT_ACCOUNT_OPTIONS = [
    { id: 'fuel_expense_motorcycle', label: 'Fuel Expense - Motorcycle' },
    { id: 'fuel_expense_delivery_van', label: 'Fuel Expense - Delivery Van' },
    { id: 'meal_allowance_expense_field_operations', label: 'Meal Allowance Expense - Field Operations' },
    { id: 'parking_expense', label: 'Parking Expense' },
    { id: 'commute_fare_expense', label: 'Transportation / Fare / Toll' },
    { id: 'printer_repair_parts_field_expense', label: 'Printer Repair Parts Expense - Field Service' },
    { id: 'other_materials_expense', label: 'Other Materials / Emergency Purchase' }
];

const FIELD_REIMBURSEMENT_TABS = [
    { id: 'Draft', label: 'Draft', statuses: ['Draft'] },
    { id: 'Submitted', label: 'Submitted', statuses: ['Submitted', 'For Completeness Check', 'Verified by Petty Cash Handler', 'For Approval', 'Included in Payout Batch', 'Funded'] },
    { id: 'For Correction', label: 'For Correction', statuses: ['Incomplete / Needs Correction'] },
    { id: 'Approved', label: 'Approved', statuses: ['Approved'] },
    { id: 'Paid', label: 'Paid', statuses: ['Paid / Released'] },
    { id: 'For Liquidation', label: 'For Liquidation', statuses: ['For Liquidation', 'Partially Liquidated'] },
    { id: 'Liquidated', label: 'Liquidated', statuses: ['Liquidated', 'Closed'] },
    { id: 'Rejected', label: 'Rejected', statuses: ['Rejected', 'Failed Payment'] }
];

const FIELD_REIMBURSEMENT_EDITABLE_STATUSES = new Set(['Draft', 'Incomplete / Needs Correction', 'For Liquidation', 'Partially Liquidated']);

const FALLBACK_MACHINE_STATUSES = [
    { id: 1, label: 'Running / Print OK' },
    { id: 2, label: 'Running / Print Problem' },
    { id: 3, label: 'Down / No Print' },
    { id: 4, label: 'Running / Best Mode Only' }
];

const caches = {
    trouble: new Map(),
    branch: new Map(),
    company: new Map(),
    area: new Map(),
    machine: new Map(),
    model: new Map(),
    brand: new Map(),
    serialCatalogLoaded: false,
    serialCatalog: [],
    serialByUpper: new Map(),
    machineStatusesLoaded: false,
    machineStatuses: [],
    partsCatalogLoaded: false,
    partsCatalog: [],
    partsByKey: new Map(),
    branchContacts: new Map(),
    deliveryInfoByBranch: new Map(),
    deliveryReceiptBySchedule: new Map(),
    deliveryReceiptItemsBySchedule: new Map()
};

const state = {
    selectedDate: '',
    activeView: 'home',
    activeTab: 'today',
    statusFilter: 'all',
    searchQuery: '',
    guideSearchQuery: '',
    guideBrandQuery: '',
    guideModelQuery: '',
    guideErrorQuery: '',
    guideAutoFilled: false,
    staffId: null,
    routeSourceLabel: 'Printed',
    routeLoad: {
        active: false,
        label: 'Loading route...',
        percent: 0,
        status: 'loading'
    },
    todayRows: [],
    carryoverRows: [],
    rows: [],
    modalScheduleId: null,
    modalRelatedScheduleIds: [],
    combinedTaskGroups: new Map(),
    guideReturnScheduleId: null,
    modalMachineId: null,
    modalBranchId: null,
    modalExpectedPin: '',
    modalStatusKey: 'pending',
    modalSchedtimeDocId: null,
    modalSchedtimeId: null,
    modalPartsNeeded: [],
    modalCollectionInvoices: [],
    modalCollectionInvoiceSearchResults: [],
    modalCollectionInvoiceSearchRequest: '',
    modalReadOnly: false,
    modalBranchLocationPinned: false,
    modalDraftRestored: false,
    modalDraftRestoreInProgress: false,
    suppressModalDraftSave: false,
    attendanceDocId: '',
    attendance: null,
    attendanceLocationCheckScheduleId: null,
    attendanceNearbyScheduleMatch: null,
    fieldWorkLocations: [],
    fieldWorkLocationsLoaded: false,
    pinnedCustomerBranches: [],
    pinnedCustomerBranchesLoaded: false,
    callPollTimer: null,
    activeIncomingCallId: '',
    activeCallDocId: '',
    activeCallApi: null,
    activeCallRoomUrl: '',
    activeCallDomain: FIELD_CALL_DOMAIN,
    activeCallMode: 'voice',
    locationRequestPollTimer: null,
    handledLocationRequestIds: new Set(),
    jitsiScriptPromise: null,
    ringTone: null,
    priorityGate: {
        required: 0,
        numbered: 0,
        ready: true
    },
    pettyCashEntries: [],
    reimbursementRequests: [],
    reimbursementLoaded: false,
    reimbursementActiveTab: 'Draft',
    editingReimbursementId: '',
    reimbursementMode: 'Reimbursement',
    reimbursementItems: [],
    reimbursementDraftItem: null,
    customerReviews: [],
    skillHistoryRows: [],
    modelErrorGuides: [],
    modelErrorGuidesLoaded: false,
    solutionRequests: [],
    solutionRequestsLoaded: false,
    closeRequestsBySchedule: new Map()
};

document.addEventListener('DOMContentLoaded', () => {
    const user = MargaAuth.getUser();
    state.staffId = Number(user?.staff_id || 0) || null;
    if (!state.staffId) {
        alert('This account has no active tbl_employee ID mapped.');
    }
    const displayName = String(user?.name || user?.username || user?.email || 'User').trim();
    const displayRole = MargaAuth.getDisplayRoles(user);
    const badge = document.getElementById('fieldUserBadge');
    const headerTitle = document.getElementById('fieldHeaderTitle');
    const userLine = document.getElementById('fieldUserLine');
    if (badge) badge.textContent = (displayName.charAt(0) || 'U').toUpperCase();
    if (headerTitle) headerTitle.textContent = `${displayName} - Printed Route`;
    if (userLine) userLine.textContent = displayRole ? `Roles: ${displayRole}` : 'Roles: field';
    applyTeamLeaderVisibility();

    const dateInput = document.getElementById('fieldDate');
    dateInput.value = formatDateYmd(new Date());
    const pendingModalDraft = getStoredFieldModalDraft();
    if (pendingModalDraft?.selectedDate) {
        dateInput.value = pendingModalDraft.selectedDate;
        state.activeView = 'tasks';
        state.activeTab = pendingModalDraft.activeTab || 'today';
        state.statusFilter = pendingModalDraft.statusFilter || 'all';
    }

    document.getElementById('fieldRefresh').addEventListener('click', () => loadMySchedule({ keepTab: true }));
    document.getElementById('fieldAttendanceTimeInBtn')?.addEventListener('click', () => markAttendanceTime('in'));
    document.getElementById('fieldAttendanceTimeOutBtn')?.addEventListener('click', () => markAttendanceTime('out'));
    document.getElementById('fieldCheckLocationBtn')?.addEventListener('click', checkAttendanceLocation);
    document.getElementById('fieldOpenLocationTaskBtn')?.addEventListener('click', openAttendanceLocationTask);
    document.getElementById('fieldAddNearbyScheduleBtn')?.addEventListener('click', openAddNearbySchedulePanel);
    document.getElementById('fieldAddScheduleCancelBtn')?.addEventListener('click', closeAddNearbySchedulePanel);
    document.getElementById('fieldAddSchedulePanel')?.addEventListener('submit', (event) => {
        event.preventDefault();
        saveNearbyAttendanceSchedule();
    });
    populateAddSchedulePurposeOptions();
    document.getElementById('fieldVoiceOfficeBtn')?.addEventListener('click', () => startFieldRoleCall('csr', 'voice'));
    document.getElementById('fieldVideoOfficeBtn')?.addEventListener('click', () => startFieldRoleCall('csr', 'video'));
    document.getElementById('fieldVoiceTechLeaderBtn')?.addEventListener('click', () => startFieldRoleCall('tech_leader', 'voice'));
    document.getElementById('fieldVideoTechLeaderBtn')?.addEventListener('click', () => startFieldRoleCall('tech_leader', 'video'));
    document.getElementById('fieldJoinMeetingBtn')?.addEventListener('click', () => joinDailyFieldMeeting('video'));
    document.getElementById('fieldDirectVoiceBtn')?.addEventListener('click', () => startFieldDirectCall('voice'));
    document.getElementById('fieldDirectVideoBtn')?.addEventListener('click', () => startFieldDirectCall('video'));
    document.querySelectorAll('.field-tab[data-tab]').forEach((button) => {
        button.addEventListener('click', () => setActiveTab(button.dataset.tab || 'today'));
    });
    document.querySelectorAll('.field-view-tab[data-view]').forEach((button) => {
        button.addEventListener('click', () => setActiveView(button.dataset.view || 'home'));
    });
    document.getElementById('fieldAnalyticsRefresh')?.addEventListener('click', () => loadFieldAnalytics());
    document.getElementById('fieldReimbursementRefresh')?.addEventListener('click', () => loadReimbursementRequests({ force: true }));
    document.getElementById('fieldNewReimbursementBtn')?.addEventListener('click', () => openReimbursementForm());
    document.getElementById('fieldReimbursementCancel')?.addEventListener('click', closeReimbursementForm);
    document.getElementById('fieldReimbursementSaveDraft')?.addEventListener('click', () => saveReimbursementRequest('Draft'));
    document.getElementById('fieldReimbursementForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        saveReimbursementRequest('Submitted');
    });
    document.getElementById('fieldReimbursementForm')?.addEventListener('input', queueReimbursementDraftSave);
    document.getElementById('fieldReimbursementForm')?.addEventListener('change', queueReimbursementDraftSave);
    document.getElementById('fieldReimbursementStatusTabs')?.addEventListener('click', (event) => {
        const tab = event.target.closest('[data-reimbursement-tab]');
        if (!tab) return;
        state.reimbursementActiveTab = tab.dataset.reimbursementTab || 'Draft';
        renderReimbursementRequests();
    });
    document.getElementById('fieldReimbursementList')?.addEventListener('click', handleReimbursementListAction);
    document.querySelectorAll('[data-reimbursement-mode]').forEach((button) => {
        button.addEventListener('click', () => {
            setReimbursementMode(button.dataset.reimbursementMode || 'Reimbursement');
            queueReimbursementDraftSave();
        });
    });
    document.getElementById('fieldReimbursementAddItemBtn')?.addEventListener('click', () => addReimbursementItemRow());
    document.getElementById('fieldReimbursementItemEntry')?.addEventListener('input', handleReimbursementDraftInput);
    document.getElementById('fieldReimbursementItemEntry')?.addEventListener('change', handleReimbursementDraftChange);
    document.getElementById('fieldReimbursementItemEntry')?.addEventListener('click', handleReimbursementDraftClick);
    document.getElementById('fieldReimbursementItemList')?.addEventListener('change', handleReimbursementItemsChange);
    document.getElementById('fieldReimbursementItemList')?.addEventListener('click', handleReimbursementItemsClick);
    document.getElementById('fieldReimbursementVisitedToggle')?.addEventListener('click', toggleReimbursementVisitedDetails);
    document.getElementById('fieldReimbursementAdvanceAmount')?.addEventListener('input', syncReimbursementLiquidationMath);
    document.getElementById('fieldGuideRefresh')?.addEventListener('click', () => loadModelErrorGuides({ force: true }));
    document.getElementById('fieldSolutionRequestsRefresh')?.addEventListener('click', () => loadSolutionRequests({ force: true }));
    document.getElementById('fieldSolutionRequestsList')?.addEventListener('click', handleSolutionRequestAction);
    document.getElementById('fieldList')?.addEventListener('click', (event) => {
        const button = event.target?.closest?.('button[data-action="request-close"]');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        handleRequestCloseButton(button);
    });
    document.getElementById('fieldOpenGuideBtn')?.addEventListener('click', openGuideForCurrentTask);
    document.getElementById('fieldGuideBackBtn')?.addEventListener('click', returnToUpdateFromGuide);
    document.getElementById('fieldSubmitSolutionBtn')?.addEventListener('click', submitSolutionRequest);
    [
        ['fieldGuideSearch', 'guideSearchQuery'],
        ['fieldGuideBrand', 'guideBrandQuery'],
        ['fieldGuideModel', 'guideModelQuery'],
        ['fieldGuideError', 'guideErrorQuery']
    ].forEach(([id, stateKey]) => {
        document.getElementById(id)?.addEventListener('input', (event) => {
            state[stateKey] = String(event.target.value || '');
            renderTroubleshootingGuide();
        });
    });
    document.getElementById('fieldStatusFilter').addEventListener('change', () => {
        state.statusFilter = document.getElementById('fieldStatusFilter').value;
        renderActiveView();
    });
    document.getElementById('fieldCustomerSearch')?.addEventListener('input', (event) => {
        state.searchQuery = String(event.target.value || '');
        renderActiveView();
    });
    document.getElementById('fieldKpis')?.addEventListener('click', (event) => {
        const viewJump = event.target.closest('[data-view-jump]');
        if (viewJump) {
            setActiveView(viewJump.dataset.viewJump || 'tasks');
            if (state.activeTab === 'closed') setActiveTab('today');
            return;
        }
        const tabJump = event.target.closest('[data-tab-jump]');
        if (tabJump) {
            setActiveView('tasks');
            setActiveTab(tabJump.dataset.tabJump || 'today');
            return;
        }
        const closedJump = event.target.closest('[data-closed-today]');
        if (closedJump) {
            setActiveView('tasks');
            setActiveTab('closed');
            return;
        }
        const card = event.target.closest('[data-status-filter]');
        if (!card) return;
        setActiveView('tasks');
        state.statusFilter = card.dataset.statusFilter || 'all';
        const statusFilter = document.getElementById('fieldStatusFilter');
        if (statusFilter) statusFilter.value = state.statusFilter;
        renderActiveView();
    });
    dateInput.addEventListener('change', () => loadMySchedule());
    document.getElementById('fieldLogout').addEventListener('click', () => MargaAuth.logout());

    document.getElementById('fieldOverlay').addEventListener('click', closeModal);
    document.getElementById('fieldModalClose').addEventListener('click', closeModal);
    document.getElementById('fieldModalCancel').addEventListener('click', closeModal);
    document.getElementById('fieldModalSaveDraft').addEventListener('click', saveDraftUpdate);
    document.getElementById('fieldModalPendingTask').addEventListener('click', markPendingTask);
    document.getElementById('fieldModalReopenTask').addEventListener('click', reopenTask);
    document.getElementById('fieldModalCloseTask').addEventListener('click', closeTask);
    document.getElementById('fieldSaveSerialBtn').addEventListener('click', saveSerialMapping);

    document.getElementById('fieldSerialInput').addEventListener('input', handleSerialInputChange);
    document.getElementById('fieldSerialMissingCheck').addEventListener('change', toggleMissingSerialMode);

    document.getElementById('fieldAddPartBtn').addEventListener('click', addPartEntry);
    document.getElementById('fieldPartInput').addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        addPartEntry();
    });
    document.getElementById('fieldPartsList').addEventListener('click', removePartEntry);

    document.getElementById('fieldBeforePhoto').addEventListener('change', () => {
        updatePhotoHint('fieldBeforePhoto', 'fieldBeforePhotoHint', 'field_before_photo_name');
        queueFieldModalDraftSave();
    });
    document.getElementById('fieldAfterPhoto').addEventListener('change', () => {
        updatePhotoHint('fieldAfterPhoto', 'fieldAfterPhotoHint', 'field_after_photo_name');
        queueFieldModalDraftSave();
    });
    document.getElementById('fieldCollectionVoucherImage').addEventListener('change', () => {
        updatePhotoHint('fieldCollectionVoucherImage', 'fieldCollectionVoucherHint', 'field_collection_voucher_name');
        queueFieldModalDraftSave();
    });
    document.getElementById('fieldCollectionCheckImage').addEventListener('change', () => {
        updatePhotoHint('fieldCollectionCheckImage', 'fieldCollectionCheckHint', 'field_collection_check_name');
        queueFieldModalDraftSave();
    });
    document.getElementById('fieldCollectionInvoiceSearch')?.addEventListener('input', runFieldCollectionInvoiceSearch);
    document.getElementById('fieldCollectionInvoiceSearch')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        addFirstFieldCollectionInvoiceMatch();
    });
    document.getElementById('fieldCollectionInvoiceAddBtn')?.addEventListener('click', addFirstFieldCollectionInvoiceMatch);
    document.getElementById('fieldCollectionInvoiceRows')?.addEventListener('click', (event) => {
        const button = event.target?.closest?.('[data-remove-collection-invoice]');
        if (!button) return;
        removeFieldCollectionInvoice(Number(button.dataset.removeCollectionInvoice || -1));
    });
    document.getElementById('fieldModal').addEventListener('click', toggleModalSection);
    document.getElementById('fieldModal').addEventListener('input', () => {
        updateActionButtons();
        queueFieldModalDraftSave();
    });
    document.getElementById('fieldModal').addEventListener('change', () => {
        updateActionButtons();
        queueFieldModalDraftSave();
    });

    document.getElementById('fieldPresentMeter').addEventListener('input', recomputeTotalConsumed);
    document.getElementById('fieldPreviousMeter').addEventListener('input', recomputeTotalConsumed);
    document.getElementById('fieldMaintenancePresentMeter').addEventListener('input', recomputeMaintenanceTotalConsumed);
    document.getElementById('fieldMaintenancePreviousMeter').addEventListener('input', recomputeMaintenanceTotalConsumed);
    document.getElementById('fieldDeliveryPresentMeter')?.addEventListener('input', recomputeDeliveryTotalConsumed);
    document.getElementById('fieldDeliveryPreviousMeter')?.addEventListener('input', recomputeDeliveryTotalConsumed);
    document.getElementById('fieldTimeInNowBtn').addEventListener('click', markTimeInNow);
    document.getElementById('fieldTimeOutNowBtn').addEventListener('click', markTimeOutNow);
    document.getElementById('fieldPinLocationBtn').addEventListener('click', pinCustomerLocation);
    document.getElementById('fieldLocationPhotoBtn')?.addEventListener('click', () => {
        const input = document.getElementById('fieldLocationPhoto');
        if (input && !input.disabled) input.click();
    });
    document.getElementById('fieldLocationPhoto').addEventListener('change', updateLocationPhotoHint);

    applyTemporaryFieldMode();
    resetModalSectionState();
    void loadMachineStatusOptions();
    populateWorkMachineStatusOptions();
    renderAttendanceCard();
    startFieldCallPolling();
    startLocationRequestPoll();
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        handlePendingLocationRefreshRequest().catch((error) => {
            console.warn('Location refresh request check failed:', error);
        });
    });

    loadMySchedule();
});

window.addEventListener('beforeunload', () => {
    saveReimbursementLocalDraft();
});

function isFieldTechTeamLeader() {
    return MargaAuth.hasRole('admin')
        || MargaAuth.hasRole('team-leader-field-technicians')
        || MargaAuth.hasRole('service');
}

function currentFieldDisplayName() {
    const user = MargaAuth.getUser();
    return String(
        user?.name ||
        user?.displayName ||
        user?.username ||
        user?.email ||
        document.getElementById('fieldHeaderTitle')?.textContent?.split(' - ')[0] ||
        'Field Staff'
    ).trim();
}

function currentFieldEmail() {
    const user = MargaAuth.getUser();
    return String(user?.email || '').trim();
}

function currentFieldRoles() {
    return MargaAuth.getRoles(MargaAuth.getUser()).map((role) => String(role || '').trim()).filter(Boolean);
}

function fieldCallRoleMatches(targetRole) {
    const normalized = String(targetRole || '').trim().toLowerCase();
    if (!normalized) return false;
    const roles = currentFieldRoles();
    if (normalized === 'csr') {
        return roles.some((role) => ['csr', 'customer-service', 'customer_service', 'service', 'admin'].includes(role));
    }
    if (normalized === 'tech_leader') {
        return roles.some((role) => ['team-leader-field-technicians', 'service', 'admin'].includes(role));
    }
    if (normalized === 'admin') return roles.includes('admin');
    return roles.includes(normalized);
}

function fieldCallRoleLabel(role) {
    const normalized = String(role || '').trim();
    const labels = {
        csr: 'CSR',
        tech_leader: 'Tech Leader',
        admin: 'Admin',
        field: 'Field Staff'
    };
    return labels[normalized] || MargaAuth.formatRoleLabel(normalized);
}

function fieldCallModeLabel(mode) {
    return String(mode || 'voice') === 'video' ? 'Video call' : 'Voice call';
}

function applyTeamLeaderVisibility() {
    const tab = document.getElementById('fieldSolutionRequestsTab');
    if (tab) tab.hidden = !isFieldTechTeamLeader();
    const directCall = document.getElementById('fieldDirectCallAdmin');
    if (directCall) directCall.hidden = !isFieldTechTeamLeader();
}

function getFieldWrapper(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    return el.closest('.marga-field') || el.closest('.field-modal-section') || el.parentElement;
}

function setFieldGroupVisible(id, isVisible) {
    const wrapper = getFieldWrapper(id);
    if (!wrapper) return;
    wrapper.hidden = !isVisible;
}

function applyTemporaryFieldMode() {
    setFieldGroupVisible('fieldSerialMissingCheck', !TEMPORARILY_DISABLED_FIELD_GROUPS.missingSerial);
    setFieldGroupVisible('fieldModelInput', !TEMPORARILY_DISABLED_FIELD_GROUPS.modelBrand);
    setFieldGroupVisible('fieldBrandInput', !TEMPORARILY_DISABLED_FIELD_GROUPS.modelBrand);
    setFieldGroupVisible('fieldMachineStatus', !TEMPORARILY_DISABLED_FIELD_GROUPS.machineStatus);
    setFieldGroupVisible('fieldSaveSerialBtn', !TEMPORARILY_DISABLED_FIELD_GROUPS.serialMapping);
    setFieldGroupVisible('fieldClosePin', !TEMPORARILY_DISABLED_FIELD_GROUPS.customerPin);

    const serialMissingCheck = document.getElementById('fieldSerialMissingCheck');
    const missingSerialInput = document.getElementById('fieldMissingSerialInput');
    const machineStatus = document.getElementById('fieldMachineStatus');
    const saveSerialBtn = document.getElementById('fieldSaveSerialBtn');
    const pinInput = document.getElementById('fieldClosePin');
    const pinHint = document.getElementById('fieldPinHint');

    if (TEMPORARILY_DISABLED_FIELD_GROUPS.missingSerial) {
        serialMissingCheck.checked = false;
        serialMissingCheck.disabled = true;
        missingSerialInput.value = '';
        missingSerialInput.disabled = true;
    }

    if (TEMPORARILY_DISABLED_FIELD_GROUPS.machineStatus) {
        machineStatus.disabled = true;
        machineStatus.value = '';
    }

    if (TEMPORARILY_DISABLED_FIELD_GROUPS.serialMapping) {
        saveSerialBtn.disabled = true;
    }

    if (TEMPORARILY_DISABLED_FIELD_GROUPS.customerPin) {
        pinInput.value = '';
        pinInput.disabled = true;
        if (pinHint) pinHint.textContent = 'Temporarily disabled. Finish is allowed without PIN.';
    }
}

function setSectionCollapsed(section, isCollapsed) {
    if (!section) return;
    section.classList.toggle('is-collapsed', isCollapsed);
    const toggle = section.querySelector('.field-section-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
}

function resetModalSectionState() {
    document.querySelectorAll('.field-collapsible-section').forEach((section) => {
        const isCollapsed = String(section.dataset.defaultCollapsed || 'false').trim() === 'true';
        setSectionCollapsed(section, isCollapsed);
    });
}

function collapseOtherSections(activeSection) {
    document.querySelectorAll('.field-collapsible-section').forEach((section) => {
        if (section === activeSection) return;
        setSectionCollapsed(section, true);
    });
}

function toggleModalSection(event) {
    const button = event.target.closest('.field-section-toggle');
    if (!button) return;
    if (button.disabled) return;
    const section = button.closest('.field-collapsible-section');
    if (!section) return;
    const willExpand = section.classList.contains('is-collapsed');
    if (willExpand) {
        collapseOtherSections(section);
        setSectionCollapsed(section, false);
        queueFieldModalDraftSave();
        return;
    }
    setSectionCollapsed(section, true);
    queueFieldModalDraftSave();
}

function fieldModalDraftKey() {
    return `${FIELD_MODAL_DRAFT_KEY_PREFIX}:${state.staffId || 'staff'}`;
}

function fieldReimbursementDraftKey() {
    return `${FIELD_REIMBURSEMENT_DRAFT_KEY_PREFIX}:${state.staffId || 'staff'}`;
}

function safeReadJsonStorage(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
        return null;
    }
}

function safeWriteJsonStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.warn('Unable to save local field draft.', error);
        return false;
    }
}

function getStoredFieldModalDraft() {
    const draft = safeReadJsonStorage(fieldModalDraftKey());
    if (!draft || !draft.scheduleId) return null;
    return draft;
}

function clearFieldModalDraft(scheduleId = null) {
    const draft = getStoredFieldModalDraft();
    if (scheduleId && draft && Number(draft.scheduleId || 0) !== Number(scheduleId || 0)) return;
    try {
        localStorage.removeItem(fieldModalDraftKey());
    } catch {
        // Ignore storage failures.
    }
}

let fieldModalDraftTimer = null;

function getExpandedModalSectionIds() {
    return Array.from(document.querySelectorAll('.field-collapsible-section:not(.is-collapsed)'))
        .map((section) => section.id)
        .filter(Boolean);
}

function restoreExpandedModalSectionIds(sectionIds = []) {
    const wanted = new Set((sectionIds || []).map((id) => String(id || '').trim()).filter(Boolean));
    if (!wanted.size) return;
    document.querySelectorAll('.field-collapsible-section').forEach((section) => {
        if (!section.id) return;
        setSectionCollapsed(section, !wanted.has(section.id));
    });
}

function readFieldModalInputValue(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    if (el.type === 'checkbox') return Boolean(el.checked);
    return String(el.value || '');
}

function writeFieldModalInputValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') {
        el.checked = Boolean(value);
        return;
    }
    el.value = value === null || value === undefined ? '' : String(value);
}

function captureFieldModalDraft() {
    if (!state.modalScheduleId || state.modalReadOnly) return null;
    const values = {};
    FIELD_MODAL_DRAFT_INPUT_IDS.forEach((id) => {
        values[id] = readFieldModalInputValue(id);
    });
    const files = {};
    FIELD_MODAL_DRAFT_FILE_IDS.forEach((id) => {
        const input = document.getElementById(id);
        const file = input?.files?.[0] || null;
        files[id] = file
            ? { name: String(file.name || ''), size: Number(file.size || 0) || 0, type: String(file.type || '') }
            : (input?.dataset?.draftName ? { name: input.dataset.draftName, size: 0, type: '' } : null);
    });
    return {
        version: 1,
        scheduleId: Number(state.modalScheduleId || 0) || state.modalScheduleId,
        selectedDate: state.selectedDate || document.getElementById('fieldDate')?.value || localDateYmd(),
        activeTab: state.activeTab || 'today',
        activeView: 'tasks',
        statusFilter: state.statusFilter || 'all',
        savedAt: new Date().toISOString(),
        values,
        files,
        expandedSectionIds: getExpandedModalSectionIds(),
        partsNeeded: state.modalPartsNeeded || [],
        collectionInvoices: state.modalCollectionInvoices || []
    };
}

function saveFieldModalDraftNow() {
    if (state.suppressModalDraftSave || state.modalDraftRestoreInProgress) return;
    const draft = captureFieldModalDraft();
    if (!draft) return;
    safeWriteJsonStorage(fieldModalDraftKey(), draft);
}

function flushFieldModalDraftSave() {
    window.clearTimeout(fieldModalDraftTimer);
    saveFieldModalDraftNow();
}

function queueFieldModalDraftSave() {
    if (state.suppressModalDraftSave || state.modalDraftRestoreInProgress) return;
    if (!state.modalScheduleId || state.modalReadOnly) return;
    window.clearTimeout(fieldModalDraftTimer);
    fieldModalDraftTimer = window.setTimeout(saveFieldModalDraftNow, 250);
}

function applyFieldModalDraft(draft) {
    if (!draft || Number(draft.scheduleId || 0) !== Number(state.modalScheduleId || 0)) return false;
    state.modalDraftRestoreInProgress = true;
    try {
        Object.entries(draft.values || {}).forEach(([id, value]) => writeFieldModalInputValue(id, value));
        state.modalPartsNeeded = Array.isArray(draft.partsNeeded) ? draft.partsNeeded : [];
        state.modalCollectionInvoices = Array.isArray(draft.collectionInvoices)
            ? draft.collectionInvoices.map((invoice) => mapFieldCollectionInvoice(invoice)).filter((invoice) => collectionInvoiceKey(invoice))
            : [];
        FIELD_MODAL_DRAFT_FILE_IDS.forEach((id) => {
            const input = document.getElementById(id);
            const meta = draft.files?.[id] || null;
            if (input && meta?.name) input.dataset.draftName = meta.name;
        });
        renderPartsList();
        renderFieldCollectionInvoices();
        restoreExpandedModalSectionIds(draft.expandedSectionIds || []);
        toggleMissingSerialMode();
        recomputeTotalConsumed();
        recomputeMaintenanceTotalConsumed();
        syncDeliveryMetersFromMaintenance();
        updatePhotoHint('fieldBeforePhoto', 'fieldBeforePhotoHint', 'field_before_photo_name');
        updatePhotoHint('fieldAfterPhoto', 'fieldAfterPhotoHint', 'field_after_photo_name');
        updatePhotoHint('fieldCollectionVoucherImage', 'fieldCollectionVoucherHint', 'field_collection_voucher_name');
        updatePhotoHint('fieldCollectionCheckImage', 'fieldCollectionCheckHint', 'field_collection_check_name');
        updateActionButtons();
        return true;
    } finally {
        state.modalDraftRestoreInProgress = false;
    }
}

async function restorePendingFieldModalDraft() {
    if (state.modalDraftRestored) return;
    const draft = getStoredFieldModalDraft();
    if (!draft?.scheduleId) return;
    const scheduleId = Number(draft.scheduleId || 0);
    const row = state.rows.find((item) => Number(item.id || 0) === scheduleId);
    if (!row || isFinishedOrCancelled(row)) return;
    state.modalDraftRestored = true;
    state.activeView = 'tasks';
    state.activeTab = state.carryoverRows.some((item) => Number(item.id || 0) === scheduleId) ? 'carryover' : (draft.activeTab || 'today');
    state.statusFilter = draft.statusFilter || 'all';
    const statusFilter = document.getElementById('fieldStatusFilter');
    if (statusFilter) statusFilter.value = state.statusFilter;
    renderActiveView();
    await openModal(scheduleId);
}

function sanitize(text) {
    return MargaUtils.escapeHtml(String(text ?? ''));
}

function escapeHtml(value) {
    return sanitize(value);
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'unknown';
}

function formatLongDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '-';
    const ymd = raw.slice(0, 10);
    const [year, month, day] = ymd.split('-').map((part) => Number(part));
    if (!year || !month || !day) return raw;
    return new Date(year, month - 1, day).toLocaleDateString('en-PH', {
        month: 'short',
        day: '2-digit',
        year: 'numeric'
    });
}

function formatDateYmd(date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function addDaysYmd(ymd, days) {
    const [y, m, d] = String(ymd).split('-').map((v) => Number(v));
    const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    date.setUTCDate(date.getUTCDate() + days);
    return formatDateYmd(new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseFirestoreValue(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.stringValue !== undefined) return value.stringValue;
    if (value.integerValue !== undefined) return Number(value.integerValue);
    if (value.doubleValue !== undefined) return Number(value.doubleValue);
    if (value.booleanValue !== undefined) return value.booleanValue;
    if (value.timestampValue !== undefined) return value.timestampValue;
    if (value.arrayValue !== undefined) {
        return (value.arrayValue.values || []).map(parseFirestoreValue);
    }
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
    if (doc.name) {
        parsed._docId = doc.name.split('/').pop();
    }
    return parsed;
}

function toFirestoreFieldValue(value) {
    if (value === null) return { nullValue: null };
    if (Array.isArray(value)) return { arrayValue: { values: value.map((entry) => toFirestoreFieldValue(entry)) } };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (Number.isInteger(value)) return { integerValue: String(value) };
        return { doubleValue: value };
    }
    if (value && typeof value === 'object') {
        const fields = {};
        Object.entries(value).forEach(([key, child]) => {
            if (child === undefined || typeof child === 'function') return;
            fields[key] = toFirestoreFieldValue(child);
        });
        return { mapValue: { fields } };
    }
    return { stringValue: String(value ?? '') };
}

async function runQuery(structuredQuery) {
    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredQuery })
        }
    );
    const payload = await response.json();
    if (!response.ok || (Array.isArray(payload) && payload[0]?.error)) {
        const message = payload?.error?.message || payload?.[0]?.error?.message || 'Query failed.';
        throw new Error(message);
    }
    if (!Array.isArray(payload)) return [];
    return payload.map((row) => row.document).filter(Boolean);
}

async function fetchDoc(collection, id) {
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}/${id}?key=${FIREBASE_CONFIG.apiKey}`);
    const payload = await response.json();
    if (!response.ok || payload?.error) return null;
    return parseFirestoreDoc(payload);
}

async function patchDocument(collection, docId, fields) {
    const updateKeys = Object.keys(fields);
    if (!updateKeys.length) return;

    const params = updateKeys
        .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
        .join('&');

    const body = { fields: {} };
    updateKeys.forEach((key) => {
        body.fields[key] = toFirestoreFieldValue(fields[key]);
    });

    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}/${collection}/${docId}?key=${FIREBASE_CONFIG.apiKey}&${params}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }
    );

    const payload = await response.json();
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to update ${collection}/${docId}`);
    }
    return payload;
}

async function setDocument(collection, docId, fields) {
    const body = { fields: {} };
    Object.entries(fields).forEach(([key, value]) => {
        body.fields[key] = toFirestoreFieldValue(value);
    });

    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}/${collection}/${docId}?key=${FIREBASE_CONFIG.apiKey}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }
    );
    const payload = await response.json();
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to set ${collection}/${docId}`);
    }
    return payload;
}

function appendDevRemarks(previous, tag, notes) {
    const base = String(previous || '').trim();
    const next = String(notes || '').trim();
    const stamp = new Date().toLocaleString('en-PH');
    const line = [tag, next].filter(Boolean).join(' ');
    return [base, `${stamp}: ${line}`].filter(Boolean).join(' | ').slice(0, 240);
}

async function queryByDateRange(collectionId, fieldPath, start, end, endOp = 'LESS_THAN_OR_EQUAL') {
    const structuredQuery = {
        from: [{ collectionId }],
        where: {
            compositeFilter: {
                op: 'AND',
                filters: [
                    {
                        fieldFilter: {
                            field: { fieldPath },
                            op: 'GREATER_THAN_OR_EQUAL',
                            value: { stringValue: start }
                        }
                    },
                    {
                        fieldFilter: {
                            field: { fieldPath },
                            op: endOp,
                            value: { stringValue: end }
                        }
                    }
                ]
            }
        },
        orderBy: [{ field: { fieldPath }, direction: 'ASCENDING' }],
        limit: FIELD_QUERY_LIMIT
    };
    return runQuery(structuredQuery);
}

async function queryEquals(collectionId, fieldPath, value, valueType = 'integer', limit = 100) {
    const typedValue = valueType === 'integer'
        ? { integerValue: String(Math.trunc(Number(value || 0))) }
        : { stringValue: String(value ?? '') };

    const structuredQuery = {
        from: [{ collectionId }],
        where: {
            fieldFilter: {
                field: { fieldPath },
                op: 'EQUAL',
                value: typedValue
            }
        },
        limit
    };
    return runQuery(structuredQuery);
}

async function queryCollection(collectionId, limit = 1000) {
    const structuredQuery = {
        from: [{ collectionId }],
        limit
    };
    return runQuery(structuredQuery);
}

async function queryCollectionSelect(collectionId, fields = [], limit = 1000) {
    const structuredQuery = {
        from: [{ collectionId }],
        limit
    };
    if (Array.isArray(fields) && fields.length) {
        structuredQuery.select = {
            fields: fields.map((fieldPath) => ({ fieldPath }))
        };
    }
    return runQuery(structuredQuery);
}

async function queryLatestById(collectionId, limit = 1) {
    const structuredQuery = {
        from: [{ collectionId }],
        orderBy: [{ field: { fieldPath: 'id' }, direction: 'DESCENDING' }],
        limit
    };
    return runQuery(structuredQuery);
}

async function allocateNextNumericId(collectionId) {
    const docs = await queryLatestById(collectionId, 1);
    const latest = docs.map(parseFirestoreDoc).filter(Boolean)[0] || null;
    const nextId = Number(latest?.id || 0) + 1;
    if (!Number.isFinite(nextId) || nextId <= 0) {
        throw new Error(`Unable to allocate new ${collectionId} id.`);
    }
    return nextId;
}

function uniqueNonBlankValues(values = []) {
    const seen = new Set();
    const unique = [];
    values.forEach((value) => {
        const key = String(value ?? '').trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        unique.push(value);
    });
    return unique;
}

function chunkValues(values = [], size = 10) {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

async function queryIn(collectionId, fieldPath, values = [], options = {}) {
    const uniqueValues = uniqueNonBlankValues(values);
    if (!uniqueValues.length) return [];

    const byDocId = new Map();
    const chunks = chunkValues(uniqueValues, options.chunkSize || 10);
    const queries = chunks.map((chunk) => {
        const structuredQuery = {
            from: [{ collectionId }],
            where: {
                fieldFilter: {
                    field: { fieldPath },
                    op: 'IN',
                    value: {
                        arrayValue: {
                            values: chunk.map((value) => toFirestoreFieldValue(value))
                        }
                    }
                }
            }
        };
        if (Array.isArray(options.select) && options.select.length) {
            structuredQuery.select = {
                fields: options.select.map((selectedFieldPath) => ({ fieldPath: selectedFieldPath }))
            };
        }
        if (Number(options.limit || 0) > 0) {
            structuredQuery.limit = Number(options.limit || 0);
        }
        return structuredQuery;
    });

    const results = await Promise.all(queries.map((query) => runQuery(query)));
    results.flat().forEach((doc) => {
        const parsed = parseFirestoreDoc(doc);
        if (!parsed) return;
        const key = String(parsed._docId || `${parsed.id || ''}:${parsed.current_contract || ''}:${parsed.machine_id || ''}:${parsed.timestmp || ''}`).trim();
        if (key && !byDocId.has(key)) byDocId.set(key, parsed);
    });
    return [...byDocId.values()];
}

function makeFieldCallId() {
    const random = Math.random().toString(36).slice(2, 10);
    return `field_call_${Date.now()}_${random}`;
}

function cleanFieldCallRoomPart(value, fallback = 'Room') {
    const cleaned = String(value || '')
        .replace(/[^a-zA-Z0-9]+/g, '')
        .slice(0, 34);
    return cleaned || fallback;
}

function normalizeFieldCallRoomName(value, fallback = 'MargaFieldRoom') {
    const cleaned = String(value || '')
        .replace(/[^a-zA-Z0-9]+/g, '');
    return cleaned || fallback;
}

function dailyFieldMeetingRoomName() {
    const date = String(state.selectedDate || document.getElementById('fieldDate')?.value || localDateYmd()).replace(/[^0-9]/g, '');
    return `MargaFieldDaily${date}`;
}

function callRoomName(callId, targetLabel = '') {
    const date = localDateYmd().replace(/[^0-9]/g, '');
    const staffId = Number(state.staffId || 0) || 0;
    const suffix = String(callId || makeFieldCallId()).split('_').pop();
    return `MargaCall${date}S${staffId}${cleanFieldCallRoomPart(targetLabel, 'Support')}${cleanFieldCallRoomPart(suffix, 'Room')}`;
}

function setFieldCallStatus(text) {
    const el = document.getElementById('fieldCallStatus');
    if (el) el.textContent = text || 'Voice starts with camera off. Video starts with camera on.';
}

async function startFieldRoleCall(targetRole, mode = 'voice') {
    const roleLabel = fieldCallRoleLabel(targetRole);
    const callId = makeFieldCallId();
    const roomName = callRoomName(callId, roleLabel);
    const nowIso = new Date().toISOString();
    const payload = {
        id: callId,
        type: 'role_call',
        source: 'field_app',
        mode: String(mode || 'voice') === 'video' ? 'video' : 'voice',
        room_name: roomName,
        room_domain: FIELD_CALL_DOMAIN,
        room_url: `https://${FIELD_CALL_DOMAIN}/${roomName}`,
        title: `${fieldCallModeLabel(mode)} to ${roleLabel}`,
        status: 'ringing',
        caller_staff_id: Number(state.staffId || 0) || 0,
        caller_name: currentFieldDisplayName(),
        caller_email: currentFieldEmail(),
        caller_roles: currentFieldRoles().join(','),
        target_role: targetRole,
        target_role_label: roleLabel,
        target_staff_id: 0,
        created_at: nowIso,
        updated_at: nowIso,
        expires_at: new Date(Date.now() + FIELD_CALL_RING_TIMEOUT_MS).toISOString()
    };

    setFieldCallStatus(`Calling ${roleLabel}...`);
    try {
        await setDocument(FIELD_CALL_COLLECTION, callId, payload);
        await openFieldCallRoom({
            ...payload,
            _docId: callId
        }, { mode: payload.mode, outgoing: true });
    } catch (err) {
        console.error('Start field role call failed:', err);
        setFieldCallStatus(`Call failed: ${err?.message || err}`);
        alert(`Unable to start call: ${err?.message || err}`);
    }
}

async function startFieldDirectCall(mode = 'voice') {
    if (!isFieldTechTeamLeader()) {
        alert('Only admin, service, or field team leader accounts can call staff directly.');
        return;
    }
    const input = document.getElementById('fieldDirectCallStaffId');
    const targetStaffId = Number(input?.value || 0) || 0;
    if (!targetStaffId) {
        alert('Enter the field staff employee ID to call.');
        input?.focus();
        return;
    }
    if (targetStaffId === Number(state.staffId || 0)) {
        alert('Enter another staff ID.');
        return;
    }

    const callId = makeFieldCallId();
    const roomName = callRoomName(callId, `Staff${targetStaffId}`);
    const nowIso = new Date().toISOString();
    const payload = {
        id: callId,
        type: 'direct_call',
        source: 'field_app_admin',
        mode: String(mode || 'voice') === 'video' ? 'video' : 'voice',
        room_name: roomName,
        room_domain: FIELD_CALL_DOMAIN,
        room_url: `https://${FIELD_CALL_DOMAIN}/${roomName}`,
        title: `${fieldCallModeLabel(mode)} to Staff #${targetStaffId}`,
        status: 'ringing',
        caller_staff_id: Number(state.staffId || 0) || 0,
        caller_name: currentFieldDisplayName(),
        caller_email: currentFieldEmail(),
        caller_roles: currentFieldRoles().join(','),
        target_role: '',
        target_role_label: '',
        target_staff_id: targetStaffId,
        created_at: nowIso,
        updated_at: nowIso,
        expires_at: new Date(Date.now() + FIELD_CALL_RING_TIMEOUT_MS).toISOString()
    };

    setFieldCallStatus(`Calling Staff #${targetStaffId}...`);
    try {
        await setDocument(FIELD_CALL_COLLECTION, callId, payload);
        await openFieldCallRoom({
            ...payload,
            _docId: callId
        }, { mode: payload.mode, outgoing: true });
    } catch (err) {
        console.error('Start direct field call failed:', err);
        setFieldCallStatus(`Call failed: ${err?.message || err}`);
        alert(`Unable to call staff: ${err?.message || err}`);
    }
}

async function joinDailyFieldMeeting(mode = 'video') {
    const roomName = dailyFieldMeetingRoomName();
    const callId = `field_meeting_${String(state.selectedDate || localDateYmd()).replace(/[^0-9]/g, '')}`;
    const nowIso = new Date().toISOString();
    const payload = {
        id: callId,
        type: 'meeting',
        source: 'field_app',
        mode: String(mode || 'video') === 'voice' ? 'voice' : 'video',
        room_name: roomName,
        room_domain: FIELD_CALL_DOMAIN,
        room_url: `https://${FIELD_CALL_DOMAIN}/${roomName}`,
        title: `Field Daily Meeting ${state.selectedDate || localDateYmd()}`,
        status: 'active',
        caller_staff_id: Number(state.staffId || 0) || 0,
        caller_name: currentFieldDisplayName(),
        caller_email: currentFieldEmail(),
        target_role: 'field',
        target_role_label: 'Field Staff',
        created_at: nowIso,
        updated_at: nowIso
    };

    setFieldCallStatus('Joining field meeting...');
    try {
        await setDocument(FIELD_CALL_COLLECTION, callId, payload);
        await openFieldCallRoom({
            ...payload,
            _docId: callId
        }, { mode: payload.mode, outgoing: false });
    } catch (err) {
        console.error('Join field meeting failed:', err);
        setFieldCallStatus(`Meeting failed: ${err?.message || err}`);
        alert(`Unable to join field meeting: ${err?.message || err}`);
    }
}

function isIncomingFieldCall(call) {
    if (!call || String(call.status || '') !== 'ringing') return false;
    const callerStaffId = Number(call.caller_staff_id || 0) || 0;
    const myStaffId = Number(state.staffId || 0) || 0;
    if (callerStaffId && callerStaffId === myStaffId) return false;

    const targetStaffId = Number(call.target_staff_id || 0) || 0;
    if (targetStaffId && targetStaffId === myStaffId) return true;
    return fieldCallRoleMatches(call.target_role);
}

async function pollIncomingFieldCalls() {
    if (!state.staffId || state.activeIncomingCallId || state.activeCallDocId) return;
    try {
        const docs = await queryEquals(FIELD_CALL_COLLECTION, 'status', 'ringing', 'string', 80);
        const now = Date.now();
        const calls = docs
            .map(parseFirestoreDoc)
            .filter(isIncomingFieldCall)
            .filter((call) => {
                const expiresAt = Date.parse(call.expires_at || '');
                if (Number.isFinite(expiresAt) && expiresAt < now) return false;
                const createdAt = Date.parse(call.created_at || '');
                return !Number.isFinite(createdAt) || (now - createdAt) <= FIELD_CALL_RING_TIMEOUT_MS;
            })
            .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        if (calls[0]) showIncomingFieldCall(calls[0]);
    } catch (err) {
        console.warn('Incoming call poll failed:', err);
    }
}

function startFieldCallPolling() {
    if (state.callPollTimer) clearInterval(state.callPollTimer);
    void pollIncomingFieldCalls();
    state.callPollTimer = setInterval(() => {
        void pollIncomingFieldCalls();
    }, FIELD_CALL_POLL_MS);
}

function playFieldRingTone() {
    stopFieldRingTone();
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        const context = new AudioContextClass();
        const gain = context.createGain();
        gain.gain.value = 0.035;
        gain.connect(context.destination);
        const interval = setInterval(() => {
            const osc = context.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = 880;
            osc.connect(gain);
            osc.start();
            osc.stop(context.currentTime + 0.22);
        }, 700);
        state.ringTone = { context, interval };
    } catch (err) {
        console.warn('Ringtone unavailable:', err);
    }
}

function stopFieldRingTone() {
    if (!state.ringTone) return;
    try {
        clearInterval(state.ringTone.interval);
        state.ringTone.context?.close?.();
    } catch (_) {}
    state.ringTone = null;
}

function showIncomingFieldCall(call) {
    state.activeIncomingCallId = call._docId || String(call.id || '');
    playFieldRingTone();
    const existing = document.getElementById('fieldIncomingCall');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'fieldIncomingCall';
    modal.className = 'field-incoming-call';
    modal.innerHTML = `
        <div class="field-incoming-call-card">
            <span>Incoming ${sanitize(fieldCallModeLabel(call.mode))}</span>
            <h2>${sanitize(call.caller_name || 'Marga user')}</h2>
            <p>${sanitize(call.title || 'Field support call')}</p>
            <p>${sanitize(call.target_role_label ? `For ${call.target_role_label}` : 'Direct call')}</p>
            <div class="field-incoming-call-actions">
                <button type="button" class="btn btn-secondary" id="fieldDeclineCallBtn">Decline</button>
                <button type="button" class="btn btn-primary" id="fieldAcceptCallBtn">Accept</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('fieldDeclineCallBtn')?.addEventListener('click', () => declineIncomingFieldCall(call));
    document.getElementById('fieldAcceptCallBtn')?.addEventListener('click', () => acceptIncomingFieldCall(call));
}

function closeIncomingFieldCall() {
    stopFieldRingTone();
    state.activeIncomingCallId = '';
    document.getElementById('fieldIncomingCall')?.remove();
}

async function acceptIncomingFieldCall(call) {
    const docId = call._docId || String(call.id || '');
    const nowIso = new Date().toISOString();
    try {
        await patchDocument(FIELD_CALL_COLLECTION, docId, {
            status: 'accepted',
            answered_by_staff_id: Number(state.staffId || 0) || 0,
            answered_by_name: currentFieldDisplayName(),
            answered_at: nowIso,
            updated_at: nowIso
        });
    } catch (err) {
        console.warn('Unable to mark call accepted; joining anyway.', err);
    }
    closeIncomingFieldCall();
    await openFieldCallRoom({ ...call, status: 'accepted', _docId: docId }, { mode: call.mode || 'voice', outgoing: false });
}

async function declineIncomingFieldCall(call) {
    const docId = call._docId || String(call.id || '');
    const nowIso = new Date().toISOString();
    try {
        await patchDocument(FIELD_CALL_COLLECTION, docId, {
            status: 'declined',
            declined_by_staff_id: Number(state.staffId || 0) || 0,
            declined_by_name: currentFieldDisplayName(),
            declined_at: nowIso,
            updated_at: nowIso
        });
    } catch (err) {
        console.warn('Unable to mark call declined:', err);
    }
    closeIncomingFieldCall();
}

function setFieldCallModalStatus(text) {
    const el = document.getElementById('fieldCallModalStatus');
    if (el) el.textContent = text || '';
}

function showFieldCallModal(call) {
    document.getElementById('fieldCallModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'fieldCallModal';
    modal.className = 'field-call-modal';
    modal.innerHTML = `
        <div class="field-call-modal-header">
            <div>
                <h2>${sanitize(call.title || 'Marga Field Call')}</h2>
                <p>${sanitize(call.room_domain || FIELD_CALL_DOMAIN)} / ${sanitize(call.room_name || '')}</p>
            </div>
            <div class="field-call-modal-actions">
                <button type="button" class="btn btn-secondary btn-sm" id="fieldCallCopyLinkBtn">Copy Link</button>
                <button type="button" class="btn btn-secondary btn-sm" id="fieldCallRetryBtn">Retry</button>
                <button type="button" class="btn btn-secondary btn-sm" id="fieldCallLeaveBtn">Leave</button>
            </div>
        </div>
        <div class="field-call-status" id="fieldCallModalStatus">Preparing call...</div>
        <div class="field-jitsi-container" id="fieldJitsiContainer"></div>
    `;
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
    document.getElementById('fieldCallLeaveBtn')?.addEventListener('click', leaveFieldCall);
    document.getElementById('fieldCallRetryBtn')?.addEventListener('click', retryActiveFieldCall);
    document.getElementById('fieldCallCopyLinkBtn')?.addEventListener('click', copyActiveFieldCallLink);
}

function loadFieldJitsiScript(domain = FIELD_CALL_DOMAIN) {
    if (window.JitsiMeetExternalAPI) return Promise.resolve();
    if (state.jitsiScriptPromise) return state.jitsiScriptPromise;

    const domains = (FIELD_CALL_ALLOW_PUBLIC_FALLBACK ? [domain, FIELD_CALL_PUBLIC_DOMAIN] : [domain])
        .filter((item, index, arr) => item && arr.indexOf(item) === index);
    const urls = domains.flatMap((item) => [
        `https://${item}/external_api.js`,
        `https://${item}/libs/external_api.min.js`
    ]);

    state.jitsiScriptPromise = new Promise((resolve, reject) => {
        const loadAt = (index) => {
            if (window.JitsiMeetExternalAPI) {
                resolve();
                return;
            }
            if (index >= urls.length) {
                reject(new Error('Unable to load Jitsi meeting script.'));
                return;
            }
            setFieldCallModalStatus('Loading meeting tools...');
            const script = document.createElement('script');
            script.src = urls[index];
            script.async = true;
            const timer = setTimeout(() => {
                script.remove();
                loadAt(index + 1);
            }, FIELD_CALL_SCRIPT_TIMEOUT_MS);
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
        state.jitsiScriptPromise = null;
    });
    return state.jitsiScriptPromise;
}

async function ensureFieldCallMedia(mode = 'voice') {
    if (!navigator.mediaDevices?.getUserMedia) return;
    const constraints = String(mode || 'voice') === 'video'
        ? { audio: true, video: { width: { ideal: 480, max: 720 }, height: { ideal: 480, max: 720 }, facingMode: 'user' } }
        : { audio: true, video: false };
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        stream.getTracks().forEach((track) => track.stop());
    } catch (err) {
        console.warn('Call media permission probe failed:', err);
    }
}

async function openFieldCallRoom(call, options = {}) {
    const mode = String(options.mode || call.mode || 'voice') === 'video' ? 'video' : 'voice';
    const roomName = normalizeFieldCallRoomName(call.room_name, dailyFieldMeetingRoomName());
    const domain = String(call.room_domain || FIELD_CALL_DOMAIN).trim() || FIELD_CALL_DOMAIN;
    try {
        state.activeCallApi?.dispose?.();
    } catch (_) {}
    state.activeCallApi = null;
    state.activeCallDocId = call._docId || String(call.id || '');
    state.activeCallMode = mode;
    state.activeCallDomain = domain;
    state.activeCallRoomUrl = `https://${domain}/${roomName}`;

    showFieldCallModal({ ...call, room_name: roomName, room_domain: domain, mode });
    setFieldCallModalStatus('Requesting microphone/camera permission...');
    await ensureFieldCallMedia(mode);
    setFieldCallModalStatus(`Connecting to ${domain}...`);
    await loadFieldJitsiScript(domain);
    if (!window.JitsiMeetExternalAPI) throw new Error('Jitsi meeting API is not available.');

    const container = document.getElementById('fieldJitsiContainer');
    if (!container) throw new Error('Meeting container is missing.');
    container.innerHTML = '';

    state.activeCallApi = new JitsiMeetExternalAPI(domain, {
        roomName,
        parentNode: container,
        width: '100%',
        height: '100%',
        userInfo: {
            displayName: currentFieldDisplayName(),
            email: currentFieldEmail()
        },
        configOverwrite: {
            prejoinPageEnabled: true,
            prejoinConfig: { enabled: true },
            startWithAudioMuted: false,
            startWithVideoMuted: mode !== 'video',
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

    state.activeCallApi.addListener('videoConferenceJoined', () => {
        setFieldCallModalStatus('');
        setFieldCallStatus('Connected to field call.');
        if (state.activeCallDocId) {
            patchDocument(FIELD_CALL_COLLECTION, state.activeCallDocId, {
                status: 'active',
                joined_by_staff_id: Number(state.staffId || 0) || 0,
                joined_by_name: currentFieldDisplayName(),
                joined_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }).catch((err) => console.warn('Unable to mark call active:', err));
        }
    });
    state.activeCallApi.addListener('videoConferenceLeft', leaveFieldCall);
    state.activeCallApi.addListener('readyToClose', leaveFieldCall);
    state.activeCallApi.addListener('errorOccurred', (event) => {
        console.error('Field call Jitsi error:', event);
        setFieldCallModalStatus('Meeting error. Tap Retry or Copy Link.');
    });
    state.activeCallApi.addListener('connectionFailed', () => {
        setFieldCallModalStatus('Connection failed. Tap Retry or Copy Link.');
    });
}

function retryActiveFieldCall() {
    if (!state.activeCallRoomUrl) return;
    const roomName = state.activeCallRoomUrl.split('/').pop();
    void openFieldCallRoom({
        _docId: state.activeCallDocId,
        id: state.activeCallDocId,
        title: 'Marga Field Call',
        room_name: roomName,
        room_domain: state.activeCallDomain || FIELD_CALL_DOMAIN,
        mode: state.activeCallMode
    }, { mode: state.activeCallMode });
}

function copyActiveFieldCallLink() {
    if (!state.activeCallRoomUrl) return;
    navigator.clipboard?.writeText(state.activeCallRoomUrl)
        .then(() => setFieldCallModalStatus('Meeting link copied.'))
        .catch(() => {
            window.prompt('Copy meeting link:', state.activeCallRoomUrl);
        });
}

function leaveFieldCall() {
    try {
        state.activeCallApi?.dispose?.();
    } catch (_) {}
    state.activeCallApi = null;
    if (state.activeCallDocId) {
        patchDocument(FIELD_CALL_COLLECTION, state.activeCallDocId, {
            last_left_by_staff_id: Number(state.staffId || 0) || 0,
            last_left_by_name: currentFieldDisplayName(),
            last_left_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }).catch((err) => console.warn('Unable to mark call leave:', err));
    }
    state.activeCallDocId = '';
    state.activeCallRoomUrl = '';
    state.activeCallDomain = FIELD_CALL_DOMAIN;
    document.getElementById('fieldCallModal')?.remove();
    document.body.style.overflow = '';
    setFieldCallStatus('');
}

function normalizeInlineText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSearchText(value) {
    return normalizeInlineText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function mergePendingOfflineRows(collection, rows) {
    const merger = window.MargaOfflineSync?.mergePendingCollectionRows;
    if (typeof merger !== 'function') return rows;
    return merger(collection, rows);
}

function normalizeLegacyDateTime(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const compact = text.replace(/[T]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (LEGACY_EMPTY_DATETIME_VALUES.has(compact)) return '';
    if (compact.startsWith('undefined ')) return '';
    if (compact.startsWith('null ')) return '';
    return text;
}

function parseComparableTime(value) {
    const text = String(value || '').trim();
    if (!text) return NaN;
    const normalized = text.includes('T') ? text : text.replace(' ', 'T');
    return Date.parse(normalized);
}

function shouldPreferScheduleState(row) {
    const scheduleSignals = [
        row?.field_updated_at,
        row?.bridge_updated_at,
        row?.bridge_pushed_at
    ];
    const routeSignals = [
        row?.route_bridge_pushed_at,
        row?.route_timestmp
    ];

    const scheduleTimes = scheduleSignals.map(parseComparableTime).filter(Number.isFinite);
    const routeTimes = routeSignals.map(parseComparableTime).filter(Number.isFinite);
    const scheduleTime = scheduleTimes.length ? Math.max(...scheduleTimes) : NaN;
    const routeTime = routeTimes.length ? Math.max(...routeTimes) : NaN;

    if (!Number.isFinite(scheduleTime)) return false;
    if (!Number.isFinite(routeTime)) return true;
    return scheduleTime >= routeTime;
}

function dateOnly(value) {
    return String(value || '').trim().slice(0, 10);
}

function originalScheduleDate(row) {
    return dateOnly(row?.original_sched)
        || dateOnly(row?.forwarded_from_date)
        || dateOnly(row?.route_forwarded_from_date)
        || dateOnly(row?.task_datetime);
}

function formatShortDate(value) {
    const dateKey = dateOnly(value);
    if (!dateKey) return '-';
    const parsed = new Date(`${dateKey}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return dateKey;
    return parsed.toLocaleDateString('en-PH', { month: 'short', day: '2-digit' });
}

function isPastPendingByOriginalDate(row) {
    const originalDate = originalScheduleDate(row);
    return Boolean(originalDate && state.selectedDate && originalDate < state.selectedDate);
}

function getStatusKey(row) {
    if (Number(row.route_iscancelled || 0) === 1) return 'cancelled';
    if (Number(row.iscancel || 0) === 1) return 'cancelled';

    const preferScheduleState = shouldPreferScheduleState(row);
    const finished = normalizeLegacyDateTime(row.date_finished);
    if (finished || Number(row.closedby || 0) > 0) return 'closed';
    if (preferScheduleState) {
        if (Number(row.isongoing || 0) === 1) return 'ongoing';
    }

    const routeFinished = normalizeLegacyDateTime(row.route_date_finished);
    if (routeFinished) return 'closed';
    const routeStatus = row.route_status === '' || row.route_status === undefined || row.route_status === null
        ? null
        : Number(row.route_status);
    if (routeStatus === 0) return 'closed';
    const hasActiveRouteRow = Boolean(getRouteTaskDateTime(row)) && routeStatus !== 0;
    if (hasActiveRouteRow) {
        if (Number(row.isongoing || 0) === 1) return 'ongoing';
        if (isPastPendingByOriginalDate(row)) return 'carryover';
        const taskDate = getRouteTaskDateTime(row).slice(0, 10);
        if (taskDate && state.selectedDate && taskDate < state.selectedDate) return 'carryover';
        return 'pending';
    }
    if (Number(row.isongoing || 0) === 1) return 'ongoing';
    if (isPastPendingByOriginalDate(row)) return 'carryover';
    const taskDate = getRouteTaskDateTime(row).slice(0, 10);
    if (taskDate && state.selectedDate && taskDate < state.selectedDate) return 'carryover';
    return 'pending';
}

function getStatusMeta(row) {
    const key = getStatusKey(row);
    if (key === 'pending') return { key, label: 'Pending', className: 'status-pending' };
    if (key === 'carryover') return { key, label: 'Past Pending', className: 'status-carryover' };
    if (key === 'ongoing') return { key, label: 'Ongoing', className: 'status-ongoing' };
    if (key === 'closed') return { key, label: 'Closed', className: 'status-closed' };
    if (key === 'cancelled') return { key, label: 'Cancelled', className: 'status-cancelled' };
    return { key, label: 'Pending', className: 'status-pending' };
}

function isDispatchableFieldRow(row) {
    return Number(row?.purpose_id || 0) !== 9;
}

function schedulePriorityValue(row) {
    const value = Number(row?.master_priority_order || row?.priority || 0);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function updatePriorityGate(rows = state.todayRows) {
    const openRows = rows.filter((row) => !isFinishedOrCancelled(row) && getStatusKey(row) !== 'cancelled');
    const required = Math.min(REQUIRED_PRIORITY_COUNT, openRows.length);
    const numbered = openRows.filter((row) => schedulePriorityValue(row) > 0).length;
    state.priorityGate = {
        required,
        numbered,
        ready: required === 0 || numbered >= required
    };
}

function prioritySortedRows(rows) {
    return rows.slice().sort((a, b) => {
        const ap = schedulePriorityValue(a);
        const bp = schedulePriorityValue(b);
        if (ap && bp && ap !== bp) return ap - bp;
        if (ap && !bp) return -1;
        if (!ap && bp) return 1;
        return String(getRouteTaskDateTime(a)).localeCompare(String(getRouteTaskDateTime(b))) || (Number(a.id || 0) - Number(b.id || 0));
    });
}

function combinedStopKey(row) {
    const visitId = String(row?.combined_visit_id || '').trim();
    if (visitId) return `combined:${visitId}`;
    const branchId = Number(row?.branch_id || 0) || 0;
    const companyId = Number(row?.company_id || 0) || 0;
    return branchId ? `branch:${branchId}` : `company:${companyId || 'unknown'}`;
}

function purposePriorityValue(row) {
    const purposeId = Number(row?.purpose_id || 0);
    if (purposeId === 5) return 1;
    if ([3, 4].includes(purposeId)) return 2;
    if ([1, 8].includes(purposeId)) return 3;
    if (purposeId === 2) return 4;
    return 5;
}

function combinedWorkLabel(row) {
    const trouble = caches.trouble.get(String(row?.trouble_id || 0));
    const troubleLabel = trouble?.trouble || (row?.trouble_id ? `Trouble ${row.trouble_id}` : 'Unspecified');
    const purposeLabel = PURPOSE_LABELS[row?.purpose_id] || `Purpose ${row?.purpose_id || 0}`;
    return `${purposeLabel} / ${troubleLabel}`;
}

function uniqueCombinedWorkLabels(rows) {
    const seen = new Set();
    return rows
        .map((row) => combinedWorkLabel(row))
        .filter((label) => {
            const key = label.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function pickPrimaryCombinedRow(rows) {
    return rows.slice().sort((a, b) => {
        const ap = purposePriorityValue(a);
        const bp = purposePriorityValue(b);
        if (ap !== bp) return ap - bp;
        return prioritySortedRows([a, b])[0] === a ? -1 : 1;
    })[0] || rows[0];
}

function buildCombinedTaskGroups(rows) {
    const byStop = new Map();
    rows.forEach((row) => {
        const key = combinedStopKey(row);
        if (!byStop.has(key)) byStop.set(key, []);
        byStop.get(key).push(row);
    });
    const groups = Array.from(byStop.values()).map((groupRows) => {
        const sortedRows = prioritySortedRows(groupRows);
        const primary = pickPrimaryCombinedRow(sortedRows);
        return {
            primary,
            rows: sortedRows
        };
    });
    const primaryOrder = new Map(prioritySortedRows(groups.map((group) => group.primary)).map((row, index) => [Number(row.id || 0), index]));
    return groups.sort((a, b) => (primaryOrder.get(Number(a.primary.id || 0)) ?? 0) - (primaryOrder.get(Number(b.primary.id || 0)) ?? 0));
}

function getModalRelatedRows(row = getCurrentRow()) {
    if (!row) return [];
    const relatedIds = Array.isArray(state.modalRelatedScheduleIds) && state.modalRelatedScheduleIds.length
        ? state.modalRelatedScheduleIds
        : [row.id];
    const idSet = new Set(relatedIds.map((id) => Number(id || 0)).filter(Boolean));
    const rows = state.rows.filter((item) => idSet.has(Number(item.id || 0)));
    if (rows.length > 1) return rows;
    const visitId = String(row.combined_visit_id || '').trim();
    if (visitId) {
        const visitRows = state.rows.filter((item) => String(item.combined_visit_id || '').trim() === visitId);
        if (visitRows.length) return visitRows;
    }
    return rows.length ? rows : [row];
}

function loadCloseRequestLookup(rows = []) {
    state.closeRequestsBySchedule = new Map();
    rows
        .filter((row) => String(row.status || 'pending').trim().toLowerCase() === 'pending')
        .forEach((row) => {
            const scheduleId = String(row.schedule_id || '');
            if (scheduleId) state.closeRequestsBySchedule.set(scheduleId, row);
        });
}

function activeRows() {
    if (state.activeTab === 'closed') return state.rows.filter(isClosedOnSelectedDate);
    return state.activeTab === 'carryover' ? state.carryoverRows : state.todayRows;
}

function findFieldScheduleRow(scheduleId) {
    const id = Number(scheduleId || 0);
    if (!id) return null;
    return [
        ...activeRows(),
        ...state.todayRows,
        ...state.carryoverRows,
        ...state.rows
    ].find((row) => Number(row.id || 0) === id) || null;
}

function todayWorkingRows() {
    return workingRouteRows(state.todayRows);
}

function pastPendingWorkingRows() {
    return workingRouteRows(state.carryoverRows);
}

function workloadRows() {
    const seen = new Set();
    return [...todayWorkingRows(), ...pastPendingWorkingRows()].filter((row) => {
        const key = String(row.id || row._docId || row.route_doc_id || '');
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function isWorkingRouteRow(row) {
    return ['pending', 'carryover', 'ongoing'].includes(getStatusKey(row));
}

function workingRouteRows(rows = []) {
    return rows.filter(isWorkingRouteRow);
}

function closedRowsForSelectedDate() {
    return state.rows.filter(isClosedOnSelectedDate);
}

function setActiveTab(tab) {
    state.activeTab = tab === 'carryover' ? 'carryover' : (tab === 'closed' ? 'closed' : 'today');
    state.statusFilter = 'all';
    const statusFilter = document.getElementById('fieldStatusFilter');
    if (statusFilter) statusFilter.value = 'all';
    renderActiveView();
}

function setActiveView(view) {
    state.activeView = ['home', 'tasks', 'reimbursement', 'analytics', 'troubleshooting', 'solution-requests'].includes(view) ? view : 'home';
    if (state.activeView === 'reimbursement') {
        void loadReimbursementRequests();
    }
    if (state.activeView === 'troubleshooting') {
        void loadModelErrorGuides();
    }
    if (state.activeView === 'solution-requests') {
        void loadSolutionRequests();
    }
    renderActiveView();
}

function updateViewControls() {
    document.querySelectorAll('.field-view-tab[data-view]').forEach((button) => {
        const isActive = button.dataset.view === state.activeView;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('[data-view-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.viewPanel !== state.activeView;
    });
}

function updateTabControls() {
    document.querySelectorAll('.field-tab[data-tab]').forEach((button) => {
        const isActive = button.dataset.tab === state.activeTab;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    const todayCount = document.getElementById('fieldTodayCount');
    const carryoverCount = document.getElementById('fieldCarryoverCount');
    const closedCount = document.getElementById('fieldClosedCount');
    if (todayCount) todayCount.textContent = String(workingRouteRows(state.todayRows).length);
    if (carryoverCount) carryoverCount.textContent = String(workingRouteRows(state.carryoverRows).length);
    if (closedCount) closedCount.textContent = String(closedRowsForSelectedDate().length);
}

function updateSubtitle() {
    const subtitle = document.getElementById('fieldSubtitle');
    if (!subtitle) return;
    const date = state.selectedDate || document.getElementById('fieldDate')?.value || formatDateYmd(new Date());
    const newToday = todayWorkingRows().length;
    const pastPending = pastPendingWorkingRows().length;
    const closedToday = closedRowsForSelectedDate().length;
    const total = newToday + pastPending;
    subtitle.textContent = `${total} open workload task(s) for ${date}: ${newToday} new + ${pastPending} past pending, ${closedToday} closed.`;
}

function setRouteLoadProgress(percent, label, status = 'loading') {
    const progress = Math.max(0, Math.min(100, Number(percent || 0)));
    state.routeLoad = {
        active: status !== 'idle',
        label: String(label || ''),
        percent: progress,
        status
    };
    const wrapper = document.getElementById('fieldLoadProgress');
    const labelEl = document.getElementById('fieldLoadProgressLabel');
    const percentEl = document.getElementById('fieldLoadProgressPercent');
    const bar = document.getElementById('fieldLoadProgressBar');
    if (!wrapper || !labelEl || !percentEl || !bar) return;
    wrapper.hidden = !state.routeLoad.active;
    wrapper.classList.toggle('is-complete', status === 'complete');
    wrapper.classList.toggle('is-error', status === 'error');
    labelEl.textContent = state.routeLoad.label;
    percentEl.textContent = `${Math.round(progress)}%`;
    bar.style.setProperty('--field-load-progress', `${progress}%`);
}

function renderActiveView() {
    updateViewControls();
    updateTabControls();
    renderKpis();
    renderEndOfDayReview();
    renderList();
    renderAnalytics();
    renderReimbursementRequests();
    renderTroubleshootingGuide();
    renderSolutionRequests();
    updateSubtitle();
}

function populateReimbursementSelects() {
    const typeSelect = document.getElementById('fieldReimbursementType');
    const categorySelect = document.getElementById('fieldReimbursementCategory');
    if (typeSelect && !typeSelect.value) typeSelect.value = state.reimbursementMode || 'Reimbursement';
    if (categorySelect && !categorySelect.value) categorySelect.value = FIELD_REIMBURSEMENT_CATEGORIES[0];
}

async function loadReimbursementRequests(options = {}) {
    if (state.reimbursementLoaded && options.force !== true) {
        renderReimbursementRequests();
        return;
    }
    populateReimbursementSelects();
    try {
        const docs = await runQuery({
            from: [{ collectionId: PETTY_CASH_REQUEST_COLLECTION }],
            where: {
                fieldFilter: {
                    field: { fieldPath: 'staffId' },
                    op: 'EQUAL',
                    value: { integerValue: String(Number(state.staffId || 0)) }
                }
            },
            limit: 500
        });
        state.reimbursementRequests = docs
            .map((doc) => normalizeFieldReimbursementRequest(parseFirestoreDoc(doc)))
            .filter((request) => request.sourceModule === 'field_app')
            .sort((left, right) => `${right.dateSubmitted || right.createdAt || ''} ${right.id}`.localeCompare(`${left.dateSubmitted || left.createdAt || ''} ${left.id}`));
        state.reimbursementLoaded = true;
    } catch (error) {
        console.warn('Unable to load reimbursement requests:', error);
        const list = document.getElementById('fieldReimbursementList');
        if (list) list.innerHTML = '<div class="empty-state">Unable to load reimbursement requests. Please refresh when the connection is stable.</div>';
        return;
    }
    renderReimbursementRequests();
}

function renderReimbursementRequests() {
    const tabHolder = document.getElementById('fieldReimbursementStatusTabs');
    const list = document.getElementById('fieldReimbursementList');
    if (!tabHolder || !list) return;
    populateReimbursementSelects();
    const counts = new Map();
    FIELD_REIMBURSEMENT_TABS.forEach((tab) => counts.set(tab.id, 0));
    state.reimbursementRequests.forEach((request) => {
        const tab = FIELD_REIMBURSEMENT_TABS.find((item) => item.statuses.includes(request.status));
        if (tab) counts.set(tab.id, (counts.get(tab.id) || 0) + 1);
    });
    tabHolder.innerHTML = FIELD_REIMBURSEMENT_TABS.map((tab) => `
        <button type="button" class="field-reimbursement-tab${state.reimbursementActiveTab === tab.id ? ' is-active' : ''}" data-reimbursement-tab="${escapeHtml(tab.id)}" role="tab" aria-selected="${state.reimbursementActiveTab === tab.id ? 'true' : 'false'}">
            ${escapeHtml(tab.label)} <span>${counts.get(tab.id) || 0}</span>
        </button>
    `).join('');

    renderUnliquidatedAdvanceWarning();

    const activeTab = FIELD_REIMBURSEMENT_TABS.find((tab) => tab.id === state.reimbursementActiveTab) || FIELD_REIMBURSEMENT_TABS[0];
    const rows = state.reimbursementRequests.filter((request) => activeTab.statuses.includes(request.status));
    if (!rows.length) {
        list.innerHTML = '<div class="empty-state">No request in this tab.</div>';
        return;
    }
    list.innerHTML = rows.map((request) => {
        const canEdit = FIELD_REIMBURSEMENT_EDITABLE_STATUSES.has(request.status);
        const correction = request.correctionReason || request.rejectionReason || request.handlerRemarks || request.approvalRemarks || '';
        return `
            <article class="field-reimbursement-card">
                <div class="field-reimbursement-card-head">
                    <div>
                        <strong>${escapeHtml(request.id)}</strong>
                        <span>${escapeHtml(request.requestType)} · ${escapeHtml(request.expenseCategory || 'No category')}</span>
                    </div>
                    <span class="field-reimbursement-status ${slugify(request.status)}">${escapeHtml(request.status)}</span>
                </div>
                <div class="field-reimbursement-meta">
                    <span>${escapeHtml(formatLongDate(request.dateOfExpense || request.reportDate || request.requestDate))}</span>
                    <span>${formatPeso(request.amount)}</span>
                    <span>${escapeHtml(request.clientCompanyVisited || request.branchLocation || request.serviceTicketId || 'No client reference')}</span>
                </div>
                <p>${escapeHtml(request.description || request.notes || '-')}</p>
                ${correction ? `<div class="field-reimbursement-note">${escapeHtml(correction)}</div>` : ''}
                <div class="field-reimbursement-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-reimbursement-action="view" data-id="${escapeHtml(request.id)}">View</button>
                    ${canEdit ? `<button type="button" class="btn btn-primary btn-sm" data-reimbursement-action="edit" data-id="${escapeHtml(request.id)}">Edit</button>` : ''}
                    ${request.status === 'For Liquidation' || request.status === 'Partially Liquidated' ? `<button type="button" class="btn btn-primary btn-sm" data-reimbursement-action="liquidate" data-id="${escapeHtml(request.id)}">Submit Liquidation</button>` : ''}
                </div>
            </article>
        `;
    }).join('');
}

function renderUnliquidatedAdvanceWarning() {
    const warning = document.getElementById('fieldReimbursementWarning');
    if (!warning) return;
    const openAdvances = state.reimbursementRequests.filter((request) => (
        request.requestType === 'Cash Advance'
        && ['Approved', 'Paid / Released', 'For Liquidation', 'Partially Liquidated'].includes(request.status)
        && !['Liquidated', 'Closed'].includes(request.liquidationStatus)
    ));
    if (!openAdvances.length) {
        warning.hidden = true;
        warning.textContent = '';
        return;
    }
    const overdue = openAdvances.filter((request) => request.expectedLiquidationDate && request.expectedLiquidationDate < formatDateYmd(new Date()));
    warning.hidden = false;
    warning.textContent = overdue.length
        ? `You have ${overdue.length} overdue cash advance liquidation(s). New cash advances are blocked unless Owner/Admin overrides.`
        : `You have ${openAdvances.length} unliquidated cash advance(s). New cash advances are blocked unless Owner/Admin overrides.`;
}

function openReimbursementForm(request = null) {
    populateReimbursementSelects();
    const form = document.getElementById('fieldReimbursementForm');
    if (!form) return;
    form.hidden = false;
    resetReimbursementForm();
    if (request) fillReimbursementForm(request);
    else restoreReimbursementLocalDraft();
    syncReimbursementConditionalFields();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeReimbursementForm() {
    const form = document.getElementById('fieldReimbursementForm');
    if (form) form.hidden = true;
    state.editingReimbursementId = '';
    clearStoredReimbursementDraft();
    resetReimbursementForm();
}

function clearStoredReimbursementDraft() {
    try {
        localStorage.removeItem(fieldReimbursementDraftKey());
    } catch {
        // Ignore storage failures.
    }
}

let reimbursementDraftTimer = null;

function queueReimbursementDraftSave() {
    clearTimeout(reimbursementDraftTimer);
    reimbursementDraftTimer = setTimeout(saveReimbursementLocalDraft, 180);
}

function captureReimbursementLocalDraft() {
    const form = document.getElementById('fieldReimbursementForm');
    if (!form || form.hidden) return null;
    const values = {};
    FIELD_REIMBURSEMENT_PERSISTED_INPUT_IDS.forEach((id) => {
        values[id] = document.getElementById(id)?.value || '';
    });
    return {
        savedAt: new Date().toISOString(),
        editingId: state.editingReimbursementId || '',
        reimbursementMode: state.reimbursementMode || 'Reimbursement',
        values,
        draftItem: serializeReimbursementLocalItem(state.reimbursementDraftItem || createReimbursementItem()),
        items: state.reimbursementItems.map(serializeReimbursementLocalItem)
    };
}

function serializeReimbursementLocalItem(item = {}) {
    return {
        ...serializeReimbursementItem(item),
        receiptImageUrl: item.receiptFile ? '' : String(item.receiptImageUrl || '').trim(),
        receiptImageName: String(item.receiptImageName || '').trim(),
        receiptNeedsReselect: Boolean(item.receiptFile || item.receiptNeedsReselect)
    };
}

function saveReimbursementLocalDraft() {
    const draft = captureReimbursementLocalDraft();
    if (!draft) return;
    safeWriteJsonStorage(fieldReimbursementDraftKey(), draft);
}

function restoreReimbursementLocalDraft() {
    const draft = safeReadJsonStorage(fieldReimbursementDraftKey());
    if (!draft || !draft.values) return false;
    state.editingReimbursementId = String(draft.editingId || '');
    setReimbursementMode(draft.reimbursementMode === 'Cash Advance' ? 'Cash Advance' : 'Reimbursement');
    Object.entries(draft.values).forEach(([id, value]) => setFieldValue(id, value));
    state.reimbursementDraftItem = createReimbursementItem(draft.draftItem || {});
    state.reimbursementDraftItem.receiptNeedsReselect = draft.draftItem?.receiptNeedsReselect === true;
    state.reimbursementItems = Array.isArray(draft.items)
        ? draft.items.map((item) => {
            const row = createReimbursementItem(item);
            row.receiptNeedsReselect = item?.receiptNeedsReselect === true;
            return row;
        })
        : [];
    renderReimbursementItemEntry();
    renderReimbursementItemRows();
    renderReimbursementVisitedCard();
    syncReimbursementLiquidationMath();
    return true;
}

function resetReimbursementForm() {
    const form = document.getElementById('fieldReimbursementForm');
    if (!form) return;
    form.reset();
    state.reimbursementMode = 'Reimbursement';
    state.reimbursementItems = [];
    resetReimbursementDraftItem();
    document.getElementById('fieldReimbursementId').value = '';
    document.getElementById('fieldReimbursementReceiptUrl').value = '';
    document.getElementById('fieldReimbursementAdditionalUrl').value = '';
    document.getElementById('fieldReimbursementExpenseDate').value = state.selectedDate || document.getElementById('fieldDate')?.value || formatDateYmd(new Date());
    setReimbursementMode('Reimbursement');
    renderReimbursementItemEntry();
    renderReimbursementItemRows();
    renderReimbursementVisitedCard();
    syncReimbursementLiquidationMath();
}

function fillReimbursementForm(request) {
    state.editingReimbursementId = request.id;
    setFieldValue('fieldReimbursementId', request.id);
    setFieldValue('fieldReimbursementReceiptUrl', request.receiptImageUrl);
    setFieldValue('fieldReimbursementAdditionalUrl', request.additionalImageUrl);
    setReimbursementMode(request.requestType === 'Cash Advance' ? 'Cash Advance' : 'Reimbursement');
    setFieldValue('fieldReimbursementExpenseDate', request.dateOfExpense || request.reportDate);
    setFieldValue('fieldReimbursementDescription', request.description);
    setFieldValue('fieldReimbursementAdvanceAmount', request.cashAdvanceAmountRequested);
    setFieldValue('fieldReimbursementPaymentMethod', request.paymentMethodRequested || 'GCash');
    setFieldValue('fieldReimbursementGcash', request.staffGcashNumber);
    setFieldValue('fieldReimbursementBankName', request.staffBankName);
    setFieldValue('fieldReimbursementBankAccountName', request.staffBankAccountName);
    setFieldValue('fieldReimbursementBankAccountNumber', request.staffBankAccountNumber);
    setFieldValue('fieldReimbursementNotes', request.notes);
    state.reimbursementItems = normalizeReimbursementItems(request.lineItems || request.items || [buildLegacyReimbursementItem(request)]);
    resetReimbursementDraftItem();
    renderReimbursementItemEntry();
    renderReimbursementItemRows();
    renderReimbursementVisitedCard();
    syncReimbursementLiquidationMath();
}

function setFieldValue(id, value) {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = value == null ? '' : String(value);
}

function setImagePreviewFromUrl(previewId, hintId, url) {
    const preview = document.getElementById(previewId);
    const hint = document.getElementById(hintId);
    if (!preview || !hint || !url) return;
    preview.src = url;
    preview.hidden = false;
    hint.textContent = 'Existing uploaded image';
}

function syncReimbursementConditionalFields() {
    const isAdvance = state.reimbursementMode === 'Cash Advance';
    document.getElementById('fieldReimbursementAdvanceCard')?.classList.toggle('is-compact', !isAdvance);
    syncReimbursementLiquidationMath();
}

function syncReimbursementLiquidationMath() {
    const rowsTotal = getReimbursementItemsTotal();
    const advance = Number(document.getElementById('fieldReimbursementAdvanceAmount')?.value || 0);
    const effectiveAdvance = state.reimbursementMode === 'Cash Advance' ? advance : 0;
    const unused = Math.max(effectiveAdvance - rowsTotal, 0);
    const additional = state.reimbursementMode === 'Cash Advance' ? Math.max(rowsTotal - effectiveAdvance, 0) : rowsTotal;
    setFieldValue('fieldReimbursementAmount', state.reimbursementMode === 'Cash Advance' ? effectiveAdvance : rowsTotal);
    setFieldValue('fieldReimbursementLiquidatedAmount', rowsTotal);
    setFieldValue('fieldReimbursementUnusedReturned', unused ? unused.toFixed(2) : '');
    setFieldValue('fieldReimbursementAdditionalDue', additional ? additional.toFixed(2) : '');
    const totalEl = document.getElementById('fieldReimbursementRowsTotal');
    const changeEl = document.getElementById('fieldReimbursementReturnChange');
    const addEl = document.getElementById('fieldReimbursementAdditionalReimbursement');
    if (totalEl) totalEl.textContent = formatPeso(rowsTotal);
    if (changeEl) changeEl.textContent = formatPeso(unused);
    if (addEl) addEl.textContent = formatPeso(additional);
}

function setReimbursementMode(mode) {
    state.reimbursementMode = mode === 'Cash Advance' ? 'Cash Advance' : 'Reimbursement';
    setFieldValue('fieldReimbursementType', state.reimbursementMode);
    document.querySelectorAll('[data-reimbursement-mode]').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.reimbursementMode === state.reimbursementMode);
    });
    syncReimbursementConditionalFields();
}

function createReimbursementItem(item = {}) {
    const groupId = String(item.groupId || item.expenseGroup || 'fuel').trim();
    const group = getReimbursementGroup(groupId) || FIELD_REIMBURSEMENT_ITEM_GROUPS[0];
    return {
        id: String(item.id || item.lineId || `line-${Date.now()}-${Math.floor(Math.random() * 1000)}`).trim(),
        groupId: group.id,
        expenseGroup: group.id,
        expenseCategory: String(item.expenseCategory || group.category || '').trim(),
        accountId: String(item.accountId || group.accountId || '').trim(),
        itemNote: String(item.itemNote || item.description || '').trim(),
        supplierStoreName: String(item.supplierStoreName || item.supplier || '').trim(),
        amount: Number(item.amount || 0),
        receiptNumber: String(item.receiptNumber || '').trim(),
        receiptImageUrl: String(item.receiptImageUrl || item.receiptUrl || '').trim(),
        receiptImagePath: String(item.receiptImagePath || '').trim(),
        receiptImageName: String(item.receiptImageName || '').trim(),
        receiptFile: item.receiptFile || null,
        receiptNeedsReselect: item.receiptNeedsReselect === true
    };
}

function normalizeReimbursementItems(items = []) {
    const rows = Array.isArray(items) ? items.map((item) => createReimbursementItem(item)) : [];
    return rows;
}

function buildLegacyReimbursementItem(request = {}) {
    const group = FIELD_REIMBURSEMENT_ITEM_GROUPS.find((item) => item.category === request.expenseCategory) || FIELD_REIMBURSEMENT_ITEM_GROUPS[0];
    return createReimbursementItem({
        id: `${request.id || 'request'}-line-1`,
        groupId: group.id,
        expenseCategory: request.expenseCategory || group.category,
        accountId: request.accountId || group.accountId,
        itemNote: request.description,
        supplierStoreName: request.supplierStoreName,
        amount: request.amountLiquidated || request.receiptAmount || request.amount,
        receiptNumber: request.receiptNumber,
        receiptImageUrl: request.receiptImageUrl,
        receiptImagePath: request.receiptImagePath,
        receiptImageName: request.receiptImageName
    });
}

function getReimbursementGroup(groupId) {
    return FIELD_REIMBURSEMENT_ITEM_GROUPS.find((group) => group.id === groupId) || null;
}

function getReimbursementAccount(accountId) {
    return FIELD_REIMBURSEMENT_ACCOUNT_OPTIONS.find((account) => account.id === accountId) || null;
}

function resetReimbursementDraftItem() {
    state.reimbursementDraftItem = createReimbursementItem();
}

function renderReimbursementItemEntry() {
    const entry = document.getElementById('fieldReimbursementItemEntry');
    if (!entry) return;
    if (!state.reimbursementDraftItem) resetReimbursementDraftItem();
    const item = state.reimbursementDraftItem;
    entry.innerHTML = `
        <div class="field-reimbursement-entry-grid">
            <label><span>Item Group</span><select data-reimbursement-draft-field="groupId">${FIELD_REIMBURSEMENT_ITEM_GROUPS.map((group) => `<option value="${escapeHtml(group.id)}"${group.id === item.groupId ? ' selected' : ''}>${escapeHtml(group.label)}</option>`).join('')}</select></label>
            <label><span>Chart Of Account</span><select data-reimbursement-draft-field="accountId">${FIELD_REIMBURSEMENT_ACCOUNT_OPTIONS.map((account) => `<option value="${escapeHtml(account.id)}"${account.id === item.accountId ? ' selected' : ''}>${escapeHtml(account.label)}</option>`).join('')}</select></label>
            <label><span>Item / Part Note</span><input type="text" data-reimbursement-draft-field="itemNote" placeholder="Select item or choose manual" value="${escapeHtml(item.itemNote)}"></label>
            <label><span>Supplier / Store</span><input type="text" data-reimbursement-draft-field="supplierStoreName" placeholder="Type or select supplier/store" value="${escapeHtml(item.supplierStoreName)}"></label>
            <label><span>Amount</span><input type="number" data-reimbursement-draft-field="amount" min="0" step="0.01" placeholder="0.00" value="${item.amount ? escapeHtml(item.amount.toFixed(2)) : ''}"></label>
            <label><span>Receipt No.</span><input type="text" data-reimbursement-draft-field="receiptNumber" placeholder="OR/SI/receipt no." value="${escapeHtml(item.receiptNumber)}"></label>
            <div class="field-reimbursement-entry-action"><span>Action</span><button type="button" class="btn btn-secondary btn-sm" data-reimbursement-draft-clear>Remove</button></div>
        </div>
        <label class="field-reimbursement-entry-receipt">
            <span>Receipt Image <strong>Required</strong></span>
            <input type="file" accept="image/*" capture="environment" data-reimbursement-draft-receipt>
            ${item.receiptImageUrl ? `<img src="${escapeHtml(item.receiptImageUrl)}" alt="Receipt preview">` : ''}
            <small>${escapeHtml(item.receiptNeedsReselect ? `${item.receiptImageName || 'Receipt'} remembered. Please reselect before adding this row.` : (item.receiptImageName || 'Take photo or upload from gallery before adding this item row.'))}</small>
        </label>
    `;
}

function renderReimbursementItemRows() {
    const list = document.getElementById('fieldReimbursementItemList');
    if (!list) return;
    if (!state.reimbursementItems.length) {
        list.innerHTML = '<div class="field-reimbursement-empty-table">No item rows added yet.</div>';
        syncReimbursementLiquidationMath();
        return;
    }
    list.innerHTML = `
        <div class="field-reimbursement-table-wrap">
            <table class="field-reimbursement-items-table">
                <thead>
                    <tr>
                        <th>Item Group</th>
                        <th>Chart Of Account</th>
                        <th>Item / Part Note</th>
                        <th>Supplier / Store</th>
                        <th>Amount</th>
                        <th>Receipt</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>${state.reimbursementItems.map((item, index) => renderReimbursementItemRow(item, index)).join('')}</tbody>
            </table>
        </div>
    `;
    syncReimbursementLiquidationMath();
}

function renderReimbursementItemRow(item, index) {
    const group = getReimbursementGroup(item.groupId);
    const account = getReimbursementAccount(item.accountId);
    return `
        <tr data-index="${index}">
            <td data-label="Item Group">${escapeHtml(group?.label || item.expenseGroup || item.groupId || '-')}</td>
            <td data-label="Chart Of Account">${escapeHtml(account?.label || item.accountId || '-')}</td>
            <td data-label="Item / Part Note">${escapeHtml(item.itemNote || '-')}</td>
            <td data-label="Supplier / Store">${escapeHtml(item.supplierStoreName || '-')}</td>
            <td data-label="Amount">${escapeHtml(formatPeso(item.amount || 0))}</td>
            <td data-label="Receipt">
                <div class="field-reimbursement-table-receipt">
                    ${item.receiptImageUrl ? `<img src="${escapeHtml(item.receiptImageUrl)}" alt="Receipt preview">` : ''}
                    <span>${escapeHtml(item.receiptNeedsReselect ? `${item.receiptImageName || 'Receipt'} remembered. Reselect required.` : (item.receiptNumber || item.receiptImageName || 'Receipt attached'))}</span>
                    ${item.receiptNeedsReselect || (!item.receiptImageUrl && !item.receiptFile) ? `<input type="file" accept="image/*" capture="environment" data-reimbursement-row-receipt="${index}">` : ''}
                </div>
            </td>
            <td data-label="Action"><button type="button" class="btn btn-secondary btn-sm" data-reimbursement-remove="${index}">Remove</button></td>
        </tr>
    `;
}

function addReimbursementItemRow() {
    if (!state.reimbursementDraftItem) resetReimbursementDraftItem();
    const item = createReimbursementItem(state.reimbursementDraftItem);
    if (!item.groupId || !item.accountId) {
        alert('Select item group and chart of account first.');
        return;
    }
    if (!item.itemNote) {
        alert('Enter the item / part note.');
        return;
    }
    if (!item.supplierStoreName) {
        alert('Enter supplier / store.');
        return;
    }
    if (Number(item.amount || 0) <= 0) {
        alert('Enter amount before adding the row.');
        return;
    }
    if (!item.receiptImageUrl && !item.receiptFile) {
        alert('Receipt image is mandatory before adding the row.');
        return;
    }
    item.receiptNeedsReselect = false;
    state.reimbursementItems.push(item);
    resetReimbursementDraftItem();
    renderReimbursementItemEntry();
    renderReimbursementItemRows();
    queueReimbursementDraftSave();
}

function handleReimbursementDraftInput(event) {
    const field = event.target?.dataset?.reimbursementDraftField;
    if (!field) return;
    updateReimbursementDraftFromInput(event.target);
    queueReimbursementDraftSave();
}

function handleReimbursementDraftChange(event) {
    if (event.target?.matches('[data-reimbursement-draft-receipt]')) {
        if (!state.reimbursementDraftItem) resetReimbursementDraftItem();
        const file = event.target.files?.[0] || null;
        if (!file) return;
        state.reimbursementDraftItem.receiptFile = file;
        state.reimbursementDraftItem.receiptImageName = file.name || 'Selected receipt';
        state.reimbursementDraftItem.receiptImageUrl = URL.createObjectURL(file);
        state.reimbursementDraftItem.receiptNeedsReselect = false;
        renderReimbursementItemEntry();
        queueReimbursementDraftSave();
        return;
    }
    const field = event.target?.dataset?.reimbursementDraftField;
    if (!field) return;
    updateReimbursementDraftFromInput(event.target);
    if (field === 'groupId') {
        const group = getReimbursementGroup(state.reimbursementDraftItem?.groupId);
        if (state.reimbursementDraftItem && group) {
            state.reimbursementDraftItem.expenseGroup = group.id;
            state.reimbursementDraftItem.expenseCategory = group.category;
            state.reimbursementDraftItem.accountId = group.accountId;
            renderReimbursementItemEntry();
        }
    }
    queueReimbursementDraftSave();
}

function handleReimbursementDraftClick(event) {
    if (!event.target.closest('[data-reimbursement-draft-clear]')) return;
    resetReimbursementDraftItem();
    renderReimbursementItemEntry();
    queueReimbursementDraftSave();
}

function handleReimbursementItemsChange(event) {
    const receiptIndex = event.target?.dataset?.reimbursementRowReceipt;
    if (receiptIndex === undefined) return;
    const index = Number(receiptIndex);
    const item = state.reimbursementItems[index];
    const file = event.target.files?.[0] || null;
    if (!item || !file) return;
    item.receiptFile = file;
    item.receiptImageName = file.name || 'Selected receipt';
    item.receiptImageUrl = URL.createObjectURL(file);
    item.receiptNeedsReselect = false;
    renderReimbursementItemRows();
    queueReimbursementDraftSave();
}

function handleReimbursementItemsClick(event) {
    const button = event.target.closest('[data-reimbursement-remove]');
    if (!button) return;
    const index = Number(button.dataset.reimbursementRemove || -1);
    state.reimbursementItems = state.reimbursementItems.filter((_, itemIndex) => itemIndex !== index);
    renderReimbursementItemRows();
    queueReimbursementDraftSave();
}

function updateReimbursementDraftFromInput(input) {
    if (!state.reimbursementDraftItem) resetReimbursementDraftItem();
    const field = input.dataset.reimbursementDraftField;
    if (!field) return;
    state.reimbursementDraftItem[field] = field === 'amount' ? Number(input.value || 0) : String(input.value || '').trim();
    if (field === 'accountId') state.reimbursementDraftItem.accountId = String(input.value || '').trim();
}

function getReimbursementItemsTotal() {
    return state.reimbursementItems.reduce((total, item) => total + Number(item.amount || 0), 0);
}

function sumReimbursementItems(items = []) {
    return items.reduce((total, item) => total + Number(item.amount || 0), 0);
}

function serializeReimbursementItem(item = {}) {
    return {
        id: String(item.id || '').trim(),
        groupId: String(item.groupId || '').trim(),
        expenseGroup: String(item.expenseGroup || item.groupId || '').trim(),
        expenseCategory: String(item.expenseCategory || '').trim(),
        accountId: String(item.accountId || '').trim(),
        itemNote: String(item.itemNote || '').trim(),
        supplierStoreName: String(item.supplierStoreName || '').trim(),
        amount: Number(item.amount || 0),
        receiptNumber: String(item.receiptNumber || '').trim(),
        receiptImageUrl: String(item.receiptImageUrl || '').trim(),
        receiptImagePath: String(item.receiptImagePath || '').trim(),
        receiptImageName: String(item.receiptImageName || '').trim()
    };
}

function renderReimbursementVisitedCard() {
    const countEl = document.getElementById('fieldReimbursementVisitedCount');
    const details = document.getElementById('fieldReimbursementVisitedDetails');
    if (!countEl || !details) return;
    const rows = getClosedRowsForReimbursement();
    countEl.textContent = String(rows.length);
    details.innerHTML = rows.length
        ? rows.map((row) => `<button type="button" data-reimbursement-visit-id="${escapeHtml(row.id)}">${escapeHtml(getFieldRowCustomerLabel(row))}<small>${escapeHtml(getFieldRowReferenceLabel(row))}</small></button>`).join('')
        : '<div class="empty-state">No closed customer visits found for this date.</div>';
}

function toggleReimbursementVisitedDetails() {
    const details = document.getElementById('fieldReimbursementVisitedDetails');
    if (!details) return;
    details.hidden = !details.hidden;
}

function getClosedRowsForReimbursement() {
    return state.rows.filter(isClosedOnSelectedDate);
}

function getFieldRowCustomerLabel(row = {}) {
    return String(row.customer_name || row.companyname || row.company_name || row.customer || row.branch_customer_name || row.assigned_customer || row.client || 'Customer').trim();
}

function getFieldRowReferenceLabel(row = {}) {
    return [
        row.branchname || row.branch_name || row.location || '',
        row.purpose_label || PURPOSE_LABELS[Number(row.purpose || row.purpose_id || 0)] || '',
        row.id ? `#${row.id}` : ''
    ].filter(Boolean).join(' · ');
}

function previewReimbursementImage(inputId, previewId, hintId) {
    const file = document.getElementById(inputId)?.files?.[0];
    const preview = document.getElementById(previewId);
    const hint = document.getElementById(hintId);
    if (!file || !preview || !hint) return;
    preview.src = URL.createObjectURL(file);
    preview.onload = () => URL.revokeObjectURL(preview.src);
    preview.hidden = false;
    hint.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
}

async function saveReimbursementRequest(targetStatus) {
    const form = document.getElementById('fieldReimbursementForm');
    if (!form) return;
    const existing = state.reimbursementRequests.find((request) => request.id === state.editingReimbursementId) || null;
    const next = readReimbursementForm(targetStatus, existing);
    const validation = validateReimbursementRequest(next, existing);
    if (!validation.ok) {
        alert(validation.message);
        return;
    }
    const submitButton = targetStatus === 'Draft'
        ? document.getElementById('fieldReimbursementSaveDraft')
        : document.getElementById('fieldReimbursementSubmit');
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = targetStatus === 'Draft' ? 'Saving...' : 'Submitting...';
    }
    try {
        await attachReimbursementUploads(next);
        await setDocument(PETTY_CASH_REQUEST_COLLECTION, next.id, next);
        await writeReimbursementAudit(next.id, existing ? (targetStatus === 'Draft' ? 'Edited request' : 'Submitted request') : (targetStatus === 'Draft' ? 'Created request' : 'Submitted request'), existing, next);
        const index = state.reimbursementRequests.findIndex((request) => request.id === next.id);
        if (index >= 0) state.reimbursementRequests[index] = normalizeFieldReimbursementRequest(next);
        else state.reimbursementRequests.unshift(normalizeFieldReimbursementRequest(next));
        state.reimbursementLoaded = true;
        state.reimbursementActiveTab = targetStatus === 'Draft' ? 'Draft' : 'Submitted';
        clearStoredReimbursementDraft();
        closeReimbursementForm();
        renderReimbursementRequests();
        alert(targetStatus === 'Draft' ? 'Draft saved.' : 'Request submitted to Petty Cash.');
    } catch (error) {
        console.error('Failed to save reimbursement request:', error);
        alert(error.message || 'Unable to save reimbursement request.');
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = targetStatus === 'Draft' ? 'Save Draft' : 'Submit Request';
        }
    }
}

function readReimbursementForm(targetStatus, existing = null) {
    const user = MargaAuth.getUser();
    const now = new Date();
    const id = String(document.getElementById('fieldReimbursementId')?.value || existing?.id || createFieldReimbursementId()).trim();
    const requestType = existing?.status === 'For Liquidation' || existing?.status === 'Partially Liquidated'
        ? String(existing.requestType || 'Cash Advance').trim()
        : String(state.reimbursementMode || document.getElementById('fieldReimbursementType')?.value || '').trim();
    const items = normalizeReimbursementItems(state.reimbursementItems).filter((item) => item.groupId || item.accountId || item.itemNote || item.supplierStoreName || item.amount > 0 || item.receiptImageUrl || item.receiptFile);
    const rowsTotal = sumReimbursementItems(items);
    const amount = requestType === 'Cash Advance'
        ? Number(document.getElementById('fieldReimbursementAdvanceAmount')?.value || 0)
        : rowsTotal;
    const advanceAmount = Number(document.getElementById('fieldReimbursementAdvanceAmount')?.value || 0);
    const liquidatedAmount = rowsTotal;
    const primaryItem = items[0] || createReimbursementItem();
    const visitedRows = getClosedRowsForReimbursement();
    return {
        ...(existing || {}),
        id,
        requestId: id,
        expenseId: id,
        sourceModule: 'field_app',
        requestType,
        staffId: Number(state.staffId || user?.staff_id || 0) || 0,
        staffName: currentFieldDisplayName(),
        departmentTeam: String(user?.department || user?.department_name || user?.team || '').trim(),
        requestDate: existing?.requestDate || localDateYmd(now),
        reportDate: document.getElementById('fieldReimbursementExpenseDate')?.value || localDateYmd(now),
        dateOfExpense: document.getElementById('fieldReimbursementExpenseDate')?.value || localDateYmd(now),
        dateSubmitted: targetStatus === 'Submitted' ? now.toISOString() : String(existing?.dateSubmitted || ''),
        amount,
        expenseCategory: primaryItem.expenseCategory || '',
        description: document.getElementById('fieldReimbursementDescription')?.value || '',
        clientCompanyVisited: visitedRows.map(getFieldRowCustomerLabel).filter(Boolean).join(', ').slice(0, 500),
        branchLocation: visitedRows.map((row) => row.branchname || row.branch_name || row.location || '').filter(Boolean).join(', ').slice(0, 500),
        serviceTicketId: document.getElementById('fieldReimbursementServiceTicket')?.value || '',
        machineSerialNumber: document.getElementById('fieldReimbursementSerial')?.value || '',
        jobOrderReferenceNumber: document.getElementById('fieldReimbursementJobOrder')?.value || '',
        paymentMethodRequested: document.getElementById('fieldReimbursementPaymentMethod')?.value || '',
        staffGcashNumber: document.getElementById('fieldReimbursementGcash')?.value || '',
        staffBankName: document.getElementById('fieldReimbursementBankName')?.value || '',
        staffBankAccountName: document.getElementById('fieldReimbursementBankAccountName')?.value || '',
        staffBankAccountNumber: document.getElementById('fieldReimbursementBankAccountNumber')?.value || '',
        backupPayoutMethod: document.getElementById('fieldReimbursementBackupMethod')?.value || '',
        notes: document.getElementById('fieldReimbursementNotes')?.value || '',
        vehicleUsed: document.getElementById('fieldReimbursementVehicle')?.value || '',
        plateNumber: document.getElementById('fieldReimbursementPlate')?.value || '',
        startingOdometer: Number(document.getElementById('fieldReimbursementOdoStart')?.value || 0),
        endingOdometer: Number(document.getElementById('fieldReimbursementOdoEnd')?.value || 0),
        liters: Number(document.getElementById('fieldReimbursementLiters')?.value || 0),
        fuelStation: document.getElementById('fieldReimbursementFuelStation')?.value || '',
        routeDestination: document.getElementById('fieldReimbursementRoute')?.value || '',
        receiptImageUrl: primaryItem.receiptImageUrl || existing?.receiptImageUrl || '',
        additionalImageUrl: items[1]?.receiptImageUrl || existing?.additionalImageUrl || '',
        receiptNumber: primaryItem.receiptNumber || '',
        orSiNumber: document.getElementById('fieldReimbursementOrSi')?.value || '',
        supplierStoreName: primaryItem.supplierStoreName || '',
        receiptDate: document.getElementById('fieldReimbursementReceiptDate')?.value || '',
        receiptAmount: primaryItem.amount || 0,
        receiptException: false,
        receiptExceptionReason: document.getElementById('fieldReimbursementReceiptExceptionReason')?.value || '',
        originalReceiptSubmitted: document.getElementById('fieldReimbursementOriginalSubmitted')?.checked === true,
        originalReceiptSubmittedDate: document.getElementById('fieldReimbursementOriginalDate')?.value || '',
        receiptVerificationStatus: String(existing?.receiptVerificationStatus || 'Pending Review'),
        receiptVerifiedBy: String(existing?.receiptVerifiedBy || ''),
        cashAdvanceAmountRequested: advanceAmount,
        purposeOfAdvance: document.getElementById('fieldReimbursementAdvancePurpose')?.value || '',
        expectedLiquidationDate: document.getElementById('fieldReimbursementExpectedLiquidation')?.value || '',
        relatedServiceTicketClient: document.getElementById('fieldReimbursementServiceTicket')?.value || document.getElementById('fieldReimbursementClient')?.value || '',
        amountLiquidated: liquidatedAmount,
        unusedAmountReturned: Math.max((advanceAmount || amount) - liquidatedAmount, 0),
        additionalAmountForReimbursement: Math.max(liquidatedAmount - (advanceAmount || amount), 0),
        liquidationStatus: requestType === 'Liquidation' ? 'Submitted' : String(existing?.liquidationStatus || ''),
        approvedAmount: Number(existing?.approvedAmount || 0),
        paymentStatus: String(existing?.paymentStatus || ''),
        lineItems: items.map(serializeReimbursementItem),
        closedVisitCount: visitedRows.length,
        closedVisitDetails: visitedRows.map((row) => ({
            scheduleId: String(row.id || ''),
            customer: getFieldRowCustomerLabel(row),
            reference: getFieldRowReferenceLabel(row),
            closedAt: String(row.date_finished || row.closed_at || row.field_time_out || '')
        })),
        status: resolveReimbursementNextStatus(targetStatus, existing),
        createdAt: String(existing?.createdAt || now.toISOString()),
        updatedAt: now.toISOString()
    };
}

function resolveReimbursementNextStatus(targetStatus, existing = null) {
    if (targetStatus !== 'Submitted') {
        return existing?.status === 'Incomplete / Needs Correction' ? 'Incomplete / Needs Correction' : 'Draft';
    }
    if (existing?.status === 'For Liquidation' || existing?.status === 'Partially Liquidated') {
        return 'Partially Liquidated';
    }
    return 'Submitted';
}

function validateReimbursementRequest(request, existing = null) {
    if (existing && !FIELD_REIMBURSEMENT_EDITABLE_STATUSES.has(existing.status)) {
        return { ok: false, message: 'This request can no longer be edited after approval/review.' };
    }
    if (!request.requestType) return { ok: false, message: 'Request type is required.' };
    if (request.requestType === 'Cash Advance' && request.amount <= 0) return { ok: false, message: 'Cash advance amount is required.' };
    if (!request.expenseCategory) return { ok: false, message: 'Expense category is required.' };
    if (!request.description) return { ok: false, message: 'Description / purpose is required.' };
    const isSubmit = !['Draft', 'Incomplete / Needs Correction'].includes(request.status);
    const items = normalizeReimbursementItems(state.reimbursementItems).filter((item) => item.groupId || item.accountId || item.itemNote || item.supplierStoreName || item.amount > 0 || item.receiptImageUrl || item.receiptFile);
    if (!items.length || !items.some((item) => Number(item.amount || 0) > 0)) {
        return { ok: false, message: 'Add at least one item row with amount.' };
    }
    const missingReceipt = items.find((item) => item.receiptNeedsReselect || (!item.receiptImageUrl && !item.receiptFile));
    if (isSubmit && missingReceipt) {
        return { ok: false, message: 'Receipt image is mandatory for every item row.' };
    }
    const invalidRow = items.find((item) => !item.groupId || !item.accountId || !item.supplierStoreName || Number(item.amount || 0) <= 0);
    if (invalidRow) {
        return { ok: false, message: 'Each item row needs item group, chart account, supplier/store, amount, and receipt.' };
    }
    if (isSubmit && request.requestType === 'Cash Advance') {
        const openAdvance = state.reimbursementRequests.find((item) => (
            item.id !== request.id
            && item.requestType === 'Cash Advance'
            && ['Approved', 'Paid / Released', 'For Liquidation', 'Partially Liquidated'].includes(item.status)
            && !['Liquidated', 'Closed'].includes(item.liquidationStatus)
        ));
        if (openAdvance) {
            return { ok: false, message: `Existing unliquidated cash advance ${openAdvance.id} must be liquidated before creating a new cash advance.` };
        }
    }
    return { ok: true };
}

async function attachReimbursementUploads(request) {
    const nextItems = [];
    for (const item of normalizeReimbursementItems(state.reimbursementItems)) {
        const nextItem = { ...item };
        if (nextItem.receiptFile) {
            const upload = await prepareReimbursementImageUpload(nextItem.receiptFile, request.id, nextItem.id || 'receipt');
            nextItem.receiptImageUrl = upload.url;
            nextItem.receiptImagePath = upload.path;
            nextItem.receiptImageName = nextItem.receiptFile.name || nextItem.receiptImageName || 'Receipt image';
        }
        nextItems.push(nextItem);
    }
    state.reimbursementItems = nextItems;
    request.lineItems = nextItems.map(serializeReimbursementItem);
    const first = request.lineItems[0] || null;
    request.receiptImageUrl = first?.receiptImageUrl || request.receiptImageUrl || '';
    request.receiptImagePath = first?.receiptImagePath || request.receiptImagePath || '';
    request.receiptImageName = first?.receiptImageName || request.receiptImageName || '';
    request.additionalImageUrl = request.lineItems[1]?.receiptImageUrl || request.additionalImageUrl || '';
}

async function prepareReimbursementImageUpload(file, requestId, kind) {
    const blob = await compressImageFile(file, { maxDimension: 1400, quality: 0.74 });
    return uploadReimbursementImageToStorage(blob, { requestId, kind });
}

async function uploadReimbursementImageToStorage(blob, { requestId, kind }) {
    const bucket = String(FIREBASE_CONFIG.storageBucket || '').trim();
    if (!bucket) throw new Error('Firebase Storage bucket is not configured.');
    const token = randomToken();
    const path = [
        'pettycash-field-requests',
        localDateYmd(new Date()),
        safeStorageSegment(requestId),
        `${safeStorageSegment(kind)}-${Date.now()}.jpg`
    ].join('/');
    const boundary = `marga-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const metadata = {
        name: path,
        contentType: 'image/jpeg',
        metadata: { firebaseStorageDownloadTokens: token }
    };
    const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
        JSON.stringify(metadata),
        `\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`,
        blob,
        `\r\n--${boundary}--`
    ], { type: `multipart/related; boundary=${boundary}` });
    const response = await fetch(
        `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=multipart&key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`,
        { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) throw new Error(payload?.error?.message || 'Receipt image upload failed.');
    return {
        path,
        url: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`,
        size: Number(blob.size || 0) || 0
    };
}

async function writeReimbursementAudit(requestId, action, previous, next, remarks = '') {
    const user = MargaAuth.getUser();
    const now = new Date().toISOString();
    const docId = `${requestId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await setDocument(PETTY_CASH_AUDIT_COLLECTION, docId, {
        id: docId,
        requestId,
        action,
        userId: String(user?.staff_id || user?.id || state.staffId || ''),
        userName: currentFieldDisplayName(),
        role: currentFieldRoles().join(', '),
        timestamp: now,
        previousValue: previous ? JSON.stringify(previous).slice(0, 3000) : '',
        newValue: next ? JSON.stringify(next).slice(0, 3000) : '',
        remarks
    });
}

function handleReimbursementListAction(event) {
    const button = event.target.closest('[data-reimbursement-action][data-id]');
    if (!button) return;
    const request = state.reimbursementRequests.find((item) => item.id === button.dataset.id);
    if (!request) return;
    const action = button.dataset.reimbursementAction;
    if (action === 'view') {
        alert(buildReimbursementViewText(request));
        return;
    }
    if (action === 'edit') {
        openReimbursementForm(request);
        return;
    }
    if (action === 'liquidate') {
        openReimbursementForm(request);
    }
}

function buildReimbursementViewText(request) {
    return [
        `${request.id} - ${request.status}`,
        `${request.requestType} / ${request.expenseCategory}`,
        `Amount: ${formatPeso(request.amount)}`,
        `Approved: ${request.approvedAmount ? formatPeso(request.approvedAmount) : '-'}`,
        `Payment: ${request.paymentStatus || '-'}`,
        `Client/Ref: ${request.clientCompanyVisited || request.serviceTicketId || '-'}`,
        `Receipt: ${request.receiptNumber || request.orSiNumber || '-'}`,
        request.rejectionReason ? `Rejected: ${request.rejectionReason}` : '',
        request.correctionReason ? `Correction: ${request.correctionReason}` : '',
        request.handlerRemarks ? `Petty Cash: ${request.handlerRemarks}` : '',
        request.approvalRemarks ? `Approval: ${request.approvalRemarks}` : ''
    ].filter(Boolean).join('\n');
}

function normalizeFieldReimbursementRequest(row = {}) {
    return {
        ...row,
        id: String(row.id || row.requestId || '').trim(),
        sourceModule: String(row.sourceModule || '').trim(),
        requestType: String(row.requestType || row.type || '').trim(),
        staffId: Number(row.staffId || 0),
        staffName: String(row.staffName || '').trim(),
        status: String(row.status || 'Draft').trim(),
        amount: Number(row.amount || 0),
        approvedAmount: Number(row.approvedAmount || 0),
        receiptAmount: Number(row.receiptAmount || 0),
        cashAdvanceAmountRequested: Number(row.cashAdvanceAmountRequested || 0),
        amountLiquidated: Number(row.amountLiquidated || 0),
        unusedAmountReturned: Number(row.unusedAmountReturned || 0),
        additionalAmountForReimbursement: Number(row.additionalAmountForReimbursement || 0),
        receiptException: row.receiptException === true || row.receiptException === 'true',
        originalReceiptSubmitted: row.originalReceiptSubmitted === true || row.originalReceiptSubmitted === 'true'
    };
}

function createFieldReimbursementId() {
    return `FR-${formatDateYmd(new Date()).replace(/-/g, '')}-${state.staffId || '0'}-${Date.now().toString().slice(-6)}`;
}

function formatPeso(value) {
    return `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTaskDateTime(value) {
    const safeValue = normalizeLegacyDateTime(value);
    if (!safeValue) return '-';
    const normalized = String(safeValue).replace(' ', 'T');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return safeValue;
    return parsed.toLocaleString('en-PH', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getRouteTaskDateTime(row) {
    const routeValue = String(row?.route_task_datetime || '').trim();
    if (routeValue) return routeValue;
    return String(row?.task_datetime || '').trim();
}

function getAssignedStaffId(row) {
    return Number(row?.route_tech_id || row?.tech_id || 0);
}

function pickLatestRouteRows(rows, selectedDate) {
    const latestBySchedule = new Map();

    rows.forEach((row) => {
        const scheduleId = Number(row.schedule_id || 0);
        if (scheduleId <= 0) return;
        if (selectedDate && String(row.task_datetime || '').slice(0, 10) !== selectedDate) return;
        const current = latestBySchedule.get(scheduleId);
        if (!current || Number(row.id || 0) > Number(current.id || 0)) {
            latestBySchedule.set(scheduleId, row);
        }
    });

    return [...latestBySchedule.values()];
}

function mergeTodayRouteRows(printedRows, savedRows) {
    const merged = new Map();
    printedRows.forEach((row) => {
        const scheduleId = Number(row.schedule_id || 0);
        if (scheduleId > 0) merged.set(scheduleId, { ...row, _routeSource: 'printed' });
    });
    savedRows.forEach((row) => {
        const scheduleId = Number(row.schedule_id || 0);
        if (scheduleId > 0 && !merged.has(scheduleId)) {
            merged.set(scheduleId, { ...row, _routeSource: 'saved' });
        }
    });
    return [...merged.values()];
}

async function fetchDocsByIdList(collection, ids) {
    const uniqueIds = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
    if (!uniqueIds.length) return new Map();

    const docs = await Promise.all(uniqueIds.map(async (id) => {
        const directDoc = await fetchDoc(collection, String(id));
        if (collection !== 'tbl_schedule') return directDoc;
        if (Number(directDoc?.id || 0) === Number(id)) return directDoc;
        const matches = await queryEquals(collection, 'id', Number(id), 'integer', 5).catch(() => []);
        return matches.map(parseFirestoreDoc).filter(Boolean).find((doc) => Number(doc.id || 0) === Number(id)) || directDoc;
    }));
    const rows = mergePendingOfflineRows(collection, docs.filter(Boolean));
    return new Map(
        rows
            .map((doc) => [String(doc.id || doc._docId || ''), doc])
            .filter(([key]) => key)
    );
}

async function buildRouteBoundRows(routeRows, routeSourceLabel) {
    const scheduleIds = routeRows.map((row) => Number(row.schedule_id || 0)).filter((id) => id > 0);
    const scheduleMap = await fetchDocsByIdList('tbl_schedule', scheduleIds);

    return routeRows
        .map((routeRow) => {
            const scheduleId = Number(routeRow.schedule_id || 0);
            const schedule = scheduleMap.get(String(scheduleId));
            if (!schedule) return null;

            return {
                ...schedule,
                task_datetime: String(routeRow.task_datetime || schedule.task_datetime || ''),
                tech_id: Number(routeRow.tech_id || schedule.tech_id || 0) || 0,
                route_id: Number(routeRow.id || 0) || 0,
                route_doc_id: routeRow._docId || String(routeRow.id || ''),
                route_source: routeRow._routeSource || routeSourceLabel,
                route_tech_id: Number(routeRow.tech_id || 0) || 0,
                route_task_datetime: String(routeRow.task_datetime || ''),
                route_status: routeRow.status ?? '',
                route_iscancelled: Number(routeRow.iscancelled || routeRow.iscancel || 0) || 0,
                route_date_finished: String(routeRow.date_finished || ''),
                route_remarks: String(routeRow.remarks || '').trim(),
                route_bridge_pushed_at: String(routeRow.bridge_pushed_at || ''),
                route_timestmp: String(routeRow.timestmp || '')
            };
        })
        .filter(Boolean);
}

function toDbDateTimeFromLocal(localValue) {
    if (!localValue) return ZERO_DATETIME;
    const normalized = String(localValue).replace(' ', 'T');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return ZERO_DATETIME;
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mi = String(parsed.getMinutes()).padStart(2, '0');
    const ss = String(parsed.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function toLocalInputDateTime(dbValue) {
    const value = normalizeLegacyDateTime(dbValue);
    if (!value) return '';
    const normalized = value.replace(' ', 'T');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
        if (value.length >= 16) return value.slice(0, 16).replace(' ', 'T');
        return '';
    }
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mi = String(parsed.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function nowDbDateTime() {
    return toDbDateTimeFromLocal(toLocalInputDateTime(new Date().toISOString()));
}

function attendanceDocId(staffId, date) {
    return `${Number(staffId || 0) || 0}_${String(date || '').replace(/[^0-9]/g, '')}`;
}

function formatAttendanceTime(value) {
    const normalized = normalizeLegacyDateTime(value);
    if (!normalized) return '--:--';
    const local = toLocalInputDateTime(normalized);
    const time = String(local || normalized).slice(11, 16);
    if (!time) return '--:--';
    const [hour, minute] = time.split(':').map((part) => Number(part));
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function getAttendanceGraceDateTime(selectedDate) {
    const [year, month, day] = String(selectedDate || localDateYmd()).split('-').map((part) => Number(part));
    const [hour, minute] = FIELD_ATTENDANCE_START_TIME.split(':').map((part) => Number(part));
    const date = new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0);
    date.setMinutes(date.getMinutes() + FIELD_ATTENDANCE_GRACE_MINUTES);
    return date;
}

function getAttendanceTimeliness(attendance = state.attendance || {}) {
    const timeIn = normalizeLegacyDateTime(attendance.time_in);
    if (!timeIn) return { status: 'missing', label: 'No official Time In yet.', lateMinutes: 0 };
    const selectedDate = attendance.attendance_date || state.selectedDate || document.getElementById('fieldDate')?.value || localDateYmd();
    const timeInDate = new Date(timeIn.replace(' ', 'T'));
    const graceDate = getAttendanceGraceDateTime(selectedDate);
    if (Number.isNaN(timeInDate.getTime())) return { status: 'unknown', label: 'Time In saved, timeliness unknown.', lateMinutes: 0 };
    const lateMinutes = Math.max(0, Math.ceil((timeInDate.getTime() - graceDate.getTime()) / 60000));
    if (!lateMinutes) return { status: 'on_time', label: `On time. Grace until ${formatAttendanceTime(`${selectedDate} 08:15:00`)}.`, lateMinutes: 0 };
    return { status: 'late', label: `Late by ${lateMinutes} minute${lateMinutes === 1 ? '' : 's'}.`, lateMinutes };
}

function formatAttendanceLocationLine(attendance = state.attendance || {}) {
    const companyName = firstNonBlank(attendance.time_in_company_name);
    const branchName = firstNonBlank(attendance.time_in_branch_name);
    const address = firstNonBlank(attendance.time_in_address);
    const distance = Number(attendance.time_in_distance_meters || 0);
    const locationLabel = [companyName, branchName].filter(Boolean).join(' - ');
    if (!locationLabel && !address) return 'Location not captured';
    const atLine = `at ${[locationLabel, address].filter(Boolean).join(', ')}`;
    return distance > 0 ? `${atLine} (${Math.round(distance)}m)` : atLine;
}

function branchAddressText(branch = {}, area = null) {
    const exact = firstNonBlank(
        branch.address,
        branch.branch_address,
        branch.branchaddress,
        branch.complete_address,
        branch.full_address,
        branch.location_address,
        branch.location
    );
    if (exact) return exact;
    const parts = [
        firstNonBlank(branch.unit, branch.room, branch.floor),
        firstNonBlank(branch.building, branch.bldg, branch.building_name),
        firstNonBlank(branch.street, branch.street_address, branch.road),
        firstNonBlank(branch.barangay, branch.brgy),
        firstNonBlank(branch.city, branch.municipality),
        firstNonBlank(branch.province),
        firstNonBlank(area?.area_name)
    ].filter(Boolean);
    return [...new Set(parts)].join(', ');
}

function scheduleLocationLabel(row) {
    const branch = caches.branch.get(String(row?.branch_id || 0)) || {};
    const company = caches.company.get(String(row?.company_id || branch.company_id || 0)) || {};
    const area = caches.area.get(String(row?.area_id || branch.area_id || 0)) || null;
    const companyName = firstNonBlank(company.companyname, row?.company_name, row?.client_name);
    const branchName = firstNonBlank(branch.branchname, row?.branch_name, row?.customer_branch, row?.branch);
    const address = branchAddressText(branch, area);
    return {
        companyName,
        branchName,
        address,
        label: [companyName, branchName].filter(Boolean).join(' - ') || `Schedule #${row?.id || ''}`
    };
}

function locationName(location) {
    return String(location?.name || location?.location_name || location?.label || location?._docId || 'Work location').trim();
}

function locationType(location) {
    return String(location?.type || location?.location_type || '').trim().toLowerCase();
}

function isActiveWorkLocation(location) {
    if (!location) return false;
    if (location.active === false || location.isActive === false || location.is_active === false) return false;
    return FIELD_WORK_LOCATION_TYPES.has(locationType(location));
}

function workLocationCoordinates(location) {
    const latitude = parseCoordinate(location?.latitude ?? location?.lat);
    const longitude = parseCoordinate(location?.longitude ?? location?.lng ?? location?.lon);
    if (latitude === null || longitude === null) return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return { latitude, longitude };
}

async function loadFieldWorkLocations() {
    if (state.fieldWorkLocationsLoaded) return state.fieldWorkLocations;
    const docs = await queryCollection(WORK_LOCATIONS_COLLECTION, 200).catch(() => []);
    state.fieldWorkLocations = docs
        .map(parseFirestoreDoc)
        .filter((location) => isActiveWorkLocation(location) && workLocationCoordinates(location));
    state.fieldWorkLocationsLoaded = true;
    return state.fieldWorkLocations;
}

async function loadPinnedCustomerBranches() {
    if (state.pinnedCustomerBranchesLoaded) return state.pinnedCustomerBranches;
    const cached = [...caches.branch.values()].filter((branch) => getBranchCoordinates(branch));
    const branchFields = ['id', 'company_id', 'area_id', 'branchname', 'branch_name', 'address', 'latitude', 'longitude', 'lat', 'lng', 'lon'];
    const docs = await queryCollectionSelect('tbl_branchinfo', branchFields, FIELD_BRANCH_LOCATION_QUERY_LIMIT).catch((error) => {
        console.warn('Pinned customer branch lookup failed:', error);
        return [];
    });
    const byId = new Map();
    cached.forEach((branch) => {
        const id = String(branch?.id || branch?._docId || '').trim();
        if (id) byId.set(id, branch);
    });
    docs.map(parseFirestoreDoc).filter(Boolean).forEach((branch) => {
        const id = String(branch?.id || branch?._docId || '').trim();
        if (id && !byId.has(id)) byId.set(id, branch);
    });
    state.pinnedCustomerBranches = [...byId.values()].filter((branch) => getBranchCoordinates(branch));
    state.pinnedCustomerBranchesLoaded = true;
    return state.pinnedCustomerBranches;
}

async function buildCustomerBranchLocationItem(branch, latitude, longitude, accuracy) {
    const coords = getBranchCoordinates(branch);
    if (!coords) return null;
    const companyId = Number(branch.company_id || branch.comp_id || 0) || 0;
    const company = companyId ? await ensureLookup('tbl_companylist', companyId, caches.company).catch(() => null) : null;
    const areaId = Number(branch.area_id || 0) || 0;
    const area = areaId ? await ensureLookup('tbl_area', areaId, caches.area).catch(() => null) : null;
    const companyName = firstNonBlank(company?.companyname, branch.company_name, branch.customer_name);
    const branchName = firstNonBlank(branch.branchname, branch.branch_name, branch.location, `Branch #${branch.id || branch._docId || ''}`);
    const address = branchAddressText(branch, area);
    const distance = distanceMeters(latitude, longitude, coords.latitude, coords.longitude);
    return {
        branch,
        company,
        area,
        coords,
        latitude,
        longitude,
        accuracy,
        distance,
        companyId,
        branchId: Number(branch.id || branch._docId || 0) || 0,
        areaId,
        companyName,
        branchName,
        address,
        label: [companyName, branchName].filter(Boolean).join(' - ') || `Branch #${branch.id || branch._docId || ''}`
    };
}

async function findNearestPinnedCustomerBranch(latitude, longitude, accuracy) {
    const branches = await loadPinnedCustomerBranches();
    const ranked = branches
        .map((branch) => {
            const coords = getBranchCoordinates(branch);
            if (!coords) return null;
            return {
                branch,
                distance: distanceMeters(latitude, longitude, coords.latitude, coords.longitude)
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.distance - b.distance);
    const nearest = ranked[0] || null;
    if (!nearest || nearest.distance > ATTENDANCE_LOCATION_RADIUS_METERS) return null;
    return buildCustomerBranchLocationItem(nearest.branch, latitude, longitude, accuracy);
}

function makeScheduleRowFromNearbyMatch(scheduleId, match, purposeId, taskDatetime, nowIso) {
    const purposeLabel = PURPOSE_LABELS[purposeId] || `Purpose ${purposeId}`;
    return {
        id: scheduleId,
        _docId: String(scheduleId),
        company_id: match.companyId,
        branch_id: match.branchId,
        area_id: match.areaId,
        serial: 0,
        mach_id: 0,
        machine_id: 0,
        caller: purposeLabel,
        phone_number: '',
        purpose_id: purposeId,
        purpose: purposeLabel,
        trouble: purposeLabel,
        trouble_id: 0,
        task_datetime: taskDatetime,
        original_sched: taskDatetime,
        tech_id: Number(state.staffId || 0) || 0,
        remarks: 'Field staff added schedule from GPS-matched pinned customer site.',
        status: 1,
        isongoing: 0,
        date_finished: ZERO_DATETIME,
        iscancel: 0,
        scheduled: 1,
        from_mobileapp: 1,
        request_origin: 'field_attendance_self_add',
        self_added_for_attendance: 1,
        self_added_at: nowIso,
        self_added_by: Number(state.staffId || 0) || 0,
        self_added_latitude: match.latitude.toFixed(7),
        self_added_longitude: match.longitude.toFixed(7),
        self_added_accuracy_meters: Math.round(match.accuracy),
        self_added_distance_meters: Math.round(match.distance),
        self_added_location_status: 'matched_customer_pin',
        branch_name: match.branchName || '',
        company_name: match.companyName || '',
        route_id: 0,
        route_doc_id: '',
        route_source: 'Field Self Added',
        route_tech_id: Number(state.staffId || 0) || 0,
        route_task_datetime: taskDatetime,
        route_status: '',
        route_iscancelled: 0,
        route_date_finished: '',
        route_remarks: 'Field staff added from current pinned customer location',
        bridge_updated_at: nowIso,
        bridge_updated_by: Number(state.staffId || 0) || 0
    };
}

function distanceMeters(aLat, aLng, bLat, bLng) {
    const radius = 6371000;
    const toRad = (value) => (value * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const lat1 = toRad(aLat);
    const lat2 = toRad(bLat);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const haversine = (sinLat * sinLat) + (Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng);
    return radius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function formatDistanceForLocationCheck(meters) {
    const distance = Number(meters || 0);
    if (!Number.isFinite(distance)) return '-';
    if (distance >= 1000) return `${(distance / 1000).toFixed(distance >= 10000 ? 1 : 2)}km`;
    return `${Math.round(distance)}m`;
}

async function getAttendanceLocationSnapshot({ withGps = false } = {}) {
    const rows = workloadRows();
    if (!withGps && !rows.length) {
        return {
            rows,
            pinnedRows: [],
            missingPinRows: [],
            latitude: null,
            longitude: null,
            accuracy: null,
            ranked: [],
            nearest: null,
            workLocationRanked: [],
            nearestWorkLocation: null,
            nearbyCustomerBranch: null
        };
    }

    if (rows.length) await hydrateLookups(rows);
    const pinnedRows = [];
    const missingPinRows = [];
    rows.forEach((row) => {
        const branch = caches.branch.get(String(row.branch_id || 0));
        const coords = getBranchCoordinates(branch);
        if (!coords) {
            missingPinRows.push({ row, branch, ...scheduleLocationLabel(row) });
            return;
        }
        pinnedRows.push({ row, branch, coords, ...scheduleLocationLabel(row) });
    });

    if (!withGps) {
        return {
            rows,
            pinnedRows,
            missingPinRows,
            latitude: null,
            longitude: null,
            accuracy: null,
            ranked: [],
            nearest: null,
            workLocationRanked: [],
            nearestWorkLocation: null,
            nearbyCustomerBranch: null
        };
    }

    const position = await getCurrentPosition();
    const latitude = Number(position.coords.latitude);
    const longitude = Number(position.coords.longitude);
    const accuracy = Number(position.coords.accuracy || 0);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('GPS returned an invalid location.');
    }

    const ranked = pinnedRows
        .map((item) => ({
            ...item,
            distance: distanceMeters(latitude, longitude, item.coords.latitude, item.coords.longitude)
        }))
        .sort((a, b) => a.distance - b.distance);

    const workLocations = await loadFieldWorkLocations();
    const workLocationRanked = workLocations
        .map((location) => {
            const coords = workLocationCoordinates(location);
            return {
                location,
                coords,
                latitude,
                longitude,
                accuracy,
                distance: distanceMeters(latitude, longitude, coords.latitude, coords.longitude)
            };
        })
        .sort((a, b) => a.distance - b.distance);

    let nearbyCustomerBranch = null;
    const scheduledMatch = ranked[0] || null;
    const workMatch = workLocationRanked[0] || null;
    if ((!scheduledMatch || scheduledMatch.distance > ATTENDANCE_LOCATION_RADIUS_METERS)
        && (!workMatch || workMatch.distance > ATTENDANCE_LOCATION_RADIUS_METERS)) {
        nearbyCustomerBranch = await findNearestPinnedCustomerBranch(latitude, longitude, accuracy);
    }

    return {
        rows,
        pinnedRows,
        missingPinRows,
        latitude,
        longitude,
        accuracy,
        ranked,
        nearest: ranked[0] || null,
        workLocationRanked,
        nearestWorkLocation: workLocationRanked[0] || null,
        nearbyCustomerBranch
    };
}

async function getAttendanceScheduleLocationMatch() {
    const snapshot = await getAttendanceLocationSnapshot({ withGps: true });
    const workLocation = snapshot.nearestWorkLocation;
    if (workLocation && workLocation.distance <= ATTENDANCE_LOCATION_RADIUS_METERS) {
        return {
            type: 'work_location',
            latitude: snapshot.latitude,
            longitude: snapshot.longitude,
            accuracy: snapshot.accuracy,
            workLocation
        };
    }

    if (!snapshot.rows.length) {
        if (snapshot.nearbyCustomerBranch) {
            throw new Error(`No open or pending schedule is available for this customer. Tap Add Schedule for ${snapshot.nearbyCustomerBranch.label}, choose a purpose, save, then Time In.`);
        }
        throw new Error('No open or pending schedule is available for this route date, and you are not within an office/production pin. Time In is blocked.');
    }

    if (!snapshot.pinnedRows.length) {
        const sample = snapshot.missingPinRows.slice(0, 3).map((item) => item.label).filter(Boolean).join(', ');
        throw new Error(`No scheduled customer has a saved pin yet. Open the customer task, tap Pin Customer Location while on site, then Time In.${sample ? ` Missing pin example: ${sample}.` : ''}`);
    }

    const nearest = snapshot.nearest;
    if (!nearest || nearest.distance > ATTENDANCE_LOCATION_RADIUS_METERS) {
        if (snapshot.nearbyCustomerBranch) {
            throw new Error(`You are within ${formatDistanceForLocationCheck(snapshot.nearbyCustomerBranch.distance)} of ${snapshot.nearbyCustomerBranch.label}, but no schedule is assigned to you there. Tap Add Schedule, choose the purpose, save, then Time In.`);
        }
        const missingPinHint = snapshot.missingPinRows.length
            ? ' If you are already at a scheduled customer with no saved pin, open that task, tap Pin Customer Location, then Time In.'
            : '';
        const message = nearest
            ? `You are ${Math.round(nearest.distance)}m from the nearest open/pending scheduled customer (${nearest.label}). Time In requires ${ATTENDANCE_LOCATION_RADIUS_METERS}m maximum.${missingPinHint}`
            : `No pinned open/pending customer was found for attendance matching.${missingPinHint}`;
        throw new Error(message);
    }

    return {
        type: 'scheduled_customer',
        latitude: snapshot.latitude,
        longitude: snapshot.longitude,
        accuracy: snapshot.accuracy,
        nearest
    };
}

function hasCustomerTimeInLocationProof(row) {
    const status = String(row?.field_time_in_location_status || '').trim();
    if (status === 'manual_no_gps') return true;
    const latitude = parseCoordinate(row?.field_time_in_latitude);
    const longitude = parseCoordinate(row?.field_time_in_longitude);
    const distance = Number(row?.field_time_in_distance_meters || 0);
    return Boolean(status && latitude !== null && longitude !== null && Number.isFinite(distance) && distance <= ATTENDANCE_LOCATION_RADIUS_METERS);
}

function buildManualCustomerTimePatch(row, nowIso = new Date().toISOString()) {
    return {
        field_time_in_latitude: '',
        field_time_in_longitude: '',
        field_time_in_accuracy_meters: 0,
        field_time_in_distance_meters: 0,
        field_time_in_location_status: 'manual_no_gps',
        field_time_in_location_checked_at: nowIso,
        field_time_in_company_id: Number(row?.company_id || 0) || 0,
        field_time_in_branch_id: Number(row?.branch_id || state.modalBranchId || 0) || 0,
        field_time_in_company_name: '',
        field_time_in_branch_name: '',
        field_time_in_address: '',
        field_tracking_status: 'customer_checked_in',
        field_last_action: 'customer_checked_in',
        field_last_update_at: nowIso,
        field_last_latitude: '',
        field_last_longitude: ''
    };
}

async function getCustomerTaskLocationMatch(row) {
    if (!row) throw new Error('No active customer task is open.');
    await hydrateLookups([row]);

    const branch = caches.branch.get(String(row.branch_id || state.modalBranchId || 0));
    const coords = getBranchCoordinates(branch);
    const labelInfo = scheduleLocationLabel(row);
    if (!coords) {
        throw new Error(`This customer has no saved location pin yet (${labelInfo.label}). Tap Pin Customer Location while on site before checking in.`);
    }

    const position = await getCurrentPosition();
    const latitude = Number(position.coords.latitude);
    const longitude = Number(position.coords.longitude);
    const accuracy = Number(position.coords.accuracy || 0);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('GPS returned an invalid location.');
    }

    const distance = distanceMeters(latitude, longitude, coords.latitude, coords.longitude);
    if (distance > ATTENDANCE_LOCATION_RADIUS_METERS) {
        throw new Error(`You are ${Math.round(distance)}m from this customer location pin (${labelInfo.label}). Customer check-in requires ${ATTENDANCE_LOCATION_RADIUS_METERS}m maximum.`);
    }

    return {
        latitude,
        longitude,
        accuracy,
        distance,
        branch,
        ...labelInfo
    };
}

function buildCustomerTimeInLocationPatch(row, match, nowIso = new Date().toISOString()) {
    return {
        field_time_in_latitude: match.latitude.toFixed(7),
        field_time_in_longitude: match.longitude.toFixed(7),
        field_time_in_accuracy_meters: Math.round(match.accuracy),
        field_time_in_distance_meters: Math.round(match.distance),
        field_time_in_location_status: 'matched_customer_pin',
        field_time_in_location_checked_at: nowIso,
        field_time_in_company_id: Number(row.company_id || match.branch?.company_id || 0) || 0,
        field_time_in_branch_id: Number(row.branch_id || state.modalBranchId || 0) || 0,
        field_time_in_company_name: match.companyName || '',
        field_time_in_branch_name: match.branchName || '',
        field_time_in_address: match.address || '',
        field_tracking_status: 'customer_checked_in',
        field_last_action: 'customer_checked_in',
        field_last_update_at: nowIso,
        field_last_latitude: match.latitude.toFixed(7),
        field_last_longitude: match.longitude.toFixed(7)
    };
}

async function ensureCustomerTimeInLocationProof(row, form) {
    if (!form?.timeInDb || form.timeInDb === ZERO_DATETIME) return {};
    const savedTimeIn = normalizeLegacyDateTime(row?.field_time_in);
    const formTimeIn = normalizeLegacyDateTime(form.timeInDb);
    const existingProofStillApplies = savedTimeIn && (!formTimeIn || savedTimeIn === formTimeIn) && hasCustomerTimeInLocationProof(row);
    if (existingProofStillApplies) return {};
    return buildManualCustomerTimePatch(row);
}

function setAttendanceLocationCheckUi({ status = 'idle', title = 'Not checked yet', body = 'Tap Check My Location before Time In to confirm if you are near an office, production site, or scheduled customer.', meta = '', scheduleId = null, buttonLabel = 'Open Task', nearbyScheduleMatch = null } = {}) {
    const card = document.getElementById('fieldAttendanceLocationCheck');
    const titleEl = document.getElementById('fieldLocationCheckTitle');
    const bodyEl = document.getElementById('fieldLocationCheckBody');
    const metaEl = document.getElementById('fieldLocationCheckMeta');
    const openBtn = document.getElementById('fieldOpenLocationTaskBtn');
    const addBtn = document.getElementById('fieldAddNearbyScheduleBtn');
    if (!card || !titleEl || !bodyEl || !metaEl || !openBtn) return;

    card.dataset.status = status;
    titleEl.textContent = title;
    bodyEl.textContent = body;
    metaEl.textContent = meta;
    state.attendanceLocationCheckScheduleId = scheduleId ? Number(scheduleId) : null;
    state.attendanceNearbyScheduleMatch = nearbyScheduleMatch || null;
    openBtn.hidden = !state.attendanceLocationCheckScheduleId;
    openBtn.textContent = buttonLabel;
    if (addBtn) addBtn.hidden = !state.attendanceNearbyScheduleMatch;
    if (!state.attendanceNearbyScheduleMatch) closeAddNearbySchedulePanel();
}

function summarizeMissingPins(missingPinRows = []) {
    if (!missingPinRows.length) return '';
    const labels = missingPinRows.slice(0, 3).map((item) => item.label).filter(Boolean);
    const more = Math.max(0, missingPinRows.length - labels.length);
    return `${missingPinRows.length} scheduled customer${missingPinRows.length === 1 ? '' : 's'} need pin${missingPinRows.length === 1 ? '' : 's'}${labels.length ? `: ${labels.join(', ')}${more ? `, +${more} more` : ''}` : ''}.`;
}

function renderAttendanceLocationSummary() {
    const rows = workloadRows();
    if (!rows.length) {
        setAttendanceLocationCheckUi({
            status: 'warning',
            title: 'Ready to check location',
            body: 'Time In is allowed at an office/production pin. If you are at a customer with a saved pin, Check My Location can unlock Add Schedule.',
            meta: ''
        });
        return;
    }

    const pinnedCount = rows.filter((row) => {
        const branch = caches.branch.get(String(row.branch_id || 0));
        return Boolean(getBranchCoordinates(branch));
    }).length;
    const missingCount = Math.max(0, rows.length - pinnedCount);
    setAttendanceLocationCheckUi({
        status: missingCount ? 'warning' : 'idle',
        title: 'Ready to check location',
        body: `Tap Check My Location to compare your GPS against office/production pins and ${pinnedCount} pinned scheduled customer${pinnedCount === 1 ? '' : 's'}.`,
        meta: missingCount ? `${missingCount} scheduled customer${missingCount === 1 ? '' : 's'} still need location pin${missingCount === 1 ? '' : 's'}.` : ''
    });
}

function renderAttendanceLocationResult(snapshot) {
    const nearest = snapshot.nearest;
    const missingSummary = summarizeMissingPins(snapshot.missingPinRows);
    const accuracyText = Number.isFinite(snapshot.accuracy) && snapshot.accuracy > 0
        ? `GPS accuracy ${Math.round(snapshot.accuracy)}m.`
        : '';
    const checkedText = `Checked ${new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}.`;
    const meta = [accuracyText, missingSummary, checkedText].filter(Boolean).join(' ');
    const workLocation = snapshot.nearestWorkLocation;

    if (workLocation && workLocation.distance <= ATTENDANCE_LOCATION_RADIUS_METERS) {
        setAttendanceLocationCheckUi({
            status: 'allowed',
            title: `Within ${formatDistanceForLocationCheck(workLocation.distance)} of ${locationName(workLocation.location)}`,
            body: 'You are at an approved office/production site. Official Time In is allowed.',
            meta: [locationType(workLocation.location), meta].filter(Boolean).join(' - ')
        });
        return;
    }

    if (!snapshot.rows.length) {
        if (snapshot.nearbyCustomerBranch) {
            setAttendanceLocationCheckUi({
                status: 'warning',
                title: `At ${snapshot.nearbyCustomerBranch.label}`,
                body: 'No schedule is assigned to you here. Add a schedule from this pinned customer site, choose a purpose, then Time In.',
                meta,
                nearbyScheduleMatch: snapshot.nearbyCustomerBranch
            });
            return;
        }
        setAttendanceLocationCheckUi({
            status: 'warning',
            title: 'No open customer for this date',
            body: 'Time In is allowed at an office/production pin. Customer-site Time In needs a schedule or a nearby pinned customer to add one.',
            meta
        });
        return;
    }

    if (!snapshot.pinnedRows.length) {
        const target = snapshot.missingPinRows[0];
        setAttendanceLocationCheckUi({
            status: 'warning',
            title: 'No scheduled customer has a pin yet',
            body: 'If you are already at a customer, open that task and pin the customer location first.',
            meta,
            scheduleId: target?.row?.id,
            buttonLabel: 'Open Task To Pin'
        });
        return;
    }

    if (nearest && nearest.distance <= ATTENDANCE_LOCATION_RADIUS_METERS) {
        setAttendanceLocationCheckUi({
            status: 'allowed',
            title: `Within ${formatDistanceForLocationCheck(nearest.distance)} of ${nearest.label}`,
            body: 'You are near a pinned scheduled customer. Official Time In is allowed.',
            meta,
            scheduleId: nearest.row?.id,
            buttonLabel: 'Open Customer Task'
        });
        return;
    }

    setAttendanceLocationCheckUi({
        status: 'blocked',
        title: nearest ? `${formatDistanceForLocationCheck(nearest.distance)} from ${nearest.label}` : 'No pinned customer nearby',
        body: snapshot.nearbyCustomerBranch
            ? 'You are at a pinned customer site with no assigned schedule. Add a schedule, choose a purpose, then Time In.'
            : `You are not within ${ATTENDANCE_LOCATION_RADIUS_METERS}m of an office, production site, or pinned open/pending customer. Official Time In will be blocked.`,
        meta,
        scheduleId: nearest?.row?.id || snapshot.missingPinRows[0]?.row?.id,
        buttonLabel: nearest ? 'Open Nearest Task' : 'Open Task To Pin',
        nearbyScheduleMatch: snapshot.nearbyCustomerBranch
    });
}

async function checkAttendanceLocation(options = {}) {
    const { openAddPanelOnMatch = false } = options;
    const button = document.getElementById('fieldCheckLocationBtn');
    if (button) button.disabled = true;
    setAttendanceLocationCheckUi({
        status: 'idle',
        title: 'Checking GPS...',
        body: 'Please stay at the customer entrance or office while the phone gets your current location.',
        meta: ''
    });

    try {
        const snapshot = await getAttendanceLocationSnapshot({ withGps: true });
        renderAttendanceLocationResult(snapshot);
        if (openAddPanelOnMatch && snapshot.nearbyCustomerBranch) {
            openAddNearbySchedulePanel();
        }
    } catch (err) {
        console.error('Attendance location check failed:', err);
        setAttendanceLocationCheckUi({
            status: 'blocked',
            title: 'Location check failed',
            body: err?.message || 'Unable to read GPS location. Check browser location permission and try again.',
            meta: ''
        });
    } finally {
        if (button) button.disabled = false;
    }
}

function populateAddSchedulePurposeOptions() {
    const select = document.getElementById('fieldAddSchedulePurpose');
    if (!select) return;
    select.innerHTML = FIELD_SELF_ADD_SCHEDULE_PURPOSE_IDS
        .map((id) => `<option value="${sanitize(id)}"${id === SERVICE_PURPOSE_ID ? ' selected' : ''}>${sanitize(PURPOSE_LABELS[id] || `Purpose ${id}`)}</option>`)
        .join('');
}

async function openAddNearbySchedulePanel() {
    if (!state.attendanceNearbyScheduleMatch) {
        await checkAttendanceLocation({ openAddPanelOnMatch: true });
        if (!state.attendanceNearbyScheduleMatch) {
            alert('Check My Location did not find an addable pinned customer site. You can only add a schedule while your phone is within 200m of that customer pin.');
            return;
        }
    }
    populateAddSchedulePurposeOptions();
    const panel = document.getElementById('fieldAddSchedulePanel');
    if (panel) panel.hidden = false;
}

function closeAddNearbySchedulePanel() {
    const panel = document.getElementById('fieldAddSchedulePanel');
    if (panel) panel.hidden = true;
}

async function saveNearbyAttendanceSchedule() {
    const match = state.attendanceNearbyScheduleMatch;
    const saveBtn = document.getElementById('fieldAddScheduleSaveBtn');
    if (!match) {
        alert('Check My Location first while at a pinned customer site.');
        return;
    }
    if (Number(match.distance || 0) > ATTENDANCE_LOCATION_RADIUS_METERS) {
        alert(`You are no longer within ${ATTENDANCE_LOCATION_RADIUS_METERS}m of this customer pin. Check My Location again.`);
        return;
    }

    const purposeId = Number(document.getElementById('fieldAddSchedulePurpose')?.value || SERVICE_PURPOSE_ID) || SERVICE_PURPOSE_ID;
    if (!FIELD_SELF_ADD_SCHEDULE_PURPOSE_IDS.includes(purposeId)) {
        alert('Please choose a purpose from the list.');
        return;
    }

    const date = document.getElementById('fieldDate')?.value || localDateYmd();
    const now = new Date();
    const nowIso = now.toISOString();
    const localTime = now.toLocaleTimeString('en-PH', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const taskDatetime = `${date} ${localTime}`;

    if (saveBtn) saveBtn.disabled = true;
    try {
        const scheduleId = await allocateNextNumericId('tbl_schedule');
        const row = makeScheduleRowFromNearbyMatch(scheduleId, match, purposeId, taskDatetime, nowIso);
        const {
            _docId,
            route_id,
            route_doc_id,
            route_source,
            route_tech_id,
            route_task_datetime,
            route_status,
            route_iscancelled,
            route_date_finished,
            route_remarks,
            ...scheduleDoc
        } = row;
        await setDocument('tbl_schedule', String(scheduleId), scheduleDoc);
        caches.branch.set(String(match.branchId), match.branch);
        if (match.company) caches.company.set(String(match.companyId), match.company);
        if (match.area) caches.area.set(String(match.areaId), match.area);
        state.todayRows.push(row);
        state.rows = [...state.todayRows, ...state.carryoverRows];
        state.activeTab = 'today';
        state.statusFilter = 'all';
        const statusFilter = document.getElementById('fieldStatusFilter');
        if (statusFilter) statusFilter.value = 'all';
        updatePriorityGate(workloadRows());
        renderAttendanceLocationSummary();
        renderActiveView();
        closeAddNearbySchedulePanel();
        await checkAttendanceLocation().catch((error) => console.warn('Location recheck after self-add failed:', error));
        alert(`Schedule #${scheduleId} added for ${match.label}. You can now Time In.`);
    } catch (error) {
        console.error('Add nearby schedule failed:', error);
        alert(`Failed to add schedule: ${error?.message || error}`);
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function openAttendanceLocationTask() {
    const scheduleId = Number(state.attendanceLocationCheckScheduleId || 0);
    if (!scheduleId) return;
    setActiveView('tasks');
    const row = state.rows.find((item) => Number(item.id || 0) === scheduleId);
    if (!row) return;
    openModal(scheduleId).catch((err) => {
        console.error('Open location task failed:', err);
        alert(`Unable to open task: ${err?.message || err}`);
    });
}

function renderAttendanceCard() {
    const status = document.getElementById('fieldAttendanceStatus');
    const timeIn = document.getElementById('fieldAttendanceTimeIn');
    const timeOut = document.getElementById('fieldAttendanceTimeOut');
    const timeInLocation = document.getElementById('fieldAttendanceTimeInLocation');
    const timeInBtn = document.getElementById('fieldAttendanceTimeInBtn');
    const timeOutBtn = document.getElementById('fieldAttendanceTimeOutBtn');
    if (!status || !timeIn || !timeOut || !timeInBtn || !timeOutBtn) return;

    const attendance = state.attendance || {};
    const hasTimeIn = Boolean(normalizeLegacyDateTime(attendance.time_in));
    const hasTimeOut = Boolean(normalizeLegacyDateTime(attendance.time_out));
    timeIn.textContent = formatAttendanceTime(attendance.time_in);
    timeOut.textContent = formatAttendanceTime(attendance.time_out);
    if (timeInLocation) timeInLocation.textContent = hasTimeIn ? formatAttendanceLocationLine(attendance) : `Office, production, or pinned customer within ${ATTENDANCE_LOCATION_RADIUS_METERS}m.`;
    timeInBtn.disabled = hasTimeIn;
    timeOutBtn.disabled = !hasTimeIn || hasTimeOut;

    if (!hasTimeIn) {
        status.textContent = 'Time In requires GPS at the office, production site, or a pinned customer site. If the customer was not assigned, Check My Location can add the schedule first.';
    } else if (!hasTimeOut) {
        status.textContent = `Official attendance is open. ${getAttendanceTimeliness(attendance).label} Time Out when back at the office.`;
    } else {
        status.textContent = `Attendance complete for this route date. ${getAttendanceTimeliness(attendance).label}`;
    }
}

async function loadAttendanceForSelectedDate() {
    const date = document.getElementById('fieldDate')?.value || localDateYmd();
    const staffId = Number(state.staffId || 0) || 0;
    if (!staffId || !date) {
        state.attendanceDocId = '';
        state.attendance = null;
        renderAttendanceCard();
        return;
    }

    const docId = attendanceDocId(staffId, date);
    state.attendanceDocId = docId;
    const direct = await fetchDoc(FIELD_ATTENDANCE_COLLECTION, docId).catch(() => null);
    state.attendance = direct || {
        id: docId,
        staff_id: staffId,
        attendance_date: date,
        time_in: ZERO_DATETIME,
        time_out: ZERO_DATETIME
    };
    renderAttendanceCard();
}

async function markAttendanceTime(direction) {
    const staffId = Number(state.staffId || 0) || 0;
    const date = document.getElementById('fieldDate')?.value || localDateYmd();
    if (!staffId || !date) return;

    const isOut = direction === 'out';
    const fieldName = isOut ? 'time_out' : 'time_in';
    const existing = normalizeLegacyDateTime(state.attendance?.[fieldName]);
    if (existing) return;

    const button = document.getElementById(isOut ? 'fieldAttendanceTimeOutBtn' : 'fieldAttendanceTimeInBtn');
    const nowIso = new Date().toISOString();
    const nowDb = nowDbDateTime();
    const docId = state.attendanceDocId || attendanceDocId(staffId, date);
    const previous = state.attendance || {};
    const previousFields = { ...previous };
    delete previousFields._docId;
    const displayName = document.getElementById('fieldHeaderTitle')?.textContent?.split(' - ')[0] || '';
    const payload = {
        ...previousFields,
        id: docId,
        staff_id: staffId,
        staff_name: displayName,
        attendance_date: date,
        time_in: isOut ? (normalizeLegacyDateTime(previous.time_in) || ZERO_DATETIME) : nowDb,
        time_out: isOut ? nowDb : (normalizeLegacyDateTime(previous.time_out) || ZERO_DATETIME),
        source: 'field_homepage',
        created_at: previous.created_at || nowIso,
        updated_at: nowIso,
        updated_by: staffId
    };

    if (isOut && !normalizeLegacyDateTime(payload.time_in)) {
        alert('Please Time In first before Time Out.');
        return;
    }

    if (button) button.disabled = true;
    try {
        if (!isOut) {
            const match = await getAttendanceScheduleLocationMatch();
            if (match.type === 'work_location') {
                const workLocation = match.workLocation;
                payload.time_in_latitude = match.latitude.toFixed(7);
                payload.time_in_longitude = match.longitude.toFixed(7);
                payload.time_in_accuracy_meters = Math.round(match.accuracy);
                payload.time_in_distance_meters = Math.round(workLocation.distance);
                payload.time_in_allowed_meters = ATTENDANCE_LOCATION_RADIUS_METERS;
                payload.time_in_schedule_id = 0;
                payload.time_in_schedule_doc_id = '';
                payload.time_in_company_id = 0;
                payload.time_in_branch_id = 0;
                payload.time_in_company_name = locationName(workLocation.location);
                payload.time_in_branch_name = locationType(workLocation.location);
                payload.time_in_address = String(workLocation.location?.address || workLocation.location?.location_address || '');
                payload.time_in_work_location_id = String(workLocation.location?._docId || workLocation.location?.id || '');
                payload.time_in_work_location_name = locationName(workLocation.location);
                payload.time_in_work_location_type = locationType(workLocation.location);
                payload.time_in_location_status = 'matched_work_location';
                payload.attendance_mode = 'office_production_or_customer_site';
                payload.attendance_location_policy = `office_production_or_customer_${ATTENDANCE_LOCATION_RADIUS_METERS}m`;
                payload.attendance_location_radius_meters = ATTENDANCE_LOCATION_RADIUS_METERS;
                payload.attendance_location_required = true;
                const timeliness = getAttendanceTimeliness(payload);
                payload.time_in_timeliness_status = timeliness.status;
                payload.time_in_late_minutes = timeliness.lateMinutes;
            } else {
                const nearest = match.nearest;
                payload.time_in_latitude = match.latitude.toFixed(7);
                payload.time_in_longitude = match.longitude.toFixed(7);
                payload.time_in_accuracy_meters = Math.round(match.accuracy);
                payload.time_in_distance_meters = Math.round(nearest.distance);
                payload.time_in_schedule_id = Number(nearest.row.id || 0) || 0;
                payload.time_in_schedule_doc_id = scheduleDocIdForRow(nearest.row);
                payload.time_in_company_id = Number(nearest.row.company_id || nearest.branch?.company_id || 0) || 0;
                payload.time_in_branch_id = Number(nearest.row.branch_id || 0) || 0;
                payload.time_in_company_name = nearest.companyName || '';
                payload.time_in_branch_name = nearest.branchName || '';
                payload.time_in_address = nearest.address || '';
                payload.time_in_location_status = 'matched_open_pending_schedule';
                payload.attendance_mode = 'office_production_or_customer_site';
                payload.attendance_location_policy = `office_production_or_customer_${ATTENDANCE_LOCATION_RADIUS_METERS}m`;
                payload.attendance_location_radius_meters = ATTENDANCE_LOCATION_RADIUS_METERS;
                payload.attendance_location_required = true;
                const timeliness = getAttendanceTimeliness(payload);
                payload.time_in_timeliness_status = timeliness.status;
                payload.time_in_late_minutes = timeliness.lateMinutes;
            }
        }
        await setDocument(FIELD_ATTENDANCE_COLLECTION, docId, payload);
        state.attendanceDocId = docId;
        state.attendance = payload;
        renderAttendanceCard();
        alert(isOut ? 'Attendance time out captured.' : `Attendance time in captured ${formatAttendanceLocationLine(payload)}.`);
    } catch (err) {
        console.error('Attendance update failed:', err);
        alert(`Failed to save attendance: ${err?.message || err}`);
        renderAttendanceCard();
    }
}

function parseIntegerInput(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.max(0, Math.trunc(num));
}

function clampText(value, max = 255) {
    return String(value || '').trim().slice(0, max);
}

function jsonString(value, fallback = '') {
    try {
        return JSON.stringify(value);
    } catch (err) {
        return fallback;
    }
}

async function ensureLookup(collection, id, map) {
    const key = String(id || '');
    if (!key || key === '0') return null;
    if (map.has(key)) return map.get(key);
    const doc = await fetchDoc(collection, key);
    if (doc) map.set(key, doc);
    return doc;
}

async function hydrateLookups(rows) {
    const troubleIds = new Set();
    const branchIds = new Set();
    const companyIds = new Set();
    const areaIds = new Set();
    const machineIds = new Set();

    rows.forEach((r) => {
        if (Number(r.trouble_id || 0) > 0) troubleIds.add(Number(r.trouble_id));
        if (Number(r.branch_id || 0) > 0) branchIds.add(Number(r.branch_id));
        if (Number(r.company_id || 0) > 0) companyIds.add(Number(r.company_id));
        if (Number(r.area_id || 0) > 0) areaIds.add(Number(r.area_id));
        if (Number(r.serial || 0) > 0) machineIds.add(Number(r.serial));
    });

    await Promise.all([
        ...[...troubleIds].map((id) => ensureLookup('tbl_trouble', id, caches.trouble)),
        ...[...branchIds].map((id) => ensureLookup('tbl_branchinfo', id, caches.branch)),
        ...[...companyIds].map((id) => ensureLookup('tbl_companylist', id, caches.company)),
        ...[...areaIds].map((id) => ensureLookup('tbl_area', id, caches.area)),
        ...[...machineIds].map((id) => ensureLookup('tbl_machine', id, caches.machine))
    ]);

    const modelIds = new Set();
    const brandIds = new Set();
    [...machineIds].forEach((id) => {
        const machine = caches.machine.get(String(id));
        if (machine?.model_id) modelIds.add(Number(machine.model_id));
        if (machine?.brand_id) brandIds.add(Number(machine.brand_id));
    });

    await Promise.all([
        ...[...modelIds].map((id) => ensureLookup('tbl_model', id, caches.model)),
        ...[...brandIds].map((id) => ensureLookup('tbl_brand', id, caches.brand))
    ]);
}

function isClosedOnSelectedDate(row) {
    if (getStatusKey(row) !== 'closed') return false;
    const selectedDate = state.selectedDate || document.getElementById('fieldDate')?.value || localDateYmd();
    const finishedDate = dateOnly(normalizeLegacyDateTime(row.date_finished))
        || dateOnly(normalizeLegacyDateTime(row.route_date_finished));
    if (finishedDate) return finishedDate === selectedDate;
    return dateOnly(getRouteTaskDateTime(row)) === selectedDate;
}

function isCancelledOnSelectedDate(row) {
    if (getStatusKey(row) !== 'cancelled') return false;
    const selectedDate = state.selectedDate || document.getElementById('fieldDate')?.value || localDateYmd();
    return dateOnly(getRouteTaskDateTime(row)) === selectedDate;
}

function getWorkloadSummary() {
    const todayOpen = todayWorkingRows();
    const pastOpen = pastPendingWorkingRows();
    const openRows = workloadRows();
    const openCounts = openRows.reduce((acc, r) => {
        const k = getStatusKey(r);
        acc[k] = (acc[k] || 0) + 1;
        return acc;
    }, {});
    const closedToday = state.rows.filter(isClosedOnSelectedDate).length;
    const cancelledToday = state.rows.filter(isCancelledOnSelectedDate).length;
    const pendingNeedsAction = (openCounts.pending || 0) + (openCounts.carryover || 0);
    return {
        todayOpen,
        pastOpen,
        openRows,
        openCounts,
        closedToday,
        cancelledToday,
        pendingNeedsAction,
        totalWorkload: openRows.length
    };
}

function renderKpis() {
    const summary = getWorkloadSummary();

    document.getElementById('fieldKpis').innerHTML = `
        <div class="field-kpi ${state.activeTab === 'closed' ? '' : 'is-active-filter'}" data-view-jump="tasks"><div class="label">Today's Workload</div><div class="value">${summary.totalWorkload}</div></div>
        <div class="field-kpi" data-tab-jump="today"><div class="label">New Today</div><div class="value">${summary.todayOpen.length}</div></div>
        <div class="field-kpi" data-tab-jump="carryover"><div class="label">Past Pending</div><div class="value">${summary.pastOpen.length}</div></div>
        <div class="field-kpi ${state.activeTab !== 'closed' && state.statusFilter === 'all' ? 'is-active-filter' : ''}" data-status-filter="all"><div class="label">Pending / Needs Action</div><div class="value">${summary.pendingNeedsAction}</div></div>
        <div class="field-kpi ${state.activeTab !== 'closed' && state.statusFilter === 'ongoing' ? 'is-active-filter' : ''}" data-status-filter="ongoing"><div class="label">Ongoing (Parts)</div><div class="value">${summary.openCounts.ongoing || 0}</div></div>
        <div class="field-kpi ${state.activeTab === 'closed' ? 'is-active-filter' : ''}" data-closed-today="1"><div class="label">Closed Today</div><div class="value">${summary.closedToday}</div></div>
    `;
}

function countRowsByStatus(rows) {
    return rows.reduce((acc, row) => {
        const status = getStatusKey(row);
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});
}

function shouldShowEndOfDayReview() {
    const selectedDate = state.selectedDate || document.getElementById('fieldDate')?.value || localDateYmd();
    const now = new Date();
    const isSelectedTodayOrPast = selectedDate <= localDateYmd();
    const isEndOfDayWindow = now.getHours() >= 17;
    return isSelectedTodayOrPast && (isEndOfDayWindow || state.todayRows.length || state.carryoverRows.length);
}

function renderEndOfDayReview() {
    const card = document.getElementById('fieldEndOfDayReview');
    if (!card) return;
    if (!shouldShowEndOfDayReview()) {
        card.hidden = true;
        card.innerHTML = '';
        return;
    }

    const summary = getWorkloadSummary();
    const pendingToday = summary.pendingNeedsAction;
    const pastPending = summary.pastOpen.length;
    const closedToday = summary.closedToday;
    const selectedDate = state.selectedDate || document.getElementById('fieldDate')?.value || localDateYmd();
    const staffName = document.getElementById('fieldHeaderTitle')?.textContent?.split(' - ')[0] || 'Staff';
    const needsLeader = summary.totalWorkload > 0 || pastPending > 0;

    card.hidden = false;
    card.innerHTML = `
        <div class="field-endofday-copy">
            <div class="field-endofday-label">End of Day Review</div>
            <h2>${sanitize(staffName)} route status for ${sanitize(selectedDate)}</h2>
            <p>${needsLeader
                ? `Team leader review needed: ${summary.totalWorkload} open workload task(s), including ${pastPending} past pending.`
                : 'All visible work for this route date is closed.'}</p>
        </div>
        <div class="field-endofday-stats">
            <div><span>${summary.totalWorkload}</span><small>Workload</small></div>
            <div><span>${closedToday}</span><small>Closed</small></div>
            <div><span>${pendingToday}</span><small>Needs Action</small></div>
            <div><span>${pastPending}</span><small>Past Pending</small></div>
        </div>
    `;
}

function normalizePersonName(value) {
    return normalizeSearchText(value).replace(/\s+/g, ' ').trim();
}

function getCurrentStaffName() {
    return document.getElementById('fieldHeaderTitle')?.textContent?.split(' - ')[0]?.trim() || '';
}

function isPettyCashForCurrentStaff(entry) {
    const staffName = normalizePersonName(getCurrentStaffName());
    if (!staffName) return false;
    return [
        entry.requestedBy,
        entry.requested_by,
        entry.payee,
        entry.staff_name,
        entry.employee_name
    ].some((value) => {
        const candidate = normalizePersonName(value);
        return candidate && (candidate === staffName || candidate.includes(staffName) || staffName.includes(candidate));
    });
}

function minutesBetween(startValue, endValue) {
    const start = normalizeLegacyDateTime(startValue);
    const end = normalizeLegacyDateTime(endValue);
    if (!start || !end) return null;
    const startMs = Date.parse(start.replace(' ', 'T'));
    const endMs = Date.parse(end.replace(' ', 'T'));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    return Math.round((endMs - startMs) / 60000);
}

function getCustomerMinutes(row) {
    const direct = minutesBetween(row.field_time_in, row.field_time_out);
    if (direct !== null) return direct;
    return null;
}

function getRowTroubleText(row) {
    const trouble = caches.trouble.get(String(row?.trouble_id || 0));
    return normalizeSearchText([
        trouble?.trouble,
        row?.trouble_label,
        row?.route_remarks,
        row?.remarks,
        row?.caller,
        row?.field_work_notes,
        row?.field_final_summary
    ].filter(Boolean).join(' '));
}

function getExpectedCustomerMinutes(row) {
    const purpose = Number(row?.purpose_id || 0);
    const text = getRowTroubleText(row);
    if (purpose === BILLING_PURPOSE_ID) return 20;
    if (purpose === COLLECTION_PURPOSE_ID) return 25;
    if (purpose === 3 || purpose === 4) return 20;
    if (purpose === 8) return 15;
    if (purpose !== 5) return 30;
    if (/(paper jam|jamming|jam|paper feed|feed|tray|pull out paper|pulled paper)/.test(text)) return 45;
    if (/(toner|cartridge|drum|replace|install)/.test(text)) return 45;
    if (/(clean|maintenance|preventive|pm)/.test(text)) return 75;
    if (/(error|sc|code|fuser|scanner|laser|motor|network|board|power|no print|down)/.test(text)) return 120;
    return 90;
}

function getCustomerTimeScore(timedRows = []) {
    if (!timedRows.length) return 0;
    const scores = timedRows.map(({ row, minutes }) => {
        const expected = getExpectedCustomerMinutes(row);
        if (!minutes || !expected) return 0;
        if (minutes <= expected) return 100;
        const overRatio = (minutes - expected) / expected;
        return clampScore(100 - (overRatio * 70));
    });
    return clampScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function formatDurationMinutes(minutes) {
    const value = Number(minutes || 0);
    if (!Number.isFinite(value) || value <= 0) return '-';
    const rounded = Math.round(value);
    const hours = Math.floor(rounded / 60);
    const mins = rounded % 60;
    if (hours && mins) return `${hours} hour${hours === 1 ? '' : 's'} ${mins} minute${mins === 1 ? '' : 's'}`;
    if (hours) return `${hours} hour${hours === 1 ? '' : 's'}`;
    return `${mins} minute${mins === 1 ? '' : 's'}`;
}

function getRating(score) {
    const value = clampScore(score);
    if (value >= 95) return { label: 'Excellent', className: 'excellent' };
    if (value >= 85) return { label: 'Good', className: 'good' };
    if (value >= 75) return { label: 'Fair', className: 'fair' };
    if (value >= 60) return { label: 'Needs Improvement', className: 'needs' };
    return { label: 'Poor', className: 'poor' };
}

function getRatingGuide(score, context = 'score') {
    const rating = getRating(score);
    const normalizedContext = String(context || '').toLowerCase();
    if (normalizedContext.includes('past pending')) {
        const pendingGuides = {
            excellent: {
                why: 'Very little old work is mixed into today, so the route is clean and customer follow-up risk is low.',
                action: 'Keep closing or properly forwarding unfinished work before the next day starts.'
            },
            good: {
                why: 'There is some old work, but it is still controlled and visible.',
                action: 'Clear the oldest pending tasks first so they do not become repeated customer complaints.'
            },
            fair: {
                why: 'Old work is becoming noticeable, which means today is partly spent recovering from yesterday.',
                action: 'Ask the team leader to prioritize carryover work and reassign items that need stronger skill or closer location.'
            },
            needs: {
                why: 'Too much of today is old pending work. This usually means customers waited too long or the route was not finished cleanly.',
                action: 'Handle past pending before new low-priority work, and explain why the previous visit was not completed.'
            },
            poor: {
                why: 'The past pending load is poor because old unfinished work is dominating the route. This creates missed service, customer dissatisfaction, and hidden cost.',
                action: 'Escalate to the team leader, clear oldest/highest-priority customers first, and request reassignment if the cause is skill, parts, or route overload.'
            }
        };
        const guide = pendingGuides[rating.className] || pendingGuides.poor;
        return { ...rating, title: `${rating.label} past pending load`, why: guide.why, action: guide.action };
    }
    if (normalizedContext.includes('customer time')) {
        const timeGuides = {
            excellent: {
                why: 'The time spent at the customer matches the type of trouble and the task was recorded clearly.',
                action: 'Keep using the guide and record the actual fix done before leaving.'
            },
            good: {
                why: 'The visit time is reasonable for the trouble, with only minor risk of delay.',
                action: 'Add clear notes when the customer, parts, or machine condition caused extra time.'
            },
            fair: {
                why: 'The visit time is acceptable but may need review, especially if the trouble was simple.',
                action: 'Use the troubleshooting guide early and ask for help before spending too long on one machine.'
            },
            needs: {
                why: 'The visit took longer than expected for the trouble type. Long time does not always mean hard work; it may mean unclear diagnosis or skill gap.',
                action: 'Search the guide, follow the steps, document what was tried, and call the senior tech if the issue is not moving.'
            },
            poor: {
                why: 'The customer time is poor because the stay is much longer than expected for the recorded trouble. For simple jams or paper feed issues, over one hour may mean inefficient troubleshooting unless clearly justified.',
                action: 'Write the exact cause, use the troubleshooting guide, ask for technical help early, and avoid staying long without progress.'
            }
        };
        const guide = timeGuides[rating.className] || timeGuides.poor;
        return { ...rating, title: `${rating.label} customer time`, why: guide.why, action: guide.action };
    }
    const guides = {
        excellent: {
            why: 'Almost all required records are complete and the work is easy to verify.',
            action: 'Keep the same discipline and help teammates copy the habit.'
        },
        good: {
            why: 'The work is mostly reliable, with only small gaps that do not hide much risk.',
            action: 'Fix the small missing records before leaving the last customer or office.'
        },
        fair: {
            why: 'The result is acceptable, but there are enough gaps that the team leader still needs to check.',
            action: 'Review unfinished items and complete missing time or task updates today.'
        },
        needs: {
            why: 'Too many records are incomplete, so the company cannot clearly see what happened in the route.',
            action: 'Time in/out, check in/out per customer, and ask for reassignment early when the route is too heavy.'
        },
        poor: {
            why: 'The record is poor because many tasks or time logs are missing, late, or unfinished. This makes payroll, customer follow-up, and performance review unfair and unreliable.',
            action: 'Explain the reason to the team leader, finish the missing updates, and follow the next route priority one customer at a time.'
        }
    };
    const guide = guides[rating.className] || guides.poor;
    return {
        ...rating,
        title: `${rating.label} ${context}`,
        why: guide.why,
        action: guide.action
    };
}

function getReviewRatingScore(reviews = []) {
    if (!reviews.length) return null;
    const values = reviews
        .map((review) => Number(review.rating_percent || (Number(review.rating || 0) * 20) || 0))
        .filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length) return null;
    return clampScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function isComplaintReview(review) {
    const text = normalizeSearchText([
        review?.remarks,
        review?.review_status,
        review?.rating_label
    ].filter(Boolean).join(' '));
    return Number(review?.complaint_flag || 0) === 1
        || review?.complaint_flag === true
        || /complaint|concern|rude|late|not fixed|same problem|poor|bad|disappointed|not satisfied/.test(text)
        || Number(review?.rating || 0) > 0 && Number(review.rating || 0) <= 2;
}

function getCustomerSatisfactionScore(reviews = []) {
    if (!reviews.length) return null;
    const ratingScore = getReviewRatingScore(reviews);
    if (ratingScore === null) return null;
    const complaintPenalty = Math.min(60, reviews.filter(isComplaintReview).length * 30);
    return clampScore(ratingScore - complaintPenalty);
}

function getReviewSummaryForCurrentStaff() {
    const staffName = normalizeSearchText(getCurrentStaffName());
    const scheduleIds = new Set(state.rows.map((row) => Number(row.id || 0)).filter(Boolean));
    const reviews = (state.customerReviews || []).filter((review) => {
        const scheduleId = Number(review.schedule_id || 0);
        if (scheduleId && scheduleIds.has(scheduleId)) return true;
        const technician = normalizeSearchText(review.technician_name || review.staff_name || '');
        return staffName && technician && (technician.includes(staffName) || staffName.includes(technician));
    });
    const score = getCustomerSatisfactionScore(reviews);
    const complaints = reviews.filter(isComplaintReview);
    return { reviews, score, complaints };
}

function isServiceRow(row) {
    return Number(row?.purpose_id || 0) === 5;
}

function isChangeUnitRequest(row) {
    const text = getRowTroubleText(row);
    return /change unit|replace unit|unit replacement|swap unit|pull.?out unit|change machine/.test(text);
}

function isPartsDiagnosisRisk(row) {
    const text = getRowTroubleText(row);
    return Number(row?.pending_parts || 0) === 1
        || Number(row?.isongoing || 0) === 1
        || /parts needed|request part|replace part|part request|pending parts/.test(text);
}

function getBackjobRows(currentRows = [], historyRows = []) {
    const history = historyRows.filter(isServiceRow);
    return currentRows.filter(isServiceRow).filter((row) => {
        const serial = Number(row.serial || 0);
        const troubleId = Number(row.trouble_id || 0);
        if (!serial && !troubleId) return false;
        return history.some((past) => {
            if (Number(past.id || 0) === Number(row.id || 0)) return false;
            const sameSerial = serial && Number(past.serial || 0) === serial;
            const sameTrouble = troubleId && Number(past.trouble_id || 0) === troubleId;
            if (sameSerial && sameTrouble) return true;
            return sameSerial && getRowTroubleText(row) && getRowTroubleText(past) && getRowTroubleText(row) === getRowTroubleText(past);
        });
    });
}

function getTechnicianSkillSummary(summary) {
    const currentServiceRows = state.rows.filter(isServiceRow);
    const historyRows = state.skillHistoryRows || [];
    const backjobRows = getBackjobRows(currentServiceRows, historyRows);
    const changeUnitRows = currentServiceRows.filter(isChangeUnitRequest);
    const partsRiskRows = currentServiceRows.filter(isPartsDiagnosisRisk);
    const reviewSummary = getReviewSummaryForCurrentStaff();
    const firstFixScore = currentServiceRows.length
        ? clampScore(100 - Math.min(80, (backjobRows.length / currentServiceRows.length) * 100))
        : 100;
    const changeUnitScore = currentServiceRows.length
        ? clampScore(100 - Math.min(50, (changeUnitRows.length / currentServiceRows.length) * 70))
        : 100;
    const diagnosisScore = currentServiceRows.length
        ? clampScore(100 - Math.min(45, (partsRiskRows.length / currentServiceRows.length) * 45))
        : 100;
    const documentationScore = summary.timeDiligenceScore;
    const customerScore = reviewSummary.score;
    const score = clampScore(
        ((customerScore ?? 85) * 0.3)
        + (firstFixScore * 0.3)
        + (diagnosisScore * 0.2)
        + (changeUnitScore * 0.1)
        + (documentationScore * 0.1)
        - Math.min(40, reviewSummary.complaints.length * 20)
    );
    return {
        score,
        currentServiceRows,
        backjobRows,
        changeUnitRows,
        partsRiskRows,
        firstFixScore,
        changeUnitScore,
        diagnosisScore,
        documentationScore,
        customerScore,
        reviews: reviewSummary.reviews,
        complaints: reviewSummary.complaints
    };
}

function renderCustomerReviewGuide(reviewSummary) {
    if (!reviewSummary.reviews.length) {
        return renderScorecardMetric('Customer review', 'Waiting', 'No care.marga.biz review is linked to this route yet.');
    }
    const score = reviewSummary.score ?? 0;
    return renderScorecardMetric(
        'Customer review',
        `${score}%`,
        `${reviewSummary.reviews.length} review(s), ${reviewSummary.complaints.length} complaint/concern flag(s).`,
        score
    );
}

function renderRatingBadge(score) {
    const rating = getRating(score);
    return `<em class="field-rating-badge is-${sanitize(rating.className)}">${sanitize(rating.label)}</em>`;
}

function renderRatingGuide(score, context = 'score') {
    const guide = getRatingGuide(score, context);
    return `
        <div class="field-rating-guide is-${sanitize(guide.className)}">
            <strong>${sanitize(guide.title)}</strong>
            <p><span>Why:</span> ${sanitize(guide.why)}</p>
            <p><span>Improve:</span> ${sanitize(guide.action)}</p>
        </div>
    `;
}

function getAnalyticsSummary() {
    const workload = getWorkloadSummary();
    const selectedDate = state.selectedDate || document.getElementById('fieldDate')?.value || localDateYmd();
    const closedRows = state.rows.filter(isClosedOnSelectedDate);
    const openRows = workload.openRows;
    const totalAssigned = workload.totalWorkload + closedRows.length;
    const completionRate = totalAssigned > 0 ? Math.round((closedRows.length / totalAssigned) * 100) : 0;
    const carryoverRate = workload.totalWorkload > 0 ? Math.round((workload.pastOpen.length / workload.totalWorkload) * 100) : 0;
    const pastPendingScore = workload.totalWorkload > 0 ? clampScore(100 - carryoverRate) : 100;
    const timedRows = state.rows
        .map((row) => ({ row, minutes: getCustomerMinutes(row) }))
        .filter((item) => item.minutes !== null);
    const averageCustomerMinutes = timedRows.length
        ? Math.round(timedRows.reduce((sum, item) => sum + item.minutes, 0) / timedRows.length)
        : 0;
    const customerTimeScore = getCustomerTimeScore(timedRows);
    const attendanceTimeIn = normalizeLegacyDateTime(state.attendance?.time_in);
    const attendanceTimeOut = normalizeLegacyDateTime(state.attendance?.time_out);
    const customerTimeInRows = state.rows.filter((row) => normalizeLegacyDateTime(row.field_time_in));
    const customerTimeOutRows = state.rows.filter((row) => normalizeLegacyDateTime(row.field_time_in) && normalizeLegacyDateTime(row.field_time_out));
    const missingCheckout = customerTimeInRows.length - customerTimeOutRows.length;
    const customerTimeCoverage = totalAssigned > 0 ? Math.round((customerTimeOutRows.length / totalAssigned) * 100) : 0;
    const attendanceTimeliness = getAttendanceTimeliness(state.attendance || {});
    const timelinessPenalty = Math.min(40, Number(attendanceTimeliness.lateMinutes || 0) * 2);
    const officialAttendanceScore = clampScore((attendanceTimeIn && attendanceTimeOut ? 100 : attendanceTimeIn ? 70 : 0) - timelinessPenalty);
    const timeDiligenceScore = totalAssigned > 0
        ? clampScore((officialAttendanceScore * 0.3) + (customerTimeCoverage * 0.7))
        : officialAttendanceScore;
    const staffPettyCash = state.pettyCashEntries
        .filter((entry) => String(entry.status || '').trim().toLowerCase() !== 'cancelled')
        .filter(isPettyCashForCurrentStaff);
    const pettyCashTotal = staffPettyCash.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const costPerClosedVisit = closedRows.length ? pettyCashTotal / closedRows.length : 0;
    const baseSummary = {
        selectedDate,
        workload,
        closedRows,
        openRows,
        totalAssigned,
        completionRate,
        carryoverRate,
        pastPendingScore,
        averageCustomerMinutes,
        averageCustomerDuration: formatDurationMinutes(averageCustomerMinutes),
        customerTimeScore,
        attendanceTimeIn,
        attendanceTimeOut,
        attendanceTimeliness,
        customerTimeInRows,
        customerTimeOutRows,
        customerTimeCoverage,
        officialAttendanceScore,
        timeDiligenceScore,
        timedRows,
        missingCheckout,
        staffPettyCash,
        pettyCashTotal,
        costPerClosedVisit
    };
    const reviewSummary = getReviewSummaryForCurrentStaff();
    const skillSummary = getTechnicianSkillSummary(baseSummary);
    return {
        ...baseSummary,
        reviewSummary,
        skillSummary
    };
}

function buildPerformanceAdvice(summary) {
    const advice = [];
    if (summary.workload.pastOpen.length > 0) {
        advice.push({
            title: 'Clear old pending first',
            body: `${summary.workload.pastOpen.length} past pending task(s) are still open and rated ${getRating(summary.pastPendingScore).label}. Handle the oldest/highest-priority items before starting low-priority new work.`
        });
    }
    if (summary.workload.openCounts.ongoing > 0) {
        advice.push({
            title: 'Separate parts waiting from visit work',
            body: `${summary.workload.openCounts.ongoing} task(s) are waiting for parts. Confirm if parts are really unavailable so they do not hide inside normal pending work.`
        });
    }
    if (summary.completionRate < 70 && summary.totalAssigned >= 5) {
        advice.push({
            title: 'Improve completion rate today',
            body: `Current completion is ${summary.completionRate}%. Call the team leader early if the route is too heavy, blocked by traffic, or needs reassignment.`
        });
    }
    if (summary.missingCheckout > 0) {
        advice.push({
            title: 'Always check out before moving',
            body: `${summary.missingCheckout} task(s) have check-in without check-out. This weakens travel-time and customer-service-time scoring.`
        });
    }
    if (summary.attendanceTimeliness?.lateMinutes > 0) {
        advice.push({
            title: 'Protect official Time In',
            body: `Official Time In is ${summary.attendanceTimeliness.label.toLowerCase()} Time In must be inside ${ATTENDANCE_LOCATION_RADIUS_METERS}m of an open/pending customer by 8:15 AM, including the 15-minute grace period.`
        });
    }
    if (summary.timeDiligenceScore < 85) {
        advice.push({
            title: 'Improve time recording discipline',
            body: `Time recording is rated ${getRating(summary.timeDiligenceScore).label}. Time in/out officially, then check in and check out for every customer visit.`
        });
    }
    if (summary.averageCustomerMinutes > 90) {
        advice.push({
            title: 'Explain long customer time',
            body: `Average customer time is ${summary.averageCustomerDuration} and rated ${getRating(summary.customerTimeScore).label}. Add notes when the delay is customer-caused, parts-caused, technical, or a skill/escalation issue.`
        });
    }
    if (summary.reviewSummary?.complaints?.length) {
        advice.push({
            title: 'Customer complaint needs review',
            body: `${summary.reviewSummary.complaints.length} customer concern/complaint flag(s) are linked to this route. Treat this as urgent coaching and service recovery.`
        });
    }
    if (summary.skillSummary?.backjobRows?.length) {
        advice.push({
            title: 'Prevent repeat service calls',
            body: `${summary.skillSummary.backjobRows.length} possible backjob/repeat issue(s) were detected. Review the original diagnosis, solution, and whether escalation was needed earlier.`
        });
    }
    if (summary.skillSummary?.changeUnitRows?.length) {
        advice.push({
            title: 'Review change unit habit',
            body: `${summary.skillSummary.changeUnitRows.length} change-unit related request(s) need justification. Change unit is allowed when correct, but it should not replace proper troubleshooting.`
        });
    }
    if (summary.pettyCashTotal > 0 && !summary.closedRows.length) {
        advice.push({
            title: 'Expense needs accomplishment',
            body: `${formatPesoAmount(summary.pettyCashTotal)} petty cash is tied to this staff today, but no closed visit is recorded yet. Close finished work or explain the route delay.`
        });
    }
    if (!advice.length) {
        advice.push({
            title: 'Keep the route disciplined',
            body: 'Finish each customer record with check-in, check-out, photo/notes, then move to the next priority. This keeps payroll, cost, and performance reports reliable.'
        });
    }
    return advice;
}

function clampScore(value) {
    const score = Number(value || 0);
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(100, Math.round(score)));
}

function getRouteDisciplineScore(summary) {
    const checkoutPenalty = Math.min(35, summary.missingCheckout * 8);
    const carryoverPenalty = Math.min(35, summary.carryoverRate * 0.35);
    const completionBonus = summary.completionRate * 0.45;
    return clampScore(55 + completionBonus - checkoutPenalty - carryoverPenalty);
}

function renderScorecardMetric(label, value, note = '', score = null) {
    const ratingGuide = score === null ? '' : renderRatingGuide(score, label.toLowerCase());
    return `
        <div class="field-score-metric">
            <span>${sanitize(label)}${score === null ? '' : renderRatingBadge(score)}</span>
            <strong>${sanitize(value)}</strong>
            ${note ? `<small>${sanitize(note)}</small>` : ''}
            ${ratingGuide}
        </div>
    `;
}

function renderScorecards(summary) {
    const routeDiscipline = getRouteDisciplineScore(summary);
    const costPerVisit = formatPesoAmount(summary.costPerClosedVisit) || 'PHP 0.00';
    const workload = summary.workload;
    const skill = summary.skillSummary;
    return `
        <section class="field-scorecards">
            <article class="field-scorecard field-scorecard-tech">
                <div>
                    <span class="field-scorecard-label">Technician Maintenance Score</span>
                    <h4>Quality score, not just speed</h4>
                    <p>For technicians only. This should measure whether assigned customers call less often because machines are maintained thoroughly.</p>
                </div>
                <div class="field-scorecard-status">${skill.currentServiceRows.length ? skill.score : 'N/A'}</div>
                <div class="field-score-metrics">
                    ${renderCustomerReviewGuide(summary.reviewSummary)}
                    ${renderScorecardMetric('Backjob control', `${skill.backjobRows.length}`, 'Same machine and same/similar trouble within the recent service window should be zero.', skill.firstFixScore)}
                    ${renderScorecardMetric('Diagnosis accuracy', `${skill.partsRiskRows.length} risk`, 'Parts requested or pending parts after troubleshooting need follow-through proof.', skill.diagnosisScore)}
                    ${renderScorecardMetric('Change unit discipline', `${skill.changeUnitRows.length}`, 'Allowed when justified, but repeated change-unit requests reduce skill confidence.', skill.changeUnitScore)}
                    ${renderScorecardMetric('Area load fairness', 'Waiting', 'Needs active machines/customers per technician from customer/HR assignment.')}
                </div>
            </article>
            <article class="field-scorecard field-scorecard-messenger">
                <div>
                    <span class="field-scorecard-label">Messenger Logistics Score</span>
                    <h4>Route completion and cost control</h4>
                    <p>For messengers. This excludes maintenance quality and focuses on completed delivery, billing, collection, route discipline, and field cost.</p>
                </div>
                <div class="field-scorecard-status">${routeDiscipline}</div>
                <div class="field-score-metrics">
                    ${renderScorecardMetric('Completion', `${summary.completionRate}%`, `${summary.closedRows.length}/${summary.totalAssigned} workload tasks closed.`, summary.completionRate)}
                    ${renderScorecardMetric('Past pending', `${workload.pastOpen.length}`, 'Lower is better; old work should be cleared first.')}
                    ${renderScorecardMetric('Cost / closed visit', costPerVisit, 'Petty cash only for now; salary joins when HR module is ready.')}
                    ${renderScorecardMetric('Time discipline', `${summary.customerTimeOutRows.length}/${summary.totalAssigned} complete`, 'Official attendance plus customer check-in/check-out.', summary.timeDiligenceScore)}
                </div>
            </article>
            <article class="field-scorecard field-scorecard-owner">
                <div>
                    <span class="field-scorecard-label">Owner Cost/Waste Score</span>
                    <h4>Waste, carryover, and avoidable cost</h4>
                    <p>For management. This is the daily Kaizen lens: old pending work, expenses, low completion, and data gaps that hide waste.</p>
                </div>
                <div class="field-scorecard-status">${clampScore(100 - summary.carryoverRate - (summary.pettyCashTotal > 0 && !summary.closedRows.length ? 20 : 0))}</div>
                <div class="field-score-metrics">
                    ${renderScorecardMetric('Open workload', `${summary.totalAssigned}`, `${workload.todayOpen.length} new + ${workload.pastOpen.length} past pending.`)}
                    ${renderScorecardMetric('Petty cash', formatPesoAmount(summary.pettyCashTotal) || 'PHP 0.00', `${summary.staffPettyCash.length} matched row(s) by staff name.`)}
                    ${renderScorecardMetric('Carryover share', `${summary.carryoverRate}%`, 'High carryover means service risk and customer dissatisfaction.')}
                    ${renderScorecardMetric('Data reliability', summary.timedRows.length ? `${summary.timedRows.length} timed` : 'Weak', 'Better check-in/out data gives fairer coaching.', summary.timeDiligenceScore)}
                </div>
            </article>
        </section>
    `;
}

function renderAnalytics() {
    const panel = document.getElementById('fieldAnalytics');
    if (!panel) return;
    const summary = getAnalyticsSummary();
    const advice = buildPerformanceAdvice(summary);
    const staffName = getCurrentStaffName() || 'Staff';
    const completed = summary.closedRows.length;
    const pending = summary.workload.pendingNeedsAction;
    const ongoing = summary.workload.openCounts.ongoing || 0;
    const maxBar = Math.max(summary.totalAssigned, completed, pending, ongoing, 1);
    const bar = (value, className = '') => `<span class="${className}" style="width:${Math.max(4, Math.round((value / maxBar) * 100))}%"></span>`;
    const percentBar = (value, className = '') => `<span class="${className}" style="width:${Math.max(4, clampScore(value))}%"></span>`;

    panel.innerHTML = `
        <div class="field-snapshot-intro">
            <div>
                <span>Daily Route Snapshot</span>
                <h4>This is not the final performance rating.</h4>
                <p>These numbers explain today's route. Fair scoring separates technician maintenance quality, messenger logistics, and owner cost/waste.</p>
            </div>
        </div>
        <div class="field-analytics-grid">
            <article class="field-analytics-card">
                <span>Completion Rate</span>
                <strong>${summary.completionRate}% ${renderRatingBadge(summary.completionRate)}</strong>
                <div class="field-bar">${percentBar(summary.completionRate, 'is-good')}</div>
                <small>${completed} closed out of ${summary.totalAssigned} assigned workload task(s).</small>
                ${renderRatingGuide(summary.completionRate, 'completion')}
            </article>
            <article class="field-analytics-card">
                <span>Time Recording Discipline</span>
                <strong>${summary.timeDiligenceScore}% ${renderRatingBadge(summary.timeDiligenceScore)}</strong>
                <div class="field-bar">${percentBar(summary.timeDiligenceScore, 'is-info')}</div>
                <small>${sanitize(staffName)} official: ${summary.attendanceTimeIn ? formatAttendanceTime(summary.attendanceTimeIn) : 'no time in'} / ${summary.attendanceTimeOut ? formatAttendanceTime(summary.attendanceTimeOut) : 'no time out'}. ${sanitize(summary.attendanceTimeliness.label)} Customer check-out: ${summary.customerTimeOutRows.length}/${summary.totalAssigned}.</small>
                ${renderRatingGuide(summary.timeDiligenceScore, 'time recording')}
            </article>
            <article class="field-analytics-card">
                <span>Past Pending Load</span>
                <strong>${summary.workload.pastOpen.length} ${renderRatingBadge(summary.pastPendingScore)}</strong>
                <div class="field-bar">${bar(summary.workload.pastOpen.length, 'is-warning')}</div>
                <small>${summary.carryoverRate}% of open workload came from previous schedule dates.</small>
                ${renderRatingGuide(summary.pastPendingScore, 'past pending load')}
            </article>
            <article class="field-analytics-card">
                <span>Avg Customer Time</span>
                <strong>${sanitize(summary.averageCustomerDuration)} ${renderRatingBadge(summary.customerTimeScore)}</strong>
                <div class="field-bar">${percentBar(summary.customerTimeScore, 'is-info')}</div>
                <small>${summary.timedRows.length} task(s) have usable customer check-in/out. Rated against trouble/task type, not raw time alone.</small>
                ${renderRatingGuide(summary.customerTimeScore, 'customer time')}
            </article>
            <article class="field-analytics-card">
                <span>Petty Cash Linked</span>
                <strong>${sanitize(formatPesoAmount(summary.pettyCashTotal) || 'PHP 0.00')}</strong>
                <div class="field-bar">${bar(summary.staffPettyCash.length, 'is-cost')}</div>
                <small>${summary.staffPettyCash.length} petty cash row(s). Cost/closed visit: ${sanitize(formatPesoAmount(summary.costPerClosedVisit) || 'PHP 0.00')}.</small>
            </article>
            <article class="field-analytics-card">
                <span>Customer Satisfaction</span>
                <strong>${summary.reviewSummary.score === null ? 'Waiting' : `${summary.reviewSummary.score}% ${renderRatingBadge(summary.reviewSummary.score)}`}</strong>
                <div class="field-bar">${percentBar(summary.reviewSummary.score ?? 0, 'is-good')}</div>
                <small>${summary.reviewSummary.reviews.length} care review(s), ${summary.reviewSummary.complaints.length} concern/complaint flag(s).</small>
                ${summary.reviewSummary.score === null ? '' : renderRatingGuide(summary.reviewSummary.score, 'customer review')}
            </article>
            <article class="field-analytics-card">
                <span>Technician Skill Signal</span>
                <strong>${summary.skillSummary.currentServiceRows.length ? `${summary.skillSummary.score}% ${renderRatingBadge(summary.skillSummary.score)}` : 'No service calls'}</strong>
                <div class="field-bar">${percentBar(summary.skillSummary.currentServiceRows.length ? summary.skillSummary.score : 0, 'is-info')}</div>
                <small>${summary.skillSummary.backjobRows.length} possible backjob(s), ${summary.skillSummary.changeUnitRows.length} change-unit request(s), ${summary.skillSummary.partsRiskRows.length} diagnosis risk(s).</small>
                ${summary.skillSummary.currentServiceRows.length ? renderRatingGuide(summary.skillSummary.score, 'technician skill signal') : ''}
            </article>
        </div>
        <div class="field-analytics-split">
            <section class="field-advice-card">
                <h4>Route Advice</h4>
                ${advice.map((item) => `
                    <div class="field-advice-item">
                        <strong>${sanitize(item.title)}</strong>
                        <p>${sanitize(item.body)}</p>
                    </div>
                `).join('')}
            </section>
            <section class="field-advice-card">
                <h4>Kaizen Signals</h4>
                <div class="field-signal-row"><span>New today</span><strong>${summary.workload.todayOpen.length}</strong></div>
                <div class="field-signal-row"><span>Past pending</span><strong>${summary.workload.pastOpen.length}</strong></div>
                <div class="field-signal-row"><span>Needs action</span><strong>${pending}</strong></div>
                <div class="field-signal-row"><span>Ongoing parts</span><strong>${ongoing}</strong></div>
                <div class="field-signal-row"><span>Customer check-outs</span><strong>${summary.customerTimeOutRows.length}/${summary.totalAssigned}</strong></div>
                <div class="field-signal-row"><span>Missing check-out</span><strong>${summary.missingCheckout}</strong></div>
            </section>
        </div>
        ${renderScorecards(summary)}
    `;
}

async function loadFieldAnalytics() {
    const date = state.selectedDate || document.getElementById('fieldDate')?.value || localDateYmd();
    const panel = document.getElementById('fieldAnalytics');
    if (panel) panel.innerHTML = '<div class="loading-cell">Refreshing analytics...</div>';
    try {
        const historyStart = `${addDaysYmd(date, -30)} 00:00:00`;
        const dayEnd = `${date} 23:59:59`;
        const [docs, reviewDocs, skillHistoryDocs] = await Promise.all([
            queryByDateRange(PETTY_CASH_ENTRY_COLLECTION, 'date', date, date).catch(() => []),
            queryCollection(CUSTOMER_REVIEW_COLLECTION, FIELD_QUERY_LIMIT).catch(() => []),
            queryByDateRange('tbl_schedule', 'task_datetime', historyStart, dayEnd).catch(() => [])
        ]);
        state.pettyCashEntries = mergePendingOfflineRows(PETTY_CASH_ENTRY_COLLECTION, docs.map(parseFirestoreDoc).filter(Boolean));
        state.customerReviews = mergePendingOfflineRows(CUSTOMER_REVIEW_COLLECTION, reviewDocs.map(parseFirestoreDoc).filter(Boolean));
        state.skillHistoryRows = mergePendingOfflineRows('tbl_schedule', skillHistoryDocs.map(parseFirestoreDoc).filter(Boolean))
            .filter((row) => getAssignedStaffId(row) === Number(state.staffId || 0));
    } catch (error) {
        console.warn('Field analytics refresh failed:', error);
    }
    renderAnalytics();
}

function guideSearchText(row) {
    return normalizeSearchText([
        row.model,
        row.family,
        Array.isArray(row.model_aliases) ? row.model_aliases.join(' ') : row.model_aliases,
        row.trouble_label,
        row.lcd_error_message,
        row.meaning,
        row.what_to_do,
        row.service_level_code,
        row.source_file
    ].filter(Boolean).join(' '));
}

function guideBrandText(row) {
    return String(row.family || '').trim();
}

function guideModelText(row) {
    return String(row.model || '').trim();
}

function guideErrorText(row) {
    return String(row.lcd_error_message || row.trouble_label || row.service_level_code || '').trim();
}

function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;
    const clean = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < clean.length; i += 1) {
        const char = clean[i];
        if (quoted) {
            if (char === '"' && clean[i + 1] === '"') {
                value += '"';
                i += 1;
            } else if (char === '"') quoted = false;
            else value += char;
            continue;
        }
        if (char === '"') quoted = true;
        else if (char === ',') {
            row.push(value);
            value = '';
        } else if (char === '\n') {
            row.push(value);
            if (row.some((cell) => String(cell || '').trim())) rows.push(row);
            row = [];
            value = '';
        } else value += char;
    }
    if (value || row.length) {
        row.push(value);
        if (row.some((cell) => String(cell || '').trim())) rows.push(row);
    }
    const header = (rows.shift() || []).map((cell) => String(cell || '').trim().replace(/^\uFEFF/, ''));
    return rows.map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index] || ''])));
}

function getCurrentRouteMachineGuideContext() {
    const candidate = workloadRows().find((row) => Number(row.serial || 0) > 0) || workloadRows()[0] || null;
    if (!candidate) return { brand: '', model: '' };
    const machine = caches.machine.get(String(candidate.serial || 0));
    const model = machine ? caches.model.get(String(machine.model_id || 0)) : null;
    const brand = machine ? caches.brand.get(String(machine.brand_id || 0)) : null;
    return {
        brand: getBrandLabel(brand),
        model: getModelLabel(model, machine)
    };
}

function getGuideContextForRow(row) {
    if (!row) return { brand: '', model: '', error: '', keyword: '' };
    const machine = caches.machine.get(String(row.serial || 0));
    const model = machine ? caches.model.get(String(machine.model_id || 0)) : null;
    const brand = machine ? caches.brand.get(String(machine.brand_id || 0)) : null;
    const trouble = caches.trouble.get(String(row.trouble_id || 0));
    return {
        brand: getBrandLabel(brand),
        model: getModelLabel(model, machine),
        error: String(trouble?.trouble || row.trouble_label || '').trim(),
        keyword: String(row.remarks || row.caller || '').trim()
    };
}

function openGuideForCurrentTask() {
    const row = getCurrentRow();
    const context = getGuideContextForRow(row);
    state.guideReturnScheduleId = Number(row?.id || state.modalScheduleId || 0) || null;
    state.guideBrandQuery = context.brand;
    state.guideModelQuery = context.model;
    state.guideErrorQuery = context.error;
    state.guideSearchQuery = context.keyword;
    state.guideAutoFilled = true;
    syncGuideInputsFromState();
    closeModal();
    setActiveView('troubleshooting');
    void loadModelErrorGuides();
}

async function returnToUpdateFromGuide() {
    const scheduleId = Number(state.guideReturnScheduleId || 0);
    if (!scheduleId) {
        setActiveView('tasks');
        return;
    }
    setActiveView('tasks');
    await openModal(scheduleId);
    const workSection = document.getElementById('fieldWorkSection');
    if (workSection) {
        collapseOtherSections(workSection);
        setSectionCollapsed(workSection, false);
    }
}

function syncGuideInputsFromState() {
    [
        ['fieldGuideBrand', state.guideBrandQuery],
        ['fieldGuideModel', state.guideModelQuery],
        ['fieldGuideError', state.guideErrorQuery],
        ['fieldGuideSearch', state.guideSearchQuery]
    ].forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input && input.value !== value) input.value = value;
    });
}

function maybeAutoFillGuideContext() {
    if (state.guideAutoFilled) return;
    const context = getCurrentRouteMachineGuideContext();
    if (context.brand && !state.guideBrandQuery) state.guideBrandQuery = context.brand;
    if (context.model && !state.guideModelQuery) state.guideModelQuery = context.model;
    state.guideAutoFilled = true;
    syncGuideInputsFromState();
}

function updateGuideDatalists() {
    const rows = state.modelErrorGuides || [];
    const brandQuery = normalizeSearchText(state.guideBrandQuery);
    const modelQuery = normalizeSearchText(state.guideModelQuery);
    const modelScopedRows = rows.filter((row) => {
        const brandText = normalizeSearchText(guideBrandText(row));
        const modelText = normalizeSearchText([
            guideModelText(row),
            Array.isArray(row.model_aliases) ? row.model_aliases.join(' ') : row.model_aliases
        ].filter(Boolean).join(' '));
        if (brandQuery && !brandText.includes(brandQuery)) return false;
        if (modelQuery && !modelText.includes(modelQuery)) return false;
        return true;
    });
    const setOptions = (id, values) => {
        const list = document.getElementById(id);
        if (!list) return;
        const unique = [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b))
            .slice(0, 500);
        list.innerHTML = unique.map((value) => `<option value="${sanitize(value)}"></option>`).join('');
    };
    setOptions('fieldGuideBrandOptions', rows.map(guideBrandText));
    setOptions('fieldGuideModelOptions', rows
        .filter((row) => !brandQuery || normalizeSearchText(guideBrandText(row)).includes(brandQuery))
        .flatMap((row) => [guideModelText(row), ...(Array.isArray(row.model_aliases) ? row.model_aliases : [])]));
    setOptions('fieldGuideErrorOptions', modelScopedRows.map(guideErrorText));
}

function currentRouteGuideHints() {
    const rows = workloadRows().slice(0, 8);
    const hints = rows.flatMap((row) => {
        const trouble = caches.trouble.get(String(row.trouble_id || 0));
        const machine = caches.machine.get(String(row.serial || 0));
        const model = machine ? caches.model.get(String(machine.model_id || 0)) : null;
        return [
            trouble?.trouble,
            row.remarks,
            row.caller,
            getModelLabel(model, machine)
        ].filter(Boolean);
    });
    return normalizeSearchText(hints.join(' '));
}

function getFilteredGuideRows() {
    const query = normalizeSearchText([
        state.guideSearchQuery,
        state.guideBrandQuery,
        state.guideModelQuery,
        state.guideErrorQuery
    ].filter(Boolean).join(' '));
    const brandQuery = normalizeSearchText(state.guideBrandQuery);
    const modelQuery = normalizeSearchText(state.guideModelQuery);
    const errorQuery = normalizeSearchText(state.guideErrorQuery);
    const keywordQuery = normalizeSearchText(state.guideSearchQuery);
    if (!brandQuery || !modelQuery || (!errorQuery && !keywordQuery)) return [];
    const routeHints = currentRouteGuideHints();
    const terms = query ? query.split(/\s+/).filter(Boolean) : [];
    const routeTerms = routeHints ? routeHints.split(/\s+/).filter((term) => term.length >= 3).slice(0, 12) : [];
    return (state.modelErrorGuides || [])
        .map((row) => {
            const text = guideSearchText(row);
            const brandText = normalizeSearchText(guideBrandText(row));
            const modelText = normalizeSearchText([
                guideModelText(row),
                Array.isArray(row.model_aliases) ? row.model_aliases.join(' ') : row.model_aliases
            ].filter(Boolean).join(' '));
            const errorText = normalizeSearchText(guideErrorText(row));
            const brandMismatch = Boolean(brandQuery && !brandText.includes(brandQuery));
            const modelMismatch = Boolean(modelQuery && !modelText.includes(modelQuery));
            const errorMismatch = Boolean(errorQuery && !errorText.includes(errorQuery));
            if (brandMismatch || modelMismatch || errorMismatch) return { row, score: -1 };
            const queryScore = terms.length ? terms.reduce((score, term) => score + (text.includes(term) ? 10 : 0), 0) : 0;
            const brandScore = brandQuery ? 20 : 0;
            const modelScore = modelQuery ? 35 : 0;
            const errorScore = errorQuery ? 35 : 0;
            const routeScore = routeTerms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
            return { row, score: query ? queryScore + brandScore + modelScore + errorScore + routeScore : routeScore };
        })
        .filter((item) => {
            if (item.score < 0) return false;
            if (brandQuery && modelQuery && !state.guideErrorQuery && !state.guideSearchQuery) return false;
            return query ? item.score >= 10 : item.score > 0;
        })
        .sort((a, b) => b.score - a.score || String(a.row.model || '').localeCompare(String(b.row.model || '')))
        .slice(0, 24)
        .map((item) => item.row);
}

function renderTroubleshootingGuide() {
    const list = document.getElementById('fieldGuideList');
    if (!list) return;
    const backButton = document.getElementById('fieldGuideBackBtn');
    if (backButton) backButton.hidden = !Number(state.guideReturnScheduleId || 0);
    syncGuideInputsFromState();
    updateGuideDatalists();
    if (!state.modelErrorGuidesLoaded) {
        list.innerHTML = '<div class="loading-cell">Loading troubleshooting guide...</div>';
        return;
    }
    const rows = getFilteredGuideRows();
    if (!rows.length) {
        list.innerHTML = `
            <div class="field-guide-empty">
                <strong>No guide matched yet.</strong>
                <p>Select or enter Brand / Make and Model, then choose Error / Trouble or type a keyword. This prevents using an error guide from the wrong machine family.</p>
            </div>
        `;
        return;
    }
    list.innerHTML = rows.map((row) => `
        <article class="field-guide-card">
            <div class="field-guide-card-head">
                <div>
                    <span>${sanitize(row.family || row.model || 'Machine guide')}</span>
                    <h4>${sanitize(row.lcd_error_message || row.trouble_label || 'Troubleshooting guide')}</h4>
                </div>
                <strong>${sanitize(row.model || 'General')}</strong>
            </div>
            <div class="field-guide-meta">
                <span>${sanitize(row.trouble_label || 'Trouble')}</span>
                ${row.service_level_code ? `<span>Code: ${sanitize(row.service_level_code)}</span>` : ''}
            </div>
            <div class="field-guide-steps">
                <p><b>Meaning:</b> ${sanitize(row.meaning || 'No meaning recorded.')}</p>
                <p><b>What to do:</b> ${sanitize(row.what_to_do || 'No steps recorded yet.')}</p>
            </div>
        </article>
    `).join('');
}

async function loadModelErrorGuides(options = {}) {
    const { force = false } = options;
    if (state.modelErrorGuidesLoaded && !force) {
        renderTroubleshootingGuide();
        return;
    }
    const list = document.getElementById('fieldGuideList');
    if (list) list.innerHTML = '<div class="loading-cell">Loading troubleshooting guide...</div>';
    try {
        const docs = await queryCollection(MODEL_ERROR_GUIDE_COLLECTION, FIELD_QUERY_LIMIT);
        state.modelErrorGuides = mergePendingOfflineRows(MODEL_ERROR_GUIDE_COLLECTION, docs.map(parseFirestoreDoc).filter(Boolean));
        if (!state.modelErrorGuides.length) {
            const response = await fetch('/tools/model-error-guides-import.csv', { cache: 'no-store' });
            if (response.ok) {
                state.modelErrorGuides = parseCsvRows(await response.text());
            }
        }
        state.modelErrorGuidesLoaded = true;
    } catch (error) {
        console.warn('Troubleshooting guide load failed:', error);
        try {
            const response = await fetch('/tools/model-error-guides-import.csv', { cache: 'no-store' });
            state.modelErrorGuides = response.ok ? parseCsvRows(await response.text()) : [];
        } catch (fallbackError) {
            console.warn('Troubleshooting guide CSV fallback failed:', fallbackError);
            state.modelErrorGuides = [];
        }
        state.modelErrorGuidesLoaded = true;
        if (!state.modelErrorGuides.length && list) {
            list.innerHTML = `<div class="loading-cell">Troubleshooting guide could not load: ${sanitize(error?.message || error)}</div>`;
            return;
        }
    }
    maybeAutoFillGuideContext();
    renderTroubleshootingGuide();
}

function normalizeSolutionText(value) {
    return normalizeSearchText(value).replace(/\s+/g, ' ').trim();
}

function solutionDedupeKey(row, solution) {
    const context = getGuideContextForRow(row);
    return normalizeSolutionText([
        context.brand,
        context.model,
        context.error,
        solution
    ].join(' '));
}

async function submitSolutionRequest() {
    const row = getCurrentRow();
    if (!row) return;
    const solution = String(document.getElementById('fieldSolutionNotes')?.value || '').trim();
    if (solution.length < 12) {
        alert('Please write a clear solution before submitting.');
        return;
    }
    const key = solutionDedupeKey(row, solution);
    const staffId = Number(state.staffId || 0) || 0;
    const context = getGuideContextForRow(row);
    const nowIso = new Date().toISOString();
    const docId = `solution_${row.id}_${staffId}_${Date.now()}`;
    const payload = {
        id: docId,
        schedule_id: Number(row.id || 0) || 0,
        staff_id: staffId,
        staff_name: getCurrentStaffName(),
        brand: context.brand,
        model: context.model,
        trouble: context.error,
        keyword: context.keyword,
        solution,
        dedupe_key: key,
        status: 'pending',
        requested_at: nowIso,
        requested_by: staffId,
        approved_at: '',
        approved_by: 0,
        rejection_reason: ''
    };
    const button = document.getElementById('fieldSubmitSolutionBtn');
    if (button) button.disabled = true;
    try {
        await setDocument(SOLUTION_REQUEST_COLLECTION, docId, payload);
        alert('Solution request submitted for team leader approval.');
        document.getElementById('fieldSolutionNotes').value = '';
    } catch (error) {
        console.error('Solution request failed:', error);
        alert(`Failed to submit solution: ${error?.message || error}`);
    } finally {
        if (button) button.disabled = false;
    }
}

async function loadSolutionRequests(options = {}) {
    const { force = false } = options;
    if (state.solutionRequestsLoaded && !force) {
        renderSolutionRequests();
        return;
    }
    const list = document.getElementById('fieldSolutionRequestsList');
    if (list) list.innerHTML = '<div class="loading-cell">Loading solution requests...</div>';
    const docs = await queryCollection(SOLUTION_REQUEST_COLLECTION, FIELD_QUERY_LIMIT).catch(() => []);
    state.solutionRequests = mergePendingOfflineRows(SOLUTION_REQUEST_COLLECTION, docs.map(parseFirestoreDoc).filter(Boolean));
    state.solutionRequestsLoaded = true;
    renderSolutionRequests();
}

function renderSolutionRequests() {
    const list = document.getElementById('fieldSolutionRequestsList');
    if (!list) return;
    if (!isFieldTechTeamLeader()) {
        list.innerHTML = '<div class="loading-cell">Only Team Leader - Field Technicians can view solution requests.</div>';
        return;
    }
    if (!state.solutionRequestsLoaded) {
        list.innerHTML = '<div class="loading-cell">Loading solution requests...</div>';
        return;
    }
    const pending = state.solutionRequests
        .filter((row) => String(row.status || 'pending').toLowerCase() === 'pending')
        .sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
    if (!pending.length) {
        list.innerHTML = '<div class="field-guide-empty"><strong>No pending solution requests.</strong><p>Approved unique solutions will become part of the troubleshooting knowledge base later.</p></div>';
        return;
    }
    list.innerHTML = pending.map((row) => `
        <article class="field-guide-card">
            <div class="field-guide-card-head">
                <div>
                    <span>${sanitize(row.staff_name || 'Field technician')}</span>
                    <h4>${sanitize(row.trouble || 'Solution request')}</h4>
                </div>
                <strong>${sanitize(row.model || 'Model')}</strong>
            </div>
            <div class="field-guide-meta">
                <span>${sanitize(row.brand || 'Brand')}</span>
                <span>Pending approval</span>
            </div>
            <div class="field-guide-steps">
                <p><b>Solution:</b> ${sanitize(row.solution || '')}</p>
            </div>
            <div class="field-solution-actions">
                <button type="button" class="btn btn-primary btn-sm" data-solution-action="approve" data-id="${sanitize(row._docId || row.id || '')}">Approve</button>
                <button type="button" class="btn btn-secondary btn-sm" data-solution-action="reject" data-id="${sanitize(row._docId || row.id || '')}">Reject</button>
            </div>
        </article>
    `).join('');
}

function guideDocIdFromSolution(row) {
    return [
        row.model || 'general',
        row.trouble || 'solution',
        row.solution || ''
    ].join('__').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 140);
}

async function handleSolutionRequestAction(event) {
    const button = event.target.closest('[data-solution-action]');
    if (!button) return;
    if (!isFieldTechTeamLeader()) return;
    const action = button.dataset.solutionAction;
    const docId = button.dataset.id;
    const request = state.solutionRequests.find((row) => String(row._docId || row.id || '') === String(docId));
    if (!request) return;
    button.disabled = true;
    try {
        const nowIso = new Date().toISOString();
        if (action === 'reject') {
            await patchDocument(SOLUTION_REQUEST_COLLECTION, docId, {
                status: 'rejected',
                reviewed_at: nowIso,
                reviewed_by: Number(state.staffId || 0) || 0
            });
        } else {
            await setDocument(MODEL_ERROR_GUIDE_COLLECTION, guideDocIdFromSolution(request), {
                model: request.model || '',
                model_aliases: [],
                family: request.brand || '',
                trouble_id: 0,
                trouble_label: request.trouble || '',
                lcd_error_message: request.trouble || '',
                meaning: `Field-proven solution submitted from schedule ${request.schedule_id || ''}.`,
                what_to_do: request.solution || '',
                service_level_code: '',
                source_reference: `Approved field solution by ${getCurrentStaffName()}`,
                source_file: 'field_solution_request',
                updated_at: nowIso
            });
            await patchDocument(SOLUTION_REQUEST_COLLECTION, docId, {
                status: 'approved',
                approved_at: nowIso,
                approved_by: Number(state.staffId || 0) || 0
            });
        }
        state.solutionRequestsLoaded = false;
        state.modelErrorGuidesLoaded = false;
        await loadSolutionRequests({ force: true });
    } catch (error) {
        console.error('Solution request action failed:', error);
        alert(`Solution request action failed: ${error?.message || error}`);
        button.disabled = false;
    }
}

function rowMatchesCustomerSearch(row, query) {
    const search = normalizeSearchText(query);
    if (!search) return true;

    const branch = caches.branch.get(String(row.branch_id || 0));
    const company = caches.company.get(String(row.company_id || branch?.company_id || 0));
    const machine = caches.machine.get(String(row.serial || 0));
    const text = normalizeSearchText([
        row.id,
        company?.companyname,
        row.company_name,
        branch?.branchname,
        row.branch_name,
        machine?.serial,
        row.field_serial_selected,
        row.route_remarks,
        row.remarks,
        row.caller
    ].filter(Boolean).join(' '));
    return text.includes(search);
}

function renderList() {
    const list = document.getElementById('fieldList');
    const rows = activeRows();
    const filtered = rows.filter((row) => {
        const status = getStatusKey(row);
        if (state.activeTab === 'closed') return rowMatchesCustomerSearch(row, state.searchQuery);
        if (state.statusFilter === 'all' && !isWorkingRouteRow(row)) return false;
        if (state.statusFilter !== 'all' && status !== state.statusFilter) return false;
        return rowMatchesCustomerSearch(row, state.searchQuery);
    });

    if (!filtered.length) {
        const emptyText = state.activeTab === 'closed'
            ? 'No closed tasks for the selected date.'
            : state.activeTab === 'carryover'
            ? 'No past pending tasks for selected date/filter.'
            : closedRowsForSelectedDate().length
            ? `No open tasks for selected date/filter. ${closedRowsForSelectedDate().length} closed task(s) are available in the Closed tab.`
            : 'No current tasks for selected date/filter.';
        list.innerHTML = `<div class="loading-cell">${sanitize(emptyText)}</div>`;
        return;
    }

    const closedNotice = state.activeTab === 'closed' ? `
        <div class="field-priority-lock">
            <strong>Closed accounts for ${sanitize(state.selectedDate || document.getElementById('fieldDate')?.value || localDateYmd())}.</strong>
            <p>Use Reopen only if a task was accidentally closed or you are testing. Reopened tasks return to open/pending work.</p>
        </div>
    ` : '';
    const priorityNotice = state.activeTab !== 'closed' && !state.priorityGate.ready ? `
        <div class="field-priority-lock">
            <strong>Priority discussion pending.</strong>
            <p>Team leader or CSR has numbered ${state.priorityGate.numbered}/${state.priorityGate.required} priority schedule${state.priorityGate.required === 1 ? '' : 's'}. Review your route while final priority is being discussed.</p>
            <span>Route is open for study, coordination, and end-of-day review.</span>
        </div>
    ` : '';

    state.combinedTaskGroups = new Map();
    const taskGroups = state.activeTab === 'closed'
        ? prioritySortedRows(filtered).map((row) => ({ primary: row, rows: [row] }))
        : buildCombinedTaskGroups(filtered);

    list.innerHTML = closedNotice + priorityNotice + taskGroups.map((group) => {
        const row = group.primary;
        const relatedRows = Array.isArray(group.rows) && group.rows.length ? group.rows : [row];
        state.combinedTaskGroups.set(String(row.id || ''), relatedRows.map((item) => Number(item.id || 0)).filter(Boolean));
        const trouble = caches.trouble.get(String(row.trouble_id || 0));
        const troubleLabel = trouble?.trouble || (row.trouble_id ? `Trouble ${row.trouble_id}` : 'Unspecified');
        const purposeLabel = PURPOSE_LABELS[row.purpose_id] || `Purpose ${row.purpose_id}`;

        const branch = caches.branch.get(String(row.branch_id || 0));
        const company = caches.company.get(String(row.company_id || branch?.company_id || 0));
        const area = caches.area.get(String(row.area_id || branch?.area_id || 0));
        const machine = caches.machine.get(String(row.serial || 0));
        const model = machine ? caches.model.get(String(machine.model_id || 0)) : null;
        const brand = machine ? caches.brand.get(String(machine.brand_id || 0)) : null;

        const status = getStatusMeta(row);
        const priority = schedulePriorityValue(row);
        const clientName = company?.companyname || '-';
        const branchName = branch?.branchname || `Branch #${row.branch_id || 0}`;
        const areaName = area?.area_name || '-';
        const machineSerial = machine?.serial || row.field_serial_selected || '-';
        const modelName = getModelLabel(model, machine);
        const brandName = getBrandLabel(brand);
        const machineLine = brandName || modelName
            ? `${sanitize(brandName)} ${sanitize(modelName)}`.trim()
            : 'Machine';
        const originalDate = originalScheduleDate(row);
        const routeDate = dateOnly(getRouteTaskDateTime(row));
        const originalDateLine = originalDate
            ? `<div class="sub"><strong>Original schedule:</strong> ${sanitize(formatShortDate(originalDate))}${routeDate && routeDate !== originalDate ? ` · Forwarded to ${sanitize(formatShortDate(routeDate))}` : ''}</div>`
            : '';
        const routeSourceLine = state.activeTab === 'carryover'
            ? `<div class="sub"><strong>Source:</strong> ${sanitize(String(row.route_source || 'Past Pending').replace(/carry[ -]?over/ig, 'Past Pending'))}</div>`
            : '';
        const closeRequest = state.closeRequestsBySchedule.get(String(row.id || ''));
        const canRequestClose = state.activeTab !== 'closed';
        const closeRequestAction = canRequestClose
            ? (closeRequest
                ? `<button type="button" class="btn btn-secondary btn-sm" disabled>Close Requested</button>`
                : `<button type="button" class="btn btn-secondary btn-sm" data-action="request-close" data-id="${row.id}">Request Close</button>`)
            : '';
        const reopenAction = state.activeTab === 'closed'
            ? `<button type="button" class="btn btn-secondary btn-sm" data-action="reopen-closed" data-id="${row.id}">Reopen</button>`
            : '';
        const partsNote = Number(row.pending_parts || 0) === 1 || Number(row.isongoing || 0) === 1
            ? '<div class="sub"><strong>Pending:</strong> parts preparation in progress.</div>'
            : '';
        const taskNotes = row.route_remarks || row.remarks || row.caller || '-';
        const combinedLabels = uniqueCombinedWorkLabels(relatedRows);
        const combinedLine = relatedRows.length > 1
            ? `<div class="sub"><strong>Combined stop:</strong> ${sanitize(combinedLabels.join(', '))}. ${relatedRows.length} schedule${relatedRows.length === 1 ? '' : 's'} grouped here.</div>`
            : '';

        return `
            <div class="field-task">
                <div class="field-task-top">
                    <div>
                        <h4>#${sanitize(row.id)} ${sanitize(purposeLabel)} / ${sanitize(troubleLabel)}</h4>
                        <div class="meta">${priority ? `Priority ${sanitize(priority)} · ` : ''}${sanitize(formatTaskDateTime(row.task_datetime))} · <span class="ops-status-badge ${sanitize(status.className)}">${sanitize(status.label)}</span></div>
                        <div class="sub">${sanitize(clientName)} · ${sanitize(branchName)} · ${sanitize(areaName)}</div>
                        ${originalDateLine}
                        <div class="sub">${machineLine} · Serial: <strong>${sanitize(machineSerial)}</strong></div>
                        ${combinedLine}
                        <div class="sub">${sanitize(taskNotes)}</div>
                        ${routeSourceLine}
                        ${partsNote}
                    </div>
                    <div class="field-task-actions">
                        ${closeRequestAction}
                        ${reopenAction}
                        <button type="button" class="btn btn-secondary btn-sm" data-action="open" data-id="${row.id}">Update</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('button[data-action="open"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const scheduleId = Number(btn.dataset.id || 0);
            if (!scheduleId) return;
            openModal(scheduleId).catch((err) => {
                console.error('Open modal failed:', err);
                alert(`Unable to open task: ${err?.message || err}`);
            });
        });
    });
    list.querySelectorAll('button[data-action="request-close"]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            handleRequestCloseButton(btn);
        });
    });
    list.querySelectorAll('button[data-action="reopen-closed"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const scheduleId = Number(btn.dataset.id || 0);
            const row = state.rows.find((item) => Number(item.id || 0) === scheduleId);
            if (!row) return;
            if (!window.confirm('Reopen this closed task and return it to open/pending?')) return;
            reopenScheduleRow(row, btn).catch((err) => {
                console.error('Reopen from closed list failed:', err);
                alert(`Unable to reopen task: ${err?.message || err}`);
            });
        });
    });
}

function handleRequestCloseButton(button) {
    const scheduleId = Number(button?.dataset?.id || 0);
    const row = findFieldScheduleRow(scheduleId);
    if (!row) {
        alert('Unable to find this schedule. Please tap Refresh and try again.');
        return;
    }
    button.disabled = true;
    requestCloseForSchedule(row).catch((err) => {
        console.error('Close request failed:', err);
        alert(`Unable to request close: ${err?.message || err}`);
    }).finally(() => {
        button.disabled = false;
    });
}

async function requestCloseForSchedule(row) {
    const scheduleId = Number(row?.id || 0) || 0;
    if (!scheduleId) return;
    if (state.closeRequestsBySchedule.has(String(scheduleId))) {
        alert('Close request already submitted for this schedule.');
        return;
    }

    const reason = window.prompt('Why should this schedule be closed? Example: Done today but GPS/app would not allow Mark Finished.');
    if (reason === null) return;
    const safeReason = String(reason || '').trim();
    if (!safeReason) {
        alert('Please add a short reason for approval.');
        return;
    }

    const staffId = Number(state.staffId || 0) || 0;
    const staffName = document.getElementById('fieldHeaderTitle')?.textContent?.split(' - ')[0] || '';
    const nowIso = new Date().toISOString();
    const docId = `close_${scheduleId}_${staffId}_${Date.now()}`;
    const payload = {
        id: docId,
        schedule_id: scheduleId,
        schedule_doc_id: scheduleDocIdForRow(row),
        requester_staff_id: staffId,
        requester_name: staffName,
        request_date: localDateYmd(),
        requested_at: nowIso,
        status: 'pending',
        reason: safeReason,
        task_datetime: String(row.task_datetime || ''),
        branch_id: Number(row.branch_id || 0) || 0,
        company_id: Number(row.company_id || 0) || 0,
        tech_id: Number(row.tech_id || 0) || 0,
        route_doc_id: String(row.route_doc_id || ''),
        route_source: String(row.route_source || ''),
        source: state.activeTab === 'carryover' ? 'field_app_past_pending' : 'field_app_today'
    };

    await setDocument(CLOSE_REQUEST_COLLECTION, docId, payload);
    state.closeRequestsBySchedule.set(String(scheduleId), { ...payload, _docId: docId });
    renderActiveView();
    alert('Close request sent for approval.');
}

function isFinishedOrCancelled(row) {
    if (Number(row.route_iscancelled || row.iscancelled || row.iscancel || 0) === 1) return true;
    if (normalizeLegacyDateTime(row.route_date_finished || row.date_finished)) return true;
    const routeStatus = row.route_status === '' || row.route_status === undefined || row.route_status === null
        ? null
        : Number(row.route_status);
    return routeStatus === 0;
}

function isClosedPlannerRow(row) {
    const statusValues = [
        row?.planner_status,
        row?.task_status,
        row?.route_status,
        row?.status
    ].map((value) => String(value || '').trim().toLowerCase());
    if (statusValues.some((value) => ['closed', 'finished', 'completed', 'done'].includes(value))) return true;
    return Boolean(normalizeLegacyDateTime(row?.date_finished || row?.closed_at || row?.completed_at));
}

function getPlannerLinkedScheduleDocIds(row) {
    const plannerId = String(row?._docId || row?.id || '').trim();
    const derivedNumericId = plannerId ? String(Number(String(plannerId).replace(/\D/g, '').slice(-12) || 0) || '') : '';
    const ids = [
        row?.schedule_task_doc_id,
        row?.schedule_doc_id,
        row?.field_schedule_doc_id,
        row?.schedule_task_id,
        derivedNumericId
    ].map((value) => String(value || '').trim()).filter(Boolean);
    return [...new Set(ids)];
}

async function getClosedPlannerSourceIds(plannerRows = []) {
    const sourceIds = new Set();
    const checks = [];

    plannerRows.forEach((row) => {
        const plannerId = String(row?._docId || row?.id || '').trim();
        if (!plannerId) return;
        if (isClosedPlannerRow(row)) {
            sourceIds.add(plannerId);
            return;
        }
        getPlannerLinkedScheduleDocIds(row).forEach((docId) => {
            checks.push({ plannerId, docId });
        });
    });

    if (!checks.length) return sourceIds;

    const results = await Promise.all(checks.map(({ plannerId, docId }) => (
        fetchDoc('tbl_schedule', docId)
            .then((schedule) => ({ plannerId, schedule }))
            .catch(() => ({ plannerId, schedule: null }))
    )));
    results.forEach(({ plannerId, schedule }) => {
        if (schedule && isFinishedOrCancelled(schedule)) sourceIds.add(plannerId);
    });
    return sourceIds;
}

function asOlderCarryoverRow(row) {
    return {
        ...row,
        route_id: 0,
        route_doc_id: '',
        route_source: 'Older Pending',
        route_tech_id: Number(row.tech_id || 0) || 0,
        route_task_datetime: String(row.task_datetime || ''),
        route_status: '',
        route_iscancelled: Number(row.iscancel || row.iscancelled || 0) || 0,
        route_date_finished: String(row.date_finished || ''),
        route_remarks: String(row.remarks || row.caller || '').trim()
    };
}

function asDirectTodayScheduleRow(row) {
    return {
        ...row,
        route_id: 0,
        route_doc_id: '',
        route_source: 'Schedule',
        route_tech_id: Number(row.tech_id || 0) || 0,
        route_task_datetime: String(row.task_datetime || ''),
        route_status: '',
        route_iscancelled: Number(row.iscancel || row.iscancelled || 0) || 0,
        route_date_finished: String(row.date_finished || ''),
        route_remarks: String(row.remarks || row.caller || '').trim()
    };
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    const raw = String(value || '').trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (parsed === null || parsed === undefined || parsed === '') return [];
        return [parsed];
    } catch (_) {
        return raw.split(',').map((item) => item.trim()).filter(Boolean);
    }
}

function plannerRowToFieldSchedule(row) {
    const scheduleDate = String(row.schedule_date || row.preferred_schedule_date || '').trim();
    const scheduleTime = String(row.schedule_time || '').trim() || '08:00';
    const taskDatetime = scheduleDate
        ? `${scheduleDate} ${scheduleTime.length === 5 ? `${scheduleTime}:00` : scheduleTime}`
        : String(row.created_at || '');
    const plannerId = String(row._docId || row.id || '').trim();
    const numericId = Number(row.schedule_task_id || String(plannerId).replace(/\D/g, '').slice(-12) || Date.now()) || Date.now();
    const purpose = String(row.schedule_purpose || row.purpose || '').trim().toLowerCase();
    const purposeId = purpose.includes('reading') ? 8 : purpose.includes('collection') ? 2 : 1;
    const contractMainId = Number(parseJsonArray(row.contractmain_ids_json || row.contractmain_ids)[0] || row.contractmain_id || 0) || 0;
    return {
        id: numericId,
        _docId: plannerId,
        source_module: 'billing',
        source_planner_doc_id: plannerId,
        task_datetime: taskDatetime,
        tech_id: Number(row.assigned_staff_id || row.assigned_to_id || row.suggested_staff_id || 0) || 0,
        purpose_id: purposeId,
        purpose: row.schedule_purpose || row.purpose || 'Printed Billing',
        trouble: row.task_label || row.schedule_purpose || row.purpose || 'Billing Schedule',
        trouble_id: 0,
        branch_id: Number(row.primary_branch_id || 0) || 0,
        company_id: Number(row.company_id || 0) || 0,
        contractmain_id: contractMainId,
        serial: Number(parseJsonArray(row.machine_ids_json || row.machine_ids)[0] || row.machine_id || 0) || 0,
        mach_id: Number(parseJsonArray(row.machine_ids_json || row.machine_ids)[0] || row.machine_id || 0) || 0,
        machine_id: Number(parseJsonArray(row.machine_ids_json || row.machine_ids)[0] || row.machine_id || 0) || 0,
        field_serial_selected: parseJsonArray(row.serial_numbers_json || row.serial_numbers)[0] || row.serial || '',
        branch_name: row.primary_branch_name || parseJsonArray(row.branch_names_json || row.branch_names)[0] || '',
        company_name: row.company_name || row.account_name || '',
        caller: row.task_label || row.schedule_purpose || row.purpose || 'Billing Schedule',
        remarks: row.notes || row.completion_notes || '',
        route_id: 0,
        route_doc_id: '',
        route_source: 'Billing Planner',
        route_tech_id: Number(row.assigned_staff_id || row.assigned_to_id || row.suggested_staff_id || 0) || 0,
        route_task_datetime: taskDatetime,
        route_status: row.route_status || row.task_status || row.planner_status || '',
        route_iscancelled: 0,
        route_date_finished: '',
        route_remarks: row.notes || ''
    };
}

async function loadOlderCarryoverRows(date, excludedScheduleIds) {
    const days = [];
    for (let index = 1; index <= FIELD_CARRYOVER_DAYS; index += 1) {
        days.push(addDaysYmd(date, -index));
    }

    const rows = [];
    const concurrency = 6;
    for (let index = 0; index < days.length; index += concurrency) {
        const slice = days.slice(index, index + concurrency);
        const results = await Promise.all(slice.map((day) => (
            queryByDateRange('tbl_schedule', 'task_datetime', `${day} 00:00:00`, `${day} 23:59:59`).catch(() => [])
        )));
        results.flat().map(parseFirestoreDoc).filter(Boolean).forEach((row) => {
            const scheduleId = Number(row.id || row._docId || 0);
            if (!scheduleId || excludedScheduleIds.has(scheduleId)) return;
            if (Number(row.tech_id || 0) !== Number(state.staffId || 0)) return;
            if (isFinishedOrCancelled(row)) return;
            rows.push(asOlderCarryoverRow(row));
        });
    }

    return rows;
}

async function buildCarryoverRows({ date, printedRows, savedRows, todayRows }) {
    const printedScheduleIds = new Set(printedRows.map((row) => Number(row.schedule_id || 0)).filter((id) => id > 0));
    const currentScheduleIds = new Set(todayRows.map((row) => Number(row.id || 0)).filter((id) => id > 0));

    const savedCarryoverRoutes = savedRows
        .filter((row) => !printedScheduleIds.has(Number(row.schedule_id || 0)))
        .filter((row) => Number(row.iscancelled || row.iscancel || 0) !== 1);

    const savedCarryoverRows = (await buildRouteBoundRows(savedCarryoverRoutes, 'past pending'))
        .filter((row) => getAssignedStaffId(row) === Number(state.staffId || 0))
        .filter(isDispatchableFieldRow)
        .filter((row) => !currentScheduleIds.has(Number(row.id || 0)))
        .filter((row) => !isFinishedOrCancelled(row));

    savedCarryoverRows.forEach((row) => {
        currentScheduleIds.add(Number(row.id || 0));
        row.route_source = 'Saved Past Pending';
    });

    const olderRows = await loadOlderCarryoverRows(date, currentScheduleIds);
    const combined = [...savedCarryoverRows, ...olderRows.filter(isDispatchableFieldRow)];
    const unique = new Map();
    combined.forEach((row) => {
        const scheduleId = Number(row.id || row._docId || 0);
        if (!scheduleId) return;
        if (!unique.has(scheduleId)) unique.set(scheduleId, row);
    });

    return Array.from(unique.values())
        .sort((a, b) => (
            String(getRouteTaskDateTime(a)).localeCompare(String(getRouteTaskDateTime(b))) ||
            (Number(a.id || 0) - Number(b.id || 0))
        ));
}

async function loadMySchedule(options = {}) {
    const date = document.getElementById('fieldDate').value || formatDateYmd(new Date());
    const { keepTab = false } = options;
    if (!keepTab) state.activeTab = 'today';
    state.selectedDate = date;
    state.attendanceLocationCheckScheduleId = null;
    setAttendanceLocationCheckUi();
    const subtitle = document.getElementById('fieldSubtitle');
    subtitle.textContent = 'Loading printed route...';
    setRouteLoadProgress(8, 'Loading attendance record...');
    await loadAttendanceForSelectedDate().catch((error) => {
        console.warn('Attendance load failed:', error);
        const status = document.getElementById('fieldAttendanceStatus');
        if (status) status.textContent = 'Attendance could not load. Try Refresh.';
    });

    document.getElementById('fieldList').innerHTML = '<div class="loading-cell">Loading...</div>';

    try {
        setRouteLoadProgress(22, 'Loading today route...');
        const dayStart = `${date} 00:00:00`;
        const dayEnd = `${date} 23:59:59`;
        const historyStart = `${addDaysYmd(date, -30)} 00:00:00`;
        const [printedDocs, savedDocs, scheduleDocs, plannerDocs, closeRequestDocs, pettyCashDocs, reviewDocs, skillHistoryDocs] = await Promise.all([
            queryByDateRange(ROUTE_COLLECTION_PRIMARY, 'task_datetime', dayStart, dayEnd).catch(() => []),
            queryByDateRange(ROUTE_COLLECTION_FALLBACK, 'task_datetime', dayStart, dayEnd).catch(() => []),
            queryByDateRange('tbl_schedule', 'task_datetime', dayStart, dayEnd).catch(() => []),
            queryEquals(SCHEDULE_PLANNER_COLLECTION, 'schedule_date', date, 'string', FIELD_QUERY_LIMIT).catch(() => []),
            queryEquals(CLOSE_REQUEST_COLLECTION, 'requester_staff_id', Number(state.staffId || 0), 'integer', FIELD_QUERY_LIMIT).catch(() => []),
            queryByDateRange(PETTY_CASH_ENTRY_COLLECTION, 'date', date, date).catch(() => []),
            queryCollection(CUSTOMER_REVIEW_COLLECTION, FIELD_QUERY_LIMIT).catch(() => []),
            queryByDateRange('tbl_schedule', 'task_datetime', historyStart, dayEnd).catch(() => [])
        ]);

        setRouteLoadProgress(45, 'Matching route rows to schedules...');
        const printedSourceRows = mergePendingOfflineRows(ROUTE_COLLECTION_PRIMARY, printedDocs.map(parseFirestoreDoc).filter(Boolean));
        const savedSourceRows = mergePendingOfflineRows(ROUTE_COLLECTION_FALLBACK, savedDocs.map(parseFirestoreDoc).filter(Boolean));
        const scheduleSourceRows = mergePendingOfflineRows('tbl_schedule', scheduleDocs.map(parseFirestoreDoc).filter(Boolean));
        const plannerSourceRows = mergePendingOfflineRows(SCHEDULE_PLANNER_COLLECTION, plannerDocs.map(parseFirestoreDoc).filter(Boolean));
        state.pettyCashEntries = mergePendingOfflineRows(PETTY_CASH_ENTRY_COLLECTION, pettyCashDocs.map(parseFirestoreDoc).filter(Boolean));
        state.customerReviews = mergePendingOfflineRows(CUSTOMER_REVIEW_COLLECTION, reviewDocs.map(parseFirestoreDoc).filter(Boolean));
        state.skillHistoryRows = mergePendingOfflineRows('tbl_schedule', skillHistoryDocs.map(parseFirestoreDoc).filter(Boolean))
            .filter((row) => getAssignedStaffId(row) === Number(state.staffId || 0));
        loadCloseRequestLookup(closeRequestDocs.map(parseFirestoreDoc).filter(Boolean));

        const printedRows = pickLatestRouteRows(printedSourceRows, date);
        const savedRows = pickLatestRouteRows(savedSourceRows, date);
        const routeRows = mergeTodayRouteRows(printedRows, savedRows);
        const routeSourceLabel = printedRows.length && savedRows.length ? 'Printed + Saved' : (printedRows.length ? 'Printed' : 'Saved');

        const routeBoundTodayRows = (await buildRouteBoundRows(routeRows, routeSourceLabel.toLowerCase()))
            .filter((row) => getAssignedStaffId(row) === Number(state.staffId || 0))
            .filter(isDispatchableFieldRow);
        const routeScheduleIds = new Set(routeBoundTodayRows.map((row) => Number(row.id || 0)).filter((id) => id > 0));
        const directTodayRows = scheduleSourceRows
            .filter((row) => Number(row.tech_id || 0) === Number(state.staffId || 0))
            .filter(isDispatchableFieldRow)
            .filter((row) => !routeScheduleIds.has(Number(row.id || row._docId || 0)))
            .map(asDirectTodayScheduleRow);
        const existingPlannerIds = new Set(directTodayRows.map((row) => String(row.field_billing_schedule_doc_id || row.source_planner_doc_id || '').trim()).filter(Boolean));
        const closedPlannerIds = await getClosedPlannerSourceIds(plannerSourceRows);
        const plannerTodayRows = plannerSourceRows
            .filter((row) => String(row.department || '') === 'billing')
            .filter((row) => Number(row.assigned_staff_id || row.assigned_to_id || row.suggested_staff_id || 0) === Number(state.staffId || 0))
            .filter((row) => Number(row.purpose_id || 0) !== 9)
            .filter((row) => !existingPlannerIds.has(String(row._docId || row.id || '').trim()))
            .filter((row) => !closedPlannerIds.has(String(row._docId || row.id || '').trim()))
            .map(plannerRowToFieldSchedule);
        const allCurrentRows = [...routeBoundTodayRows, ...directTodayRows, ...plannerTodayRows]
            .sort((a, b) => String(getRouteTaskDateTime(a)).localeCompare(String(getRouteTaskDateTime(b))) || (Number(a.id || 0) - Number(b.id || 0)));
        const forwardedPastPendingRows = allCurrentRows.filter((row) => isPastPendingByOriginalDate(row));
        forwardedPastPendingRows.forEach((row) => {
            row.route_source = row.route_source || 'Forwarded Past Pending';
        });
        const todayRows = allCurrentRows.filter((row) => !isPastPendingByOriginalDate(row));

        state.routeSourceLabel = routeRows.length ? routeSourceLabel : 'Schedule';
        state.todayRows = todayRows;
        state.carryoverRows = forwardedPastPendingRows;
        state.rows = [...todayRows, ...forwardedPastPendingRows];
        updatePriorityGate(workloadRows());
        setRouteLoadProgress(62, 'Preparing customer and machine details...');
        await hydrateLookups(state.rows);
        renderAttendanceLocationSummary();
        renderActiveView();

        const carryoverCount = document.getElementById('fieldCarryoverCount');
        if (carryoverCount) carryoverCount.textContent = '...';
        try {
            setRouteLoadProgress(78, 'Checking past pending routes...');
            const carryoverRows = await buildCarryoverRows({ date, printedRows, savedRows, todayRows });
            const knownCarryoverIds = new Set(forwardedPastPendingRows.map((row) => Number(row.id || 0)).filter(Boolean));
            state.carryoverRows = [
                ...forwardedPastPendingRows,
                ...carryoverRows.filter((row) => !knownCarryoverIds.has(Number(row.id || 0)))
            ];
            state.rows = [...todayRows, ...carryoverRows];
            state.rows = [...todayRows, ...state.carryoverRows];
            setRouteLoadProgress(92, 'Finalizing past pending details...');
            await hydrateLookups(state.carryoverRows);
            renderAttendanceLocationSummary();
            setRouteLoadProgress(100, 'Route loaded.', 'complete');
        } catch (carryoverError) {
            console.warn('Field past pending load failed; keeping today route visible.', carryoverError);
            state.carryoverRows = forwardedPastPendingRows;
            state.rows = [...todayRows, ...forwardedPastPendingRows];
            renderAttendanceLocationSummary();
            setRouteLoadProgress(100, 'Route loaded; past pending check needs refresh.', 'error');
        }
        updatePriorityGate(workloadRows());
        renderActiveView();
        await restorePendingFieldModalDraft();
        handlePendingLocationRefreshRequest().catch((error) => {
            console.warn('Location refresh request check failed:', error);
        });
    } catch (err) {
        console.error('Field load failed:', err);
        if (state.todayRows.length) {
            subtitle.textContent = `${state.todayRows.length} current task(s) loaded. Carry-over may need refresh.`;
            setRouteLoadProgress(100, 'Route partially loaded; tap Refresh to retry.', 'error');
            renderActiveView();
            return;
        }
        subtitle.textContent = 'Failed to load tasks.';
        setRouteLoadProgress(100, 'Route failed to load. Tap Refresh.', 'error');
        document.getElementById('fieldList').innerHTML = `<div class="loading-cell">Error: ${sanitize(err.message || err)}</div>`;
    }
}

async function loadMachineStatusOptions() {
    if (caches.machineStatusesLoaded) return;
    let statuses = [];
    try {
        const docs = await queryCollection('tbl_mstatus', 100);
        statuses = docs
            .map(parseFirestoreDoc)
            .filter(Boolean)
            .map((row) => ({
                id: Number(row.id || 0),
                label: String(row.status || row.description || '').trim()
            }))
            .filter((row) => row.id > 0 && row.label);
    } catch (err) {
        console.warn('tbl_mstatus load failed, using fallback statuses.', err);
    }
    if (!statuses.length) statuses = FALLBACK_MACHINE_STATUSES;
    statuses.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    caches.machineStatuses = statuses;
    caches.machineStatusesLoaded = true;

    const select = document.getElementById('fieldMachineStatus');
    select.innerHTML = statuses.map((item) => (
        `<option value="${sanitize(item.id)}" data-label="${sanitize(item.label)}">${sanitize(item.label)}</option>`
    )).join('');
    populateWorkMachineStatusOptions();
}

function populateWorkMachineStatusOptions() {
    const select = document.getElementById('fieldWorkMachineStatus');
    if (!select) return;
    const statuses = FALLBACK_MACHINE_STATUSES;
    const current = String(select.value || '');
    select.innerHTML = '<option value="">Select machine status...</option>' + statuses.map((item) => (
        `<option value="${sanitize(item.id)}" data-label="${sanitize(item.label)}">${sanitize(item.label)}</option>`
    )).join('');
    if (current && [...select.options].some((option) => option.value === current)) select.value = current;
}

async function loadPartsCatalog() {
    if (caches.partsCatalogLoaded) return;
    let rows = [];
    try {
        const docs = await queryCollection('tbl_newfordr', PARTS_CATALOG_QUERY_LIMIT);
        rows.push(
            ...docs
                .map(parseFirestoreDoc)
                .filter(Boolean)
                .map((row) => {
                    const rawDescription = normalizeInlineText(row.description);
                    const rawRemarks = normalizeInlineText(row.remarks);
                    const numericDescription = /^\d+$/.test(rawDescription);
                    const name = numericDescription ? (rawRemarks || rawDescription) : (rawDescription || rawRemarks);
                    const code = numericDescription ? rawDescription : '';
                    if (!name) return null;
                    return {
                        key: `dr_${row.id}`,
                        id: Number(row.id || 0),
                        name,
                        code,
                        source: 'delivery_request'
                    };
                })
                .filter((row) => row && row.id > 0 && row.name)
        );
    } catch (err) {
        console.warn('tbl_newfordr load failed:', err);
    }

    try {
        const docs = await queryCollection('tbl_inventoryparts', 3000);
        rows.push(
            ...docs
                .map(parseFirestoreDoc)
                .filter(Boolean)
                .map((row) => ({
                    key: `inv_${row.id}`,
                    id: Number(row.id || 0),
                    name: normalizeInlineText(row.item_name || row.description),
                    code: normalizeInlineText(row.item_code),
                    source: 'inventory'
                }))
                .filter((row) => row.id > 0 && row.name)
        );
    } catch (err) {
        console.warn('tbl_inventoryparts load failed:', err);
    }

    try {
        const docs = await queryCollection('tbl_partstype', 400);
        rows.push(
            ...docs
                .map(parseFirestoreDoc)
                .filter(Boolean)
                .map((row) => ({
                    key: `ptype_${row.id}`,
                    id: Number(row.id || 0),
                    name: normalizeInlineText(row.type),
                    code: '',
                    source: 'partstype'
                }))
                .filter((row) => row.id > 0 && row.name)
        );
    } catch (err) {
        console.warn('tbl_partstype load failed:', err);
    }

    const uniqueByName = new Map();
    rows.forEach((row) => {
        const label = row.code ? `${row.name} (${row.code})` : row.name;
        const uniqueKey = label.toUpperCase();
        if (!uniqueByName.has(uniqueKey)) uniqueByName.set(uniqueKey, row);
    });

    caches.partsCatalog = [...uniqueByName.values()]
        .sort((a, b) => {
            const left = a.code ? `${a.name} (${a.code})` : a.name;
            const right = b.code ? `${b.name} (${b.code})` : b.name;
            return left.localeCompare(right);
        });
    caches.partsByKey = new Map(caches.partsCatalog.map((row) => [row.key, row]));
    caches.partsCatalogLoaded = true;

    const options = document.getElementById('fieldPartOptions');
    options.innerHTML = caches.partsCatalog.map((part) => {
        const label = part.code ? `${part.name} (${part.code})` : part.name;
        return `<option value="${sanitize(label)}"></option>`;
    }).join('');
}

async function loadSerialCatalog() {
    if (caches.serialCatalogLoaded) return;
    let rows = [];
    try {
        const docs = await queryCollection('tbl_machine', 8000);
        rows = docs
            .map(parseFirestoreDoc)
            .filter(Boolean)
            .map((row) => ({
                id: Number(row.id || 0),
                serial: String(row.serial || '').trim(),
                model_id: Number(row.model_id || 0),
                brand_id: Number(row.brand_id || 0),
                bmeter: Number(row.bmeter || 0),
                description: String(row.description || '').trim()
            }))
            .filter((row) => row.id > 0 && row.serial);
    } catch (err) {
        console.warn('tbl_machine catalog load failed:', err);
    }

    caches.serialCatalog = rows;
    caches.serialByUpper = new Map();
    rows.forEach((row) => {
        const key = row.serial.toUpperCase();
        const bucket = caches.serialByUpper.get(key) || [];
        bucket.push(row);
        caches.serialByUpper.set(key, bucket);
    });

    const datalist = document.getElementById('fieldSerialOptions');
    datalist.innerHTML = rows
        .slice(0, 8000)
        .map((row) => `<option value="${sanitize(row.serial)}"></option>`)
        .join('');
    caches.serialCatalogLoaded = true;
}

function resolveMachineFromSerial(serialText) {
    const key = String(serialText || '').trim().toUpperCase();
    if (!key) return null;
    const matches = caches.serialByUpper.get(key) || [];
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];
    const currentMachineId = Number(state.modalMachineId || 0);
    return matches.find((row) => Number(row.id || 0) === currentMachineId) || matches[0];
}

function getModelLabel(model, machine = null) {
    return String(
        model?.modelname ||
        model?.model ||
        model?.model_name ||
        machine?.description ||
        ''
    ).trim();
}

function getBrandLabel(brand) {
    return String(
        brand?.brandname ||
        brand?.brand_name ||
        brand?.brand ||
        ''
    ).trim();
}

async function setModalMachineDetails(machine) {
    const modelInput = document.getElementById('fieldModelInput');
    const brandInput = document.getElementById('fieldBrandInput');

    if (!machine) {
        modelInput.value = '';
        brandInput.value = '';
        document.getElementById('fieldSerialMatchHint').textContent = 'Serial not matched in official list.';
        return;
    }

    state.modalMachineId = Number(machine.id || 0) || null;
    document.getElementById('fieldSerialMatchHint').textContent = `Selected machine #${machine.id}`;

    const model = await ensureLookup('tbl_model', machine.model_id, caches.model);
    const brand = await ensureLookup('tbl_brand', machine.brand_id, caches.brand);
    modelInput.value = getModelLabel(model, machine);
    brandInput.value = getBrandLabel(brand);
}

async function handleSerialInputChange() {
    if (document.getElementById('fieldSerialMissingCheck').checked) return;
    const serial = (document.getElementById('fieldSerialInput').value || '').trim();
    if (!serial) {
        await setModalMachineDetails(null);
        return;
    }

    if (!caches.serialCatalogLoaded) {
        await loadSerialCatalog();
    }

    const machine = resolveMachineFromSerial(serial);
    await setModalMachineDetails(machine);
}

function toggleMissingSerialMode() {
    if (TEMPORARILY_DISABLED_FIELD_GROUPS.missingSerial) {
        document.getElementById('fieldSerialMissingCheck').checked = false;
        document.getElementById('fieldMissingSerialInput').disabled = true;
        return;
    }
    const isMissing = document.getElementById('fieldSerialMissingCheck').checked;
    const serialInput = document.getElementById('fieldSerialInput');
    const missingInput = document.getElementById('fieldMissingSerialInput');

    serialInput.disabled = isMissing || state.modalReadOnly;
    missingInput.disabled = !isMissing || state.modalReadOnly;
    if (isMissing) {
        document.getElementById('fieldSerialMatchHint').textContent = 'Serial will be submitted for admin confirmation.';
    } else if (!serialInput.value) {
        document.getElementById('fieldSerialMatchHint').textContent = 'Type to search serial and select from list.';
    }
}

function recomputeTotalConsumed() {
    const previous = parseIntegerInput(document.getElementById('fieldPreviousMeter').value);
    const present = parseIntegerInput(document.getElementById('fieldPresentMeter').value);
    const total = Number.isFinite(previous) && Number.isFinite(present)
        ? Math.max(0, present - previous)
        : 0;
    document.getElementById('fieldTotalConsumed').value = String(total);
}

function recomputeMaintenanceTotalConsumed() {
    const previous = parseIntegerInput(document.getElementById('fieldMaintenancePreviousMeter').value);
    const present = parseIntegerInput(document.getElementById('fieldMaintenancePresentMeter').value);
    const total = Number.isFinite(previous) && Number.isFinite(present)
        ? Math.max(0, present - previous)
        : 0;
    document.getElementById('fieldMaintenanceTotalConsumed').value = String(total);
    syncDeliveryMetersFromMaintenance();
}

function recomputeDeliveryTotalConsumed() {
    const previous = parseIntegerInput(document.getElementById('fieldDeliveryPreviousMeter')?.value);
    const present = parseIntegerInput(document.getElementById('fieldDeliveryPresentMeter')?.value);
    const total = Number.isFinite(previous) && Number.isFinite(present)
        ? Math.max(0, present - previous)
        : 0;
    const target = document.getElementById('fieldDeliveryTotalConsumed');
    if (target) target.value = String(total);
}

function syncDeliveryMetersFromMaintenance(options = {}) {
    const { force = false } = options;
    const maintenancePrevious = document.getElementById('fieldMaintenancePreviousMeter');
    const maintenancePresent = document.getElementById('fieldMaintenancePresentMeter');
    const deliveryPrevious = document.getElementById('fieldDeliveryPreviousMeter');
    const deliveryPresent = document.getElementById('fieldDeliveryPresentMeter');
    if (!maintenancePrevious || !maintenancePresent || !deliveryPrevious || !deliveryPresent) return;

    if ((force || !String(deliveryPrevious.value || '').trim()) && String(maintenancePrevious.value || '').trim()) {
        deliveryPrevious.value = maintenancePrevious.value;
    }
    if ((force || !String(deliveryPresent.value || '').trim()) && String(maintenancePresent.value || '').trim()) {
        deliveryPresent.value = maintenancePresent.value;
    }
    recomputeDeliveryTotalConsumed();
}

function buildFinalAcknowledgementSummary() {
    const summary = String(document.getElementById('fieldFinalSummary')?.value || '').trim();
    if (summary) return summary;
    const workNotes = String(document.getElementById('fieldCloseNotes')?.value || '').trim();
    const deliveryDetails = String(document.getElementById('fieldDeliveryDetails')?.value || '').trim();
    return [
        workNotes ? `Work done: ${workNotes}` : '',
        deliveryDetails ? `Delivered/requested: ${deliveryDetails}` : ''
    ].filter(Boolean).join('\n\n').trim();
}

function parseSavedPartsList(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];
    try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((item) => ({
                key: String(item.key || ''),
                name: String(item.name || '').trim(),
                qty: Math.max(1, Number(item.qty || 1)),
                source: String(item.source || '')
            }))
            .filter((item) => item.name);
    } catch (err) {
        return [];
    }
}

function renderPartsList() {
    const container = document.getElementById('fieldPartsList');
    if (!state.modalPartsNeeded.length) {
        container.innerHTML = '<span class="ops-subtext">No parts added.</span>';
        return;
    }

    container.innerHTML = state.modalPartsNeeded.map((item, index) => `
        <span class="field-part-chip">
            ${sanitize(item.name)} x${sanitize(item.qty)}
            <button type="button" data-index="${index}" aria-label="Remove part">×</button>
        </span>
    `).join('');
}

function matchPartFromInput(text) {
    const value = String(text || '').trim().toUpperCase();
    if (!value) return null;
    return caches.partsCatalog.find((part) => {
        const label = part.code ? `${part.name} (${part.code})` : part.name;
        return label.toUpperCase() === value || part.name.toUpperCase() === value || String(part.code || '').toUpperCase() === value;
    }) || null;
}

function addPartEntry() {
    if (state.modalReadOnly) return;
    const partInput = document.getElementById('fieldPartInput');
    const qtyInput = document.getElementById('fieldPartQty');
    const selected = matchPartFromInput(partInput.value);
    if (!selected) {
        alert('Please select a part from database list.');
        return;
    }

    const qty = parseIntegerInput(qtyInput.value) || 1;
    const existing = state.modalPartsNeeded.find((row) => row.key === selected.key);
    if (existing) {
        existing.qty += qty;
    } else {
        state.modalPartsNeeded.push({
            key: selected.key,
            name: selected.code ? `${selected.name} (${selected.code})` : selected.name,
            qty,
            source: selected.source
        });
    }

    partInput.value = '';
    qtyInput.value = '1';
    renderPartsList();
    updateActionButtons();
    queueFieldModalDraftSave();
}

function removePartEntry(event) {
    const button = event.target.closest('button[data-index]');
    if (!button || state.modalReadOnly) return;
    const index = Number(button.dataset.index || -1);
    if (index < 0) return;
    state.modalPartsNeeded.splice(index, 1);
    renderPartsList();
    updateActionButtons();
    queueFieldModalDraftSave();
}

function updatePhotoHint(inputId, hintId, fallbackField = '') {
    const input = document.getElementById(inputId);
    const hint = document.getElementById(hintId);
    const file = input.files?.[0];
    if (file) {
        hint.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
        return;
    }
    const saved = input.dataset.savedName || '';
    if (saved && fallbackField) {
        hint.textContent = `Saved: ${saved}`;
        return;
    }
    const draft = input.dataset.draftName || '';
    if (draft) {
        hint.textContent = `Draft remembered: ${draft}. Please reselect this file before submitting.`;
        return;
    }
    hint.textContent = 'No file selected.';
}

function getFileMeta(inputId) {
    const file = document.getElementById(inputId).files?.[0];
    if (!file) return null;
    return {
        name: String(file.name || '').slice(0, 255),
        size: Math.trunc(Number(file.size || 0)),
        type: String(file.type || '').slice(0, 80),
        modified: Math.trunc(Number(file.lastModified || 0))
    };
}

function parseCoordinate(value) {
    const numeric = Number(String(value ?? '').trim());
    if (!Number.isFinite(numeric) || numeric === 0) return null;
    return numeric;
}

function firstNonBlank(...values) {
    return values.map((value) => String(value ?? '').trim()).find(Boolean) || '';
}

function getBranchCoordinates(branch) {
    const latitude = parseCoordinate(branch?.latitude ?? branch?.lat);
    const longitude = parseCoordinate(branch?.longitude ?? branch?.lng ?? branch?.lon);
    if (latitude === null || longitude === null) return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return { latitude, longitude };
}

function branchHasSavedLocation(branch) {
    return Boolean(getBranchCoordinates(branch));
}

function getBranchLocationStatus(row = getCurrentRow()) {
    const branch = caches.branch.get(String(row?.branch_id || state.modalBranchId || 0));
    const branchLocationSaved = branchHasSavedLocation(branch);
    return {
        branch,
        branchLocationSaved,
        hasLocation: branchLocationSaved || state.modalBranchLocationPinned
    };
}

function getScheduleDateYmd(row = getCurrentRow()) {
    const candidates = [
        row?.task_datetime,
        row?.route_task_datetime,
        row?.schedule_date,
        row?.preferred_schedule_date
    ];
    for (const value of candidates) {
        const ymd = String(value || '').trim().slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
    }
    return '';
}

function canBypassLocationPinForClose(row = getCurrentRow()) {
    return LOCATION_PIN_CLOSE_BYPASS_DATES.has(getScheduleDateYmd(row));
}

function isFutureScheduleForClose(row = getCurrentRow()) {
    const scheduleDate = getScheduleDateYmd(row);
    const today = localDateYmd();
    return Boolean(scheduleDate && today && scheduleDate > today);
}

function setLocationPinUi(row = getCurrentRow()) {
    const status = document.getElementById('fieldLocationPinStatus');
    const button = document.getElementById('fieldPinLocationBtn');
    const card = document.getElementById('fieldLocationCard');
    if (!status || !button || !card) return;

    const { branch, hasLocation, branchLocationSaved } = getBranchLocationStatus(row);
    const closeBypass = canBypassLocationPinForClose(row);
    const latitude = parseCoordinate(branch?.latitude ?? branch?.lat);
    const longitude = parseCoordinate(branch?.longitude ?? branch?.lng ?? branch?.lon);
    const photoInput = document.getElementById('fieldLocationPhoto');
    const photoWrap = document.querySelector('.field-location-photo');
    const photoButton = document.getElementById('fieldLocationPhotoBtn');
    const photoHint = document.getElementById('fieldLocationPhotoHint');

    card.classList.toggle('is-complete', hasLocation || closeBypass);
    card.classList.toggle('is-required', !hasLocation && !closeBypass);
    button.hidden = false;
    button.disabled = state.modalReadOnly;
    button.textContent = branchLocationSaved ? 'Repin Customer Location' : 'Pin Customer Location';
    button.classList.toggle('btn-secondary', branchLocationSaved);
    button.classList.toggle('btn-primary', !branchLocationSaved);
    if (photoInput) photoInput.disabled = state.modalReadOnly;
    if (photoButton) photoButton.disabled = state.modalReadOnly;
    if (photoWrap) {
        photoWrap.hidden = false;
        photoWrap.style.display = 'grid';
    }
    if (photoHint && !photoInput?.files?.[0]) {
        photoHint.textContent = branchLocationSaved
            ? 'Required when repinning. Take a new frontage/building photo first.'
            : 'Required when pinning a new customer location.';
    }

    if (hasLocation) {
        const coordText = latitude !== null && longitude !== null
            ? `Saved: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
            : 'Location saved for this customer.';
        status.textContent = `${coordText} If this is wrong, take a new frontage photo and tap Repin Customer Location.`;
        return;
    }

    if (closeBypass) {
        status.textContent = 'May 4-5 app error exception: this schedule can be finished without pinning. Pin is still recommended if staff are on site.';
        return;
    }

    status.textContent = 'Required before finishing. Tap Pin Customer Location while you are at the customer site.';
}

function getCurrentPosition(options = {}) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('GPS location is not available on this device/browser.'));
            return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 0,
            ...options
        });
    });
}

function localDateYmd(date = new Date()) {
    return formatDateYmd(date);
}

function localTimeHm(date = new Date()) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function getAutomaticBillingStamp(row = null) {
    const now = new Date();
    const savedDate = String(row?.field_billing_date || '').trim();
    const savedTime = String(row?.field_billing_time || '').trim();
    return {
        billingDate: savedDate || localDateYmd(now),
        billingTime: savedTime || localTimeHm(now)
    };
}

function applyAutomaticBillingStamp(row = null) {
    const billingDateInput = document.getElementById('fieldBillingDate');
    const billingTimeInput = document.getElementById('fieldBillingTime');
    if (!billingDateInput || !billingTimeInput) return;
    const stamp = getAutomaticBillingStamp(row);
    billingDateInput.value = stamp.billingDate;
    billingTimeInput.value = stamp.billingTime;
}

function updateLocationPhotoHint() {
    const input = document.getElementById('fieldLocationPhoto');
    const hint = document.getElementById('fieldLocationPhotoHint');
    const file = input?.files?.[0] || null;
    if (!hint) return;
    if (!file) {
        hint.textContent = 'Required when pinning a new customer location.';
        return;
    }
    const sizeKb = Math.round(Number(file.size || 0) / 1024);
    hint.textContent = `${file.name || 'Selected photo'} (${sizeKb} KB)`;
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Unable to read image.'));
        reader.readAsDataURL(blob);
    });
}

function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Unable to load selected image.'));
        };
        img.src = url;
    });
}

async function compressImageFile(file, { maxDimension = 960, quality = 0.72 } = {}) {
    if (!file || !String(file.type || '').startsWith('image/')) {
        throw new Error('Select a frontage/building image first.');
    }

    const image = await loadImageFromFile(file);
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, width, height);

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Unable to compress selected image.'));
                return;
            }
            resolve(blob);
        }, 'image/jpeg', quality);
    });
}

function safeStorageSegment(value) {
    return String(value || '')
        .trim()
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'photo';
}

function randomToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function uploadLocationPhotoToStorage(blob, { branchId, scheduleId, now }) {
    const bucket = String(FIREBASE_CONFIG.storageBucket || '').trim();
    if (!bucket) throw new Error('Firebase Storage bucket is not configured.');

    const token = randomToken();
    const path = [
        'field-location-photos',
        localDateYmd(now),
        `branch-${safeStorageSegment(branchId)}`,
        `schedule-${safeStorageSegment(scheduleId)}-${Date.now()}.jpg`
    ].join('/');
    const boundary = `marga-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const metadata = {
        name: path,
        contentType: 'image/jpeg',
        metadata: {
            firebaseStorageDownloadTokens: token
        }
    };
    const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
        JSON.stringify(metadata),
        `\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`,
        blob,
        `\r\n--${boundary}--`
    ], { type: `multipart/related; boundary=${boundary}` });

    const response = await fetch(
        `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=multipart&key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body
        }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || 'Firebase Storage upload failed.');
    }

    return {
        path,
        url: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`,
        size: Number(blob.size || 0) || 0,
        type: 'image/jpeg'
    };
}

async function prepareLocationPhotoUpload(file, context) {
    const blob = await compressImageFile(file);
    try {
        return {
            ...(await uploadLocationPhotoToStorage(blob, context)),
            storageMode: 'storage'
        };
    } catch (storageError) {
        console.warn('Location photo Storage upload failed; falling back to Firestore data URL.', storageError);
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl.length > 900000) {
            throw new Error('Photo is still too large after compression. Please retake a clearer, smaller frontage photo.');
        }
        return {
            path: '',
            url: '',
            dataUrl,
            size: Number(blob.size || 0) || 0,
            type: 'image/jpeg',
            storageMode: 'firestore_data_url'
        };
    }
}

function normalizeTicketPurpose(row) {
    return Number(row?.purpose_id || 0) || 0;
}

function isBillingTicket(row) {
    return normalizeTicketPurpose(row) === BILLING_PURPOSE_ID;
}

function isCollectionTicket(row) {
    return normalizeTicketPurpose(row) === COLLECTION_PURPOSE_ID;
}

function isReadingTicket(row) {
    return normalizeTicketPurpose(row) === READING_PURPOSE_ID;
}

function isServiceTicket(row) {
    return normalizeTicketPurpose(row) === SERVICE_PURPOSE_ID;
}

function isDeliveryTicket(row) {
    return DELIVERY_PURPOSE_IDS.has(normalizeTicketPurpose(row));
}

function syncPurposeSpecificSections(row = getCurrentRow()) {
    const billMeterSection = document.getElementById('fieldMeterSection');
    if (billMeterSection) {
        billMeterSection.hidden = !isReadingTicket(row);
    }
}

function isPendingReplacementState(row, form = null) {
    const pendingReason = String(row?.pending_reason || '').trim().toLowerCase();
    const hasLocalParts = Array.isArray(form?.partsNeeded) && form.partsNeeded.length > 0;
    return Number(row?.pending_parts || 0) === 1
        || hasLocalParts
        || pendingReason.includes('part')
        || pendingReason.includes('machine')
        || pendingReason.includes('replacement');
}

function setModalOpen(isOpen) {
    const overlay = document.getElementById('fieldOverlay');
    const modal = document.getElementById('fieldModal');
    modal.classList.toggle('open', isOpen);
    overlay.classList.toggle('visible', isOpen);
    modal.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
}

function resetModalFields() {
    state.modalScheduleId = null;
    state.modalMachineId = null;
    state.modalBranchId = null;
    state.modalExpectedPin = '';
    state.modalStatusKey = 'pending';
    state.modalSchedtimeDocId = null;
    state.modalSchedtimeId = null;
    state.modalPartsNeeded = [];
    state.modalCollectionInvoices = [];
    state.modalCollectionInvoiceSearchResults = [];
    state.modalCollectionInvoiceSearchRequest = '';
    state.modalReadOnly = false;
    state.modalBranchLocationPinned = false;

    document.getElementById('fieldCloseNotes').value = '';
    document.getElementById('fieldSolutionNotes').value = '';
    document.getElementById('fieldWorkMachineStatus').value = '';
    document.getElementById('fieldClosePin').value = '';
    document.getElementById('fieldSerialInput').value = '';
    document.getElementById('fieldSerialHint').textContent = '';
    document.getElementById('fieldSerialMatchHint').textContent = 'Type to search serial and select from list.';
    document.getElementById('fieldModelInput').value = '';
    document.getElementById('fieldBrandInput').value = '';
    document.getElementById('fieldSerialMissingCheck').checked = false;
    document.getElementById('fieldMissingSerialInput').value = '';
    document.getElementById('fieldPartInput').value = '';
    document.getElementById('fieldPartQty').value = '1';
    document.getElementById('fieldDeliveryDetails').value = '';
    document.getElementById('fieldEmptyPickupDetails').value = '';
    document.getElementById('fieldDeliveryPreviousMeter').value = '';
    document.getElementById('fieldDeliveryPresentMeter').value = '';
    document.getElementById('fieldDeliveryTotalConsumed').value = '0';
    document.getElementById('fieldCustomerSigner').value = '';
    document.getElementById('fieldCustomerContact').value = '';
    document.getElementById('fieldFinalSummary').value = '';
    document.getElementById('fieldBillingReceivedBy').value = '';
    applyAutomaticBillingStamp();
    document.getElementById('fieldCollectionInvoiceSearch').value = '';
    renderFieldCollectionInvoiceResults();
    renderFieldCollectionInvoices();
    document.getElementById('fieldCollectionCheckNumber').value = '';
    document.getElementById('fieldCollectionCheckBank').value = '';
    document.getElementById('fieldCollectionCheckDate').value = '';
    document.getElementById('fieldCollectionCheckAmount').value = '';
    document.getElementById('fieldCollectionAmount').value = '';
    document.getElementById('fieldCollectionPaymentDate').value = '';
    document.getElementById('fieldCollectionDepositDate').value = '';
    document.getElementById('fieldCollectionOrNumber').value = '';
    document.getElementById('fieldCollectionPaymentType').value = '';
    document.getElementById('fieldCollectionPaymentStatus').value = '';
    document.getElementById('fieldCollectionDeductionType').value = '';
    document.getElementById('fieldCollectionDeductionAmount').value = '';
    document.getElementById('fieldCollection2307Status').value = '';
    document.getElementById('fieldCollectionPaymentRemarks').value = '';
    document.getElementById('fieldPreviousMeter').value = '';
    document.getElementById('fieldPreviousMeterHint').textContent = 'Loaded from billing meter history when available.';
    document.getElementById('fieldPresentMeter').value = '';
    document.getElementById('fieldTotalConsumed').value = '0';
    document.getElementById('fieldMaintenancePreviousMeter').value = '';
    document.getElementById('fieldMaintenancePreviousMeterHint').textContent = 'Loaded from the last field visit when available.';
    document.getElementById('fieldMaintenancePresentMeter').value = '';
    document.getElementById('fieldMaintenanceTotalConsumed').value = '0';
    document.getElementById('fieldTimeIn').value = '';
    document.getElementById('fieldTimeOut').value = '';
    document.getElementById('fieldLocationPinStatus').textContent = 'Checking customer location...';
    document.getElementById('fieldPinLocationBtn').hidden = false;
    document.getElementById('fieldPinLocationBtn').disabled = false;
    document.getElementById('fieldLocationPhoto').value = '';
    document.getElementById('fieldLocationPhoto').disabled = false;
    document.getElementById('fieldLocationPhotoHint').textContent = 'Required when pinning a new customer location.';
    document.getElementById('fieldLocationCard').classList.remove('is-complete', 'is-required');

    const before = document.getElementById('fieldBeforePhoto');
    const after = document.getElementById('fieldAfterPhoto');
    const collectionVoucher = document.getElementById('fieldCollectionVoucherImage');
    const collectionCheck = document.getElementById('fieldCollectionCheckImage');
    before.value = '';
    after.value = '';
    collectionVoucher.value = '';
    collectionCheck.value = '';
    before.dataset.savedName = '';
    after.dataset.savedName = '';
    collectionVoucher.dataset.savedName = '';
    collectionCheck.dataset.savedName = '';
    before.dataset.draftName = '';
    after.dataset.draftName = '';
    collectionVoucher.dataset.draftName = '';
    collectionCheck.dataset.draftName = '';
    document.getElementById('fieldLocationPhoto').dataset.draftName = '';
    document.getElementById('fieldBeforePhotoHint').textContent = 'No file selected.';
    document.getElementById('fieldAfterPhotoHint').textContent = 'No file selected.';
    document.getElementById('fieldCollectionVoucherHint').textContent = 'No file selected.';
    document.getElementById('fieldCollectionCheckHint').textContent = 'No file selected.';

    document.getElementById('fieldPinHint').textContent = TEMPORARILY_DISABLED_FIELD_GROUPS.customerPin
        ? 'Temporarily disabled. Finish is allowed without PIN.'
        : 'Required to mark as Finished.';
    renderPartsList();
    applyTemporaryFieldMode();
    resetModalSectionState();
    toggleMissingSerialMode();
    updateModalFooterState();
    updateActionButtons();
}

function closeModal() {
    flushFieldModalDraftSave();
    setModalOpen(false);
    resetModalFields();
}

function setFormDisabled(isReadOnly) {
    state.modalReadOnly = isReadOnly;
    const ids = [
        'fieldSerialInput',
        'fieldSerialMissingCheck',
        'fieldMissingSerialInput',
        'fieldSaveSerialBtn',
        'fieldMachineStatus',
        'fieldCloseNotes',
        'fieldSolutionNotes',
        'fieldSubmitSolutionBtn',
        'fieldWorkMachineStatus',
        'fieldPartInput',
        'fieldPartQty',
        'fieldAddPartBtn',
        'fieldBeforePhoto',
        'fieldAfterPhoto',
        'fieldMaintenancePreviousMeter',
        'fieldMaintenancePresentMeter',
        'fieldPreviousMeter',
        'fieldPresentMeter',
        'fieldTimeIn',
        'fieldTimeInNowBtn',
        'fieldTimeOutNowBtn',
        'fieldPinLocationBtn',
        'fieldLocationPhoto',
        'fieldDeliveryDetails',
        'fieldEmptyPickupDetails',
        'fieldDeliveryPreviousMeter',
        'fieldDeliveryPresentMeter',
        'fieldCustomerSigner',
        'fieldCustomerContact',
        'fieldFinalSummary',
        'fieldBillingReceivedBy',
        'fieldBillingDate',
        'fieldBillingTime',
        'fieldCollectionVoucherImage',
        'fieldCollectionCheckImage',
        'fieldCollectionInvoiceSearch',
        'fieldCollectionInvoiceAddBtn',
        'fieldCollectionCheckNumber',
        'fieldCollectionCheckBank',
        'fieldCollectionCheckDate',
        'fieldCollectionCheckAmount',
        'fieldCollectionAmount',
        'fieldCollectionPaymentDate',
        'fieldCollectionDepositDate',
        'fieldCollectionOrNumber',
        'fieldCollectionPaymentType',
        'fieldCollectionPaymentStatus',
        'fieldCollectionDeductionType',
        'fieldCollectionDeductionAmount',
        'fieldCollection2307Status',
        'fieldCollectionPaymentRemarks',
        'fieldClosePin',
        'fieldModalSaveDraft',
        'fieldModalPendingTask',
        'fieldModalReopenTask',
        'fieldModalCloseTask'
    ];

    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = isReadOnly;
    });
    document.getElementById('fieldTimeOut').disabled = true;
    applyTemporaryFieldMode();
    toggleMissingSerialMode();
    applyModalWorkflowState();
    updateModalFooterState();
    updateActionButtons();
    setLocationPinUi();
}

function updateModalFooterState() {
    const saveDraftBtn = document.getElementById('fieldModalSaveDraft');
    const pendingBtn = document.getElementById('fieldModalPendingTask');
    const reopenBtn = document.getElementById('fieldModalReopenTask');
    const closeBtn = document.getElementById('fieldModalCloseTask');

    const isClosed = state.modalStatusKey === 'closed';
    const isCancelled = state.modalStatusKey === 'cancelled';
    const isReadOnly = state.modalReadOnly;

    saveDraftBtn.hidden = isClosed || isCancelled;
    pendingBtn.hidden = isClosed || isCancelled;
    closeBtn.hidden = isClosed || isCancelled;
    reopenBtn.hidden = !(isClosed && isReadOnly);
    reopenBtn.disabled = !(isClosed && isReadOnly);
}

function applyModalWorkflowState() {
    syncPurposeSpecificSections();

    const machineSection = document.getElementById('fieldMachineSection');
    const machineToggle = machineSection?.querySelector('.field-section-toggle');
    if (machineSection) machineSection.classList.add('is-disabled');
    if (machineToggle) {
        machineToggle.disabled = true;
        machineToggle.setAttribute('aria-disabled', 'true');
    }

    if (state.modalReadOnly) return;

    [
        'fieldSerialInput',
        'fieldMissingSerialInput',
        'fieldModelInput',
        'fieldBrandInput',
        'fieldMachineStatus',
        'fieldSaveSerialBtn',
        'fieldDeliveryDetails',
        'fieldCustomerSigner',
        'fieldCustomerContact',
        'fieldFinalSummary',
        'fieldClosePin'
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
    });
}

async function resolveExpectedPin(branchId, row = null) {
    const schedulePin = String(row?.customer_pin || '').trim();
    if (schedulePin) return schedulePin;

    const fromBranch = caches.branch.get(String(branchId || 0));
    const inlinePin = String(fromBranch?.service_pin || '').trim();
    if (inlinePin) return inlinePin;

    if (!branchId) return '';
    const pinDoc = await fetchDoc('marga_branch_pins', branchId);
    return String(pinDoc?.pin || '').trim();
}

async function resolveBranchContact(branchId, row) {
    const cacheKey = String(branchId || 0);
    if (caches.branchContacts.has(cacheKey)) {
        return caches.branchContacts.get(cacheKey);
    }

    const fallback = {
        contact_name: String(row?.caller || '').trim(),
        contact_phone: String(row?.phone_number || '').trim()
    };

    if (!branchId) {
        caches.branchContacts.set(cacheKey, fallback);
        return fallback;
    }

    try {
        const docs = await queryEquals('tbl_branchcontact', 'branch_id', Number(branchId), 'integer', 25);
        const rows = docs.map(parseFirestoreDoc).filter(Boolean);
        const first = rows.find((item) => String(item.contact_person || item.contact_number || '').trim()) || null;
        const result = {
            contact_name: String(first?.contact_person || fallback.contact_name || '').trim(),
            contact_phone: String(first?.contact_number || fallback.contact_phone || '').trim()
        };
        caches.branchContacts.set(cacheKey, result);
        return result;
    } catch (err) {
        console.warn('Branch contact lookup failed:', err);
        caches.branchContacts.set(cacheKey, fallback);
        return fallback;
    }
}

function parseMachineReadingDate(value) {
    const raw = String(value || '').trim();
    if (!raw || LEGACY_EMPTY_DATETIME_VALUES.has(raw.toLowerCase())) return null;

    const legacy = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
    if (legacy) {
        const parsed = new Date(`${legacy[1]}T${legacy[2] || '00:00:00'}+08:00`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthStartFromTaskDate(taskDateTime) {
    const taskDate = parseMachineReadingDate(taskDateTime) || new Date();
    return new Date(taskDate.getFullYear(), taskDate.getMonth(), 1);
}

function sortReadingsNewestFirst(readings = []) {
    return [...readings].sort((left, right) => {
        const leftTime = parseMachineReadingDate(left?.timestmp)?.getTime() || 0;
        const rightTime = parseMachineReadingDate(right?.timestmp)?.getTime() || 0;
        return rightTime - leftTime;
    });
}

function scheduleRowForBillingMeterLookup(row, machine = null) {
    return {
        machine_id: Number(machine?.id || row?.machine_id || row?.mach_id || row?.serial || 0) || 0,
        contractmain_id: Number(row?.contractmain_id || row?.current_contract || 0) || 0,
        company_id: Number(row?.company_id || 0) || 0,
        branch_id: Number(row?.branch_id || 0) || 0
    };
}

function sameBillingMachineReading(row, reading) {
    const machineId = String(row?.machine_id || '').trim();
    const contractId = String(row?.contractmain_id || '').trim();
    const companyId = String(row?.company_id || '').trim();
    const branchId = String(row?.branch_id || '').trim();
    if (machineId && String(reading?.machine_id || '').trim() === machineId) return true;
    if (contractId && String(reading?.current_contract || '').trim() !== contractId) return false;
    if (companyId && String(reading?.current_companyid || '').trim() !== companyId) return false;
    if (branchId && String(reading?.current_branchid || '').trim() !== branchId) return false;
    return Boolean(contractId || companyId || branchId);
}

function pickBillingPriorMachineReading(row, readings = [], taskDateTime) {
    const lookupRow = scheduleRowForBillingMeterLookup(row);
    const machineId = String(lookupRow.machine_id || '').trim();
    const contractId = String(lookupRow.contractmain_id || '').trim();
    if (!machineId && !contractId) return null;

    const companyId = String(lookupRow.company_id || '').trim();
    const branchId = String(lookupRow.branch_id || '').trim();
    const cutoffTime = monthStartFromTaskDate(taskDateTime).getTime();
    const candidates = readings.filter((reading) => {
        const readingMachineId = String(reading?.machine_id || '').trim();
        const readingContractId = String(reading?.current_contract || '').trim();
        const matchesMachine = machineId && readingMachineId === machineId;
        const matchesContract = contractId && readingContractId === contractId;
        if (!matchesMachine && !matchesContract) return false;
        if (!sameBillingMachineReading(lookupRow, reading)) return false;
        if (Number(reading?.meter_reading || 0) <= 0) return false;
        const readingDate = parseMachineReadingDate(reading?.timestmp);
        if (!readingDate) return false;
        return readingDate.getTime() < cutoffTime;
    });
    if (!candidates.length) return null;

    const newestFor = (items) => sortReadingsNewestFirst(items)[0] || null;
    const sameContract = contractId
        ? candidates.filter((reading) => String(reading?.current_contract || '').trim() === contractId)
        : [];
    if (sameContract.length) return newestFor(sameContract);

    const sameCompany = companyId
        ? candidates.filter((reading) => String(reading?.current_companyid || '').trim() === companyId)
        : [];
    if (sameCompany.length) {
        const sameBranch = branchId
            ? sameCompany.filter((reading) => String(reading?.current_branchid || '').trim() === branchId)
            : [];
        return newestFor(sameBranch.length ? sameBranch : sameCompany);
    }

    return newestFor(candidates);
}

async function resolveBillingPreviousMeter(row, machine = null) {
    const lookupRow = scheduleRowForBillingMeterLookup(row, machine);
    const fieldMask = [
        'id',
        'current_contract',
        'current_companyid',
        'current_branchid',
        'machine_id',
        'meter_reading',
        'meter_reading2',
        'timestmp',
        'invoice_id'
    ];
    const machineIds = [lookupRow.machine_id].filter((id) => Number(id || 0) > 0);
    const contractIds = [lookupRow.contractmain_id].filter((id) => Number(id || 0) > 0);
    if (!machineIds.length && !contractIds.length) return null;

    try {
        const [machineDocs, contractDocs] = await Promise.all([
            queryIn('tbl_machinereading', 'machine_id', machineIds, { select: fieldMask, limit: 1000 }).catch((error) => {
                console.warn('Billing previous meter machine lookup failed:', error);
                return [];
            }),
            queryIn('tbl_machinereading', 'current_contract', contractIds, { select: fieldMask, limit: 1000 }).catch((error) => {
                console.warn('Billing previous meter contract lookup failed:', error);
                return [];
            })
        ]);
        const byDocId = new Map();
        [...machineDocs, ...contractDocs].forEach((doc) => {
            const key = String(doc?._docId || `${doc?.id || ''}:${doc?.machine_id || ''}:${doc?.timestmp || ''}`).trim();
            if (key && !byDocId.has(key)) byDocId.set(key, doc);
        });
        const picked = pickBillingPriorMachineReading(lookupRow, [...byDocId.values()], row?.task_datetime);
        if (!picked) return null;
        return {
            meter: Number(picked.meter_reading || 0) || 0,
            readingDate: String(picked.timestmp || '').trim(),
            invoiceRef: String(picked.invoice_id || '').trim(),
            readingId: String(picked.id || picked._docId || '').trim()
        };
    } catch (err) {
        console.warn('Billing previous meter lookup failed:', err);
        return null;
    }
}

async function resolvePreviousMeter(rowOrMachineId, scheduleId, taskDateTime, fallbackBm = 0, machine = null) {
    const row = typeof rowOrMachineId === 'object'
        ? rowOrMachineId
        : {
            id: scheduleId,
            serial: Number(rowOrMachineId || 0) || 0,
            machine_id: Number(rowOrMachineId || 0) || 0,
            task_datetime: taskDateTime
        };
    const billingLookup = await resolveBillingPreviousMeter(row, machine);
    if (Number(billingLookup?.meter || 0) > 0) return billingLookup;

    const machineId = Number(machine?.id || row?.machine_id || row?.mach_id || row?.serial || rowOrMachineId || 0) || 0;
    if (!machineId) {
        return Number(fallbackBm || 0) > 0
            ? { meter: Number(fallbackBm || 0) || 0, source: 'machine_beginning_meter' }
            : null;
    }
    try {
        const docs = await queryEquals('tbl_schedule', 'serial', Number(machineId), 'integer', 1200);
        const rows = docs
            .map(parseFirestoreDoc)
            .filter(Boolean)
            .filter((row) => Number(row.id || 0) !== Number(scheduleId || 0))
            .filter((row) => Number(row.meter_reading || 0) > 0);

        const referenceTs = new Date(String(taskDateTime || '').replace(' ', 'T')).getTime();
        const candidates = rows.filter((row) => {
            const finished = normalizeLegacyDateTime(row.date_finished);
            const basis = finished || String(row.task_datetime || '').trim();
            const ts = new Date(basis.replace(' ', 'T')).getTime();
            if (!Number.isFinite(ts)) return true;
            if (!Number.isFinite(referenceTs)) return true;
            return ts <= referenceTs;
        });

        candidates.sort((a, b) => {
            const left = normalizeLegacyDateTime(a.date_finished) || String(a.task_datetime || '');
            const right = normalizeLegacyDateTime(b.date_finished) || String(b.task_datetime || '');
            if (left !== right) return right.localeCompare(left);
            return Number(b.id || 0) - Number(a.id || 0);
        });

        const found = candidates.find((row) => Number(row.meter_reading || 0) > 0);
        if (found) {
            return {
                meter: Number(found.meter_reading || 0) || 0,
                readingDate: String(normalizeLegacyDateTime(found.date_finished) || found.task_datetime || '').trim(),
                source: 'field_schedule'
            };
        }
    } catch (err) {
        console.warn('Previous meter lookup failed:', err);
    }
    return Number(fallbackBm || 0) > 0
        ? { meter: Number(fallbackBm || 0) || 0, source: 'machine_beginning_meter' }
        : null;
}

async function resolvePreviousMaintenanceMeter(row, machine = null) {
    const saved = parseIntegerInput(row?.field_maintenance_previous_meter);
    if (saved !== null && saved > 0) {
        return { meter: saved, source: 'saved_field_draft' };
    }

    const machineId = Number(machine?.id || row?.machine_id || row?.mach_id || row?.serial || 0) || 0;
    if (!machineId) return null;
    try {
        const docs = await queryEquals('tbl_schedule', 'serial', Number(machineId), 'integer', 1200);
        const referenceTs = new Date(String(row?.task_datetime || '').replace(' ', 'T')).getTime();
        const candidates = docs
            .map(parseFirestoreDoc)
            .filter(Boolean)
            .filter((item) => Number(item.id || 0) !== Number(row?.id || 0))
            .filter((item) => Number(item.field_maintenance_present_meter || 0) > 0)
            .filter((item) => {
                const finished = normalizeLegacyDateTime(item.date_finished);
                const basis = finished || String(item.task_datetime || '').trim();
                const ts = new Date(basis.replace(' ', 'T')).getTime();
                if (!Number.isFinite(ts) || !Number.isFinite(referenceTs)) return true;
                return ts <= referenceTs;
            });
        candidates.sort((a, b) => {
            const left = normalizeLegacyDateTime(a.date_finished) || String(a.task_datetime || '');
            const right = normalizeLegacyDateTime(b.date_finished) || String(b.task_datetime || '');
            if (left !== right) return right.localeCompare(left);
            return Number(b.id || 0) - Number(a.id || 0);
        });
        const found = candidates[0];
        if (found) {
            return {
                meter: Number(found.field_maintenance_present_meter || 0) || 0,
                readingDate: String(normalizeLegacyDateTime(found.date_finished) || found.task_datetime || '').trim(),
                source: 'prior_field_visit'
            };
        }
    } catch (err) {
        console.warn('Previous maintenance meter lookup failed:', err);
    }
    const fallback = parseIntegerInput(machine?.bmeter);
    return fallback !== null && fallback > 0
        ? { meter: fallback, source: 'machine_beginning_meter' }
        : null;
}

async function fetchLatestSchedtimeLog(scheduleId) {
    try {
        const docs = await queryEquals('tbl_schedtime', 'schedule_id', Number(scheduleId), 'integer', 40);
        const rows = docs.map(parseFirestoreDoc).filter(Boolean);
        if (!rows.length) return null;
        rows.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
        return rows[0];
    } catch (err) {
        console.warn('Schedtime lookup failed:', err);
        return null;
    }
}

function setMachineStatusFromRow(row) {
    const select = document.getElementById('fieldMachineStatus');
    if (!select.options.length) return;
    const byId = Number(row.field_machine_status_id || row.tl_status || 0);
    const byLabel = String(row.field_machine_status || '').trim().toUpperCase();

    let matched = false;
    if (byId > 0) {
        matched = [...select.options].some((opt) => {
            if (Number(opt.value || 0) !== byId) return false;
            opt.selected = true;
            return true;
        });
    }

    if (!matched && byLabel) {
        matched = [...select.options].some((opt) => {
            const label = String(opt.dataset.label || opt.textContent || '').toUpperCase();
            if (label !== byLabel) return false;
            opt.selected = true;
            return true;
        });
    }

    if (!matched) select.selectedIndex = 0;
}

function setWorkMachineStatusFromRow(row) {
    populateWorkMachineStatusOptions();
    const select = document.getElementById('fieldWorkMachineStatus');
    if (!select?.options?.length) return;
    const byId = Number(row.field_work_machine_status_id || row.field_machine_status_id || row.tl_status || 0);
    const byLabel = String(row.field_work_machine_status || row.field_machine_status || '').trim().toUpperCase();

    let matched = false;
    if (byId > 0) {
        matched = [...select.options].some((opt) => {
            if (Number(opt.value || 0) !== byId) return false;
            opt.selected = true;
            return true;
        });
    }

    if (!matched && byLabel) {
        matched = [...select.options].some((opt) => {
            const label = String(opt.dataset.label || opt.textContent || '').toUpperCase();
            if (label !== byLabel) return false;
            opt.selected = true;
            return true;
        });
    }

    if (!matched) select.value = '';
}

async function openModal(scheduleId) {
    const row = state.rows.find((r) => Number(r.id || 0) === Number(scheduleId));
    if (!row) return;

    state.modalScheduleId = scheduleId;
    state.modalRelatedScheduleIds = state.combinedTaskGroups.get(String(scheduleId)) || [scheduleId];
    state.modalMachineId = Number(row.serial || 0) || null;
    state.modalBranchId = Number(row.branch_id || 0) || null;
    state.modalStatusKey = getStatusKey(row);
    state.modalPartsNeeded = parseSavedPartsList(row.field_parts_needed_json);
    state.modalSchedtimeDocId = null;
    state.modalSchedtimeId = null;
    state.modalBranchLocationPinned = false;

    const branch = caches.branch.get(String(row.branch_id || 0));
    const company = caches.company.get(String(row.company_id || branch?.company_id || 0));
    const trouble = caches.trouble.get(String(row.trouble_id || 0));
    const purposeLabel = PURPOSE_LABELS[row.purpose_id] || `Purpose ${row.purpose_id}`;
    const troubleLabel = trouble?.trouble || (row.trouble_id ? `Trouble ${row.trouble_id}` : 'Unspecified');
    const relatedRows = getModalRelatedRows(row);
    const combinedLabels = uniqueCombinedWorkLabels(relatedRows);
    const combinedSuffix = relatedRows.length > 1 ? ` (+${relatedRows.length - 1} more)` : '';
    const combinedSubtitle = relatedRows.length > 1 ? ` · Combined: ${combinedLabels.join(', ')}` : '';

    document.getElementById('fieldModalTitle').textContent = `#${row.id} ${purposeLabel} / ${troubleLabel}${combinedSuffix}`;
    document.getElementById('fieldModalSubtitle').textContent = `${company?.companyname || '-'} · ${branch?.branchname || '-'} · ${formatTaskDateTime(row.task_datetime)}${combinedSubtitle}`;
    setLocationPinUi(row);

    await Promise.all([
        loadMachineStatusOptions(),
        loadPartsCatalog(),
        loadSerialCatalog()
    ]);
    renderPartsList();

    const machine = caches.machine.get(String(state.modalMachineId || 0)) || resolveMachineFromSerial(row.field_serial_selected);
    document.getElementById('fieldSerialInput').value = String(machine?.serial || row.field_serial_selected || '');
    await setModalMachineDetails(machine || null);

    document.getElementById('fieldSerialMissingCheck').checked = Number(row.field_serial_missing || row.serial_correction_pending || 0) === 1;
    document.getElementById('fieldMissingSerialInput').value = String(row.field_serial_missing_value || row.serial_correction_value || '').trim();
    toggleMissingSerialMode();

    setMachineStatusFromRow(row);
    setWorkMachineStatusFromRow(row);

    document.getElementById('fieldCloseNotes').value = String(row.field_work_notes || '').trim();
    document.getElementById('fieldSolutionNotes').value = '';

    const [branchContact, deliveryInfo, deliveryReceipt] = await Promise.all([
        resolveBranchContact(row.branch_id, row),
        resolveDeliveryInfo(row.branch_id),
        resolveDeliveryReceipt(row.id)
    ]);
    const deliveryReceiptItems = await resolveDeliveryReceiptItems(row.id, deliveryReceipt);

    const savedDeliveryDetails = String(row.field_delivery_details || '').trim();
    const savedEmptyPickupDetails = String(row.field_empty_pickup_details || '').trim();
    const autoDeliveryDetails = buildDeliveryDetailsDefault(row, deliveryReceipt, deliveryInfo, deliveryReceiptItems);
    const autoEmptyPickupDetails = buildEmptyPickupDefault(deliveryReceipt);

    document.getElementById('fieldDeliveryDetails').value = savedDeliveryDetails || autoDeliveryDetails;
    document.getElementById('fieldEmptyPickupDetails').value = savedEmptyPickupDetails || autoEmptyPickupDetails;
    document.getElementById('fieldFinalSummary').value = String(row.field_final_summary || '').trim() || buildFinalAcknowledgementSummary();
    document.getElementById('fieldCustomerSigner').value = String(
        row.field_customer_signer ||
        row.collocutor ||
        deliveryInfo?.tcontact_person ||
        deliveryInfo?.mcontact_person ||
        branchContact.contact_name ||
        row.caller ||
        ''
    ).trim();
    document.getElementById('fieldCustomerContact').value = String(
        row.field_customer_contact ||
        row.phone_number ||
        deliveryInfo?.tcontact_num ||
        deliveryInfo?.mcontact_num ||
        branchContact.contact_phone ||
        ''
    ).trim();
    document.getElementById('fieldBillingReceivedBy').value = String(row.field_billing_received_by || '').trim();
    applyAutomaticBillingStamp(row);
    state.modalCollectionInvoices = parseSavedCollectionInvoices(row);
    state.modalCollectionInvoiceSearchResults = [];
    document.getElementById('fieldCollectionInvoiceSearch').value = '';
    renderFieldCollectionInvoiceResults();
    renderFieldCollectionInvoices();
    document.getElementById('fieldCollectionCheckNumber').value = String(row.field_collection_check_number || '').trim();
    document.getElementById('fieldCollectionCheckBank').value = String(row.field_collection_check_bank || '').trim();
    document.getElementById('fieldCollectionCheckDate').value = dateOnly(row.field_collection_check_date);
    document.getElementById('fieldCollectionCheckAmount').value = String(row.field_collection_check_amount || '').trim();
    document.getElementById('fieldCollectionAmount').value = String(row.field_collection_payment_amount || '').trim();
    document.getElementById('fieldCollectionPaymentDate').value = dateOnly(row.field_collection_payment_date) || localDateYmd();
    document.getElementById('fieldCollectionDepositDate').value = dateOnly(row.field_collection_deposit_date) || localDateYmd();
    document.getElementById('fieldCollectionOrNumber').value = String(row.field_collection_or_number || '').trim();
    document.getElementById('fieldCollectionPaymentType').value = String(row.field_collection_payment_type || '').trim();
    document.getElementById('fieldCollectionPaymentStatus').value = String(row.field_collection_payment_status || '').trim() || 'Paid';
    document.getElementById('fieldCollectionDeductionType').value = String(row.field_collection_deduction_type || '').trim();
    document.getElementById('fieldCollectionDeductionAmount').value = String(row.field_collection_deduction_amount || '').trim();
    document.getElementById('fieldCollection2307Status').value = String(row.field_collection_2307_status || '').trim();
    document.getElementById('fieldCollectionPaymentRemarks').value = String(row.field_collection_payment_remarks || '').trim();

    const beforeSaved = String(row.field_before_photo_name || '').trim();
    const afterSaved = String(row.field_after_photo_name || '').trim();
    const collectionVoucherSaved = String(row.field_collection_voucher_name || '').trim();
    const collectionCheckSaved = String(row.field_collection_check_name || '').trim();
    const beforeInput = document.getElementById('fieldBeforePhoto');
    const afterInput = document.getElementById('fieldAfterPhoto');
    const collectionVoucherInput = document.getElementById('fieldCollectionVoucherImage');
    const collectionCheckInput = document.getElementById('fieldCollectionCheckImage');
    beforeInput.dataset.savedName = beforeSaved;
    afterInput.dataset.savedName = afterSaved;
    collectionVoucherInput.dataset.savedName = collectionVoucherSaved;
    collectionCheckInput.dataset.savedName = collectionCheckSaved;
    updatePhotoHint('fieldBeforePhoto', 'fieldBeforePhotoHint', 'field_before_photo_name');
    updatePhotoHint('fieldAfterPhoto', 'fieldAfterPhotoHint', 'field_after_photo_name');
    updatePhotoHint('fieldCollectionVoucherImage', 'fieldCollectionVoucherHint', 'field_collection_voucher_name');
    updatePhotoHint('fieldCollectionCheckImage', 'fieldCollectionCheckHint', 'field_collection_check_name');

    const billingPreviousMeter = await resolvePreviousMeter(row, Number(row.id || 0), row.task_datetime, Number(machine?.bmeter || 0), machine || null);
    const previousMeter = parseIntegerInput(row.field_previous_meter);
    const presentMeter = parseIntegerInput(row.field_present_meter) ?? parseIntegerInput(row.meter_reading);
    const previousMeterHint = document.getElementById('fieldPreviousMeterHint');
    if (Number(billingPreviousMeter?.meter || 0) > 0) {
        document.getElementById('fieldPreviousMeter').value = String(billingPreviousMeter.meter);
        const dateLabel = billingPreviousMeter.readingDate ? ` (${billingPreviousMeter.readingDate.slice(0, 10)})` : '';
        const sourceLabel = billingPreviousMeter.source === 'field_schedule'
            ? 'Loaded from prior field schedule'
            : billingPreviousMeter.source === 'machine_beginning_meter'
                ? 'Loaded from machine beginning meter'
                : 'Loaded from billing meter history';
        previousMeterHint.textContent = `${sourceLabel}${dateLabel}.`;
    } else if (previousMeter !== null) {
        document.getElementById('fieldPreviousMeter').value = String(previousMeter);
        previousMeterHint.textContent = 'Loaded from saved field draft.';
    } else {
        document.getElementById('fieldPreviousMeter').value = '';
        previousMeterHint.textContent = 'No billing meter history found for this serial/contract yet.';
    }
    document.getElementById('fieldPresentMeter').value = presentMeter !== null ? String(presentMeter) : '';
    recomputeTotalConsumed();

    const maintenancePreviousMeter = parseIntegerInput(row.field_maintenance_previous_meter);
    const maintenancePresentMeter = parseIntegerInput(row.field_maintenance_present_meter);
    const maintenancePreviousLookup = await resolvePreviousMaintenanceMeter(row, machine || null);
    const effectiveMaintenancePrevious = maintenancePreviousMeter !== null && maintenancePreviousMeter > 0
        ? maintenancePreviousMeter
        : parseIntegerInput(maintenancePreviousLookup?.meter);
    document.getElementById('fieldMaintenancePreviousMeter').value = effectiveMaintenancePrevious !== null ? String(effectiveMaintenancePrevious) : '';
    const maintenanceHint = document.getElementById('fieldMaintenancePreviousMeterHint');
    if (maintenanceHint) {
        if (maintenancePreviousMeter !== null && maintenancePreviousMeter > 0) {
            maintenanceHint.textContent = 'Loaded from saved field draft.';
        } else if (Number(maintenancePreviousLookup?.meter || 0) > 0) {
            const dateLabel = maintenancePreviousLookup.readingDate ? ` (${maintenancePreviousLookup.readingDate.slice(0, 10)})` : '';
            const sourceLabel = maintenancePreviousLookup.source === 'machine_beginning_meter'
                ? 'Loaded from machine beginning meter'
                : 'Loaded from prior field visit';
            maintenanceHint.textContent = `${sourceLabel}${dateLabel}.`;
        } else {
            maintenanceHint.textContent = 'No previous field visit meter found yet.';
        }
    }
    document.getElementById('fieldMaintenancePresentMeter').value = maintenancePresentMeter !== null ? String(maintenancePresentMeter) : '';
    recomputeMaintenanceTotalConsumed();

    const deliveryPreviousMeter = parseIntegerInput(row.field_delivery_previous_meter);
    const deliveryPresentMeter = parseIntegerInput(row.field_delivery_present_meter);
    document.getElementById('fieldDeliveryPreviousMeter').value = deliveryPreviousMeter !== null ? String(deliveryPreviousMeter) : '';
    document.getElementById('fieldDeliveryPresentMeter').value = deliveryPresentMeter !== null ? String(deliveryPresentMeter) : '';
    syncDeliveryMetersFromMaintenance();

    const log = await fetchLatestSchedtimeLog(scheduleId);
    if (log) {
        state.modalSchedtimeId = Number(log.id || 0) || null;
        state.modalSchedtimeDocId = log._docId || String(log.id || '');
    }

    const rowTimeIn = String(row.field_time_in || '').trim();
    const rowTimeOut = String(row.field_time_out || '').trim();
    const logTimeIn = String(log?.time_in || '').trim();
    const logTimeOut = String(log?.time_out || '').trim();

    document.getElementById('fieldTimeIn').value = toLocalInputDateTime(normalizeLegacyDateTime(rowTimeIn) || logTimeIn);
    document.getElementById('fieldTimeOut').value = toLocalInputDateTime(normalizeLegacyDateTime(rowTimeOut) || logTimeOut);

    const pinHint = document.getElementById('fieldPinHint');
    pinHint.textContent = 'Checking customer PIN setup...';
    state.modalExpectedPin = await resolveExpectedPin(state.modalBranchId, row);
    if (state.modalExpectedPin) {
        pinHint.textContent = 'Customer PIN is configured. Enter 4-digit PIN to finish.';
    } else {
        pinHint.textContent = 'No branch PIN configured yet. Finish is allowed without PIN for now.';
    }

    const restoredDraft = applyFieldModalDraft(getStoredFieldModalDraft());

    const isReadOnly = state.modalStatusKey === 'closed' || state.modalStatusKey === 'cancelled';
    setFormDisabled(isReadOnly);
    setLocationPinUi(row);
    updateActionButtons();

    setModalOpen(true);
    if (restoredDraft) {
        const status = document.getElementById('fieldModalSubtitle');
        if (status && !status.textContent.includes('Draft restored')) status.textContent = `${status.textContent} · Draft restored`;
    }
}

function getCurrentRow() {
    const scheduleId = Number(state.modalScheduleId || 0);
    if (!scheduleId) return null;
    return state.rows.find((row) => Number(row.id || 0) === scheduleId) || null;
}

function moneyNumber(value) {
    const numeric = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function collectionInvoiceKey(invoice) {
    return String(invoice?.invoiceKey || invoice?.invoiceNo || invoice?.invoiceId || invoice?.docId || '').trim().toUpperCase();
}

function getBillingInvoiceNo(row) {
    return firstNonBlank(row?.invoiceNo, row?.invoiceno, row?.invoice_no, row?.invoice_num, row?.invoice_number, row?.invoiceId, row?.invoice_id, row?.invoiceid, row?.id);
}

function getBillingInvoiceDate(row) {
    return dateOnly(firstNonBlank(row?.date, row?.invoiceDate, row?.dateprinted, row?.date_printed, row?.invoice_date, row?.invdate, row?.datex, row?.billing_date, row?.due_date, row?.tmstmp));
}

function getBillingInvoiceAmount(row) {
    return moneyNumber(firstNonBlank(
        row?.totalamount,
        row?.total_amount,
        row?.invoice_amt,
        row?.invoice_amount,
        row?.amount,
        row?.balance_amt,
        row?.balance,
        row?.grand_total
    ));
}

function mapFieldCollectionInvoice(record, fallbackRow = getCurrentRow()) {
    const location = scheduleLocationLabel(fallbackRow || {});
    const invoiceNo = String(getBillingInvoiceNo(record) || '').trim();
    const branchName = firstNonBlank(
        record?.branch,
        record?.branch_name,
        record?.branchname,
        record?.customer_branch,
        record?.category,
        location.branchName
    );
    const customerName = firstNonBlank(
        record?.customer,
        record?.client,
        record?.company,
        record?.company_name,
        record?.account_name,
        record?.mother_company,
        location.companyName
    );
    return {
        docId: String(record?._docId || record?.docId || record?.id || invoiceNo || '').trim(),
        invoiceId: String(firstNonBlank(record?.invoiceId, record?.invoice_id, record?.invoiceid, invoiceNo) || '').trim(),
        invoiceNo,
        invoiceKey: String(firstNonBlank(record?._docId, record?.invoiceKey, record?.invoiceId, record?.invoice_id, record?.invoiceid, invoiceNo) || '').trim(),
        date: getBillingInvoiceDate(record),
        customer: String(customerName || '').trim(),
        branch: String(branchName || '').trim(),
        amount: getBillingInvoiceAmount(record),
        raw: record || {}
    };
}

function createManualFieldCollectionInvoice(invoiceRef, fallbackRow = getCurrentRow()) {
    const ref = String(invoiceRef || '').trim();
    if (!ref) return null;
    const location = scheduleLocationLabel(fallbackRow || {});
    return {
        docId: ref,
        invoiceId: ref,
        invoiceNo: ref,
        invoiceKey: ref,
        date: '',
        customer: location.companyName || '',
        branch: location.branchName || '',
        amount: 0,
        raw: {
            _docId: ref,
            invoice_id: ref,
            invoice_no: ref,
            customer: location.companyName || '',
            branch: location.branchName || '',
            amount: 0,
            source: 'manual_field_collection_invoice_reference'
        }
    };
}

function parseSavedCollectionInvoices(row) {
    const saved = String(row?.field_collection_invoices_json || '').trim();
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => mapFieldCollectionInvoice(item, row)).filter((item) => collectionInvoiceKey(item));
            }
        } catch (err) {
            console.warn('Saved collection invoice allocation could not be parsed.', err);
        }
    }
    const legacyRefs = String(row?.field_collection_invoice_refs || '').trim();
    if (!legacyRefs) return [];
    const location = scheduleLocationLabel(row || {});
    return legacyRefs
        .split(/[,\n]+/)
        .map((ref) => String(ref || '').trim())
        .filter(Boolean)
        .map((ref) => ({
            docId: ref,
            invoiceId: ref,
            invoiceNo: ref,
            invoiceKey: ref,
            date: '',
            customer: location.companyName || '',
            branch: location.branchName || '',
            amount: 0,
            raw: {}
        }));
}

function renderFieldCollectionInvoiceResults() {
    const results = document.getElementById('fieldCollectionInvoiceResults');
    if (!results) return;
    const rows = state.modalCollectionInvoiceSearchResults || [];
    if (!rows.length) {
        results.hidden = true;
        results.innerHTML = '';
        return;
    }
    results.hidden = false;
    results.innerHTML = rows.map((invoice, index) => {
        const branch = [invoice.customer, invoice.branch].filter(Boolean).join(' - ');
        return `
            <button type="button" class="field-collection-invoice-result" data-collection-invoice-index="${index}">
                <span>
                    <strong>${sanitize(invoice.invoiceNo || invoice.invoiceId || '-')}</strong>
                    <small>${sanitize(branch || 'Customer / branch')} · ${sanitize(invoice.date || 'No date')}</small>
                </span>
                <span>${sanitize(formatPesoAmount(invoice.amount) || '₱0.00')}</span>
            </button>
        `;
    }).join('');
    results.querySelectorAll('[data-collection-invoice-index]').forEach((button) => {
        button.addEventListener('click', () => {
            addFieldCollectionInvoice(state.modalCollectionInvoiceSearchResults[Number(button.dataset.collectionInvoiceIndex || 0)]);
        });
    });
}

function renderFieldCollectionInvoices() {
    const tbody = document.getElementById('fieldCollectionInvoiceRows');
    const totalNode = document.getElementById('fieldCollectionInvoiceTotal');
    if (!tbody || !totalNode) return;
    const invoices = state.modalCollectionInvoices || [];
    const total = invoices.reduce((sum, invoice) => sum + moneyNumber(invoice.amount), 0);
    totalNode.textContent = formatPesoAmount(total) || '₱0.00';
    if (!invoices.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="field-collection-empty">No invoice selected yet.</td></tr>';
        updateActionButtons();
        return;
    }
    tbody.innerHTML = invoices.map((invoice, index) => {
        const customerBranch = [invoice.customer, invoice.branch].filter(Boolean).join(' - ');
        return `
            <tr>
                <td>${sanitize(invoice.date || '-')}</td>
                <td>${sanitize(customerBranch || '-')}</td>
                <td>${sanitize(invoice.invoiceNo || invoice.invoiceId || '-')}</td>
                <td class="text-right">${sanitize(formatPesoAmount(invoice.amount) || '₱0.00')}</td>
                <td class="text-right"><button type="button" class="field-collection-remove-btn" data-remove-collection-invoice="${index}" aria-label="Remove invoice">x</button></td>
            </tr>
        `;
    }).join('');
    updateActionButtons();
}

function addFieldCollectionInvoice(invoice, { showAlerts = true } = {}) {
    if (!invoice) return false;
    const normalized = mapFieldCollectionInvoice(invoice.raw || invoice);
    const key = collectionInvoiceKey(normalized);
    if (!key) {
        if (showAlerts) alert('Select a valid invoice first.');
        return false;
    }
    if (state.modalCollectionInvoices.some((item) => collectionInvoiceKey(item) === key)) {
        if (showAlerts) alert('That invoice is already in the payment table.');
        return true;
    }
    state.modalCollectionInvoices.push(normalized);
    state.modalCollectionInvoiceSearchResults = [];
    const search = document.getElementById('fieldCollectionInvoiceSearch');
    if (search) search.value = '';
    renderFieldCollectionInvoiceResults();
    renderFieldCollectionInvoices();
    queueFieldModalDraftSave();
    return true;
}

function removeFieldCollectionInvoice(index) {
    if (state.modalReadOnly) return;
    if (index < 0) return;
    state.modalCollectionInvoices.splice(index, 1);
    renderFieldCollectionInvoices();
    queueFieldModalDraftSave();
}

async function searchFieldCollectionInvoices(query) {
    const term = String(query || '').trim();
    if (!term) return [];
    const numeric = /^\d+$/.test(term);
    const queries = [
        queryEquals('tbl_billing', 'invoiceno', term, 'string', 12),
        queryEquals('tbl_billing', 'invoice_no', term, 'string', 12),
        queryEquals('tbl_billing', 'invoice_num', term, 'string', 12),
        queryEquals('tbl_billing', 'invoice_number', term, 'string', 12)
    ];
    if (numeric) {
        queries.push(
            queryEquals('tbl_billing', 'invoice_id', term, 'integer', 12),
            queryEquals('tbl_billing', 'invoiceid', term, 'integer', 12),
            queryEquals('tbl_billing', 'id', term, 'integer', 12)
        );
        queries.push(
            queryEquals('tbl_billing', 'invoice_id', term, 'string', 12),
            queryEquals('tbl_billing', 'invoiceid', term, 'string', 12)
        );
    }
    const timeoutMs = 9000;
    const settled = await Promise.allSettled(queries.map((promise) => Promise.race([
        promise,
        new Promise((resolve) => window.setTimeout(() => resolve([]), timeoutMs))
    ])));
    const byKey = new Map();
    settled.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        result.value.forEach((doc) => {
            const parsed = parseFirestoreDoc(doc);
            if (!parsed) return;
            const invoice = mapFieldCollectionInvoice(parsed);
            const key = collectionInvoiceKey(invoice);
            if (key && !byKey.has(key)) byKey.set(key, invoice);
        });
    });
    return [...byKey.values()].slice(0, 8);
}

async function runFieldCollectionInvoiceSearch() {
    const search = document.getElementById('fieldCollectionInvoiceSearch');
    const addButton = document.getElementById('fieldCollectionInvoiceAddBtn');
    const query = String(search?.value || '').trim();
    if (!query) {
        state.modalCollectionInvoiceSearchResults = [];
        renderFieldCollectionInvoiceResults();
        return;
    }
    if (addButton) addButton.disabled = true;
    const requestKey = `${query}_${Date.now()}`;
    state.modalCollectionInvoiceSearchRequest = requestKey;
    try {
        const rows = await searchFieldCollectionInvoices(query);
        if (state.modalCollectionInvoiceSearchRequest !== requestKey) return;
        state.modalCollectionInvoiceSearchResults = rows;
        renderFieldCollectionInvoiceResults();
    } catch (err) {
        console.warn('Invoice search failed.', err);
        state.modalCollectionInvoiceSearchResults = [];
        renderFieldCollectionInvoiceResults();
    } finally {
        if (addButton) addButton.disabled = state.modalReadOnly;
    }
}

async function addFirstFieldCollectionInvoiceMatch() {
    if (state.modalReadOnly) return;
    const search = document.getElementById('fieldCollectionInvoiceSearch');
    const query = String(search?.value || '').trim();
    let match = (state.modalCollectionInvoiceSearchResults || [])[0];
    if (!match) {
        const rows = await searchFieldCollectionInvoices(query);
        state.modalCollectionInvoiceSearchResults = rows;
        renderFieldCollectionInvoiceResults();
        match = rows[0];
    }
    if (match) addFieldCollectionInvoice(match);
    else {
        const manualInvoice = createManualFieldCollectionInvoice(query);
        if (manualInvoice && addFieldCollectionInvoice(manualInvoice, { showAlerts: false })) {
            alert('Invoice was not found in billing search, so it was added as an invoice reference for this collection.');
            return;
        }
        alert('No matching invoice record found. Search the invoice first, then add it from the result.');
    }
}

async function ensureTypedCollectionInvoiceIsSelected() {
    if ((state.modalCollectionInvoices || []).length) return true;
    const search = document.getElementById('fieldCollectionInvoiceSearch');
    const query = String(search?.value || '').trim();
    if (!query) return false;
    let rows = state.modalCollectionInvoiceSearchResults || [];
    if (!rows.length) {
        rows = await searchFieldCollectionInvoices(query);
        state.modalCollectionInvoiceSearchResults = rows;
        renderFieldCollectionInvoiceResults();
    }
    const normalizedQuery = query.toUpperCase();
    const exactMatch = rows.find((invoice) => {
        const invoiceNo = String(invoice.invoiceNo || '').trim().toUpperCase();
        const invoiceId = String(invoice.invoiceId || '').trim().toUpperCase();
        return invoiceNo === normalizedQuery || invoiceId === normalizedQuery;
    });
    const match = exactMatch || (rows.length === 1 ? rows[0] : null);
    if (match) return addFieldCollectionInvoice(match, { showAlerts: false });
    return addFieldCollectionInvoice(createManualFieldCollectionInvoice(query), { showAlerts: false });
}

function getSelectedMachine() {
    const serialInput = (document.getElementById('fieldSerialInput').value || '').trim();
    const selected = resolveMachineFromSerial(serialInput);
    if (selected) return selected;
    const machineId = Number(state.modalMachineId || 0);
    if (!machineId) return null;
    const cached = caches.machine.get(String(machineId));
    if (!cached) return null;
    return {
        id: machineId,
        serial: String(cached.serial || '').trim(),
        model_id: Number(cached.model_id || 0),
        brand_id: Number(cached.brand_id || 0),
        bmeter: Number(cached.bmeter || 0),
        description: String(cached.description || '').trim()
    };
}

function collectModalFormData() {
    const machineSelect = document.getElementById('fieldMachineStatus');
    const statusOption = machineSelect.selectedOptions?.[0] || null;
    const statusLabel = TEMPORARILY_DISABLED_FIELD_GROUPS.machineStatus
        ? ''
        : String(statusOption?.dataset?.label || statusOption?.textContent || '').trim();
    const statusId = TEMPORARILY_DISABLED_FIELD_GROUPS.machineStatus
        ? 0
        : (parseIntegerInput(machineSelect.value) || 0);

    const selectedMachine = getSelectedMachine();
    const serialInput = String(document.getElementById('fieldSerialInput').value || '').trim();
    const missingSerial = TEMPORARILY_DISABLED_FIELD_GROUPS.missingSerial
        ? ''
        : String(document.getElementById('fieldMissingSerialInput').value || '').trim().toUpperCase();
    const serialMissing = TEMPORARILY_DISABLED_FIELD_GROUPS.missingSerial
        ? false
        : document.getElementById('fieldSerialMissingCheck').checked;

    const previousMeter = parseIntegerInput(document.getElementById('fieldPreviousMeter').value);
    const presentMeter = parseIntegerInput(document.getElementById('fieldPresentMeter').value);
    const totalConsumed = Number.isFinite(previousMeter) && Number.isFinite(presentMeter)
        ? Math.max(0, presentMeter - previousMeter)
        : 0;
    const maintenancePreviousMeter = parseIntegerInput(document.getElementById('fieldMaintenancePreviousMeter').value);
    const maintenancePresentMeter = parseIntegerInput(document.getElementById('fieldMaintenancePresentMeter').value);
    const maintenanceTotalConsumed = Number.isFinite(maintenancePreviousMeter) && Number.isFinite(maintenancePresentMeter)
        ? Math.max(0, maintenancePresentMeter - maintenancePreviousMeter)
        : 0;
    const deliveryPreviousMeter = parseIntegerInput(document.getElementById('fieldDeliveryPreviousMeter')?.value);
    const deliveryPresentMeter = parseIntegerInput(document.getElementById('fieldDeliveryPresentMeter')?.value);
    const deliveryTotalConsumed = Number.isFinite(deliveryPreviousMeter) && Number.isFinite(deliveryPresentMeter)
        ? Math.max(0, deliveryPresentMeter - deliveryPreviousMeter)
        : 0;
    const workMachineStatusSelect = document.getElementById('fieldWorkMachineStatus');
    const workMachineStatusOption = workMachineStatusSelect?.selectedOptions?.[0] || null;
    const workMachineStatusId = parseIntegerInput(workMachineStatusSelect?.value) || 0;
    const workMachineStatusLabel = String(workMachineStatusOption?.dataset?.label || workMachineStatusOption?.textContent || '').trim();

    const timeInLocal = String(document.getElementById('fieldTimeIn').value || '').trim();
    const timeOutLocal = String(document.getElementById('fieldTimeOut').value || '').trim();
    const collectionAmount = String(document.getElementById('fieldCollectionAmount').value || '').trim();
    const collectionDeductionAmount = String(document.getElementById('fieldCollectionDeductionAmount')?.value || '').trim();
    const collectionCheckAmount = String(document.getElementById('fieldCollectionCheckAmount')?.value || '').trim();
    const collectionInvoices = (state.modalCollectionInvoices || []).map((invoice) => ({
        docId: String(invoice.docId || '').trim(),
        invoiceId: String(invoice.invoiceId || '').trim(),
        invoiceNo: String(invoice.invoiceNo || '').trim(),
        invoiceKey: String(invoice.invoiceKey || '').trim(),
        date: String(invoice.date || '').trim(),
        customer: String(invoice.customer || '').trim(),
        branch: String(invoice.branch || '').trim(),
        amount: moneyNumber(invoice.amount)
    }));
    const collectionInvoiceRefs = collectionInvoices
        .map((invoice) => invoice.invoiceNo || invoice.invoiceId)
        .filter(Boolean)
        .join(', ');
    const collectionInvoiceTotal = collectionInvoices.reduce((sum, invoice) => sum + moneyNumber(invoice.amount), 0);

    return {
        notes: String(document.getElementById('fieldCloseNotes').value || '').trim(),
        finalSummary: buildFinalAcknowledgementSummary(),
        deliveryDetails: String(document.getElementById('fieldDeliveryDetails').value || '').trim(),
        emptyPickupDetails: String(document.getElementById('fieldEmptyPickupDetails').value || '').trim(),
        customerSigner: String(document.getElementById('fieldCustomerSigner').value || '').trim(),
        customerContact: String(document.getElementById('fieldCustomerContact').value || '').trim(),
        billingReceivedBy: String(document.getElementById('fieldBillingReceivedBy').value || '').trim(),
        billingDate: String(document.getElementById('fieldBillingDate').value || '').trim(),
        billingTime: String(document.getElementById('fieldBillingTime').value || '').trim(),
        collectionReceiptRefs: String(document.getElementById('fieldCollectionOrNumber')?.value || '').trim(),
        collectionInvoiceRefs,
        collectionInvoices,
        collectionInvoiceTotal,
        collectionCheckNumber: String(document.getElementById('fieldCollectionCheckNumber').value || '').trim(),
        collectionCheckBank: String(document.getElementById('fieldCollectionCheckBank')?.value || '').trim(),
        collectionCheckDate: String(document.getElementById('fieldCollectionCheckDate')?.value || '').trim(),
        collectionCheckAmount,
        collectionCheckAmountNumber: Number(collectionCheckAmount || 0),
        collectionAmount,
        collectionAmountNumber: Number(collectionAmount || 0),
        collectionPaymentDate: String(document.getElementById('fieldCollectionPaymentDate')?.value || '').trim(),
        collectionDepositDate: String(document.getElementById('fieldCollectionDepositDate')?.value || '').trim(),
        collectionOrNumber: String(document.getElementById('fieldCollectionOrNumber')?.value || '').trim(),
        collectionPaymentType: String(document.getElementById('fieldCollectionPaymentType')?.value || '').trim(),
        collectionPaymentStatus: String(document.getElementById('fieldCollectionPaymentStatus')?.value || '').trim(),
        collectionDeductionType: String(document.getElementById('fieldCollectionDeductionType')?.value || '').trim(),
        collectionDeductionAmount,
        collectionDeductionAmountNumber: Number(collectionDeductionAmount || 0),
        collection2307Status: String(document.getElementById('fieldCollection2307Status')?.value || '').trim(),
        collectionPaymentRemarks: String(document.getElementById('fieldCollectionPaymentRemarks')?.value || '').trim(),
        pin: TEMPORARILY_DISABLED_FIELD_GROUPS.customerPin
            ? ''
            : String(document.getElementById('fieldClosePin').value || '').trim(),
        machineStatusId: statusId,
        machineStatusLabel: statusLabel,
        serialInput,
        serialMissing,
        missingSerial,
        selectedMachineId: Number(selectedMachine?.id || 0) || null,
        selectedMachineSerial: String(selectedMachine?.serial || serialInput || '').trim(),
        previousMeter,
        presentMeter,
        totalConsumed,
        maintenancePreviousMeter,
        maintenancePresentMeter,
        maintenanceTotalConsumed,
        deliveryPreviousMeter,
        deliveryPresentMeter,
        deliveryTotalConsumed,
        workMachineStatusId,
        workMachineStatusLabel,
        timeInLocal,
        timeOutLocal,
        timeInDb: toDbDateTimeFromLocal(timeInLocal),
        timeOutDb: toDbDateTimeFromLocal(timeOutLocal),
        partsNeeded: state.modalPartsNeeded.map((item) => ({
            key: String(item.key || ''),
            name: String(item.name || '').trim(),
            qty: Math.max(1, parseIntegerInput(item.qty) || 1),
            source: String(item.source || '')
        })),
        beforePhoto: getFileMeta('fieldBeforePhoto'),
        afterPhoto: getFileMeta('fieldAfterPhoto'),
        collectionVoucherImage: getFileMeta('fieldCollectionVoucherImage'),
        collectionCheckImage: getFileMeta('fieldCollectionCheckImage')
    };
}

function buildSchedulePayload(row, form, tag) {
    const staffId = Number(state.staffId || 0) || 0;
    const nowIso = new Date().toISOString();
    const payload = {
        field_work_notes: form.notes,
        field_final_summary: form.finalSummary,
        field_delivery_details: form.deliveryDetails,
        field_empty_pickup_details: form.emptyPickupDetails,
        field_customer_signer: form.customerSigner,
        field_customer_contact: form.customerContact,
        field_billing_received_by: form.billingReceivedBy,
        field_billing_date: form.billingDate,
        field_billing_time: form.billingTime,
        field_collection_receipt_refs: form.collectionReceiptRefs,
        field_collection_invoice_refs: form.collectionInvoiceRefs,
        field_collection_invoices_json: jsonString(form.collectionInvoices || [], '[]'),
        field_collection_invoice_total: Number(form.collectionInvoiceTotal || 0) || 0,
        field_collection_check_number: form.collectionCheckNumber,
        field_collection_check_bank: form.collectionCheckBank,
        field_collection_check_date: form.collectionCheckDate ? `${form.collectionCheckDate} 00:00:00` : ZERO_DATETIME,
        field_collection_check_amount: form.collectionCheckAmount,
        field_collection_payment_amount: form.collectionAmount,
        field_collection_payment_date: form.collectionPaymentDate ? `${form.collectionPaymentDate} 00:00:00` : ZERO_DATETIME,
        field_collection_deposit_date: form.collectionDepositDate ? `${form.collectionDepositDate} 00:00:00` : ZERO_DATETIME,
        field_collection_or_number: form.collectionOrNumber,
        field_collection_payment_type: form.collectionPaymentType,
        field_collection_payment_status: form.collectionPaymentStatus,
        field_collection_deduction_type: form.collectionDeductionType,
        field_collection_deduction_amount: form.collectionDeductionAmount,
        field_collection_2307_status: form.collection2307Status,
        field_collection_payment_remarks: form.collectionPaymentRemarks,
        field_previous_meter: form.previousMeter ?? 0,
        field_present_meter: form.presentMeter ?? 0,
        field_total_consumed: form.totalConsumed ?? 0,
        field_maintenance_previous_meter: form.maintenancePreviousMeter ?? 0,
        field_maintenance_present_meter: form.maintenancePresentMeter ?? 0,
        field_maintenance_total_consumed: form.maintenanceTotalConsumed ?? 0,
        field_delivery_previous_meter: form.deliveryPreviousMeter ?? 0,
        field_delivery_present_meter: form.deliveryPresentMeter ?? 0,
        field_delivery_total_consumed: form.deliveryTotalConsumed ?? 0,
        field_work_machine_status_id: form.workMachineStatusId || 0,
        field_work_machine_status: form.workMachineStatusLabel || '',
        field_time_in: form.timeInDb || ZERO_DATETIME,
        field_time_out: form.timeOutDb || ZERO_DATETIME,
        field_parts_needed_json: jsonString(form.partsNeeded, '[]'),
        field_before_photo_name: form.beforePhoto?.name || '',
        field_before_photo_size: Number(form.beforePhoto?.size || 0) || 0,
        field_before_photo_type: form.beforePhoto?.type || '',
        field_after_photo_name: form.afterPhoto?.name || '',
        field_after_photo_size: Number(form.afterPhoto?.size || 0) || 0,
        field_after_photo_type: form.afterPhoto?.type || '',
        field_collection_voucher_name: form.collectionVoucherImage?.name || '',
        field_collection_voucher_size: Number(form.collectionVoucherImage?.size || 0) || 0,
        field_collection_voucher_type: form.collectionVoucherImage?.type || '',
        field_collection_check_name: form.collectionCheckImage?.name || '',
        field_collection_check_size: Number(form.collectionCheckImage?.size || 0) || 0,
        field_collection_check_type: form.collectionCheckImage?.type || '',
        field_serial_selected: form.selectedMachineSerial || form.serialInput || '',
        field_serial_selected_machine_id: form.selectedMachineId || 0,
        field_updated_by: staffId,
        field_updated_at: nowIso,
        bridge_updated_by: staffId,
        bridge_updated_at: nowIso
    };

    if (!TEMPORARILY_DISABLED_FIELD_GROUPS.machineStatus) {
        payload.field_machine_status = form.machineStatusLabel;
        payload.field_machine_status_id = form.machineStatusId;
    }

    if (!TEMPORARILY_DISABLED_FIELD_GROUPS.missingSerial) {
        payload.field_serial_missing = form.serialMissing ? 1 : 0;
        payload.field_serial_missing_value = form.missingSerial || '';
    }

    if (Number.isFinite(form.presentMeter)) payload.meter_reading = form.presentMeter;
    if (form.customerSigner) payload.collocutor = clampText(form.customerSigner, 255);
    if (form.customerContact) payload.phone_number = clampText(form.customerContact, 255);
    if (!TEMPORARILY_DISABLED_FIELD_GROUPS.machineStatus && form.machineStatusId > 0) payload.tl_status = form.machineStatusId;
    if (!TEMPORARILY_DISABLED_FIELD_GROUPS.machineStatus && form.machineStatusLabel) payload.tl_remarks = clampText(form.machineStatusLabel, 255);
    if (form.finalSummary) payload.customer_request = clampText(form.finalSummary, 255);

    const notesForLog = form.notes || form.finalSummary || '';
    if (tag && notesForLog) {
        payload.dev_remarks = appendDevRemarks(row.dev_remarks, tag, notesForLog);
    }

    return payload;
}

function applyRowPatch(scheduleId, patch) {
    const row = state.rows.find((item) => Number(item.id || 0) === Number(scheduleId || 0));
    if (!row) return;
    Object.assign(row, patch);
}

function scheduleDocIdForRow(row) {
    return String(row?._docId || row?.schedule_doc_id || row?.id || '').trim();
}

function closeIssue(message, sectionId = '', fieldId = '', code = 'finish_validation') {
    return { message, sectionId, fieldId, code };
}

function closeIssueMessage(issue) {
    return typeof issue === 'string' ? issue : String(issue?.message || 'Cannot mark finished: required details are incomplete.');
}

function revealCloseIssue(issue) {
    const sectionId = issue?.sectionId || '';
    const fieldId = issue?.fieldId || '';
    if (sectionId) {
        const section = document.getElementById(sectionId);
        if (section) {
            collapseOtherSections(section);
            setSectionCollapsed(section, false);
        }
    }
    if (fieldId) {
        const field = document.getElementById(fieldId);
        if (field) {
            field.focus({ preventScroll: true });
            field.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

function isValidMoney(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0;
}

function getPurposeRequirementLabel(row) {
    return PURPOSE_LABELS[normalizeTicketPurpose(row)] || `Purpose ${normalizeTicketPurpose(row) || '-'}`;
}

function hasCollectionCompletionDetails(form = {}) {
    return Boolean(
        form.collectionPaymentType
        || isValidMoney(form.collectionAmountNumber)
        || isValidMoney(form.collectionDeductionAmountNumber)
        || (Array.isArray(form.collectionInvoices) && form.collectionInvoices.length > 0)
        || form.collectionOrNumber
        || form.collectionReceiptRefs
        || form.collectionCheckNumber
        || form.collectionCheckBank
        || form.collectionDeductionType
        || form.collection2307Status
        || form.collectionPaymentRemarks
    );
}

function getCloseTaskIssues(row, form) {
    if (isFutureScheduleForClose(row)) {
        return [closeIssue('This schedule is for a future date. It can only be marked Finished on the scheduled day.', '', '', 'future_schedule')];
    }
    if (!normalizeLegacyDateTime(form.timeInDb)) {
        return [closeIssue('Cannot mark finished: customer check-in is required for this task. Attendance time-in is only once per day; this customer check-in must be done for every customer visit.', 'fieldTimeSection', 'fieldTimeInNowBtn', 'missing_customer_check_in')];
    }
    if (!normalizeLegacyDateTime(form.timeOutDb)) {
        return [closeIssue('Cannot mark finished: customer check-out is required for this task. Tap Check Out Now before closing every customer visit.', 'fieldTimeSection', 'fieldTimeOutNowBtn', 'missing_customer_check_out')];
    }

    if (isReadingTicket(row) && !Number.isFinite(form.presentMeter)) {
        return [closeIssue('Cannot mark finished: complete the bill meter reading first.', 'fieldMeterSection', 'fieldPresentMeter', 'missing_billing_meter')];
    }

    const hasCollectionDetails = hasCollectionCompletionDetails(form);

    if (isBillingTicket(row) && !hasCollectionDetails) {
        if (!form.billingReceivedBy) {
            return [closeIssue('Cannot mark finished: enter who received the billing first.', 'fieldBillingSection', 'fieldBillingReceivedBy', 'missing_billing_receiver')];
        }
    }

    if (isServiceTicket(row)) {
        if (String(form.notes || '').trim().length < 6) {
            return [closeIssue('Cannot mark finished: complete the work execution notes first.', 'fieldWorkSection', 'fieldCloseNotes', 'missing_work_execution')];
        }
        if (!Number.isFinite(form.maintenancePresentMeter)) {
            return [closeIssue('Cannot mark finished: enter the present visit meter first.', 'fieldWorkSection', 'fieldMaintenancePresentMeter', 'missing_maintenance_meter')];
        }
        if (!form.workMachineStatusId) {
            return [closeIssue('Cannot mark finished: select the machine status first.', 'fieldWorkSection', 'fieldWorkMachineStatus', 'missing_machine_status')];
        }
    }

    if (isDeliveryTicket(row)) {
        if (!form.deliveryDetails) {
            return [closeIssue('Cannot mark finished: complete the toner/ink delivery details first.', 'fieldDeliverySection', 'fieldDeliveryDetails', 'missing_delivery_details')];
        }
        if (!form.emptyPickupDetails) {
            return [closeIssue('Cannot mark finished: record the empty toner/ink pickup details first.', 'fieldDeliverySection', 'fieldEmptyPickupDetails', 'missing_empty_pickup')];
        }
        if (isMachineDeliveryTask(row, form) && !Number.isFinite(form.deliveryPresentMeter) && !Number.isFinite(form.maintenancePresentMeter)) {
            return [closeIssue('Cannot mark finished: enter the present delivery machine meter first.', 'fieldDeliverySection', 'fieldDeliveryPresentMeter', 'missing_delivery_meter')];
        }
    }

    if (isCollectionTicket(row) || hasCollectionDetails) {
        if (!form.collectionPaymentType) {
            return [closeIssue('Cannot mark finished: select the collection payment type first.', 'fieldCollectionSection', 'fieldCollectionPaymentType', 'missing_collection_payment_type')];
        }
        if (!isValidMoney(form.collectionAmountNumber) && !isValidMoney(form.collectionDeductionAmountNumber)) {
            return [closeIssue('Cannot mark finished: enter the collection payment amount or deduction amount first.', 'fieldCollectionSection', 'fieldCollectionAmount', 'missing_collection_amount')];
        }
        if (!form.collectionPaymentDate) {
            return [closeIssue('Cannot mark finished: select the collection payment date first.', 'fieldCollectionSection', 'fieldCollectionPaymentDate', 'missing_collection_payment_date')];
        }
        if (!form.collectionInvoices?.length) {
            return [closeIssue('Cannot mark finished: add the invoice number(s) covered by the payment first.', 'fieldCollectionSection', 'fieldCollectionInvoiceSearch', 'missing_collection_invoice_refs')];
        }
        if (!form.collectionOrNumber && !form.collectionReceiptRefs) {
            return [closeIssue('Cannot mark finished: enter the OR/receipt reference first.', 'fieldCollectionSection', 'fieldCollectionOrNumber', 'missing_collection_or')];
        }
        const declaredTotal = Number(form.collectionAmountNumber || 0) + Number(form.collectionDeductionAmountNumber || 0);
        if (Number(form.collectionInvoiceTotal || 0) > 0 && Math.abs(Number(form.collectionInvoiceTotal || 0) - declaredTotal) > 0.01) {
            return [closeIssue('Cannot mark finished: invoice table total must match Amount of Payment plus 2307/deduction.', 'fieldCollectionSection', 'fieldCollectionAmount', 'collection_total_mismatch')];
        }
        if (Number(form.collectionDeductionAmountNumber || 0) > 0 && !form.collectionDeductionType) {
            return [closeIssue('Cannot mark finished: select the deduction type for the deducted amount first.', 'fieldCollectionSection', 'fieldCollectionDeductionType', 'missing_deduction_type')];
        }
        if (form.collectionPaymentType === 'check') {
            if (!form.collectionCheckNumber) {
                return [closeIssue('Cannot mark finished: enter the check number first.', 'fieldCollectionSection', 'fieldCollectionCheckNumber', 'missing_check_number')];
            }
            if (!form.collectionCheckBank) {
                return [closeIssue('Cannot mark finished: enter the check bank first.', 'fieldCollectionSection', 'fieldCollectionCheckBank', 'missing_check_bank')];
            }
            if (!form.collectionCheckDate) {
                return [closeIssue('Cannot mark finished: select the check date first.', 'fieldCollectionSection', 'fieldCollectionCheckDate', 'missing_check_date')];
            }
        }
        if (form.collectionDeductionType === '2307' && !form.collection2307Status) {
            return [closeIssue('Cannot mark finished: select the 2307 form status first.', 'fieldCollectionSection', 'fieldCollection2307Status', 'missing_2307_status')];
        }
    }

    if (isPendingReplacementState(row, form) && String(form.notes || '').trim().length < 6) {
        return [closeIssue('Cannot mark finished: add work notes or parts request details first.', 'fieldWorkSection', 'fieldCloseNotes', 'missing_parts_notes')];
    }

    return [];
}

async function logFinishBlockedAttempt(row, issue, form) {
    const scheduleId = Number(row?.id || 0) || 0;
    if (!scheduleId) return;
    const nowIso = new Date().toISOString();
    const docId = `finish_block_${scheduleId}_${Number(state.staffId || 0) || 0}_${Date.now()}`;
    const payload = {
        id: docId,
        schedule_id: scheduleId,
        schedule_doc_id: scheduleDocIdForRow(row),
        staff_id: Number(state.staffId || 0) || 0,
        staff_name: getCurrentStaffName(),
        purpose_id: Number(row?.purpose_id || 0) || 0,
        purpose_label: getPurposeRequirementLabel(row),
        branch_id: Number(row?.branch_id || 0) || 0,
        company_id: Number(row?.company_id || 0) || 0,
        task_datetime: String(row?.task_datetime || ''),
        blocked_at: nowIso,
        status: 'blocked',
        reason_code: issue?.code || 'finish_validation',
        reason: closeIssueMessage(issue),
        source: 'field_app_mark_finished',
        form_snapshot: jsonString({
            hasWorkNotes: Boolean(form?.notes),
            hasBillingMeter: Number.isFinite(form?.presentMeter),
            hasMaintenanceMeter: Number.isFinite(form?.maintenancePresentMeter),
            hasDeliveryDetails: Boolean(form?.deliveryDetails),
            hasCollectionAmount: isValidMoney(form?.collectionAmountNumber),
            collectionPaymentType: form?.collectionPaymentType || ''
        }, '{}')
    };
    await setDocument(FIELD_FINISH_BLOCK_COLLECTION, docId, payload).catch((error) => {
        console.warn('Finish blocked attempt log failed.', error);
    });
}

async function saveFieldCollectionPaymentRecord(row, form, nowIso, staffId) {
    if (!isCollectionTicket(row)) return {};
    const isCheck = form.collectionPaymentType === 'check';
    const deductionType = String(form.collectionDeductionType || '').trim().toLowerCase();
    const deductionAmount = Number(form.collectionDeductionAmountNumber || 0) || 0;
    const totalPaymentAmount = Number(form.collectionAmountNumber || 0) || 0;
    const totalGrossAmount = Number(form.collectionInvoiceTotal || 0) || (totalPaymentAmount + deductionAmount);
    const invoices = (form.collectionInvoices || []).length
        ? form.collectionInvoices
        : [{
            invoiceId: form.collectionInvoiceRefs || String(row.collection_no || row.reference_no || ''),
            invoiceNo: form.collectionInvoiceRefs || String(row.collection_no || row.reference_no || ''),
            date: '',
            customer: '',
            branch: '',
            amount: totalGrossAmount
        }];
    const paymentDateDb = form.collectionPaymentDate ? `${form.collectionPaymentDate} 00:00:00` : ZERO_DATETIME;
    const depositDateDb = form.collectionDepositDate ? `${form.collectionDepositDate} 00:00:00` : paymentDateDb;
    const checkDateDb = form.collectionCheckDate ? `${form.collectionCheckDate} 00:00:00` : ZERO_DATETIME;
    const branch = caches.branch.get(String(row.branch_id || 0));
    const company = caches.company.get(String(row.company_id || branch?.company_id || 0));
    const clientName = company?.companyname || row.company_name || '';
    const category = branch?.branchname || row.branch_name || '';
    const groupId = `field_payment_group_${Number(row.id || 0) || Date.now()}_${Date.now()}`;
    const paymentDocIds = [];
    const checkDocIds = [];
    let allocatedPayment = 0;
    let allocatedDeduction = 0;
    for (let index = 0; index < invoices.length; index += 1) {
        const invoice = invoices[index];
        const grossAmount = moneyNumber(invoice.amount) || (index === 0 ? totalGrossAmount : 0);
        const ratio = totalGrossAmount > 0 ? grossAmount / totalGrossAmount : (index === 0 ? 1 : 0);
        const isLast = index === invoices.length - 1;
        const tax2307 = deductionType === '2307'
            ? (isLast ? Math.max(0, deductionAmount - allocatedDeduction) : Math.round((deductionAmount * ratio) * 100) / 100)
            : 0;
        const otherDeductionAmount = deductionType && deductionType !== '2307'
            ? (isLast ? Math.max(0, deductionAmount - allocatedDeduction) : Math.round((deductionAmount * ratio) * 100) / 100)
            : 0;
        const lineDeduction = tax2307 + otherDeductionAmount;
        const paymentAmount = isLast
            ? Math.max(0, totalPaymentAmount - allocatedPayment)
            : Math.max(0, Math.round((grossAmount - lineDeduction) * 100) / 100);
        allocatedPayment += paymentAmount;
        allocatedDeduction += lineDeduction;
        const taxFormStatus = tax2307 > 0 ? (form.collection2307Status || 'pending') : '';
        const taxStatus = tax2307 > 0 ? (taxFormStatus === 'submitted' ? 2 : 1) : 0;
        const invoiceRef = invoice.invoiceNo || invoice.invoiceId || form.collectionInvoiceRefs || form.collectionReceiptRefs || String(row.collection_no || row.reference_no || '');
        const paymentDocId = `${groupId}_${index + 1}`;
        const checkDocId = isCheck ? `field_checkpayment_${Number(row.id || 0) || Date.now()}_${index + 1}` : '';
        paymentDocIds.push(paymentDocId);
        if (checkDocId) checkDocIds.push(checkDocId);
        const paymentPayload = {
            id: paymentDocId,
            schedule_id: Number(row.id || 0) || 0,
            schedule_doc_id: scheduleDocIdForRow(row),
            branch_id: Number(row.branch_id || 0) || 0,
            company_id: Number(row.company_id || branch?.company_id || 0) || 0,
            invoice_id: invoice.invoiceId || invoiceRef,
            invoice_num: invoiceRef,
            client: invoice.customer || clientName,
            category: invoice.branch || category,
            invoice_amt: grossAmount,
            invoice_date: invoice.date ? `${invoice.date} 00:00:00` : ZERO_DATETIME,
            printed_or: form.collectionOrNumber || form.collectionReceiptRefs,
            assigned: getCurrentStaffName(),
            payment_amt: paymentAmount,
            balance_amt: 0,
            date_deposit: depositDateDb,
            date_paid: paymentDateDb,
            ornum: form.collectionOrNumber || form.collectionReceiptRefs,
            or_number: form.collectionOrNumber || form.collectionReceiptRefs,
            payment_type: isCheck ? 1 : 0,
            payment_status: 'Draft Payment',
            check_number: form.collectionCheckNumber,
            check_amt: isCheck ? paymentAmount : 0,
            check_date: checkDateDb,
            account_bank: form.collectionCheckBank,
            tax_2307: tax2307,
            tax_date_paid: tax2307 > 0 ? paymentDateDb : ZERO_DATETIME,
            tax_status: taxStatus,
            deduction_type: deductionType,
            deduction_amount: lineDeduction,
            other_deduction_amount: otherDeductionAmount,
            tax_form_status: taxFormStatus,
            tax_form_received_at: tax2307 > 0 && taxFormStatus === 'submitted' ? nowIso : '',
            tax_form_remarks: form.collectionPaymentRemarks,
            checkpayment_id: checkDocId || 0,
            remarks: form.collectionPaymentRemarks,
            timestamp: nowIso,
            updated_at: nowIso,
            source: 'field_app_collection_payment_draft',
            encoded_by: staffId,
            field_payment_group_id: groupId,
            field_payment_group_total: totalGrossAmount,
            field_payment_line_index: index + 1,
            field_payment_line_count: invoices.length
        };
        await setDocument('tbl_paymentinfo', paymentDocId, paymentPayload);
        if (isCheck) {
            await setDocument('tbl_checkpayments', checkDocId, {
                id: checkDocId,
                paymentinfo_id: paymentDocId,
                schedule_id: Number(row.id || 0) || 0,
                check_number: form.collectionCheckNumber,
                check_bank: form.collectionCheckBank,
                account_bank: form.collectionCheckBank,
                check_date: checkDateDb,
                check_amt: paymentAmount,
                amount: paymentAmount,
                status: 'pending',
                remarks: form.collectionPaymentRemarks,
                timestamp: nowIso,
                updated_at: nowIso,
                source: 'field_app_collection_payment_draft',
                encoded_by: staffId,
                field_payment_group_id: groupId
            });
        }
    }
    return {
        field_collection_payment_doc_id: paymentDocIds[0] || '',
        field_collection_payment_doc_ids: paymentDocIds.join(','),
        field_collection_check_doc_id: checkDocIds[0] || '',
        field_collection_check_doc_ids: checkDocIds.join(','),
        field_collection_payment_group_id: groupId,
        field_collection_payment_recorded_at: nowIso,
        field_collection_payment_recorded_by: staffId
    };
}

async function closeCombinedScheduleRow(row, payload, form, nowIso, staffId) {
    await patchDocument('tbl_schedule', scheduleDocIdForRow(row), payload);
    if (row.source_planner_doc_id) {
        try {
            await patchDocument(SCHEDULE_PLANNER_COLLECTION, row.source_planner_doc_id, {
                planner_status: 'closed',
                task_status: 'closed',
                route_status: 'closed',
                date_finished: form.timeOutDb,
                closed_at: nowIso,
                closed_by: staffId,
                field_closed_schedule_id: Number(row.id || 0) || 0,
                field_closed_at: nowIso
            });
        } catch (plannerError) {
            console.warn('Planner row close update failed; schedule was closed.', plannerError);
        }
    }
    const routeCollection = routeCollectionForRow(row);
    if (routeCollection && row.route_doc_id) {
        try {
            await patchDocument(routeCollection, row.route_doc_id, {
                status: 0,
                date_finished: form.timeOutDb,
                remarks: form.notes || form.finalSummary || row.route_remarks || row.remarks || '',
                timestmp: nowIso,
                bridge_pushed_at: nowIso
            });
        } catch (routeError) {
            console.warn('Route row close update failed; schedule was closed.', routeError);
        }
    }
    await safeUpsertSchedtimeLog(row, form, 'finish');
    applyRowPatch(row.id, {
        ...payload,
        route_status: 0,
        route_date_finished: form.timeOutDb,
        route_timestmp: nowIso,
        route_bridge_pushed_at: nowIso
    });
}

function isMachineDeliveryTask(row, form) {
    const purposeLabel = String(PURPOSE_LABELS[row?.purpose_id] || '').toLowerCase();
    const deliveryText = normalizeSearchText(form?.deliveryDetails || row?.remarks || '');
    const deliveryPurpose = /deliver|delivery/.test(purposeLabel) || /deliver|delivery/.test(deliveryText);
    const machineWords = /(machine|unit|copier|printer|beginning meter|installation)/i.test(form?.deliveryDetails || row?.remarks || '');
    const supplyOnly = /(toner|ink|cartridge|drum|waste toner|consumable)/i.test(form?.deliveryDetails || row?.remarks || '');
    return deliveryPurpose && machineWords && !supplyOnly;
}

function updateActionButtons() {
    const closeButton = document.getElementById('fieldModalCloseTask');
    const pendingButton = document.getElementById('fieldModalPendingTask');
    if (!closeButton || !pendingButton) return;

    if (state.modalReadOnly) {
        closeButton.disabled = true;
        pendingButton.disabled = true;
        closeButton.title = '';
        return;
    }

    const row = getCurrentRow();
    if (!row) {
        closeButton.disabled = true;
        pendingButton.disabled = false;
        closeButton.title = '';
        return;
    }

    const form = collectModalFormData();
    const issues = getCloseTaskIssues(row, form);
    closeButton.disabled = false;
    closeButton.title = issues.length ? closeIssueMessage(issues[0]) : '';
    pendingButton.disabled = false;
}

async function upsertSchedtimeLog(row, form, mode = 'draft') {
    const scheduleId = Number(row.id || 0);
    if (!scheduleId) return;
    const staffId = Number(state.staffId || 0) || 0;

    const hasTimeIn = form.timeInDb && form.timeInDb !== ZERO_DATETIME;
    const hasTimeOut = form.timeOutDb && form.timeOutDb !== ZERO_DATETIME;
    const hasNotes = Boolean(form.notes || form.finalSummary);
    if (!hasTimeIn && !hasTimeOut && !hasNotes) return;

    let logId = Number(state.modalSchedtimeId || 0) || 0;
    let logDocId = state.modalSchedtimeDocId || '';

    if (!logDocId || !logId) {
        const existing = await fetchLatestSchedtimeLog(scheduleId);
        if (existing) {
            logId = Number(existing.id || 0) || logId;
            logDocId = existing._docId || String(existing.id || '');
        }
    }

    if (!logId) {
        logId = Date.now();
    }
    if (!logDocId) logDocId = String(logId);

    const payload = {
        id: logId,
        schedule_id: scheduleId,
        tech_id: Number(row.tech_id || state.staffId || 0) || 0,
        schedule_date: String(row.task_datetime || nowDbDateTime()),
        branch_id: Number(row.branch_id || 0) || 0,
        issupplier: 0,
        time_in: hasTimeIn ? form.timeInDb : ZERO_DATETIME,
        time_out: hasTimeOut ? form.timeOutDb : ZERO_DATETIME,
        remarks: clampText(form.notes || form.finalSummary, 255),
        inserted_by: staffId,
        updated_by: staffId,
        customer_remarks: clampText(form.finalSummary, 255),
        override_remarks: mode === 'finish' ? 'field_finish' : mode === 'pending' ? 'field_pending' : 'field_draft',
        explanation: clampText(form.notes, 255),
        ismanual: 1
    };

    await setDocument('tbl_schedtime', logDocId, payload);
    state.modalSchedtimeId = logId;
    state.modalSchedtimeDocId = logDocId;
}

async function safeUpsertSchedtimeLog(row, form, mode = 'draft') {
    try {
        await upsertSchedtimeLog(row, form, mode);
    } catch (error) {
        console.warn('Field schedtime log failed; primary schedule save remains authoritative.', error);
        const nowIso = new Date().toISOString();
        await patchDocument('tbl_schedule', scheduleDocIdForRow(row), {
            field_schedtime_log_status: 'failed',
            field_schedtime_log_error: clampText(error?.message || error, 180),
            field_schedtime_log_failed_at: nowIso
        }).catch((patchError) => {
            console.warn('Unable to annotate schedtime log failure on schedule.', patchError);
        });
    }
}

async function saveDraftUpdate() {
    const row = getCurrentRow();
    if (!row) return;
    const form = collectModalFormData();

    const button = document.getElementById('fieldModalSaveDraft');
    button.disabled = true;
    try {
        const timeInLocationPatch = await ensureCustomerTimeInLocationProof(row, form);
        const payload = {
            ...buildSchedulePayload(row, form, '[FIELD_DRAFT]'),
            ...timeInLocationPatch
        };
        await patchDocument('tbl_schedule', scheduleDocIdForRow(row), payload);
        await safeUpsertSchedtimeLog(row, form, 'draft');
        applyRowPatch(row.id, payload);
        clearFieldModalDraft(row.id);
        renderList();
        alert('Draft update saved.');
    } catch (err) {
        console.error('Save draft failed:', err);
        alert(`Failed to save draft: ${err?.message || err}`);
    } finally {
        button.disabled = false;
    }
}


async function preserveUnfinishedFieldForm(row, form, reasonCode = 'finish_blocked', extraPatch = {}) {
    if (!row || !form) return false;
    flushFieldModalDraftSave();

    const staffId = Number(state.staffId || 0) || 0;
    const nowIso = new Date().toISOString();
    const payload = {
        ...buildSchedulePayload(row, form, '[FIELD_UNFINISHED_DRAFT]'),
        ...extraPatch,
        field_unfinished_draft_saved_at: nowIso,
        field_unfinished_draft_saved_by: staffId,
        field_unfinished_draft_reason: clampText(reasonCode, 80),
        field_last_close_blocked_at: nowIso,
        field_last_close_blocked_by: staffId,
        field_last_close_blocked_reason: clampText(reasonCode, 80)
    };

    try {
        await patchDocument('tbl_schedule', scheduleDocIdForRow(row), payload);
        await safeUpsertSchedtimeLog(row, form, 'draft');
        applyRowPatch(row.id, payload);
        return true;
    } catch (error) {
        console.warn('Unable to preserve unfinished field form on schedule; local draft remains available.', error);
        return false;
    }
}
async function markPendingTask() {
    const row = getCurrentRow();
    if (!row) return;
    const form = collectModalFormData();

    if (form.notes.length < 6) {
        alert('Please add parts-needed/work notes (at least 6 characters).');
        return;
    }

    const staffId = Number(state.staffId || 0) || 0;
    const nowIso = new Date().toISOString();
    const queueDocId = `${row.id}_${Date.now()}`;

    if (!form.timeInLocal) {
        const savedTimeIn = normalizeLegacyDateTime(row.field_time_in);
        if (savedTimeIn) {
            const savedLocal = toLocalInputDateTime(savedTimeIn);
            document.getElementById('fieldTimeIn').value = savedLocal;
            form.timeInLocal = savedLocal;
            form.timeInDb = savedTimeIn;
        } else {
            const nowLocal = toLocalInputDateTime(new Date().toISOString());
            document.getElementById('fieldTimeIn').value = nowLocal;
            form.timeInLocal = nowLocal;
            form.timeInDb = toDbDateTimeFromLocal(nowLocal);
        }
    }

    const button = document.getElementById('fieldModalPendingTask');
    button.disabled = true;
    try {
        const timeInLocationPatch = await ensureCustomerTimeInLocationProof(row, form);
        const payload = {
            ...buildSchedulePayload(row, form, '[PENDING_PARTS]'),
            ...timeInLocationPatch,
            isongoing: 1,
            date_finished: ZERO_DATETIME,
            pending_parts: 1,
            pending_reason: 'parts_needed',
            pending_updated_at: nowIso,
            pending_updated_by: staffId
        };
        const queuePayload = {
            schedule_id: Number(row.id || 0),
            schedule_doc_id: scheduleDocIdForRow(row),
            branch_id: Number(row.branch_id || 0) || 0,
            company_id: Number(row.company_id || 0) || 0,
            machine_id: Number(form.selectedMachineId || row.serial || 0) || 0,
            purpose_id: Number(row.purpose_id || 0) || 0,
            trouble_id: Number(row.trouble_id || 0) || 0,
            requested_by: staffId,
            requested_at: nowIso,
            notes: form.notes,
            status: 'pending',
            source: 'field_app',
            parts_needed_json: jsonString(form.partsNeeded, '[]'),
            final_summary: clampText(form.finalSummary, 255),
            machine_status: TEMPORARILY_DISABLED_FIELD_GROUPS.machineStatus ? '' : clampText(form.machineStatusLabel, 120),
            present_meter: form.presentMeter ?? 0,
            previous_meter: form.previousMeter ?? 0,
            total_consumed: form.totalConsumed ?? 0
        };

        await patchDocument('tbl_schedule', scheduleDocIdForRow(row), payload);
        await safeUpsertSchedtimeLog(row, form, 'pending');
        try {
            await setDocument(PRODUCTION_QUEUE_COLLECTION, queueDocId, queuePayload);
        } catch (queueError) {
            console.warn('Production queue write failed; schedule remains pending for parts.', queueError);
            await patchDocument('tbl_schedule', scheduleDocIdForRow(row), {
                production_queue_write_status: 'failed',
                production_queue_write_error: clampText(queueError?.message || queueError, 180),
                production_queue_write_failed_at: nowIso
            });
        }

        applyRowPatch(row.id, payload);
        closeModal();
        clearFieldModalDraft(row.id);
        await loadMySchedule();
        alert('Marked as Pending (Parts Needed).');
    } catch (err) {
        console.error('Mark pending failed:', err);
        alert(`Failed to mark pending: ${err?.message || err}`);
    } finally {
        button.disabled = false;
    }
}

function routeCollectionForRow(row) {
    const source = String(row?.route_source || '').toLowerCase();
    if (source.includes('printed')) return ROUTE_COLLECTION_PRIMARY;
    if (Number(row?.route_id || 0) > 0 || row?.route_doc_id) return ROUTE_COLLECTION_FALLBACK;
    return '';
}

async function closeTask() {
    const row = getCurrentRow();
    if (!row) return;
    await ensureTypedCollectionInvoiceIsSelected();
    const form = collectModalFormData();
    const closeIssues = getCloseTaskIssues(row, form);
    const expectedPin = String(state.modalExpectedPin || '').trim();
    const pinPattern = /^\d{4}$/;

    if (closeIssues.length) {
        const issue = closeIssues[0];
        revealCloseIssue(issue);
        await preserveUnfinishedFieldForm(row, form, issue?.code || 'finish_validation');
        await logFinishBlockedAttempt(row, issue, form);
        alert(closeIssueMessage(issue));
        return;
    }

    if (!TEMPORARILY_DISABLED_FIELD_GROUPS.customerPin && expectedPin) {
        if (!pinPattern.test(form.pin)) {
            await preserveUnfinishedFieldForm(row, form, 'invalid_customer_pin_format');
            alert('Customer PIN must be exactly 4 digits.');
            return;
        }
        if (form.pin !== expectedPin) {
            await preserveUnfinishedFieldForm(row, form, 'invalid_customer_pin');
            alert('Invalid customer PIN.');
            return;
        }
    }

    if (!form.timeInLocal) {
        const savedTimeIn = normalizeLegacyDateTime(row.field_time_in);
        if (savedTimeIn) {
            const savedLocal = toLocalInputDateTime(savedTimeIn);
            document.getElementById('fieldTimeIn').value = savedLocal;
            form.timeInLocal = savedLocal;
            form.timeInDb = savedTimeIn;
        }
    }

    if (!form.billingDate || !form.billingTime) {
        const stamp = getAutomaticBillingStamp(row);
        if (!form.billingDate) {
            document.getElementById('fieldBillingDate').value = stamp.billingDate;
            form.billingDate = stamp.billingDate;
        }
        if (!form.billingTime) {
            document.getElementById('fieldBillingTime').value = stamp.billingTime;
            form.billingTime = stamp.billingTime;
        }
    }

    const nowIso = new Date().toISOString();
    const staffId = Number(state.staffId || 0) || 0;

    let timeInLocationPatch = {};
    try {
        timeInLocationPatch = await ensureCustomerTimeInLocationProof(row, form);
    } catch (err) {
        await preserveUnfinishedFieldForm(row, form, 'time_in_location_proof_failed');
        alert(`Cannot mark finished: ${err?.message || err}`);
        return;
    }

    let collectionPaymentPatch = {};
    try {
        collectionPaymentPatch = await saveFieldCollectionPaymentRecord(row, form, nowIso, staffId);
    } catch (err) {
        await preserveUnfinishedFieldForm(row, form, 'collection_payment_save_failed');
        alert(`Cannot mark finished: collection payment record could not be saved. ${err?.message || err}`);
        return;
    }

    const payload = {
        ...buildSchedulePayload(row, form, '[FINISHED]'),
        ...collectionPaymentPatch,
        ...timeInLocationPatch,
        date_finished: form.timeOutDb,
        closedby: staffId,
        isongoing: 0,
        pending_parts: 0,
        pending_reason: '',
        pending_updated_at: nowIso,
        pending_updated_by: staffId,
        combined_visit_status: row.combined_visit_id ? 'closed' : (row.combined_visit_status || ''),
        combined_visit_closed_at: row.combined_visit_id ? nowIso : (row.combined_visit_closed_at || ''),
        combined_visit_closed_by: row.combined_visit_id ? staffId : (row.combined_visit_closed_by || 0),
        customer_pin_verified: (!TEMPORARILY_DISABLED_FIELD_GROUPS.customerPin && expectedPin) ? 1 : 0,
        customer_pin_verified_at: (!TEMPORARILY_DISABLED_FIELD_GROUPS.customerPin && expectedPin) ? nowIso : '',
        customer_pin_verified_by: (!TEMPORARILY_DISABLED_FIELD_GROUPS.customerPin && expectedPin) ? staffId : 0
    };

    const button = document.getElementById('fieldModalCloseTask');
    button.disabled = true;
    try {
        await patchDocument('tbl_schedule', scheduleDocIdForRow(row), payload);
        if (row.source_planner_doc_id) {
            try {
                await patchDocument(SCHEDULE_PLANNER_COLLECTION, row.source_planner_doc_id, {
                    planner_status: 'closed',
                    task_status: 'closed',
                    route_status: 'closed',
                    date_finished: form.timeOutDb,
                    closed_at: nowIso,
                    closed_by: staffId,
                    field_closed_schedule_id: Number(row.id || 0) || 0,
                    field_closed_at: nowIso
                });
            } catch (plannerError) {
                console.warn('Planner row close update failed; schedule was closed.', plannerError);
            }
        }
        const routeCollection = routeCollectionForRow(row);
        if (routeCollection && row.route_doc_id) {
            try {
                await patchDocument(routeCollection, row.route_doc_id, {
                    status: 0,
                    date_finished: form.timeOutDb,
                    remarks: form.notes || form.finalSummary || row.route_remarks || row.remarks || '',
                    timestmp: nowIso,
                    bridge_pushed_at: nowIso
                });
            } catch (routeError) {
                console.warn('Route row close update failed; schedule was closed.', routeError);
            }
        }
        await safeUpsertSchedtimeLog(row, form, 'finish');
        applyRowPatch(row.id, {
            ...payload,
            route_status: 0,
            route_date_finished: form.timeOutDb,
            route_timestmp: nowIso,
            route_bridge_pushed_at: nowIso
        });
        const relatedRows = getModalRelatedRows(row)
            .filter((item) => Number(item.id || 0) !== Number(row.id || 0))
            .filter((item) => !isFinishedOrCancelled(item) && getStatusKey(item) !== 'closed' && getStatusKey(item) !== 'cancelled');
        let combinedClosed = 0;
        for (const relatedRow of relatedRows) {
            const relatedPayload = {
                ...buildSchedulePayload(relatedRow, form, '[FINISHED_COMBINED]'),
                ...timeInLocationPatch,
                date_finished: form.timeOutDb,
                closedby: staffId,
                isongoing: 0,
                pending_parts: 0,
                pending_reason: '',
                pending_updated_at: nowIso,
                pending_updated_by: staffId,
                combined_visit_status: relatedRow.combined_visit_id ? 'closed' : (relatedRow.combined_visit_status || ''),
                combined_visit_closed_at: relatedRow.combined_visit_id ? nowIso : (relatedRow.combined_visit_closed_at || ''),
                combined_visit_closed_by: relatedRow.combined_visit_id ? staffId : (relatedRow.combined_visit_closed_by || 0),
                customer_pin_verified: (!TEMPORARILY_DISABLED_FIELD_GROUPS.customerPin && expectedPin) ? 1 : 0,
                customer_pin_verified_at: (!TEMPORARILY_DISABLED_FIELD_GROUPS.customerPin && expectedPin) ? nowIso : '',
                customer_pin_verified_by: (!TEMPORARILY_DISABLED_FIELD_GROUPS.customerPin && expectedPin) ? staffId : 0
            };
            await closeCombinedScheduleRow(relatedRow, relatedPayload, form, nowIso, staffId);
            combinedClosed += 1;
        }
        closeModal();
        clearFieldModalDraft(row.id);
        await loadMySchedule();
        alert(combinedClosed ? `Task marked as Finished. ${combinedClosed} combined schedule${combinedClosed === 1 ? '' : 's'} also closed.` : 'Task marked as Finished.');
    } catch (err) {
        console.error('Close task failed:', err);
        await preserveUnfinishedFieldForm(row, form, 'schedule_close_save_failed', collectionPaymentPatch);
        alert(`Failed to close task: ${err?.message || err}`);
    } finally {
        button.disabled = false;
    }
}

async function reopenTask() {
    const row = getCurrentRow();
    if (!row) return;
    const button = document.getElementById('fieldModalReopenTask');
    try {
        await reopenScheduleRow(row, button, collectModalFormData());
        closeModal();
    } catch (err) {
        console.error('Reopen task failed:', err);
        alert(`Failed to reopen task: ${err?.message || err}`);
    }
}

function buildReopenPayload(row, form = null) {
    const nowIso = new Date().toISOString();
    const staffId = Number(state.staffId || 0) || 0;
    return {
        field_work_notes: '',
        field_final_summary: '',
        field_delivery_details: '',
        field_empty_pickup_details: '',
        field_customer_signer: '',
        field_customer_contact: '',
        field_billing_received_by: '',
        field_billing_date: '',
        field_billing_time: '',
        field_collection_receipt_refs: '',
        field_collection_invoice_refs: '',
        field_collection_invoices_json: '[]',
        field_collection_invoice_total: 0,
        field_collection_check_number: '',
        field_collection_check_bank: '',
        field_collection_check_date: ZERO_DATETIME,
        field_collection_check_amount: '',
        field_collection_payment_amount: '',
        field_collection_payment_date: ZERO_DATETIME,
        field_collection_deposit_date: ZERO_DATETIME,
        field_collection_or_number: '',
        field_collection_payment_type: '',
        field_collection_payment_status: '',
        field_collection_deduction_type: '',
        field_collection_deduction_amount: '',
        field_collection_2307_status: '',
        field_collection_payment_remarks: '',
        field_previous_meter: 0,
        field_present_meter: 0,
        field_total_consumed: 0,
        field_maintenance_previous_meter: 0,
        field_maintenance_present_meter: 0,
        field_maintenance_total_consumed: 0,
        field_delivery_previous_meter: 0,
        field_delivery_present_meter: 0,
        field_delivery_total_consumed: 0,
        field_work_machine_status_id: 0,
        field_work_machine_status: '',
        date_finished: ZERO_DATETIME,
        field_time_in: ZERO_DATETIME,
        field_time_out: ZERO_DATETIME,
        field_parts_needed_json: '[]',
        field_before_photo_name: '',
        field_before_photo_size: 0,
        field_before_photo_type: '',
        field_after_photo_name: '',
        field_after_photo_size: 0,
        field_after_photo_type: '',
        field_collection_voucher_name: '',
        field_collection_voucher_size: 0,
        field_collection_voucher_type: '',
        field_collection_check_name: '',
        field_collection_check_size: 0,
        field_collection_check_type: '',
        field_customer_location_pinned: 0,
        field_customer_location_pinned_at: '',
        field_customer_location_pinned_by: 0,
        field_customer_location_latitude: '',
        field_customer_location_longitude: '',
        field_customer_location_accuracy_meters: 0,
        field_customer_location_photo_url: '',
        field_customer_location_photo_path: '',
        field_customer_location_photo_doc_id: '',
        field_customer_location_photo_storage_mode: '',
        field_customer_location_photo_data_url: '',
        field_customer_location_branch_update_status: '',
        field_customer_location_branch_update_error: '',
        field_tracking_status: '',
        field_last_action: '',
        field_last_update_at: '',
        field_last_latitude: '',
        field_last_longitude: '',
        closedby: 0,
        isongoing: 0,
        pending_parts: 0,
        pending_reason: '',
        pending_updated_at: nowIso,
        pending_updated_by: staffId,
        customer_pin_verified: 0,
        customer_pin_verified_at: '',
        customer_pin_verified_by: 0,
        meter_reading: 0,
        customer_request: '',
        collocutor: '',
        phone_number: '',
        dev_remarks: appendDevRemarks('', '[REOPENED]', 'Reset field visit outputs for retest.'),
        field_updated_by: staffId,
        field_updated_at: nowIso,
        bridge_updated_by: staffId,
        bridge_updated_at: nowIso
    };
}

async function reopenScheduleRow(row, button = null, form = null) {
    if (!row) return;
    const nowIso = new Date().toISOString();
    const payload = buildReopenPayload(row, form);
    if (button) button.disabled = true;
    try {
        await patchDocument('tbl_schedule', scheduleDocIdForRow(row), payload);
        const routeCollection = routeCollectionForRow(row);
        if (routeCollection && row.route_doc_id) {
            try {
                await patchDocument(routeCollection, row.route_doc_id, {
                    status: 1,
                    date_finished: ZERO_DATETIME,
                    remarks: row.remarks || '',
                    timestmp: nowIso,
                    bridge_pushed_at: nowIso
                });
            } catch (routeError) {
                console.warn('Route row reopen update failed; schedule was reopened.', routeError);
            }
        }
        if (row.source_planner_doc_id) {
            try {
                await patchDocument(SCHEDULE_PLANNER_COLLECTION, row.source_planner_doc_id, {
                    planner_status: 'open',
                    task_status: 'open',
                    route_status: 'open',
                    date_finished: ZERO_DATETIME,
                    reopened_at: nowIso,
                    reopened_by: Number(state.staffId || 0) || 0
                });
            } catch (plannerError) {
                console.warn('Planner row reopen update failed; schedule was reopened.', plannerError);
            }
        }
        applyRowPatch(row.id, {
            ...payload,
            route_status: 1,
            route_date_finished: ZERO_DATETIME,
            route_remarks: row.remarks || '',
            route_timestmp: nowIso,
            route_bridge_pushed_at: nowIso
        });
        await loadMySchedule({ keepTab: true });
        alert('Task reopened.');
    } finally {
        if (button) button.disabled = false;
    }
}

async function saveSerialMapping() {
    if (TEMPORARILY_DISABLED_FIELD_GROUPS.serialMapping || TEMPORARILY_DISABLED_FIELD_GROUPS.missingSerial) {
        alert('Serial mapping is temporarily disabled.');
        return;
    }
    const row = getCurrentRow();
    if (!row) return;

    const missingMode = document.getElementById('fieldSerialMissingCheck').checked;
    const serialInputValue = String(document.getElementById('fieldSerialInput').value || '').trim();
    const serialHint = document.getElementById('fieldSerialHint');
    const staffId = Number(state.staffId || 0) || 0;
    const nowIso = new Date().toISOString();

    serialHint.textContent = 'Saving...';
    try {
        if (missingMode) {
            const missingSerial = String(document.getElementById('fieldMissingSerialInput').value || '').trim().toUpperCase();
            if (missingSerial.length < 4) {
                alert('Enter missing serial number (at least 4 characters).');
                return;
            }

            const machine = getSelectedMachine();
            const correctionId = `${row.id}_${Date.now()}`;
            await setDocument(SERIAL_CORRECTION_COLLECTION, correctionId, {
                schedule_id: Number(row.id || 0),
                branch_id: Number(row.branch_id || 0) || 0,
                company_id: Number(row.company_id || 0) || 0,
                current_machine_id: Number(machine?.id || row.serial || 0) || 0,
                current_serial: String(machine?.serial || '').trim(),
                requested_serial: missingSerial,
                status: 'pending_admin_approval',
                requested_by: staffId,
                requested_at: nowIso,
                notes: clampText(document.getElementById('fieldCloseNotes').value || '', 255),
                source: 'field_app'
            });

            const patch = {
                serial_correction_pending: 1,
                serial_correction_value: missingSerial,
                serial_correction_requested_at: nowIso,
                serial_correction_requested_by: staffId,
                field_serial_missing: 1,
                field_serial_missing_value: missingSerial,
                bridge_updated_by: staffId,
                bridge_updated_at: nowIso
            };
            await patchDocument('tbl_schedule', scheduleDocIdForRow(row), patch);
            applyRowPatch(row.id, patch);
            serialHint.textContent = 'Submitted for admin approval.';
            alert('Missing serial submitted for admin approval.');
            return;
        }

        const selectedMachine = resolveMachineFromSerial(serialInputValue);
        if (!selectedMachine || Number(selectedMachine.id || 0) <= 0) {
            alert('Select an official serial from database list.');
            return;
        }

        const patch = {
            serial: Number(selectedMachine.id || 0),
            serial_correction_pending: 0,
            serial_correction_value: '',
            field_serial_selected: String(selectedMachine.serial || ''),
            field_serial_selected_machine_id: Number(selectedMachine.id || 0),
            field_serial_missing: 0,
            field_serial_missing_value: '',
            field_updated_by: staffId,
            field_updated_at: nowIso,
            bridge_updated_by: staffId,
            bridge_updated_at: nowIso
        };

        await patchDocument('tbl_schedule', scheduleDocIdForRow(row), patch);
        applyRowPatch(row.id, patch);
        await setModalMachineDetails(selectedMachine);

        const prev = await resolvePreviousMeter(
            {
                ...row,
                serial: Number(selectedMachine.id || 0),
                mach_id: Number(selectedMachine.id || 0),
                machine_id: Number(selectedMachine.id || 0)
            },
            Number(row.id || 0),
            row.task_datetime,
            Number(selectedMachine.bmeter || 0),
            selectedMachine
        );
        document.getElementById('fieldPreviousMeter').value = Number(prev?.meter || 0) > 0 ? String(prev.meter) : '';
        document.getElementById('fieldPreviousMeterHint').textContent = Number(prev?.meter || 0) > 0
            ? 'Loaded from billing meter history for selected serial.'
            : 'No billing meter history found for selected serial yet.';
        recomputeTotalConsumed();
        renderList();
        serialHint.textContent = 'Serial mapping saved.';
        alert('Serial mapping saved.');
    } catch (err) {
        console.error('Save serial mapping failed:', err);
        serialHint.textContent = `Error: ${err?.message || err}`;
        alert(`Failed to save serial mapping: ${err?.message || err}`);
    }
}

async function pinCustomerLocation() {
    if (state.modalReadOnly) return;
    const row = getCurrentRow();
    if (!row) return;

    const branchId = Number(row.branch_id || state.modalBranchId || 0);
    if (!branchId) {
        alert('This schedule has no branch ID to pin.');
        return;
    }

    const { branch, branchLocationSaved } = getBranchLocationStatus(row);
    const previousCoords = getBranchCoordinates(branch);
    const actionLabel = branchLocationSaved ? 'repin' : 'pin';

    const button = document.getElementById('fieldPinLocationBtn');
    const status = document.getElementById('fieldLocationPinStatus');
    const locationPhoto = document.getElementById('fieldLocationPhoto')?.files?.[0] || null;
    const staffId = Number(state.staffId || 0) || 0;
    const now = new Date();
    const nowIso = now.toISOString();

    if (!locationPhoto) {
        alert(`Take or select a new frontage/building photo before ${actionLabel}ning this customer location.`);
        return;
    }

    if (branchLocationSaved) {
        const label = scheduleLocationLabel(row).label;
        const previousText = previousCoords
            ? `${previousCoords.latitude.toFixed(7)}, ${previousCoords.longitude.toFixed(7)}`
            : 'saved location';
        const confirmed = window.confirm(`Repin ${label}?\n\nThis will replace the saved customer location pin (${previousText}) with this phone's current GPS location. Continue only if the staff is physically at the customer site.`);
        if (!confirmed) return;
    }

    button.disabled = true;
    if (status) status.textContent = `Preparing frontage photo and getting GPS location for customer ${actionLabel}...`;

    try {
        const [position, photoUpload] = await Promise.all([
            getCurrentPosition(),
            prepareLocationPhotoUpload(locationPhoto, { branchId, scheduleId: row.id, now })
        ]);
        const latitude = Number(position.coords.latitude);
        const longitude = Number(position.coords.longitude);
        const accuracy = Number(position.coords.accuracy || 0);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            throw new Error('GPS returned an invalid location.');
        }

        const latitudeText = latitude.toFixed(7);
        const longitudeText = longitude.toFixed(7);
        const eventAction = branchLocationSaved ? 'customer_location_repinned' : 'customer_location_pinned';
        const eventId = `${row.id}_${branchLocationSaved ? 'repin' : 'pin'}_${Date.now()}`;
        const branchPatch = {
            latitude: latitudeText,
            longitude: longitudeText,
            previous_latitude: previousCoords ? previousCoords.latitude.toFixed(7) : '',
            previous_longitude: previousCoords ? previousCoords.longitude.toFixed(7) : '',
            location_pin_repin_count: Number(branch?.location_pin_repin_count || 0) + (branchLocationSaved ? 1 : 0),
            location_pin_updated_at: nowIso,
            location_pin_updated_by: staffId,
            location_pin_accuracy_meters: Math.round(accuracy),
            location_pin_source: branchLocationSaved ? 'field_app_repin' : 'field_app',
            location_frontage_photo_url: photoUpload.url || '',
            location_frontage_photo_path: photoUpload.path || '',
            location_frontage_photo_doc_id: photoUpload.dataUrl ? eventId : '',
            location_frontage_photo_size: photoUpload.size,
            location_frontage_photo_type: photoUpload.type,
            location_frontage_photo_storage_mode: photoUpload.storageMode,
            location_frontage_photo_updated_at: nowIso,
            location_frontage_photo_updated_by: staffId
        };
        const schedulePatch = {
            field_customer_location_pinned: 1,
            field_customer_location_pinned_at: nowIso,
            field_customer_location_pinned_by: staffId,
            field_customer_location_latitude: latitudeText,
            field_customer_location_longitude: longitudeText,
            field_customer_location_accuracy_meters: Math.round(accuracy),
            field_customer_location_photo_url: photoUpload.url || '',
            field_customer_location_photo_path: photoUpload.path || '',
            field_customer_location_photo_doc_id: photoUpload.dataUrl ? eventId : '',
            field_customer_location_photo_storage_mode: photoUpload.storageMode,
            field_customer_location_repin: branchLocationSaved ? 1 : 0,
            field_customer_location_previous_latitude: previousCoords ? previousCoords.latitude.toFixed(7) : '',
            field_customer_location_previous_longitude: previousCoords ? previousCoords.longitude.toFixed(7) : '',
            field_tracking_status: eventAction,
            field_last_action: eventAction,
            field_last_update_at: nowIso,
            field_last_latitude: latitudeText,
            field_last_longitude: longitudeText,
            field_updated_at: nowIso,
            field_updated_by: staffId,
            bridge_updated_at: nowIso,
            bridge_updated_by: staffId
        };
        const eventPayload = {
            id: eventId,
            schedule_id: Number(row.id || 0) || 0,
            staff_id: staffId,
            branch_id: branchId,
            company_id: Number(row.company_id || 0) || 0,
            action: eventAction,
            status_label: branchLocationSaved ? 'Customer Location Repinned' : 'Customer Location Pinned',
            occurred_at: nowIso,
            local_date: localDateYmd(now),
            local_time: now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
            latitude: latitudeText,
            longitude: longitudeText,
            previous_latitude: previousCoords ? previousCoords.latitude.toFixed(7) : '',
            previous_longitude: previousCoords ? previousCoords.longitude.toFixed(7) : '',
            accuracy_meters: Math.round(accuracy),
            frontage_photo_url: photoUpload.url || '',
            frontage_photo_path: photoUpload.path || '',
            frontage_photo_doc_id: photoUpload.dataUrl ? eventId : '',
            frontage_photo_storage_mode: photoUpload.storageMode,
            source: 'field_app'
        };

        if (photoUpload.dataUrl) {
            try {
                await setDocument(LOCATION_PHOTO_COLLECTION, eventId, {
                    id: eventId,
                    schedule_id: Number(row.id || 0) || 0,
                    staff_id: staffId,
                    branch_id: branchId,
                    company_id: Number(row.company_id || 0) || 0,
                    created_at: nowIso,
                    image_data_url: photoUpload.dataUrl,
                    image_size: photoUpload.size,
                    image_type: photoUpload.type,
                    source: 'field_app'
                });
            } catch (photoDocError) {
                console.warn('Location frontage fallback photo document failed; continuing with schedule proof.', photoDocError);
                schedulePatch.field_customer_location_photo_data_url = photoUpload.dataUrl;
                branchPatch.location_frontage_photo_doc_id = '';
                schedulePatch.field_customer_location_photo_doc_id = '';
                eventPayload.frontage_photo_doc_id = '';
            }
        }

        await patchDocument('tbl_schedule', scheduleDocIdForRow(row), schedulePatch);
        try {
            await patchDocument('tbl_branchinfo', branchId, branchPatch);
        } catch (branchError) {
            console.warn('Branch master location update failed; schedule proof was saved.', branchError);
            schedulePatch.field_customer_location_branch_update_status = 'pending_admin_sync';
            schedulePatch.field_customer_location_branch_update_error = clampText(branchError?.message || branchError, 180);
            await patchDocument('tbl_schedule', scheduleDocIdForRow(row), {
                field_customer_location_branch_update_status: schedulePatch.field_customer_location_branch_update_status,
                field_customer_location_branch_update_error: schedulePatch.field_customer_location_branch_update_error
            });
        }
        try {
            await setDocument(FIELD_VISIT_EVENT_COLLECTION, eventId, eventPayload);
        } catch (eventError) {
            console.warn('Field visit event write failed; schedule proof was saved.', eventError);
        }

        const cachedBranch = caches.branch.get(String(branchId)) || {};
        Object.assign(cachedBranch, branchPatch);
        caches.branch.set(String(branchId), cachedBranch);
        state.modalBranchLocationPinned = true;
        applyRowPatch(row.id, schedulePatch);
        setLocationPinUi(row);
        updateActionButtons();
        renderAttendanceLocationSummary();
        renderList();
        await checkAttendanceLocation().catch((checkError) => {
            console.warn('Location recheck after pin failed:', checkError);
        });
        alert(branchLocationSaved ? 'Customer location repinned and location check refreshed.' : 'Customer location pinned and location check refreshed.');
    } catch (err) {
        console.error('Customer location pin failed:', err);
        if (status) status.textContent = 'Unable to pin location. Check GPS permission and try again.';
        alert(`Failed to pin customer location: ${err?.message || err}`);
        button.disabled = false;
    }
}

async function markTimeInNow() {
    if (state.modalReadOnly) return;
    const row = getCurrentRow();
    if (!row) return;

    const nowLocal = toLocalInputDateTime(new Date().toISOString());
    document.getElementById('fieldTimeIn').value = nowLocal;
    queueFieldModalDraftSave();

    const form = collectModalFormData();
    const nowIso = new Date().toISOString();
    const patch = {
        field_time_in: form.timeInDb,
        field_updated_at: nowIso,
        field_updated_by: Number(state.staffId || 0) || 0,
        bridge_updated_by: Number(state.staffId || 0) || 0,
        bridge_updated_at: nowIso
    };

    const button = document.getElementById('fieldTimeInNowBtn');
    button.disabled = true;
    try {
        const timeInLocationPatch = buildManualCustomerTimePatch(row, nowIso);
        const verifiedPatch = {
            ...patch,
            ...timeInLocationPatch
        };
        await patchDocument('tbl_schedule', scheduleDocIdForRow(row), verifiedPatch);
        await safeUpsertSchedtimeLog(row, form, 'draft');
        applyRowPatch(row.id, verifiedPatch);
        alert('Time in captured.');
    } catch (err) {
        console.error('Time in failed:', err);
        alert(`Failed to capture time in: ${err?.message || err}`);
        document.getElementById('fieldTimeIn').value = toLocalInputDateTime(normalizeLegacyDateTime(row.field_time_in));
    } finally {
        button.disabled = false;
    }
}

function locationRequestDocId(staffId, date) {
    return `${Number(staffId || 0) || 0}_${String(date || '').replace(/[^0-9]/g, '')}`;
}

function startLocationRequestPoll() {
    if (state.locationRequestPollTimer) return;
    state.locationRequestPollTimer = window.setInterval(() => {
        if (document.hidden) return;
        handlePendingLocationRefreshRequest().catch((error) => {
            console.warn('Location refresh request check failed:', error);
        });
    }, 60000);
}

function nearestWorkloadRowForLocation(latitude, longitude) {
    let best = null;
    workloadRows().forEach((row) => {
        const branch = caches.branch.get(String(row.branch_id || 0));
        const coords = branchCoordinates(branch);
        if (!coords) return;
        const distance = distanceMeters(latitude, longitude, coords.latitude, coords.longitude);
        if (!best || distance < best.distance) {
            best = { row, branch, distance };
        }
    });
    return best;
}

async function handlePendingLocationRefreshRequest() {
    const staffId = Number(state.staffId || 0) || 0;
    const date = document.getElementById('fieldDate')?.value || localDateYmd();
    if (!staffId || !date) return;

    const docId = locationRequestDocId(staffId, date);
    const request = await fetchDoc(FIELD_LOCATION_REQUEST_COLLECTION, docId).catch(() => null);
    if (!request || String(request.status || 'pending').toLowerCase() !== 'pending') return;

    const requestedAt = String(request.requested_at || '');
    if (!requestedAt) return;
    const requestToken = `${docId}:${requestedAt}`;
    if (state.handledLocationRequestIds.has(requestToken)) return;
    state.handledLocationRequestIds.add(requestToken);

    const now = new Date();
    const nowIso = now.toISOString();
    try {
        const position = await requestCurrentLocation();
        const latitude = Number(position.coords.latitude);
        const longitude = Number(position.coords.longitude);
        const accuracy = Number(position.coords.accuracy || 0);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            throw new Error('GPS returned an invalid location.');
        }
        const nearest = nearestWorkloadRowForLocation(latitude, longitude);
        const row = nearest?.row || null;
        const branch = nearest?.branch || null;
        const eventId = `${staffId}_${Date.now()}_service_refresh`;
        const company = row ? caches.company.get(String(row.company_id || branch?.company_id || 0)) : null;
        await setDocument(FIELD_VISIT_EVENT_COLLECTION, eventId, {
            id: eventId,
            schedule_id: Number(row?.id || 0) || 0,
            staff_id: staffId,
            branch_id: Number(row?.branch_id || 0) || 0,
            company_id: Number(row?.company_id || branch?.company_id || 0) || 0,
            action: 'service_progress_location_refresh',
            status_label: 'Location Refresh',
            occurred_at: nowIso,
            local_date: localDateYmd(now),
            local_time: now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
            latitude: latitude.toFixed(7),
            longitude: longitude.toFixed(7),
            accuracy_meters: Math.round(accuracy),
            nearest_schedule_id: Number(row?.id || 0) || 0,
            nearest_distance_meters: nearest ? Math.round(nearest.distance) : 0,
            company_name: company?.companyname || row?.company_name || '',
            branch_name: branch?.branchname || row?.branch_name || '',
            source: 'field_app_service_progress_refresh'
        });
        await patchDocument(FIELD_LOCATION_REQUEST_COLLECTION, docId, {
            status: 'completed',
            responded_at: nowIso,
            response_event_id: eventId,
            latitude: latitude.toFixed(7),
            longitude: longitude.toFixed(7),
            accuracy_meters: Math.round(accuracy)
        });
    } catch (error) {
        await patchDocument(FIELD_LOCATION_REQUEST_COLLECTION, docId, {
            status: 'failed',
            responded_at: nowIso,
            error: clampText(error?.message || error, 180)
        }).catch(() => null);
    }
}

async function resolveDeliveryInfo(branchId) {
    const cacheKey = String(branchId || 0);
    if (caches.deliveryInfoByBranch.has(cacheKey)) {
        return caches.deliveryInfoByBranch.get(cacheKey);
    }

    if (!branchId) {
        caches.deliveryInfoByBranch.set(cacheKey, null);
        return null;
    }

    try {
        const docs = await queryEquals('tbl_deliveryinfo', 'branch_id', Number(branchId), 'integer', 10);
        const rows = docs.map(parseFirestoreDoc).filter(Boolean);
        rows.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
        const result = rows[0] || null;
        caches.deliveryInfoByBranch.set(cacheKey, result);
        return result;
    } catch (err) {
        console.warn('Delivery info lookup failed:', err);
        caches.deliveryInfoByBranch.set(cacheKey, null);
        return null;
    }
}

async function resolveDeliveryReceipt(scheduleId) {
    const cacheKey = String(scheduleId || 0);
    if (caches.deliveryReceiptBySchedule.has(cacheKey)) {
        return caches.deliveryReceiptBySchedule.get(cacheKey);
    }

    if (!scheduleId) {
        caches.deliveryReceiptBySchedule.set(cacheKey, null);
        return null;
    }

    try {
        const docs = await queryEquals('tbl_finaldr', 'reference_id', Number(scheduleId), 'integer', 20);
        const rows = docs.map(parseFirestoreDoc).filter(Boolean);
        rows.sort((a, b) => {
            const left = normalizeInlineText(b.tmstmp || b.timestmp || '');
            const right = normalizeInlineText(a.tmstmp || a.timestmp || '');
            if (left !== right) return left.localeCompare(right);
            return Number(b.id || 0) - Number(a.id || 0);
        });
        const result = rows[0] || null;
        caches.deliveryReceiptBySchedule.set(cacheKey, result);
        return result;
    } catch (err) {
        console.warn('Delivery receipt lookup failed:', err);
        caches.deliveryReceiptBySchedule.set(cacheKey, null);
        return null;
    }
}

async function resolveDeliveryReceiptItems(scheduleId, receipt) {
    const cacheKey = `${Number(scheduleId || 0)}:${Number(receipt?.id || 0)}`;
    if (caches.deliveryReceiptItemsBySchedule.has(cacheKey)) {
        return caches.deliveryReceiptItemsBySchedule.get(cacheKey);
    }

    if (!scheduleId) {
        caches.deliveryReceiptItemsBySchedule.set(cacheKey, []);
        return [];
    }

    try {
        let rows = [];

        if (Number(receipt?.id || 0) > 0) {
            const detailDocs = await queryEquals(
                'tbl_finaldrdetails',
                'finaldr_id',
                Number(receipt.id),
                'integer',
                DELIVERY_RECEIPT_LINE_LIMIT
            );
            const detailRows = detailDocs.map(parseFirestoreDoc).filter(Boolean);
            const newdrMap = await fetchDocsByIdList(
                'tbl_newdr',
                detailRows.map((detail) => Number(detail.newdr_id || 0))
            );
            const newfordrMap = await fetchDocsByIdList(
                'tbl_newfordr',
                [...new Set(
                    detailRows
                        .map((detail) => newdrMap.get(String(detail.newdr_id || '')))
                        .filter(Boolean)
                        .map((linked) => Number(linked.newfordr_id || 0))
                )]
            );

            rows = detailRows
                .map((detail) => newdrMap.get(String(detail.newdr_id || '')))
                .filter(Boolean)
                .map((linked) => newfordrMap.get(String(linked.newfordr_id || '')))
                .filter(Boolean);
        }

        if (!rows.length) {
            const docs = await queryEquals(
                'tbl_newfordr',
                'reference_id',
                Number(scheduleId),
                'integer',
                DELIVERY_RECEIPT_LINE_LIMIT
            );
            rows = docs.map(parseFirestoreDoc).filter(Boolean);
        }

        rows.sort((a, b) => {
            const left = normalizeInlineText(a.tmestmp || a.timestmp || '');
            const right = normalizeInlineText(b.tmestmp || b.timestmp || '');
            if (left !== right) return left.localeCompare(right);
            return Number(a.id || 0) - Number(b.id || 0);
        });

        caches.deliveryReceiptItemsBySchedule.set(cacheKey, rows);
        return rows;
    } catch (err) {
        console.warn('Delivery receipt item lookup failed:', err);
        caches.deliveryReceiptItemsBySchedule.set(cacheKey, []);
        return [];
    }
}

function formatReceiptDate(value) {
    const safeValue = normalizeLegacyDateTime(value);
    if (!safeValue) return '';
    const normalized = String(safeValue).replace(' ', 'T');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return safeValue;
    return parsed.toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: '2-digit'
    });
}

function formatPesoAmount(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return '';
    return new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
}

function getReceiptLineAmount(item) {
    const candidates = [
        item?.amount,
        item?.totalamount,
        item?.total_amount,
        item?.price,
        item?.cost
    ];
    for (const value of candidates) {
        const numeric = Number(value || 0);
        if (Number.isFinite(numeric) && numeric > 0) return numeric;
    }
    return 0;
}

function getReceiptLineDescription(item) {
    const description = normalizeInlineText(item?.description);
    const remarks = normalizeInlineText(item?.remarks);
    if (description && remarks && description.toUpperCase() !== remarks.toUpperCase()) {
        return `${description} - ${remarks}`;
    }
    return description || remarks;
}

function buildDeliveryDetailsDefault(row, receipt, deliveryInfo, receiptItems = []) {
    const lines = [];
    const drNumber = normalizeInlineText(receipt?.dr_number);
    const receiptDate = formatReceiptDate(receipt?.date_received) || formatReceiptDate(receipt?.tmstmp);
    const deliveryRemark = normalizeInlineText(row?.remarks);
    const deliveryAddress = normalizeInlineText(deliveryInfo?.tdelivery_add || deliveryInfo?.mdelivery_add);

    if (drNumber) lines.push(`DR #${drNumber}`);
    if (receiptDate) lines.push(`Date: ${receiptDate}`);
    if (receiptItems.length) {
        receiptItems.forEach((item, index) => {
            const description = getReceiptLineDescription(item);
            if (!description) return;
            const qty = Math.max(1, Number(item.qty || 0) || 1);
            const amount = formatPesoAmount(getReceiptLineAmount(item));
            lines.push(`${index + 1}. Qty ${qty} - ${description}${amount ? ` - ${amount}` : ''}`);
        });
    }
    if (deliveryRemark) lines.push(deliveryRemark);
    if (deliveryAddress) lines.push(`Deliver to: ${deliveryAddress}`);

    return lines.join('\n').trim();
}

function buildEmptyPickupDefault(receipt) {
    const returnStatus = normalizeInlineText(receipt?.cartridge_return_status);
    return returnStatus ? `Return status: ${returnStatus}` : '';
}

async function markTimeOutNow() {
    if (state.modalReadOnly) return;
    const row = getCurrentRow();
    if (!row) return;

    const currentTimeIn = normalizeLegacyDateTime(row.field_time_in);
    if (!currentTimeIn) {
        alert('Please Check In Now for this customer task before checking out.');
        return;
    }

    const nowLocal = toLocalInputDateTime(new Date().toISOString());
    document.getElementById('fieldTimeOut').value = nowLocal;
    queueFieldModalDraftSave();

    const form = collectModalFormData();
    const patch = {
        field_time_out: form.timeOutDb,
        field_updated_at: new Date().toISOString(),
        field_updated_by: Number(state.staffId || 0) || 0,
        bridge_updated_by: Number(state.staffId || 0) || 0,
        bridge_updated_at: new Date().toISOString()
    };

    const button = document.getElementById('fieldTimeOutNowBtn');
    button.disabled = true;
    try {
        await patchDocument('tbl_schedule', scheduleDocIdForRow(row), patch);
        await safeUpsertSchedtimeLog(row, form, 'draft');
        applyRowPatch(row.id, patch);
        alert('Time out captured.');
    } catch (err) {
        console.error('Time out failed:', err);
        alert(`Failed to capture time out: ${err?.message || err}`);
    } finally {
        button.disabled = false;
    }
}
