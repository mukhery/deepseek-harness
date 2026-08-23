/** Test-owned crew-board face: the renderer standard-kit observable plus recorded `ensure` calls. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { CrewBoardsState, ICrewBoard, SnapshotStore, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Crew-board test double. Implements the same ICrewBoard face features
 * receive as `ctx.crewBoard`, so a production face change breaks this double
 * at compile time. `ensure` calls are recorded; the default state stays
 * `{ byWorkspaceId: {} }` until a test seeds one via {@link TestCrewBoard.seed}.
 */
export class TestCrewBoard implements ICrewBoard {
  /** The useCrewBoard standard feed. */
  readonly list: SnapshotStore<CrewBoardsState>

  /** Workspace ids passed to `ensure`, newest last. */
  readonly ensured: WorkspaceId[] = []

  constructor() {
    this.list = createSnapshotStore<CrewBoardsState>({ byWorkspaceId: {} })
  }

  /**
   * Record the pull request (recorded; default no-op — tests that need a
   * populated board call {@link TestCrewBoard.seed} directly instead of
   * simulating a wire round trip).
   * @param workspaceId - workspace to fetch.
   */
  ensure(workspaceId: WorkspaceId): void {
    this.ensured.push(workspaceId)
  }

  /**
   * Seed one workspace's board entry directly (test setup, not a wire echo).
   * @param workspaceId - target workspace.
   * @param entry - the full entry to install.
   */
  seed(workspaceId: WorkspaceId, entry: CrewBoardsState['byWorkspaceId'][WorkspaceId]): void {
    this.list.update((draft) => {
      draft.byWorkspaceId = { ...draft.byWorkspaceId, [workspaceId]: entry }
    })
  }
}
