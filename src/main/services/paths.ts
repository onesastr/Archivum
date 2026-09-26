import { isAbsolute, normalize, resolve, sep } from 'node:path'

const DANGEROUS_SEGMENTS = new Set(['..', '.'])

export function normalizePath(input: string): string {
  const expanded = input.startsWith('~')
    ? `${process.env.HOME ?? process.env.USERPROFILE ?? ''}${input.slice(1)}`
    : input
  const normalized = normalize(resolve(expanded))
  return normalized.length > 1 ? normalized.replace(/[\\/]+$/, '') : normalized
}

export function isSafePath(candidate: string): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false
  if (candidate.includes('\u0000')) return false
  const segments = candidate.split(/[\\/]/)
  return !segments.some((segment) => DANGEROUS_SEGMENTS.has(segment))
}

export function assertPathList(candidate: unknown): string[] {
  if (!Array.isArray(candidate)) {
    throw new TypeError(`expected an array of paths, received ${typeof candidate}`)
  }
  return candidate.map(assertSafePath)
}

export function assertSafePath(candidate: string): string {
  const normalized = normalizePath(candidate)
  if (!isAbsolute(normalized)) throw new Error(`path must be absolute: ${candidate}`)
  if (!isSafePath(candidate)) throw new Error(`path contains traversal segments: ${candidate}`)
  return normalized
}

export function isWithin(parent: string, child: string): boolean {
  if (parent === child) return true
  const prefix = parent.endsWith(sep) ? parent : `${parent}${sep}`
  return child.startsWith(prefix)
}

export function pathDepth(path: string): number {
  return path.split(sep).filter((segment) => segment.length > 0).length
}

export function joinPath(...segments: string[]): string {
  return normalizePath(segments.filter((segment) => segment.length > 0).join(sep))
}

export function homeDirectory(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '/'
}
