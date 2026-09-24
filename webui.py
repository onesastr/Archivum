#!/usr/bin/env python3
"""
Archivum web UI.

Serves a local interface for driving the archivum automation tools, plus a
small JSON API that the front end uses.

Run with:

    python3 webui.py                  # http://127.0.0.1:8000
    python3 webui.py --port 9000
    python3 webui.py --host 127.0.0.1

The server is intended for local use only; it can modify files on disk at
the paths you give it.
"""

import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from archivumlib import tools

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "webui" / "static"

RELATED_MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "ArchivumUI/1.0"

    # ------------------------------------------------------------------ #
    # response helpers
    # ------------------------------------------------------------------ #

    def _send(self, body: bytes, status: int = 200, content_type: str = "text/plain"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, status: int = 200):
        self._send(
            json.dumps(obj).encode("utf-8"),
            status=status,
            content_type="application/json",
        )

    def _serve_static(self, name: str):
        # Only allow files inside the static directory.
        candidate = (STATIC_DIR / name).resolve()
        if STATIC_DIR not in candidate.parents and candidate != STATIC_DIR:
            self._send(b"not found", status=404)
            return

        if not candidate.is_file():
            self._send(b"not found", status=404)
            return

        body = candidate.read_bytes()
        self._send(body, content_type=RELATED_MIME.get(candidate.suffix, "application/octet-stream"))

    # ------------------------------------------------------------------ #
    # routing
    # ------------------------------------------------------------------ #

    def _browse_params(self, query: str) -> str:
        """Return a directory path from the query string, defaulting to home."""
        params = parse_qs(query)
        raw = params.get("path", [""])[0]

        if raw:
            candidate = Path(raw).expanduser()
        else:
            candidate = Path.home()

        if not candidate.is_absolute():
            raise ValueError("Path must be absolute")

        return candidate

    def _browse(self, query: str):
        """List the subdirectories of the requested path for the folder picker."""
        try:
            current = self._browse_params(query)
        except ValueError as err:
            self._json({"error": str(err)}, status=400)
            return

        if not current.exists():
            self._json({"error": f"No such path: {current}"}, status=404)
            return

        if not current.is_dir():
            self._json({"error": f"Not a directory: {current}"}, status=400)
            return

        if current == current.parent:
            parent = None
        else:
            parent = str(current.parent)

        entries = []
        try:
            for child in current.iterdir():
                if child.is_dir() and not child.name.startswith("."):
                    entries.append(child.name)
        except OSError as err:
            self._json({"error": f"Cannot read directory: {err}"}, status=403)
            return

        self._json(
            {
                "path": str(current),
                "parent": parent,
                "home": str(Path.home()),
                "entries": sorted(entries, key=str.lower),
            }
        )

    def do_GET(self):
        path = urlparse(self.path).path

        if path in ("/", "/index.html"):
            self._serve_static("index.html")
        elif path.startswith("/static/"):
            self._serve_static(path[len("/static/"):])
        elif path == "/api/tools":
            self._json({"tools": [tool.meta() for tool in tools.all_tools()]})
        elif path == "/api/browse":
            self._browse(urlparse(self.path).query)
        else:
            self._json({"error": f"not found: {path}"}, status=404)

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/health":
            self._json({"ok": True})
            return

        match = re.fullmatch(r"/api/tools/([^/]+)/(preview|run)", parsed.path)

        if not match:
            self._json({"error": "not found"}, status=404)
            return

        tool_id, action = match.group(1), match.group(2)

        try:
            config = self._read_body()
            result = tools.run_tool(tool_id, config, dry_run=(action == "preview"))
        except ValueError as err:
            self._json({"error": str(err)}, status=400)
            return
        except Exception as err:  # unexpected tool failure
            self._json({"error": f"Tool failed: {err}"}, status=500)
            return

        self._json(result)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))

        if length <= 0:
            return {}

        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("Request body is not valid JSON")

        if not isinstance(body, dict):
            raise ValueError("Request body must be a JSON object")

        return body

    def log_message(self, fmt, *args):
        # Quiet by default; uncomment for debugging.
        # print("[ui] " + fmt % args)
        pass


def main():
    parser = argparse.ArgumentParser(description="Archivum web UI")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Bind port (default: 8000)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)

    url = f"http://{args.host}:{args.port}"
    print(f"Archivum UI running at {url}")

    if not args.no_browser:
        import webbrowser
        webbrowser.open(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")


if __name__ == "__main__":
    main()