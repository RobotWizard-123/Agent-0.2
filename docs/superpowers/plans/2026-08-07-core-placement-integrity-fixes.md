# Core Placement Integrity Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the confirmed placement, recommendation, authorization, concurrency, and alarm-state defects without weakening deterministic hard constraints.

**Architecture:** Keep the existing repository, planning engine, constraint engine, and plan-service boundaries. Add validation and inventory fingerprints at the domain boundary, make confirmation a persisted two-phase workflow, and make every recommendation metric use one documented penalty direction. Preserve the V0.2 one-confirmation contract and compatibility read APIs.

**Tech Stack:** Node.js 22 ESM, built-in `node:test`, Python CP-SAT adapter, Playwright.

**Status:** Completed and verified on 2026-08-07.

## Global Constraints

- Deterministic rules remain the final safety boundary; Agent output cannot bypass them.
- Every state-changing plan has exactly one final confirmation.
- Missing capacity facts remain unknown and must not silently become zero.
- Viewer accounts remain read-only.
- CP-SAT failure continues to fall back to Beam Search.
- Production changes follow red-green-refactor; no source change precedes its failing regression test.

---

### Task 1: Placement input and post-execution integrity

**Files:**
- Modify: `tests/plan-service.test.js`
- Modify: `tests/api-v02.test.js`
- Modify: `tests/agent-schema.test.js`
- Modify: `src/agent/agent-schema.js`
- Modify: `src/planning/planning-engine.js`
- Modify: `src/domain/constraint-engine.js`
- Modify: `src/workflows/simulated-execution-adapter.js`

**Interfaces:**
- Produces: strict normalized placement facts and `evaluateState(state)`.
- Consumes: existing `normalizePlacementCount`, `evaluateActions`, and plan creation workflow.

- [x] Add regression tests proving negative/non-finite capacity facts are rejected, missing Agent facts are rejected, and a client-supplied `cancelled` placement cannot bypass overlap validation.
- [x] Run `node --test tests/agent-schema.test.js tests/plan-service.test.js tests/api-v02.test.js` and verify the new tests fail for the confirmed behaviors.
- [x] Make Agent extraction require explicit finite non-negative power, weight, and port facts; make structured planning reject negative/non-finite values with stable `PLACEMENT_DEVICE_INVALID` or `PLACEMENT_FACTS_INCOMPLETE` errors.
- [x] Make `applyActions()` impose server-owned placement status after copying device facts, validate all numeric device capacity fields, and add `evaluateState(state)` for full post-write validation.
- [x] Update the simulated executor to call `evaluateState(projected)` and rerun the focused tests until green.

### Task 2: Persisted confirmation lock and alarm compensation

**Files:**
- Modify: `tests/plan-service.test.js`
- Modify: `tests/alarms.test.js`
- Modify: `src/workflows/plan-service.js`
- Modify: `src/alarms/diagnosis-engine.js`

**Interfaces:**
- Produces: a two-phase `confirm(id, actor)` that persists `locked/executing` before calling `executor.execute`.
- Produces: alarm confirmation compensation from `executing` back to `action_pending` on thrown plan errors.

- [x] Add a delayed-executor concurrency test asserting two confirmation calls invoke the executor exactly once.
- [x] Add an alarm test asserting a blocked remediation returns the alarm to `action_pending`.
- [x] Run the two focused test files and verify both new tests fail for the expected reasons.
- [x] Persist confirmation count, actor, validation, lock, execution token, and `executing` state in a CAS mutation before invoking the executor; finalize success or failure in a second mutation.
- [x] Wrap remediation confirmation in compensation logic and rerun the focused tests until green.

### Task 3: Authorization and Agent candidate semantics

**Files:**
- Modify: `tests/auth.test.js`
- Modify: `tests/plan-service.test.js`
- Modify: `src/http-app.js`
- Modify: `src/workflows/plan-service.js`

**Interfaces:**
- Consumes: existing session role checks and validated Agent adjustment contract.
- Produces: admin-only candidate selection and deterministic `candidate_id` precedence.

