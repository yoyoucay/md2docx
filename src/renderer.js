const $ = (id) => document.getElementById(id);

// --- Auto-resize window to fit content --------------------------------------
// Measures the true desired height by summing .main's visible children.
// (main.scrollHeight is useless here: on a flex:1 scroll container it is
// floored at the current viewport height, so it can never shrink and lies
// while growing.)
function desiredHeight() {
  const topbar = document.querySelector(".topbar");
  const main = document.querySelector(".main");
  const footer = document.querySelector(".actionbar");
  const cs = getComputedStyle(main);
  const gap = parseFloat(cs.rowGap) || 0;

  let content = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  let visible = 0;
  for (const el of main.children) {
    const h = el.getBoundingClientRect().height;
    if (h === 0) continue; // hidden (.files:empty, .hidden sections)
    if (visible > 0) content += gap;
    content += h;
    visible++;
  }
  return Math.ceil(topbar.offsetHeight + content + footer.offsetHeight);
}

let resizeScheduled = false;
function scheduleResize() {
  if (resizeScheduled) return;
  resizeScheduled = true;
  requestAnimationFrame(() => {
    resizeScheduled = false;
    if (!window.api || !window.api.resizeWindow) return;
    window.api.resizeWindow(desiredHeight());
  });
}

// Catch anything that changes layout outside render() (font load, text wrap,
// file rows gaining error/output lines). Observed elements size to content.
const _ro = new ResizeObserver(scheduleResize);
for (const sel of ["#files", ".settings", ".dropzone", ".topbar", ".actionbar"]) {
  const el = document.querySelector(sel);
  if (el) _ro.observe(el);
}

const state = {
  files: [],
  expanded: false,
  outDir: null,
  template: null,      // currently selected template path (null = bundled default)
  templates: [],       // saved [{ name, path }]
  toc: false,
  direction: "md2docx",
  collision: "rename",
  autoConvert: false,
  watchDir: null,
  extraArgs: "",
  recent: []           // [{ name, path, time }]
};

// --- Persistent settings ---------------------------------------------------
const SETTINGS_KEY = "md2docx:settings";

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    outDir: state.outDir,
    template: state.template,
    templates: state.templates,
    toc: state.toc,
    direction: state.direction,
    collision: state.collision,
    autoConvert: state.autoConvert,
    watchDir: state.watchDir,
    extraArgs: state.extraArgs,
    recent: state.recent,
  }));
}

(function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (s.outDir) {
      state.outDir = s.outDir;
      $("outdir").textContent = s.outDir;
      $("outdir").classList.remove("muted");
    }
    if (Array.isArray(s.templates)) state.templates = s.templates.filter((t) => t && t.path);
    // Migrate old single-template setting into the list.
    if (s.template && !state.templates.some((t) => t.path === s.template)) {
      state.templates.push({ name: s.template.split(/[\\/]/).pop(), path: s.template });
    }
    if (s.template) state.template = s.template;
    if (s.toc) { state.toc = true; $("toc").checked = true; }
    if (s.collision) { state.collision = s.collision; $("collision").value = s.collision; }
    if (s.autoConvert) { state.autoConvert = true; $("autoConvert").checked = true; }
    if (s.watchDir) state.watchDir = s.watchDir;
    if (typeof s.extraArgs === "string") { state.extraArgs = s.extraArgs; $("extraArgs").value = s.extraArgs; }
    if (Array.isArray(s.recent)) state.recent = s.recent.slice(0, 10);
    if (s.direction) applyDirection(s.direction, false);
  } catch (_) {}

  renderTemplates();
  renderRecent();
  validateSavedPaths();
  scheduleResize();
})();

