"use strict";

const toolList = document.getElementById("tool-list");

const resultsSection = document.getElementById("results");
const resultsTitle = document.getElementById("results-title");
const resultsSummary = document.getElementById("results-summary");
const resultsBody = document.getElementById("results-body");

document.getElementById("results-clear").addEventListener("click", () => {
  resultsSection.hidden = true;
});

const STATUS_LABEL = {
  moved: "Moved",
  planned: "Would move",
  skipped: "Skipped",
  error: "Error",
};

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function fieldValue(field) {
  const el = document.getElementById(field.name);
  if (!el) return null;

  switch (field.type) {
    case "bool":
      return el.checked;
    case "number": {
      if (el.value === "") return field.default ?? null;
      const num = Number(el.value);
      return Number.isNaN(num) ? null : num;
    }
    case "select":
      return el.value;
    default:
      return el.value;
  }
}

function validate(fields) {
  for (const field of fields) {
    if (field.required) {
      const el = document.getElementById(field.name);
      if (!el || el.value.trim() === "") {
        throw new Error(`"${field.label}" is required.`);
      }
    }
  }
}

function buildForm(field) {
  const wrap = document.createElement("div");
  wrap.className = "field";

  const label = document.createElement("label");
  label.setAttribute("for", field.name);
  label.textContent = field.label;
  wrap.appendChild(label);

  let input;
  if (field.type === "select") {
    input = document.createElement("select");
    for (const option of field.options || []) {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      if (option.value === field.default) opt.selected = true;
      input.appendChild(opt);
    }
  } else if (field.type === "bool") {
    wrap.classList.add("check-row");
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(field.default);
    wrap.insertBefore(input, label);
  } else {
    input = document.createElement("input");
    input.type = field.type === "number" ? "number" : "text";
    if (field.placeholder) input.placeholder = field.placeholder;
    if (field.default !== undefined && field.default !== null) input.value = field.default;
  }

  input.id = field.name;
  input.name = field.name;

  if (field.type === "folder") {
    const row = document.createElement("div");
    row.className = "folder-row";
    wrap.appendChild(row);

    input.classList.add("folder-input");
    input.setAttribute("spellcheck", "false");

    const browse = document.createElement("button");
    browse.type = "button";
    browse.className = "btn";
    browse.textContent = "Browse…";
    browse.addEventListener("click", () => openFolderPicker(input));

    row.append(input, browse);
  } else if (field.type !== "bool") {
    wrap.appendChild(input);
  }

  return wrap;
}

function renderTool(tool) {
  const card = document.createElement("article");
  card.className = "tool-card";
  card.innerHTML = `<h2>${escapeHtml(tool.name)}</h2><p class="tool-desc">${escapeHtml(tool.description)}</p>`;

  const form = document.createElement("form");
  form.addEventListener("submit", (e) => e.preventDefault());

  for (const field of tool.fields) {
    form.appendChild(buildForm(field));
  }

  const actions = document.createElement("div");
  actions.className = "tool-actions";

  if (tool.supports_dry_run) {
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "btn";
    preview.textContent = "Preview";
    actions.appendChild(preview);
  }

  const run = document.createElement("button");
  run.type = "submit";
  run.className = "btn primary";
  run.textContent = "Run";
  actions.appendChild(run);

  form.appendChild(actions);
  const error = createErrorBanner(form);

  const setBusy = (busy, buttons) => {
    for (const b of buttons) b.disabled = busy;
  };

  const execute = async (dryRun) => {
    const buttons = [...actions.querySelectorAll("button")];
    error.set("");

    let config;
    try {
      validate(tool.fields);
      config = {};
      for (const field of tool.fields) config[field.name] = fieldValue(field);
    } catch (err) {
      error.set(err.message);
      return;
    }

    setBusy(true, buttons);
    try {
      const result = await api(`/api/tools/${tool.id}/${dryRun ? "preview" : "run"}`, config);
      renderResults(tool, result);
    } catch (err) {
      error.set(err.message);
    } finally {
      setBusy(false, buttons);
    }
  };

  form.addEventListener("submit", () => execute(false));
  const previewBtn = actions.querySelector(".btn:not(.primary)");
  if (previewBtn) previewBtn.addEventListener("click", () => execute(true));

  card.appendChild(form);
  return card;
}

function createErrorBanner(scope) {
  const el = document.createElement("div");
  el.className = "error-banner";
  el.hidden = true;
  scope.appendChild(el);
  return {
    set(value) {
      el.textContent = value;
      el.hidden = !value;
    },
  };
}

