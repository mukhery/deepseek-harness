/** Per-workspace crew-board baseline and push-frame owner. */

import type {
  CrewRosterView, CrewTicketView, HostFrame, IApiClient, RpcError, RpcRequest, WorkspaceId,
} from '@deepseek-ai/dsh-api-remotes/client'
import { transportError } from '@deepseek-ai/dsh-host-apiproxy/api'
import { Notifier } from '../sessions/notifier.ts'
import type { CrewBoardEntry, CrewBoardPhase, CrewBoardsState } from '../contract/crew.ts'

const EMPTY_ENTRY: CrewBoardEntry = {
  roster: [], tickets: [], state: 'idle', phase: 'pending', error: null,
}

/**
 * Crew-board object cluster: a sparse per-workspace map, each entry driven by
 * one `crew.board` baseline pull plus `host/crew-board-changed` full-snapshot
 * pushes (never a merge — every install replaces `roster`/`tickets` wholesale,
 * matching the Host projection's own full-recompute posture).
 */
export class CrewBoardManager {
  private entries = new Map<WorkspaceId, CrewBoardEntry>()
  private readonly inflight = new Map<WorkspaceId, Promise<void>>()
  /**
   * A `host/crew-board-changed` frame landing while that workspace's refresh
   * is in flight is guaranteed to reflect a commit at least as recent as the
   * request (the Host pushes synchronously at commit time on every open
   * stream), so it must win over that refresh's own response — the frame
   * mirrors `workspaces/manager.ts`'s `refreshFrames` replay, scoped per
   * workspace instead of one process-wide list, since this projection needs
   * no order/archive-set reconciliation.
   */
  private readonly refreshSupersededBy = new Map<WorkspaceId, { roster: readonly CrewRosterView[]; tickets: readonly CrewTicketView[] }>()
  private snapshotCache: CrewBoardsState
  private readonly notifier = new Notifier(() => {
    this.snapshotCache = this.buildSnapshot()
  })

  /** @param api - shared wire client. */
  constructor(private readonly api: IApiClient) {
    this.snapshotCache = this.buildSnapshot()
  }

  /**
   * Lazily pull one workspace's board (idempotent: a workspace already
   * fetched or in flight is a no-op).
   * @param workspaceId - workspace to fetch.
   */
  ensure(workspaceId: WorkspaceId): void {
    if (this.entries.has(workspaceId) || this.inflight.has(workspaceId)) return
    void this.refresh(workspaceId)
  }

  /**
   * Refresh one workspace's board from `crew.board`, reusing an in-flight
   * pull for the same workspace.
   * @param workspaceId - workspace to refresh.
   * @returns completion of the current or newly started pull.
   */
  refresh(workspaceId: WorkspaceId): Promise<void> {
    const existing = this.inflight.get(workspaceId)
    if (existing !== undefined) return existing
    this.refreshSupersededBy.delete(workspaceId)
    this.setEntry(workspaceId, {
      ...(this.entries.get(workspaceId) ?? EMPTY_ENTRY), state: 'loading', error: null,
    })
    const operation = (async () => {
      try {
        const { result } = await this.api.crew.board({ workspaceId })
        const superseded = this.refreshSupersededBy.get(workspaceId)
        if (superseded !== undefined) {
          this.setEntry(workspaceId, {
            roster: superseded.roster, tickets: superseded.tickets, state: 'idle', phase: 'ready', error: null,
          })
        } else if (result.ok) {
          this.setEntry(workspaceId, {
            roster: result.value.roster, tickets: result.value.tickets, state: 'idle', phase: 'ready', error: null,
          })
        } else {
          this.setEntry(workspaceId, {
            ...(this.entries.get(workspaceId) ?? EMPTY_ENTRY), state: 'error', phase: 'ready', error: result.error,
          })
        }
      } catch (error) {
        const folded = transportError<never>(error)
        /* v8 ignore next -- transportError always returns the failure branch. */
        const rpcError: RpcError | null = folded.ok ? null : folded.error
        this.setEntry(workspaceId, {
          ...(this.entries.get(workspaceId) ?? EMPTY_ENTRY), state: 'error', phase: 'ready', error: rpcError,
        })
      } finally {
        this.inflight.delete(workspaceId)
        this.refreshSupersededBy.delete(workspaceId)
      }
    })()
    this.inflight.set(workspaceId, operation)
    return operation
  }

  /**
   * Host-frame entry. A non-crew-board frame is ignored so the runtime can
   * fan one host stream out to every object manager.
   * @param envelope - host stream envelope.
   */
  handleHostEnvelope(envelope: RpcRequest<HostFrame>): void {
    if (envelope.payload.type !== 'host/crew-board-changed') return
    const { workspaceId, roster, tickets } = envelope.payload
    if (this.inflight.has(workspaceId)) {
      this.refreshSupersededBy.set(workspaceId, { roster, tickets })
    }
    this.setEntry(workspaceId, { roster, tickets, state: 'idle', phase: 'ready', error: null })
  }

  /** Re-pull every workspace this client has ever shown, after each connection generation. */
  handleConnected(): void {
    for (const workspaceId of this.entries.keys()) void this.refresh(workspaceId)
  }

  /**
   * Subscribe to crew-board snapshot invalidation.
   * @param listener - snapshot invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    return this.notifier.subscribe(listener)
  }

  /**
   * Read the cached crew-boards snapshot after flushing pending notifications.
   * @returns the cached crew-boards snapshot.
   */
  getSnapshot(): CrewBoardsState {
    this.notifier.ensureFresh()
    return this.snapshotCache
  }

  private setEntry(workspaceId: WorkspaceId, entry: CrewBoardEntry): void {
    const current = this.entries.get(workspaceId)
    if (current !== undefined && sameEntry(current, entry)) return
    this.entries = new Map(this.entries).set(workspaceId, entry)
    this.notifier.markDirty()
  }

  private buildSnapshot(): CrewBoardsState {
    return { byWorkspaceId: Object.fromEntries(this.entries) }
  }
}

/** Reference-shallow entry comparison: every field is replaced wholesale on each install. */
function sameEntry(a: CrewBoardEntry, b: CrewBoardEntry): boolean {
  return a.roster === b.roster && a.tickets === b.tickets && a.state === b.state
    && a.phase === b.phase && a.error === b.error
}

export type { CrewBoardPhase }