// --- Stale-path validation: drop settings pointing at moved/deleted files ----
async function validateSavedPaths() {
  const problems = [];

  if (state.outDir && !(await window.api.pathExists(state.outDir))) {
    problems.push("output folder");
    state.outDir = null;
    $("outdir").textContent = "Same as each source file";
    $("outdir").classList.add("muted");
  }

  const missingTmpls = [];
  for (const t of state.templates) {
    if (!(await window.api.pathExists(t.path))) missingTmpls.push(t.path);
  }
  if (missingTmpls.length) {
    problems.push("style template");
    state.templates = state.templates.filter((t) => !missingTmpls.includes(t.path));
    if (missingTmpls.includes(state.template)) state.template = null;
    renderTemplates();
  }

  if (state.watchDir && !(await window.api.pathExists(state.watchDir))) {
    problems.push("watch folder");
    state.watchDir = null;
  }

  if (problems.length) {
    $("status").textContent = `saved ${problems.join(", ")} no longer exists — reset to default`;
    saveSettings();
  }

  applyWatchUI();
  if (state.watchDir) startWatch();
}

// --- Direction toggle -------------------------------------------------------
function applyDirection(dir, save = true) {
  state.direction = dir;
  state.files = [];

  document.querySelectorAll(".dir-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.dir === dir)
  );

  const isMd2Docx = dir === "md2docx";
  $("dropTitle").textContent = isMd2Docx ? "Drop Markdown files or folders here" : "Drop Word documents or folders here";
  $("dropFormats").textContent = isMd2Docx ? ".md · .markdown · .txt" : ".docx";
  $("drop").setAttribute("aria-label", $("dropTitle").textContent);

  ["sepTmpl", "settingTmpl", "sepToc", "settingToc"].forEach(id =>
    $(id).classList.toggle("hidden", !isMd2Docx)
  );

  if (state.watchDir) startWatch(); // re-arm watcher with the new extensions

  render();
  if (save) saveSettings();
}

document.querySelectorAll(".dir-btn").forEach(b =>
  b.addEventListener("click", () => applyDirection(b.dataset.dir))
);

// --- Engine status ---------------------------------------------------------
(async function checkEngine() {
  const el = $("pandoc");
  const r = await window.api.pandocCheck();
  if (r.ok) {
    el.textContent = r.version || "Pandoc ready";
    el.classList.add("ok");
  } else {
    el.textContent = "Pandoc not found";
    el.classList.add("bad");
  }
})();

// --- File queue ------------------------------------------------------------
function addFiles(paths) {
  const pattern = state.direction === "md2docx"
    ? /\.(md|markdown|txt)$/i
    : /\.docx$/i;
  let added = 0, dupes = 0, rejected = 0;
  for (const p of paths) {
    if (!pattern.test(p)) { rejected++; continue; }
    if (state.files.some((f) => f.path === p)) { dupes++; continue; }
    state.files.push({ path: p, name: p.split(/[\\/]/).pop(), status: "queued" });
    added++;
  }
  render();

  const status = $("status");
  if (added) {
    status.textContent = `${added} file${added > 1 ? "s" : ""} added`;
    if (state.autoConvert && !converting) convertAll();
  } else if (dupes && !rejected) {
    status.textContent = "already added";
  } else if (rejected) {
    status.textContent = `unsupported file type — expected ${state.direction === "md2docx" ? ".md/.markdown/.txt" : ".docx"}`;
  }
}

