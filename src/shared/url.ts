import { THUMB_SCHEME, type IccInfo } from './contract'

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}

export type AssetKind = 'thumb' | 'preview' | 'original'

export function buildAssetUrl(
  kind: AssetKind,
  path: string,
  options: { size?: number; icc?: boolean; version?: number | null } = {}
): string {
  const params = new URLSearchParams()
  if (options.size != null) params.set('s', String(options.size))
  if (options.icc) params.set('icc', '1')
  if (options.version != null) params.set('v', String(options.version))
  const query = params.toString()
  return `${THUMB_SCHEME}://${kind}/${toBase64Url(path)}${query ? `?${query}` : ''}`
}

export function parseAssetUrl(url: string): { kind: AssetKind; path: string; size: number | null; icc: boolean; version: number | null } | null {
  const prefix = `${THUMB_SCHEME}://`
  if (!url.startsWith(prefix)) return null
  const rest = url.slice(prefix.length)
  const separator = rest.indexOf('/')
  if (separator === -1) return null
  const kind = rest.slice(0, separator) as AssetKind
  if (kind !== 'thumb' && kind !== 'preview' && kind !== 'original') return null
  const queryIndex = rest.indexOf('?')
  const segment = queryIndex === -1 ? rest.slice(separator + 1) : rest.slice(separator + 1, queryIndex)
  const params = new URLSearchParams(queryIndex === -1 ? '' : rest.slice(queryIndex + 1))
  const size = params.get('s')
  const version = params.get('v')
  return {
    kind,
    path: fromBase64Url(segment),
    size: size ? Number(size) : null,
    icc: params.get('icc') === '1',
    version: version ? Number(version) : null
  }
}

const SRGB_ALIASES = new Set(['srgb', 'srgb iec61966-2.1', 'srgb built-in'])

export function isSrgbProfile(icc: IccInfo | null): boolean {
  if (!icc) return false
  if (icc.isSrgb) return true
  if (!icc.name) return false
  return SRGB_ALIASES.has(icc.name.trim().toLowerCase())
}
