# @deepseek-ai/dsh-tool-crew-review

Model-facing `crew_verdict` tool over [`ctx.crew`](../crew/README.md) — the **sole** operation that can close a crew ticket. Mounted inside the `crew-director` preset (never host-global, for the same reason as `tool-crew-member`). The Director's own session technically sees it too; the real enforcement is `ctx.crew.verdict` itself checking the caller was hired into the `reviewer` role, not tool visibility (see [`ctx.crew`'s README](../crew/README.md)) — a hired `reviewer` child's `toolFilter` (set by `tool-crew-director`'s `crew_hire`) is what actually narrows this tool down to the intended caller in practice.

## `crew_verdict`

`accept` sets the ticket `done`; passing `pr_url` in the same call attaches an already-opened PR's url to the ledger atomically with acceptance (the caller — typically the Engineer's worktree branch already pushed — supplies the url; this package does not open PRs itself). `reject` returns the ticket to its same assignee with the reviewer's rationale attached as new context, never setting `done`. `pr_url` with `reject` is rejected as invalid: a rejected ticket has no PR to record.

The tool description explicitly tells the model the assignee's own `crew_report` is not certification — this package exists specifically because `ctx.crew`'s own service layer, not just this tool's schema, refuses every other path to `done` (see [`ctx.crew`'s README](../crew/README.md)).

## Model Experience

### Tool schema and result

#### What the model sees

The generated [`crew_verdict` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-crew-review). The result is a compact JSON projection of the updated ticket record with undefined-valued optional fields omitted.

#### Token effect

Fixed schema cost per request where this tool is visible (only a hired reviewer's requests, per its `toolFilter`); one compact JSON result per call.

#### KV Cache effect

Prefix-stable while the tool definition and visibility are unchanged; results append after the reusable request prefix.

## Known Limitations and Deferred Work

- **No verdict history** — the ticket record carries only the latest `verdictRationale`; a ticket rejected and re-reviewed multiple times does not retain earlier rationales in this package's surface (the durable `crew` domain's own record history is the source of that, outside this tool).
