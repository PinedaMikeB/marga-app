const MargaExpenseLineItemUi = (() => {
    const Catalog = () => window.MargaExpenseRequestCatalog;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function defaultClasses(prefix = 'entry-item') {
        return {
            quantity: `${prefix}-quantity`,
            model: `${prefix}-model`,
            partNoteSelect: `${prefix}-note-select`,
            partNoteManual: `${prefix}-note-manual`,
            partNoteCell: `${prefix}-note-cell`,
            partNoteText: `${prefix}-note-text`
        };
    }

    function buildQuantityInputHtml(quantity = 1, className = 'entry-item-quantity') {
        const value = Math.max(0, Number(quantity || 1) || 1);
        return `<input type="number" class="${escapeHtml(className)}" min="1" step="1" placeholder="1" value="${escapeHtml(String(value))}">`;
    }

    function buildModelSelectHtml(groupId, model = '', className = 'entry-item-model') {
        const catalog = Catalog();
        if (!catalog) {
            return `<select class="${escapeHtml(className)}"><option value="NA" selected>NA</option></select>`;
        }
        const resolvedGroup = catalog.resolveGroupId(groupId);
        const applicable = catalog.isModelApplicable(resolvedGroup);
        if (!applicable) {
            return `<select class="${escapeHtml(className)}" disabled><option value="NA" selected>NA</option></select>`;
        }
        const normalizedModel = String(model || '').trim();
        const options = catalog.getModelOptions();
        const selected = normalizedModel && normalizedModel !== 'NA' ? normalizedModel : '';
        return `
            <select class="${escapeHtml(className)}" required>
                <option value="">Select model</option>
                ${options.map((label) => `
                    <option value="${escapeHtml(label)}"${label === selected ? ' selected' : ''}>${escapeHtml(label)}</option>
                `).join('')}
            </select>
        `;
    }

    function buildPartNoteHtml(groupId, itemNote = '', options = {}) {
        const catalog = Catalog();
        const classes = { ...defaultClasses(options.classPrefix || 'entry-item'), ...(options.classes || {}) };
        const resolvedGroup = catalog?.resolveGroupId(groupId) || String(groupId || '').trim();
        const protectedOptions = catalog?.getPartNoteOptions(resolvedGroup) || [];
        const normalizedNote = String(itemNote || '').trim();

        if (catalog?.isProtectedPartNoteGroup(resolvedGroup) && protectedOptions.length) {
            const selected = protectedOptions.includes(normalizedNote) ? normalizedNote : '';
            return `
                <div class="expense-part-note-picker">
                    <select class="${escapeHtml(classes.partNoteSelect)}" required>
                        <option value="">Select part / product</option>
                        ${protectedOptions.map((label) => `
                            <option value="${escapeHtml(label)}"${label === selected ? ' selected' : ''}>${escapeHtml(label)}</option>
                        `).join('')}
                    </select>
                </div>
            `;
        }

        if (options.inventoryLabels?.length) {
            const labels = options.inventoryLabels;
            const matchedLabel = labels.find((label) => label === normalizedNote) || '';
            const forceManual = !labels.length || (normalizedNote && !matchedLabel);
            const selectedValue = matchedLabel || (forceManual ? '__manual__' : '');
            return `
                <div class="expense-part-note-picker">
                    <select class="${escapeHtml(classes.partNoteSelect)}">
                        <option value="">Select actual item</option>
                        ${labels.map((label) => `
                            <option value="${escapeHtml(label)}"${label === selectedValue ? ' selected' : ''}>${escapeHtml(label)}</option>
                        `).join('')}
                        <option value="__manual__"${selectedValue === '__manual__' ? ' selected' : ''}>Manual entry</option>
                    </select>
                    <input
                        type="text"
                        class="${escapeHtml(classes.partNoteManual)}${selectedValue === '__manual__' ? '' : ' hidden'}"
                        placeholder="Type item manually"
                        value="${escapeHtml(selectedValue === '__manual__' ? normalizedNote : '')}"
                    >
                </div>
            `;
        }

        return `<input type="text" class="${escapeHtml(classes.partNoteText)}" placeholder="Item / part note" value="${escapeHtml(normalizedNote)}">`;
    }

    function readPartNoteFromRow(row, classPrefix = 'entry-item') {
        if (!row) return '';
        const classes = defaultClasses(classPrefix);
        const select = row.querySelector(`.${classes.partNoteSelect}`);
        if (select) {
            const selectedValue = String(select.value || '').trim();
            if (selectedValue && selectedValue !== '__manual__') return selectedValue;
            const manualInput = row.querySelector(`.${classes.partNoteManual}`);
            return String(manualInput?.value || '').trim();
        }
        const textInput = row.querySelector(`.${classes.partNoteText}`);
        return String(textInput?.value || '').trim();
    }

    function readModelFromRow(row, groupId, classPrefix = 'entry-item') {
        const catalog = Catalog();
        const classes = defaultClasses(classPrefix);
        const resolvedGroup = catalog?.resolveGroupId(groupId) || String(groupId || '').trim();
        if (!catalog?.isModelApplicable(resolvedGroup)) return 'NA';
        return String(row.querySelector(`.${classes.model}`)?.value || '').trim();
    }

    function readQuantityFromRow(row, classPrefix = 'entry-item') {
        const classes = defaultClasses(classPrefix);
        const raw = Number(row.querySelector(`.${classes.quantity}`)?.value || 1);
        return Math.max(1, raw || 1);
    }

    function readLineItemFromRow(row, classPrefix = 'entry-item') {
        const groupInput = row.querySelector(classPrefix === 'entry-item' ? '.entry-item-group' : '.field-reimbursement-group');
        const accountInput = row.querySelector(classPrefix === 'entry-item' ? '.entry-item-account' : '.field-reimbursement-account');
        const supplierInput = row.querySelector(classPrefix === 'entry-item' ? '.entry-item-supplier' : '.field-reimbursement-supplier');
        const amountInput = row.querySelector(classPrefix === 'entry-item' ? '.entry-item-amount' : '.field-reimbursement-amount');
        const groupId = String(groupInput?.value || '').trim();
        return {
            expenseGroup: groupId,
            groupId,
            accountId: String(accountInput?.value || '').trim(),
            quantity: readQuantityFromRow(row, classPrefix),
            model: readModelFromRow(row, groupId, classPrefix),
            itemNote: readPartNoteFromRow(row, classPrefix),
            supplier: String(supplierInput?.value || '').trim(),
            amount: Number(amountInput?.value || 0)
        };
    }

    function applyGroupChangeToRow(row, classPrefix = 'entry-item', inventoryResolver) {
        const catalog = Catalog();
        if (!row || !catalog) return;
        const classes = defaultClasses(classPrefix);
        const groupInput = row.querySelector(classPrefix === 'entry-item' ? '.entry-item-group' : '.field-reimbursement-group');
        const groupId = String(groupInput?.value || '').trim();
        const noteCell = row.querySelector(`.${classes.partNoteCell}`);
        const modelCell = row.querySelector('[data-expense-model-cell]');
        const inventoryLabels = typeof inventoryResolver === 'function' ? inventoryResolver(groupId) : [];
        if (noteCell) {
            noteCell.innerHTML = buildPartNoteHtml(groupId, '', { classPrefix, inventoryLabels });
        }
        if (modelCell) {
            modelCell.innerHTML = buildModelSelectHtml(groupId, '', classes.model);
        }
    }

    function toggleManualPartNote(row, classPrefix = 'entry-item') {
        const classes = defaultClasses(classPrefix);
        const select = row?.querySelector(`.${classes.partNoteSelect}`);
        const manualInput = row?.querySelector(`.${classes.partNoteManual}`);
        if (!select || !manualInput) return;
        const showManual = select.value === '__manual__';
        manualInput.classList.toggle('hidden', !showManual);
        if (!showManual) manualInput.value = '';
    }

    function buildDraftQuantityInputHtml(quantity = 1) {
        const value = Math.max(1, Number(quantity || 1) || 1);
        return `<input type="number" data-reimbursement-draft-field="quantity" min="1" step="1" placeholder="1" value="${escapeHtml(String(value))}">`;
    }

    function buildDraftModelSelectHtml(groupId, model = '') {
        const html = buildModelSelectHtml(groupId, model, 'reimbursement-draft-model');
        return html.replace('<select class="', '<select data-reimbursement-draft-field="model" class="');
    }

    function buildDraftPartNoteHtml(groupId, itemNote = '') {
        const html = buildPartNoteHtml(groupId, itemNote, { classPrefix: 'reimbursement-draft' });
        if (html.includes('reimbursement-draft-note-select')) {
            return html.replace(
                '<select class="reimbursement-draft-note-select"',
                '<select data-reimbursement-draft-field="itemNote" class="reimbursement-draft-note-select"'
            );
        }
        if (html.includes('reimbursement-draft-note-text')) {
            return html.replace(
                '<input type="text" class="reimbursement-draft-note-text"',
                '<input type="text" data-reimbursement-draft-field="itemNote" class="reimbursement-draft-note-text"'
            );
        }
        return html;
    }

    return {
        buildQuantityInputHtml,
        buildModelSelectHtml,
        buildPartNoteHtml,
        buildDraftQuantityInputHtml,
        buildDraftModelSelectHtml,
        buildDraftPartNoteHtml,
        readPartNoteFromRow,
        readModelFromRow,
        readQuantityFromRow,
        readLineItemFromRow,
        applyGroupChangeToRow,
        toggleManualPartNote,
        defaultClasses
    };
})();

window.MargaExpenseLineItemUi = MargaExpenseLineItemUi;
