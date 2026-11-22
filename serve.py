"""Tiny scoring service so your Node backend can use the Python-trained model.

    python serve.py            # listens on http://127.0.0.1:8765

POST /score   {"features": [{...one object per candidate, keys = FEATURES...}]}
  -> {"scores": [...], "p_respond": [...], "p_hired": [...], "p_good": [...]}
GET  /health  -> {"ok": true}

Uses only the standard library (plus the packages in requirements.txt).
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pandas as pd

from matchmaker.features import FEATURES
from matchmaker.policies import ModelRanker

MODEL = ModelRanker.load(os.environ.get("MODEL_PATH", "model.pkl"))
MAX_BODY = 1_000_000


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/score":
            return self._send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length > MAX_BODY:
                return self._send(413, {"error": "body too large"})
            rows = json.loads(self.rfile.read(length))["features"]
            if not rows:
                return self._send(200, {"scores": [], "p_respond": [], "p_hired": [], "p_good": []})
            missing = [f for f in FEATURES if f not in rows[0]]
            if missing:
                return self._send(400, {"error": f"missing features: {missing}"})
            X = pd.DataFrame(rows)[FEATURES].astype(float)
            p_r, p_h, p_g = MODEL.predict_parts(X)
            self._send(200, {
                "scores": (p_r * p_h * p_g).tolist(),
                "p_respond": p_r.tolist(), "p_hired": p_h.tolist(), "p_good": p_g.tolist(),
            })
        except (ValueError, KeyError, TypeError) as e:
            self._send(400, {"error": str(e)})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", 8765))
    print(f"Scoring service on http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
