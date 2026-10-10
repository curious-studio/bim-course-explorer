const API_BASE = window.BIM_API_BASE ?? (location.hostname.endsWith("github.io") ? "./api" : "/api");
const PREFERENCES_KEY = "bim-course-explorer.preferences.v1";
const PREFERENCES_COOKIE = "bimCourseExplorerPrefs";

const state = {
  terms: [],
  selectedTerm: "",
  termData: null,
  history: null,
  rows: [],
  filtered: [],
  selectedSubjects: new Set(),
  selectedFaculty: new Set(),
  recentSubjects: [],
  recentFaculty: [],
  pickerValues: { subject: [], faculty: [] },
  sortKey: "course",
  sortDir: "asc",
  sectionView: "cards",
  openOnly: false,
  preferencesLoaded: false,
};

const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

const els = {
  termSelect: $("termSelect"),
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
  clearFacultyButton: $("clearFacultyButton"),
  deliverySelect: $("deliverySelect"),
  genEdSelect: $("genEdSelect"),
  openOnlyButton: $("openOnlyButton"),
  resetButton: $("resetButton"),
  status: $("status"),
  sectionsMetric: $("sectionsMetric"),
  filledMetric: $("filledMetric"),
  occupancyMetric: $("occupancyMetric"),
  waitlistMetric: $("waitlistMetric"),
  historyChart: $("historyChart"),
  deliverySummary: $("deliverySummary"),
  deliveryBars: $("deliveryBars"),
  subjectBars: $("subjectBars"),
  facultyList: $("facultyList"),
  roomList: $("roomList"),
  sectionsBody: $("sectionsBody"),
  sectionsCards: $("sectionsCards"),
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

  if (isInternet) {
    return {
      delivery: "internet",
      label: "Internet",
      room: "Internet",
      time,
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

function getCreditHours(section) {
  if (section.creditHourIndicator && !section.creditHours) {
    return `${section.creditHourLow} ${section.creditHourIndicator} ${section.creditHourHigh}`;
  }
  return String(section.creditHours ?? section.creditHourLow ?? "");
}

function normalizeSection(section) {
  const meeting = getMeeting(section);
  const faculty = section.faculty?.map((item) => item.displayName).filter(Boolean) ?? [];
  const attrs = section.sectionAttributes?.map((item) => ({
    code: item.code,
    description: decodeHtml(item.description),
  })) ?? [];
  const max = Number(section.maximumEnrollment) || 0;
  const available = Number(section.seatsAvailable) || 0;
  const filled = Math.max(0, max - available);
  const course = `${section.subject}${section.courseNumber}-${section.sequenceNumber}`;

  return {
    raw: section,
    crn: section.courseReferenceNumber,
    subject: section.subject,
    courseNumber: section.courseNumber,
    sequence: section.sequenceNumber,
    course,
    title: section.courseTitle,
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
      meeting.room,
      meeting.meeting,
    ].join(" ").toLowerCase(),
  };
}

async function initialize() {
  bindEvents();
  loadPreferences();

  try {
    const [terms, history] = await Promise.all([
      fetchJson("/history/api/terms"),
      fetchJson("/history/api/enrollment").catch(() => null),
    ]);

    state.terms = terms;
    state.history = history;
    els.termSelect.innerHTML = terms
      .map((term) => `<option value="${term.code}">${escapeHtml(term.description)}</option>`)
      .join("");
    state.selectedTerm = state.selectedTerm && terms.some((term) => term.code === state.selectedTerm)
      ? state.selectedTerm
      : getDefaultTerm(terms, history);
    els.termSelect.value = state.selectedTerm;
    applyStoredControls();
    await loadTerm(state.selectedTerm);
    if (history) drawHistoryChart(history);
  } catch (error) {
    setStatus(`Could not load BIM data. ${error.message}. If this page is opened from another domain, the BIM server may need to allow browser cross-origin requests.`);
  }
}

function getDefaultTerm(terms, history) {
  const activeCodes = new Set();
  history?.name?.forEach((code, index) => {
    if (Number(history.students?.[index]) > 0) activeCodes.add(code);
  });
  return terms.find((term) => activeCodes.has(term.code))?.code ?? terms[0]?.code ?? "";
}

async function loadTerm(term) {
  setStatus("Loading term data...");
  state.selectedTerm = term;
  state.termData = await fetchJson(`/data/${term}tiny.json`);
  state.rows = (state.termData.classes ?? []).map(normalizeSection);
  hydrateFilters();
  applyFilters();
  setStatus(`Updated ${state.termData.updated}.`, true);
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

  els.genEdSelect.innerHTML = `<option value="">All attributes</option>${[...attrs.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, description]) => `<option value="${escapeHtml(code)}">${escapeHtml(code)} - ${escapeHtml(description)}</option>`)
    .join("")}`;
  els.genEdSelect.value = attrs.has(selectedGenEd) ? selectedGenEd : "";
}

function loadPreferences() {
  try {
    const saved = JSON.parse(readPreferenceStore() || "{}");
    if (!saved || typeof saved !== "object") return;
    state.selectedTerm = typeof saved.term === "string" ? saved.term : "";
    state.selectedSubjects = new Set(Array.isArray(saved.subjects) ? saved.subjects.filter((subject) => typeof subject === "string") : []);
    state.selectedFaculty = new Set(Array.isArray(saved.faculty) ? saved.faculty.filter((faculty) => typeof faculty === "string") : []);
    state.recentSubjects = Array.isArray(saved.recentSubjects) ? saved.recentSubjects.filter((subject) => typeof subject === "string") : [];
    state.recentFaculty = Array.isArray(saved.recentFaculty) ? saved.recentFaculty.filter((faculty) => typeof faculty === "string") : [];
    state.sectionView = saved.sectionView === "table" ? "table" : "cards";
    state.openOnly = Boolean(saved.openOnly);
    els.searchInput.value = typeof saved.search === "string" ? saved.search : "";
    els.deliverySelect.value = typeof saved.delivery === "string" ? saved.delivery : "";
    els.genEdSelect.value = typeof saved.genEd === "string" ? saved.genEd : "";
    state.sortKey = typeof saved.sortKey === "string" ? saved.sortKey : state.sortKey;
    state.sortDir = saved.sortDir === "desc" ? "desc" : "asc";
    state.preferencesLoaded = true;
  } catch {
    state.preferencesLoaded = false;
  }
}

function applyStoredControls() {
  els.openOnlyButton.setAttribute("aria-pressed", String(state.openOnly));
  els.tableViewButton.setAttribute("aria-pressed", String(state.sectionView === "table"));
  els.cardViewButton.setAttribute("aria-pressed", String(state.sectionView === "cards"));
  syncCardSortControl();
}

function savePreferences() {
  const payload = {
    term: state.selectedTerm,
    search: els.searchInput.value,
    subjects: [...state.selectedSubjects],
    faculty: [...state.selectedFaculty],
    recentSubjects: state.recentSubjects,
    recentFaculty: state.recentFaculty,
    delivery: els.deliverySelect.value,
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
  els.termSelect.addEventListener("change", () => {
    savePreferences();
    loadTerm(els.termSelect.value);
  });
  [els.searchInput, els.deliverySelect, els.genEdSelect].forEach((el) => {
    el.addEventListener("input", applyFilters);
  });
  els.subjectToggle.addEventListener("click", () => setSubjectPanelOpen(els.subjectPanel.hidden));
  els.facultyToggle.addEventListener("click", () => setFacultyPanelOpen(els.facultyPanel.hidden));
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".subject-filter")) {
      setSubjectPanelOpen(false);
    }
    if (!event.target.closest(".faculty-filter")) {
      setFacultyPanelOpen(false);
    }
  });
  els.clearSubjectsButton.addEventListener("click", () => {
    state.selectedSubjects.clear();
    state.recentSubjects = [];
    updatePickerFilter("subject");
  });
  els.clearFacultyButton.addEventListener("click", () => {
    state.selectedFaculty.clear();
    state.recentFaculty = [];
    updatePickerFilter("faculty");
  });
  els.subjectOptions.addEventListener("click", (event) => {
    handlePickerClick(event, "subject");
  });
  els.facultyOptions.addEventListener("click", (event) => {
    handlePickerClick(event, "faculty");
  });
  els.openOnlyButton.addEventListener("click", () => {
    state.openOnly = !state.openOnly;
    els.openOnlyButton.setAttribute("aria-pressed", String(state.openOnly));
    applyFilters();
  });
  els.resetButton.addEventListener("click", () => {
    els.searchInput.value = "";
    state.selectedSubjects.clear();
    state.selectedFaculty.clear();
    state.recentSubjects = [];
    state.recentFaculty = [];
    setSubjectPanelOpen(false);
    setFacultyPanelOpen(false);
    els.deliverySelect.value = "";
    els.genEdSelect.value = "";
    state.openOnly = false;
    state.sectionView = "cards";
    state.sortKey = "course";
    state.sortDir = "asc";
    els.openOnlyButton.setAttribute("aria-pressed", "false");
    applyStoredControls();
    clearPreferences();
    applyFilters();
  });
  els.exportButton.addEventListener("click", exportCsv);
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
    });
  });
}