const FOLDERS_ICON = `
  <svg class="file-group-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M7 7V5a2 2 0 0 1 2-2h4l2 2h5a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.45"/>
    <path d="M3 9a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

function renderGroupRow(ul) {
  const total = state.files.length;
  const names = state.files.map((f) => f.name).join(", ");
  const done = state.files.filter((f) => f.status === "done").length;
  const failed = state.files.filter((f) => f.status === "failed").length;
  const working = state.files.some((f) => f.status === "working");

  let label = `${total} queued`, stateClass = "";
  if (working || (done + failed > 0 && done + failed < total)) {
    label = `converting ${done + failed}/${total}`;
  } else if (done + failed === total && total > 0) {
    if (failed) { label = `${failed} failed`; stateClass = "err"; }
    else { label = "done"; stateClass = "ok"; }
  }

  const retryBtn = failed
    ? `<button class="retry" title="Retry failed files">↺</button>`
    : "";

  const nameContent = state.expanded ? `${total} files` : esc(names);
  const li = document.createElement("li");
  li.className = "file";
  li.innerHTML = `
    ${FOLDERS_ICON}
    <span class="name group-name" title="${state.expanded ? "Click to collapse" : "Click to show all files"}">${nameContent} <span class="caret">${state.expanded ? "▴" : "▾"}</span></span>
    ${retryBtn}
    <span class="state ${stateClass}">${label}</span>
    <button class="x" title="Remove all">×</button>`;
  ul.appendChild(li);

  li.querySelector(".group-name").addEventListener("click", () => {
    state.expanded = !state.expanded;
    render();
  });

  li.querySelector(".x").addEventListener("click", () => {
    state.files = [];
    state.expanded = false;
    render();
  });
  const retry = li.querySelector(".retry");
  if (retry) retry.addEventListener("click", () => {
    for (const f of state.files) {
      if (f.status === "failed") { f.status = "queued"; f.error = null; f.output = null; }
    }
    render();
  });
}

function renderSingleRows(ul) {
  for (const f of state.files) {
    const li = document.createElement("li");
    li.className = "file";
    const stateClass = f.status === "done" ? "ok" : f.status === "failed" ? "err" : "";
    const pathHint = f.status === "done" && f.output
      ? `<span class="out-path" title="${esc(f.output)}">→ ${esc(f.output)}</span>`
      : "";
    const errHint = f.status === "failed" && f.error
      ? `<span class="err-msg" title="${esc(f.error)}">${esc(friendlyError(f.error))}</span>`
      : "";
    const retryBtn = f.status === "failed"
      ? `<button class="retry" title="Retry this file" data-p="${esc(f.path)}">↺</button>`
      : "";
    li.innerHTML = `
      <span class="name" title="${esc(f.path)}">${esc(f.name)}</span>
      ${pathHint}${errHint}
      ${retryBtn}
      <span class="state ${stateClass}">${labelFor(f.status)}</span>
      <button class="x" title="Remove" data-p="${esc(f.path)}">×</button>`;
    ul.appendChild(li);
  }

  ul.querySelectorAll(".x").forEach((b) =>
    b.addEventListener("click", () => {
      state.files = state.files.filter((f) => f.path !== b.dataset.p);
      render();
    })
  );

  ul.querySelectorAll(".retry").forEach((b) =>
    b.addEventListener("click", () => {
      const f = state.files.find((f) => f.path === b.dataset.p);
      if (f) { f.status = "queued"; f.error = null; f.output = null; render(); }
      $("convert").disabled = false;
    })
  );

  ul.querySelectorAll(".out-path").forEach((span) =>
    span.addEventListener("click", (e) => {
      e.stopPropagation();
      window.api.openFile(span.title);
    })
  );
}

function render() {
  const ul = $("files");
  ul.innerHTML = "";
  const multi = state.files.length >= 2;

  if (multi) {
    renderGroupRow(ul);
    if (state.expanded) renderSingleRows(ul);
  } else {
    renderSingleRows(ul);
  }

  $("dropIconSingle").classList.toggle("hidden", multi);
  $("dropIconMulti").classList.toggle("hidden", !multi);

  $("convert").disabled = state.files.length === 0;
  scheduleResize();
}

function labelFor(s) {
  return { queued: "queued", working: "converting…", done: "done", failed: "failed" }[s] || s;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function friendlyError(err) {
  if (/permission denied/i.test(err)) return "file open in Word — close it and retry";
  if (/No such file or directory/i.test(err)) return "output folder not found";
  const line = err.split(/\r?\n/).find((l) => l.trim()) || err;
  return line.length > 80 ? line.slice(0, 77) + "…" : line;
}

// --- Drag + drop -----------------------------------------------------------
const drop = $("drop");
["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); })
);
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); })
);
drop.addEventListener("drop", async (e) => {
  const raw = [...e.dataTransfer.files].map((f) => window.api.getPathForFile(f));
  if (!raw.length) return;
  const exts = state.direction === "md2docx" ? [".md", ".markdown", ".txt"] : [".docx"];
  const paths = await window.api.expandPaths(raw, exts);
  if (!paths.length) {
    $("status").textContent = `no matching files — expected ${exts.join("/")}`;
    return;
  }
  addFiles(paths);
});
drop.addEventListener("click", browse);
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") browse(); });

// --- Pickers ---------------------------------------------------------------
async function browse() {
  const paths = state.direction === "md2docx"
    ? await window.api.pickMd()
    : await window.api.pickDocx();
  addFiles(paths);
}
$("browse").addEventListener("click", (e) => { e.stopPropagation(); browse(); });

$("pickOut").addEventListener("click", async () => {
  const d = await window.api.pickOutDir();
  if (d) {
    state.outDir = d;
    $("outdir").textContent = d;
    $("outdir").classList.remove("muted");
    saveSettings();
  }
});

// --- Template manager --------------------------------------------------------
function renderTemplates() {
  const sel = $("tmplSelect");
  sel.innerHTML = `<option value="">Default (bundled)</option>`;
  for (const t of state.templates) {
    const opt = document.createElement("option");
    opt.value = t.path;
    opt.textContent = t.name;
    sel.appendChild(opt);
  }
  sel.value = state.template || "";
  if (sel.value !== (state.template || "")) { state.template = null; sel.value = ""; }
  $("rmTmpl").classList.toggle("hidden", !state.template);
  $("tmpl").textContent = state.template || "Default (bundled)";
  $("tmpl").classList.toggle("muted", !state.template);
}

$("tmplSelect").addEventListener("change", () => {
  state.template = $("tmplSelect").value || null;
  renderTemplates();
  saveSettings();
});

$("pickTmpl").addEventListener("click", async () => {
  const t = await window.api.pickTemplate();
  if (!t) return;
  if (!state.templates.some((x) => x.path === t)) {
    state.templates.push({ name: t.split(/[\\/]/).pop(), path: t });
  }
  state.template = t;
  renderTemplates();
  saveSettings();
});

$("rmTmpl").addEventListener("click", () => {
  state.templates = state.templates.filter((t) => t.path !== state.template);
  state.template = null;
  renderTemplates();
  saveSettings();
});

$("toc").addEventListener("change", (e) => {
  state.toc = e.target.checked;
  saveSettings();
});

$("collision").addEventListener("change", (e) => {
  state.collision = e.target.value;
  saveSettings();
});

$("autoConvert").addEventListener("change", (e) => {
  state.autoConvert = e.target.checked;
  saveSettings();
});

$("extraArgs").addEventListener("change", (e) => {
  state.extraArgs = e.target.value.trim();
  saveSettings();
});

// Split extra args respecting double quotes: --metadata "title=My Doc"
function parseExtraArgs(s) {
  if (!s) return [];
  return (s.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map((a) => a.replace(/^"|"$/g, ""));
}

// --- Watch folder --------------------------------------------------------------
function watchExts() {
  return state.direction === "md2docx" ? [".md", ".markdown", ".txt"] : [".docx"];
}

function applyWatchUI() {
  $("watchDir").textContent = state.watchDir || "Off";
  $("watchDir").classList.toggle("muted", !state.watchDir);
  $("clearWatch").classList.toggle("hidden", !state.watchDir);
}

async function startWatch() {
  if (!state.watchDir) return;
  const ok = await window.api.watchStart(state.watchDir, watchExts());
  if (!ok) {
    $("status").textContent = "watch folder failed to start";
    state.watchDir = null;
    applyWatchUI();
    saveSettings();
  }
}

$("pickWatch").addEventListener("click", async () => {
  const d = await window.api.pickOutDir();
  if (!d) return;
  state.watchDir = d;
  applyWatchUI();
  saveSettings();
  startWatch();
});

$("clearWatch").addEventListener("click", async () => {
  state.watchDir = null;
  await window.api.watchStop();
  applyWatchUI();
  saveSettings();
});

window.api.onWatchFile((p) => {
  addFiles([p]);
  if (!converting) convertAll();
});

// --- Recent outputs -------------------------------------------------------------
function renderRecent() {
  const card = $("recentCard");
  const ul = $("recentList");
  ul.innerHTML = "";
  card.classList.toggle("hidden", state.recent.length === 0);
  for (const r of state.recent) {
    const li = document.createElement("li");
    li.className = "recent-item";
    li.innerHTML = `<span class="r-name">${esc(r.name)}</span><span class="r-path">${esc(r.path)}</span>`;
    li.title = "Open " + r.path;
    li.addEventListener("click", () => window.api.openFile(r.path));
    ul.appendChild(li);
  }
  scheduleResize();
}

function addRecent(outPath) {
  state.recent = state.recent.filter((r) => r.path !== outPath);
  state.recent.unshift({ name: outPath.split(/[\\/]/).pop(), path: outPath, time: Date.now() });
  state.recent = state.recent.slice(0, 10);
  renderRecent();
  saveSettings();
}

$("clearRecent").addEventListener("click", () => {
  state.recent = [];
  renderRecent();
  saveSettings();
});

// --- About dialog ------------------------------------------------------------
$("aboutBtn").addEventListener("click", async () => {
  $("aboutOverlay").classList.remove("hidden");
  try {
    const info = await window.api.appInfo();
    $("aboutVersion").textContent = `v${info.version}`;
    $("aboutMeta").textContent = `MIT License · Pandoc · Electron ${info.electron}`;
  } catch (_) {}
});
$("aboutClose").addEventListener("click", () => $("aboutOverlay").classList.add("hidden"));
$("aboutOverlay").addEventListener("click", (e) => {
  if (e.target === $("aboutOverlay")) $("aboutOverlay").classList.add("hidden");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("aboutOverlay").classList.add("hidden");
});
$("aboutMail").addEventListener("click", (e) => {
  e.preventDefault();
  window.api.openUrl("mailto:febrianaarif7@gmail.com");
});

// --- Convert (parallel pool + cancel) ----------------------------------------
const CONCURRENCY = 3;
let converting = false;
let cancelRequested = false;
let jobSeq = 0;

function setConvertButton() {
  const btn = $("convert");
  if (converting) {
    btn.textContent = "Cancel";
    btn.classList.add("cancelling-available");
    btn.disabled = false;
  } else {
    btn.textContent = "Convert";
    btn.classList.remove("cancelling-available");
    btn.disabled = state.files.length === 0;
  }
}

async function convertAll() {
  if (converting) return;
  const pending = state.files.filter((f) => f.status !== "done");
  if (!pending.length) return;

  converting = true;
  cancelRequested = false;
  setConvertButton();

  const queue = [...pending];
  let done = 0, failed = 0;

  const worker = async () => {
    while (queue.length && !cancelRequested) {
      const f = queue.shift();
      f.status = "working";
      render(); setConvertButton();

      const r = await window.api.convertOne({
        input: f.path,
        outDir: state.outDir,
        template: state.template,
        toc: state.toc,
        direction: state.direction,
        collision: state.collision,
        extraArgs: parseExtraArgs(state.extraArgs),
        jobId: ++jobSeq
      });

      if (r.ok) { f.status = "done"; f.output = r.output; done++; addRecent(r.output); }
      else if (r.cancelled) { f.status = "queued"; }
      else { f.status = "failed"; f.error = r.error; failed++; }
      render(); setConvertButton();
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  converting = false;
  setConvertButton();

  $("status").textContent = cancelRequested
    ? `cancelled — ${done} converted` + (failed ? `, ${failed} failed` : "")
    : `${done} converted` + (failed ? `, ${failed} failed` : "");

  // Show output paths briefly, then remove succeeded files.
  setTimeout(() => {
    state.files = state.files.filter((f) => f.status !== "done");
    render();
    setConvertButton();
  }, 2000);
}

$("convert").addEventListener("click", () => {
  if (converting) {
    cancelRequested = true;
    window.api.cancelAll();
    $("status").textContent = "cancelling…";
  } else {
    convertAll();
  }
});
