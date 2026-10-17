const API_BASE = window.BIM_API_BASE ?? (location.hostname.endsWith("github.io") ? "./api" : "/api");
const PREFERENCES_KEY = "bim-course-explorer.preferences.v1";
const PREFERENCES_COOKIE = "bimCourseExplorerPrefs";
const COLLEGE_OPTIONS = [
  ["arts-sciences", "Arts & Sciences"],
  ["business-information-systems", "Business & Information Systems"],
  ["beacom-computer-cyber-sciences", "Beacom, Computer & Cyber Sciences"],
  ["education-human-performance", "Education & Human Performance"],
];
const COLLEGE_SUBJECTS = {
  "arts-sciences": new Set([
    "ANTH", "ART", "ARTD", "ARTH", "ASC", "BIOL", "CHEM", "CHIN", "CIV", "CLI",
    "CMST", "DAD", "ENGL", "GEOG", "GS", "HIST", "HON", "MATH", "MCOM", "MUAP",
    "MUEN", "MUS", "PHIL", "PHYS", "POLS", "RUSS", "SOC", "SPAN", "THEA", "GAME",
  ]),
  "business-information-systems": new Set([
    "ACCT", "BADM", "CIS", "ECON", "HIM", "HIMS", "INFS",
  ]),
  "beacom-computer-cyber-sciences": new Set(["CSC", "INFA", "GAME"]),
  "education-human-performance": new Set([
    "CET", "ED", "EDER", "EDFN", "ELED", "EPSY", "EXS", "HLTH", "INED", "LIBM", "PE", "PSYC", "SEED", "SPED",
  ]),
};

const state = {
  terms: [],
  selectedTerms: new Set(),
  termDataByCode: new Map(),
  lastTermDataRequestAt: null,
  termData: null,
  history: null,
  historyRows: [],
  liveHistoryRows: new Map(),
  rows: [],
  filtered: [],
  selectedSubjects: new Set(),
  selectedFaculty: new Set(),
  selectedColleges: new Set(),
  recentTerms: [],
  recentSubjects: [],
  recentFaculty: [],
  recentColleges: [],
  pickerValues: { term: [], subject: [], faculty: [], college: [] },
  sortKey: "course",
  sortDir: "asc",
  sectionView: "cards",
  showAllCards: false,
  openOnly: false,
  preferencesLoaded: false,
  hasSharedView: false,
};

const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const requestTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
let historyResizeObserver = null;
let historyBars = [];
let activeHistoryBarIndex = null;
let historyTooltipHideTimer = null;
let searchFilterTimer = null;
let sectionRenderTimer = null;
let stickyHeaderCondensed = null;

function trackEvent(name, parameters = {}) {
  if (typeof window.gtag !== "function") return;
  window.gtag("event", name, parameters);
}
let shareButtonTimer = null;
let shareRestoreTimer = null;
let sectionsRendered = false;
const SEARCH_FILTER_DELAY = 320;
const SECTION_FADE_DELAY = 220;
const INITIAL_CARD_LIMIT = 80;

const els = {
  appHeader: document.querySelector(".app-header"),
  controls: document.querySelector(".controls"),
  termToggle: $("termToggle"),
  termSummary: $("termSummary"),
  termPanel: $("termPanel"),
  termOptions: $("termOptions"),
  selectAllTermsButton: $("selectAllTermsButton"),
  clearTermsButton: $("clearTermsButton"),
  searchInput: $("searchInput"),
  subjectToggle: $("subjectToggle"),
  subjectSummary: $("subjectSummary"),
  subjectPanel: $("subjectPanel"),
  subjectOptions: $("subjectOptions"),
  clearSubjectsButton: $("clearSubjectsButton"),
  facultyToggle: $("facultyToggle"),
  facultySummary: $("facultySummary"),
  facultyPanel: $("facultyPanel"),
  facultyOptions: $("facultyOptions"),
  facultyPickerSearch: $("facultyPickerSearch"),
  clearFacultyButton: $("clearFacultyButton"),
  collegeToggle: $("collegeToggle"),
  collegeSummary: $("collegeSummary"),
  collegePanel: $("collegePanel"),
  collegeOptions: $("collegeOptions"),
  clearCollegesButton: $("clearCollegesButton"),
  deliverySelect: $("deliverySelect"),
  meetingDaysSelect: $("meetingDaysSelect"),
  genEdSelect: $("genEdSelect"),
  openOnlyButton: $("openOnlyButton"),
  resetButton: $("resetButton"),
  shareViewButton: $("shareViewButton"),
  shareViewButtonBottom: $("shareViewButtonBottom"),
  status: $("status"),
  sectionsMetric: $("sectionsMetric"),
  filledMetric: $("filledMetric"),
  occupancyMetric: $("occupancyMetric"),
  underenrolledMetric: $("underenrolledMetric"),
  historyChart: $("historyChart"),
  historyChartTooltip: $("historyChartTooltip"),
  historyChartTooltipContent: $("historyChartTooltipContent"),
  deliverySummary: $("deliverySummary"),
  deliveryBars: $("deliveryBars"),
  subjectBars: $("subjectBars"),
  facultyList: $("facultyList"),
  roomList: $("roomList"),
  sectionsPanel: $("sectionsPanel"),
  sectionsPanelTitle: $("sectionsPanelTitle"),
  sectionsPanelToggle: $("sectionsPanelToggle"),
  sectionsPanelContent: $("sectionsPanelContent"),
  sectionsBody: $("sectionsBody"),
  sectionsCards: $("sectionsCards"),
  showAllCardsButton: $("showAllCardsButton"),
  tableCount: $("tableCount"),
  tableViewButton: $("tableViewButton"),
  cardViewButton: $("cardViewButton"),
  exportButton: $("exportButton"),
};

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`BIM returned ${response.status} for ${path}`);
  }
  return response.json();
}

async function fetchStaticJson(path) {
  const response = await fetch(new URL(path, window.location.href));
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}

