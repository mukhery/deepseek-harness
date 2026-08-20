# Agent Note: Director-led crew roster, ticket ledger, and message pool

Status: implemented

## Problem

A user pursuing one large-scale, open-ended objective — "continuously optimize this SaaS website: research, roadmap, ship features" — over weeks needs several cooperating roles (research, strategy, engineering, review), not one chat session. `dsh-subagent` already gives durable, cold-resumable children and parent-child messaging; `dsh-goal` already gives one session's objective persistence with automatic continuation; `dsh-schedule` already gives a live session periodic reminders. None of that infrastructure tracks a durable work item across a roster, lets peers publish structured findings without relaying through one parent, or requires independent review before work counts as done — `dsh-goal` and `dsh-tool-ralph`'s own READMEs both note the caller that reports completion is the same caller that certifies it.

The state this needs also outlives any one session: several sessions in one project (a standing orchestrator thread, ad hoc steering threads a user opens later, escalation threads the crew opens to ask a question) must all see the same roster and ticket ledger. Event-sourcing that state into one session's log — the shape `dsh-goal` uses — does not fit a fact owned by many sessions at once.

## Decision

`@deepseek-ai/dsh-crew` (`packages/crew/crew/`) opens one process-wide `crew` domain over `ctx.storage.domain` and exposes `ctx.crew`. This is the same seam `dsh-workspace` itself is built on: one domain instance holds every project's records, and each roster/ticket/message record carries an explicit `workspaceId` field rather than the domain being opened once per workspace (`DomainFacility.open` is single-open per domain *name*, so N workspaces cannot mean N domain instances — `dsh-workspace`'s own domain already holds every `WorkspaceRecord` the same way).

Three tables: `roster` (keyed by the hired continuable subagent's `SessionId`), `tickets` (keyed by a generated `CrewTicketId`), `messages` (keyed by a generated `CrewMessageId`). `CrewRole` (`director | researcher | strategist | engineer | reviewer`) is a fixed, non-configurable union: role identity decides transition and (at the tool layer, not yet built) call authority, so it is a protocol constant, not a deployment tunable, the same status a tool name has.

Ticket status is `open → assigned → in-progress → in-review → done`, plus `blocked` as a side branch reassignable back to `assigned`. `done` is reachable **only** through `verdict('accept', …)`; no other method can set it. `verdict('reject', …)` returns an `in-review` ticket directly to `assigned` for the same assignee with the reviewer's rationale attached, rather than resting in a separate terminal `rejected` status nothing exits — a deliberate simplification of the original plan's six-state diagram once "reject reopens the ticket with the rationale as new context" turned out to fully describe the desired behavior without a state nothing else transitions out of. `assignTicket`/`reassignTicket` check the assignee's roster role and workspace before writing; `startWork`/`submitForReview`/`submitBlocked` check the calling session against the ticket's own recorded `assigneeSessionId` — enforcement lives in the service that owns the transition, not only in which tool a preset happens to expose, per the repository's "enforce a decision in the operation that makes it" rule.

Concurrency safety for multiple simultaneous Director-preset sessions comes from `KvTable.update`'s existing per-domain write chain: the transform function sees the value current at its queue slot, so two racing `assignTicket` calls on the same ticket serialize automatically and the loser's status precondition fails against the winner's already-committed write. No additional compare-and-set revision field was layered on top, unlike `dsh-goal`'s `GoalRef { id, revision }` — that field exists there because a session's *own* mutation calls are not already queued through a shared write chain the way a domain table's are.

The package's own invariant (`./invariant`) watches `domain/changed` for `crew`/`tickets` puts and fails loud if a landed ticket names an `assigneeSessionId` absent from that workspace's roster — the one cross-table relationship a direct domain write (bypassing `ctx.crew`) could otherwise violate silently.

## Scope of this change

Only the domain service (`@deepseek-ai/dsh-crew`) ships in this change: `hire`/`roster`, the full ticket lifecycle, and `publish`/`readPool`. The model-facing tool packages (`tool-crew-director`, `tool-crew-member`, `tool-crew-review`), the five role presets, the escalation-thread mechanism, worktree/PR wiring, and the web client's workspace-scoped ticket board and PR panel are follow-up work described in the plan this note accompanies; they compose this service rather than changing it.

## Alternatives considered

**One `crew` domain opened per workspace, named e.g. `crew:<workspaceId>`.** Rejected: domain names are a static, process-wide namespace (`already-open` on a repeat name), so this would need a dynamic per-workspace domain name — fighting the seam's actual shape rather than using the one `dsh-workspace` itself demonstrates (one domain, many workspace-scoped records).

**Event-sourcing crew state into the standing Director session's own log, mirroring `dsh-goal`'s `goal/change` events.** Rejected once the design admitted multiple simultaneous Director-preset sessions (the standing thread, ad hoc steering threads, escalation threads): a fact several sessions must read and write cannot correctly live in any one of their logs.

**A hand-rolled `Ref { id, revision }` compare-and-set field on every record, mirroring `dsh-goal`.** Rejected as redundant: `KvTable.update` already serializes concurrent writers on the same key through the domain's single write chain, so a second, hand-maintained revision counter would duplicate machinery the storage layer already provides without adding a capability.

**A `rejected` resting ticket status, matching the plan's original six-state sketch.** Rejected during implementation: nothing in the design ever transitions a ticket *out of* `rejected` through a distinct action — the plan's own narrative ("reject reopens the ticket... with the rationale as new context") describes an immediate, atomic reopen. Modeling that as status `assigned` plus a `verdictRationale` field avoids a state with no reachable exit.

## Consequences

Bought: a workspace-wide crew fact that any number of sessions can safely share and mutate without a new persistence mechanism, reusing exactly the seam `dsh-workspace` already proved out. Cost: every `ctx.crew` caller must pass an explicit `workspaceId` (or load one from a ticket/roster record) rather than reading it from ambient session state, since the domain itself carries no notion of "the current session's workspace" — that resolution belongs to the tool layer built on top, not yet part of this change.
