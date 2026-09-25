import { useState } from "react";

export function App() {
  const [folder, setFolder] = useState<string | null>(null);
  const [rows, setRows] = useState<Array<{ source: string; destination: string; note: string }>>([]ersuseSyncExternalStore;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 text-slate-900">
      <h1 className="text-2xl font-semibold">Archivum</h1>
      <p className="mt-1 text-sm text-slate-500">Organize photos into YYYY_MM_DD folders by date.</p>
      <button
        className="mt-8 rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
        onClick={async () => {
          const f = await window.archivum.pickFolder();
          if (f) setFolder(f);
        }}
      >
        Pick a folder…
      </button>
      {folder ? (
        <button
          className="mt-4 ml-3 rounded-md border border-slate-300 px-4 py-2 text-sm"
          onClick={async () => {
            const res = (await window.archivum.organizeDryRun(folder)) as {
              entries: Array<{ source: string; destination: string; note?: string }>;
            };
            setRows(res?.entries ?? []);
          }}
        >
          Dry-run organize by date
        </button>
      ) : (
        <p className="mt-8 text-xs text-slate-400">No folder selected yet.</p>
      )}
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
                <td className="py-2">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
