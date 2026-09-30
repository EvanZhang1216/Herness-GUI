"""Distribution smoke check: real tool discovery and local Tavily HTTP routing."""
import json
import logging
import os
from pathlib import Path
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root))
# Child process only; never use developer credentials or write to their Hermes home.
for key in list(os.environ):
    if key.startswith("HERMES_") or key.endswith(("_API_KEY", "_TOKEN", "_SECRET", "_PASSWORD")):
        del os.environ[key]
os.environ.update(HTTP_PROXY="http://127.0.0.1:9", HTTPS_PROXY="http://127.0.0.1:9", NO_PROXY="127.0.0.1,localhost")
calls = []


class TavilyStub(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        calls.append((self.path, self.headers.get("Authorization"), body))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"results": [{"title": "Bundled search", "url": "https://example.com/", "content": "search fixture"}]}).encode())

    def log_message(self, *_args):
        pass


class ImportFailures(logging.Handler):
    failures = []

    def emit(self, record):
        if "Could not import tool module" in record.getMessage():
            self.failures.append(record.getMessage())


with tempfile.TemporaryDirectory(prefix="herness-tools-") as home:
    os.environ["HERMES_HOME"] = home
    stub = ThreadingHTTPServer(("127.0.0.1", 0), TavilyStub)
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    os.environ["TAVILY_API_KEY"] = "bundled-test-only"
    os.environ["TAVILY_BASE_URL"] = f"http://127.0.0.1:{stub.server_port}"
    Path(home, "config.yaml").write_text("web:\n  search_backend: tavily\n  extract_backend: tavily\n", encoding="utf-8")
    failures = ImportFailures()
    logging.getLogger("tools.registry").addHandler(failures)
    try:
        from tools.registry import discover_builtin_tools, registry
        modules = discover_builtin_tools()
        assert not failures.failures, "\n".join(failures.failures)
        assert registry.get_entry("web_search") and registry.get_entry("web_extract")
        from tools.web_tools import web_search_tool, check_web_api_key, _ensure_web_plugins_loaded
        _ensure_web_plugins_loaded()
        import yaml
        from agent.web_search_registry import get_provider
        for manifest in (root / "plugins" / "web").glob("*/plugin.yaml"):
            declared = yaml.safe_load(manifest.read_text(encoding="utf-8"))
            for name in declared.get("provides_web_providers", []):
                assert get_provider(name) is not None, f"Bundled provider did not register: {name}"
        assert check_web_api_key(), "Tavily credentials were not recognized"
        result = json.loads(web_search_tool("verify bundled Tavily", limit=1))
        assert "Bundled search" in json.dumps(result), result
        assert calls and calls[-1][0] == "/search"
        assert calls[-1][1] == "Bearer bundled-test-only"
        assert calls[-1][2]["query"] == "verify bundled Tavily"
        print(f"PASS: {len(modules)} tool modules imported; web tools registered; Tavily key and HTTP search work")
    finally:
        stub.shutdown()
        stub.server_close()
