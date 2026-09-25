import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { buildOrganizePlan, applyPlan } from "./lib/core";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    show: false,
    webPreferences: { preload: join(__dirname, "../preload/index.js") },
  });
  win.once("ready-to-show", () => win.show());
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}

ipcMain.handle("pick-folder", async (): Promise<string | null> => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return null;
  void win.minimize();
  const { dialog } = await import("electron");
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

ipcMain.handle("organize-dry-run", async (_e, folder: string): Promise<unknown> => {
  return buildOrganizePlan(folder /* as const */, true);
});

ipcMain.handle("organize-apply", async (e, res: unknown): Promise<unknown> => {
  return applyPlan(res as import("../../shared/types").DryRun);
});

ipcMain.handle("undo", async (e, undoId: string | null): Promise<unknown> => {
  return { ok: true, undoId };
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
