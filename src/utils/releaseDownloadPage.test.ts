import {
  buildStableDownloadRedirectPage,
  extractStableDownloadTargets,
  extractStableDownloadTargetsFromReleases,
  resolveStableDownloadTargets,
} from './releaseDownloadPage'

describe('extractStableDownloadTargets', () => {
  it('returns stable downloads for each supported desktop platform when present', () => {
    expect(
      extractStableDownloadTargets({
        platforms: {
          'darwin-aarch64': {
            download_url: 'https://example.com/Memoria-aarch64.dmg',
          },
          'darwin-x86_64': {
            download_url: 'https://example.com/Memoria-x64.dmg',
          },
          'linux-x86_64': {
            download_url: 'https://example.com/Memoria.AppImage',
          },
          'windows-x86_64': {
            url: 'https://example.com/Memoria-setup.exe',
          },
        },
      }),
    ).toMatchObject({
      'darwin-aarch64': {
        label: 'macOS Apple Silicon',
        url: 'https://example.com/Memoria-aarch64.dmg',
      },
      'darwin-x86_64': {
        label: 'macOS Intel',
        url: 'https://example.com/Memoria-x64.dmg',
      },
      'linux-x86_64': {
        label: 'Linux AppImage',
        url: 'https://example.com/Memoria.AppImage',
      },
      'windows-x86_64': {
        label: 'Windows',
        url: 'https://example.com/Memoria-setup.exe',
      },
    })
  })
})

describe('buildStableDownloadRedirectPage', () => {
  it('builds a redirect page with platform-specific download links', () => {
    const html = buildStableDownloadRedirectPage({
      'darwin-aarch64': {
        buttonLabel: 'Download Memoria for macOS Apple Silicon',
        label: 'macOS Apple Silicon',
        url: 'https://example.com/Memoria-aarch64.dmg',
      },
      'darwin-x86_64': {
        buttonLabel: 'Download Memoria for Intel Mac',
        label: 'macOS Intel',
        url: 'https://example.com/Memoria-x64.dmg',
      },
      'windows-x86_64': {
        buttonLabel: 'Download Memoria for Windows',
        label: 'Windows',
        url: 'https://example.com/Memoria-setup.exe',
      },
    })

    expect(html).toContain('Memoria Stable Download')
    expect(html).toContain('DOWNLOAD_TARGETS')
    expect(html).toContain('Download Memoria for Windows')
    expect(html).toContain('Windows updater bundles are signed')
    expect(html).toContain('Authenticode publisher signing is added when configured')
    expect(html).toContain('Download Memoria for macOS Apple Silicon')
    expect(html).toContain('Download Memoria for Intel Mac')
    expect(html).toContain('hasMultipleMacDownloads')
    expect(html).toContain('Choose the Apple Silicon or Intel Mac download below.')
    expect(html).toContain('requiresWindowsInstallChoice')
    expect(html).toContain('memoria-download-frame')
    expect(html).toContain('color-scheme: light dark')
    expect(html).toContain('@media (prefers-color-scheme: dark)')
    expect(html).toContain('background: var(--download-surface-page)')
  })

  it('starts platform downloads without navigating away from the download page', () => {
    const html = buildStableDownloadRedirectPage({
      'windows-x86_64': {
        buttonLabel: 'Download Memoria for Windows',
        label: 'Windows',
        url: 'https://example.com/Memoria-setup.exe',
      },
    })

    expect(html).toContain('name="memoria-download-frame"')
    expect(html).toContain('target="memoria-download-frame"')
    expect(html).toContain('sandbox="allow-downloads"')
    expect(html).toContain('startDownload(target)')
    expect(html).toContain('Company-managed devices may require IT approval')
    expect(html).not.toContain('window.location.replace')
  })

  it('builds a fallback page when no stable downloads exist yet', () => {
    const html = buildStableDownloadRedirectPage({})

    expect(html).toContain('Memoria Stable Download Unavailable')
    expect(html).toContain('View release history')
    expect(html).toContain('https://tolaria.md/releases/')
    expect(html).not.toContain('https://refactoringhq.github.io/tolaria/')
    expect(html).not.toContain('DOWNLOAD_TARGETS')
  })
})

describe('resolveStableDownloadTargets', () => {
  it('falls back to stable release assets when latest.json is incomplete', () => {
    const latestPayload = {
      platforms: {
        'darwin-aarch64': {
          download_url: 'https://example.com/Memoria-aarch64.dmg',
        },
      },
    }
    const releasesPayload = [
      {
        prerelease: false,
        assets: [
          {
            name: 'Memoria_x64.dmg',
            browser_download_url: 'https://example.com/Memoria-x64.dmg',
          },
          {
            name: 'Memoria-setup.exe',
            browser_download_url: 'https://example.com/Memoria-setup.exe',
          },
          {
            name: 'Memoria.AppImage',
            browser_download_url: 'https://example.com/Memoria.AppImage',
          },
          {
            name: 'Memoria.rpm',
            browser_download_url: 'https://example.com/Memoria.rpm',
          },
        ],
      },
    ]

    expect(extractStableDownloadTargetsFromReleases(releasesPayload)).toMatchObject({
      'darwin-x86_64': {
        url: 'https://example.com/Memoria-x64.dmg',
      },
      'linux-x86_64': {
        url: 'https://example.com/Memoria.AppImage',
      },
      'linux-x86_64-rpm': {
        label: 'Linux RPM',
        url: 'https://example.com/Memoria.rpm',
      },
      'windows-x86_64': {
        url: 'https://example.com/Memoria-setup.exe',
      },
    })
    expect(resolveStableDownloadTargets(latestPayload, releasesPayload)).toMatchObject({
      'darwin-aarch64': {
        url: 'https://example.com/Memoria-aarch64.dmg',
      },
      'darwin-x86_64': {
        url: 'https://example.com/Memoria-x64.dmg',
      },
      'linux-x86_64': {
        url: 'https://example.com/Memoria.AppImage',
      },
      'linux-x86_64-rpm': {
        label: 'Linux RPM',
        url: 'https://example.com/Memoria.rpm',
      },
      'windows-x86_64': {
        url: 'https://example.com/Memoria-setup.exe',
      },
    })
  })

  it('keeps AppImage as the Linux auto-download while exposing RPM manually', () => {
    const html = buildStableDownloadRedirectPage({
      'linux-x86_64': {
        buttonLabel: 'Download Memoria AppImage for Linux',
        label: 'Linux AppImage',
        url: 'https://example.com/Memoria.AppImage',
      },
      'linux-x86_64-rpm': {
        buttonLabel: 'Download Memoria RPM for Linux',
        label: 'Linux RPM',
        url: 'https://example.com/Memoria.rpm',
      },
    })

    expect(html).toContain('linux-x86_64-rpm')
    expect(html).toContain('Linux AppImage')
    expect(html).toContain('Linux RPM')
    expect(html).toContain("if (/Linux/i.test(userAgent) && !/Android/i.test(userAgent)) return 'linux-x86_64';")
  })
})
