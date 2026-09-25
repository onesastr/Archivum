import { contextBridge, ipcRenderer } from "electron";

const api = {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("pick-folder") as Promise<string | null>,
  organizeDryRun: (mode: string, folder: string): Promise<unknown> => ipcRenderer.invoke("organize-dry-run", mode, folder) as Promise<unknown>,
  organizeApply: (res: unknown): Promise<unknown> => ipcRenderer.invoke("organize-apply", res) as Promise<unknown>,
  undo: (id: string | null): Promise<unknown> => ipcRenderer.invoke("undo", id) as Promise<unknown>,
};

contextBridge.exposeInMainWorld("archivum", api);
