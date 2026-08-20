# @deepseek-ai/dsh-tool-crew-director

Model-facing `crew_hire`, `crew_open_ticket`, `crew_assign_ticket`, and `crew_board` tools over [`ctx.crew`](../crew/README.md) and `ctx.subagents`. Mounted inside the `crew-director` preset — never host-global, unlike `ctx.crew` itself: a host-global tool row is visible to every session on every preset, so these would otherwise leak onto `standard`/`minimal`/`code`/`cordis` too. A hired `strategist` additionally receives `crew_open_ticket` through its own `toolFilter` (see `crew_hire` below) rather than needing a second copy of this package or a separate tool.

## `crew_hire`

Starts a new continuable subagent (`ctx.subagents.startContinuable`) into a fixed role and records the roster fact (`ctx.crew.hire`). The hired child's identity comes entirely from two `SubagentStartRequest` fields set inline at hire time — **not** from a separate `agent-preset` directory per role: `persona` (fixed prose per role) shadows the deployment persona for that child alone, and `toolFilter.allow` restricts its visible tools to the role's fixed crew tools (`crew_report`/`crew_publish`/`crew_read_pool`, plus `crew_open_ticket` for `strategist` and `crew_verdict` instead for `reviewer`) unioned with any deployment-configured extras (`Config.roleToolAllow`, e.g. `web_search`/`bash` names, which vary by deployment). This is why only one preset (`crew-director`) exists in this feature — hired members never boot through the preset system at all.

## `crew_open_ticket` / `crew_assign_ticket`

Open an unassigned ticket, then separately assign it to a roster member hired into the same role. Assignment does two things in one call: `ctx.crew.assignTicket` (the durable transition) and `ctx.subagents.followup` (delivering the ticket's objective as the member's next FIFO turn) — a ticket existing in the ledger and a member actually seeing it are kept atomic from the model's perspective.

## `crew_board`

Read-only roster and full ticket listing for the caller's workspace.

## Config

| Key | Default | Meaning |
|---|---|---|
| `provider` | `'spawn'` | The `ctx.subagents` provider name used for every `crew_hire` call. |
| `roleToolAllow` | `{}` | Per-role deployment tool names to union with the fixed crew tools (e.g. web/fs/shell tool names, which vary by deployment). |

## Model Experience

### Tool schemas and results

#### What the model sees

The generated [`crew_hire`, `crew_open_ticket`, `crew_assign_ticket`, and `crew_board` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-crew-director). Results are compact JSON projections of the underlying `ctx.crew` records with undefined-valued optional fields omitted (never a raw domain object with `undefined` present).

#### Token effect

Fixed schema cost per request where this plugin's tools are visible; one compact JSON result per call.

#### KV Cache effect

Prefix-stable while tool definitions and visibility are unchanged; results append after the reusable request prefix.

## Known Limitations and Deferred Work

- **`crew_hire` always starts a fresh child** — no re-hire/resume path for a previously hired member whose session ended; the roster record and the child's own durable session are independent facts once created.
- **No un-hire or role change** — a mis-hired member has no removal path in this package; the roster is append-only from here.
- **Workspace resolution is a `cwd` realpath lookup per call** — no caching; acceptable at this feature's call volume, but a caller in a directory that hasn't yet resolved to a workspace gets a clear error, not automatic creation.
