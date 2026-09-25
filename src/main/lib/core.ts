import { createHash } from "node:crypto";
import { promises as fsP } from "node:fs";
import { createReadStream } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import exifr from "exifr";
import type { DryRun, FileEntry, PlanEntry, UndoRecord } from "../../shared/types";

const IMG_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".tif", ".tiff", ".dng", ".cr2", ".nef"]);
const JUNK_RE = [/^\.DS_Store$/i, /^Thumbs\.db$/i, /^desktop\.ini$/i, /^\$~/i, /^~\$.*\./, /\.(tmp|part)$/i, /^\.archivum\./, /^~lock\./];


export function pad4(n: number): string { return n.toString().padStart(4, "0"); }
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}export function isImage(name: string): boolean {
  return IMG_EXT.has(extname(name).toLowerCase());
}
export function isJunk(name: string): boolean {
  return JUNK_RE.some((re) => re.test(name));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function ymd(d: Date): string {
  return `${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}`;
}

export function dateFromName(name: string): string | null {
  const m = name.match(/(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})/);
  if (!m) return null;
  const mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}_${pad(mo)}_${pad(d)}`;
}

export async function dateFromExif(path: string): Promise<string | null> {
  try {
    const t = (await exifr.parse(path, ["DateTimeOriginal", "CreateDate", "ModifyDate"])) as Record<string, Date | undefined> | undefined;
    const dt = t?.DateTimeOriginal ?? t?.CreateDate ?? t?.ModifyDate;
    if (dt instanceof Date && !Number.isNaN(dt.getTime())) return ymd(dt);
    return null;
  } catch {
    return null;
  }
}

export async function dateForFile(path: string, name: string): Promise<string | null> {
  return dateFromName(name) ?? (await dateFromExif(path)) ?? null;
}

async function sha1(path: string): Promise<string> {
  const h = createHash("sha1");
  const s = createReadStream(path);
  for await (const chunk of s) h.update(chunk as Buffer);
  return h.digest("hex");
}

function uniqueName(destFolder: string, name: string, used: Set<string>): string {
  const ext = extname(name);
  const stem = basename(name, ext);
  let out = name;
  let n = 1;
  while (used.has(out)) out = `${stem}_${n++}${ext}`;
  used.add(out);
  return join(destFolder, out);
}

export async function buildPlan(folder: string, useExif: boolean, mode: GroupMode = "date"): Promise<DryRun> {
  const entries: PlanEntry[] = [];
  const used = new Set<string>();
  const seen = new Map<string, string>();
  let junk = 0;
  let dup = 0;
  let files = (await fsP.readdir(folder)).filter((n) => !isJunk(n));
  if (mode === "junk") {
    const all = await fsP.readdir(folder);
    for (const name of all) {
      const path = join(folder, name);
      if (isJunk(name)) {
        junk++;
        entries.push({ source: path, destination: "", reason: "junk", detail: "non-image or junk file" });
      }
    }
    return {
      folder,
      entries,
      summary: { moved: 0, dup_hash: 0, junk, unsafe: 0 },
    };
  }
  if (mode === "renumber" || mode === "randomize") {
    const files = (await fsP.readdir(folder)).filter((n) => isImage(n));
    if (mode === "randomize") files.sort(() => Math.random() - 0.5);
    const entriesLocal: PlanEntry[] = [];
    for (const [k, name] of files.entries()) {
      const path = join(folder, name.name);
      if (!isImage(name.name)) continue;
      const ext = extname(name.name).toLowerCase() || ".jpg";
      const dest = join(folder, `${pad4(k + 1)}${ext}`);
      entriesLocal.push({ source: path, destination: dest, reason: "renumber", detail: `${mode} sequence ${k + 1}` });
    }
    return {
      folder,
      entries: entriesLocal,
      summary: { moved: entriesLocal.length, dup_hash: 0, junk: 0, unsafe: 0 },
    };
  }  for (const name of files) {
    const path = join(folder, name);
    if (!isImage(name)) continue;
    const group = await dateForFile(path, name);
    if (!group) continue;
    const hash = await sha1(path);
    const first = seen.get(hash);
    if (first) {
      dup++;
      entries.push({ source: path, destination: "", reason: "duplicate", detail: `duplicate of ${first}` });
      continue;
    }
    seen.set(hash, path);
    const dest = uniqueName(folder, `${group}_${name}`, used);
    entries.push({ source: path, destination: dest, reason: "date", detail: group });
  }
  return {
    folder,
    entries,
    summary: { moved: entries.filter((e) => e.reason === "date").length, dup_hash: dup, junk, unsafe: 0 },
  };
}

export async function applyPlan(plan: DryRun): Promise<{ ok: boolean; undo: { from: string; to: string }[] }> {
  const undo: { from: string; to: string }[] = [];
  for (const e of plan.entries) {
    if (!e.destination || e.destination === e.source) continue;
    const dir = dirname(e.destination);
    await fsP.mkdir(dir, { recursive: true });
    await fsP.rename(e.source, e.destination);
    undo.push({ from: e.source, to: e.destination });
  }
  return { ok: true, undo };
}

export type GroupMode = "date" | "renumber" | "randomize" | "junk" | "dedupe";
export function groupFromMode(mode: string): GroupMode {
  switch (mode) {
    case "renumber": return "renumber";
    case "randomize": return "randomize";
    case "junk": return "junk";
    case "dedupe": return "dedupe";
    default: return "date";
  }
}
