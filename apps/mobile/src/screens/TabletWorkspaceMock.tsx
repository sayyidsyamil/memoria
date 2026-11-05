import { workspaceScenarios, type WorkspaceScenario } from '../fixtures/workspaceFixtures'
import { TabletWorkspace } from './TabletWorkspace'

export function TabletWorkspaceMock({
  scenario = workspaceScenarios.default,
}: {
  scenario?: WorkspaceScenario
}) {
  return <TabletWorkspace snapshot={scenario} />
}
