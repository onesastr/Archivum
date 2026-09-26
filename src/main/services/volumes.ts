import { execFile } from 'node:child_process'
import { readdir, statfs } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'
import { promisify } from 'node:util'
import type { VolumeInfo, VolumeKind } from '../../shared/contract'
import type { ArchivumDatabase } from '../db'
import { homeDirectory } from './paths'

const run = promisify(execFile)

const NETWORK_FILESYSTEMS = new Set([
  'nfs',
  'nfs4',
  'cifs',
  'smbfs',
  'smb3',
  'sshfs',
  'fuse.sshfs',
  'davfs',
  'fuse.davfs',
  'webdav',
  'afpfs',
  '9p',
  'afs',
  'ceph',
  'glusterfs',
  'fuse.rclone',
  'rclone'
])

const LOCAL_FILESYSTEMS = new Set([
  'ext2',
  'ext3',
  'ext4',
  'btrfs',
  'xfs',
  'f2fs',
  'jfs',
  'reiserfs',
  'ufs',
  'apfs',
  'hfs',
  'hfsplus',
  'msdos',
  'vfat',
  'exfat',
  'ntfs',
  'ntfs3',
  'zfs',
  'nilfs2'
])

const SKIPPED_FILESYSTEMS = new Set([
  'proc',
  'sysfs',
  'devtmpfs',
  'devpts',
  'tmpfs',
  'cgroup',
  'cgroup2',
  'securityfs',
  'bpf',
  'tracefs',
  'debugfs',
  'fusectl',
  'configfs',
  'mqueue',
  'hugetlbfs',
  'pstore',
  'ramfs',
  'binfmt_misc',
  'autofs',
  'rpc_pipefs',
  'nsfs',
  'efivarfs',
  'squashfs',
  'overlay',
  'iso9660',
  'udev'
])

const NETWORK_MOUNT_ROOTS = ['/mnt', '/media', '/run/media', '/net', '/Volumes']

interface SpaceInfo {
  totalBytes: number | null
  freeBytes: number | null
}

async function spaceFor(path: string): Promise<SpaceInfo> {
  try {
    const stats = await statfs(path)
    const blockSize = Number(stats.bsize)
    return {
      totalBytes: Number(stats.blocks) * blockSize,
      freeBytes: Number(stats.bavail) * blockSize
    }
  } catch {
    return { totalBytes: null, freeBytes: null }
  }
}

function classifyFilesystem(
  filesystem: string,
  mountPoint: string,
  device: string
): VolumeKind | null {
  const fs = filesystem.toLowerCase()
  if (SKIPPED_FILESYSTEMS.has(fs)) return null
  if (NETWORK_FILESYSTEMS.has(fs)) return 'network'
  if (fs.startsWith('fuse.') && NETWORK_FILESYSTEMS.has(fs)) return 'network'
  if (LOCAL_FILESYSTEMS.has(fs)) return mountPoint === '/' ? 'root' : 'local'
  if (device.startsWith('/dev/')) return 'local'
  if (mountPoint === '/') return 'root'
  for (const root of NETWORK_MOUNT_ROOTS) {
    if (mountPoint === root || mountPoint.startsWith(`${root}${sep}`)) return 'network'
  }
  return null
}

function labelFor(mountPoint: string, device: string): string {
  if (mountPoint === '/') return 'Root'
  if (mountPoint === homeDirectory()) return 'Home'
  const name = basename(mountPoint)
  if (name.length > 0) return name
  return device
}

interface LinuxMount {
  device: string
  mountPoint: string
  filesystem: string
}

async function readLinuxMounts(): Promise<LinuxMount[]> {
  const { stdout } = await run('df', ['-lP', '--output=source,fstype,target'], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024
  })
  const rows = stdout.split('\n').slice(1)
  const mounts: LinuxMount[] = []
  for (const row of rows) {
    if (row.trim().length === 0) continue
    const parts = row.split(/\s+/)
    if (parts.length < 3) continue
    mounts.push({ device: parts[0], filesystem: parts[1], mountPoint: parts.slice(2).join(' ') })
  }
  return mounts
}

