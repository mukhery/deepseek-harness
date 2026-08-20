# Crew

Workspace-scoped roster, ticket ledger, and message pool for a Director-led crew of long-running agents pursuing one project. The [Director-led crew Agent Note](../../.agents/notes/implemented/feature/2026-08-20-director-led-crew.md) owns the design rationale — why crew state is a `ctx.storage.domain` domain scoped by `WorkspaceId` rather than session-log events, why `KvTable.update`'s own write chain replaces a hand-rolled compare-and-set field, and why a ticket's `done` status is reachable only through independent review. `ctx.crew`'s exact method signatures, input types, and record shapes are documented at [`packages/crew/crew/README.md`](../../packages/crew/crew/README.md) and its source (`packages/crew/crew/src/index.ts`, `src/types.ts`, `src/spec.ts`).

Three tables in one process-wide `crew` domain: `roster` (keyed by a hired continuable subagent's `SessionId`), `tickets` (keyed by a generated `CrewTicketId`), and `messages` (keyed by a generated `CrewMessageId`) — every record self-scoped by an explicit `workspaceId` field, the same per-record scoping [`dsh-workspace`](workspace.md) uses for its own `WorkspaceRecord`s.

The model-facing surface lives entirely in three consumer packages, not this service: [`dsh-tool-crew-director`](../../packages/crew/tool-crew-director/README.md), [`dsh-tool-crew-member`](../../packages/crew/tool-crew-member/README.md), and [`dsh-tool-crew-review`](../../packages/crew/tool-crew-review/README.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcrew--crewruntime"></a>

### `ctx.crew` — `CrewRuntime`

Crew roster, ticket-ledger, and message-pool runtime. Opens the single process-wide `crew` domain at startup; every method takes an explicit `workspaceId` (directly, or via the ticket/roster record it loads) rather than reading ambient state, matching the domain's per-record scoping.

```ts cordis-catalog
/**
 * Record a newly hired continuable subagent's durable role binding. The
 * caller publishes the child through `ctx.subagents.startContinuable()`
 * first; this only records the roster fact once that session id exists.
 * @param input - Workspace, hired session id, role, and durable label.
 * @returns the stored roster record.
 */
async hire(input: CrewHireInput): Promise<CrewRosterRecord>

/**
 * List every roster member hired into one workspace's crew.
 * @param workspaceId - Workspace to list.
 * @returns roster records in insertion order.
 */
roster(workspaceId: WorkspaceId): CrewRosterRecord[]

/**
 * Open a new ticket in `open` status, unassigned.
 * @param input - Workspace, title, objective, and role scope.
 * @returns the stored ticket record.
 */
async openTicket(input: CrewOpenTicketInput): Promise<CrewTicketRecord>

/**
 * Assign an `open` ticket to a roster member hired into the ticket's role.
 * @param ticketId - Ticket to assign.
 * @param memberSessionId - Roster member to assign it to.
 * @returns the updated ticket record.
 */
async assignTicket(ticketId: CrewTicketId, memberSessionId: SessionId): Promise<CrewTicketRecord>

/**
 * Mark an assigned ticket as actively being worked.
 * @param ticketId - Ticket to advance.
 * @param memberSessionId - Caller, who must be the recorded assignee.
 * @returns the updated ticket record.
 */
async startWork(ticketId: CrewTicketId, memberSessionId: SessionId): Promise<CrewTicketRecord>

/**
 * Submit a working ticket's evidence for independent review. Only the
 * recorded assignee may submit; this never sets `done` — only
 * {@link verdict}'s `accept` outcome does.
 * @param ticketId - Ticket to submit.
 * @param memberSessionId - Caller, who must be the recorded assignee.
 * @param evidence - Cited evidence (branch/diff summary, findings, etc.).
 * @param summary - Short closing summary of what was done.
 * @returns the updated ticket record.
 */
async submitForReview( ticketId: CrewTicketId, memberSessionId: SessionId, evidence: string, summary: string, ): Promise<CrewTicketRecord>

/**
 * Mark a working ticket blocked, pending resolution (typically a human
 * escalation) before it can be reassigned or continue.
 * @param ticketId - Ticket to block.
 * @param memberSessionId - Caller, who must be the recorded assignee.
 * @param reason - Why the ticket cannot proceed.
 * @returns the updated ticket record.
 */
async submitBlocked(ticketId: CrewTicketId, memberSessionId: SessionId, reason: string): Promise<CrewTicketRecord>

/**
 * Reassign a `blocked` or `open` ticket to a roster member — typically
 * called once a blocker is resolved (an escalation was answered).
 * @param ticketId - Ticket to reassign.
 * @param memberSessionId - Roster member to assign it to.
 * @returns the updated ticket record.
 */
async reassignTicket(ticketId: CrewTicketId, memberSessionId: SessionId): Promise<CrewTicketRecord>

/**
 * Independently verdict an `in-review` ticket. This is the sole path that
 * can set `done`, and the sole path that can attach `prUrl` — a caller
 * accepting an engineering ticket after opening its PR passes `prUrl` in
 * the same call, so the ledger's `done` state and its PR fact commit
 * together. A `reject` returns the ticket directly to `assigned` for the
 * same assignee with the rationale attached as new context, rather than
 * resting in a separate terminal status. The caller must be hired into the
 * `reviewer` role — this check lives here, not only in which tool a
 * deployment happens to expose, so a role misconfiguration cannot grant
 * verdict authority.
 * @param ticketId - Ticket to verdict.
 * @param reviewerSessionId - Reviewer session recording the verdict.
 * @param outcome - `accept` closes the ticket; `reject` reopens it.
 * @param rationale - The reviewer's reasoning, always recorded.
 * @param prUrl - Opened pull request URL; only meaningful with `accept`.
 * @returns the updated ticket record.
 */
async verdict( ticketId: CrewTicketId, reviewerSessionId: SessionId, outcome: 'accept' | 'reject', rationale: string, prUrl?: string, ): Promise<CrewTicketRecord>

/**
 * Look up one ticket, synchronously from memory.
 * @param ticketId - Ticket id.
 * @returns the ticket record, or `undefined` when unknown.
 */
ticket(ticketId: CrewTicketId): CrewTicketRecord | undefined

/**
 * List every ticket open in one workspace.
 * @param workspaceId - Workspace to list.
 * @returns ticket records in insertion order.
 */
tickets(workspaceId: WorkspaceId): CrewTicketRecord[]

/**
 * Publish one structured message to the workspace's pool.
 * @param input - Workspace, topic, kind, publisher, and body.
 * @returns the stored message record.
 */
async publish(input: CrewPublishInput): Promise<CrewMessageRecord>

/**
 * Read the workspace's message pool, optionally filtered by topic and
 * publish time, oldest first.
 * @param filter - Workspace, optional topic allowlist, optional lower bound.
 * @returns matching message records in publish order.
 */
readPool(filter: CrewReadPoolFilter): CrewMessageRecord[]
```

Types: [SessionId](core.md) · [WorkspaceId](workspace.md)

Source: [`packages/crew/crew/src/index.ts:135`](../../packages/crew/crew/src/index.ts)
<!-- END GENERATED cordis-surface -->