function setSubjectPanelOpen(isOpen) {
  els.subjectToggle.setAttribute("aria-expanded", String(isOpen));
  els.subjectPanel.hidden = !isOpen;
}

function setFacultyPanelOpen(isOpen) {
  els.facultyToggle.setAttribute("aria-expanded", String(isOpen));
  els.facultyPanel.hidden = !isOpen;
}

function pickerConfig(kind) {
  return kind === "faculty"
    ? {
        selected: state.selectedFaculty,
        recent: state.recentFaculty,
        options: els.facultyOptions,
        summary: els.facultySummary,
        clearButton: els.clearFacultyButton,
        empty: "No faculty available.",
        all: "All faculty",
        dataAttr: "faculty",
      }
    : {
        selected: state.selectedSubjects,
        recent: state.recentSubjects,
        options: els.subjectOptions,
        summary: els.subjectSummary,
        clearButton: els.clearSubjectsButton,
        empty: "No subjects available.",
        all: "All subjects",
        dataAttr: "subject",
      };
}

function renderPickerOptions(kind, values) {
  const config = pickerConfig(kind);
  state.pickerValues[kind] = values;
  const recent = config.recent.filter((value) => values.includes(value)).slice(0, 8);
  const remaining = values.filter((value) => !recent.includes(value));
  const renderButton = (value) => {
    const selected = config.selected.has(value);
    const index = values.indexOf(value);
    return `<button class="picker-pill" type="button" data-${config.dataAttr}-index="${index}" aria-pressed="${selected}">${escapeHtml(value)}</button>`;
  };
  config.options.innerHTML = values.length
    ? `${recent.length ? `<div class="picker-section"><span>Recently selected</span><div class="picker-pill-list">${recent.map(renderButton).join("")}</div></div>` : ""}
      <div class="picker-section"><span>${recent.length ? "All" : ""}</span><div class="picker-pill-list">${remaining.map(renderButton).join("")}</div></div>`
    : emptyMessage(config.empty);
  updatePickerSummary(kind);
}