async function readDarwinVolumes(): Promise<VolumeInfo[]> {
  const { stdout } = await run('df', ['-l'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  const volumes: VolumeInfo[] = []
  const seen = new Set<string>()
  for (const line of stdout.split('\n').slice(1)) {
    if (line.trim().length === 0) continue
    const match = /^(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line)
    if (!match) continue
    const [, device, , , , , rawMount] = match
    const mountPoint = rawMount.trim()
    if (seen.has(mountPoint)) continue
    const kind = classifyFilesystem(device, mountPoint, device)
    if (kind === null) continue
    seen.add(mountPoint)
    const space = await spaceFor(mountPoint)
    volumes.push({
      path: mountPoint,
      label: labelFor(mountPoint, device),
      kind,
      filesystem: device,
      totalBytes: space.totalBytes,
      freeBytes: space.freeBytes,
      isNetwork: kind === 'network',
      isFavorite: false
    })
  }
  return volumes
}

async function readLinuxVolumes(): Promise<VolumeInfo[]> {
  const mounts = await readLinuxMounts()
  const volumes: VolumeInfo[] = []
  const seen = new Set<string>()
  for (const mount of mounts) {
    const kind = classifyFilesystem(mount.filesystem, mount.mountPoint, mount.device)
    if (kind === null) continue
    if (seen.has(mount.mountPoint)) continue
    seen.add(mount.mountPoint)
    const space = await spaceFor(mount.mountPoint)
    volumes.push({
      path: mount.mountPoint,
      label: labelFor(mount.mountPoint, mount.device),
      kind,
      filesystem: mount.filesystem,
      totalBytes: space.totalBytes,
      freeBytes: space.freeBytes,
      isNetwork: kind === 'network',
      isFavorite: false
    })
  }
  return volumes
}

async function readWindowsVolumes(): Promise<VolumeInfo[]> {
  const volumes: VolumeInfo[] = []
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const mountPoint = `${letter}:\\`
    const space = await spaceFor(mountPoint)
    if (space.totalBytes === null) continue
    volumes.push({
      path: mountPoint,
      label: `${letter}:`,
      kind: 'removable',
      filesystem: null,
      totalBytes: space.totalBytes,
      freeBytes: space.freeBytes,
      isNetwork: false,
      isFavorite: false
    })
  }
  return volumes
}

async function readPlaceholderMountRoots(): Promise<VolumeInfo[]> {
  const results: VolumeInfo[] = []
  for (const root of NETWORK_MOUNT_ROOTS) {
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(root, entry)
      const space = await spaceFor(full)
      if (space.totalBytes === null) continue
      results.push({
        path: full,
        label: entry,
        kind: 'network',
        filesystem: null,
        totalBytes: space.totalBytes,
        freeBytes: space.freeBytes,
        isNetwork: true,
        isFavorite: false
      })
    }
  }
  return results
}

export class VolumeService {
  constructor(private readonly db: ArchivumDatabase) {}

  async list(): Promise<VolumeInfo[]> {
    const platform = process.platform
    let detected: VolumeInfo[] = []
    try {
      if (platform === 'darwin') detected = await readDarwinVolumes()
      else if (platform === 'win32') detected = await readWindowsVolumes()
      else detected = await readLinuxVolumes()
    } catch {
      detected = []
    }

    if (platform === 'linux') {
      const placeholders = await readPlaceholderMountRoots()
      const known = new Set(detected.map((volume) => volume.path))
      detected = [...detected, ...placeholders.filter((volume) => !known.has(volume.path))]
    }

    for (const volume of detected) this.db.upsertVolume(volume)

    const stored = new Map(this.db.listVolumes().map((volume) => [volume.path, volume]))
    const merged = detected.map((volume) => {
      const previous = stored.get(volume.path)
      return { ...volume, isFavorite: previous?.isFavorite ?? false }
    })

    const favorites = this.db
      .listVolumes()
      .filter((volume) => volume.isFavorite && !merged.some((entry) => entry.path === volume.path))
      .map<VolumeInfo>((volume) => ({ ...volume, isNetwork: volume.isNetwork }))

    return [...favorites, ...merged].sort((left, right) => {
      if (left.isFavorite !== right.isFavorite) return left.isFavorite ? -1 : 1
      return left.path.localeCompare(right.path)
    })
  }

  setFavorite(path: string, favorite: boolean): VolumeInfo[] {
    this.db.setVolumeFavorite(path, favorite)
    return this.db.listVolumes()
  }

  findContaining(volumes: VolumeInfo[], path: string): VolumeInfo | null {
    let best: VolumeInfo | null = null
    for (const volume of volumes) {
      if (path === volume.path || path.startsWith(volume.path.endsWith(sep) ? volume.path : `${volume.path}${sep}`)) {
        if (best === null || volume.path.length > best.path.length) best = volume
      }
    }
    return best
  }
}
