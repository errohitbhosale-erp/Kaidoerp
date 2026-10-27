# Swiza ERP AI Agent Architecture

## Product requirement

AI agents are a first-class capability across the manufacturing ERP. Every module should be designed so it can expose safe, typed tools to the shared agent runtime. Do not implement disconnected module-specific chatbots.

## Architecture

1. **ERP AI Orchestrator** — classifies a user's request, selects the permitted specialist agent, manages context, and returns a traceable answer.
2. **Specialist agents** — Materials/DME, BOM & Engineering, Inventory & Stores, Procurement & Supplier, Production & Work Orders, Sales & CRM, Quality, Dispatch & Logistics, Finance & Costing, HRMS, and MIS.
3. **Tool registry** — typed server-side functions for reading approved ERP data and requesting validated actions. Agents must never generate arbitrary SQL or receive database service-role credentials.
4. **Policy and tenant boundary** — authenticate the user; resolve the active tenant/company from trusted membership records; check role, module entitlement, and action-specific permission on the server for every tool call.
5. **Approval workflow** — mutations with operational, financial, compliance, or safety impact create approval requests. A separate authorized action confirms and executes them; model output alone is never authorization.
6. **Audit and observability** — persist request metadata, selected agent, tool names, status, latency, errors, model/provider metadata where available, recommendations, approvals, and action results. Avoid storing secrets or unnecessary sensitive prompts.
7. **Knowledge layer** — retrieve only records the current user is allowed to access. Treat item descriptions, uploaded documents, emails, and other retrieved text as untrusted input, never as instructions that override system policy.

## Agent maturity levels

- **Level 0 — Explain:** answer questions about approved ERP data and explain fields/workflows.
- **Level 1 — Analyse:** calculate metrics from source records, identify exceptions, compare periods, and show evidence.
- **Level 2 — Recommend:** draft actions such as reorder proposals, supplier comparisons, BOM suggestions, and production-risk mitigation.
- **Level 3 — Prepare:** create a draft or pending approval request, without committing the business transaction.
- **Level 4 — Execute approved actions:** execute only a validated, explicitly approved action after rechecking permissions and current database state.
- **Level 5 — Governed automation:** execute narrowly scoped, reversible, policy-bound automations with limits, monitoring, idempotency, and a kill switch. This level must be enabled per company and per workflow.

## Manufacturing agent responsibilities

| Agent | Initial responsibilities |
| --- | --- |
| Central ERP Orchestrator | Route questions, preserve context, summarize results, enforce tool policy |
| Materials & DME | Description interpretation, item classification suggestions, dimensional completeness, theoretical-weight estimates with assumptions |
| BOM & Engineering | Multilevel BOM analysis, revision comparisons, missing-component detection, alternate suggestions |
| Inventory & Stores | Stock visibility, reservation/shortage checks, discrepancy and low-stock alerts |
| Procurement & Supplier | Reorder proposals, open-PO consideration, lead-time risk, supplier scorecard analysis |
| Production & Work Orders | Material readiness, work-order risk, capacity and bottleneck analysis |
| Quality | Inspection trend analysis, defect categorization, corrective-action drafts |
| Sales & CRM | Quote/order analysis, delivery commitment risk, customer follow-up drafts |
| Dispatch & Logistics | Shipment exception analysis, tracking summaries, freight comparison |
| Finance & Costing | Cost variance analysis, reconciliation assistance, invoice checks; no autonomous posting initially |
| HRMS | Attendance and staffing summaries subject to strict HR permissions |
| MIS | Cross-module reports and natural-language questions, restricted to the user's data scope |

## Required data model for the runtime

Before enabling a live model, implement and test tenant-scoped records for:
- Agent configuration and enablement by company/module.
- Agent runs and their lifecycle/status.
- Tool execution traces.
- Recommendations and evidence references.
- Approval requests, approver, decision, expiry, and execution status.
- Audit events and failure details.

Use UUID identifiers, timestamps, idempotency keys for mutations, strict foreign keys, RLS, and server-side authorization. Never store provider API keys in browser code or public Vite environment variables.

## Rollout plan

### Phase A — Foundation (current)
- Preserve existing Materials and Class/Subclass/Item Type functionality.
- Confirm schema, roles, RLS, and current deployment branch.
- Define agent contracts, data boundaries, audit/approval model, and provider-secret strategy.
- Keep production unchanged.

### Phase B — Secure agent runtime
- Implement server-side model calls (for example, a Supabase Edge Function or another trusted server runtime).
- Store model/provider credentials only as server-side secrets.
- Add request validation, rate limits, timeouts, structured output validation, and safe error handling.
- Start with read-only tools and a Materials/DME assistant.

### Phase C — Human-reviewed recommendations
- Add evidence-backed recommendations and an approval inbox.
- Require explicit confirmation and recheck authorization/data state at execution time.
- Test tenant isolation and deny unauthorized tools.

### Phase D — Expand by module
- Add specialist agents incrementally, each with its own typed tools, permission matrix, test cases, and owner.
- Add Inventory, Procurement, BOM/Engineering, Production, Quality, Sales, Dispatch, Finance, HRMS, and MIS in sequence based on available data models.

### Phase E — Governed automation
- Enable only specific workflows with thresholds, approval policies, auditability, rollback/compensation strategy, monitoring, and a company-level kill switch.

## Acceptance criteria

- A user cannot read or mutate another company's data through an agent.
- Agent output never grants permission; server-side policies are authoritative.
- A model cannot directly issue SQL or bypass normal business validation.
- Business mutations are idempotent and auditable.
- Consequential actions require an approval record and revalidation at execution.
- Unknown, conflicting, or incomplete engineering specifications are surfaced as questions, not silently guessed.
- AI recommendations cite the relevant ERP records or clearly label assumptions.
- Existing ERP screens and workflows continue to work if the AI provider is unavailable.
