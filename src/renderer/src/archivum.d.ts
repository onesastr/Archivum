/** Typed window.archivum — the preload contextBridge API. */
export interface RendererApi {
  pickFolder(): Promise<string | null>;
  organizeDryRun(mode: string, folder: string): Promise<{
    folder: string;
    entries: Array<{ source: string; destination: string; note?: string; reason?: string; detail?: string }>;
    summary: Record<string, number>;
  }>;
  organizeApply(result: unknown): Promise<{ ok: boolean; undoId?: string }>;
  undo(id: string | null): Promise<{ ok: boolean; undoId?: string | null }>;
}

declare global {
  interface Window {
    archivum: RendererApi;
  }
}
