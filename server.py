import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DEFAULT_USERS = {
    "passenger": {
        "email": "passenger@buspulse.com",
        "password": "bus123",
        "role": "passenger",
    },
    "admin": {
        "email": "admin@buspulse.com",
        "password": "admin123",
        "role": "admin",
    },
}

USERS = {
    "passenger": DEFAULT_USERS["passenger"].copy(),
    "admin": DEFAULT_USERS["admin"].copy(),
}

REGISTERED_USERS = {
    "passenger@buspulse.com": DEFAULT_USERS["passenger"].copy(),
    "admin@buspulse.com": DEFAULT_USERS["admin"].copy(),
}


class BusPulseHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.serve_file("index.html", "text/html; charset=utf-8")
            return

        requested_path = self.path.split("?", 1)[0]
        safe_path = requested_path.lstrip("/")

        if not safe_path or safe_path.startswith("api"):
            self.send_error(404)
            return

        full_path = os.path.join(BASE_DIR, safe_path)
        if os.path.isfile(full_path):
            self.serve_file(full_path, self.guess_content_type(full_path))
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == "/api/login":
            self.handle_login()
            return

        if self.path == "/api/register":
            self.handle_register()
            return

        self.send_error(404)

    def handle_login(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8") or "{}")
        except Exception:
            self.send_json(400, {"success": False, "message": "Invalid request payload."})
            return

        email = (payload.get("email") or "").strip()
        password = (payload.get("password") or "").strip()
        role = (payload.get("role") or "").strip()

        account = None
        for user in REGISTERED_USERS.values():
            if user["role"] == role and user["email"] == email and user["password"] == password:
                account = user
                break

        if not account:
            default_user = USERS.get(role)
            if not default_user or default_user["email"] != email or default_user["password"] != password:
                self.send_json(401, {"success": False, "message": "Invalid credentials for the selected role."})
                return
            account = default_user

        self.send_json(200, {
            "success": True,
            "message": "Login successful",
            "user": {"email": account["email"], "role": account["role"]},
        })

    def handle_register(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8") or "{}")
        except Exception:
            self.send_json(400, {"success": False, "message": "Invalid request payload."})
            return

        name = (payload.get("name") or "").strip()
        email = (payload.get("email") or "").strip()
        password = (payload.get("password") or "").strip()
        role = (payload.get("role") or "").strip()

        if not name or not email or not password or not role:
            self.send_json(400, {"success": False, "message": "All fields are required."})
            return

        if "@" not in email:
            self.send_json(400, {"success": False, "message": "Please enter a valid email address."})
            return

        if email in REGISTERED_USERS:
            self.send_json(409, {"success": False, "message": "An account with this email already exists."})
            return

        REGISTERED_USERS[email] = {"name": name, "email": email, "password": password, "role": role}
        USERS[role] = {"email": email, "password": password, "role": role}

        if role == "passenger":
            if "passenger@buspulse.com" not in REGISTERED_USERS:
                REGISTERED_USERS["passenger@buspulse.com"] = DEFAULT_USERS["passenger"].copy()
        if role == "admin":
            if "admin@buspulse.com" not in REGISTERED_USERS:
                REGISTERED_USERS["admin@buspulse.com"] = DEFAULT_USERS["admin"].copy()

        self.send_json(201, {
            "success": True,
            "message": "Account created successfully.",
            "user": {"name": name, "email": email, "role": role}
        })

    def serve_file(self, relative_path, content_type):
        file_path = os.path.join(BASE_DIR, relative_path) if not os.path.isabs(relative_path) else relative_path
        if not os.path.exists(file_path):
            self.send_error(404)
            return

        with open(file_path, "rb") as file:
            content = file.read()

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(content)

    def send_json(self, status_code, payload):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def guess_content_type(self, file_path):
        ext = os.path.splitext(file_path)[1].lower()
        return {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
        }.get(ext, "application/octet-stream")

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), BusPulseHandler)
    print(f"BusPulse backend running on http://localhost:{PORT}")
    server.serve_forever()
