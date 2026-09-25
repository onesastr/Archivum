import { useRef, useState } from "react";

export type Mode = "date" | "renumber" | "randomize" | "junk" | "dedupe";

interface Row {
  source: string;
  destination: string;
  note?: string;
}

interface DryResult {
  entries?: Row[];
  summary?: Record<string, number>;
  ok?: boolean;
  error?: string;
  undoId?: string | null;
}

export function App() {
  const [mode, setMode] = useState<Mode>("date");
  const [folder, setFolder] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [applied, setApplied] = useState(false as boolean);
  const [status, setStatus] = useState("");
  const planRef = useRef<DryResult | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);

  async function pick() {
    const f = await window.archivum.pickFolder();
    if (f) setFolder(f);
  }

  async function dryRun() {
    if (!folder) return;
    const res = (await window.archivum.organizeDryRun(mode, folder)) as DryResult;
    planRef.current = res;
    setRows(res.entries ?? []);
    setSummary(res.summary ?? {});
    setApplied(false);
    setStatus("");
  }

  async function apply() {
    if (!folder || !planRef.current) return;
    const res = (await window.archivum.organizeApply(planRef.current)) as DryResult;
    if (res.ok === false) {
      setStatus(`apply failed: ${res.error ?? "unknown"}`);
      return;
    }
    setApplied(true);
    setUndoId(res.undoId ?? null);
    setSummary(res.summary ?? {});
    setStatus("applied ✓  you can undo");
  }

  async function goUndo() {
    await window.archivum.undo(undoId);
    setRows([]);
    setApplied(false);
    setStatus("undone ✓");
  }

  const modes: { id: Mode; label: string }[] = [
    { id: "date", label: "organize by date" },
    { id: "renumber", label: "renumber 0001.." },
    { id: "randomize", label: "randomize order" },
    { id: "junk", label: "clean junk files" },
    { id: "dedupe", label: "dedupe by hash" },
  ];

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 text-slate-900">
      <h1 className="text-2xl font-semibold">Archivum</h1>
      <p className="mt-1 text-sm text-slate-500">Photo toolbox — batch ops, dry-run first, always undoable.</p>

      <div className="mt-6 flex flex-wrap gap-2">
        <button className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700" onClick={pick}>
          Pick a folder…
        </button>
        <button className="rounded-md border border-slate-300 px-4 py-2 text-sm enabled:hover:bg-slate-50 disabled:opacity-40" onClick={dryRun} disabled={!folder}>
          Dry-run {mode}
        </button>
        <button className="rounded-md bg-emerald-700 px-4 py-2 text-sm text-white enabled:hover:bg-emerald-600 disabled:opacity-40" onClick={apply} disabled={!folder || rows.length === 0}>
          Apply
        </button>
        <button className="rounded-md border border-slate-300 px-4 py-2 text-sm enabled:hover:bg-slate-50 disabled:opacity-40" onClick={goUndo} disabled={!applied}>
          Undo
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1 text-sm">
        {modes.map((m) => (
          <button
            key={m.id}
            className={`rounded-full px-3 py-1 ${mode === m.id ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {folder ? <p className="mt-3 text-xs text-slate-500">folder: {folder}</p> : <p className="mt-3 text-xs text-slate-400">no folder yet</p>}
      {status ? <p className="mt-2 text-xs text-emerald-700">{status}</p> : null}

      {rows.length > 0 ? (
        <>
          <table className="mt-6 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400">
                <th className="pb-2">Source</th>
                <th className="pb-2">Destination</th>
                <th className="pb-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.source} className="border-b border-slate-100">
                  <td className="py-2 pr-4">{r.source}</td>
                  <td className="py-2 pr-4">{r.destination}</td>
                  <td className="py-2">{r.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">
            {Object.entries(summary)
              .map(([k, v]) => `${k}: ${v}`)
              .join("   ")}
          </p>
        </>
      ) : (
        <p className="mt-8 text-xs text-slate-400">No plan yet. Pick a folder and dry-run an operation.</p>
      )}
    </main>
  );
}
