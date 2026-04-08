const MargaFinanceAccounts = (() => {
    const STORAGE_KEY = 'marga_apd_accounts_v1';

    const DEFAULT_ACCOUNTS = [
        {
            id: 'fuel_delivery_expense',
            name: 'Fuel and Delivery Expense',
            type: 'Expense',
            scope: 'shared',
            meaning: 'Fuel used for messenger, logistics, delivery, and field business trips.',
            useWhen: 'Use for gasoline or diesel used in company operations.',
            avoid: 'Do not use for repairs, private use, or parts replacement.'
        },
        {
            id: 'gasoline_expense',
            name: 'Gasoline Expense',
            type: 'Expense',
            scope: 'pettycash',
            meaning: 'Gasoline purchases for company cars, motorcycles, and field service travel.',
            useWhen: 'Use when you need gasoline tracked separately from diesel.',
            avoid: 'Do not use for diesel, commute fare, or non-fuel repairs.'
        },
        {
            id: 'diesel_expense',
            name: 'Diesel Expense',
            type: 'Expense',
            scope: 'pettycash',
            meaning: 'Diesel purchases for company vehicles, delivery units, or generators if diesel monitoring must stay separate.',
            useWhen: 'Use when the receipt is specifically diesel and you want diesel totals separate from gasoline.',
            avoid: 'Do not use for gasoline, commute fare, or vehicle repairs.'
        },
        {
            id: 'commute_fare_expense',
            name: 'Commute Fare Expense',
            type: 'Expense',
            scope: 'pettycash',
            meaning: 'Public transport, taxi, tricycle, jeep, bus, or similar reimbursable business travel fares.',
            useWhen: 'Use for employee or messenger transport fares paid from petty cash.',
            avoid: 'Do not use for gasoline, diesel, or vehicle maintenance.'
        },
        {
            id: 'fuel_expense_delivery_van',
            name: 'Fuel Expense - Delivery Van',
            type: 'Expense',
            scope: 'pettycash',
            meaning: 'Fuel cost assigned to company delivery vans or similar service vans.',
            useWhen: 'Use for van fuel while the item group records whether the fuel was gasoline or diesel.',
            avoid: 'Do not use for motorcycles, commute fare, or non-fuel vehicle costs.'
        },
        {
            id: 'fuel_expense_motorcycle',
            name: 'Fuel Expense - Motorcycle',
            type: 'Expense',
            scope: 'pettycash',
            meaning: 'Fuel cost assigned to company motorcycles used by technicians or messengers.',
            useWhen: 'Use for motorcycle fuel while the item group records whether the fuel was gasoline or diesel.',
            avoid: 'Do not use for vans, commute fare, or motorcycle repairs.'
        },
        {
            id: 'rental_service_supplies_expense',
            name: 'Rental Service Supplies Expense',
            type: 'Expense',
            scope: 'shared',
            meaning: 'Parts, toner, ink, and rental-package supplies already consumed for customer support.',
            useWhen: 'Use when the stock has already been issued and should now hit expense.',
            avoid: 'Do not use for inventory purchases that are still on hand or for machine assets.'
        },
        {
            id: 'printer_repair_parts_field_expense',
            name: 'Printer Repair Parts Expense - Field Service',
            type: 'Expense',
            scope: 'pettycash',
            meaning: 'Parts bought and immediately used to repair printers or copiers during field service work.',
            useWhen: 'Use for rollers, gears, sensors, fusers, springs, and similar repair parts consumed in on-site work.',
            avoid: 'Do not use for workshop-only jobs, toner, ink, or stocked inventory not yet consumed.'
        },
        {
            id: 'printer_repair_parts_workshop_expense',
            name: 'Printer Repair Parts Expense - Workshop',
            type: 'Expense',
            scope: 'pettycash',
            meaning: 'Parts bought and immediately used for printer or copier repair jobs done in the workshop.',
            useWhen: 'Use when the repair part is consumed in internal bench or workshop repairs.',
            avoid: 'Do not use for field-only jobs, toner, ink, or inventory purchases that remain unused.'
        },
        {
            id: 'toner_expense',
            name: 'Toner Expense',
            type: 'Expense',
            scope: 'pettycash',
            meaning: 'Toner purchases that should be monitored separately from parts and ink.',
            useWhen: 'Use for toner bottles, toner powder, or toner cartridges consumed or urgently bought through petty cash.',
            avoid: 'Do not use for printer repair parts, liquid ink, or stocked inventory not yet consumed.'
        },
        {
            id: 'ink_expense',
            name: 'Ink Expense',
            type: 'Expense',
            scope: 'pettycash',
            meaning: 'Ink purchases that should be monitored separately from toner and repair parts.',
            useWhen: 'Use for liquid ink, ink refills, or ink bottles consumed through petty cash.',
            avoid: 'Do not use for toner, printer repair parts, or inventory still on hand.'
        },
        {
            id: 'office_supplies_expense',
            name: 'Office Supplies Expense',
            type: 'Expense',
            scope: 'pettycash',
            meaning: 'Pens, paper, folders, tapes, cleaning materials, and other regular office supplies.',
            useWhen: 'Use for petty cash purchases of ordinary office-use materials.',
            avoid: 'Do not use for printer repair parts, toner, ink, or machine assets.'
        },
        {
            id: 'other_materials_expense',
            name: 'Other Materials Expense',
            type: 'Expense',
            scope: 'pettycash',
            meaning: 'Small operating materials that do not fit the dedicated toner, ink, parts, or office supplies accounts.',
            useWhen: 'Use only when no more specific petty cash material account fits the purchase.',
            avoid: 'Do not use when the item clearly belongs to parts, toner, ink, office supplies, gasoline, diesel, or commute fare.'
        },
        {
            id: 'meal_allowance_expense_field_operations',
            name: 'Meal Allowance Expense - Field Operations',
            type: 'Expense',
            scope: 'pettycash',
            meaning: 'Meal allowance released to field technicians, messengers, or other field operations staff.',
            useWhen: 'Use for approved field meal allowance paid through petty cash.',
            avoid: 'Do not use for snacks, personal meals without approval, or fuel.'
        },
        {
            id: 'staff_welfare_snacks_expense',
            name: 'Staff Welfare / Snacks Expense',
            type: 'Expense',
            scope: 'pettycash',
            meaning: 'Small approved snack or staff-welfare expense such as office fellowship or Bible study snacks.',
            useWhen: 'Use for approved snacks or simple staff welfare items paid by petty cash.',
            avoid: 'Do not use for meal allowance, office supplies, or unapproved personal purchases.'
        },
        {
            id: 'bank_loans_payable',
            name: 'Bank Loans (Payable)',
            type: 'Liability',
            scope: 'apd',
            meaning: 'Outstanding bank loan principal still owed.',
            useWhen: 'Use for principal amortization against a bank loan.',
            avoid: 'Do not use for interest, penalties, or supplier installments.'
        },
        {
            id: 'accounts_payable_installment_arrangement',
            name: 'Accounts Payable - Installment Arrangement',
            type: 'Liability',
            scope: 'apd',
            meaning: 'Supplier balances being paid by installments after the original due date.',
            useWhen: 'Use when APD is tracking a supplier settlement with scheduled installments.',
            avoid: 'Do not use for bank loans or direct daily expenses with no payable schedule.'
        },
        {
            id: 'petty_cash_fund',
            name: 'Petty Cash Fund',
            type: 'Asset',
            scope: 'pettycash',
            meaning: 'Cash fund assigned to the petty cash custodian.',
            useWhen: 'Use when creating, replenishing, or transferring to petty cash.',
            avoid: 'Do not use as the final expense account before liquidation.'
        },
        {
            id: 'cash_in_bank_savings',
            name: 'Cash in Bank - Savings',
            type: 'Asset',
            scope: 'shared',
            meaning: 'Company funds deposited and held in the savings account.',
            useWhen: 'Use when moving money into savings or identifying funds currently held there.',
            avoid: 'Do not use for operating expenses or owner withdrawals.'
        },
        {
            id: 'owners_drawings',
            name: "Owner's Drawings",
            type: 'Equity',
            scope: 'shared',
            meaning: 'Business funds withdrawn by the owner for personal use.',
            useWhen: 'Use only for personal withdrawals by the owner.',
            avoid: 'Do not use for payroll, supplier bills, or operating expenses.'
        },
        {
            id: 'salaries_wages_expense',
            name: 'Salaries and Wages Expense',
            type: 'Expense',
            scope: 'shared',
            meaning: 'Employee compensation cost for payroll.',
            useWhen: 'Use for payroll expense and approved wage-related payouts.',
            avoid: 'Do not use for owner withdrawals or government contribution liabilities alone.'
        },
        {
            id: 'rental_machines_equipment',
            name: 'Rental Machines and Equipment',
            type: 'Fixed Asset',
            scope: 'apd',
            meaning: 'Machine units purchased for rental deployment or change-unit pool.',
            useWhen: 'Use when the company buys a machine unit that will stay as a business asset.',
            avoid: 'Do not use for toner, parts, repairs, or routine maintenance.'
        },
        {
            id: 'rent_expense',
            name: 'Rent Expense',
            type: 'Expense',
            scope: 'shared',
            meaning: 'Cost of leasing office or operating facilities.',
            useWhen: 'Use for monthly rental of office or premises.',
            avoid: 'Do not use for repair work or leasehold improvements.'
        },
        {
            id: 'electricity_expense',
            name: 'Electricity Expense',
            type: 'Expense',
            scope: 'shared',
            meaning: 'Power cost for business facilities.',
            useWhen: 'Use for electric utility bills.',
            avoid: 'Do not use for fuel or internet charges.'
        },
        {
            id: 'telephone_expense',
            name: 'Telephone Expense',
            type: 'Expense',
            scope: 'shared',
            meaning: 'Voice call or landline communication cost.',
            useWhen: 'Use for telephone-only subscriptions or call charges.',
            avoid: 'Do not use for internet-only service.'
        },
        {
            id: 'internet_expense',
            name: 'Internet Expense',
            type: 'Expense',
            scope: 'shared',
            meaning: 'Internet connectivity cost for office operations.',
            useWhen: 'Use for broadband, fiber, or business internet subscriptions.',
            avoid: 'Do not use for telephone-only service or device purchases.'
        },
        {
            id: 'repairs_maintenance_leased_premises',
            name: 'Repairs and Maintenance - Leased Premises',
            type: 'Expense',
            scope: 'shared',
            meaning: 'Repair and upkeep cost for rented business premises.',
            useWhen: 'Use for repair and maintenance of office or leased facility.',
            avoid: 'Do not use for rent, new construction, or motorcycle repairs.'
        },
        {
            id: 'repairs_maintenance_motorcycles',
            name: 'Repairs and Maintenance - Motorcycles',
            type: 'Expense',
            scope: 'shared',
            meaning: 'Repair and upkeep cost of motorcycles used by technicians or messengers.',
            useWhen: 'Use for tire replacement, oil change, tune-up, and similar maintenance.',
            avoid: 'Do not use for fuel or purchase of a new motorcycle.'
        },
        {
            id: 'employer_philhealth_contribution_expense',
            name: 'Employer PhilHealth Contribution Expense',
            type: 'Expense',
            scope: 'apd',
            meaning: 'Employer share of PhilHealth contribution cost.',
            useWhen: 'Use when recognizing the company share of PhilHealth contribution.',
            avoid: 'Do not use when recording the unpaid remittance liability.'
        },
        {
            id: 'philhealth_payable',
            name: 'PhilHealth Payable',
            type: 'Liability',
            scope: 'apd',
            meaning: 'Unpaid PhilHealth amount due for remittance.',
            useWhen: 'Use when recording or paying the PhilHealth balance still owed.',
            avoid: 'Do not use as the employer expense line.'
        },
        {
            id: 'employer_pagibig_contribution_expense',
            name: 'Employer Pag-IBIG Contribution Expense',
            type: 'Expense',
            scope: 'apd',
            meaning: 'Employer share of Pag-IBIG or HDMF contribution cost.',
            useWhen: 'Use when recognizing the company share of Pag-IBIG contribution.',
            avoid: 'Do not use for the unpaid balance still due to HDMF.'
        },
        {
            id: 'hdmf_payable',
            name: 'HDMF Payable',
            type: 'Liability',
            scope: 'apd',
            meaning: 'Unpaid Pag-IBIG or HDMF amount still owed for remittance.',
            useWhen: 'Use when recording or paying the HDMF balance due.',
            avoid: 'Do not use as the employer expense line.'
        }
    ];

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeAccount(account) {
        return {
            id: String(account?.id || '').trim(),
            name: String(account?.name || '').trim(),
            type: String(account?.type || 'Expense').trim(),
            scope: String(account?.scope || 'shared').trim().toLowerCase(),
            meaning: String(account?.meaning || '').trim(),
            useWhen: String(account?.useWhen || '').trim(),
            avoid: String(account?.avoid || '').trim()
        };
    }

    function getStoredAccounts() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return getDefaultAccounts();
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return getDefaultAccounts();
            const stored = parsed.map(normalizeAccount);
            const merged = new Map(getDefaultAccounts().map((account) => [account.id, account]));
            stored.forEach((account) => {
                if (account.id) {
                    merged.set(account.id, account);
                }
            });
            return [...merged.values()];
        } catch (error) {
            console.warn('Failed to read shared finance accounts:', error);
            return getDefaultAccounts();
        }
    }

    function getDefaultAccounts() {
        return clone(DEFAULT_ACCOUNTS).map(normalizeAccount);
    }

    function formatScope(scope) {
        if (scope === 'apd') return 'APD Only';
        if (scope === 'pettycash') return 'Petty Cash Relevant';
        return 'Shared';
    }

    return {
        STORAGE_KEY,
        getStorageKey: () => STORAGE_KEY,
        getDefaultAccounts,
        getStoredAccounts,
        normalizeAccount,
        formatScope
    };
})();

window.MargaFinanceAccounts = MargaFinanceAccounts;