function updatePickerFilter(kind) {
  const values = kind === "faculty"
    ? [...new Set(state.rows.flatMap((row) => row.faculty.length ? row.faculty : ["None assigned"]))].sort()
    : [...new Set(state.rows.map((row) => row.subject))].sort();
  renderPickerOptions(kind, values);
  applyFilters();
}

function handlePickerClick(event, kind) {
  const config = pickerConfig(kind);
  const button = event.target.closest(`button[data-${config.dataAttr}-index]`);
  if (!button) return;
  const value = state.pickerValues[kind][Number(button.dataset[`${config.dataAttr}Index`])];
  if (!value) return;
  if (config.selected.has(value)) {
    config.selected.delete(value);
  } else {
    config.selected.add(value);
    rememberPickerValue(kind, value);
  }
  updatePickerFilter(kind);
}

function rememberPickerValue(kind, value) {
  const key = kind === "faculty" ? "recentFaculty" : "recentSubjects";
  state[key] = [value, ...state[key].filter((item) => item !== value)].slice(0, 8);
}

function updatePickerSummary(kind) {
  const config = pickerConfig(kind);
  const selected = [...config.selected].sort();
  const display = kind === "faculty" ? selected.map(lastName) : selected;
  config.summary.textContent = selected.length ? `${selected.length} selected: ${display.join(", ")}` : config.all;
  config.clearButton.disabled = selected.length === 0;
}