function setStatus(message, visible = true) {
  els.status.textContent = message;
  els.status.classList.toggle("is-visible", visible);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function decodeHtml(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value ?? "";
  return textarea.value.trim();
}

function getMeeting(section) {
  const meeting = section.meetingsFaculty?.[0]?.meetingTime;
  if (!meeting) {
    return {
      delivery: "unknown",
      label: "Unknown",
      room: "Unknown",
      time: "",
      startTime: null,
      meeting: "Meeting TBD",
      days: [],
      dayKeys: [],
    };
  }

  const isInternet = meeting.buildingDescription === "Internet";
  const dayMap = [
    ["sunday", "Su"],
    ["monday", "M"],
    ["tuesday", "Tu"],
    ["wednesday", "W"],
    ["thursday", "Th"],
    ["friday", "F"],
    ["saturday", "Sa"],
  ];
  const activeDays = dayMap.filter(([key]) => meeting[key]);
  const days = activeDays.map(([, label]) => label);
  const dayKeys = activeDays.map(([key]) => key);
  const time = meeting.beginTime && meeting.endTime ? `${formatTime(meeting.beginTime)}-${formatTime(meeting.endTime)}` : "";
  const startTime = meeting.beginTime ? parseMeetingStartTime(meeting.beginTime) : null;

  if (isInternet) {
    return {
      delivery: "internet",
      label: "Internet",
      room: "Internet",
      time,
      startTime,
      meeting: [time, "Internet"].filter(Boolean).join(" "),
      days,
      dayKeys,
    };
  }

  const room = [meeting.buildingDescription || "Location TBD", meeting.room && meeting.room !== "INTERNET" ? meeting.room : ""]
    .filter(Boolean)
    .join(" ");

  return {
    delivery: "campus",
    label: "Campus",
    room,
    time,
    startTime,
    meeting: [days.join(""), time, room].filter(Boolean).join(" "),
    days,
    dayKeys,
  };
}

function formatTime(value) {
  const text = String(value).padStart(4, "0");
  let hour = Number(text.slice(0, 2));
  const minute = text.slice(2);
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

function parseMeetingStartTime(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const normalized = digits.padStart(4, "0").slice(-4);
  const hour = Number(normalized.slice(0, 2));
  const minute = Number(normalized.slice(2));
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

function getCreditHours(section) {
  if (section.creditHourIndicator && !section.creditHours) {
    return `${section.creditHourLow} ${section.creditHourIndicator} ${section.creditHourHigh}`;
  }
  return String(section.creditHours ?? section.creditHourLow ?? "");
}

function normalizeSection(section, termCode = "") {
  const meeting = getMeeting(section);
  const faculty = section.faculty?.map((item) => decodeHtml(item.displayName)).filter(Boolean) ?? [];
  const attrs = section.sectionAttributes?.map((item) => ({
    code: item.code,
    description: decodeHtml(item.description),
  })) ?? [];
  const max = Number(section.maximumEnrollment) || 0;
  const available = Number(section.seatsAvailable) || 0;
  const filled = Math.max(0, max - available);
  const course = `${section.subject}${section.courseNumber}-${section.sequenceNumber}`;
  const term = state.terms.find((item) => item.code === termCode);
  const termLabel = term?.description ?? termCode;

  return {
    raw: section,
    termCode,
    termLabel,
    crn: section.courseReferenceNumber,
    subject: decodeHtml(section.subject),
    courseNumber: decodeHtml(section.courseNumber),
    sequence: decodeHtml(section.sequenceNumber),
    course,
    title: decodeHtml(section.courseTitle),
    credits: getCreditHours(section),
    max,
    available,
    filled,
    wait: Number(section.waitCount) || 0,
    faculty,
    attributes: attrs,
    ...meeting,
    search: [
      section.courseReferenceNumber,
      section.subject,
      section.courseNumber,
      section.sequenceNumber,
      section.courseTitle,
      faculty.join(" "),
      attrs.map((attr) => `${attr.code} ${attr.description}`).join(" "),
      termLabel,
      termCode,
      meeting.room,
      meeting.meeting,
    ].join(" ").toLowerCase(),
  };
}

function normalizeHistoryRecord(record) {
  return {
    termCode: record.t,
    subject: record.s,
    faculty: (record.f ?? []).map(decodeHtml),
    delivery: record.d ?? "unknown",
    dayKeys: record.m ?? [],
    attributes: (record.g ?? []).map((code) => ({ code, description: code })),
    filled: Number(record.e) || 0,
    available: Number(record.a) || 0,
    search: decodeHtml(record.q ?? ""),
  };
}

async function initialize() {
  bindEvents();
  bindStickyHeader();
  loadPreferences();
  loadSharedView();

  try {
    const [terms, history, historyDataset] = await Promise.all([
      fetchJson("/history/api/terms"),
      fetchJson("/history/api/enrollment").catch(() => null),
      fetchStaticJson("./api/history/section-history.json").catch(() => null),
    ]);

    state.terms = terms;
    state.history = history;
    state.historyRows = (historyDataset?.rows ?? []).map(normalizeHistoryRecord);
    state.selectedTerms = new Set([...state.selectedTerms].filter((code) => terms.some((term) => term.code === code)));
    state.recentTerms = state.recentTerms.filter((code) => terms.some((term) => term.code === code));
    if (!state.selectedTerms.size && !state.hasSharedView) state.selectedTerms.add(getDefaultTerm(terms, history));
    renderPickerOptions("term", terms.map((term) => term.code));
    renderPickerOptions("college", COLLEGE_OPTIONS.map(([value]) => value));
    applyStoredControls();
    await loadSelectedTerms();
    void loadLiveHistoryRows();
  } catch (error) {
    setStatus(`Could not load BIM data. ${error.message}. If this page is opened from another domain, the BIM server may need to allow browser cross-origin requests.`);
  }
}

function bindStickyHeader() {
  const condenseThreshold = 120;
  const expandThreshold = 8;

  const updateStickyHeaderHeight = () => {
    if (window.matchMedia("(min-width: 721px)").matches) {
      document.documentElement.style.setProperty("--sticky-header-height", `${els.appHeader.offsetHeight}px`);
    } else {
      document.documentElement.style.removeProperty("--sticky-header-height");
    }
  };

  const headerResizeObserver = new ResizeObserver(updateStickyHeaderHeight);
  headerResizeObserver.observe(els.appHeader);

  const sync = (force = false) => {
    const isDesktop = window.matchMedia("(min-width: 721px)").matches;
    const shouldCondense = isDesktop && (stickyHeaderCondensed
      ? window.scrollY > expandThreshold
      : window.scrollY > condenseThreshold);
    if (!force && stickyHeaderCondensed === shouldCondense) return;
    stickyHeaderCondensed = shouldCondense;
    document.body.classList.toggle("header-condensed", shouldCondense);

    window.requestAnimationFrame(() => {
      updateStickyHeaderHeight();
    });
  };

  let frame = null;
  window.addEventListener("scroll", () => {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      sync();
    });
  }, { passive: true });
  window.addEventListener("resize", () => sync(true));
  sync(true);
}

function getDefaultTerm(terms, history) {
  const currentTerm = getCalendarTermDescription();
  const current = terms.find((term) => term.description === currentTerm);
  if (current) return current.code;

  const activeCodes = new Set();
  history?.name?.forEach((code, index) => {
    if (Number(history.students?.[index]) > 0) activeCodes.add(code);
  });
  return terms.find((term) => activeCodes.has(term.code))?.code ?? terms[0]?.code ?? "";
}

function getCalendarTermDescription(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth();
  if (month >= 7) return `${year} Fall`;
  if (month >= 5) return `${year} Summer`;
  return `${year} Spring`;
}

function termDescriptionRank(description) {
  const match = String(description).match(/^(\d{4})\s+(Fall|Spring|Summer)$/i);
  if (!match) return -1;
  const seasonRank = { Spring: 1, Summer: 2, Fall: 3 }[match[2][0].toUpperCase() + match[2].slice(1).toLowerCase()] ?? 0;
  return Number(match[1]) * 10 + seasonRank;
}

async function loadLiveHistoryRows() {
  const currentRank = termDescriptionRank(getCalendarTermDescription());
  const liveTerms = state.terms.filter((term) => termDescriptionRank(term.description) >= currentRank);
  if (!liveTerms.length) return;

  try {
    const entries = await Promise.all(liveTerms.map(async (term) => [term.code, await getTermData(term.code)]));
    state.liveHistoryRows = new Map(entries.map(([termCode, data]) => [
      termCode,
      (data.classes ?? []).map((section) => normalizeSection(section, termCode)),
    ]));
    renderHistoryChart();
    setTermDataRequestStatus();
  } catch {
    // The static snapshot remains available when BIM's live data cannot be reached.
  }
}

async function getTermData(term) {
  if (!state.termDataByCode.has(term)) {
    state.lastTermDataRequestAt = new Date();
    state.termDataByCode.set(term, fetchJson(`/data/${term}tiny.json`));
  }
  return state.termDataByCode.get(term);
}

async function loadSelectedTerms() {
  const termCodes = [...state.selectedTerms].filter((code) => state.terms.some((term) => term.code === code));
  if (!termCodes.length) {
    state.termData = null;
    state.rows = [];
    hydrateFilters();
    applyFilters();
    setStatus("No terms selected.", true);
    return;
  }

  setStatus(`Loading ${number.format(termCodes.length)} term${termCodes.length === 1 ? "" : "s"}...`);
  const termEntries = await Promise.all(termCodes.map(async (term) => [term, await getTermData(term)]));
  state.termData = termEntries[0]?.[1] ?? null;
  state.rows = termEntries.flatMap(([term, data]) => (data.classes ?? []).map((section) => normalizeSection(section, term)));
  hydrateFilters();
  applyFilters();
  setTermDataRequestStatus();
}

function setTermDataRequestStatus() {
  const requestedAt = state.lastTermDataRequestAt;
  setStatus(requestedAt ? `Data refreshed ${requestTime.format(requestedAt)}.` : "Data refreshed during this dashboard session.", true);
}

function hydrateFilters() {
  const selectedGenEd = els.genEdSelect.value;
  const subjects = [...new Set(state.rows.map((row) => row.subject))].sort();
  const facultyNames = [...new Set(state.rows.flatMap((row) => row.faculty.length ? row.faculty : ["None assigned"]))].sort();
  const attrs = new Map();
  state.rows.forEach((row) => {
    row.attributes.forEach((attr) => attrs.set(attr.code, attr.description || attr.code));
  });

  state.selectedSubjects = new Set([...state.selectedSubjects].filter((subject) => subjects.includes(subject)));
  state.selectedFaculty = new Set([...state.selectedFaculty].filter((faculty) => facultyNames.includes(faculty)));
  state.recentSubjects = state.recentSubjects.filter((subject) => subjects.includes(subject));
  state.recentFaculty = state.recentFaculty.filter((faculty) => facultyNames.includes(faculty));
  renderPickerOptions("subject", subjects);
  renderPickerOptions("faculty", facultyNames);

  els.genEdSelect.innerHTML = `<option value="">All Gen Ed attributes</option>${[...attrs.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, description]) => `<option value="${escapeHtml(code)}">${escapeHtml(code)} - ${escapeHtml(description)}</option>`)
    .join("")}`;
  els.genEdSelect.value = attrs.has(selectedGenEd) ? selectedGenEd : "";
}

function loadPreferences() {
  try {
    const saved = JSON.parse(readPreferenceStore() || "{}");
    if (!saved || typeof saved !== "object") return;
    const savedTerms = Array.isArray(saved.terms)
      ? saved.terms.filter((term) => typeof term === "string")
      : typeof saved.term === "string" && saved.term ? [saved.term] : [];
    state.selectedTerms = new Set(savedTerms);
    state.selectedSubjects = new Set(Array.isArray(saved.subjects) ? saved.subjects.filter((subject) => typeof subject === "string") : []);
    state.selectedFaculty = new Set(Array.isArray(saved.faculty) ? saved.faculty.filter((faculty) => typeof faculty === "string").map(decodeHtml) : []);
    state.selectedColleges = new Set(Array.isArray(saved.colleges)
      ? saved.colleges.filter((college) => typeof college === "string")
      : typeof saved.college === "string" && saved.college ? [saved.college] : []);
    state.recentTerms = Array.isArray(saved.recentTerms) ? saved.recentTerms.filter((term) => typeof term === "string") : [];
    state.recentSubjects = Array.isArray(saved.recentSubjects) ? saved.recentSubjects.filter((subject) => typeof subject === "string") : [];
    state.recentFaculty = Array.isArray(saved.recentFaculty) ? saved.recentFaculty.filter((faculty) => typeof faculty === "string").map(decodeHtml) : [];
    state.recentColleges = Array.isArray(saved.recentColleges) ? saved.recentColleges.filter((college) => typeof college === "string") : [];
    state.sectionView = saved.sectionView === "table" ? "table" : "cards";
    state.openOnly = Boolean(saved.openOnly);
    els.searchInput.value = typeof saved.search === "string" ? saved.search : "";
    els.deliverySelect.value = typeof saved.delivery === "string" ? saved.delivery : "";
    els.meetingDaysSelect.value = typeof saved.meetingDays === "string" ? saved.meetingDays : "";
    els.genEdSelect.value = typeof saved.genEd === "string" ? saved.genEd : "";
    state.sortKey = typeof saved.sortKey === "string" ? saved.sortKey : state.sortKey;
    state.sortDir = saved.sortDir === "desc" ? "desc" : "asc";
    state.preferencesLoaded = true;
  } catch {
    state.preferencesLoaded = false;
  }
}

function loadSharedView() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("share") !== "1") return;

  state.hasSharedView = true;
  state.selectedTerms = new Set(params.getAll("term"));
  state.selectedSubjects = new Set(params.getAll("subject"));
  state.selectedFaculty = new Set(params.getAll("faculty").map(decodeHtml));
  state.selectedColleges = new Set(params.getAll("college"));
  state.recentTerms = [];
  state.recentSubjects = [];
  state.recentFaculty = [];
  state.recentColleges = [];
  els.searchInput.value = params.get("search") ?? "";
  els.deliverySelect.value = params.get("delivery") ?? "";
  els.meetingDaysSelect.value = params.get("meetingDays") ?? "";
  els.genEdSelect.value = params.get("genEd") ?? "";
  state.openOnly = params.get("openOnly") === "1";
  state.sectionView = params.get("view") === "table" ? "table" : "cards";
  const sectionsState = params.get("sections");
  if (sectionsState === "open" || sectionsState === "closed") {
    setSectionsPanelOpen(sectionsState === "open");
  }
  state.sortKey = ["course", "faculty", "filled", "delivery", "startTime", "term"].includes(params.get("sort"))
    ? params.get("sort")
    : "course";
  state.sortDir = params.get("sortDir") === "desc" ? "desc" : "asc";
}

function buildSharedViewUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("share", "1");
  [...state.selectedTerms].sort().forEach((term) => url.searchParams.append("term", term));
  [...state.selectedSubjects].sort().forEach((subject) => url.searchParams.append("subject", subject));
  [...state.selectedFaculty].sort().forEach((faculty) => url.searchParams.append("faculty", faculty));
  if (els.searchInput.value) url.searchParams.set("search", els.searchInput.value);
  [...state.selectedColleges].sort().forEach((college) => url.searchParams.append("college", college));
  if (els.deliverySelect.value) url.searchParams.set("delivery", els.deliverySelect.value);
  if (els.meetingDaysSelect.value) url.searchParams.set("meetingDays", els.meetingDaysSelect.value);
  if (els.genEdSelect.value) url.searchParams.set("genEd", els.genEdSelect.value);
  if (state.openOnly) url.searchParams.set("openOnly", "1");
  url.searchParams.set("view", state.sectionView);
  url.searchParams.set("sections", els.sectionsPanelToggle.getAttribute("aria-expanded") === "true" ? "open" : "closed");
  url.searchParams.set("sort", state.sortKey);
  url.searchParams.set("sortDir", state.sortDir);
  return url.toString();
}

async function shareCurrentView(placement) {
  const copied = await copyText(buildSharedViewUrl());
  trackEvent("dashboard_shared", {
    placement,
    copy_succeeded: copied,
    visible_sections: state.filtered.length,
  });
  window.clearTimeout(shareButtonTimer);
  window.clearTimeout(shareRestoreTimer);
  setShareButtonText(copied ? "Copied" : "Copy failed", copied);
  shareButtonTimer = window.setTimeout(() => {
    setShareButtonText("Share Current View", false, true);
    shareRestoreTimer = window.setTimeout(() => {
      setShareButtonText("Share Current View", false);
    }, 700);
  }, 3600);
}

function setShareButtonText(text, isCopied, isRestoring = false) {
  const headerLabel = els.shareViewButton.querySelector(".share-button-label");
  if (headerLabel) headerLabel.textContent = text;
  els.shareViewButtonBottom.textContent = text;
  [els.shareViewButton, els.shareViewButtonBottom].forEach((button) => {
    button.classList.toggle("is-copied", isCopied);
    button.classList.toggle("is-restoring", isRestoring);
  });
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.append(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    return copied;
  }
}

function applyStoredControls() {
  syncOpenOnlyButton();
  els.tableViewButton.setAttribute("aria-pressed", String(state.sectionView === "table"));
  els.cardViewButton.setAttribute("aria-pressed", String(state.sectionView === "cards"));
  syncCardSortControl();
}

function syncOpenOnlyButton() {
  els.openOnlyButton.setAttribute("aria-pressed", String(state.openOnly));
  if (state.openOnly) {
    els.openOnlyButton.setAttribute("title", "Remove filter");
    els.openOnlyButton.setAttribute("aria-label", "Open seats only. Remove filter");
  } else {
    els.openOnlyButton.removeAttribute("title");
    els.openOnlyButton.removeAttribute("aria-label");
  }
}

function savePreferences() {
  const payload = {
    term: [...state.selectedTerms][0] ?? "",
    terms: [...state.selectedTerms],
    search: els.searchInput.value,
    subjects: [...state.selectedSubjects],
    faculty: [...state.selectedFaculty],
    recentTerms: state.recentTerms,
    recentSubjects: state.recentSubjects,
    recentFaculty: state.recentFaculty,
    colleges: [...state.selectedColleges],
    recentColleges: state.recentColleges,
    delivery: els.deliverySelect.value,
    meetingDays: els.meetingDaysSelect.value,
    genEd: els.genEdSelect.value,
    openOnly: state.openOnly,
    sectionView: state.sectionView,
    sortKey: state.sortKey,
    sortDir: state.sortDir,
  };
  try {
    writePreferenceStore(JSON.stringify(payload));
  } catch {
    // Persistence is helpful, but the dashboard should continue without it.
  }
}

function clearPreferences() {
  try {
    removePreferenceStore();
  } catch {
    // Ignore storage failures during reset.
  }
}

