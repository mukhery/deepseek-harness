/** CrewBoardRuntime projects the crew-board object manager for UI consumers. */

import type { Context } from '@deepseek-ai/cordis'
import type { IApiClient, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '../contract/store.ts'
import { createSnapshotStore } from '../contract/store.ts'
import type { CrewBoardsState, ICrewBoard } from '../contract/crew.ts'
import { CrewBoardManager } from './manager.ts'

/** Real crew-board object layer, the sole `ctx.crewBoard` implementation. */
export class CrewBoardRuntime implements ICrewBoard {
  /** UI-facing immutable projection; the manager remains wire truth. */
  readonly list: SnapshotStore<CrewBoardsState>
  private readonly manager: CrewBoardManager

  /**
   * @param ctx - client root context.
   * @param api - shared wire client.
   */
  constructor(ctx: Context, api: IApiClient) {
    this.manager = new CrewBoardManager(api)
    this.list = createSnapshotStore<CrewBoardsState>({ byWorkspaceId: {} })
    this.manager.subscribe(() => { this.project() })
    ctx.reflect.provide('crewBoard', this, undefined)
  }

  /**
   * Lazily pull one workspace's board on first reference.
   * @param workspaceId - workspace to fetch.
   */
  ensure(workspaceId: WorkspaceId): void {
    this.manager.ensure(workspaceId)
  }

  /**
   * Route a Host stream envelope into the crew-board object layer.
   * @param envelope - validated Host stream envelope.
   */
  handleHostEnvelope(envelope: Parameters<CrewBoardManager['handleHostEnvelope']>[0]): void {
    this.manager.handleHostEnvelope(envelope)
  }

  /** Re-pull every workspace this client has ever shown, after each connection generation. */
  handleConnected(): void {
    this.manager.handleConnected()
  }

  private project(): void {
    this.list.set(this.manager.getSnapshot())
  }
}
