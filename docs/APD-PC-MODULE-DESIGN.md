# APD And Petty Cash Module Design

Last Updated: 2026-03-28

## Core Recommendation
- Keep `Accounts Payable and Disbursement (APD)` and `Petty Cash (PC)` as two separate modules.
- APD should handle supplier payables, invoice/SOA planning, check vouchers, check printing, installment schedules, and payment proof.
- Petty Cash should handle small daily cash releases, liquidation, replenishment, and transfers back to bank.
- Do not classify every cash outflow as an expense. Some transactions are assets, liabilities, equity draws, or cash transfers.

## Suggested Account Names

| Business Item | Suggested Account Name | Type | Design Note |
| --- | --- | --- | --- |
| Gasoline for messengers and logistics | Fuel and Delivery Expense | Expense | Split later into `Fuel Expense - Messengers` and `Fuel Expense - Logistics` if needed. |
| Parts, toners, and inks used under rental package | Rental Service Supplies Expense | Expense | If you stock these first, purchase into `Inventory - Parts and Supplies` then expense only when issued. |
| Payment for bank loans | Bank Loan Payable - Current / Bank Loan Payable - Noncurrent | Liability | Principal payment is not expense. Record interest separately in `Interest Expense - Bank Loans`. |
| Payment for suppliers on late installment terms | Accounts Payable - Trade / Accounts Payable - Installment Arrangement | Liability | Keep the original supplier invoice, due date, and installment schedule. Record penalties or finance charges separately. |
| Petty cash used for daily expenses | Petty Cash Fund | Asset | Releasing petty cash is not yet expense. Expense is recognized during liquidation by line item. |
| Deposit from petty cash into business savings account | Cash in Bank - Savings | Asset | Treat as cash transfer, not expense. |
| Withdrawal from petty cash for owner/personal use | Owner's Drawings / Due from Owner | Equity or Receivable | Do not book personal withdrawal as business operating expense. |
| Payroll | Salaries and Wages Expense | Expense | Pair with `Payroll Payable`, taxes payable, and contribution payables when unpaid. |
| Machines purchased for rental or change unit | Rental Machines and Equipment | Fixed Asset | Do not expense directly. Add `Accumulated Depreciation - Rental Machines` and `Depreciation Expense - Rental Machines`. |
| Rental office | Rent Expense | Expense | Use one account unless you need branch-level splits later. |
| Electricity | Electricity Expense | Expense | Utility expense. |
| Phone bills | Telephone Expense | Expense | Separate from internet for clearer reporting. |
| Internet | Internet Expense | Expense | Separate from phone for clearer reporting. |
| Repairs of rented facilities | Repairs and Maintenance - Leased Premises | Expense | Use for office/facility upkeep only. |
| Repairs and maintenance of motorcycles | Repairs and Maintenance - Motorcycles | Expense | Keep separate from fuel for fleet control. |
| Employer SSS share | Employer SSS Contribution Expense | Expense | Liability side should be `SSS Payable`. |
| Employer PhilHealth share | Employer PhilHealth Contribution Expense | Expense | Liability side should be `PhilHealth Payable`. |
| Employer Pag-IBIG / HDMF share | Employer Pag-IBIG Contribution Expense | Expense | Liability side should be `Pag-IBIG Payable` or `HDMF Payable`. |

## Core APD Accounts To Support

### Assets
- Petty Cash Fund
- Cash in Bank - Operating
- Cash in Bank - Savings
- Inventory - Parts and Supplies
- Rental Machines and Equipment
- Accumulated Depreciation - Rental Machines

### Liabilities
- Accounts Payable - Trade
- Accounts Payable - Installment Arrangement
- Bank Loan Payable - Current
- Bank Loan Payable - Noncurrent
- Payroll Payable
- SSS Payable
- PhilHealth Payable
- Pag-IBIG Payable
- HDMF Payable
- Withholding Tax Payable

### Expenses
- Fuel and Delivery Expense
- Rental Service Supplies Expense
- Interest Expense - Bank Loans
- Penalties and Surcharges Expense
- Salaries and Wages Expense
- Rent Expense
- Electricity Expense
- Telephone Expense
- Internet Expense
- Repairs and Maintenance - Leased Premises
- Repairs and Maintenance - Motorcycles
- Employer SSS Contribution Expense
- Employer PhilHealth Contribution Expense
- Employer Pag-IBIG Contribution Expense
- Depreciation Expense - Rental Machines

## APD Module Scope
- Vendor and payee master
- Manual invoice and SOA entry
- Due-date planning and aging
- Check voucher creation and approval
- Check printing with strict series control
- Installment schedule tracking for loans and supplier settlements
- Payment posting with OR or receipt reference
- Attachment of invoice, SOA, check copy, and receipt

## Petty Cash Module Scope
- Petty cash fund setup per cashier or branch
- Daily cash release vouchers
- Expense liquidation with receipt attachment
- Replenishment request and approval
- Transfer of excess cash back to bank
- Owner draw or non-operating withdrawal classification
- Daily petty cash balance and unreplenished items

## Required Controls
- One check number must map to one disbursement record.
- Skipped, voided, and spoiled check numbers must require a reason and approver.
- A payment should not reach `Released` without payee, amount, and source document.
- APD should store invoice number, SOA number, due date, payment date, check number, bank, and OR number.
- Official receipt details should be attachable after payment release.
- Petty cash releases should not hit expense accounts until liquidation details are entered.
- Bank loan payments must separate principal from interest.
- Machine purchases must post to fixed asset accounts first.

## Suggested Status Flow

### APD
- Draft
- For Approval
- Approved for Payment
- For Check Printing
- Printed
- Released
- Cleared
- Voided

### Petty Cash
- Released
- Partially Liquidated
- Fully Liquidated
- For Replenishment
- Replenished
- Transferred

## Suggested Next Build Sequence
1. Add APD as a first-class module in permissions and settings.
2. Define the APD bill header and bill line schema.
3. Define the check register schema with status history.
4. Define petty cash voucher and liquidation schema.
5. Map legacy SQL finance tables before allowing any finance writeback from web.