function readPreferenceStore() {
  try {
    if (typeof localStorage !== "undefined") {
      const value = localStorage.getItem(PREFERENCES_KEY);
      if (value) return value;
    }
  } catch {
    // Fall back to cookies when storage is blocked.
  }

  const cookie = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${PREFERENCES_COOKIE}=`));
  return cookie ? decodeURIComponent(cookie.slice(PREFERENCES_COOKIE.length + 1)) : "";
}

function writePreferenceStore(value) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PREFERENCES_KEY, value);
    }
  } catch {
    // Cookies below are the fallback persistence layer.
  }
  document.cookie = `${PREFERENCES_COOKIE}=${encodeURIComponent(value)}; max-age=31536000; path=/; SameSite=Lax`;
}

function removePreferenceStore() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(PREFERENCES_KEY);
    }
  } catch {
    // Cookies below are the fallback persistence layer.
  }
  document.cookie = `${PREFERENCES_COOKIE}=; max-age=0; path=/; SameSite=Lax`;
}

function bindEvents() {
  bindHistoryChartInteractions();
  els.searchInput.addEventListener("input", () => {
    window.clearTimeout(searchFilterTimer);
    searchFilterTimer = window.setTimeout(() => {
      applyFilters({ transitionSections: true });
      trackEvent("dashboard_search_applied", {
        has_search: Boolean(els.searchInput.value.trim()),
        visible_sections: state.filtered.length,
      });
    }, SEARCH_FILTER_DELAY);
  });
  [["delivery", els.deliverySelect], ["meeting_days", els.meetingDaysSelect], ["general_education", els.genEdSelect]].forEach(([filterType, el]) => {
    el.addEventListener("input", () => {
      applyFilters({ transitionSections: true });
      trackEvent("dashboard_filter_applied", {
        filter_type: filterType,
        is_active: Boolean(el.value),
        visible_sections: state.filtered.length,
      });
    });
  });
  els.termToggle.addEventListener("click", () => {
    const isOpen = els.termPanel.hidden;
    setTermPanelOpen(isOpen);
    if (isOpen) trackEvent("dashboard_picker_opened", { picker_type: "term" });
  });
  els.subjectToggle.addEventListener("click", () => {
    const isOpen = els.subjectPanel.hidden;
    setSubjectPanelOpen(isOpen);
    if (isOpen) trackEvent("dashboard_picker_opened", { picker_type: "subject" });
  });
  els.facultyToggle.addEventListener("click", () => {
    const isOpen = els.facultyPanel.hidden;
    setFacultyPanelOpen(isOpen);
    if (isOpen) trackEvent("dashboard_picker_opened", { picker_type: "faculty" });
  });
  els.collegeToggle.addEventListener("click", () => {
    const isOpen = els.collegePanel.hidden;
    setCollegePanelOpen(isOpen);
    if (isOpen) trackEvent("dashboard_picker_opened", { picker_type: "college" });
  });
  els.facultyPickerSearch.addEventListener("input", () => {
    renderPickerOptions("faculty", state.pickerValues.faculty);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const activeToggle = [els.termToggle, els.subjectToggle, els.facultyToggle, els.collegeToggle]
      .find((toggle) => toggle.getAttribute("aria-expanded") === "true");
    if (!activeToggle) return;
    event.preventDefault();
    setTermPanelOpen(false);
    setSubjectPanelOpen(false);
    setFacultyPanelOpen(false);
    setCollegePanelOpen(false);
    activeToggle.focus({ preventScroll: true });
  });
  document.addEventListener("click", (event) => {
    if (!eventPathIncludes(event, "term-filter")) {
      setTermPanelOpen(false);
    }
    if (!eventPathIncludes(event, "subject-filter")) {
      setSubjectPanelOpen(false);
    }
    if (!eventPathIncludes(event, "faculty-filter")) {
      setFacultyPanelOpen(false);
    }
    if (!eventPathIncludes(event, "college-filter")) {
      setCollegePanelOpen(false);
    }
  });
  els.clearTermsButton.addEventListener("click", () => {
    state.selectedTerms.clear();
    state.recentTerms = [];
    updatePickerFilter("term");
    trackEvent("dashboard_filter_cleared", { filter_type: "term" });
  });
  els.selectAllTermsButton.addEventListener("click", () => {
    state.selectedTerms = new Set(state.terms.map((term) => term.code));
    updatePickerFilter("term");
    trackEvent("dashboard_picker_selection_changed", {
      picker_type: "term",
      selection_action: "selected_all",
      selection_count: state.selectedTerms.size,
    });
  });
  els.clearSubjectsButton.addEventListener("click", () => {
    state.selectedSubjects.clear();
    state.recentSubjects = [];
    updatePickerFilter("subject");
    trackEvent("dashboard_filter_cleared", { filter_type: "subject" });
  });
  els.clearFacultyButton.addEventListener("click", () => {
    state.selectedFaculty.clear();
    state.recentFaculty = [];
    updatePickerFilter("faculty");
    trackEvent("dashboard_filter_cleared", { filter_type: "faculty" });
  });
  els.clearCollegesButton.addEventListener("click", () => {
    state.selectedColleges.clear();
    state.recentColleges = [];
    updatePickerFilter("college");
    trackEvent("dashboard_filter_cleared", { filter_type: "college" });
  });
  els.termOptions.addEventListener("click", (event) => {
    event.stopPropagation();
    handlePickerClick(event, "term");
  });
  els.subjectOptions.addEventListener("click", (event) => {
    event.stopPropagation();
    handlePickerClick(event, "subject");
  });
  els.facultyOptions.addEventListener("click", (event) => {
    event.stopPropagation();
    handlePickerClick(event, "faculty");
  });
  els.collegeOptions.addEventListener("click", (event) => {
    event.stopPropagation();
    handlePickerClick(event, "college");
  });
  els.openOnlyButton.addEventListener("click", () => {
    state.openOnly = !state.openOnly;
    syncOpenOnlyButton();
    applyFilters();
    trackEvent("dashboard_filter_applied", {
      filter_type: "open_seats",
      is_active: state.openOnly,
      visible_sections: state.filtered.length,
    });
  });
  els.resetButton.addEventListener("click", () => {
    els.searchInput.value = "";
    state.selectedTerms = new Set([getDefaultTerm(state.terms, state.history)].filter(Boolean));
    state.selectedSubjects.clear();
    state.selectedFaculty.clear();
    state.selectedColleges.clear();
    state.recentTerms = [];
    state.recentSubjects = [];
    state.recentFaculty = [];
    state.recentColleges = [];
    els.facultyPickerSearch.value = "";
    setTermPanelOpen(false);
    setSubjectPanelOpen(false);
    setFacultyPanelOpen(false);
    setCollegePanelOpen(false);
    els.deliverySelect.value = "";
    els.meetingDaysSelect.value = "";
    els.genEdSelect.value = "";
    state.openOnly = false;
    state.sectionView = "cards";
    state.sortKey = "course";
    state.sortDir = "asc";
    applyStoredControls();
    clearPreferences();
    renderPickerOptions("term", state.terms.map((term) => term.code));
    renderPickerOptions("college", COLLEGE_OPTIONS.map(([value]) => value));
    loadSelectedTerms();
    trackEvent("dashboard_reset");
  });
  els.shareViewButton.addEventListener("click", () => shareCurrentView("header"));
  els.shareViewButtonBottom.addEventListener("click", () => shareCurrentView("sections"));
  els.sectionsPanelTitle.querySelector(".section-heading").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSectionsPanelOpen(els.sectionsPanelToggle.getAttribute("aria-expanded") !== "true");
  }, true);
  els.exportButton.addEventListener("click", () => {
    exportCsv();
    trackEvent("dashboard_exported", { format: "csv", visible_sections: state.filtered.length });
  });
  els.showAllCardsButton.addEventListener("click", () => {
    state.showAllCards = true;
    renderSections({ transition: false });
    const firstNewLink = els.sectionsCards.querySelectorAll(".course-link")[INITIAL_CARD_LIMIT];
    firstNewLink?.focus({ preventScroll: true });
  });
  els.tableViewButton.addEventListener("click", () => setSectionView("table"));
  els.cardViewButton.addEventListener("click", () => setSectionView("cards"));
  document.querySelectorAll("[data-card-sort]").forEach((control) => {
    control.addEventListener("click", (event) => {
      event.preventDefault();
      const nextKey = control.dataset.cardSort;
      state.sortDir = state.sortKey === nextKey && state.sortDir === "asc" ? "desc" : "asc";
      state.sortKey = nextKey;
      syncCardSortButtons();
      savePreferences();
      renderSections();
      trackEvent("dashboard_sort_changed", { sort_key: nextKey, sort_direction: state.sortDir, view: "cards" });
    });
  });
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const nextKey = th.dataset.sort;
      state.sortDir = state.sortKey === nextKey && state.sortDir === "asc" ? "desc" : "asc";
      state.sortKey = nextKey;
      syncCardSortControl();
      savePreferences();
      renderSections();
      trackEvent("dashboard_sort_changed", { sort_key: nextKey, sort_direction: state.sortDir, view: "table" });
    });
  });
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.(".source-link, .course-link");
    if (!link) return;
    trackEvent(link.classList.contains("source-link") ? "dashboard_source_data_opened" : "dashboard_section_detail_opened", {
      view: state.sectionView,
    });
  });
}

function setSectionsPanelOpen(isOpen) {
  els.sectionsPanelToggle.setAttribute("aria-expanded", String(isOpen));
  els.sectionsPanelToggle.setAttribute("aria-label", `${isOpen ? "Collapse" : "Expand"} sections panel`);
  els.sectionsPanel.classList.toggle("is-collapsed", !isOpen);
  els.sectionsPanelContent.setAttribute("aria-hidden", String(!isOpen));
  els.sectionsPanelContent.inert = !isOpen;
}

function eventPathIncludes(event, className) {
  return event.composedPath().some((item) => item instanceof Element && item.classList.contains(className));
}

function setTermPanelOpen(isOpen) {
  setPickerPanelOpen(els.termToggle, els.termPanel, isOpen);
}

function setSubjectPanelOpen(isOpen) {
  setPickerPanelOpen(els.subjectToggle, els.subjectPanel, isOpen);
}

function setFacultyPanelOpen(isOpen) {
  setPickerPanelOpen(els.facultyToggle, els.facultyPanel, isOpen);
  if (isOpen) requestAnimationFrame(() => els.facultyPickerSearch.focus({ preventScroll: true }));
}

function setCollegePanelOpen(isOpen) {
  setPickerPanelOpen(els.collegeToggle, els.collegePanel, isOpen);
}

function setPickerPanelOpen(toggle, panel, isOpen) {
  toggle.setAttribute("aria-expanded", String(isOpen));
  window.clearTimeout(Number(panel.dataset.closeTimer) || 0);

  if (isOpen) {
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add("is-open"));
    return;
  }

  panel.classList.remove("is-open");
  panel.dataset.closeTimer = String(window.setTimeout(() => {
    if (!panel.classList.contains("is-open")) panel.hidden = true;
  }, 160));
}

function pickerConfig(kind) {
  if (kind === "term") {
    return {
      selected: state.selectedTerms,
      recent: state.recentTerms,
      options: els.termOptions,
      summary: els.termSummary,
      clearButton: els.clearTermsButton,
      empty: "No terms available.",
      all: "No terms selected",
      dataAttr: "term",
      label: termLabel,
    };
  }

  if (kind === "faculty") {
    return {
      selected: state.selectedFaculty,
      recent: state.recentFaculty,
      options: els.facultyOptions,
      summary: els.facultySummary,
      clearButton: els.clearFacultyButton,
      empty: "No faculty available.",
      all: "All faculty",
      dataAttr: "faculty",
      label: (value) => value,
    };
  }

  if (kind === "college") {
    return {
      selected: state.selectedColleges,
      recent: state.recentColleges,
      options: els.collegeOptions,
      summary: els.collegeSummary,
      clearButton: els.clearCollegesButton,
      empty: "No colleges available.",
      all: "All colleges",
      dataAttr: "college",
      label: collegeLabel,
    };
  }

  return {
    selected: state.selectedSubjects,
    recent: state.recentSubjects,
    options: els.subjectOptions,
    summary: els.subjectSummary,
    clearButton: els.clearSubjectsButton,
    empty: "No subjects available.",
    all: "All subjects",
    dataAttr: "subject",
    label: (value) => value,
  };
}

function renderPickerOptions(kind, values) {
  const config = pickerConfig(kind);
  state.pickerValues[kind] = values;
  const displayValues = filterPickerValues(kind, values, config);
  const selected = [...config.selected].filter((value) => displayValues.includes(value));
  const recent = [...new Set([...selected, ...config.recent.filter((value) => displayValues.includes(value))])].slice(0, 8);
  const renderButton = (value) => {
    const selected = config.selected.has(value);
    const index = values.indexOf(value);
    return `<button class="picker-pill" type="button" data-${config.dataAttr}-index="${index}" aria-pressed="${selected}">${escapeHtml(config.label(value))}</button>`;
  };
  const fullList = kind === "term" ? renderTermYearRows(displayValues, renderButton) : `<div class="picker-pill-list">${displayValues.map(renderButton).join("")}</div>`;
  config.options.innerHTML = values.length
    ? `${recent.length ? `<div class="picker-section"><div class="picker-section-title"><span>Recently selected</span><button class="picker-recent-clear" type="button" data-clear-recent="${kind}">Clear</button></div><div class="picker-pill-list">${recent.map(renderButton).join("")}</div></div>` : ""}
      ${displayValues.length ? `<div class="picker-section"><span>${recent.length ? "All" : ""}</span>${fullList}</div>` : emptyMessage("No faculty names match this search.")}`
    : emptyMessage(config.empty);
  updatePickerSummary(kind);
}

function filterPickerValues(kind, values, config) {
  if (kind !== "faculty") return values;
  const query = els.facultyPickerSearch.value.trim().toLowerCase();
  if (!query) return values;
  return values.filter((value) => config.label(value).toLowerCase().includes(query));
}

function renderTermYearRows(values, renderButton) {
  const termsByAcademicYear = new Map();
  values.forEach((value) => {
    const term = getTermParts(value);
    if (!term) return;
    const group = termsByAcademicYear.get(term.academicYear) ?? {};
    group[term.season] = value;
    termsByAcademicYear.set(term.academicYear, group);
  });

  return `<div class="term-year-list">${[...termsByAcademicYear.entries()]
    .sort(([yearA], [yearB]) => yearB - yearA)
    .map(([, group]) => `<div class="term-year-row">
      ${["Fall", "Spring", "Summer"].map((season) => group[season] ? renderButton(group[season]) : `<span></span>`).join("")}
    </div>`)
    .join("")}</div>`;
}

function updatePickerFilter(kind) {
  if (kind === "term") {
    renderPickerOptions("term", state.terms.map((term) => term.code));
    loadSelectedTerms().catch((error) => {
      setStatus(`Could not load selected terms. ${error.message}.`, true);
    });
    return;
  }

  if (kind === "college") {
    renderPickerOptions("college", COLLEGE_OPTIONS.map(([value]) => value));
    applyFilters();
    return;
  }

  const values = kind === "faculty"
    ? [...new Set(state.rows.flatMap((row) => row.faculty.length ? row.faculty : ["None assigned"]))].sort()
    : [...new Set(state.rows.map((row) => row.subject))].sort();
  renderPickerOptions(kind, values);
  applyFilters();
}

function handlePickerClick(event, kind) {
  const config = pickerConfig(kind);
  const clearRecentButton = event.target.closest("button[data-clear-recent]");
  if (clearRecentButton) {
    clearRecentPickerValues(kind);
    return;
  }
  const button = event.target.closest(`button[data-${config.dataAttr}-index]`);
  if (!button) return;
  const value = state.pickerValues[kind][Number(button.dataset[`${config.dataAttr}Index`])];
  if (!value) return;
  const wasSelected = config.selected.has(value);
  if (wasSelected) {
    config.selected.delete(value);
  } else {
    config.selected.add(value);
    rememberPickerValue(kind, value);
  }
  if (kind === "faculty") {
    els.facultyPickerSearch.value = "";
  }
  updatePickerFilter(kind);
  trackEvent("dashboard_picker_selection_changed", {
    picker_type: kind,
    selection_action: wasSelected ? "removed" : "added",
    selection_count: config.selected.size,
  });
  if (kind === "faculty") {
    requestAnimationFrame(() => els.facultyPickerSearch.focus({ preventScroll: true }));
  }
}

function clearRecentPickerValues(kind) {
  const key = {
    term: "recentTerms",
    faculty: "recentFaculty",
    college: "recentColleges",
    subject: "recentSubjects",
  }[kind];
  state[key] = [];
  renderPickerOptions(kind, state.pickerValues[kind]);
  savePreferences();
}

function rememberPickerValue(kind, value) {
  const key = {
    term: "recentTerms",
    faculty: "recentFaculty",
    college: "recentColleges",
    subject: "recentSubjects",
  }[kind];
  state[key] = [value, ...state[key].filter((item) => item !== value)].slice(0, 8);
}

function updatePickerSummary(kind) {
  const config = pickerConfig(kind);
  const selected = sortPickerSelections(kind, [...config.selected]);
  const display = kind === "faculty" ? selected.map(lastName) : selected.map(config.label);
  const allTermsSelected = kind === "term" && state.terms.length > 0 && selected.length === state.terms.length;
  config.summary.textContent = selected.length
    ? allTermsSelected ? "All terms" : kind === "term" ? display.join(", ") : `${selected.length} selected: ${display.join(", ")}`
    : config.all;
  config.clearButton.disabled = selected.length === 0;
  if (kind === "term") els.selectAllTermsButton.disabled = allTermsSelected;
}

function sortPickerSelections(kind, values) {
  if (kind !== "term") return values.sort();
  return values.sort((a, b) => termSortRank(b) - termSortRank(a));
}

function termSortRank(code) {
  const term = getTermParts(code);
  if (!term) return 0;
  const seasonRank = { Fall: 3, Spring: 2, Summer: 1 }[term.season] ?? 0;
  return term.academicYear * 10 + seasonRank;
}

function termChronologicalRank(code) {
  const term = getTermParts(code);
  if (!term) return 0;
  const seasonRank = { Spring: 1, Summer: 2, Fall: 3 }[term.season] ?? 0;
  return term.year * 10 + seasonRank;
}

function termLabel(code) {
  const term = getTermParts(code);
  return term ? `${term.season} ${term.year}` : state.terms.find((item) => item.code === code)?.description ?? code;
}

function getTermParts(code) {
  const description = state.terms.find((term) => term.code === code)?.description ?? "";
  const match = description.match(/^(?<year>\d{4})\s+(?<season>Fall|Spring|Summer)$/i);
  if (!match?.groups) return null;
  const year = Number(match.groups.year);
  const season = match.groups.season[0].toUpperCase() + match.groups.season.slice(1).toLowerCase();
  const academicYear = season === "Fall" ? year : year - 1;
  return { year, season, academicYear };
}

function lastName(name) {
  const parts = String(name).trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

function collegeLabel(value) {
  return COLLEGE_OPTIONS.find(([key]) => key === value)?.[1] ?? value;
}

function setSectionView(view) {
  const changed = state.sectionView !== view;
  state.sectionView = view;
  els.tableViewButton.setAttribute("aria-pressed", String(view === "table"));
  els.cardViewButton.setAttribute("aria-pressed", String(view === "cards"));
  syncCardSortControl();
  savePreferences();
  renderSections();
  if (changed) trackEvent("dashboard_view_changed", { view });
}

function syncCardSortControl() {
  syncCardSortButtons();
}

function syncCardSortButtons() {
  document.querySelectorAll("[data-card-sort]").forEach((control) => {
    const active = control.dataset.cardSort === state.sortKey;
    const label = sortLabel(control.dataset.cardSort);
    const direction = state.sortDir === "asc" ? "ascending" : "descending";
    control.setAttribute("aria-current", String(active));
    control.setAttribute("aria-label", active ? `Sort by ${label}, ${direction}` : `Sort by ${label}`);
    control.innerHTML = `${label}${sortArrowsSvg(state.sortDir, active, control.dataset.cardSort === "startTime")}`;
  });
}

function sortArrowsSvg(direction, active, reverseDirection = false) {
  const pointsUp = reverseDirection ? direction === "desc" : direction === "asc";
  const upClass = active && pointsUp ? " is-active" : "";
  const downClass = active && !pointsUp ? " is-active" : "";
  return `<span class="sort-arrows" aria-hidden="true"><svg class="sort-arrow${upClass}" viewBox="0 0 24 24" focusable="false"><path d="M12 5l-5 6h10l-5-6z"></path></svg><svg class="sort-arrow${downClass}" viewBox="0 0 24 24" focusable="false"><path d="M12 19l5-6H7l5 6z"></path></svg></span>`;
}

function sortLabel(key) {
  return {
    course: "Course",
    faculty: "Faculty",
    filled: "Enrollment",
    delivery: "Delivery",
    startTime: "Start Time",
    term: "Term",
  }[key] ?? key;
}

function applyFilters({ transitionSections = true } = {}) {
  state.showAllCards = false;
  const query = els.searchInput.value.trim().toLowerCase();
  const subjects = state.selectedSubjects;
  const facultyNames = state.selectedFaculty;
  const colleges = state.selectedColleges;
  const delivery = els.deliverySelect.value;
  const meetingDays = els.meetingDaysSelect.value;
  const genEd = els.genEdSelect.value;

  state.filtered = state.rows.filter((row) => matchesFilters(row, {
    query, subjects, facultyNames, colleges, delivery, meetingDays, genEd,
  }));

  renderAll({ transitionSections });
  savePreferences();
}

function matchesFilters(row, { query, subjects, facultyNames, colleges, delivery, meetingDays, genEd }) {
  if (query && !row.search.includes(query)) return false;
  if (subjects.size && !subjects.has(row.subject)) return false;
  if (colleges.size && ![...colleges].some((college) => COLLEGE_SUBJECTS[college]?.has(row.subject))) return false;
  if (facultyNames.size) {
    const names = row.faculty.length ? row.faculty : ["None assigned"];
    if (!names.some((name) => facultyNames.has(name))) return false;
  }
  if (delivery && row.delivery !== delivery) return false;
  if (meetingDays && !matchesMeetingDays(row, meetingDays)) return false;
  if (genEd && !row.attributes.some((attr) => attr.code === genEd)) return false;
  return !state.openOnly || row.available > 0;
}

function matchesMeetingDays(row, pattern) {
  const matchingDays = {
    mwf: ["monday", "wednesday", "friday"],
    tth: ["tuesday", "thursday"],
  }[pattern];
  if (!matchingDays) return true;
  const meetingDays = (row.dayKeys ?? []).filter((day) => ["monday", "tuesday", "wednesday", "thursday", "friday"].includes(day));
  return meetingDays.some((day) => matchingDays.includes(day));
}

function renderAll({ transitionSections = true } = {}) {
  renderMetrics();
  renderHistoryChart();
  renderDelivery();
  renderSubjectBars();
  renderRanks("facultyList", facultyStats(state.filtered), "sections", "Underenrolled");
  renderRanks("roomList", roomStats(state.filtered), "sections");
  renderSections({ transition: transitionSections });
}

function totals(rows) {
  return rows.reduce(
    (acc, row) => {
      acc.sections += 1;
      acc.filled += row.filled;
      acc.available += row.available;
      acc.max += row.max;
      acc.wait += row.wait;
      return acc;
    },
    { sections: 0, filled: 0, available: 0, max: 0, wait: 0 },
  );
}

function renderMetrics() {
  const total = totals(state.filtered);
  const underenrolled = state.filtered.filter((row) => row.filled < 10).length;
  els.sectionsMetric.textContent = number.format(total.sections);
  els.filledMetric.textContent = `${number.format(total.filled)} / ${number.format(total.max)}`;
  els.occupancyMetric.textContent = total.max ? `${percent.format((total.filled / total.max) * 100)}%` : "-";
  els.underenrolledMetric.textContent = number.format(underenrolled);
  els.tableCount.textContent = `${number.format(total.sections)} visible of ${number.format(state.rows.length)} sections`;
}

function renderDelivery() {
  const counts = { campus: 0, internet: 0, unknown: 0 };
  state.filtered.forEach((row) => {
    counts[row.delivery] += 1;
  });
  const total = Math.max(1, state.filtered.length);
  els.deliverySummary.textContent = `${number.format(state.filtered.length)} visible sections`;
  els.deliveryBars.innerHTML = [
    ["campus", "In-person"],
    ["internet", "Internet"],
    ["unknown", "Unknown"],
  ]
    .map(([key, label]) => {
      const pct = (counts[key] / total) * 100;
      const fillPct = pct < 0.1 ? 0 : pct;
      return `<div class="delivery-row">
        <header><strong>${label}</strong><span>${number.format(counts[key])} sections (${percent.format(pct)}%)</span></header>
        <div class="track"><span class="fill ${key}" style="width:${fillPct}%"></span></div>
      </div>`;
    })
    .join("");
}

function renderSubjectBars() {
  const stats = mapStats(state.filtered, (row) => row.subject);
  const top = [...stats.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.sections - a.sections);
  const max = Math.max(1, ...top.map((item) => item.sections));
  els.subjectBars.innerHTML = top.length
    ? top
        .map((item) => `<div class="bar-row">
          <strong class="bar-label">${escapeHtml(item.name)}</strong>
          <div class="bar-meter"><span style="width:${(item.sections / max) * 100}%"></span></div>
          <span class="bar-value">${number.format(item.sections)} sections</span>
        </div>`)
        .join("")
    : emptyMessage("No subjects match the current filters.");
}

function mapStats(rows, keyFn) {
  const stats = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!key) return;
    const current = stats.get(key) ?? { sections: 0, filled: 0, max: 0 };
    current.sections += 1;
    current.filled += row.filled;
    current.max += row.max;
    stats.set(key, current);
  });
  return stats;
}

function facultyStats(rows) {
  const stats = new Map();
  rows.forEach((row) => {
    const names = row.faculty.length ? row.faculty : ["None assigned"];
    names.forEach((name) => {
      const current = stats.get(name) ?? { sections: 0, filled: 0, max: 0, underenrolled: 0 };
      current.sections += 1 / names.length;
      current.filled += row.filled / names.length;
      current.max += row.max / names.length;
      if (row.filled < 10) current.underenrolled += 1 / names.length;
      stats.set(name, current);
    });
  });
  return stats;
}

function roomStats(rows) {
  return mapStats(rows.filter((row) => row.delivery === "campus"), (row) => displayRoomName(row.room));
}

function displayRoomName(room) {
  return String(room ?? "").replace(/^Beacom Institute of Technology\b/, "Beacom");
}

function renderRanks(targetId, stats, unit, extraLabel = "") {
  const rows = [...stats.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => {
      const sectionDiff = b.sections - a.sections;
      if (sectionDiff) return sectionDiff;
      const underenrolledDiff = (b.underenrolled ?? 0) - (a.underenrolled ?? 0);
      return underenrolledDiff || a.name.localeCompare(b.name);
    });
  const target = $(targetId);
  target.classList.toggle("has-extra", Boolean(extraLabel));
  target.innerHTML = rows.length
    ? rows
        .map((item) => `<div class="rank-row">
          <span class="rank-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
          <span class="rank-value">${number.format(round(item.sections))} ${unit}</span>
          ${extraLabel ? `<span class="rank-extra">${number.format(round(item.underenrolled ?? 0))}</span>` : ""}
        </div>`)
        .join("")
    : emptyMessage("No rows match the current filters.");
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function sortedRows() {
  const dir = state.sortDir === "asc" ? 1 : -1;
  return [...state.filtered].sort((a, b) => {
    const av = sortValue(a, state.sortKey);
    const bv = sortValue(b, state.sortKey);
    if (state.sortKey === "startTime") {
      const aIsUntimed = !Number.isFinite(av);
      const bIsUntimed = !Number.isFinite(bv);
      if (aIsUntimed || bIsUntimed) {
        if (aIsUntimed && bIsUntimed) return a.course.localeCompare(b.course);
        return aIsUntimed ? 1 : -1;
      }
    }
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

function sortValue(row, key) {
  if (key === "faculty") return row.faculty.join(", ");
  if (key === "attributes") return row.attributes.map((attr) => attr.code).join(", ");
  if (key === "meeting") return row.meeting;
  if (key === "startTime") return row.startTime;
  if (key === "term") return termChronologicalRank(row.termCode);
  return row[key] ?? "";
}

function renderSections({ transition = true } = {}) {
  const isCardView = state.sectionView === "cards";
  document.querySelector(".table-panel").classList.toggle("is-card-view", isCardView);
  document.querySelector(".table-wrap").hidden = isCardView;
  els.sectionsCards.hidden = !isCardView;
  els.showAllCardsButton.hidden = true;
  window.clearTimeout(sectionRenderTimer);

  if (isCardView) {
    if (!transition || !sectionsRendered) {
      els.sectionsCards.classList.remove("is-fading");
      renderCards();
      sectionsRendered = true;
      return;
    }

    els.sectionsCards.classList.add("is-fading");
    sectionRenderTimer = window.setTimeout(() => {
      renderCards();
      els.sectionsCards.classList.remove("is-fading");
      sectionsRendered = true;
    }, SECTION_FADE_DELAY);
  } else {
    els.sectionsCards.classList.remove("is-fading");
    renderTable();
    sectionsRendered = true;
  }
}

function renderTable() {
  const rows = sortedRows().slice(0, 600);
  els.sectionsBody.innerHTML = rows.length
    ? rows.map(renderRow).join("")
    : `<tr><td colspan="8">${emptyMessage("No sections match the current filters.")}</td></tr>`;
}

function renderCards() {
  const matchingRows = sortedRows();
  const rows = state.showAllCards ? matchingRows : matchingRows.slice(0, INITIAL_CARD_LIMIT);
  els.showAllCardsButton.hidden = state.showAllCards || matchingRows.length <= INITIAL_CARD_LIMIT;
  els.sectionsCards.innerHTML = rows.length
    ? rows.map(renderCard).join("")
    : emptyMessage("No sections match the current filters.");
}

function renderRow(row) {
  const term = encodeURIComponent(row.termCode);
  const crn = encodeURIComponent(row.crn);
  const attrs = row.attributes.length
    ? row.attributes.map((attr) => `<span class="pill" title="${escapeHtml(attr.description)}">${escapeHtml(attr.code)}</span>`).join("")
    : `<span class="pill">None</span>`;
  const openClass = row.available > 0 ? "open" : "full";
  const openText = row.available > 0 ? `${number.format(row.available)} open` : "Full";

  return `<tr>
    <td><a class="course-link" href="https://bim.inclass.today/history/section/${term}/${crn}" target="_blank" rel="noreferrer">${escapeHtml(row.course)}</a><br><span>${escapeHtml(row.termLabel)} - CRN ${escapeHtml(row.crn)}</span></td>
    <td>${escapeHtml(row.title)}<br><span>${escapeHtml(row.credits)} credits</span></td>
    <td>${number.format(row.filled)} / ${number.format(row.max)}</td>
    <td><span class="pill ${openClass}">${openText}</span>${row.wait ? `<br><span>${number.format(row.wait)} waitlisted</span>` : ""}</td>
    <td>${escapeHtml(row.label)}</td>
    <td>${escapeHtml(row.meeting || "Meeting TBD")}</td>
    <td>${escapeHtml(row.faculty.join(", ") || "None assigned")}</td>
    <td><div class="pill-list">${attrs}</div></td>
  </tr>`;
}

function renderCard(row) {
  const term = encodeURIComponent(row.termCode);
  const crn = encodeURIComponent(row.crn);
  const attrs = row.attributes.length
    ? row.attributes.map((attr) => `<span class="pill" title="${escapeHtml(attr.description)}">${escapeHtml(attr.code)}</span>`).join("")
    : `<span class="pill">None</span>`;
  const enrollmentClass = row.filled >= 10 ? "high" : "low";

  return `<article class="section-card">
    <div class="section-card-top">
      <div class="section-card-main">
        <div class="section-card-kicker">
          <a class="course-link" href="https://bim.inclass.today/history/section/${term}/${crn}" target="_blank" rel="noreferrer">${escapeHtml(row.course)}</a>
          <span>${escapeHtml(row.termLabel)} - CRN ${escapeHtml(row.crn)}</span>
        </div>
        <h3>${escapeHtml(row.title)}</h3>
        <p>${escapeHtml(row.credits)} credits</p>
        <div class="pill-list card-attributes">${attrs}</div>
      </div>
      <div class="enrollment-callout ${enrollmentClass}" aria-label="${number.format(row.filled)} students enrolled">
        <strong>${number.format(row.filled)}</strong>
        <span>Enrolled</span>
      </div>
    </div>
    <div class="section-card-bottom">
      <div class="meeting-block">${renderMeetingVisual(row)}</div>
      <div class="section-card-details">
        <p class="open-seats">Open seats: ${number.format(row.available)} / ${number.format(row.max)}</p>
        <p class="faculty-name">${escapeHtml(row.faculty.join(", ") || "None assigned")}</p>
        ${row.wait ? `<p class="waitlist-note">${number.format(row.wait)} waitlisted</p>` : ""}
      </div>
    </div>
  </article>`;
}

function renderMeetingVisual(row) {
  if (row.delivery === "internet") {
    return `<div class="internet-pill">Internet</div>`;
  }

  const weekdays = [
    ["monday", "M"],
    ["tuesday", "T"],
    ["wednesday", "W"],
    ["thursday", "T"],
    ["friday", "F"],
  ];
  const activeDays = new Set(row.dayKeys ?? []);
  const dayStrip = weekdays
    .map(([key, label]) => `<span class="${activeDays.has(key) ? "is-active" : ""}">${label}</span>`)
    .join("");

  return `<div class="meeting-lines">
    <p>${escapeHtml(row.room || "Location TBD")}</p>
    <p>${escapeHtml(row.time || "Time TBD")}</p>
    <div class="day-strip" aria-label="${escapeHtml(row.days.length ? row.days.join(", ") : "Days TBD")}">${dayStrip}</div>
  </div>`;
}

function emptyMessage(message) {
  return `<p class="empty">${escapeHtml(message)}</p>`;
}

function renderHistoryChart() {
  if (!state.historyRows.length) {
    if (!state.history) return;
    drawHistoryChart(state.history.terms.map((label, index) => ({
      label,
      students: Number(state.history.students?.[index]) || 0,
    })));
    return;
  }

  const query = els.searchInput.value.trim().toLowerCase();
  const filters = {
    query,
    subjects: state.selectedSubjects,
    facultyNames: state.selectedFaculty,
    colleges: state.selectedColleges,
    delivery: els.deliverySelect.value,
    meetingDays: els.meetingDaysSelect.value,
    genEd: els.genEdSelect.value,
  };
  const selectedTerms = state.selectedTerms.size
    ? state.selectedTerms
    : new Set(state.terms.map((term) => term.code));
  const liveTerms = new Set(state.liveHistoryRows.keys());
  const rows = [
    ...state.historyRows.filter((row) => !liveTerms.has(row.termCode)),
    ...[...state.liveHistoryRows.values()].flat(),
  ];
  const enrolledByTerm = new Map([...selectedTerms].map((termCode) => [termCode, 0]));

  rows.forEach((row) => {
    if (!selectedTerms.has(row.termCode) || !matchesFilters(row, filters)) return;
    enrolledByTerm.set(row.termCode, (enrolledByTerm.get(row.termCode) ?? 0) + row.filled);
  });

  drawHistoryChart(state.terms
    .filter((term) => selectedTerms.has(term.code))
    .map((term) => ({ label: term.description, students: enrolledByTerm.get(term.code) ?? 0 })));
}

function drawHistoryChart(entries) {
  const canvas = els.historyChart;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, rect.width || canvas.clientWidth || canvas.width);
  const height = Math.max(260, rect.height || canvas.clientHeight || canvas.height);
  const ratio = (window.devicePixelRatio || 1) * 2;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const padding = { top: 24, right: 24, bottom: 50, left: 62 };
  const students = entries.map(({ students: studentCount }) => Number(studentCount) || 0);
  const labels = entries.map(({ label }) => label);
  const max = Math.max(...students, 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const chartTerms = labels.map((label, index) => ({
    label,
    students: students[index],
    term: historyTermParts(label),
  })).sort((a, b) => a.term.academicYear - b.term.academicYear || historySeasonRank(a.term.season) - historySeasonRank(b.term.season));
  const terms = chartTerms.map((entry) => entry.term);
  const groupBreaks = terms.reduce((total, term, index) => total + Number(index > 0 && term.academicYear !== terms[index - 1].academicYear), 0);
  const minimumGroupGap = 24;
  const barWidth = Math.min(24, Math.max(1, (plotWidth - groupBreaks * minimumGroupGap) / labels.length));
  const groupGap = groupBreaks
    ? Math.min(48, Math.max(minimumGroupGap, (plotWidth - labels.length * barWidth) / groupBreaks))
    : 0;
  const colors = getComputedStyle(document.documentElement);
  const seasonColors = {
    Fall: colors.getPropertyValue("--navy").trim() || "#17375e",
    Spring: colors.getPropertyValue("--teal").trim() || "#0a7c86",
    Summer: colors.getPropertyValue("--teal-summer").trim() || "#81b9bc",
  };
  const fallPattern = createFallPattern(ctx, seasonColors.Fall);
  historyBars = [];
  hideHistoryTooltip();

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#d8e0ea";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#607086";
  ctx.font = '13px "Saira", ui-sans-serif, system-ui, sans-serif';

  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + plotHeight - (plotHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(number.format(Math.round((max * i) / 4)), 8, y + 4);
  }

  let termStart = padding.left;
  chartTerms.forEach(({ label, students: studentCount, term }, index) => {
    if (index > 0 && terms[index].academicYear !== terms[index - 1].academicYear) termStart += groupGap;
    const x = termStart + barWidth / 2;
    const studentHeight = (studentCount / max) * plotHeight;
    const y = padding.top + plotHeight - studentHeight;

    ctx.fillStyle = term.season === "Fall" ? fallPattern : (seasonColors[term.season] || seasonColors.Spring);
    ctx.fillRect(x - barWidth / 2, y, barWidth, studentHeight);
    historyBars.push({
      label,
      students: studentCount,
      x,
      y,
      width: barWidth,
      height: studentHeight,
      baseline: padding.top + plotHeight,
    });
    termStart += barWidth;

    ctx.fillStyle = seasonColors[term.season] || seasonColors.Spring;
    ctx.font = '700 10px "Saira", ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(term.code, x, height - 27);
    ctx.fillText(String(term.year).slice(-2), x, height - 14);
    ctx.textAlign = "start";
  });

  if (!historyResizeObserver && "ResizeObserver" in window) {
    historyResizeObserver = new ResizeObserver(() => renderHistoryChart());
    historyResizeObserver.observe(canvas);
  }
}

function bindHistoryChartInteractions() {
  const canvas = els.historyChart;
  canvas.addEventListener("pointermove", (event) => {
    updateHistoryTooltipFromPointer(event);
  });
  canvas.addEventListener("mousemove", updateHistoryTooltipFromPointer);
  canvas.addEventListener("pointerleave", () => {
    canvas.style.cursor = "default";
    hideHistoryTooltip();
  });
  document.addEventListener("pointermove", dismissHistoryTooltipOutsideBar, true);
  document.addEventListener("mousemove", dismissHistoryTooltipOutsideBar, true);
  canvas.addEventListener("blur", hideHistoryTooltip);
  canvas.addEventListener("keydown", (event) => {
    if (!historyBars.length || !["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    if (event.key === "Escape") {
      hideHistoryTooltip();
      return;
    }
    event.preventDefault();
    const current = activeHistoryBarIndex ?? 0;
    const next = event.key === "ArrowLeft" ? current - 1
      : event.key === "ArrowRight" ? current + 1
        : event.key === "Home" ? 0
          : historyBars.length - 1;
    showHistoryTooltip(Math.max(0, Math.min(historyBars.length - 1, next)));
  });
}

function updateHistoryTooltipFromPointer(event) {
  const index = historyBarAt(event.clientX, event.clientY);
  els.historyChart.style.cursor = index === -1 ? "default" : "pointer";
  if (index === -1) {
    hideHistoryTooltip();
    return;
  }
  showHistoryTooltip(index);
}

function dismissHistoryTooltipOutsideBar(event) {
  if (els.historyChartTooltip.hidden || historyBarAt(event.clientX, event.clientY) !== -1) return;
  els.historyChart.style.cursor = "default";
  hideHistoryTooltip();
}

function historyBarAt(clientX, clientY) {
  const rect = els.historyChart.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return historyBars.findIndex((bar) => {
    const left = bar.x - bar.width / 2;
    const hitTop = bar.baseline - Math.max(bar.height, 8);
    return x >= left && x <= left + bar.width && y >= hitTop && y <= bar.baseline;
  });
}

function showHistoryTooltip(index) {
  const bar = historyBars[index];
  if (!bar) return;
  activeHistoryBarIndex = index;
  const tooltip = els.historyChartTooltip;
  const canvas = els.historyChart;
  els.historyChartTooltipContent.innerHTML = `<strong>${escapeHtml(bar.label)}</strong><span>${number.format(bar.students)} students enrolled</span>`;
  window.clearTimeout(historyTooltipHideTimer);
  tooltip.hidden = false;
  const left = Math.max(4, Math.min(canvas.clientWidth - tooltip.offsetWidth - 4, bar.x));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${bar.y - 8}px`;
  requestAnimationFrame(() => tooltip.classList.add("is-visible"));
  canvas.setAttribute("aria-label", `${bar.label}: ${number.format(bar.students)} students enrolled. Use left and right arrow keys to explore terms.`);
}

