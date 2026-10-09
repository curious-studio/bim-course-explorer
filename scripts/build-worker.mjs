import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "public");
const distRoot = resolve(root, "dist");

const [html, css, js, manifest] = await Promise.all([
  readFile(resolve(publicRoot, "index.html"), "utf8"),
  readFile(resolve(publicRoot, "styles.css"), "utf8"),
  readFile(resolve(publicRoot, "app.js"), "utf8"),
  readFile(resolve(root, ".openai/hosting.json"), "utf8"),
]);

const worker = `const ASSETS = new Map([
  ["/", { type: "text/html; charset=utf-8", body: ${JSON.stringify(html)} }],
  ["/index.html", { type: "text/html; charset=utf-8", body: ${JSON.stringify(html)} }],
  ["/styles.css", { type: "text/css; charset=utf-8", body: ${JSON.stringify(css)} }],
  ["/app.js", { type: "text/javascript; charset=utf-8", body: ${JSON.stringify(js)} }],
]);

const BIM_BASE = "https://bim.inclass.today";
const ALLOWED_API_PREFIXES = [
  "/history/api/terms",
  "/history/api/enrollment",
  "/data/",
];

function securityHeaders(type) {
  return {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
}

function isAllowedApiPath(pathname) {
  return ALLOWED_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

async function proxyBim(request, url) {
  const upstreamPath = url.pathname.replace(/^\\/api/, "") || "/";
  if (!isAllowedApiPath(upstreamPath)) {
    return new Response("API path is not allowed", { status: 403 });
  }

  const upstream = new URL(upstreamPath + url.search, BIM_BASE);
  const response = await fetch(upstream, {
    headers: { accept: "application/json,text/plain;q=0.9,*/*;q=0.1" },
  });
  const body = await response.arrayBuffer();
  const headers = securityHeaders(response.headers.get("content-type") || "application/json; charset=utf-8");
  headers["cache-control"] = upstreamPath.startsWith("/data/") ? "public, max-age=300" : "public, max-age=60";
  return new Response(body, { status: response.status, headers });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return proxyBim(request, url);
    }

    const asset = ASSETS.get(url.pathname);
    if (asset) {
      return new Response(asset.body, {
        headers: securityHeaders(asset.type),
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
`;

await rm(distRoot, { recursive: true, force: true });
await mkdir(resolve(distRoot, "server"), { recursive: true });
await mkdir(resolve(distRoot, ".openai"), { recursive: true });
await Promise.all([
  writeFile(resolve(distRoot, "server/index.js"), worker),
  writeFile(resolve(distRoot, ".openai/hosting.json"), manifest),
]);

console.log(`Built ${distRoot}`);
