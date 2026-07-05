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
  outDir: null,
  template: null,
  toc: false,
  direction: "md2docx"
};

// --- Persistent settings ---------------------------------------------------
const SETTINGS_KEY = "md2docx:settings";

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    outDir: state.outDir,
    template: state.template,
    toc: state.toc,
    direction: state.direction,
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
    if (s.template) {
      state.template = s.template;
      $("tmpl").textContent = s.template.split(/[\\/]/).pop();
      $("tmpl").classList.remove("muted");
      $("clearTmpl").classList.remove("hidden");
    }
    if (s.toc) {
      state.toc = true;
      $("toc").checked = true;
    }
    if (s.direction) applyDirection(s.direction, false);
  } catch (_) {}
  scheduleResize();
})();

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
  } else if (dupes && !rejected) {
    status.textContent = "already added";
  } else if (rejected) {
    status.textContent = `unsupported file type — expected ${state.direction === "md2docx" ? ".md/.markdown/.txt" : ".docx"}`;
  }
}

function render() {
  const ul = $("files");
  ul.innerHTML = "";
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

$("pickTmpl").addEventListener("click", async () => {
  const t = await window.api.pickTemplate();
  if (t) {
    state.template = t;
    $("tmpl").textContent = t.split(/[\\/]/).pop();
    $("tmpl").classList.remove("muted");
    $("clearTmpl").classList.remove("hidden");
    saveSettings();
  }
});
$("clearTmpl").addEventListener("click", () => {
  state.template = null;
  $("tmpl").textContent = "Default (bundled)";
  $("tmpl").classList.add("muted");
  $("clearTmpl").classList.add("hidden");
  saveSettings();
});

$("toc").addEventListener("change", (e) => {
  state.toc = e.target.checked;
  saveSettings();
});

// --- Convert ---------------------------------------------------------------
$("convert").addEventListener("click", async () => {
  const btn = $("convert");
  const status = $("status");
  btn.disabled = true;

  let done = 0, failed = 0;
  for (const f of state.files) {
    if (f.status === "done") continue;
    f.status = "working"; render();

    const r = await window.api.convertOne({
      input: f.path,
      outDir: state.outDir,
      template: state.template,
      toc: state.toc,
      direction: state.direction
    });

    if (r.ok) { f.status = "done"; f.output = r.output; done++; }
    else { f.status = "failed"; f.error = r.error; failed++; }
    render();
  }

  status.textContent = `${done} converted` + (failed ? `, ${failed} failed` : "");

  // Show output paths briefly, then remove succeeded files.
  setTimeout(() => {
    state.files = state.files.filter((f) => f.status !== "done");
    render();
    btn.disabled = state.files.length === 0;
  }, 2000);
});
