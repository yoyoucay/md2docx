const $ = (id) => document.getElementById(id);

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
})();

// --- Direction toggle -------------------------------------------------------
function applyDirection(dir, save = true) {
  state.direction = dir;
  state.files = [];

  document.querySelectorAll(".dir-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.dir === dir)
  );

  const isMd2Docx = dir === "md2docx";
  $("dropTitle").textContent = isMd2Docx ? "Drop Markdown files here" : "Drop Word documents here";
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
  for (const p of paths) {
    if (!pattern.test(p)) continue;
    if (state.files.some((f) => f.path === p)) continue;
    state.files.push({ path: p, name: p.split(/[\\/]/).pop(), status: "queued" });
  }
  render();
}

function render() {
  const ul = $("files");
  ul.innerHTML = "";
  for (const f of state.files) {
    const li = document.createElement("li");
    li.className = "file";
    const stateClass = f.status === "done" ? "ok" : f.status === "failed" ? "err" : "";
    const pathHint = f.status === "done" && f.output
      ? `<span class="out-path" title="${f.output}">→ ${f.output}</span>`
      : "";
    const errHint = f.status === "failed" && f.error
      ? `<span class="err-msg" title="${f.error.replace(/"/g, "&quot;")}">${friendlyError(f.error)}</span>`
      : "";
    const retryBtn = f.status === "failed"
      ? `<button class="retry" title="Retry this file" data-p="${f.path}">↺</button>`
      : "";
    li.innerHTML = `
      <span class="name" title="${f.path}">${f.name}</span>
      ${pathHint}${errHint}
      ${retryBtn}
      <span class="state ${stateClass}">${labelFor(f.status)}</span>
      <button class="x" title="Remove" data-p="${f.path}">×</button>`;
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
}

function labelFor(s) {
  return { queued: "queued", working: "converting…", done: "done", failed: "failed" }[s] || s;
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
drop.addEventListener("drop", (e) => {
  const paths = [...e.dataTransfer.files].map((f) => f.path);
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
