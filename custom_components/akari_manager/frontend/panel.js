// Akari Manager Panel — vanilla web component (no external dependencies)

const CONFIG_GROUPS = [
  { label: "Sistema", sections: [
    { key: "system", label: "System" },
    { key: "mqtt", label: "MQTT" },
  ]},
  { label: "Adattatori", sections: [
    { key: "mcp", label: "MCP23017" },
    { key: "pca", label: "PCA9555" },
    { key: "gpio", label: "GPIO" },
    { key: "modbus", label: "Modbus" },
    { key: "onewire", label: "1-Wire" },
  ]},
  { label: "Entita'", sections: [
    { key: "switches", label: "Switch" },
    { key: "lights", label: "Luci" },
    { key: "covers", label: "Tapparelle" },
    { key: "sensors", label: "Sensori" },
    { key: "binary_sensors", label: "Sensori Binari" },
  ]},
];

function esc(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function statusColor(s) {
  if (s === "ok" || s === "online" || s === true) return "#4caf50";
  if (s === "partial") return "#ff9800";
  return "#f44336";
}

function statusLabel(s) {
  if (s === "ok" || s === true) return "Online";
  if (s === "partial") return "Parziale";
  if (s === "not_configured") return "Non configurato";
  return "Offline";
}

function badge(online) {
  const c = online ? "#4caf50" : "#f44336";
  const l = online ? "OK" : "Offline";
  return `<span class="chip" style="background:${c}">${l}</span>`;
}

function fmtUptime(sec) {
  if (sec == null) return "N/D";
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  const p = [];
  if (d) p.push(d + "g");
  if (h) p.push(h + "h");
  p.push(m + "m");
  return p.join(" ");
}

class AkariManagerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._devices = [];
    this._entry = "";
    this._tab = "diagnostica";
    this._diag = null;
    this._status = null;
    this._loading = false;
    this._error = "";
    this._cfgSection = "";
    this._cfgData = null;
    this._cfgOriginal = null;
    this._cfgLoading = false;
    this._cfgMsg = "";
    this._cfgError = "";
    this._pollTimer = null;
    this._onVisChange = () => {
      if (document.hidden) this._stopPoll();
      else this._startPoll();
    };
  }

  connectedCallback() {
    document.addEventListener("visibilitychange", this._onVisChange);
  }

  disconnectedCallback() {
    this._stopPoll();
    document.removeEventListener("visibilitychange", this._onVisChange);
  }

  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    if (first) this._init();
  }

  set panel(p) { this._panel = p; }

  async _ws(type, params = {}) {
    return this._hass.callWS({ type, ...params });
  }

  get _selectedDevice() {
    return this._devices.find(d => d.entry_id === this._entry);
  }

  get _isOnline() {
    const dev = this._selectedDevice;
    return dev && dev.online;
  }

  async _init() {
    try {
      const r = await this._ws("akari_manager/devices");
      this._devices = r.devices || [];
      if (this._devices.length && !this._entry) {
        this._entry = this._devices[0].entry_id;
        if (this._isOnline) await this._refresh();
      }
    } catch (e) { console.error("akari init:", e); }
    this._render();
    this._startPoll();
  }

  async _refresh() {
    if (!this._entry || !this._isOnline) return;
    const forEntry = this._entry;
    this._loading = true;
    this._error = "";
    this._render();
    try {
      const [diag, st] = await Promise.all([
        this._ws("akari_manager/diagnostics", { entry_id: forEntry }),
        this._ws("akari_manager/status", { entry_id: forEntry }),
      ]);
      if (this._entry !== forEntry) return; // device changed while loading
      this._diag = diag;
      this._status = st;
    } catch (e) {
      if (this._entry !== forEntry) return;
      console.error("akari refresh:", e);
      this._error = "Impossibile contattare il dispositivo";
      this._diag = null;
      this._status = null;
    }
    this._loading = false;
    this._render();
  }

  async _loadCfg(section) {
    if (!this._entry) return;
    const forEntry = this._entry;
    this._cfgSection = section;
    this._cfgError = "";

    if (!this._isOnline) {
      this._cfgData = null;
      this._cfgError = "Dispositivo non raggiungibile";
      this._render();
      return;
    }

    this._cfgLoading = true;
    this._cfgMsg = "";
    this._render();
    try {
      const data = await this._ws("akari_manager/config_get", { entry_id: forEntry, section });
      if (this._entry !== forEntry) return;
      this._cfgData = data;
      this._cfgOriginal = JSON.stringify(data);
      this._cfgError = "";
    } catch (e) {
      if (this._entry !== forEntry) return;
      console.error("akari cfg load:", e);
      this._cfgData = null;
      this._cfgError = "Errore caricamento: dispositivo non raggiungibile";
    }
    this._cfgLoading = false;
    this._render();
  }

  async _saveCfg() {
    if (!this._entry || !this._cfgSection || !this._cfgData) return;
    const forEntry = this._entry;
    const forSection = this._cfgSection;
    this._cfgMsg = "";
    this._render();
    try {
      const r = await this._ws("akari_manager/config_update", {
        entry_id: forEntry, section: forSection, data: this._cfgData,
      });
      if (this._entry !== forEntry || this._cfgSection !== forSection) return;
      this._cfgOriginal = JSON.stringify(this._cfgData);
      this._cfgMsg = r.restart_required
        ? "Salvato. Riavvio necessario per applicare le modifiche."
        : "Salvato.";
    } catch (e) {
      if (this._entry !== forEntry || this._cfgSection !== forSection) return;
      this._cfgMsg = "Errore: " + (e.message || e);
    }
    this._render();
  }

  async _restart() {
    if (!confirm("Riavviare il dispositivo Akari?")) return;
    try {
      await this._ws("akari_manager/restart", { entry_id: this._entry });
      this._cfgMsg = "Riavvio in corso...";
    } catch (e) { this._cfgMsg = "Errore: " + (e.message || e); }
    this._render();
  }

  get _dirty() {
    return this._cfgData && JSON.stringify(this._cfgData) !== this._cfgOriginal;
  }

  // ─── Auto-polling ───

  _startPoll() {
    this._stopPoll();
    if (this._tab === "diagnostica" && this._isOnline && !document.hidden) {
      this._pollTimer = setInterval(() => this._refresh(), 10000);
    }
  }

  _stopPoll() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  // ─── Render ───

  _render() {
    if (!this._hass) return;
    const root = this.shadowRoot;
    root.innerHTML = `<style>${STYLES}</style>` + this._html();
    this._bind();
  }

  _html() {
    const dev = this._devices;
    const sel = this._selectedDevice;
    const online = this._isOnline;

    let devInfo;
    if (dev.length >= 1) {
      devInfo = `<select id="dev-sel">${dev.map(d =>
        `<option value="${esc(d.entry_id)}" ${d.entry_id === this._entry ? "selected" : ""}>${esc(d.name || d.device_id)}</option>`
      ).join("")}</select>`;
    } else {
      devInfo = `<span class="dev-name">Nessun dispositivo configurato</span>`;
    }

    return `
      <div class="panel">
        <div class="header">
          <h1>Akari Manager</h1>
          <div>${devInfo}</div>
        </div>
        <div class="tabs">
          <button class="tab ${this._tab === "diagnostica" ? "active" : ""}" data-tab="diagnostica">Diagnostica</button>
          <button class="tab ${this._tab === "configurazione" ? "active" : ""}" data-tab="configurazione" ${!online ? "disabled" : ""}>Configurazione</button>
        </div>
        <div class="content">
          ${this._tab === "diagnostica" ? this._htmlDiag() : this._htmlCfg()}
        </div>
      </div>`;
  }

  _htmlDiag() {
    if (!this._entry) return `<div class="center">Nessun dispositivo configurato</div>`;
    if (!this._isOnline) return `<div class="center"><span class="chip" style="background:#f44336">Offline</span><p style="margin-top:12px"><strong>Dispositivo offline</strong></p><p>Il dispositivo non e' raggiungibile. Verifica che sia acceso e connesso alla rete.</p></div>`;
    if (this._loading) return `<div class="center">Caricamento...</div>`;
    if (this._error) return `<div class="center"><p class="msg-err-inline">${esc(this._error)}</p><button class="btn sec" id="btn-refresh">Riprova</button></div>`;
    if (!this._diag || !this._status) return `<div class="center">Nessun dato disponibile<br><button class="btn sec" id="btn-refresh" style="margin-top:12px">Carica</button></div>`;

    const si = this._status.system_info || {};
    const st = this._status.status || {};
    const d = this._diag;

    const mcpRows = (d.mcp?.chips || []).map(c =>
      `<tr><td>${esc(c.name)}</td><td>${esc(c.address)}</td><td>${c.active_low ? "Si'" : "No"}</td><td>${badge(c.online)}</td></tr>`
    ).join("");

    const pcaRows = (d.pca?.chips || []).map(c =>
      `<tr><td>${esc(c.name)}</td><td>${esc(c.address)}</td><td>${c.active_low ? "Si'" : "No"}</td><td>${badge(c.online)}</td></tr>`
    ).join("");

    const modbusDevs = (d.modbus?.devices || []).map(dev =>
      `<tr><td>${esc(dev.name)}</td><td>${badge(dev.connected)}</td></tr>`
    ).join("");

    return `
      <div class="toolbar">
        <button class="btn sec" id="btn-refresh">Aggiorna</button>
        <button class="btn danger" id="btn-restart">Riavvia</button>
      </div>
      <div class="grid">
        <div class="card">
          <h3>Sistema</h3>
          <table>
            <tr><td>Stato</td><td><span class="chip" style="background:#4caf50">Online</span></td></tr>
            <tr><td>Nome</td><td>${esc(st.name || st.id)}</td></tr>
            <tr><td>Versione</td><td>${esc(si.version)}</td></tr>
            <tr><td>CPU</td><td>${si.cpu_temp != null ? si.cpu_temp + " &deg;C" : "N/D"}</td></tr>
            <tr><td>RAM</td><td>${si.memory_used_mb != null ? si.memory_used_mb + " / " + si.memory_total_mb + " MB" : "N/D"}</td></tr>
            <tr><td>Uptime</td><td>${fmtUptime(si.uptime_seconds)}</td></tr>
            <tr><td>Overlay</td><td>${si.overlay_active ? "Attivo" : "Disattivo"}</td></tr>
          </table>
        </div>
        <div class="card">
          <h3>MCP23017 <span class="chip" style="background:${statusColor(d.mcp?.status)}">${statusLabel(d.mcp?.status)}</span></h3>
          ${mcpRows ? `<table><thead><tr><th>Nome</th><th>Indirizzo</th><th>Active Low</th><th>Stato</th></tr></thead><tbody>${mcpRows}</tbody></table>` : `<p class="muted">Nessun chip configurato</p>`}
        </div>
        <div class="card">
          <h3>PCA9555 <span class="chip" style="background:${statusColor(d.pca?.status)}">${statusLabel(d.pca?.status)}</span></h3>
          ${pcaRows ? `<table><thead><tr><th>Nome</th><th>Indirizzo</th><th>Active Low</th><th>Stato</th></tr></thead><tbody>${pcaRows}</tbody></table>` : `<p class="muted">Nessun chip configurato</p>`}
        </div>
        <div class="card">
          <h3>GPIO</h3>
          <table>
            <tr><td>Disponibile</td><td>${badge(d.gpio?.available)}</td></tr>
            <tr><td>Chip path</td><td>${esc(d.gpio?.chip_path)}</td></tr>
          </table>
        </div>
        <div class="card">
          <h3>Modbus ${d.modbus?.enabled
            ? `<span class="chip" style="background:${statusColor(d.modbus?.adapter_online)}">${d.modbus?.adapter_online ? "Online" : "Offline"}</span>`
            : `<span class="chip" style="background:#9e9e9e">Disabilitato</span>`}</h3>
          ${d.modbus?.enabled ? `
            <table><tr><td>Porta</td><td>${esc(d.modbus.adapter_port)}</td></tr></table>
            ${modbusDevs ? `<table style="margin-top:8px"><thead><tr><th>Device</th><th>Connesso</th></tr></thead><tbody>${modbusDevs}</tbody></table>` : `<p class="muted">Nessun device</p>`}
          ` : `<p class="muted">Modbus non abilitato</p>`}
        </div>
        <div class="card">
          <h3>Sensori</h3>
          <table>
            <tr><td>DS18B20</td><td>${d.ds18b20?.count || 0} sensori</td></tr>
            ${(d.ds18b20?.sensors || []).length ? `<tr><td>Topics</td><td>${esc(d.ds18b20.sensors.join(", "))}</td></tr>` : ""}
            <tr><td>CPU Temp</td><td>${d.cpu_temp?.enabled ? "Abilitato" : "Disabilitato"}</td></tr>
          </table>
        </div>
      </div>`;
  }

  _htmlCfg() {
    if (!this._entry) return `<div class="center">Nessun dispositivo configurato</div>`;

    const nav = CONFIG_GROUPS.map(g =>
      `<div class="nav-group">
        <div class="nav-label">${esc(g.label)}</div>
        ${g.sections.map(s =>
          `<button class="nav-item ${this._cfgSection === s.key ? "active" : ""}" data-section="${s.key}">${esc(s.label)}</button>`
        ).join("")}
      </div>`
    ).join("");

    let body;
    if (!this._cfgSection) {
      body = `<div class="center">Seleziona una sezione dalla lista</div>`;
    } else if (this._cfgLoading) {
      body = `<div class="center">Caricamento...</div>`;
    } else if (this._cfgError) {
      body = `<div class="center"><p class="msg-err-inline">${esc(this._cfgError)}</p></div>`;
    } else if (this._cfgData != null) {
      const sLabel = CONFIG_GROUPS.flatMap(g => g.sections).find(s => s.key === this._cfgSection)?.label || this._cfgSection;
      const msgCls = this._cfgMsg.startsWith("Errore") ? "msg-err" : "msg-ok";
      body = `
        <div class="cfg-form">
          <div class="cfg-header">
            <h3>${esc(sLabel)}</h3>
            <div class="cfg-actions">
              <button class="btn pri" id="btn-save" ${!this._dirty ? "disabled" : ""}>Salva</button>
              <button class="btn sec" id="btn-cancel" ${!this._dirty ? "disabled" : ""}>Annulla</button>
            </div>
          </div>
          ${this._cfgMsg ? `<div class="${msgCls}">${esc(this._cfgMsg)}</div>` : ""}
          <div class="form-body">${this._fieldsHtml(this._cfgData, [])}</div>
        </div>`;
    } else {
      body = `<div class="center">Seleziona una sezione dalla lista</div>`;
    }

    return `<div class="cfg-layout"><nav class="cfg-nav">${nav}</nav><div class="cfg-content">${body}</div></div>`;
  }

  _fieldsHtml(obj, path) {
    if (obj == null) return "";
    if (Array.isArray(obj)) return this._arrayHtml(obj, path);
    if (typeof obj !== "object") return "";

    return Object.entries(obj).map(([key, val]) => {
      const p = [...path, key];
      const pid = p.join(".");

      if (val != null && typeof val === "object") {
        return `<fieldset class="nested"><legend>${esc(key)}</legend>${this._fieldsHtml(val, p)}</fieldset>`;
      }

      if (typeof val === "boolean") {
        return `<div class="row"><label>${esc(key)}</label><label class="toggle"><input type="checkbox" data-path="${esc(pid)}" ${val ? "checked" : ""}/><span class="slider"></span></label></div>`;
      }
      if (typeof val === "number") {
        return `<div class="row"><label>${esc(key)}</label><input type="number" data-path="${esc(pid)}" value="${val}"/></div>`;
      }
      if (key === "level" && path.length >= 1 && path[path.length - 1] === "logging") {
        const opts = ["DEBUG","INFO","WARNING","ERROR","CRITICAL"].map(l => `<option value="${l}" ${val === l ? "selected" : ""}>${l}</option>`).join("");
        return `<div class="row"><label>${esc(key)}</label><select data-path="${esc(pid)}">${opts}</select></div>`;
      }

      const ro = key === "id" && path.length === 1 && path[0] === "instance" ? "readonly" : "";
      return `<div class="row"><label>${esc(key)}</label><input type="text" data-path="${esc(pid)}" value="${esc(val)}" ${ro}/></div>`;
    }).join("");
  }

  _arrayHtml(arr, path) {
    const pid = path.join(".");
    const items = arr.map((item, i) => {
      const ip = [...path, i];
      if (item != null && typeof item === "object") {
        return `<div class="arr-item"><div class="arr-hdr"><span>#${i + 1}</span><button class="btn sm danger" data-rm="${pid}" data-idx="${i}">Rimuovi</button></div>${this._fieldsHtml(item, ip)}</div>`;
      }
      return `<div class="row"><label>#${i + 1}</label><input type="text" data-path="${pid}.${i}" value="${esc(item)}"/><button class="btn sm danger" data-rm="${pid}" data-idx="${i}">X</button></div>`;
    }).join("");
    return `<div class="arr">${items}<button class="btn sm sec" data-add="${pid}">+ Aggiungi</button></div>`;
  }

  // ─── Event binding ───

  _bind() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    const $$ = (sel) => this.shadowRoot.querySelectorAll(sel);

    const devSel = $("#dev-sel");
    if (devSel) devSel.onchange = () => {
      this._entry = devSel.value;
      this._diag = null; this._status = null; this._cfgData = null; this._cfgSection = ""; this._error = ""; this._cfgError = "";
      if (!this._isOnline) this._tab = "diagnostica";
      if (this._isOnline) { this._refresh(); this._startPoll(); } else { this._stopPoll(); this._render(); }
    };

    $$(".tab").forEach(btn => btn.onclick = () => {
      this._tab = btn.dataset.tab;
      this._startPoll();
      this._render();
    });

    const btnR = $("#btn-refresh");
    if (btnR) btnR.onclick = () => this._refresh();
    const btnRst = $("#btn-restart");
    if (btnRst) btnRst.onclick = () => this._restart();

    $$(".nav-item").forEach(btn => btn.onclick = () => this._loadCfg(btn.dataset.section));

    const btnSave = $("#btn-save");
    if (btnSave) btnSave.onclick = () => this._saveCfg();
    const btnCancel = $("#btn-cancel");
    if (btnCancel) btnCancel.onclick = () => this._loadCfg(this._cfgSection);

    $$("input[data-path], select[data-path]").forEach(el => {
      const handler = () => {
        const path = el.dataset.path.split(".");
        let val;
        if (el.type === "checkbox") val = el.checked;
        else if (el.type === "number") val = el.value.includes(".") ? parseFloat(el.value) : parseInt(el.value, 10);
        else val = el.value;
        this._setVal(path, val);
        const s = $("#btn-save"), c = $("#btn-cancel");
        if (s) s.disabled = !this._dirty;
        if (c) c.disabled = !this._dirty;
      };
      el.addEventListener(el.type === "checkbox" ? "change" : "input", handler);
      if (el.tagName === "SELECT") el.addEventListener("change", handler);
    });

    $$("[data-rm]").forEach(btn => btn.onclick = () => {
      const path = btn.dataset.rm.split(".");
      const idx = parseInt(btn.dataset.idx, 10);
      this._rmItem(path, idx);
      this._render();
    });

    $$("[data-add]").forEach(btn => btn.onclick = () => {
      const path = btn.dataset.add.split(".");
      this._addItem(path);
      this._render();
    });
  }

  _setVal(path, val) {
    let obj = this._cfgData;
    for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
    obj[path[path.length - 1]] = val;
  }

  _rmItem(path, idx) {
    let obj = this._cfgData;
    for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
    obj[path[path.length - 1]].splice(idx, 1);
  }

  _addItem(path) {
    let obj = this._cfgData;
    for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
    const arr = obj[path[path.length - 1]];
    if (arr.length && typeof arr[0] === "object" && arr[0] !== null) {
      const tpl = {};
      for (const k of Object.keys(arr[0])) {
        const v = arr[0][k];
        if (typeof v === "boolean") tpl[k] = false;
        else if (typeof v === "number") tpl[k] = 0;
        else if (typeof v === "string") tpl[k] = "";
        else if (Array.isArray(v)) tpl[k] = [];
        else if (typeof v === "object") tpl[k] = {};
        else tpl[k] = "";
      }
      arr.push(tpl);
    } else arr.push("");
  }
}