function lastName(name) {
  const parts = String(name).trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

function setSectionView(view) {
  state.sectionView = view;
  els.tableViewButton.setAttribute("aria-pressed", String(view === "table"));
  els.cardViewButton.setAttribute("aria-pressed", String(view === "cards"));
  syncCardSortControl();
  savePreferences();
  renderSections();
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
    control.innerHTML = active ? `${label}${sortArrowSvg(state.sortDir)}` : label;
  });
}

function sortArrowSvg(direction) {
  const path = direction === "asc" ? "M12 5l-5 6h10l-5-6z" : "M12 19l5-6H7l5 6z";
  return `<svg class="sort-arrow" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false"><path d="${path}"></path></svg>`;
}

function sortLabel(key) {
  return {
    course: "Course",
    faculty: "Faculty",
    filled: "Enrollment",
    delivery: "Delivery",
  }[key] ?? key;
}

function applyFilters() {
  const query = els.searchInput.value.trim().toLowerCase();
  const subjects = state.selectedSubjects;
  const facultyNames = state.selectedFaculty;
  const delivery = els.deliverySelect.value;
  const genEd = els.genEdSelect.value;

  state.filtered = state.rows.filter((row) => {
    if (query && !row.search.includes(query)) return false;
    if (subjects.size && !subjects.has(row.subject)) return false;
    if (facultyNames.size) {
      const names = row.faculty.length ? row.faculty : ["None assigned"];
      if (!names.some((name) => facultyNames.has(name))) return false;
    }
    if (delivery && row.delivery !== delivery) return false;
    if (genEd && !row.attributes.some((attr) => attr.code === genEd)) return false;
    if (state.openOnly && row.available <= 0) return false;
    return true;
  });

  renderAll();
  savePreferences();
}

function renderAll() {
  renderMetrics();
  renderDelivery();
  renderSubjectBars();
  renderRanks("facultyList", facultyStats(state.filtered), "sections");
  renderRanks("roomList", roomStats(state.filtered), "sections");
  renderSections();
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
  els.sectionsMetric.textContent = number.format(total.sections);
  els.filledMetric.textContent = `${number.format(total.filled)} / ${number.format(total.max)}`;
  els.occupancyMetric.textContent = total.max ? `${percent.format((total.filled / total.max) * 100)}%` : "-";
  els.waitlistMetric.textContent = number.format(total.wait);
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
    ["campus", "Campus"],
    ["internet", "Internet"],
    ["unknown", "Unknown"],
  ]
    .map(([key, label]) => {
      const pct = (counts[key] / total) * 100;
      return `<div class="delivery-row">
        <header><strong>${label}</strong><span>${number.format(counts[key])} sections (${percent.format(pct)}%)</span></header>
        <div class="track"><span class="fill ${key}" style="width:${pct}%"></span></div>
      </div>`;
    })
    .join("");
}

function renderSubjectBars() {
  const stats = mapStats(state.filtered, (row) => row.subject);
  const top = [...stats.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.sections - a.sections)
    .slice(0, 12);
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
      const current = stats.get(name) ?? { sections: 0, filled: 0, max: 0 };
      current.sections += 1 / names.length;
      current.filled += row.filled / names.length;
      current.max += row.max / names.length;
      stats.set(name, current);
    });
  });
  return stats;
}

function roomStats(rows) {
  return mapStats(rows.filter((row) => row.delivery === "campus"), (row) => row.room);
}

