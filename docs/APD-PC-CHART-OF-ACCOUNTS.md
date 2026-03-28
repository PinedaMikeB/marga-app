# APD And Petty Cash Shared Chart Of Accounts Reference

Last Updated: 2026-03-28

Purpose: give APD and future petty cash encoders one shared reference so they choose the correct account and avoid mixing expenses, liabilities, assets, and owner withdrawals.

## How To Use This Reference
- Use the `Meaning` column to understand what the account represents.
- Use the `Use This When` column before encoding a bill, voucher, or liquidation line.
- Check the `Do Not Use For` column when two account names look similar.
- If the transaction is only a transfer of money between cash locations, do not post it as expense.

| Account Name | Type | Meaning | Use This When | Do Not Use For |
| --- | --- | --- | --- | --- |
| Fuel and Delivery Expense | Expense | Fuel used in company delivery, messenger, logistics, or technician trips. | Gasoline or diesel used for delivery, messenger runs, or business travel tied to operations. | Motorcycle repair, spare parts, private fuel, or tolls if you want a separate toll account later. |
| Rental Service Supplies Expense | Expense | Parts, toner, ink, and supplies consumed to support machines under rental package. | The cost is already consumed for customer support and should now be recognized as expense. | Buying stock that will stay in inventory, machine asset purchases, or office supplies unrelated to rental service. |
| Bank Loans (Payable) | Liability | Outstanding principal owed to a bank. | Loan principal amortization or payment against the remaining bank loan balance. | Interest expense, bank charges, or supplier installments. |
| Accounts Payable - Installment Arrangement | Liability | Supplier obligation that is being settled by installments after the original due date. | A supplier balance is formally being paid in parts over time. | Ordinary daily expense with no payable schedule, bank loans, or employee reimbursement. |
| Petty Cash Fund | Asset | Cash on hand assigned to petty cash custodian for small daily disbursements. | Establishing petty cash, replenishing the petty cash box, or tracking outstanding petty cash balance. | Final expense posting before liquidation, owner withdrawal, or bank loan payment. |
| Cash in Bank - Savings | Asset | Company money kept in savings account. | Depositing excess cash to savings or recognizing funds held in savings. | Operating expense, personal withdrawal, or payable settlement unless savings is the payment source. |
| Owner's Drawings | Equity | Money taken by owner from business funds for personal use. | Cash withdrawal or use of company funds by owner that is not a business expense. | Payroll, supplier bills, rent, utilities, or any operating expense. |
| Salaries and Wages Expense | Expense | Compensation cost for employee labor. | Payroll expense, salary payout, wage release, or salary accrual recognition. | Owner withdrawal, supplier payment, or government contribution remittance by itself. |
| Rental Machines and Equipment | Fixed Asset | Machines bought by the company for rental deployment or change-unit pool. | Acquisition of copier, printer, or machine unit intended for rental use. | Toner, parts, repair, routine maintenance, or one-time service expense. |
| Rent Expense | Expense | Cost of leasing office or operating space. | Monthly office rent or other recurring facility lease cost. | Repairs, deposits, utilities, or machine rent paid by customers. |
| Electricity Expense | Expense | Power cost for office or operating facility. | Electric bills for business premises. | Generator fuel, internet, phone, or equipment purchase. |
| Telephone Expense | Expense | Landline or call-related communication cost. | Telephone bills, call plans, or voice subscription charges. | Internet-only service or mobile device purchase. |
| Internet Expense | Expense | Internet connectivity cost for business operations. | Broadband, fiber, or data connectivity subscription for office use. | Telephone-only service, equipment purchase, or one-time installation asset cost. |
| Repairs and Maintenance - Leased Premises | Expense | Repair and upkeep cost for rented office or rented facilities. | Small repair and maintenance work on leased business premises. | Rent, new asset construction, or motorcycle repair. |
| Repairs and Maintenance - Motorcycles | Expense | Repair and upkeep cost of motorcycles used by technicians or messengers. | Oil change, tire replacement, tune-up, and similar maintenance of company motorcycles. | Fuel, new motorcycle acquisition, or building/facility repair. |
| Employer PhilHealth Contribution Expense | Expense | Employer share of PhilHealth contribution cost. | Recognizing the company expense portion of PhilHealth contribution. | The unpaid balance due to PhilHealth, employee salary, or other government agencies. |
| PhilHealth Payable | Liability | Amount still due to PhilHealth for remittance. | Recording or settling unpaid PhilHealth contribution liability. | Employer expense recognition if the liability has not been set up yet. |
| Employer Pag-IBIG Contribution Expense | Expense | Employer share of Pag-IBIG or HDMF contribution cost. | Recognizing the company expense portion for Pag-IBIG contribution. | The unpaid amount due to HDMF, employee salary, or PhilHealth remittance. |
| HDMF Payable | Liability | Amount still due to Home Development Mutual Fund or Pag-IBIG. | Recording or settling unpaid Pag-IBIG or HDMF liability. | Employer expense recognition or owner withdrawal. |

## High-Risk Confusion Points
- `Petty Cash Fund` is not an expense. The expense is recognized only when petty cash is liquidated into specific accounts.
- `Bank Loans (Payable)` is for principal. Interest should not be mixed into the same line if you want accurate loan reporting.
- `Rental Machines and Equipment` is an asset account, not an expense account.
- `Owner's Drawings` must be kept separate from `Salaries and Wages Expense`.
- `Employer PhilHealth Contribution Expense` and `PhilHealth Payable` are not the same. One is expense, the other is the remaining liability.
- `Employer Pag-IBIG Contribution Expense` and `HDMF Payable` are not the same. One is expense, the other is the unpaid amount due.
