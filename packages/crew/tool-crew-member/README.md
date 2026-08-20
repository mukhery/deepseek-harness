# @deepseek-ai/dsh-tool-crew-member

Model-facing `crew_report`, `crew_publish`, and `crew_read_pool` tools over [`ctx.crew`](../crew/README.md). Mounted inside the `crew-director` preset (never host-global — a host-global row would put these on every other preset's tool catalog too). A hired crew member's actual visibility into these three tools is narrowed by the `toolFilter.allow` list `tool-crew-director`'s `crew_hire` sets at hire time.

## `crew_report`

The assignee's structured handoff on their currently assigned ticket. `ready_for_review` submits evidence and a summary and moves the ticket to `in-review` — it never sets `done`; only an independent [`crew_verdict`](../tool-crew-review/README.md) does. `blocked` records why the ticket cannot proceed.

## `crew_publish` / `crew_read_pool`

Publish one structured, topic-tagged message (`finding | decision | handoff | blocker`) to the workspace's shared pool, or read it back filtered by topic and publish time. This is the MetaGPT-style channel: a Researcher's finding reaches a Strategist directly, without relaying through a coordinator thread.

## Model Experience

### Tool schemas and results

#### What the model sees

The generated [`crew_report`, `crew_publish`, and `crew_read_pool` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-crew-member). Results are compact JSON projections of the underlying `ctx.crew` records with undefined-valued optional fields omitted.

#### Token effect

Fixed schema cost per request where these tools are visible (typically a subset, per the hiring member's `toolFilter`); one compact JSON result per call.

#### KV Cache effect

Prefix-stable while tool definitions and visibility are unchanged; results append after the reusable request prefix.

## Known Limitations and Deferred Work

- **`crew_read_pool` returns the complete matching set** — no pagination or cursor; acceptable at this feature's expected message volume.
- **No message editing or retraction** — the pool is append-only from this package's surface.
