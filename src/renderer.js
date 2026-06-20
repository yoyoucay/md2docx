const $ = (id) => document.getElementById(id);

const state = {
  files: [],        // [{ path, name, status }]
  outDir: null,
  template: null,
  toc: false
};

// --- engine status ---------------------------------------------------------
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

// --- file queue ------------------------------------------------------------
function addFiles(paths) {
  for (const p of paths) {
    if (!/\.(md|markdown|txt)$/i.test(p)) continue;
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
    li.innerHTML = `
      <span class="name" title="${f.path}">${f.name}</span>
      ${pathHint}${errHint}
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
  $("convert").disabled = state.files.length === 0;
}

function labelFor(s) {
  return { queued: "queued", working: "converting…", done: "done", failed: "failed" }[s] || s;
}

function friendlyError(err) {
  if (/permission denied/i.test(err)) return "file open in Word — close it and retry";
  if (/No such file or directory/i.test(err)) return "output folder not found";
  // First non-empty line of the error, truncated
  const line = err.split(/\r?\n/).find((l) => l.trim()) || err;
  return line.length > 80 ? line.slice(0, 77) + "…" : line;
}

// --- drag + drop -----------------------------------------------------------
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

// --- pickers ---------------------------------------------------------------
async function browse() {
  const paths = await window.api.pickMd();
  addFiles(paths);
}
$("browse").addEventListener("click", (e) => { e.stopPropagation(); browse(); });

$("pickOut").addEventListener("click", async () => {
  const d = await window.api.pickOutDir();
  if (d) { state.outDir = d; $("outdir").textContent = d; $("outdir").classList.remove("muted"); }
});

$("pickTmpl").addEventListener("click", async () => {
  const t = await window.api.pickTemplate();
  if (t) {
    state.template = t;
    $("tmpl").textContent = t.split(/[\\/]/).pop();
    $("tmpl").classList.remove("muted");
    $("clearTmpl").classList.remove("hidden");
  }
});
$("clearTmpl").addEventListener("click", () => {
  state.template = null;
  $("tmpl").textContent = "None — Word defaults";
  $("tmpl").classList.add("muted");
  $("clearTmpl").classList.add("hidden");
});

$("toc").addEventListener("change", (e) => { state.toc = e.target.checked; });

// --- convert ---------------------------------------------------------------
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
      toc: state.toc
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
