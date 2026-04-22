/**
 * MARGA Customer Information Workbench
 * VB.NET parity screen for company, branch/departments, billing contacts,
 * and machine/contracts maintenance.
 */

const CustomersApp = (() => {
    const state = {
        raw: {
            companies: [],
            branches: [],
            contracts: [],
            contractDeps: [],
            machines: [],
            models: [],
            brands: [],
            areas: [],
            cities: [],
            billInfo: [],
            deliveryInfo: [],
            collectionInfo: [],
            particulars: [],
            nature: [],
            industries: [],
            employees: []
        },
        maps: {},
        selectedCompanyId: '',
        selectedBranchId: '',
        selectedContractId: '',
        selectedMachineId: '',
        newBranchMode: false
    };

    const CONTRACT_STATUS = {
        0: 'Pending',
        1: 'Active',
        2: 'Terminated',
        3: 'On Hold',
        4: 'Pulled Out',
        7: 'Ended',
        8: 'Replaced',
        9: 'Transferred',
        10: 'For Pullout',
        13: 'Cancelled'
    };

    const FALLBACK_PARTICULARS = [
        { id: 1, code: 'RTP', name: 'Rental', with_reading: 1 },
        { id: 2, code: 'RTF', name: 'Fixed Rate', with_reading: 0 },
        { id: 3, code: 'STP', name: 'Short Term', with_reading: 1 },
        { id: 8, code: 'MAP', name: 'Metered Account Plan', with_reading: 1 },
        { id: 10, code: 'RD', name: 'Refundable Deposit', with_reading: 0 },
        { id: 11, code: 'PI', name: 'Production Installation Charge', with_reading: 0 },
        { id: 12, code: 'OTH', name: 'Others', with_reading: 0 }
    ];

    const COMPANY_INTEGER_FIELDS = new Set(['id', 'company_nob', 'industry', 'hide', 'usecomname', 'has_code']);
    const BRANCH_INTEGER_FIELDS = new Set(['id', 'company_id', 'area_id', 'city_id', 'inactive', 'intrvl', 'volume', 'isurgent', 'address_type', 'earliest', 'no_netcon_spoilage']);
    const BILL_INTEGER_FIELDS = new Set(['id', 'branch_id', 'area_id', 'city_id', 'enduserarea_id', 'col_area_id']);
    const DELIVERY_INTEGER_FIELDS = new Set(['id', 'branch_id', 'area_id', 'city_id']);
    const COLLECTION_INTEGER_FIELDS = new Set(['id', 'branch_id', 'area_id', 'city_id']);
    const MACHINE_INTEGER_FIELDS = new Set(['id', 'brand_id', 'model_id', 'status_id', 'client_id', 'bmeter', 'ownership_id', 'type_id', 'condition_id', 'isclient']);
    const CONTRACT_INTEGER_FIELDS = new Set([
        'id',
        'contract_id',
        'mach_id',
        'machine_id',
        'brand_id',
        'category_id',
        'status',
        'withvat',
        'terms',
        'monthly_quota',
        'monthly_quota2',
        'pi',
        'rd',
        'ap',
        'preterm',
        'computers_installed',
        'wifi',
        'usb',
        'scan_to_folder',
        'scan_to_email',
        'standalone',
        'os_windows',
        'os_mac',
        'no_dr_yet',
        'readingdate_set',
        'agent_id',
        'starting_meter',
        'updated',
        'contract_upgraded',
        'without_pird'
    ]);
    const CONTRACT_DOUBLE_FIELDS = new Set(['page_rate', 'page_rate2', 'page_rate_xtra', 'page_rate_xtra2', 'monthly_rate', 'monthly_rate2', 'fixed_rate', 'commision_rate']);

    function init() {
        bindStaticEvents();
        loadAllData();
    }

    async function loadAllData() {
        setStatus('Loading customer records...');
        try {
            const [
                companies,
                branches,
                contracts,
                contractDeps,
                machines,
                models,
                brands,
                areas,
                cities,
                billInfo,
                deliveryInfo,
                collectionInfo,
                particulars,
                nature,
                industries,
                employees
            ] = await Promise.all([
                fetchCollectionFast('tbl_companylist'),
                fetchCollectionFast('tbl_branchinfo'),
                fetchCollectionFast('tbl_contractmain'),
                fetchCollectionFast('tbl_contractdep'),
                fetchCollectionFast('tbl_machine'),
                fetchCollectionFast('tbl_model'),
                fetchCollectionFast('tbl_brand'),
                fetchCollectionFast('tbl_area'),
                fetchCollectionFast('tbl_city'),
                fetchCollectionFast('tbl_billinfo'),
                fetchOptionalCollection('tbl_deliveryinfo', []),
                fetchOptionalCollection('tbl_collectioninfo', []),
                fetchOptionalCollection('tbl_particulars', FALLBACK_PARTICULARS),
                fetchOptionalCollection('tbl_nature', []),
                fetchOptionalCollection('tbl_industry', []),
                fetchOptionalCollection('tbl_employee', [])
            ]);

            state.raw = {
                companies,
                branches,
                contracts,
                contractDeps,
                machines,
                models,
                brands,
                areas,
                cities,
                billInfo,
                deliveryInfo,
                collectionInfo,
                particulars: normalizeParticulars(particulars),
                nature,
                industries,
                employees
            };
            buildMaps();
            renderReferenceLists();
            renderStats();
            selectInitialCompany();
            setStatus('Ready');
        } catch (error) {
            console.error('Customers load failed:', error);
            setStatus('Unable to load customers');
            MargaUtils.showToast(`Failed to load customer data: ${error.message}`, 'error');
        }
    }

    async function fetchOptionalCollection(collection, fallback) {
        try {
            return await fetchCollectionFast(collection);
        } catch (error) {
            console.warn(`Optional collection ${collection} unavailable.`, error);
            return fallback;
        }
    }

    async function fetchCollectionFast(collection) {
        return MargaUtils.fetchCollection(collection, 1000);
    }

    function buildMaps() {
        state.maps = {
            companies: toMap(state.raw.companies),
            branches: toMap(state.raw.branches),
            contracts: toMap(state.raw.contracts),
            contractDeps: toMap(state.raw.contractDeps),
            machines: toMap(state.raw.machines),
            models: toMap(state.raw.models),
            brands: toMap(state.raw.brands),
            areas: toMap(state.raw.areas),
            cities: toMap(state.raw.cities),
            billInfoByBranch: new Map(),
            deliveryInfoByBranch: new Map(),
            collectionInfoByBranch: new Map(),
            contractsByBranch: new Map()
        };

        state.raw.billInfo.forEach((row) => {
            const branchId = clean(row.branch_id);
            if (!branchId) return;
            if (!state.maps.billInfoByBranch.has(branchId)) state.maps.billInfoByBranch.set(branchId, []);
            state.maps.billInfoByBranch.get(branchId).push(row);
        });

        state.raw.deliveryInfo.forEach((row) => {
            const branchId = clean(row.branch_id);
            if (!branchId) return;
            if (!state.maps.deliveryInfoByBranch.has(branchId)) state.maps.deliveryInfoByBranch.set(branchId, []);
            state.maps.deliveryInfoByBranch.get(branchId).push(row);
        });

        state.raw.collectionInfo.forEach((row) => {
            const branchId = clean(row.branch_id);
            if (!branchId) return;
            if (!state.maps.collectionInfoByBranch.has(branchId)) state.maps.collectionInfoByBranch.set(branchId, []);
            state.maps.collectionInfoByBranch.get(branchId).push(row);
        });

        state.raw.contracts.forEach((contract) => {
            const branch = resolveContractBranch(contract);
            const branchId = clean(branch?.id);
            if (!branchId) return;
            if (!state.maps.contractsByBranch.has(branchId)) state.maps.contractsByBranch.set(branchId, []);
            state.maps.contractsByBranch.get(branchId).push(contract);
        });
    }

    function toMap(rows) {
        return new Map((rows || []).map((row) => [clean(row.id || row._docId), row]).filter(([id]) => id));
    }

    function normalizeParticulars(rows) {
        const source = Array.isArray(rows) && rows.length ? rows : FALLBACK_PARTICULARS;
        return source
            .map((row) => ({
                id: Number(row.id || 0),
                code: clean(row.code || row.particular_code || row.particularCode),
                name: clean(row.name || row.description || row.particular_name),
                with_reading: Number(row.with_reading ?? row.wreading ?? 0)
            }))
            .filter((row) => row.id || row.code)
            .sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    }

    function selectInitialCompany() {
        const params = new URLSearchParams(window.location.search);
        const companyId = clean(params.get('company_id'));
        const branchId = clean(params.get('branch_id'));
        const contractId = clean(params.get('contractmain_id'));
        let targetCompany = companyId ? state.maps.companies.get(companyId) : null;

        if (!targetCompany && branchId) {
            const branch = state.maps.branches.get(branchId);
            targetCompany = state.maps.companies.get(clean(branch?.company_id));
        }
        if (!targetCompany && contractId) {
            const contract = state.maps.contracts.get(contractId);
            const branch = resolveContractBranch(contract);
            targetCompany = state.maps.companies.get(clean(branch?.company_id));
        }
        if (!targetCompany) {
            targetCompany = [...state.raw.companies]
                .filter((company) => !Number(company.hide || 0))
                .sort((a, b) => companyName(a).localeCompare(companyName(b)))[0] || null;
        }

        if (targetCompany) {
            selectCompany(clean(targetCompany.id), branchId);
        }
    }

    function bindStaticEvents() {
        byId('customerCompanyPicker')?.addEventListener('change', handleCompanyPicker);
        byId('customerCompanyPicker')?.addEventListener('input', MargaUtils.debounce(handleCompanyPicker, 250));
        byId('branchPicker')?.addEventListener('change', (event) => selectBranch(event.target.value));
        byId('saveCompanyBtn')?.addEventListener('click', () => saveCompany(true));
        byId('updateCompanyBtn')?.addEventListener('click', () => saveCompany(false));
        byId('newBranchBtn')?.addEventListener('click', prepareNewBranch);
        byId('saveBranchBtn')?.addEventListener('click', () => saveBranchInfo(true));
        byId('updateBranchBtn')?.addEventListener('click', () => saveBranchInfo(false));
        byId('copyAddressBtn')?.addEventListener('click', copyBranchAddressToSections);
        byId('machineContractsBtn')?.addEventListener('click', openContractsModal);
        byId('verifiedUsersBtn')?.addEventListener('click', () => MargaUtils.showToast('Verified app users wiring will use the portal/user tables after this customer screen is stable.', 'info'));
        byId('refreshCustomersBtn')?.addEventListener('click', loadAllData);
        byId('openMapBtn')?.addEventListener('click', openSelectedMap);
        byId('contractModalClose')?.addEventListener('click', closeContractsModal);
        byId('contractOverlay')?.addEventListener('click', closeContractsModal);
        byId('clearContractBtn')?.addEventListener('click', clearContractForm);
        byId('saveContractBtn')?.addEventListener('click', () => saveContract(true));
        byId('updateContractBtn')?.addEventListener('click', () => saveContract(false));
        byId('schedulePulloutBtn')?.addEventListener('click', schedulePullout);
        byId('contractRows')?.addEventListener('click', handleContractTableClick);
        byId('machineSerial')?.addEventListener('change', handleMachineSerialPicked);
    }

    function renderReferenceLists() {
        renderCompanyList();
        renderSelectOptions('natureOfBusiness', state.raw.nature, 'id', (row) => row.nature || row.name || `Nature ${row.id}`);
        renderSelectOptions('businessIndustry', state.raw.industries, 'id', (row) => row.industry_name || row.name || `Industry ${row.id}`);
        renderSelectOptions('branchArea', state.raw.areas, 'id', areaName);
        renderSelectOptions('deliveryArea', state.raw.areas, 'id', areaName);
        renderSelectOptions('serviceArea', state.raw.areas, 'id', areaName);
        renderSelectOptions('billArea', state.raw.areas, 'id', areaName);
        renderSelectOptions('collectionArea', state.raw.areas, 'id', areaName);
        renderSelectOptions('branchCity', state.raw.cities, (row) => cityName(row), cityName);
        renderSelectOptions('deliveryCity', state.raw.cities, (row) => cityName(row), cityName);
        renderSelectOptions('serviceCity', state.raw.cities, (row) => cityName(row), cityName);
        renderSelectOptions('billCity', state.raw.cities, (row) => cityName(row), cityName);
        renderSelectOptions('collectionCity', state.raw.cities, (row) => cityName(row), cityName);
        renderDatalist('brandOptions', state.raw.brands, brandName);
        renderDatalist('modelOptions', state.raw.models, modelName);
        renderDatalist('machineSerialOptions', state.raw.machines, machineOptionLabel);
        renderSelectOptions('particularCode', state.raw.particulars, 'id', particularLabel);
        renderSelectOptionsFromObject('contractStatus', CONTRACT_STATUS);
        renderSelectOptions('contractAgent', state.raw.employees, 'id', employeeName);
    }

    function renderCompanyList() {
        const list = byId('companyOptions');
        if (!list) return;
        const rows = [...state.raw.companies]
            .sort((a, b) => companyName(a).localeCompare(companyName(b)))
            .map((company) => `<option value="${escapeAttr(companyPickerValue(company))}"></option>`);
        list.innerHTML = rows.join('');
    }

    function renderStats() {
        const activeContracts = state.raw.contracts.filter((contract) => Number(contract.status || 0) === 1).length;
        setText('companyCount', state.raw.companies.length.toLocaleString());
        setText('branchCount', state.raw.branches.length.toLocaleString());
        setText('contractCount', state.raw.contracts.length.toLocaleString());
        setText('activeContractCount', activeContracts.toLocaleString());
    }

    function handleCompanyPicker() {
        const value = clean(byId('customerCompanyPicker')?.value);
        const company = findCompanyFromPickerValue(value);
        if (company) {
            selectCompany(clean(company.id));
            return;
        }

        beginNewCompanyDraft(value);
    }

    function findCompanyFromPickerValue(value) {
        const normalizedValue = clean(value);
        if (!normalizedValue) return null;
        return state.raw.companies.find((company) => companyPickerValue(company) === normalizedValue) || null;
    }

    function beginNewCompanyDraft(value) {
        const typedName = clean(value).replace(/\s*\[\d+\]\s*$/, '');
        state.selectedCompanyId = '';
        state.selectedBranchId = '';
        state.selectedContractId = '';
        state.selectedMachineId = '';
        state.newBranchMode = true;

        setInput('companyName', typedName);
        setInput('companyTin', '');
        setInput('businessStyle', '');
        setInput('natureOfBusiness', '');
        setInput('businessIndustry', '');
        setInput('companyIdDisplay', '');

        const branchPicker = byId('branchPicker');
        if (branchPicker) branchPicker.innerHTML = '';
        fillBranchForm({});
        fillBillForm({});
        setText('branchMachineCount', '0');
        setText('branchContractCount', '0');
        setStatus(typedName ? 'New company draft' : 'Ready');
    }

    function selectCompany(companyId, preferredBranchId = '') {
        const company = state.maps.companies.get(clean(companyId));
        if (!company) return;
        state.selectedCompanyId = clean(company.id);
        state.newBranchMode = false;
        byId('customerCompanyPicker').value = companyPickerValue(company);
        fillCompanyForm(company);
        renderBranchPicker(preferredBranchId);
        setStatus(`Company ${state.selectedCompanyId}`);
    }

    function fillCompanyForm(company) {
        setInput('companyName', companyName(company));
        setInput('companyTin', company.company_tin || company.tin || '');
        setInput('businessStyle', company.business_style || '');
        setInput('natureOfBusiness', clean(company.company_nob || company.nature_of_business || ''));
        setInput('businessIndustry', clean(company.industry || company.business_industry || ''));
        setInput('companyIdDisplay', clean(company.id));
    }

    function renderBranchPicker(preferredBranchId = '') {
        const branches = getCompanyBranches(state.selectedCompanyId);
        const picker = byId('branchPicker');
        if (!picker) return;
        picker.innerHTML = branches.map((branch) => {
            const label = `${branch.branchname || 'Main'}${branch.code ? ` - ${branch.code}` : ''}`;
            return `<option value="${escapeAttr(branch.id)}">${escapeHtml(label)}</option>`;
        }).join('');

        const branchId = preferredBranchId && branches.some((branch) => clean(branch.id) === clean(preferredBranchId))
            ? clean(preferredBranchId)
            : clean(branches[0]?.id);
        selectBranch(branchId);
    }

    function getCompanyBranches(companyId) {
        return state.raw.branches
            .filter((branch) => clean(branch.company_id) === clean(companyId))
            .sort((a, b) => clean(a.branchname || '').localeCompare(clean(b.branchname || '')));
    }

    function selectBranch(branchId) {
        state.selectedBranchId = clean(branchId);
        state.newBranchMode = false;
        if (byId('branchPicker')) byId('branchPicker').value = state.selectedBranchId;
        const branch = state.maps.branches.get(state.selectedBranchId) || {};
        const billInfo = firstBillInfoForBranch(state.selectedBranchId) || {};
        const deliveryInfo = firstDeliveryInfoForBranch(state.selectedBranchId) || {};
        const collectionInfo = firstCollectionInfoForBranch(state.selectedBranchId) || {};
        fillBranchForm(branch, deliveryInfo, collectionInfo, billInfo);
        fillBillForm(billInfo, collectionInfo);
        renderBranchSummary();
    }

    function prepareNewBranch() {
        if (!state.selectedCompanyId) {
            MargaUtils.showToast('Select or save a company first.', 'error');
            return;
        }
        state.selectedBranchId = '';
        state.newBranchMode = true;
        if (byId('branchPicker')) byId('branchPicker').value = '';
        fillBranchForm({}, {}, {}, {});
        fillBillForm({}, {});
        setText('branchMachineCount', '0');
        setText('branchContractCount', '0');
        setStatus('New branch/dept');
    }

    function fillBranchForm(branch, deliveryInfo = {}, collectionInfo = {}, billInfo = {}) {
        setInput('branchCode', branch.code || '');
        setInput('branchName', branch.branchname || '');
        setInput('branchRoom', branch.room || '');
        setInput('branchFloor', branch.floor || '');
        setInput('branchBldg', branch.bldg || '');
        setInput('branchStreet', branch.street || '');
        setInput('branchBrgy', branch.brgy || '');
        setInput('branchCity', branch.city || '');
        setInput('branchArea', clean(branch.area_id || ''));
        setInput('branchLandmark', branch.landmark || '');
        setInput('branchLatitude', branch.latitude || '');
        setInput('branchLongitude', branch.longitude || '');
        setInput('branchSignatory', branch.signatory || '');
        setInput('branchDesignation', branch.designation || '');
        setInput('branchEmail', branch.email || '');
        setInput('deliveryContact', deliveryInfo.tcontact_person || branch.delivery_contact || branch.signatory || '');
        setInput('deliveryNum', deliveryInfo.tcontact_num || branch.delivery_num || '');
        setInput('deliveryDays', deliveryInfo.toffice_days || branch.delivery_days || '');
        setInput('deliveryHours', deliveryInfo.toffice_hours || branch.delivery_hours || '');
        setInput('deliveryCity', cityNameFromId(deliveryInfo.city_id) || branch.delivery_city || branch.city || cityNameFromId(branch.city_id));
        setInput('deliveryArea', clean(deliveryInfo.area_id || branch.delivery_area_id || branch.area_id || ''));
        setInput('deliveryAddress', deliveryInfo.tdelivery_add || branch.delivery_address || branch.branch_address || formatBranchAddress(branch));

        const serviceNumber = branch.service_num
            || deliveryInfo.mcontact_num
            || collectionInfo.releasenum
            || collectionInfo.treasnum
            || collectionInfo.cashnum
            || extractPhoneLike(collectionInfo.last_contact)
            || billInfo.endusercontactnum
            || deliveryInfo.tcontact_num
            || '';
        setInput('serviceContact', branch.service_contact || deliveryInfo.mcontact_person || deliveryInfo.tcontact_person || branch.signatory || '');
        setInput('serviceNum', serviceNumber);
        setInput('serviceCity', branch.service_city || cityNameFromId(deliveryInfo.city_id) || branch.city || cityNameFromId(branch.city_id));
        setInput('serviceArea', clean(branch.service_area_id || deliveryInfo.area_id || branch.area_id || ''));
        setInput('serviceAddress', branch.service_address || deliveryInfo.mdelivery_add || deliveryInfo.tdelivery_add || branch.branch_address || formatBranchAddress(branch));
    }

    function fillBillForm(billInfo, collectionInfo = {}) {
        setInput('billEndUser', billInfo.endusername || '');
        setInput('billEndUserContact', billInfo.endusercontactnum || '');
        setInput('billPayeeName', billInfo.payeename || '');
        setInput('billPayeeContact', billInfo.payeecontactnum || '');
        setInput('billPayeeAddress', billInfo.payeeadd || billInfo.enduseradd || '');
        setInput('billCity', billInfo.endusercity || cityNameFromId(billInfo.city_id) || '');
        setInput('billArea', clean(billInfo.area_id || billInfo.enduserarea_id || ''));
        setInput('billLatitude', billInfo.latitude || '');
        setInput('billLongitude', billInfo.longitude || '');
        setInput('acctContact', collectionInfo.acctcon || billInfo.acct_contact || '');
        setInput('acctNum', collectionInfo.acctnum || billInfo.acct_num || '');
        setInput('acctEmail', isEmailLike(collectionInfo.acctnum) ? collectionInfo.acctnum : (billInfo.acct_email || ''));
        setInput('cashierContact', collectionInfo.cashcon || billInfo.cashier_contact || '');
        setInput('cashierNum', collectionInfo.cashnum || billInfo.cashier_num || '');
        setInput('treasuryContact', collectionInfo.treascon || billInfo.treasury_contact || '');
        setInput('treasuryNum', collectionInfo.treasnum || billInfo.treasury_num || '');
        setInput('releasingContact', collectionInfo.releasecon || billInfo.releasing_contact || '');
        setInput('releasingNum', collectionInfo.releasenum || billInfo.releasing_num || '');
        setInput('collectionDays', collectionInfo.collection_days || billInfo.col_days || '');
        setInput('collectionFrom', normalizeTimeValue(collectionInfo.time_from || billInfo.col_from));
        setInput('collectionTo', normalizeTimeValue(collectionInfo.time_to || billInfo.col_to));
        setInput('collectionCity', cityNameFromId(collectionInfo.city_id) || billInfo.col_city || '');
        setInput('collectionArea', clean(collectionInfo.area_id || billInfo.col_area_id || ''));
        setInput('collectionAddress', collectionInfo.releaseadd || billInfo.col_address || '');
    }

    function renderBranchSummary() {
        const contracts = getSelectedBranchContracts();
        const machineIds = new Set(contracts.map((contract) => clean(contract.mach_id)).filter(Boolean));
        setText('branchMachineCount', machineIds.size.toLocaleString());
        setText('branchContractCount', contracts.length.toLocaleString());
    }

    async function saveCompany(createNew) {
        const companyNameValue = clean(byId('companyName')?.value);
        if (!companyNameValue) {
            MargaUtils.showToast('Company name is required.', 'error');
            return;
        }

        const companyId = createNew
            ? nextNumericId(state.raw.companies)
            : clean(state.selectedCompanyId || byId('companyIdDisplay')?.value);
        if (!companyId) {
            MargaUtils.showToast('Select a company before updating.', 'error');
            return;
        }

        const natureId = clean(byId('natureOfBusiness')?.value);
        const industryId = clean(byId('businessIndustry')?.value);
        const payload = {
            id: Number(companyId),
            companyname: companyNameValue,
            company_tin: clean(byId('companyTin')?.value),
            company_nob: numberOrZero(natureId),
            industry: numberOrZero(industryId),
            nature_of_business: optionText('natureOfBusiness'),
            business_industry: optionText('businessIndustry'),
            business_style: clean(byId('businessStyle')?.value),
            hide: 0,
            usecomname: 0,
            has_code: 0
        };

        try {
            toggleButton(createNew ? 'saveCompanyBtn' : 'updateCompanyBtn', true);
            if (createNew) {
                await createDocument('tbl_companylist', companyId, payload, COMPANY_INTEGER_FIELDS);
                state.raw.companies.push({ ...payload, id: Number(companyId) });
                MargaUtils.showToast('New company saved.', 'success');
            } else {
                await patchDocument('tbl_companylist', companyId, payload, COMPANY_INTEGER_FIELDS);
                replaceLocalRow(state.raw.companies, companyId, payload);
                MargaUtils.showToast('Company updated.', 'success');
            }
            buildMaps();
            renderReferenceLists();
            renderStats();
            selectCompany(companyId);
        } catch (error) {
            console.error('Company save failed:', error);
            MargaUtils.showToast(`Company save failed: ${error.message}`, 'error');
        } finally {
            toggleButton(createNew ? 'saveCompanyBtn' : 'updateCompanyBtn', false);
        }
    }

    async function saveBranchInfo(createNew) {
        if (!state.selectedCompanyId) {
            MargaUtils.showToast('Select or save a company first.', 'error');
            return;
        }
        const branchNameValue = clean(byId('branchName')?.value);
        if (!branchNameValue) {
            MargaUtils.showToast('Branch name is required.', 'error');
            return;
        }

        const branchId = createNew || state.newBranchMode
            ? nextNumericId(state.raw.branches)
            : clean(state.selectedBranchId);
        if (!branchId) {
            MargaUtils.showToast('Select a branch before updating.', 'error');
            return;
        }

        const branchPayload = collectBranchPayload(branchId);
        const existingBill = firstBillInfoForBranch(branchId);
        const billId = existingBill?.id || nextNumericId(state.raw.billInfo);
        const billPayload = collectBillPayload(billId, branchId);
        const existingDelivery = firstDeliveryInfoForBranch(branchId);
        const deliveryId = existingDelivery?.id || nextNumericId(state.raw.deliveryInfo);
        const deliveryPayload = collectDeliveryPayload(deliveryId, branchId);
        const existingCollection = firstCollectionInfoForBranch(branchId);
        const collectionId = existingCollection?.id || nextNumericId(state.raw.collectionInfo);
        const collectionPayload = collectCollectionPayload(collectionId, branchId);

        try {
            toggleButton(createNew ? 'saveBranchBtn' : 'updateBranchBtn', true);
            if (createNew || state.newBranchMode) {
                await createDocument('tbl_branchinfo', branchId, branchPayload, BRANCH_INTEGER_FIELDS);
                await createDocument('tbl_billinfo', billId, billPayload, BILL_INTEGER_FIELDS);
                await createDocument('tbl_deliveryinfo', deliveryId, deliveryPayload, DELIVERY_INTEGER_FIELDS);
                await createDocument('tbl_collectioninfo', collectionId, collectionPayload, COLLECTION_INTEGER_FIELDS);
                state.raw.branches.push({ ...branchPayload, id: Number(branchId) });
                state.raw.billInfo.push({ ...billPayload, id: Number(billId) });
                state.raw.deliveryInfo.push({ ...deliveryPayload, id: Number(deliveryId) });
                state.raw.collectionInfo.push({ ...collectionPayload, id: Number(collectionId) });
                MargaUtils.showToast('New branch information saved.', 'success');
            } else {
                await patchDocument('tbl_branchinfo', branchId, branchPayload, BRANCH_INTEGER_FIELDS);
                if (existingBill?.id) {
                    await patchDocument('tbl_billinfo', existingBill.id, billPayload, BILL_INTEGER_FIELDS);
                    replaceLocalRow(state.raw.billInfo, existingBill.id, billPayload);
                } else {
                    await createDocument('tbl_billinfo', billId, billPayload, BILL_INTEGER_FIELDS);
                    state.raw.billInfo.push({ ...billPayload, id: Number(billId) });
                }
                if (existingDelivery?.id) {
                    await patchDocument('tbl_deliveryinfo', existingDelivery.id, deliveryPayload, DELIVERY_INTEGER_FIELDS);
                    replaceLocalRow(state.raw.deliveryInfo, existingDelivery.id, deliveryPayload);
                } else {
                    await createDocument('tbl_deliveryinfo', deliveryId, deliveryPayload, DELIVERY_INTEGER_FIELDS);
                    state.raw.deliveryInfo.push({ ...deliveryPayload, id: Number(deliveryId) });
                }
                if (existingCollection?.id) {
                    await patchDocument('tbl_collectioninfo', existingCollection.id, collectionPayload, COLLECTION_INTEGER_FIELDS);
                    replaceLocalRow(state.raw.collectionInfo, existingCollection.id, collectionPayload);
                } else {
                    await createDocument('tbl_collectioninfo', collectionId, collectionPayload, COLLECTION_INTEGER_FIELDS);
                    state.raw.collectionInfo.push({ ...collectionPayload, id: Number(collectionId) });
                }
                replaceLocalRow(state.raw.branches, branchId, branchPayload);
                MargaUtils.showToast('Branch information updated.', 'success');
            }
            buildMaps();
            renderBranchPicker(branchId);
            selectBranch(branchId);
        } catch (error) {
            console.error('Branch save failed:', error);
            MargaUtils.showToast(`Branch save failed: ${error.message}`, 'error');
        } finally {
            toggleButton(createNew ? 'saveBranchBtn' : 'updateBranchBtn', false);
        }
    }

    function collectBranchPayload(branchId) {
        const address = [
            valueOf('branchRoom'),
            valueOf('branchFloor'),
            valueOf('branchBldg'),
            valueOf('branchStreet'),
            valueOf('branchBrgy'),
            valueOf('branchCity')
        ].filter(Boolean).join(', ');

        return {
            id: Number(branchId),
            company_id: Number(state.selectedCompanyId),
            code: valueOf('branchCode'),
            branchname: valueOf('branchName'),
            room: valueOf('branchRoom'),
            floor: valueOf('branchFloor'),
            bldg: valueOf('branchBldg'),
            street: valueOf('branchStreet'),
            brgy: valueOf('branchBrgy'),
            city: valueOf('branchCity'),
            city_id: cityIdFromName(valueOf('branchCity')),
            area_id: numberOrZero(valueOf('branchArea')),
            landmark: valueOf('branchLandmark'),
            latitude: valueOf('branchLatitude'),
            longitude: valueOf('branchLongitude'),
            branch_address: address,
            signatory: valueOf('branchSignatory'),
            designation: valueOf('branchDesignation'),
            email: valueOf('branchEmail'),
            delivery_contact: valueOf('deliveryContact'),
            delivery_num: valueOf('deliveryNum'),
            delivery_days: valueOf('deliveryDays'),
            delivery_hours: valueOf('deliveryHours'),
            delivery_city: valueOf('deliveryCity'),
            delivery_area_id: numberOrZero(valueOf('deliveryArea')),
            delivery_address: valueOf('deliveryAddress'),
            service_contact: valueOf('serviceContact'),
            service_num: valueOf('serviceNum'),
            service_city: valueOf('serviceCity'),
            service_area_id: numberOrZero(valueOf('serviceArea')),
            service_address: valueOf('serviceAddress'),
            inactive: 0
        };
    }

    function collectDeliveryPayload(deliveryId, branchId) {
        return {
            id: Number(deliveryId),
            branch_id: Number(branchId),
            tcontact_person: valueOf('deliveryContact'),
            tcontact_num: valueOf('deliveryNum'),
            toffice_days: valueOf('deliveryDays'),
            toffice_hours: valueOf('deliveryHours'),
            city_id: cityIdFromName(valueOf('deliveryCity')),
            area_id: numberOrZero(valueOf('deliveryArea')),
            tdelivery_add: valueOf('deliveryAddress'),
            mcontact_person: valueOf('serviceContact'),
            mcontact_num: valueOf('serviceNum'),
            moffice_days: '',
            moffice_hours: '',
            mdelivery_add: valueOf('serviceAddress'),
            latitude: valueOf('branchLatitude') || valueOf('billLatitude'),
            longitude: valueOf('branchLongitude') || valueOf('billLongitude')
        };
    }

    function collectBillPayload(billId, branchId) {
        return {
            id: Number(billId),
            branch_id: Number(branchId),
            endusername: valueOf('billEndUser'),
            endusercontactnum: valueOf('billEndUserContact'),
            payeename: valueOf('billPayeeName'),
            payeecontactnum: valueOf('billPayeeContact'),
            payeeadd: valueOf('billPayeeAddress'),
            endusercity: valueOf('billCity'),
            city_id: cityIdFromName(valueOf('billCity')),
            area_id: numberOrZero(valueOf('billArea')),
            enduseradd: valueOf('billPayeeAddress'),
            latitude: valueOf('billLatitude'),
            longitude: valueOf('billLongitude'),
            acct_contact: valueOf('acctContact'),
            acct_num: valueOf('acctNum'),
            acct_email: valueOf('acctEmail'),
            cashier_contact: valueOf('cashierContact'),
            cashier_num: valueOf('cashierNum'),
            treasury_contact: valueOf('treasuryContact'),
            treasury_num: valueOf('treasuryNum'),
            releasing_contact: valueOf('releasingContact'),
            releasing_num: valueOf('releasingNum'),
            col_days: valueOf('collectionDays'),
            col_from: valueOf('collectionFrom'),
            col_to: valueOf('collectionTo'),
            col_city: valueOf('collectionCity'),
            col_area_id: numberOrZero(valueOf('collectionArea')),
            col_address: valueOf('collectionAddress')
        };
    }

    function collectCollectionPayload(collectionId, branchId) {
        return {
            id: Number(collectionId),
            branch_id: Number(branchId),
            acctcon: valueOf('acctContact'),
            acctnum: valueOf('acctNum') || valueOf('acctEmail'),
            cashcon: valueOf('cashierContact'),
            cashnum: valueOf('cashierNum'),
            treascon: valueOf('treasuryContact'),
            treasnum: valueOf('treasuryNum'),
            releasecon: valueOf('releasingContact'),
            releasenum: valueOf('releasingNum'),
            collection_days: valueOf('collectionDays'),
            time_from: timeInputToLegacyDate(valueOf('collectionFrom')),
            time_to: timeInputToLegacyDate(valueOf('collectionTo')),
            city_id: cityIdFromName(valueOf('collectionCity')),
            area_id: numberOrZero(valueOf('collectionArea')),
            releaseadd: valueOf('collectionAddress'),
            latitude: valueOf('billLatitude') || valueOf('branchLatitude'),
            longitude: valueOf('billLongitude') || valueOf('branchLongitude'),
            followup_days: '',
            followup_time: '',
            collection_hours: '',
            last_contact: ''
        };
    }

    function copyBranchAddressToSections() {
        const branchContact = valueOf('branchSignatory');
        const city = valueOf('branchCity');
        const area = valueOf('branchArea');
        const address = [
            valueOf('branchRoom'),
            valueOf('branchFloor'),
            valueOf('branchBldg'),
            valueOf('branchStreet'),
            valueOf('branchBrgy')
        ].filter(Boolean).join(', ');

        setInput('deliveryContact', branchContact);
        setInput('deliveryCity', city);
        setInput('deliveryArea', area);
        setInput('deliveryAddress', address);
        setInput('serviceContact', branchContact);
        setInput('serviceCity', city);
        setInput('serviceArea', area);
        setInput('serviceAddress', address);
        setInput('billCity', city);
        setInput('billArea', area);
        setInput('billPayeeAddress', address);
        MargaUtils.showToast('Address copied.', 'success');
    }

    function openSelectedMap() {
        const lat = valueOf('branchLatitude') || valueOf('billLatitude');
        const lng = valueOf('branchLongitude') || valueOf('billLongitude');
        if (!lat || !lng || lat === '0' || lng === '0') {
            MargaUtils.showToast('No coordinates available for this branch.', 'info');
            return;
        }
        window.open(`https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`, '_blank', 'noopener,noreferrer');
    }

    function openContractsModal() {
        if (!state.selectedBranchId) {
            MargaUtils.showToast('Select a branch before opening machine/contracts.', 'error');
            return;
        }
        renderContractRows();
        const contracts = getSelectedBranchContracts();
        if (contracts.length) fillContractForm(contracts[0]);
        else clearContractForm();
        byId('contractOverlay')?.classList.add('visible');
        byId('contractModal')?.classList.add('visible');
    }

    function closeContractsModal() {
        byId('contractOverlay')?.classList.remove('visible');
        byId('contractModal')?.classList.remove('visible');
    }

    function renderContractRows() {
        const tbody = byId('contractRows');
        if (!tbody) return;
        const contracts = getSelectedBranchContracts();
        if (!contracts.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No machine/contracts linked to this branch.</td></tr>';
            return;
        }
        tbody.innerHTML = contracts.map((contract) => {
            const machine = state.maps.machines.get(clean(contract.mach_id)) || {};
            const model = state.maps.models.get(clean(machine.model_id)) || {};
            const serial = resolveSerial(contract, machine);
            return `
                <tr data-contract-id="${escapeAttr(contract.id)}">
                    <td>${escapeHtml(clean(contract.id))}</td>
                    <td>${escapeHtml(modelName(model) || machine.description || '-')}</td>
                    <td>${escapeHtml(serial || 'No serial on file')}</td>
                    <td>${escapeHtml(particularCode(contract.category_id))}</td>
                    <td>${escapeHtml(CONTRACT_STATUS[Number(contract.status || 0)] || `Status ${contract.status || '-'}`)}</td>
                </tr>
            `;
        }).join('');
    }

    function handleContractTableClick(event) {
        const row = event.target.closest('tr[data-contract-id]');
        if (!row) return;
        const contract = state.maps.contracts.get(clean(row.dataset.contractId));
        if (contract) fillContractForm(contract);
    }

    function clearContractForm() {
        state.selectedContractId = '';
        state.selectedMachineId = '';
        [
            'machineBrand',
            'machineModel',
            'machineSerial',
            'piAmount',
            'rdAmount',
            'apAmount',
            'contractDuration',
            'beginningMeter',
            'paymentTerms',
            'computerCount',
            'passwordRestriction',
            'paperType',
            'bwQuota',
            'bwRate',
            'bwXRate',
            'colorQuota',
            'colorRate',
            'colorXRate',
            'colorMeter',
            'preTerm',
            'fixedRate',
            'readingDate',
            'commission',
            'deliveryDate',
            'installDate',
            'contractEnd',
            'contractRemarks'
        ].forEach((id) => setInput(id, ''));
        setInput('particularCode', '1');
        setInput('contractStatus', '1');
        setInput('contractVatYes', true, 'checked');
        setInput('contractVatNo', false, 'checked');
        setInput('contractAgent', '');
        ['ownedWifi', 'ownedUsb', 'scanFolder', 'scanEmail', 'osMac', 'osWindows'].forEach((id) => setInput(id, false, 'checked'));
        setText('contractEditorTitle', 'New Machine / Contract');
    }

    function fillContractForm(contract) {
        const machine = state.maps.machines.get(clean(contract.mach_id)) || {};
        const brand = state.maps.brands.get(clean(machine.brand_id || contract.brand_id)) || {};
        const model = state.maps.models.get(clean(machine.model_id)) || {};
        state.selectedContractId = clean(contract.id);
        state.selectedMachineId = clean(contract.mach_id);
        setText('contractEditorTitle', `Contract ${state.selectedContractId}`);
        setInput('particularCode', clean(contract.category_id || '1'));
        setInput('contractStatus', clean(contract.status || '1'));
        setInput('machineBrand', brandName(brand));
        setInput('machineModel', modelName(model) || machine.description || '');
        setInput('machineSerial', resolveSerial(contract, machine));
        setInput('piAmount', contract.pi || '');
        setInput('rdAmount', contract.rd || '');
        setInput('apAmount', contract.ap || '');
        setInput('contractDuration', contract.contract_duration || '');
        setInput('beginningMeter', contract.b_meter || contract.starting_meter || '');
        setInput('paymentTerms', contract.terms || '');
        setInput('computerCount', contract.computers_installed || '');
        setInput('ownedWifi', Boolean(Number(contract.wifi || 0)), 'checked');
        setInput('ownedUsb', Boolean(Number(contract.usb || 0)), 'checked');
        setInput('scanFolder', Boolean(Number(contract.scan_to_folder || 0)), 'checked');
        setInput('scanEmail', Boolean(Number(contract.scan_to_email || 0)), 'checked');
        setInput('osMac', Boolean(Number(contract.os_mac || 0)), 'checked');
        setInput('osWindows', Boolean(Number(contract.os_windows || 0)), 'checked');
        setInput('passwordRestriction', contract.pw_res || '');
        setInput('paperType', contract.paper_type || '');
        setInput('bwQuota', contract.monthly_quota || '');
        setInput('bwRate', contract.page_rate || '');
        setInput('bwXRate', contract.page_rate_xtra || '');
        setInput('colorQuota', contract.monthly_quota2 || '');
        setInput('colorRate', contract.page_rate2 || '');
        setInput('colorXRate', contract.page_rate_xtra2 || '');
        setInput('colorMeter', contract.monthly_rate2 || '');
        setInput('preTerm', contract.preterm || '');
        setInput('fixedRate', contract.fixed_rate || contract.monthly_rate || '');
        setInput('contractVatYes', Number(contract.withvat || 0) === 1, 'checked');
        setInput('contractVatNo', Number(contract.withvat || 0) !== 1, 'checked');
        setInput('readingDate', toDateInput(contract.reading_date));
        setInput('contractAgent', clean(contract.agent_id || ''));
        setInput('commission', contract.commision_rate || '');
        setInput('deliveryDate', toDateInput(contract.target_delivery));
        setInput('installDate', toDateInput(contract.date_installed));
        setInput('contractEnd', toDateInput(contract.contractend_date));
        setInput('contractRemarks', contract.remarks || contract.update_remarks || '');
    }

    function handleMachineSerialPicked() {
        const serial = clean(byId('machineSerial')?.value);
        const selected = findMachineBySerialValue(serial);
        if (!selected) return;
        state.selectedMachineId = clean(selected.id);
        const brand = state.maps.brands.get(clean(selected.brand_id));
        const model = state.maps.models.get(clean(selected.model_id));
        setInput('machineBrand', brandName(brand));
        setInput('machineModel', modelName(model) || selected.description || '');
        setInput('machineSerial', selected.serial || '');
    }

    async function saveContract(createNew) {
        if (!state.selectedBranchId) {
            MargaUtils.showToast('Select a branch first.', 'error');
            return;
        }
        if (!createNew && !state.selectedContractId) {
            MargaUtils.showToast('Select a contract before updating.', 'error');
            return;
        }

        try {
            toggleButton(createNew ? 'saveContractBtn' : 'updateContractBtn', true);
            const machine = await upsertMachineForContract(createNew);
            const contractId = createNew ? nextNumericId(state.raw.contracts) : state.selectedContractId;
            let contractDepId = '';

            if (createNew) {
                contractDepId = nextNumericId(state.raw.contractDeps);
                const contractDepPayload = {
                    id: Number(contractDepId),
                    branch_id: Number(state.selectedBranchId),
                    departmentname: '',
                    dev_remarks: '',
                    for_purchase: 0,
                    address: '0'
                };
                await createDocument('tbl_contractdep', contractDepId, contractDepPayload, new Set(['id', 'branch_id', 'for_purchase']));
                state.raw.contractDeps.push(contractDepPayload);
            } else {
                const current = state.maps.contracts.get(clean(contractId));
                contractDepId = clean(current?.contract_id);
            }

            const payload = collectContractPayload(contractId, contractDepId, machine.id);
            if (createNew) {
                await createDocument('tbl_contractmain', contractId, payload, CONTRACT_INTEGER_FIELDS, CONTRACT_DOUBLE_FIELDS);
                state.raw.contracts.push({ ...payload, id: Number(contractId) });
                state.selectedContractId = clean(contractId);
                MargaUtils.showToast('New contract saved.', 'success');
            } else {
                await patchDocument('tbl_contractmain', contractId, payload, CONTRACT_INTEGER_FIELDS, CONTRACT_DOUBLE_FIELDS);
                replaceLocalRow(state.raw.contracts, contractId, payload);
                MargaUtils.showToast('Contract updated.', 'success');
            }

            buildMaps();
            renderContractRows();
            fillContractForm(state.maps.contracts.get(clean(contractId)));
            renderBranchSummary();
        } catch (error) {
            console.error('Contract save failed:', error);
            MargaUtils.showToast(`Contract save failed: ${error.message}`, 'error');
        } finally {
            toggleButton(createNew ? 'saveContractBtn' : 'updateContractBtn', false);
        }
    }

    async function upsertMachineForContract(createNew) {
        const existingFromSerial = findMachineBySerialValue(valueOf('machineSerial'));
        const machineId = clean(existingFromSerial?.id || state.selectedMachineId);
        const brandId = resolveBrandId(valueOf('machineBrand'));
        const modelId = resolveModelId(valueOf('machineModel'));
        const serial = valueOf('machineSerial').replace(/\s*\[\d+\]\s*$/, '').trim().toUpperCase();
        const description = valueOf('machineModel');

        if (!machineId || (createNew && !existingFromSerial)) {
            const newId = nextNumericId(state.raw.machines);
            const payload = {
                id: Number(newId),
                brand_id: numberOrZero(brandId),
                model_id: numberOrZero(modelId),
                serial,
                description,
                status_id: 2,
                client_id: 0,
                bmeter: 1,
                isclient: 0
            };
            await createDocument('tbl_machine', newId, payload, MACHINE_INTEGER_FIELDS);
            state.raw.machines.push(payload);
            state.selectedMachineId = clean(newId);
            return payload;
        }

        const payload = {
            id: Number(machineId),
            brand_id: numberOrZero(brandId),
            model_id: numberOrZero(modelId),
            serial,
            description
        };
        await patchDocument('tbl_machine', machineId, payload, MACHINE_INTEGER_FIELDS);
        replaceLocalRow(state.raw.machines, machineId, payload);
        state.selectedMachineId = clean(machineId);
        return state.maps.machines.get(machineId) || { ...payload, id: Number(machineId) };
    }

    function collectContractPayload(contractId, contractDepId, machineId) {
        const beginningMeter = valueOf('beginningMeter');
        return {
            id: Number(contractId),
            contract_id: Number(contractDepId),
            mach_id: Number(machineId),
            machine_id: Number(machineId),
            brand_id: numberOrZero(resolveBrandId(valueOf('machineBrand'))),
            category_id: numberOrZero(valueOf('particularCode')),
            status: numberOrZero(valueOf('contractStatus')),
            xserial: valueOf('machineSerial').replace(/\s*\[\d+\]\s*$/, '').trim().toUpperCase(),
            pi: numberOrZero(valueOf('piAmount')),
            rd: numberOrZero(valueOf('rdAmount')),
            ap: numberOrZero(valueOf('apAmount')),
            contract_duration: valueOf('contractDuration'),
            b_meter: beginningMeter,
            starting_meter: numberOrZero(beginningMeter),
            terms: numberOrZero(valueOf('paymentTerms')),
            computers_installed: numberOrZero(valueOf('computerCount')),
            wifi: checked('ownedWifi') ? 1 : 0,
            usb: checked('ownedUsb') ? 1 : 0,
            scan_to_folder: checked('scanFolder') ? 1 : 0,
            scan_to_email: checked('scanEmail') ? 1 : 0,
            standalone: checked('ownedStandalone') ? 1 : 0,
            os_mac: checked('osMac') ? 1 : 0,
            os_windows: checked('osWindows') ? 1 : 0,
            pw_res: valueOf('passwordRestriction'),
            paper_type: valueOf('paperType'),
            monthly_quota: numberOrZero(valueOf('bwQuota')),
            page_rate: numberOrZero(valueOf('bwRate')),
            page_rate_xtra: numberOrZero(valueOf('bwXRate')),
            monthly_quota2: numberOrZero(valueOf('colorQuota')),
            page_rate2: numberOrZero(valueOf('colorRate')),
            page_rate_xtra2: numberOrZero(valueOf('colorXRate')),
            monthly_rate2: numberOrZero(valueOf('colorMeter')),
            preterm: numberOrZero(valueOf('preTerm')),
            fixed_rate: numberOrZero(valueOf('fixedRate')),
            monthly_rate: numberOrZero(valueOf('fixedRate')),
            withvat: checked('contractVatYes') ? 1 : 0,
            reading_date: valueOf('readingDate'),
            readingdate_set: valueOf('readingDate') ? 1 : 0,
            agent_id: numberOrZero(valueOf('contractAgent')),
            commision_rate: numberOrZero(valueOf('commission')),
            target_delivery: valueOf('deliveryDate'),
            date_installed: valueOf('installDate'),
            contractend_date: valueOf('contractEnd'),
            remarks: valueOf('contractRemarks'),
            update_remarks: valueOf('contractRemarks'),
            updated: 1,
            update_date: new Date().toISOString().slice(0, 19).replace('T', ' ')
        };
    }

    async function schedulePullout() {
        if (!state.selectedContractId) {
            MargaUtils.showToast('Select a contract before scheduling pullout.', 'error');
            return;
        }
        const payload = {
            id: Number(state.selectedContractId),
            status: 10,
            update_remarks: valueOf('contractRemarks') || 'For pullout',
            update_date: new Date().toISOString().slice(0, 19).replace('T', ' ')
        };
        try {
            await patchDocument('tbl_contractmain', state.selectedContractId, payload, CONTRACT_INTEGER_FIELDS, CONTRACT_DOUBLE_FIELDS);
            replaceLocalRow(state.raw.contracts, state.selectedContractId, payload);
            buildMaps();
            renderContractRows();
            fillContractForm(state.maps.contracts.get(state.selectedContractId));
            MargaUtils.showToast('Contract marked for pullout.', 'success');
        } catch (error) {
            MargaUtils.showToast(`Pullout schedule failed: ${error.message}`, 'error');
        }
    }

    function getSelectedBranchContracts() {
        if (!state.selectedBranchId) return [];
        return (state.maps.contractsByBranch.get(clean(state.selectedBranchId)) || [])
            .slice()
            .sort((a, b) => clean(a.id).localeCompare(clean(b.id), undefined, { numeric: true }));
    }

    function resolveContractBranch(contract) {
        if (!contract) return null;
        const contractDep = state.maps?.contractDeps?.get(clean(contract.contract_id));
        const branchId = clean(contractDep?.branch_id || contract.contract_id);
        return state.maps?.branches?.get(branchId) || null;
    }

    function firstBillInfoForBranch(branchId) {
        const rows = state.maps.billInfoByBranch.get(clean(branchId)) || [];
        return rows[0] || null;
    }

    function firstDeliveryInfoForBranch(branchId) {
        const rows = state.maps.deliveryInfoByBranch.get(clean(branchId)) || [];
        return rows[0] || null;
    }

    function firstCollectionInfoForBranch(branchId) {
        const rows = state.maps.collectionInfoByBranch.get(clean(branchId)) || [];
        return rows[0] || null;
    }

    function resolveSerial(contract, machine) {
        return clean(contract?.xserial) || clean(machine?.serial) || '';
    }

    function particularCode(id) {
        const row = state.raw.particulars.find((entry) => Number(entry.id) === Number(id));
        return row?.code || `#${id || '-'}`;
    }

    function particularLabel(row) {
        const code = clean(row.code || row.particular_code);
        const name = clean(row.name || row.description);
        return code && name ? `${code} - ${name}` : code || name || `Particular ${row.id}`;
    }

    async function createDocument(collection, docId, data, integerFields = new Set(), doubleFields = new Set()) {
        const params = new URLSearchParams({ documentId: clean(docId), key: FIREBASE_CONFIG.apiKey });
        const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}?${params.toString()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: toFirestoreFields(data, integerFields, doubleFields) })
        });
        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`Create ${collection}/${docId} failed (${response.status}) ${detail.slice(0, 160)}`);
        }
        return response.json();
    }

    async function patchDocument(collection, docId, data, integerFields = new Set(), doubleFields = new Set()) {
        const keys = Object.keys(data).filter((key) => data[key] !== undefined && key !== '_docId');
        const params = new URLSearchParams({ key: FIREBASE_CONFIG.apiKey });
        keys.forEach((key) => params.append('updateMask.fieldPaths', key));
        const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}/${encodeURIComponent(clean(docId))}?${params.toString()}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: toFirestoreFields(data, integerFields, doubleFields) })
        });
        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`Update ${collection}/${docId} failed (${response.status}) ${detail.slice(0, 160)}`);
        }
        return response.json();
    }

    function toFirestoreFields(data, integerFields, doubleFields) {
        const fields = {};
        Object.entries(data).forEach(([key, value]) => {
            if (value === undefined) return;
            if (value === null) {
                fields[key] = { nullValue: null };
            } else if (integerFields.has(key)) {
                fields[key] = { integerValue: String(numberOrZero(value)) };
            } else if (doubleFields.has(key)) {
                fields[key] = { doubleValue: Number(value || 0) || 0 };
            } else if (typeof value === 'boolean') {
                fields[key] = { booleanValue: value };
            } else if (typeof value === 'number') {
                if (Number.isInteger(value)) fields[key] = { integerValue: String(value) };
                else fields[key] = { doubleValue: value };
            } else {
                fields[key] = { stringValue: clean(value) };
            }
        });
        return fields;
    }

    function replaceLocalRow(rows, id, patch) {
        const index = rows.findIndex((row) => clean(row.id || row._docId) === clean(id));
        if (index >= 0) rows[index] = { ...rows[index], ...patch };
    }

    function nextNumericId(rows) {
        const max = rows.reduce((highest, row) => Math.max(highest, Number(row.id || row._docId || 0) || 0), 0);
        return String(max + 1);
    }

    function renderSelectOptions(id, rows, valueKey, labelFn) {
        const select = byId(id);
        if (!select) return;
        const getValue = typeof valueKey === 'function' ? valueKey : (row) => row[valueKey];
        const options = ['<option value=""></option>']
            .concat((rows || [])
                .filter(Boolean)
                .sort((a, b) => clean(labelFn(a)).localeCompare(clean(labelFn(b))))
                .map((row) => `<option value="${escapeAttr(getValue(row))}">${escapeHtml(labelFn(row))}</option>`));
        select.innerHTML = options.join('');
    }

    function renderSelectOptionsFromObject(id, object) {
        const select = byId(id);
        if (!select) return;
        select.innerHTML = Object.entries(object)
            .map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`)
            .join('');
    }

    function renderDatalist(id, rows, labelFn) {
        const list = byId(id);
        if (!list) return;
        list.innerHTML = (rows || [])
            .filter(Boolean)
            .sort((a, b) => clean(labelFn(a)).localeCompare(clean(labelFn(b))))
            .map((row) => `<option value="${escapeAttr(labelFn(row))}"></option>`)
            .join('');
    }

    function setStatus(text) {
        setText('customerStatusPill', text);
    }

    function companyPickerValue(company) {
        return `${companyName(company)} [${clean(company.id)}]`;
    }

    function companyName(company) {
        return clean(company?.companyname || company?.company_name || company?.name || '');
    }

    function brandName(brand) {
        return clean(brand?.brandname || brand?.brand_name || brand?.name || brand?.description || '');
    }

    function modelName(model) {
        return clean(model?.modelname || model?.model_name || model?.description || model?.name || '');
    }

    function areaName(area) {
        return clean(area?.area_name || area?.areaname || area?.name || area?.area || '');
    }

    function cityName(city) {
        return clean(city?.city_name || city?.cityname || city?.name || city?.city || '');
    }

    function cityNameFromId(cityId) {
        return cityName(state.maps.cities?.get(clean(cityId)));
    }

    function employeeName(employee) {
        return clean(employee?.employee_name || employee?.empname || employee?.fullname || [employee?.firstname, employee?.lastname].filter(Boolean).join(' ') || employee?.name || `Agent ${employee?.id || ''}`);
    }

    function machineOptionLabel(machine) {
        const serial = clean(machine.serial);
        const model = modelName(state.maps.models?.get(clean(machine.model_id))) || clean(machine.description);
        return `${serial || 'No serial'} - ${model || 'Machine'} [${clean(machine.id)}]`;
    }

    function findMachineBySerialValue(value) {
        const raw = clean(value);
        const idMatch = raw.match(/\[(\d+)\]\s*$/);
        if (idMatch) return state.maps.machines.get(idMatch[1]) || null;
        const serial = normalize(raw);
        return state.raw.machines.find((machine) => normalize(machine.serial) === serial) || null;
    }

    function resolveBrandId(value) {
        const raw = clean(value);
        const found = state.raw.brands.find((brand) => normalize(brandName(brand)) === normalize(raw));
        return clean(found?.id);
    }

    function resolveModelId(value) {
        const raw = clean(value);
        const found = state.raw.models.find((model) => normalize(modelName(model)) === normalize(raw));
        return clean(found?.id);
    }

    function cityIdFromName(value) {
        const city = state.raw.cities.find((row) => normalize(cityName(row)) === normalize(value));
        return numberOrZero(city?.id);
    }

    function formatBranchAddress(branch) {
        return [branch.room, branch.floor, branch.bldg, branch.street, branch.brgy, branch.city].filter(Boolean).join(', ');
    }

    function normalizeTimeValue(value) {
        const raw = clean(value);
        const match = raw.match(/(\d{1,2}):(\d{2})/);
        if (!match) return '';
        return `${match[1].padStart(2, '0')}:${match[2]}`;
    }

    function timeInputToLegacyDate(value) {
        const time = normalizeTimeValue(value);
        return time ? `2017-03-10 ${time}:00` : '';
    }

    function extractPhoneLike(value) {
        const raw = clean(value);
        const match = raw.match(/(?:\+?63|0)\d[\d\s-]{6,}/);
        return match ? match[0].trim().replace(/[^\d]+$/, '') : '';
    }

    function isEmailLike(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
    }

    function toDateInput(value) {
        const raw = clean(value);
        const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : '';
    }

    function valueOf(id) {
        return clean(byId(id)?.value);
    }

    function checked(id) {
        return Boolean(byId(id)?.checked);
    }

    function setInput(id, value, prop = 'value') {
        const el = byId(id);
        if (!el) return;
        el[prop] = value;
    }

    function setText(id, value) {
        const el = byId(id);
        if (el) el.textContent = value;
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function clean(value) {
        return String(value ?? '').trim();
    }

    function normalize(value) {
        return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
    }

    function numberOrZero(value) {
        const numeric = Number(clean(value).replace(/,/g, ''));
        return Number.isFinite(numeric) ? numeric : 0;
    }

    function optionText(id) {
        const select = byId(id);
        return clean(select?.selectedOptions?.[0]?.textContent);
    }

    function escapeHtml(value) {
        return MargaUtils.escapeHtml(clean(value));
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/"/g, '&quot;');
    }

    function toggleButton(id, disabled) {
        const button = byId(id);
        if (!button) return;
        button.disabled = Boolean(disabled);
        button.classList.toggle('is-busy', Boolean(disabled));
    }

    return {
        init,
        reload: loadAllData
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    if (window.MargaAuth && !MargaAuth.requireAccess('customers')) return;

    const user = window.MargaAuth?.getUser?.();
    if (user) {
        const userName = document.getElementById('userName');
        const userRole = document.getElementById('userRole');
        const userAvatar = document.getElementById('userAvatar');
        if (userName) userName.textContent = user.name;
        if (userRole) userRole.textContent = MargaAuth.getDisplayRoles(user);
        if (userAvatar) userAvatar.textContent = user.name.charAt(0).toUpperCase();
    }

    CustomersApp.init();
});

function toggleSidebar() {
    document.getElementById('sidebar')?.classList.toggle('open');
}
