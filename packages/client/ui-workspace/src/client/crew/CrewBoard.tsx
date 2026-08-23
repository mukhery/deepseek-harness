/**
 * The Crew tab's top-level panel: the escalation banner (when any ticket is
 * blocked) above one column per fixed ticket status. Scoped to the workspace
 * containing the currently selected session (`WorkspaceBrowser`'s
 * `currentGroup` resolution) — a session outside every workspace, or no
 * selection at all, shows the panel's empty state instead.
 */
import { useEffect, useMemo } from 'react'
import type { CrewBoardEntry, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import { deriveCrewColumns, deriveEscalationBanner } from './crew-tree.ts'
import { CrewColumn } from './CrewColumn.tsx'
import { CrewEscalationBanner } from './CrewEscalationBanner.tsx'
import css from './CrewBoard.module.css'

const EMPTY_ENTRY: CrewBoardEntry = { roster: [], tickets: [], state: 'idle', phase: 'pending', error: null }

/** Panel props: the runtime hooks/actions the browser root already threads through, plus the resolved workspace. */
export type CrewBoardProps =
  Pick<WorkspaceBrowserProps, 'useCrewBoard' | 'useSessions' | 'useWorkspaces' | 'open' | 't'>
  & {
    /** The workspace containing the currently selected session; undefined shows the empty state. */
    workspaceId: WorkspaceId | undefined
    /** Lazily pull the workspace's board on mount/workspace change (idempotent). */
    ensureCrewBoard: (workspaceId: WorkspaceId) => void
  }

/**
 * Render the Crew panel.
 * @param props - see {@link CrewBoardProps}.
 * @returns the panel element.
 */
export function CrewBoard({
  workspaceId, ensureCrewBoard, useCrewBoard, useSessions, useWorkspaces, open, t,
}: CrewBoardProps) {
  useEffect(() => {
    if (workspaceId !== undefined) ensureCrewBoard(workspaceId)
  }, [workspaceId, ensureCrewBoard])

  const entry = useCrewBoard(state => (workspaceId === undefined ? undefined : state.byWorkspaceId[workspaceId]))
  const workspace = useWorkspaces(state => state.items.find(item => item.workspaceId === workspaceId))
  const sessions = useSessions(state => state)
  const board = entry ?? EMPTY_ENTRY
  const columns = useMemo(() => deriveCrewColumns(board), [board])
  const banner = useMemo(() => deriveEscalationBanner(board, sessions, workspace), [board, sessions, workspace])

  if (workspaceId === undefined) {
    return <div className={css.empty}>{t('crew.empty.noWorkspace')}</div>
  }
  if (entry === undefined || entry.phase === 'pending') {
    return <div className={css.loading}>{t('crew.loading')}</div>
  }

  return (
    <div className={css.root}>
      {banner !== undefined && <CrewEscalationBanner banner={banner} onOpenSession={open} t={t} />}
      <div className={css.columns}>
        {columns.map(column => (
          <CrewColumn key={column.key} column={column} t={t} />
        ))}
      </div>
    </div>
  )
}
