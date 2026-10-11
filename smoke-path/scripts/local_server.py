"""Serve the Lambda handler and the web app on localhost, without Docker or SAM.

    python3.12 scripts/local_server.py              # then open http://127.0.0.1:8000/
    python3.12 scripts/local_server.py --port 9000

GET /smoke, /fires, /air, /stations, /forecast, /alerts, /activity, /cases and POST /alerts,
PATCH /cases/<id> -> turned into an API Gateway (HTTP API v2) event for the handler
GET /index.html (and css/, js/, data/) -> the web app in frontend/ (saved sample data when there is no ?api=)
GET /            -> redirects to /index.html?api=/ (live, through this server)

Alerts and cases are kept in memory here, so they are gone when you stop the server.

Fires use FIRMS_MAP_KEY from smoke-path/.env (or your shell).
"""

import argparse
import base64
import gzip
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from _env import load_env  # noqa: E402

from smoke_path.app import lambda_handler  # noqa: E402

FRONTEND = ROOT / "frontend"
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"}
API_PATHS = ("/smoke", "/fires", "/air", "/stations", "/forecast", "/alerts", "/activity", "/cases")
TEXT = {"Content-Type": "text/plain; charset=utf-8"}


def make_event(method, path, query, headers=None, body=None):
    """A minimal API Gateway HTTP API (payload v2) event."""
    params = {}
    for key, value in parse_qsl(query, keep_blank_values=True):
        # API Gateway v2 joins repeated parameters with commas.
        params[key] = f"{params[key]},{value}" if key in params else value
    return {
        "version": "2.0",
        "routeKey": f"{method} {path}",
        "rawPath": path,
        "rawQueryString": query,
        "queryStringParameters": params or None,
        "headers": {str(k).lower(): v for k, v in (headers or {}).items()},
        "requestContext": {"http": {"method": method, "path": path}},
        **({"body": body.decode("utf-8", errors="replace"), "isBase64Encoded": False} if body else {}),
    }


def static_file(path):
    """(status, headers, body) for a file under frontend/, or None. Never leaves that folder."""
    rel = "index.html" if path in ("/", "") else path.lstrip("/")
    target = (FRONTEND / rel).resolve()
    if FRONTEND.resolve() not in target.parents or not target.is_file():
        return None
    out = {"Content-Type": TYPES.get(target.suffix, "application/octet-stream"), "Cache-Control": "no-store"}
    return 200, out, target.read_bytes()


def route(method, target, headers=None, body=None):
    """(status, headers, body bytes) for one request. No sockets, so tests can call it."""
    parts = urlsplit(target)
    path = parts.path or "/"
    accepts_gzip = "gzip" in str((headers or {}).get("Accept-Encoding", "")).lower()
    if path in API_PATHS or path.startswith("/cases/") or (path.startswith("/alerts/") and path.endswith("/ack")) or path.startswith("/farmer/"):
        resp = lambda_handler(make_event(method, path, parts.query, headers, body))
        out = resp["body"]
        data = base64.b64decode(out) if resp.get("isBase64Encoded") else out.encode("utf-8")
        return resp["statusCode"], resp["headers"], data
    if method not in ("GET", "HEAD"):
        return 405, TEXT, b"Method not allowed"
    if path == "/":
        return 302, {"Location": "/index.html?api=/"}, b""
    found = static_file(path)
    if found:
        status, out, page = found
        if accepts_gzip and len(page) > 50_000:  # the app carries a few MB of saved sample data
            out.update({"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
            page = gzip.compress(page, compresslevel=6)
        return status, out, page
    return 404, TEXT, b"Not found"


class Server(ThreadingHTTPServer):
    request_queue_size = 128  # the default (5) makes a browser that asks for a dozen files at once get connection resets
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    server_version = "SmokePathLocal/1.0"

    def _serve(self, method):
        try:
            length = min(int(self.headers.get("Content-Length") or 0), 300_000)
            status, headers, body = route(method, self.path, dict(self.headers), self.rfile.read(length) if length else None)
        except Exception:  # noqa: BLE001 - show the error in the terminal, keep serving
            logging.exception("request failed")
            status, headers, body = 500, TEXT, b"Internal error (see terminal)"
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if method != "HEAD":
            self.wfile.write(body)

    def do_GET(self):
        self._serve("GET")

    def do_HEAD(self):
        self._serve("HEAD")

    def do_OPTIONS(self):
        self._serve("OPTIONS")

    def do_POST(self):
        self._serve("POST")

    def do_PATCH(self):
        self._serve("PATCH")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    load_env()  # FIRMS_MAP_KEY etc. from smoke-path/.env (shell variables win)
    server = Server((args.host, args.port), Handler)
    base = f"http://{args.host}:{args.port}"
    print(f"Live app:    {base}/            (calls the real APIs through this server)")
    print(f"Sample app:  {base}/index.html  (saved sample data, no API calls)")
    print(f"API:         {base}/smoke?lat=30.245&lon=75.844&hours=24")
    print(f"FIRMS key:   {'set' if os.environ.get('FIRMS_MAP_KEY') else 'NOT set (fires will be skipped)'}")
    print(f"OpenAQ key:  {'set' if os.environ.get('OPENAQ_API_KEY') else 'NOT set (no fallback for the live air tabs)'}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
