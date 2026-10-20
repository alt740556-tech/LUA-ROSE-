const API = "";

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function $(id) { return document.getElementById(id); }

function copy(text) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  });
}

// Tabs
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "scripts") loadScripts();
    if (btn.dataset.tab === "keys") loadKeys();
  });
});

// Status
async function checkStatus() {
  try {
    const s = await api("/api/status");
    const badge = $("statusBadge");
    badge.textContent = `Online • ${s.keys} keys • ${s.scripts} scripts`;
    badge.className = "status ok";
  } catch {
    $("statusBadge").textContent = "Server offline";
    $("statusBadge").className = "status err";
  }
}

// ---------- Scripts ----------
async function loadScripts() {
  const scripts = await api("/api/scripts");
  const tbody = $("scriptsBody");
  const empty = $("scriptsEmpty");
  tbody.innerHTML = "";

  if (!scripts.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  const host = window.location.origin;

  scripts.forEach((s) => {
    const tr = document.createElement("tr");
    const date = new Date(s.created).toLocaleDateString();
    const typeBadge = s.type === "public"
      ? `<span class="badge public">Public</span>`
      : `<span class="badge protected">Protected</span>`;

    tr.innerHTML = `
      <td>${s.name}</td>
      <td>${typeBadge}</td>
      <td>${date}</td>
      <td><button class="btn small" data-loader="${s.id}" data-type="${s.type}">Get Loader</button></td>
      <td><button class="btn small danger" data-del="${s.id}">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-loader]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.loader;
      const type = btn.dataset.type;
      let code;
      if (type === "public") {
        code = `loadstring(game:HttpGet("${host}/loader/public/${id}"))()`;
      } else {
        code = `_G.script_key = "PASTE_KEY_HERE"
loadstring(game:HttpGet("${host}/loader/protected/${id}"))()`;
      }
      $("modalTitle").textContent = type === "public" ? "Public Loader" : "Protected Loader";
      $("modalCode").textContent = code;
      $("loaderModal").classList.remove("hidden");
    });
  });

  tbody.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this script and its file?")) return;
      await api("/api/scripts/" + btn.dataset.del, { method: "DELETE" });
      loadScripts();
      loadKeys(); // keys linked to it may be removed
    });
  });

  // refresh key script dropdown
  const sel = $("keyScriptId");
  const current = sel.value;
  sel.innerHTML = `<option value="">— none —</option>`;
  scripts.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
  sel.value = current;
}

$("showAddScript").addEventListener("click", () => {
  $("addScriptForm").classList.toggle("hidden");
});
$("cancelScriptBtn").addEventListener("click", () => {
  $("addScriptForm").classList.add("hidden");
});

$("saveScriptBtn").addEventListener("click", async () => {
  const name = $("scriptName").value.trim();
  const source = $("scriptSource").value.trim();
  const type = $("scriptType").value;
  if (!name || !source) {
    alert("Name and source are required");
    return;
  }
  await api("/api/scripts", {
    method: "POST",
    body: JSON.stringify({ name, source, type }),
  });
  $("scriptName").value = "";
  $("scriptSource").value = "";
  $("addScriptForm").classList.add("hidden");
  loadScripts();
});

// ---------- Keys ----------
async function loadKeys() {
  const keys = await api("/api/keys");
  const tbody = $("keysBody");
  const empty = $("keysEmpty");
  tbody.innerHTML = "";

  if (!keys.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  keys.forEach((k) => {
    const tr = document.createElement("tr");
    const hwidBadge = k.hwid
      ? `<span class="badge bound">Bound</span>`
      : `<span class="badge free">Not bound</span>`;
    const statusBadge = k.enabled
      ? `<span class="badge bound">Active</span>`
      : `<span class="badge off">Disabled</span>`;

    tr.innerHTML = `
      <td><code>${k.key}</code></td>
      <td>${k.name || "—"}</td>
      <td>${hwidBadge}</td>
      <td>${k.uses || 0}</td>
      <td>${statusBadge}</td>
      <td class="actions-cell">
        <button class="btn small success" data-reset="${k.id}">Reset HWID</button>
        <button class="btn small" data-copy="${k.key}">Copy</button>
        <button class="btn small" data-toggle="${k.id}">${k.enabled ? "Disable" : "Enable"}</button>
        <button class="btn small danger" data-delkey="${k.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/keys/" + btn.dataset.reset + "/reset-hwid", { method: "POST" });
      loadKeys();
      alert("HWID reset. Next device that uses this key will bind to it.");
    });
  });

  tbody.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      copy(btn.dataset.copy);
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1200);
    });
  });

  tbody.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/keys/" + btn.dataset.toggle + "/toggle", { method: "POST" });
      loadKeys();
    });
  });

  tbody.querySelectorAll("[data-delkey]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this key?")) return;
      await api("/api/keys/" + btn.dataset.delkey, { method: "DELETE" });
      loadKeys();
    });
  });
}

$("showAddKey").addEventListener("click", () => {
  $("addKeyForm").classList.toggle("hidden");
});
$("cancelKeyBtn").addEventListener("click", () => {
  $("addKeyForm").classList.add("hidden");
});

$("createKeyBtn").addEventListener("click", async () => {
  const name = $("keyName").value.trim() || "Unnamed";
  const prefix = $("keyPrefix").value.trim() || "KEY";
  const scriptId = $("keyScriptId").value || null;

  const key = await api("/api/keys", {
    method: "POST",
    body: JSON.stringify({ name, prefix, scriptId }),
  });

  $("keyName").value = "";
  $("addKeyForm").classList.add("hidden");
  loadKeys();
  alert("Key created:\n\n" + key.key + "\n\nCopied to clipboard.");
  copy(key.key);
});

// Modal
$("closeModal").addEventListener("click", () => {
  $("loaderModal").classList.add("hidden");
});
$("copyModalBtn").addEventListener("click", () => {
  copy($("modalCode").textContent);
  $("copyModalBtn").textContent = "Copied!";
  setTimeout(() => ($("copyModalBtn").textContent = "Copy Loader"), 1500);
});
$("loaderModal").addEventListener("click", (e) => {
  if (e.target === $("loaderModal")) $("loaderModal").classList.add("hidden");
});

// Init
checkStatus();
loadScripts();
loadKeys();
setInterval(checkStatus, 15000);
