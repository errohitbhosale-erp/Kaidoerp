# Stores & Inventory Module

## Included screens
- **Warehouse & Locations** — company-scoped warehouse/bin CRUD; database-enforced same-warehouse parent hierarchy and cycle prevention.
- **Stock Transactions** — draft creation/editing, submission, approval, posting, document preview and print. Draft saves use one atomic RPC. Posted movements are immutable through this workflow.
- **Inventory & Stock** — stock balances, movement ledger and weighted-average valuation status.
- **Reorder Levels** — company/item/warehouse minimum, reorder quantity, optional maximum, lead time, notes, enable/disable, and available-quantity alerts. Alerts are advisory; they do not create purchase orders.
- **Stock Reconciliation** — read-only comparison of balances with valuation quantities; mismatches and unvalued items are flagged without auto-correction.
- **Materials Master** — source of item code, base UOM and batch/serial tracking attributes.

## Supported transaction types
OPENING, GRN, PURCHASE_RETURN, PRODUCTION_ISSUE, PRODUCTION_RETURN, SUBCON_OUT, SUBCON_IN, ADJUSTMENT_IN, ADJUSTMENT_OUT, DISPATCH, CUSTOMER_RETURN, SCRAP.

Stock transfers remain disabled until the transaction line model can explicitly represent both source and destination warehouses/locations. Do not emulate transfers with a single-location transaction.

## Stock and costing controls
- Only approved documents can post; posting requires the company Stores/Admin role.
- Posting updates stock balances, stock ledger and weighted-average valuation atomically.
- Generated available quantity is calculated by the database and must not be inserted or updated directly.
- Batch and serial tracked items are validated during submission/posting. Batch and serial outbound availability is checked at the selected location.
- Valuation is not inferred from the item's standard rate. Items without an explicit valuation remain uninitialized.
- Reorder settings are company scoped, protected by RLS, and validated against item and warehouse ownership.
- Reconciliation is report-only; investigate differences and correct them through approved stock documents, not direct table edits.

## Recommended setup sequence
1. Verify company users/roles and base UOMs.
2. Review Materials Master, item tracking flags and active status.
3. Set up warehouse and bin/location hierarchy.
4. Establish opening balances through controlled opening stock documents, including explicit unit cost.
5. Post a receipt and confirm stock ledger, balance and valuation agree.
6. Configure reorder thresholds for critical item/warehouse pairs.
7. Review reconciliation and validate the document preview/print output.
8. Train users on creator submission, separate approval where required, and controlled posting.

## Important scope boundaries
- No fake stock is seeded by this module.
- No direct inventory balance editing is exposed.
- Reorder alerts do not create purchase orders automatically.
- Transfers, reservations, physical count/cycle count, barcode scanning, supplier/PO/GRN matching, and subcontract challan reconciliation need their own complete data/workflows before being enabled.
- Currency display currently uses INR; company currency configuration is a separate setup dependency.
