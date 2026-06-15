import type { NavItem } from './types'

function remoteNavBasePath(itemUrl: string) {
  const pathOnly = itemUrl.split('?')[0] ?? itemUrl
  const segments = pathOnly.split('/').filter(Boolean)
  if (segments.length === 0) return '/'
  return `/${segments[0]}`
}

function hrefMatchesRemoteBase(href: string, basePath: string) {
  const pathOnly = href.split('?')[0] ?? href
  if (pathOnly === basePath) return true
  return pathOnly.startsWith(`${basePath}/`)
}

export function checkIsActive(href: string, item: NavItem, mainNav = false) {
  const pathOnly = href.split('?')[0] ?? href

  if ('accentColor' in item && item.accentColor && 'url' in item && item.url) {
    const basePath = remoteNavBasePath(item.url)
    return hrefMatchesRemoteBase(pathOnly, basePath)
  }

  return (
    href === item.url ||
    pathOnly === item.url ||
    !!item?.items?.filter((i) => i.url === href || i.url === pathOnly).length ||
    (mainNav &&
      href.split('/')[1] !== '' &&
      href.split('/')[1] === item?.url?.split('/')[1])
  )
}
