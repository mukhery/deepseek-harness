# @deepseek-ai/dsh-crew

Workspace-scoped crew roster, ticket ledger, and message pool (`ctx.crew`) for one project's crew of long-running agents. One process-wide `crew` domain serves every workspace; every roster/ticket/message record is self-scoped by an explicit `workspaceId` field — the same per-record scoping shape [`dsh-workspace`](../../workspace/workspace/README.md)'s own domain uses for its many `WorkspaceRecord`s, not one domain instance per workspace. This is what lets any number of Director-preset sessions in one workspace (the standing thread, ad hoc steering threads, escalation threads) safely share and mutate the same crew state.

See [the Director-led crew Agent Note](../../../.agents/notes/implemented/feature/2026-08-20-director-led-crew.md) for why the domain lives per-record rather than per-session, why `KvTable.update`'s own write-chain serialization replaces a hand-rolled compare-and-set field, and why `done` is reachable only through `verdict`.

## Service contract

`ctx.crew` (`CrewRuntime`) opens the single `crew` domain over `ctx.storage.domain` at startup and exposes:

- **Roster**: `hire(input)` records a hired continuable subagent's durable role binding (call after `ctx.subagents.startContinuable()` publishes the child); `roster(workspaceId)` lists it.
- **Ticket ledger**: `openTicket(input)` creates an `open` ticket; `assignTicket`/`reassignTicket` bind it to a roster member hired into the same workspace and role; `startWork`, `submitForReview`, and `submitBlocked` are assignee-only transitions (the service checks the caller against the ticket's recorded `assigneeSessionId`, not just the tool schema); `verdict` is the **sole** path that can set `done` (`accept`) or return an `in-review` ticket to `assigned` with a rationale attached (`reject`) — no other mutation reaches `done`, which is the enforcement point for requiring independent review before a ticket closes. `ticket(id)`/`tickets(workspaceId)` read the ledger.
- **Message pool**: `publish(input)` appends one structured record (`kind`: `finding | decision | handoff | blocker`, not free text); `readPool(filter)` reads a workspace's pool filtered by topic and publish time.

Every ticket transition runs on `KvTable.update`'s own per-domain write chain: concurrent callers (e.g. two Director-preset threads racing to assign the same ticket) never interleave, and the loser's status precondition simply fails against the value the winner already committed — no additional compare-and-set revision field is layered on top.

## Config

None. The domain's backend routing (`json`/`sqlite`) is `dsh-storage-domain`'s deployment config, not this package's.

## Model Experience

Indirectly, through `dsh-tool-crew-director`, `dsh-tool-crew-member`, and `dsh-tool-crew-review`, which are the only model-facing surfaces over this service.

#### KV Cache effect

No direct invalidation; the named tool consumers own any request-prefix changes.

## Known Limitations and Deferred Work

- **Process-local domain only** — `ctx.storage.domain` does not coordinate two harness processes; two hosts sharing one on-disk medium is outside this package's contract, matching `dsh-storage`'s own process-local scope.
- **No pagination or retention policy** — `roster`, `tickets`, and `readPool` return the complete matching set on every call; a long-running project's full history stays in one table indefinitely.
- **No token/price/wall-clock budget on the ledger itself** — ticket and message volume are unbounded; per-member effort budgets belong to `dsh-goal`'s own round cap on each member's session, not this package.
- **Role vocabulary is fixed, not deployment-configurable** — see `CrewRole`'s own doc comment for why.
