const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..", "public");
const port = Number(process.env.PORT || 3004);
const host = process.env.HOST || "0.0.0.0";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".wasm": "application/wasm"
};

function localIps() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(body);
}

function resolveRequestPath(reqUrl) {
  const url = new URL(reqUrl, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    return null;
  }
  return filePath;
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
    return;
  }

  const filePath = resolveRequestPath(req.url);
  if (!filePath) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = { "Content-Type": contentTypes[ext] || "application/octet-stream" };

    if (req.method === "HEAD") {
      send(res, 200, "", headers);
      return;
    }

    res.writeHead(200, {
      "Cache-Control": "no-store",
      ...headers
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, host, () => {
  console.log(`Local static server: http://localhost:${port}`);
  for (const ip of localIps()) {
    console.log(`LAN preview:         http://${ip}:${port}`);
  }
  console.log("Phone PWA install/update testing still needs the deployed HTTPS URL.");
});
