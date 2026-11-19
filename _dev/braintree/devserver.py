"""Local test server for Brain Tree (not published: _dev is in .assetsignore).

Serves the pobajobs.co.uk folder on http://127.0.0.1:8791 and adds devapi.js to the Brain Tree
page, which runs the real worker-braintree.js inside the browser against an in-browser SQLite
database standing in for D1. Test password: dev-password

    python devserver.py            then open http://127.0.0.1:8791/builds/braintree/
    add ?sw=1 to the address to test with the offline service worker switched on
"""
import http.server
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parents[2]
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
INJECT = (b'<script>window.BT_NO_SW = !location.search.includes("sw=1");</script>\n'
          b'<script type="module" src="/_dev/braintree/devapi.js"></script>\n')


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
                      '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json'}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(SITE), **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        if path in ('/builds/braintree/', '/builds/braintree/index.html'):
            html = (SITE / 'builds/braintree/index.html').read_bytes()
            html = html.replace(b'<script type="module" src="app.js">', INJECT + b'<script type="module" src="app.js">')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write('%s\n' % (fmt % args))


if __name__ == '__main__':
    print(f'Brain Tree dev server: http://127.0.0.1:{PORT}/builds/braintree/', flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
