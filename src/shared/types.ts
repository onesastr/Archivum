/** Archivum shared IPC types — importable from main, preload, and renderer. */

/** A scanned file. */
export interface FileEntry {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
}

/** One planned (or applied) filesystem action. */
export interface PlanEntry {
  /** current absolute path */
  source: string;
  /** target absolute path (same value = no-op for this file) */
  destination: string;
  reason: "date" | "renumber" | "random" | "junk" | "duplicate";
  detail?: string;
}

/** Dry-run / apply result. */
export interface DryRun {
  folder: string;
  entries: PlanEntry[];
  summary: Record<string, number>;
}

/** Folder-level operation options (dryRun=true is always default). */
export interface OrganizeOptions {
  folder: string;
  dryRun?: boolean;
}

export interface RenumberOptions {
  folder: string;
  dryRun?: boolean;
  prefix?: string;
}

export interface RandomizeOptions {
  folder: string;
  dryRun?: boolean;
  prefix?: string;
}

export interface JunkOptions {
  folder: string;
  dryRun?: boolean;
}

export interface DedupeOptions {
  folder: string;
  dryRun?: boolean;
}

/** Result of applying a plan. */
export interface ApplyResult {
  ok: boolean;
  error?: string;
  dryRun: DryRun;
  /** journal id used to undo this operation */
  undoId?: string;
}

/** Entries for undo backend. */
export interface UndoEntry {
  source: string;
  destination: string;
}

/** One recorded operation that can be reverted. */
export interface UndoRecord {
  id: string;
  time: number;
  label: string;
  entries: UndoEntry[];
}

/** API surface exposed to the renderer via the contextBridge. */
export interface ArchivumApi {
  pickFolder(): Promise<string | null>;
  organizeByDate(opts: OrganizeOptions): Promise<DryRun>;
  renumber(opts: RenumberOptions): Promise<DryRun>;
  randomize(opts: RandomizeOptions): Promise<DryRun>;
  junkClean(opts: JunkOptions): Promise<DryRun>;
  dedupe(opts: DedupeOptions): Promise<DryRun>;
  undo(label: string): Promise<UndoRecord | null>;
  listUndo(): Promise<UndoRecord[]>;
}