// ─── Styles ───

const STYLES = `
:host { display:block; font-family:var(--paper-font-body1_-_font-family,"Roboto",sans-serif); color:var(--primary-text-color,#212121); background:var(--primary-background-color,#fafafa); min-height:100vh }
.panel { max-width:1200px; margin:0 auto; padding:16px }
.header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px }
.header h1 { margin:0; font-size:1.5em; font-weight:500 }
.dev-name { display:flex; align-items:center; gap:8px; font-size:1em }
select { padding:6px 12px; border-radius:4px; border:1px solid var(--divider-color,#e0e0e0); background:var(--card-background-color,#fff); color:var(--primary-text-color,#212121) }
.tabs { display:flex; border-bottom:2px solid var(--divider-color,#e0e0e0); margin-bottom:16px }
.tab { padding:10px 24px; border:none; background:none; cursor:pointer; font-size:1em; color:var(--secondary-text-color,#757575); border-bottom:2px solid transparent; margin-bottom:-2px }
.tab.active { color:var(--primary-color,#03a9f4); border-bottom-color:var(--primary-color,#03a9f4); font-weight:500 }
.tab:hover:not(:disabled) { color:var(--primary-text-color,#212121) }
.tab:disabled { opacity:.4; cursor:not-allowed }
.toolbar { display:flex; gap:8px; margin-bottom:16px }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:16px }
.card { background:var(--card-background-color,#fff); border-radius:8px; padding:16px; box-shadow:var(--ha-card-box-shadow,0 2px 2px rgba(0,0,0,.1)) }
.card h3 { margin:0 0 12px; font-size:1.1em; display:flex; align-items:center; gap:8px }
.chip { display:inline-block; padding:2px 10px; border-radius:4px; color:#fff; font-size:.8em; font-weight:500 }
table { width:100%; border-collapse:collapse; font-size:.9em }
th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--divider-color,#e0e0e0) }
th { font-weight:500; color:var(--secondary-text-color,#757575); font-size:.85em }
.muted { color:var(--secondary-text-color,#757575); font-style:italic; font-size:.9em }
.center { text-align:center; padding:40px; color:var(--secondary-text-color,#757575) }
.msg-err-inline { color:#c62828; font-weight:500 }
.btn { padding:8px 16px; border:none; border-radius:4px; cursor:pointer; font-size:.9em }
.btn:disabled { opacity:.5; cursor:not-allowed }
.btn.pri { background:var(--primary-color,#03a9f4); color:#fff }
.btn.sec { background:var(--secondary-background-color,#e0e0e0); color:var(--primary-text-color,#212121) }
.btn.danger { background:#f44336; color:#fff }
.btn.sm { padding:4px 10px; font-size:.8em }
.cfg-layout { display:flex; gap:16px; min-height:500px }
.cfg-nav { width:200px; flex-shrink:0; background:var(--card-background-color,#fff); border-radius:8px; padding:8px; box-shadow:var(--ha-card-box-shadow,0 2px 2px rgba(0,0,0,.1)) }
.nav-group { margin-bottom:8px }
.nav-label { font-size:.75em; font-weight:600; text-transform:uppercase; color:var(--secondary-text-color,#757575); padding:8px 12px 4px }
.nav-item { display:block; width:100%; text-align:left; padding:8px 12px; border:none; background:none; cursor:pointer; border-radius:4px; font-size:.9em; color:var(--primary-text-color,#212121) }
.nav-item:hover { background:var(--secondary-background-color,#f5f5f5) }
.nav-item.active { background:var(--primary-color,#03a9f4); color:#fff }
.cfg-content { flex:1; min-width:0 }
.cfg-form { background:var(--card-background-color,#fff); border-radius:8px; padding:16px; box-shadow:var(--ha-card-box-shadow,0 2px 2px rgba(0,0,0,.1)) }
.cfg-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px }
.cfg-header h3 { margin:0 }
.cfg-actions { display:flex; gap:8px }
.msg-ok { padding:8px 12px; border-radius:4px; margin-bottom:12px; font-size:.9em; background:#e8f5e9; color:#2e7d32 }
.msg-err { padding:8px 12px; border-radius:4px; margin-bottom:12px; font-size:.9em; background:#ffebee; color:#c62828 }
.form-body { max-height:600px; overflow-y:auto }
.row { display:flex; align-items:center; gap:12px; margin-bottom:10px }
.row label { min-width:140px; font-size:.9em; font-weight:500 }
.row input[type=text],.row input[type=number],.row select { flex:1; padding:6px 10px; border:1px solid var(--divider-color,#e0e0e0); border-radius:4px; background:var(--primary-background-color,#fafafa); color:var(--primary-text-color,#212121); font-size:.9em }
.row input[readonly] { opacity:.6; cursor:not-allowed }
.toggle { position:relative; display:inline-block; width:44px; height:24px; min-width:44px }
.toggle input { opacity:0; width:0; height:0 }
.slider { position:absolute; cursor:pointer; inset:0; background:#ccc; border-radius:24px; transition:.3s }
.slider:before { content:""; position:absolute; height:18px; width:18px; left:3px; bottom:3px; background:#fff; border-radius:50%; transition:.3s }
.toggle input:checked+.slider { background:var(--primary-color,#03a9f4) }
.toggle input:checked+.slider:before { transform:translateX(20px) }
fieldset.nested { border:1px solid var(--divider-color,#e0e0e0); border-radius:6px; padding:12px; margin:8px 0 }
fieldset.nested legend { font-weight:500; font-size:.9em; padding:0 6px; color:var(--secondary-text-color,#757575) }
.arr { margin:4px 0 }
.arr-item { border:1px solid var(--divider-color,#e0e0e0); border-radius:6px; padding:12px; margin-bottom:8px }
.arr-hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; font-weight:500; font-size:.9em }
@media(max-width:768px) { .cfg-layout{flex-direction:column} .cfg-nav{width:100%;display:flex;flex-wrap:wrap;gap:4px} .nav-group{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:0} .grid{grid-template-columns:1fr} }
`;

customElements.define("akari-manager-panel", AkariManagerPanel);
