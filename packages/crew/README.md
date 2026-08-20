# crew/ — Director-led crew of long-running agents

This family lets a Director-preset session build and task a roster of continuable subagents pursuing one workspace-scoped project over long periods, with an independent Reviewer role gating ticket completion.

| Package | Role | ctx key |
|---|---|---|
| [`crew/`](crew/README.md) | Workspace-scoped roster, ticket-ledger, and message-pool domain | `ctx.crew` |

See the [Director-led crew Agent Note](../../.agents/notes/implemented/feature/2026-08-20-director-led-crew.md) for the design rationale, including why crew state is a workspace-scoped domain rather than session-log events, and why `done` is reachable only through independent review.

This family builds on [`dsh-subagent`](../subagent/README.md) for spawn/messaging, [`dsh-goal`](../goal/README.md) for each member's per-ticket continuation loop, [`dsh-schedule`](../schedule/README.md) for the standing Director thread's check-in cadence, and [`dsh-workspace`](../workspace/README.md)/[`dsh-storage-domain`](../storage/README.md) for the domain this package's own state lives in — it does not reimplement any of those seams.
