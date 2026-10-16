import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHistoryDataset } from "./history-dataset.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "public");
const pagesRoot = resolve(root, "pages-dist");
const bimBase = "https://bim.inclass.today";

async function fetchJson(path) {
  const response = await fetch(new URL(path, bimBase), {
    headers: { accept: "application/json,text/plain;q=0.9,*/*;q=0.1" },
  });
  if (!response.ok) {
    throw new Error(`BIM returned ${response.status} for ${path}`);
  }
  return response.json();
}

async function writeJson(path, data) {
  const target = resolve(pagesRoot, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(data)}\n`);
}

await rm(pagesRoot, { recursive: true, force: true });
await mkdir(pagesRoot, { recursive: true });
await cp(publicRoot, pagesRoot, { recursive: true });
await writeFile(resolve(pagesRoot, ".nojekyll"), "");

const [terms, enrollment] = await Promise.all([
  fetchJson("/history/api/terms"),
  fetchJson("/history/api/enrollment"),
]);

await Promise.all([
  writeJson("api/history/api/terms", terms),
  writeJson("api/history/api/enrollment", enrollment),
]);

const termDataEntries = [];
for (const term of terms) {
  const data = await fetchJson(`/data/${term.code}tiny.json`);
  termDataEntries.push([term.code, data]);
  await writeJson(`api/data/${term.code}tiny.json`, data);
}

await writeJson("api/history/section-history.json", createHistoryDataset(terms, termDataEntries));

console.log(`Built GitHub Pages site in ${pagesRoot}`);
