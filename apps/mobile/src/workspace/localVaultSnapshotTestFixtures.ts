import type { LocalVaultFile } from './localVaultSnapshot'
import type { MobileSidebarFolder } from './mobileWorkspaceModel'

export function vaultFile(relativePath: string, content: string, index = 0): LocalVaultFile {
  return {
    absolutePath: `/vault/${relativePath}`,
    content,
    createdAt: 1_700_000_000_000 + index,
    modifiedAt: 1_700_000_000_000 + index,
    relativePath,
    size: content.length,
  }
}

export function realVaultRelationshipFiles(): LocalVaultFile[] {
  return [
    vaultFile('project.md', projectTypeContent),
    vaultFile('memoria-mobile.md', memoriaMobileContent),
    vaultFile('workflow-orchestration.md', workflowOrchestrationContent),
  ]
}

export const projectTypeContent = `---
type: Type
color: red
icon: folder
---
# Project
`

export function typeMetadataVaultFiles(): LocalVaultFile[] {
  return [
    vaultFile('types/project.md', projectMetadataContent),
    vaultFile('types/secret.md', `---
type: Type
visible: false
---
# Secret
`),
    vaultFile('types/topic.md', `---
type: Type
---
# Topic
`),
    vaultFile('projects/high.md', `---
type: Project
Priority: High
_organized: false
---
# High Project
`),
    vaultFile('projects/low.md', `---
type: Project
Priority: Low
_organized: false
---
# Low Project
`),
    vaultFile('secret.md', `---
type: Secret
_organized: false
---
# Hidden Work
`),
    vaultFile('note.md', `---
type: Note
_organized: false
---
# Plain Note
`),
  ]
}

export const memoriaMobileContent = `---
type: Project
_organized: false
_width: wide
aliases:
  - Mobile App
related_to:
  - "[[workflow-orchestration|Workflow Orchestration]]"
---
# Memoria Mobile

Use **desktop parity** first.

See [[workflow-orchestration|Workflow Orchestration]] for the planning note.

## Tasks

- Keep relationships typed.
- Render tables.

| Area | State |
| --- | --- |
| UI | Draft |
`

export const workflowOrchestrationContent = `---
type: Note
_organized: true
---
# Workflow Orchestration

Reference note.
`

export function flattenSidebarFolders(folders: MobileSidebarFolder[]): MobileSidebarFolder[] {
  return folders.flatMap((folder) => [folder, ...flattenSidebarFolders(folder.children)])
}

const projectMetadataContent = `---
type: Type
color: red
order: 2
sidebar_label: Client Work
sort: "property:Priority:asc"
template: |
  ## Objective

  Use this project shape.
_list_properties_display:
  - Priority
  - belongs_to
Priority: Medium
has: Milestone
depends_on:
  - [[project-template]]
---
# Project
`
