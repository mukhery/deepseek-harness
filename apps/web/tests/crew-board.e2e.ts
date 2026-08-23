// Web e2e scenario: the Crew ticket board + escalation banner. Zero model
// calls: every roster/ticket record is written directly through ctx.crew
// (the same host primitive the crew_* tools use), and the Director session's
// pending question comes from calling ctx.userQuestions.ask() directly
// against its live Agent rather than from a real ask_user_question tool
// round trip — the mux `question/requested` frame this drives is identical
// either way, and no replay fixture or DEEPSEEK_API_KEY is needed.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-crew'
import type {} from '@deepseek-ai/dsh-user-questions'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/crew-board', import.meta.url))
const BOARD_EXPECTED = join(SNAPSHOT_DIR, 'board.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: crew ticket board + escalation banner', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)

    const engineerId = SessionId('crew-board-engineer')
    const reviewerId = SessionId('crew-board-reviewer')
    await scaffold.ctx.crew.hire({
      workspaceId: workspace.id, memberSessionId: engineerId, role: 'engineer', label: 'Engineer #1',
    })
    await scaffold.ctx.crew.hire({
      workspaceId: workspace.id, memberSessionId: reviewerId, role: 'reviewer', label: 'Reviewer #1',
    })

    const openTicket = (title: string, objective: string) =>
      scaffold.ctx.crew.openTicket({ workspaceId: workspace.id, title, objective, role: 'engineer' })

    await openTicket('Investigate flaky checkout test', 'Find and fix the intermittent failure')

    const assignedTicket = await openTicket('Add pagination to the orders API', 'Page large result sets')
    await scaffold.ctx.crew.assignTicket(assignedTicket.id, engineerId)

    const inProgressTicket = await openTicket('Migrate the billing worker', 'Move it onto the new queue')
    await scaffold.ctx.crew.assignTicket(inProgressTicket.id, engineerId)
    await scaffold.ctx.crew.startWork(inProgressTicket.id, engineerId)

    const inReviewTicket = await openTicket('Fix the flaky checkout test', 'Stabilize the checkout suite')
    await scaffold.ctx.crew.assignTicket(inReviewTicket.id, engineerId)
    await scaffold.ctx.crew.startWork(inReviewTicket.id, engineerId)
    await scaffold.ctx.crew.submitForReview(
      inReviewTicket.id, engineerId, 'Reproduced locally; root-caused a race in the payment mock', 'Fix ready for review',
    )

    const blockedTicket = await openTicket('Rotate the payment gateway credential', 'Swap to the new sandbox key')
    await scaffold.ctx.crew.assignTicket(blockedTicket.id, engineerId)
    await scaffold.ctx.crew.startWork(blockedTicket.id, engineerId)
    await scaffold.ctx.crew.submitBlocked(blockedTicket.id, engineerId, 'Need the new sandbox credential from the human')

    const doneTicket = await openTicket('Add a health-check endpoint', 'Expose /healthz')
    await scaffold.ctx.crew.assignTicket(doneTicket.id, engineerId)
    await scaffold.ctx.crew.startWork(doneTicket.id, engineerId)
    await scaffold.ctx.crew.submitForReview(doneTicket.id, engineerId, 'Endpoint returns 200 in staging', 'Shipped')
    await scaffold.ctx.crew.verdict(
      doneTicket.id, reviewerId, 'accept', 'Verified in staging', 'https://example.com/pr/1',
    )

    const directorId = SessionId('crew-board-director')
    const created = await scaffold.ctx.apiProxy.sessions.create({
      rpcId: RpcId('crew-board-seed'),
      payload: { workspaceId: workspace.id, sessionId: directorId, agentPreset: 'crew-director' },
    })
    if (!created.result.ok) throw new Error(`seeding the Director session failed: ${created.result.error.message}`)
    const directorAgent = scaffold.ctx.agents.get(directorId)
    if (directorAgent === undefined) throw new Error('Director agent did not register after session.create')
    // Deliberately not awaited: this leaves the session mid-question for the
    // lifetime of the test, driving the same pendingInteraction:'question'
    // state a real ask_user_question tool call would.
    scaffold.ctx.userQuestions.ask({
      agent: directorAgent,
      questions: [{
        id: 'crew-board-escalation',
        question: 'The payment-gateway-credential ticket is blocked — how should I proceed?',
      }],
    }).catch(() => {
      // Torn down with the scaffold at test end; never answered.
    })

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    // The workspace's one session is blank (no prompt was ever sent), so
    // startup auto-selection connects it directly — the same reuse path a
    // real New Session flow follows for an existing blank session.
    await page.locator('[class*="frame"]').first().waitFor({ timeout: 30_000 })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows every ticket status column and the blocked-ticket escalation banner', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-crew-board'))
    await page.getByRole('tab', { name: 'Crew' }).click()
    await page.getByText('Fix the flaky checkout test').first().waitFor({ timeout: 10_000 })

    const snapshot = await captureStableAria(page, '[class*="root"]:has([role="tablist"])', scaffold.workspaceCwd)
    await compareOrRefreshGolden(BOARD_EXPECTED, snapshot, MODE)
  })
})
