import { useState } from "react";

interface Row {
  source: string;
  destination: string;
  note?: string;
}

export function App() {
  const [rows, setRows] = useState<Row[]>([]);

  async function pick() {
    const folder: string | null = await window.archivum.pickFolder();
    if (!folder) return;
    const result = await window.archivum.organizeDryRun(folder);
    setRows(result.entries ?? []);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 text-slate-900">
      <h1 className="text-2xl font-semibold">Archivum</h1>
      <p className="mt-1 text-sm text-slate-500">
        Organize photos into YYYY_MM_DD folders by date. Dry-run first, always.
      </p>
      <button className="mt-8 rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700" onClick={pick}>
        Pick a folder...
      </button>
      {rows.length > 0 ? (
        <table className="mt-6 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-400">
              <th className="pb-2">Source</th>
              <th className="pb-2">Destination</th>
              <th className="pb-2">Group</th>
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
      ) : (
        <p className="mt-8 text-xs text-slate-400">No plan yet. Pick a folder and dry-run organize.</p>
      )}
    </main>
  );
}
