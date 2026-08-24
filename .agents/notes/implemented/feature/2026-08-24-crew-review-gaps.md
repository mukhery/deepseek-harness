# Agent Note: Crew feature review — workspace-scoped verdict authority, in-progress reachability, and UI presentation

Status: implemented

## Problem

A review of the just-shipped Director-led crew feature — against `dsh-subagent`'s own conventions, external multi-agent frameworks (CrewAI, MetaGPT), and recent LLM multi-agent-orchestration literature — found three gaps between `ctx.crew`'s domain runtime and its model-facing tool surface, none reachable through this feature's own committed tests (see the [original design note](2026-08-20-director-led-crew.md) for the shipped design these gaps sit inside).

`CrewRuntime.verdict` checked a reviewer's role but not its workspace, unlike every other roster-authority check (`requireAssignable`) in the same file, so a reviewer hired into one workspace could — if handed a foreign ticket id — verdict a ticket belonging to a different workspace's crew.

`CrewTicketStatus`'s `in-progress` state and `CrewRuntime.startWork` were fully implemented and unit-tested at the domain layer, but no tool ever called `startWork`: every ticket skipped straight from `assigned` to `in-review`, leaving the board unable to distinguish an idle assignment from active work.

Every crew tool's model-facing `output.render` (`JSON.stringify` of the updated record) doubled as the only UI presentation, since none declared a `presentResult`. A human watching the session transcript saw a raw JSON blob for every crew action — the same weak baseline external multi-agent frameworks (CrewAI, MetaGPT, AutoGen Studio, LangGraph Studio) also start from and layer trace/graph UIs over, never a literal ticket board.

## Decision

`CrewRuntime.verdict` (`packages/crew/crew/src/index.ts`) now checks `ticket.workspaceId === reviewer.workspaceId` inside its `transition` callback, symmetric with `requireAssignable`'s existing check on `assignTicket`/`reassignTicket`, and throws the same `CrewAuthorityError` on mismatch.

`tool-crew-member` adds a `crew_start_work` tool wrapping `CrewRuntime.startWork`, given to every hireable working role (`researcher`/`strategist`/`engineer`, never `reviewer`) via `tool-crew-director`'s `CREW_TOOLS_BY_ROLE`; each working role's persona now tells it to call `crew_start_work` when it begins an assigned ticket. This is additive only — `crew_report` still accepts `assigned` directly, so a member that skips it loses nothing.

All nine crew tools (`crew_hire`, `crew_open_ticket`, `crew_assign_ticket`, `crew_board`, `crew_report`, `crew_start_work`, `crew_publish`, `crew_read_pool`, `crew_verdict`) keep their existing `output.render` (compact JSON, unchanged — model-facing ids stay exact for chaining into the next call, and the crew-director preset's own keyless snapshot fixture, which `JSON.parse`s tool-result text, needed no change) and add `output.presentationMeta: (_args, value) => value` plus a `presentResult` that turns the same canonical record into one short human-readable line (or, for `crew_board`/`crew_read_pool`, one line per roster member/ticket/message) — the identity-projection pattern `dsh-tool-fs`'s `read`/`write`/`edit` already use for structural (not textual) result data. `presentResult` returns `undefined` on `result.isError`, matching `write.ts`/`edit.ts`, so an error result keeps the ordinary error-text fallback.

## Alternatives considered

**Changing `output.render` itself to human-readable prose instead of adding `presentResult`.** Tried first, then rejected: the crew-director preset's own keyless snapshot fixture (`apps/web/tests/crew-director-preset.snapshot.ts`) parses `crew_open_ticket`/`crew_board`'s tool-result text as JSON to assert on ticket ids, and more fundamentally the Director model needs exact, reliably-parseable ids to chain `crew_assign_ticket`/`crew_verdict` calls — degrading that to prose for a UI-only benefit would trade a model-facing regression for a UI-only fix, exactly what `docs/cookbook/adding-a-tool.md`'s own render/presentResult split exists to avoid.

**A dedicated `card: 'board'` UI render-intent (a new `ToolCallView`/`ToolResultView` union member, wire schema, and React component) for a literal kanban view of the roster/ticket board.** Rejected for this change: research into CrewAI/MetaGPT/AutoGen Studio/LangGraph Studio's own UIs found no existing multi-agent framework renders a literal ticket-board card either — all default to trace/timeline/graph views of message and execution flow — so there is no reference design to converge on, and a new card kind is a materially larger, riskier surface (schema + wire + every client) than the gap (raw JSON) justifies on its own. The `presentResult`/`GenericResultView.content` mechanism already in `dsh-tools` fully replaces the raw-JSON symptom; a dedicated board card remains available as later, separately-justified work if a maintainer wants the richer view.

**Recording which reviewer verdicted a ticket (a new `reviewerSessionId` ticket field), for audit accountability.** Considered, not built: no current consumer reads it, `crew_board`'s roster already names the workspace's hired reviewer(s), and adding a durable-schema field beyond what this review's actual findings required risked the scope creep the repository's "Require a current owner and need" rule warns against.

## Consequences

Bought: `verdict` now upholds the same workspace-scoping invariant every other crew mutation already enforced, closing a real (if narrow) cross-workspace authority gap; the `in-progress` ticket status the domain layer already modeled and tested is now reachable through the actual tool surface, so `crew_board` can show whether an assigned ticket has been picked up; every crew tool call now has a legible one-line UI presentation instead of a raw JSON dump. Cost: one more function per tool (`presentResult`) and the small fixed cost of the `presentationMeta` identity projection on every call. None of this changes the durable domain schema (`crewDomainSpec` stays at `version: 1`) or any tool's model-facing JSON result shape, so no fixture beyond ordinary unit-test updates was required.
