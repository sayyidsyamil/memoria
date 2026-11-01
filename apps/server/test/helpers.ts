import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { git } from '../src/git.ts'
import { Vault, type VaultOptions } from '../src/vault.ts'

const DESKTOP = {
  GIT_AUTHOR_NAME: 'Desktop',
  GIT_AUTHOR_EMAIL: 'desktop@memoria.invalid',
  GIT_COMMITTER_NAME: 'Desktop',
  GIT_COMMITTER_EMAIL: 'desktop@memoria.invalid',
}

export const SEED_NOTES: Record<string, string> = {
  'welcome.md': '---\ntype: Note\n---\n# Welcome\n\nA throwaway vault for tests.\n',
  'projects/alpha.md': '# Alpha\n\nLinks to [[welcome]] and mentions the Heron.\n',
  'attachments/pixel.bin': '\u0000\u0001\u0002binary',
}

/** A second clone of the remote, standing in for the desktop app pushing on its own. */
export class DesktopClone {
  readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  run(args: string[]): Promise<{ stdout: string }> {
    return git(this.dir, args, { env: DESKTOP })
  }

  /** Writes (or, with `null`, deletes) one file, commits it as "desktop: <path>" and pushes. */
  async commit(path: string, content: string | null): Promise<void> {
    await this.run(['pull', '-q', '--ff-only'])
    await this.stage(path, content)
    await this.run(['commit', '-q', '-m', `desktop: ${path}`])
    await this.run(['push', '-q', 'hub', 'HEAD:refs/heads/main'])
  }

  /** Commits a symbolic link, as a hostile or careless collaborator could. */
  async commitSymlink({ path, target }: { path: string; target: string }): Promise<void> {
    await this.run(['pull', '-q', '--ff-only'])
    await symlink(target, join(this.dir, path))
    await this.run(['add', '--', path])
    await this.run(['commit', '-q', '-m', `desktop: link ${path}`])
    await this.run(['push', '-q', 'hub', 'HEAD:refs/heads/main'])
  }

  async rename(from: string, to: string): Promise<void> {
    await this.run(['pull', '-q', '--ff-only'])
    await this.run(['mv', '--', from, to])
    await this.run(['commit', '-q', '-m', `desktop: rename ${from}`])
    await this.run(['push', '-q', 'hub', 'HEAD:refs/heads/main'])
  }

  async read(path: string): Promise<string> {
    await this.run(['pull', '-q', '--ff-only'])
    return readFile(join(this.dir, path), 'utf8')
  }

  async log(): Promise<string[]> {
    await this.run(['pull', '-q', '--ff-only'])
    const { stdout } = await this.run(['log', '--format=%s'])
    return stdout.trim().split('\n')
  }

  private async stage(path: string, content: string | null): Promise<void> {
    if (content === null) {
      await this.run(['rm', '-q', '--', path])
      return
    }
    await mkdir(dirname(join(this.dir, path)), { recursive: true })
    await writeFile(join(this.dir, path), content)
    await this.run(['add', '--', path])
  }
}

export interface Fixture {
  root: string
  /** Directory of the server's working clone. */
  vaultDir: string
  remote: string
  desktop: DesktopClone
  openVault(options?: Partial<VaultOptions>): Promise<Vault>
  cleanup(): Promise<void>
}

/** A bare "GitHub" remote seeded with a small vault, plus a desktop clone of it. */
export async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'memoria-server-test-'))
  const remote = join(root, 'remote.git')
  await git(root, ['init', '-q', '--bare', '-b', 'main', remote])
  await git(root, ['clone', '-q', '-o', 'hub', remote, 'desktop'])
  const desktop = new DesktopClone(join(root, 'desktop'))
  await desktop.run(['checkout', '-q', '-B', 'main'])
  for (const [path, content] of Object.entries(SEED_NOTES)) {
    await mkdir(dirname(join(desktop.dir, path)), { recursive: true })
    await writeFile(join(desktop.dir, path), content)
  }
  await desktop.run(['add', '-A'])
  await desktop.run(['commit', '-q', '-m', 'Seed vault'])
  await desktop.run(['push', '-q', '-u', 'hub', 'main'])
  return {
    root,
    vaultDir: join(root, 'server', 'vault'),
    remote,
    desktop,
    openVault: (options = {}) => Vault.open({ dir: join(root, 'server', 'vault'), remoteUrl: remote, pushDebounceMs: 0, ...options }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

export function text(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}
