# ERP Module and Master-Data Boundaries

## Mandatory architecture rule

Keep General Masters, Materials/DME Masters, Stores Masters, Inventory operations, and all future module masters separately organized. Do not create one mixed "Masters" screen or place every new master in the General Masters menu. A module owns its operational master data; other modules may reference it through stable IDs and approved lookup APIs.

## Navigation groups

### 1. General Masters
Shared, cross-module reference data only, such as:
- Units of measure and approved conversion rules
- Geography and address reference data
- Shared document numbering configuration (with module-specific series)
- Shared tax codes/rates where applicable and permissioned
- Common people/organization references only where a canonical shared master is intentionally designed

General Masters must not become a dumping ground for department-specific records.

### 2. Materials / DME Masters
Owned by Materials / Design & Manufacturing Engineering:
- Item/material master
- Item class, subclass and item type
- Base and alternate UOM assignment on items
- Batch/serial tracking settings, drawing/revision metadata and material-specific attributes

UOM definitions can be shared General Masters; item-to-UOM assignments remain owned by Materials/DME.

### 3. Stores & Inventory
Keep setup masters and transactions distinct within this module:
- Stores Masters: warehouse, storage location/bin, stock status/reason codes, store-specific handling configuration
- Inventory Operations: stock balance inquiry, movement ledger, goods receipt, material issue, stock transfer, stock adjustment, opening stock and reservations
- Transaction documents and stock ledger are operational records, not General Masters.

### 4. Future module-owned masters
Create their own group and ownership boundaries when each module is introduced. Examples:
- Procurement & Supplier: supplier master, supplier purchasing settings, approved supplier-item relationships
- Sales & CRM: customer master, sales areas, customer-specific commercial settings
- Production & Work Orders: work centres, routings, production resources
- BOM & Engineering: BOM structures, revisions, effectivity and engineering change records
- Quality: inspection plans, defects, sampling and disposition codes
- Dispatch & Logistics: transporter, carrier service, route and freight/rate masters
- Finance & Costing: chart of accounts, cost centres and financial configuration
- HRMS: employee, attendance, shift and payroll masters

These are future examples, not a claim that all are already implemented. Shared entities must have one canonical owner; avoid duplicate supplier/customer/employee records across modules.

## Technical requirements for every new module
1. Tenant/company scope every business record and validate scope on the server.
2. Enforce role and module permissions through Supabase RLS and server-side actions; UI hiding is not security.
3. Use foreign keys to canonical master IDs rather than copying names/codes into other modules except for intentional historical snapshots.
4. Keep module-specific CRUD, validation, search, status lifecycle and audit trail within the owning module.
5. Use soft deactivation where records may be referenced by history; never silently delete referenced records.
6. Separate configuration/master records from transactional records and reporting projections.
7. Never let browser clients directly mutate derived stock balances or append ledger entries outside the approved transactional posting path.
8. Expose typed, permission-checked tools for the shared AI architecture. Do not invent AI behavior for a module until its use case and allowed autonomy are defined by the user.
9. Add migrations, constraints, RLS policies, tests and documentation with each new module; do not assume a policy exists because a table has RLS enabled.
10. Preserve the current visual system and dark/light toggle while keeping the navigation grouped and responsive.

## Current menu placement
- General Masters: UOM Master (shared unit definitions only).
- Materials / DME Masters: Materials Master, Class Master, Subclass Master, Item Type Master.
- Stores & Inventory: Warehouse & Locations (setup masters) and Inventory & Stock (read-only inquiry until transactional posting is safely implemented).

## Delivery rule
For every upcoming phase, first define the module boundary, master ownership, tables, relationships, permissions, and workflows. Then implement the module independently and integrate it through stable references. Do not merge unrelated masters just to reuse a screen.
