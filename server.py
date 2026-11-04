import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
DEEPL_URL = "https://api-free.deepl.com/v2/translate"
MAX_REQUEST_BYTES = 122880


class AppHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _is_local_request(self):
        host = urlsplit("//" + self.headers.get("Host", "")).hostname
        if host not in ("localhost", "127.0.0.1"):
            return False

        origin = self.headers.get("Origin")
        if origin is None:
            return True

        parsed_origin = urlsplit(origin)
        return (
            parsed_origin.scheme == "http"
            and parsed_origin.hostname in ("localhost", "127.0.0.1")
            and parsed_origin.port == self.server.server_port
        )

    def do_GET(self):
        if not self._is_local_request():
            self.send_error(403)
            return

        path = urlsplit(self.path).path
        files = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/index.html": ("index.html", "text/html; charset=utf-8"),
            "/auth.js": ("auth.js", "text/javascript; charset=utf-8"),
            "/favicon.svg": ("favicon.svg", "image/svg+xml"),
            "/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json; charset=utf-8"),
            "/service-worker.js": ("service-worker.js", "text/javascript; charset=utf-8"),
            "/icons/icon-192.png": ("icons/icon-192.png", "image/png"),
            "/icons/icon-512.png": ("icons/icon-512.png", "image/png"),
        }
        asset = files.get(path)
        if asset is None:
            self.send_error(404)
            return

        content = (ROOT / asset[0]).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", asset[1])
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if not self._is_local_request():
            self.send_error(403)
            return
        if urlsplit(self.path).path != "/api/deepl/translate":
            self.send_error(404)
            return

        api_key = self.headers.get("DeepL-Auth-Key", "").strip()
        if not api_key or len(api_key) < 20 or any(char.isspace() for char in api_key):
            self._send_json(401, {"message": "DeepL Authentication Key is missing or invalid."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._send_json(400, {"message": "Invalid Content-Length."})
            return
        if content_length < 1 or content_length > MAX_REQUEST_BYTES:
            self._send_json(413, {"message": "Request body is empty or too large."})
            return

        try:
            payload = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {"message": "Request body must be valid JSON."})
            return
        supported_language_pairs = {("VI", "EN"), ("EN", "VI")}
        if (
            not isinstance(payload, dict)
            or (payload.get("source_lang"), payload.get("target_lang")) not in supported_language_pairs
            or not isinstance(payload.get("text"), list)
            or len(payload["text"]) != 1
            or not isinstance(payload["text"][0], str)
        ):
            self._send_json(400, {"message": "Expected one text with source_lang/target_lang VI-EN or EN-VI."})
            return
        text = payload["text"][0]
        if not text.strip():
            self._send_json(400, {"message": "Text must not be empty."})
            return
        if len(text.encode("utf-8")) > 120000:
            self._send_json(413, {"message": "Text is too large."})
            return

        request = Request(
            DEEPL_URL,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"DeepL-Auth-Key {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=30) as response:
                body = response.read()
                self.send_response(response.status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except HTTPError as error:
            body = error.read()
            content_type = error.headers.get("Content-Type", "application/json; charset=utf-8")
            error.close()
            self.send_response(error.code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (TimeoutError, URLError, OSError):
            self._send_json(502, {"message": "Could not reach DeepL. Check the internet connection."})


if __name__ == "__main__":
    address = ("127.0.0.1", 8000)
    print(f"Serving on http://{address[0]}:{address[1]} (local machine only)")
    ThreadingHTTPServer(address, AppHandler).serve_forever()
