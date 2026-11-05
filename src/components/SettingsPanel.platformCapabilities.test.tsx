import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import { SettingsPanel } from './SettingsPanel'
import type { PlatformCapabilities } from '../lib/platformCapabilities'

/**
 * Tests for platform capabilities in SettingsPanel (TOL-174).
 * Verifies that desktop-only settings are hidden in web builds.
 */

const mockSettings = {
  theme: 'system' as const,
  themeMode: 'light' as const,
  contentWidth: 'readable' as const,
  dateDisplayFormat: 'relative-with-dates' as const,
  sidebarTypePluralization: true,
  hideGitignoredFiles: true,
  allNotesFileVisibility: 'show' as const,
  pullInterval: 5,
  releaseChannel: 'stable' as const,
  automaticUpdateChecksEnabled: true,
  crashReporting: false,
  analytics: false,
  aiAgentPermissionMode: 'permissive' as const,
  aiParseLargeDocuments: false,
  aiWorkspaceConversation: 'disabled' as const,
  aiAgentFunctionMode: 'full' as const,
  aiAgentWorkflowMode: 'full' as const,
  aiContextOrchestrationMode: 'enabled' as const,
  aiAgentInvocationMode: 'commands' as const,
  aiModelTargets: {},
  aiModelProviders: [],
}

const mockAiAgentsStatus = {
  agentMode: 'missing' as const,
  agents: [],
}