- [x] Add an authenticated API regression test asserting a viewer receives 403 from `select-candidate`.
- [x] Add plan-service tests asserting a known Agent `candidate_id` becomes the final candidate and an unknown ID cannot influence selection through weight multipliers.
- [x] Run the focused tests and verify they fail with the current 200/ignored-selection behavior.
- [x] Add the route to the admin policy and implement explicit candidate precedence with atomic rejection of unknown requested candidates.
- [x] Rerun the focused tests until green.

### Task 4: Recommendation metric and rejection evidence consistency

**Files:**
- Create: `src/planning/placement-metrics.js`
- Modify: `src/planning/planning-engine.js`
- Modify: `src/planning/strategy-scorer.js`
- Modify: `src/planning/cp-sat-slots.js`
- Modify: `src/planning/candidate-generator.js`
- Modify: `src/planning/migration-planner.js`
- Modify: `tests/strategy-scorer.test.js`
- Modify: `tests/cp-sat-slots.test.js`
- Modify: `tests/planning.test.js`

**Interfaces:**
- Produces: shared `continuityPenalty(largestContiguousU)` and unusable-fragment evidence.
- Produces: bounded rejection-code aggregation from deterministic validator failures.

- [x] Add monotonicity tests asserting larger contiguous capacity never receives a worse continuity penalty, and a power-only infeasible room reports `RACK_POWER_EXCEEDED` instead of `NO_CONTIGUOUS_INTERVAL`.
- [x] Run the focused planning tests and verify the new assertions fail.
- [x] Share the continuity penalty between Beam scoring and CP-SAT slot costs; compute slot-specific left/right residual intervals rather than one cost per source interval.
- [x] Capture and aggregate hard-constraint rejection codes while keeping candidate API limits bounded.
- [x] Rerun the focused planning tests until green.

### Task 5: Inventory staleness and blocked-plan consistency

**Files:**
- Modify: `src/workflows/plan-service.js`
- Modify: `tests/plan-service.test.js`
- Modify: `tests/api-v02.test.js`

**Interfaces:**
- Produces: persisted `inventory_fingerprint` on every plan.
- Consumes: racks, devices, power connections, and network connections as the inventory snapshot.

- [x] Add tests asserting audit/settings-only mutations do not stale a plan, inventory mutations do stale it, and duplicate-ID blockers are persisted and audited.
- [x] Run the focused tests and verify current global-version and early-return behavior fails the new contract.
- [x] Compute a stable SHA-256 inventory fingerprint, use it for selection/confirmation staleness checks, and keep repository versions only for CAS writes.
- [x] Replace the duplicate-ID early return with a normal persisted blocked plan carrying actor, validation, and audit evidence.
- [x] Rerun the focused tests until green.

### Task 6: Regression and UI contract cleanup

**Files:**
- Modify: `public/js/views/placement-plan.js`
- Inspect only: legacy `src/adopt-placement.js`, `src/batch-engine.js`, `src/data-store.js`, and `data/*.json`.

**Interfaces:**
- Produces: solver label compatible with the existing E2E contract.
- Does not delete compatibility files without a separate migration decision.

- [x] Update the Beam label to retain the English contract while remaining understandable in Chinese.
- [x] Run `npm.cmd test` and require zero failures, allowing only the environment-gated OR-Tools skip.
- [x] Run `npm.cmd run test:e2e` and require all 14 browser tests to pass.
- [x] Run `npm.cmd run test:solver` and report the actual dependency/runtime result.
- [x] Record legacy write-chain deletion as a separate cleanup because removal is not required for the integrity fixes and may affect external imports.

## Self-Review

- Spec coverage: integrity bypass, input facts, confirmation locking, alarm compensation, authorization, Agent selection, metric consistency, rejection evidence, staleness, blocked-plan persistence, and E2E contract are covered.
- Placeholder scan: no deferred implementation placeholders are used; legacy deletion is explicitly out of scope rather than left unspecified.
- Type consistency: plan fingerprints are strings; placement penalties are numeric 0–100 values; existing public plan and candidate shapes remain backward compatible.
