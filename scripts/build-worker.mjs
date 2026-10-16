import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "public");
const distRoot = resolve(root, "dist");

const [html, css, js, manifest, historyDataset, tooltipSvg] = await Promise.all([
  readFile(resolve(publicRoot, "index.html"), "utf8"),
  readFile(resolve(publicRoot, "styles.css"), "utf8"),
  readFile(resolve(publicRoot, "app.js"), "utf8"),
  readFile(resolve(root, ".openai/hosting.json"), "utf8"),
  readFile(resolve(root, "api/history/section-history.json"), "utf8"),
  readFile(resolve(publicRoot, "tooltip.svg"), "utf8"),
]);

const worker = `const ASSETS = new Map([
  ["/", { type: "text/html; charset=utf-8", body: ${JSON.stringify(html)} }],
  ["/index.html", { type: "text/html; charset=utf-8", body: ${JSON.stringify(html)} }],
  ["/styles.css", { type: "text/css; charset=utf-8", body: ${JSON.stringify(css)} }],
  ["/app.js", { type: "text/javascript; charset=utf-8", body: ${JSON.stringify(js)} }],
  ["/tooltip.svg", { type: "image/svg+xml", body: ${JSON.stringify(tooltipSvg)} }],
  ["/api/history/section-history.json", { type: "application/json; charset=utf-8", body: ${JSON.stringify(historyDataset)} }],
  ${await fontAssetEntries()}
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

    const asset = ASSETS.get(url.pathname);
    if (asset) {
      const body = asset.base64 ? Uint8Array.from(atob(asset.base64), (char) => char.charCodeAt(0)) : asset.body;
      return new Response(body, {
        headers: securityHeaders(asset.type),
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return proxyBim(request, url);
    }

    return new Response("Not found", { status: 404 });
  },
};
`;

async function fontAssetEntries() {
  const fontRoot = resolve(publicRoot, "fonts");
  const files = await collectFiles(fontRoot).catch(() => []);
  return files
    .filter((file) => file.endsWith(".woff2"))
    .map(async (file) => {
      const bytes = await readFile(file);
      const route = `/${file.slice(publicRoot.length + 1).replaceAll("\\\\", "/")}`;
      return `[${JSON.stringify(route)}, { type: "font/woff2", base64: ${JSON.stringify(bytes.toString("base64"))} }]`;
    })
    .reduce(async (pending, entry) => {
      const entries = await pending;
      entries.push(await entry);
      return entries;
    }, Promise.resolve([]))
    .then((entries) => entries.join(",\n  "));
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : path;
  }));
  return files.flat();
}

await rm(distRoot, { recursive: true, force: true });
await mkdir(resolve(distRoot, "server"), { recursive: true });
await mkdir(resolve(distRoot, ".openai"), { recursive: true });
await Promise.all([
  writeFile(resolve(distRoot, "server/index.js"), worker),
  writeFile(resolve(distRoot, ".openai/hosting.json"), manifest),
]);

console.log(`Built ${distRoot}`);