function renderResults(tool, result) {
  resultsTitle.textContent = `${tool.name} — ${result.dry_run ? "preview" : "result"}`;

  const counts = {};
  for (const entry of result.entries) {
    counts[entry.status] = (counts[entry.status] || 0) + 1;
  }

  const parts = [];
  for (const status of ["moved", "planned", "skipped", "error"]) {
    if (counts[status]) {
      parts.push(`${counts[status]} ${STATUS_LABEL[status].toLowerCase()}`);
    }
  }
  statsSummary(result, counts, parts);

  resultsBody.innerHTML = "";
  for (const entry of result.entries) {
    const tr = document.createElement("tr");

    const tdStatus = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `badge ${entry.status}`;
    badge.textContent = STATUS_LABEL[entry.status] || entry.status;
    tdStatus.appendChild(badge);

    const tdSource = document.createElement("td");
    tdSource.className = "mono";
    tdSource.textContent = entry.source;

    const tdDest = document.createElement("td");
    if (entry.destination) {
      tdDest.className = "mono";
      tdDest.textContent = entry.destination;
    }

    const tdNote = document.createElement("td");
    tdNote.textContent = entry.reason || "";

    tr.append(tdStatus, tdSource, tdDest, tdNote);
    resultsBody.appendChild(tr);
  }

  resultsSection.hidden = false;
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function statsSummary(result, counts, parts) {
  let label;
  if (counts.error) {
    label = "finished with errors";
  } else if (result.dry_run) {
    label = "dry run — nothing changed";
  } else {
    label = "done";
  }
  const summary = parts.length ? `${parts.join(", ")}. ${label}.` : `No files matched. ${label}.`;
  resultsSummary.textContent = `Folder: ${result.folder || "—"} — ${summary}`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

async function init() {
  try {
    const res = await fetch("/api/tools");
    const data = await res.json();
    toolList.innerHTML = "";
    for (const tool of data.tools) {
      toolList.appendChild(renderTool(tool));
    }
  } catch (err) {
    toolList.innerHTML = `<p class="loading">Could not load tools: ${escapeHtml(err.message)}</p>`;
  }
}

// ------------------------------------------------------------------ //
// folder picker
// ------------------------------------------------------------------ //

const pickerModal = document.getElementById("picker-modal");
const pickerPath = document.getElementById("picker-path");
const pickerGo = document.getElementById("picker-go");
const pickerHome = document.getElementById("picker-home");
const pickerUp = document.getElementById("picker-up");
const pickerCrumbs = document.getElementById("picker-crumbs");
const pickerList = document.getElementById("picker-list");
const pickerStatus = document.getElementById("picker-status");
const pickerSelect = document.getElementById("picker-select");

let pickerTarget = null;
let currentBrowsePath = "";

async function browse(path) {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await fetch(`/api/browse${query}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Could not read folder (${res.status})`);
  return data;
}

function pickerMessage(text) {
  pickerStatus.textContent = text;
  pickerStatus.hidden = !text;
}

function renderPickerCrumbs(data) {
  pickerCrumbs.innerHTML = "";
  const segments = data.path === "/" ? [] : data.path.split("/").filter(Boolean);

  const root = document.createElement("button");
  root.type = "button";
  root.className = "crumb";
  root.textContent = "/";
  root.addEventListener("click", () => navigatePicker("/"));
  pickerCrumbs.appendChild(root);

  if (segments.length) pickerCrumbs.appendChild(separator());

  let acc = "";
  for (const segment of segments) {
    acc += "/" + segment;
    const crumb = document.createElement("button");
    crumb.type = "button";
    crumb.className = "crumb";
    crumb.textContent = segment;
    crumb.addEventListener("click", () => navigatePicker(acc));
    pickerCrumbs.appendChild(crumb);
    pickerCrumbs.appendChild(separator());
  }

  pickerCrumbs.querySelector("button:last-of-type")?.classList.add("current");
  if (pickerCrumbs.lastElementChild?.classList.contains("crumb-sep")) {
    pickerCrumbs.lastElementChild.remove();
  }
}

function separator() {
  const sep = document.createElement("span");
  sep.className = "crumb-sep";
  sep.textContent = "/";
  return sep;
}

function renderPickerList(data) {
  pickerList.innerHTML = "";
  if (data.entries.length === 0) {
    const li = document.createElement("li");
    li.className = "picker-empty";
    li.textContent = "(no subfolders)";
    pickerList.appendChild(li);
    return;
  }
  for (const name of data.entries) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-entry";
    btn.textContent = name;
    btn.title = "Open folder";
    btn.addEventListener("click", () => navigatePicker(`${data.path === "/" ? "" : data.path}/${name}`));
    li.appendChild(btn);
    pickerList.appendChild(li);
  }
}

async function navigatePicker(path) {
  pickerMessage("");
  try {
    const data = await browse(path);
    currentBrowsePath = data.path;
    pickerPath.value = data.path;
    pickerUp.disabled = !data.parent;
    renderPickerCrumbs(data);
    renderPickerList(data);
  } catch (err) {
    pickerMessage(err.message);
  }
}

function openFolderPicker(input) {
  pickerTarget = input;
  currentBrowsePath = "";
  pickerModal.hidden = false;
  navigatePicker(input.value || "~");
  pickerPath.focus();
}

function closeFolderPicker() {
  pickerModal.hidden = true;
  pickerTarget = null;
}

// wire-when-loaded event listeners

window.addEventListener("DOMContentLoaded", () => {
  pickerGo.addEventListener("click", () => navigatePicker(pickerPath.value.trim()));
  pickerPath.addEventListener("keydown", (e) => {
    if (e.key === "Enter") navigatePicker(pickerPath.value.trim());
  });
  pickerHome.addEventListener("click", () => navigatePicker("~"));
  pickerUp.addEventListener("click", async () => {
    try {
      const data = await browse(currentBrowsePath);
      if (data.parent) navigatePicker(data.parent);
    } catch (err) {
      pickerMessage(err.message);
    }
  });
  pickerSelect.addEventListener("click", () => {
    if (pickerTarget) pickerTarget.value = currentBrowsePath;
    closeFolderPicker();
  });
  document.getElementById("picker-close").addEventListener("click", closeFolderPicker);
  pickerModal.addEventListener("click", (e) => {
    if (e.target === pickerModal) closeFolderPicker();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pickerModal.hidden) closeFolderPicker();
  });
});

init();