import { useCallback } from 'react'
import { Linking } from 'react-native'
import { mobileResolvedAttachmentHref } from './mobileAttachmentUris'

export type MobileAttachmentLinkOpener = (href: string) => void

export function useMobileAttachmentLinkOpener(vaultRootUri?: string | null): MobileAttachmentLinkOpener {
  return useCallback((href: string) => {
    const resolvedHref = mobileResolvedAttachmentHref(href, vaultRootUri)
    if (!isOpenableMobileHref(resolvedHref)) return

    void Linking.openURL(resolvedHref)
  }, [vaultRootUri])
}

function isOpenableMobileHref(href: string): boolean {
  return /^(?:https?|mailto|tel|file):/iu.test(href)
}
