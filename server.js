const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "keys.json");
const SCRIPTS_DIR = path.join(__dirname, "data", "scripts");

// Ensure folders exist
if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"));
}
if (!fs.existsSync(SCRIPTS_DIR)) {
  fs.mkdirSync(SCRIPTS_DIR);
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ keys: [], scripts: [] }, null, 2));
}

app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------- Data helpers ----------
function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { keys: [], scripts: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function generateKey(prefix = "KEY") {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let part = "";
  for (let i = 0; i < 12; i++) {
    part += chars[Math.floor(Math.random() * chars.length)];
  }
  const p = String(prefix).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "KEY";
  return `${p}-${part.slice(0, 4)}-${part.slice(4, 8)}-${part.slice(8, 12)}`;
}

// ---------- API ----------

// List all keys
app.get("/api/keys", (req, res) => {
  const data = readData();
  res.json(data.keys);
});

// Create a new key (optionally linked to a script)
app.post("/api/keys", (req, res) => {
  const { name, prefix, scriptId, maxDevices = 1 } = req.body;
  const data = readData();

  const key = {
    id: uuidv4(),
    key: generateKey(prefix || "KEY"),
    name: name || "Unnamed",
    scriptId: scriptId || null,
    hwid: null,           // single device for now
    hwids: [],            // reserved for multi-device later
    maxDevices: Math.max(1, parseInt(maxDevices) || 1),
    created: new Date().toISOString(),
    lastUsed: null,
    uses: 0,
    enabled: true,
  };

  data.keys.unshift(key);
  writeData(data);
  res.json(key);
});

// Reset HWID for a key
app.post("/api/keys/:id/reset-hwid", (req, res) => {
  const data = readData();
  const key = data.keys.find((k) => k.id === req.params.id);
  if (!key) return res.status(404).json({ error: "Key not found" });

  key.hwid = null;
  key.hwids = [];
  writeData(data);
  res.json({ success: true, key });
});

// Delete a key
app.delete("/api/keys/:id", (req, res) => {
  const data = readData();
  const idx = data.keys.findIndex((k) => k.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Key not found" });

  data.keys.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

// Toggle enable/disable
app.post("/api/keys/:id/toggle", (req, res) => {
  const data = readData();
  const key = data.keys.find((k) => k.id === req.params.id);
  if (!key) return res.status(404).json({ error: "Key not found" });

  key.enabled = !key.enabled;
  writeData(data);
  res.json(key);
});

// ---------- Scripts ----------
app.get("/api/scripts", (req, res) => {
  const data = readData();
  res.json(data.scripts);
});

app.post("/api/scripts", (req, res) => {
  const { name, source, type = "protected" } = req.body; // type: public | protected
  if (!name || !source) {
    return res.status(400).json({ error: "name and source required" });
  }

  const data = readData();
  const id = uuidv4();
  const filename = `${id}.lua`;
  const filepath = path.join(SCRIPTS_DIR, filename);

  fs.writeFileSync(filepath, source);

  const script = {
    id,
    name,
    type, // "public" or "protected"
    filename,
    created: new Date().toISOString(),
  };

  data.scripts.unshift(script);
  writeData(data);
  res.json(script);
});

app.delete("/api/scripts/:id", (req, res) => {
  const data = readData();
  const idx = data.scripts.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Script not found" });

  const script = data.scripts[idx];
  const filepath = path.join(SCRIPTS_DIR, script.filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

  data.scripts.splice(idx, 1);
  // also remove keys linked to this script (optional)
  data.keys = data.keys.filter((k) => k.scriptId !== script.id);
  writeData(data);
  res.json({ success: true });
});

// ---------- Core validation endpoint used by the Lua loader ----------
// POST /api/validate
// body: { key: "KEY-XXXX-....", hwid: "...." }
app.post("/api/validate", (req, res) => {
  const { key: keyStr, hwid } = req.body;
  if (!keyStr || !hwid) {
    return res.status(400).json({ success: false, message: "Missing key or hwid" });
  }

  const data = readData();
  const key = data.keys.find((k) => k.key === keyStr);

  if (!key) {
    return res.json({ success: false, message: "Invalid key" });
  }
  if (!key.enabled) {
    return res.json({ success: false, message: "Key is disabled" });
  }

  // First use → bind HWID
  if (!key.hwid) {
    key.hwid = hwid;
    key.hwids = [hwid];
    key.lastUsed = new Date().toISOString();
    key.uses = (key.uses || 0) + 1;
    writeData(data);
    return res.json({ success: true, message: "Key activated and locked to this device", firstBind: true });
  }

  // Already bound
  if (key.hwid === hwid || (key.hwids && key.hwids.includes(hwid))) {
    key.lastUsed = new Date().toISOString();
    key.uses = (key.uses || 0) + 1;
    writeData(data);
    return res.json({ success: true, message: "Authorized" });
  }

  // HWID mismatch
  return res.json({
    success: false,
    message: "This key is locked to another device. Ask the owner to reset HWID.",
  });
});

// ---------- Loader generator endpoints ----------

// Public loader (no key)
app.get("/loader/public/:scriptId", (req, res) => {
  const data = readData();
  const script = data.scripts.find((s) => s.id === req.params.scriptId);
  if (!script) return res.status(404).send("-- Script not found");

  const filepath = path.join(SCRIPTS_DIR, script.filename);
  if (!fs.existsSync(filepath)) return res.status(404).send("-- Script file missing");

  const source = fs.readFileSync(filepath, "utf8");
  const host = req.protocol + "://" + req.get("host");

  const loader = `--[[
  ${script.name}
  Public Loader
]]

${source}
`;
  res.type("text/plain").send(loader);
});

// Protected loader (requires key)
// User runs: 
//   _G.script_key = "KEY-XXXX"
//   loadstring(game:HttpGet("http://YOUR_IP:3000/loader/protected/SCRIPT_ID"))()
app.get("/loader/protected/:scriptId", (req, res) => {
  const data = readData();
  const script = data.scripts.find((s) => s.id === req.params.scriptId);
  if (!script) return res.status(404).send("-- Script not found");

  const filepath = path.join(SCRIPTS_DIR, script.filename);
  if (!fs.existsSync(filepath)) return res.status(404).send("-- Script file missing");

  const source = fs.readFileSync(filepath, "utf8");
  const host = req.protocol + "://" + req.get("host");

  // The loader that checks key + HWID against this server
  const loader = `--[[
  ${script.name}
  Protected Loader (Key + HWID)
  Generated by Lua Key System
]]

local SCRIPT_ID = "${script.id}"
local API_URL = "${host}/api/validate"

-- Get key from environment
local function getKey()
    if _G.script_key and type(_G.script_key) == "string" and _G.script_key ~= "" then
        return _G.script_key
    end
    if getgenv and getgenv().script_key then
        return getgenv().script_key
    end
    return nil
end

local key = getKey()
if not key then
    warn("[Loader] No key provided. Set _G.script_key = \\"YOUR-KEY\\" before running.")
    return
end

-- Build HWID
local function getHWID()
    local parts = {}
    pcall(function()
        local a = game:GetService("RbxAnalyticsService")
        table.insert(parts, a:GetClientId())
    end)
    pcall(function()
        if game.Players.LocalPlayer then
            table.insert(parts, tostring(game.Players.LocalPlayer.UserId))
        end
    end)
    pcall(function()
        table.insert(parts, tostring(game.PlaceId))
    end)
    return table.concat(parts, "|")
end

local hwid = getHWID()

-- Validate against server
local HttpService = game:GetService("HttpService")
local success, result = pcall(function()
    return game:HttpPost(
        API_URL,
        HttpService:JSONEncode({ key = key, hwid = hwid }),
        true,
        "application/json"
    )
end)

if not success then
    -- fallback for executors that only support request / http_request
    success, result = pcall(function()
        local req = (syn and syn.request) or (http and http.request) or http_request or request
        if not req then error("No HTTP request function available") end
        local response = req({
            Url = API_URL,
            Method = "POST",
            Headers = { ["Content-Type"] = "application/json" },
            Body = HttpService:JSONEncode({ key = key, hwid = hwid })
        })
        return response.Body
    end)
end

if not success then
    warn("[Loader] Failed to contact auth server: " .. tostring(result))
    return
end

local ok, data = pcall(function()
    return HttpService:JSONDecode(result)
end)

if not ok or not data or not data.success then
    warn("[Loader] " .. (data and data.message or "Authorization failed"))
    return
end

-- Authorized → run the real script
${source}
`;

  res.type("text/plain").send(loader);
});

// Simple status
app.get("/api/status", (req, res) => {
  const data = readData();
  res.json({
    ok: true,
    keys: data.keys.length,
    scripts: data.scripts.length,
    port: PORT,
  });
});

// Fallback to frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n  Lua Key System running at http://localhost:${PORT}\n`);
  console.log(`  Dashboard  → http://localhost:${PORT}`);
  console.log(`  API status → http://localhost:${PORT}/api/status\n`);
});