function hideHistoryTooltip() {
  const tooltip = els.historyChartTooltip;
  if (tooltip.hidden) return;
  tooltip.classList.remove("is-visible");
  window.clearTimeout(historyTooltipHideTimer);
  historyTooltipHideTimer = window.setTimeout(() => {
    if (!tooltip.classList.contains("is-visible")) tooltip.hidden = true;
  }, 125);
}

function createFallPattern(ctx, color) {
  const patternCanvas = document.createElement("canvas");
  patternCanvas.width = 8;
  patternCanvas.height = 8;
  const patternContext = patternCanvas.getContext("2d");
  patternContext.fillStyle = color;
  patternContext.fillRect(0, 0, 8, 8);
  patternContext.strokeStyle = "rgba(255, 255, 255, 0.72)";
  patternContext.lineWidth = 1;
  patternContext.beginPath();
  patternContext.moveTo(-4, 8);
  patternContext.lineTo(8, -4);
  patternContext.moveTo(0, 12);
  patternContext.lineTo(12, 0);
  patternContext.stroke();
  return ctx.createPattern(patternCanvas, "repeat") || color;
}

function historyTermParts(label) {
  const match = String(label).match(/(\d{2,4})\s+(Fall|Spring|Summer)/i);
  if (!match) return { year: null, season: "", code: String(label), academicYear: String(label) };
  const year = Number(match[1]);
  const season = match[2][0].toUpperCase() + match[2].slice(1).toLowerCase();
  return {
    year,
    season,
    code: { Fall: "FA", Spring: "SP", Summer: "SU" }[season],
    academicYear: season === "Fall" ? year : year - 1,
  };
}

function historySeasonRank(season) {
  return { Fall: 0, Spring: 1, Summer: 2 }[season] ?? 3;
}

function exportCsv() {
  const headers = ["Term", "CRN", "Course", "Title", "Filled", "Maximum", "Open", "Waitlist", "Delivery", "Meeting", "Faculty", "Attributes"];
  const lines = [headers, ...sortedRows().map((row) => [
    row.termLabel,
    row.crn,
    row.course,
    row.title,
    row.filled,
    row.max,
    row.available,
    row.wait,
    row.label,
    row.meeting,
    row.faculty.join("; "),
    row.attributes.map((attr) => attr.code).join("; "),
  ])].map((line) => line.map(csvCell).join(","));

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `bim-${[...state.selectedTerms].join("-") || "selected"}-sections.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

initialize();
