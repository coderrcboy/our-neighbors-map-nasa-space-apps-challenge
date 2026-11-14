#!/usr/bin/env python3
"""
Our Neighbor's Map — local server (Python 3 standard library only, no installs).

    python server.py          ->  open http://localhost:8000

Serves the app and proxies the NASA live feeds that browsers block from
local files (CORS): Curiosity REMS weather, Perseverance raw images, DONKI CMEs.
"""
import http.server, json, os, re, socketserver, sys, urllib.parse, urllib.request, webbrowser, time

PORT = int(os.environ.get("PORT", sys.argv[1] if len(sys.argv) > 1 else 8000))
ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE, TTL = {}, 900  # seconds

FEEDS = {
    "/api/rems": "https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json",
    "/api/raw": "https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=12&order=sol+desc",
}

def fetch(url):
    hit = CACHE.get(url)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    req = urllib.request.Request(url, headers={"User-Agent": "OurNeighborsMap/1.0 (NASA Space Apps)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read()
    CACHE[url] = (time.time(), data)
    return data

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_GET(self):
        path, _, query = self.path.partition("?")
        try:
            if path in FEEDS:
                data = fetch(FEEDS[path])
                if path == "/api/rems":  # trim 1.7 MB file to the latest 30 sols
                    j = json.loads(data)
                    data = json.dumps({"soles": j.get("soles", [])[:30]}).encode()
                return self._send(data)
            if path == "/api/cme":
                q = urllib.parse.parse_qs(query)
                s, e = q.get("start", [""])[0], q.get("end", [""])[0]
                if not all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) for d in (s, e)):
                    return self._send(b'{"error": "dates must be YYYY-MM-DD"}', 400)
                key = os.environ.get("NASA_API_KEY", "DEMO_KEY")
                return self._send(fetch(f"https://api.nasa.gov/DONKI/CME?startDate={s}&endDate={e}&api_key={key}"))
        except Exception as ex:  # upstream down -> app falls back to offline snapshot
            return self._send(json.dumps({"error": str(ex)}).encode(), 502)
        return super().do_GET()

    def _send(self, data, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("  " + (fmt % args) + "\n")

if __name__ == "__main__":
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.daemon_threads = True
    httpd = None
    for port in range(PORT, PORT + 20):          # if the port is busy, try the next one
        try:
            httpd = socketserver.ThreadingTCPServer(("", port), Handler); break
        except OSError:
            print(f"  port {port} is busy, trying {port + 1}…")
    if httpd is None:
        sys.exit("  No free port found. Try: python server.py 9000")
    with httpd:
        url = f"http://localhost:{port}"
        print(f"\n  Our Neighbor's Map running at {url}\n  (Ctrl+C to stop)\n")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  stopped.")