function renderRanks(targetId, stats, unit) {
  const rows = [...stats.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.sections - a.sections)
    .slice(0, 12);
  $(targetId).innerHTML = rows.length
    ? rows
        .map((item) => `<div class="rank-row">
          <span class="rank-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
          <span class="rank-value">${number.format(round(item.sections))} ${unit}</span>
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
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

function sortValue(row, key) {
  if (key === "faculty") return row.faculty.join(", ");
  if (key === "attributes") return row.attributes.map((attr) => attr.code).join(", ");
  if (key === "meeting") return row.meeting;
  return row[key] ?? "";
}

function renderSections() {
  const isCardView = state.sectionView === "cards";
  document.querySelector(".table-panel").classList.toggle("is-card-view", isCardView);
  document.querySelector(".table-wrap").hidden = isCardView;
  els.sectionsCards.hidden = !isCardView;

  if (isCardView) {
    renderCards();
  } else {
    renderTable();
  }
}

function renderTable() {
  const rows = sortedRows().slice(0, 600);
  els.sectionsBody.innerHTML = rows.length
    ? rows.map(renderRow).join("")
    : `<tr><td colspan="8">${emptyMessage("No sections match the current filters.")}</td></tr>`;
}

function renderCards() {
  const rows = sortedRows().slice(0, 120);
  els.sectionsCards.innerHTML = rows.length
    ? rows.map(renderCard).join("")
    : emptyMessage("No sections match the current filters.");
}

function renderRow(row) {
  const term = encodeURIComponent(state.selectedTerm);
  const crn = encodeURIComponent(row.crn);
  const attrs = row.attributes.length
    ? row.attributes.map((attr) => `<span class="pill" title="${escapeHtml(attr.description)}">${escapeHtml(attr.code)}</span>`).join("")
    : `<span class="pill">None</span>`;
  const openClass = row.available > 0 ? "open" : "full";
  const openText = row.available > 0 ? `${number.format(row.available)} open` : "Full";

  return `<tr>
    <td><a class="course-link" href="https://bim.inclass.today/history/section/${term}/${crn}" target="_blank" rel="noreferrer">${escapeHtml(row.course)}</a><br><span>CRN ${escapeHtml(row.crn)}</span></td>
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
  const term = encodeURIComponent(state.selectedTerm);
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
          <span>CRN ${escapeHtml(row.crn)}</span>
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

function drawHistoryChart(history) {
  const canvas = els.historyChart;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = { top: 24, right: 24, bottom: 70, left: 62 };
  const seats = history.seats.map(Number);
  const students = history.students.map(Number);
  const labels = history.terms;
  const max = Math.max(...seats, ...students, 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const barWidth = Math.max(5, plotWidth / labels.length / 2.6);

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#d8e0ea";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#607086";
  ctx.font = "14px system-ui, sans-serif";

  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + plotHeight - (plotHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(number.format(Math.round((max * i) / 4)), 8, y + 4);
  }

  labels.forEach((label, index) => {
    const x = padding.left + (plotWidth * index) / labels.length + plotWidth / labels.length / 2;
    const seatHeight = (seats[index] / max) * plotHeight;
    const studentHeight = (students[index] / max) * plotHeight;

    ctx.fillStyle = "#17375e";
    ctx.fillRect(x - barWidth, padding.top + plotHeight - seatHeight, barWidth, seatHeight);
    ctx.fillStyle = "#0a7c86";
    ctx.fillRect(x + 1, padding.top + plotHeight - studentHeight, barWidth, studentHeight);

    if (index % 2 === 0 || labels.length < 16) {
      ctx.save();
      ctx.translate(x - 10, height - 12);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = "#607086";
      ctx.fillText(label.replace("20", "'"), 0, 0);
      ctx.restore();
    }
  });

  drawLegend(ctx, width);
}

function drawLegend(ctx, width) {
  const entries = [
    ["#17375e", "Seats"],
    ["#0a7c86", "Students"],
  ];
  let x = width - 190;
  entries.forEach(([color, label]) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, 14, 14, 14);
    ctx.fillStyle = "#18212f";
    ctx.fillText(label, x + 20, 26);
    x += 86;
  });
}

function exportCsv() {
  const headers = ["CRN", "Course", "Title", "Filled", "Maximum", "Open", "Waitlist", "Delivery", "Meeting", "Faculty", "Attributes"];
  const lines = [headers, ...sortedRows().map((row) => [
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
  anchor.download = `bim-${state.selectedTerm}-sections.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

initialize();
