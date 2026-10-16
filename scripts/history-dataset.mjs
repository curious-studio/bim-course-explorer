import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function createHistoryDataset(terms, termDataEntries) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    terms: terms.map(({ code, description }) => ({ code, description })),
    rows: termDataEntries.flatMap(([termCode, data]) => (data.classes ?? []).map((section) => normalizeSection(termCode, section))),
  };
}

function normalizeSection(termCode, section) {
  const meeting = section.meetingsFaculty?.[0]?.meetingTime;
  const faculty = section.faculty?.map((item) => item.displayName).filter(Boolean) ?? [];
  const attributes = section.sectionAttributes?.map((item) => item.code).filter(Boolean) ?? [];
  const maximum = Number(section.maximumEnrollment) || 0;
  const available = Number(section.seatsAvailable) || 0;
  const delivery = meeting?.buildingDescription === "Internet"
    ? "internet"
    : meeting ? "campus" : "unknown";
  const days = weekdays.filter((day) => meeting?.[day]);
  const room = [meeting?.buildingDescription, meeting?.room].filter(Boolean).join(" ");

  return {
    t: termCode,
    s: section.subject ?? "",
    f: faculty,
    d: delivery,
    m: days,
    g: attributes,
    e: Math.max(0, maximum - available),
    a: available,
    q: [
      section.courseReferenceNumber,
      section.subject,
      section.courseNumber,
      section.sequenceNumber,
      section.courseTitle,
      faculty.join(" "),
      room,
    ].filter(Boolean).join(" ").toLowerCase(),
  };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const terms = JSON.parse(await readFile(resolve(root, "api/history/api/terms"), "utf8"));
  const termDataEntries = await Promise.all(terms.map(async (term) => [
    term.code,
    JSON.parse(await readFile(resolve(root, `api/data/${term.code}tiny.json`), "utf8")),
  ]));
  const target = resolve(root, "api/history/section-history.json");
  const dataset = createHistoryDataset(terms, termDataEntries);

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(dataset)}\n`);
  console.log(`Built ${target} with ${dataset.rows.length} section records`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