describe('SettingsPanel platform capabilities', () => {
  test('shows git section when git capability is enabled', () => {
    const capabilities: PlatformCapabilities = {
      git: true,
      mcp: true,
      updater: true,
      multiWindow: true,
      openCode: true,
      cliAgents: true,
    }

    render(
      <SettingsPanel
        open={true}
        settings={mockSettings}
        aiAgentsStatus={mockAiAgentsStatus}
        locale="en"
        onSave={() => {}}
        onClose={() => {}}
        platformCapabilities={capabilities}
        isGitVault={true}
      />
    )

    // Git section should be in the document
    const gitSection = document.querySelector('#settings-section-autogit')
    expect(gitSection).toBeTruthy()
  })

  test('hides git section when git capability is disabled', () => {
    const capabilities: PlatformCapabilities = {
      git: false,
      mcp: true,
      updater: true,
      multiWindow: true,
      openCode: true,
      cliAgents: true,
    }

    render(
      <SettingsPanel
        open={true}
        settings={mockSettings}
        aiAgentsStatus={mockAiAgentsStatus}
        locale="en"
        onSave={() => {}}
        onClose={() => {}}
        platformCapabilities={capabilities}
        isGitVault={true}
      />
    )

    // Git section should not be in the document
    const gitSection = document.querySelector('#settings-section-autogit')
    expect(gitSection).toBeNull()
  })

  test('shows updater settings when updater capability is enabled', () => {
    const capabilities: PlatformCapabilities = {
      git: true,
      mcp: true,
      updater: true,
      multiWindow: true,
      openCode: true,
      cliAgents: true,
    }

    const { container } = render(
      <SettingsPanel
        open={true}
        settings={mockSettings}
        aiAgentsStatus={mockAiAgentsStatus}
        locale="en"
        onSave={() => {}}
        onClose={() => {}}
        platformCapabilities={capabilities}
      />
    )

    // Updater settings should be in the document
    const releaseChannelSetting = container.querySelector('[data-testid="settings-release-channel"]')
    const autoUpdateChecksSetting = container.querySelector('[data-testid="settings-automatic-update-checks"]')
    
    expect(releaseChannelSetting).toBeTruthy()
    expect(autoUpdateChecksSetting).toBeTruthy()
  })

  test('hides updater settings when updater capability is disabled', () => {
    const capabilities: PlatformCapabilities = {
      git: true,
      mcp: true,
      updater: false,
      multiWindow: true,
      openCode: true,
      cliAgents: true,
    }

    const { container } = render(
      <SettingsPanel
        open={true}
        settings={mockSettings}
        aiAgentsStatus={mockAiAgentsStatus}
        locale="en"
        onSave={() => {}}
        onClose={() => {}}
        platformCapabilities={capabilities}
      />
    )

    // Updater settings should not be in the document
    const releaseChannelSetting = container.querySelector('[data-testid="settings-release-channel"]')
    const autoUpdateChecksSetting = container.querySelector('[data-testid="settings-automatic-update-checks"]')
    
    expect(releaseChannelSetting).toBeNull()
    expect(autoUpdateChecksSetting).toBeNull()
  })

  test('renders with mcp capability enabled', () => {
    const capabilities: PlatformCapabilities = {
      git: true,
      mcp: true,
      updater: true,
      multiWindow: true,
      openCode: true,
      cliAgents: true,
    }

    const mockCopyMcpConfig = () => {}

    const { container } = render(
      <SettingsPanel
        open={true}
        settings={mockSettings}
        aiAgentsStatus={{
          agentMode: 'connected',
          agents: [],
        }}
        locale="en"
        onSave={() => {}}
        onClose={() => {}}
        onCopyMcpConfig={mockCopyMcpConfig}
        platformCapabilities={capabilities}
      />
    )

    // Component should render without errors when MCP is enabled
    expect(container).toBeTruthy()
  })

  test('renders with mcp capability disabled', () => {
    const capabilities: PlatformCapabilities = {
      git: true,
      mcp: false,
      updater: true,
      multiWindow: true,
      openCode: true,
      cliAgents: true,
    }

    const mockCopyMcpConfig = () => {}

    const { container } = render(
      <SettingsPanel
        open={true}
        settings={mockSettings}
        aiAgentsStatus={{
          agentMode: 'connected',
          agents: [],
        }}
        locale="en"
        onSave={() => {}}
        onClose={() => {}}
        onCopyMcpConfig={mockCopyMcpConfig}
        platformCapabilities={capabilities}
      />
    )

    // Component should render without errors when MCP is disabled
    expect(container).toBeTruthy()
  })

  test('handles undefined platformCapabilities gracefully', () => {
    // When platformCapabilities is undefined, all features should be shown (backwards compatibility)
    const { container } = render(
      <SettingsPanel
        open={true}
        settings={mockSettings}
        aiAgentsStatus={mockAiAgentsStatus}
        locale="en"
        onSave={() => {}}
        onClose={() => {}}
        isGitVault={true}
      />
    )

    // Git section should be in the document (defaults to showing all features)
    const gitSection = container.querySelector('#settings-section-autogit')
    expect(gitSection).toBeTruthy()

    // Updater settings should be in the document
    const releaseChannelSetting = container.querySelector('[data-testid="settings-release-channel"]')
    const autoUpdateChecksSetting = container.querySelector('[data-testid="settings-automatic-update-checks"]')
    
    expect(releaseChannelSetting).toBeTruthy()
    expect(autoUpdateChecksSetting).toBeTruthy()
  })

  test('web build disables all desktop-only features', () => {
    const capabilities: PlatformCapabilities = {
      git: false,
      mcp: false,
      updater: false,
      multiWindow: false,
      openCode: false,
      cliAgents: false,
    }

    const { container } = render(
      <SettingsPanel
        open={true}
        settings={mockSettings}
        aiAgentsStatus={mockAiAgentsStatus}
        locale="en"
        onSave={() => {}}
        onClose={() => {}}
        platformCapabilities={capabilities}
        isGitVault={false}
      />
    )

    // Git section should not be in the document
    const gitSection = container.querySelector('#settings-section-autogit')
    expect(gitSection).toBeNull()

    // Updater settings should not be in the document
    const releaseChannelSetting = container.querySelector('[data-testid="settings-release-channel"]')
    const autoUpdateChecksSetting = container.querySelector('[data-testid="settings-automatic-update-checks"]')
    
    expect(releaseChannelSetting).toBeNull()
    expect(autoUpdateChecksSetting).toBeNull()
  })
})
