/**
 * The outward crew-board-service face — what `ctx.crewBoard` exposes to
 * feature packages (the Crew panel is currently the sole consumer). Wire-pump
 * entry points (handleHostEnvelope/handleConnected) stay on the concrete
 * class; `ensure`/`refresh` are the only read actions, since the panel is
 * read-only (crew mutation stays tool-mediated on the host side, never
 * through this service).
 */
import type { CrewRosterView, CrewTicketView, RpcError, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot } from './store.ts'

/** Monotone per-workspace crew-board arrival lifecycle. */
export type CrewBoardPhase = 'pending' | 'ready'

/** One workspace's crew-board entry: full-snapshot roster/tickets plus fetch state. */
export interface CrewBoardEntry {
  roster: readonly CrewRosterView[]
  tickets: readonly CrewTicketView[]
  state: 'idle' | 'loading' | 'error'
  phase: CrewBoardPhase
  error: RpcError | null
}

/** Sparse per-workspace crew-board map: only workspaces `ensure`d so far have an entry. */
export interface CrewBoardsState {
  byWorkspaceId: Readonly<Record<WorkspaceId, CrewBoardEntry>>
}

/** The crew-board-service face injected as `ctx.crewBoard`. */
export interface ICrewBoard {
  /** The board feed, keyed by workspace (read face — no mutation face exists). */
  readonly list: ObservableSnapshot<CrewBoardsState>
  /**
   * Lazily pull one workspace's board on first reference (idempotent — a
   * workspace already fetched or in flight is a no-op). The Crew panel calls
   * this on mount/workspace change; later updates arrive through
   * `host/crew-board-changed` alone.
   * @param workspaceId - workspace to fetch.
   */
  ensure(workspaceId: WorkspaceId): void
}
