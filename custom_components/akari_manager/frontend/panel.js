import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit-element@2.4.0/lit-element.js?module";

// ─── Helpers ───────────────────────────────────────────

function wsCommand(hass, type, params = {}) {
  return hass.callWS({ type, ...params });
}

function statusColor(status) {
  if (status === "ok" || status === "online" || status === true) return "#4caf50";
  if (status === "partial") return "#ff9800";
  return "#f44336";
}

function statusLabel(status) {
  if (status === "ok" || status === true) return "Online";
  if (status === "partial") return "Parziale";
  if (status === "not_configured") return "Non configurato";
  if (status === "offline" || status === false) return "Offline";
  return String(status);
}

function chipBadge(online) {
  const color = online ? "#4caf50" : "#f44336";
  const label = online ? "OK" : "Offline";
  return html`<span style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:0.85em">${label}</span>`;
}

function formatUptime(seconds) {
  if (seconds == null) return "N/D";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}g`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

// ─── Config Section Metadata ───────────────────────────

const CONFIG_GROUPS = [
  {
    label: "Sistema",
    sections: [
      { key: "system", label: "System" },
      { key: "mqtt", label: "MQTT" },
    ],
  },
  {
    label: "Adattatori",
    sections: [
      { key: "mcp", label: "MCP23017" },
      { key: "pca", label: "PCA9555" },
      { key: "gpio", label: "GPIO" },
      { key: "modbus", label: "Modbus" },
      { key: "onewire", label: "1-Wire" },
    ],
  },
  {
    label: "Entita'",
    sections: [
      { key: "switches", label: "Switch" },
      { key: "lights", label: "Luci" },
      { key: "covers", label: "Tapparelle" },
      { key: "sensors", label: "Sensori" },
      { key: "binary_sensors", label: "Sensori Binari" },
    ],
  },
];

// ─── Main Panel ────────────────────────────────────────

class AkariManagerPanel extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      narrow: { type: Boolean },
      panel: { type: Object },
      _devices: { type: Array },
      _selectedEntry: { type: String },
      _activeTab: { type: String },
      _diagnostics: { type: Object },
      _statusData: { type: Object },
      _loading: { type: Boolean },
      _configSection: { type: String },
      _configData: { type: Object },
      _configLoading: { type: Boolean },
      _configDirty: { type: Boolean },
      _configSaving: { type: Boolean },
      _configMessage: { type: String },
    };
  }

  constructor() {
    super();
    this._devices = [];
    this._selectedEntry = "";
    this._activeTab = "diagnostica";
    this._diagnostics = null;
    this._statusData = null;
    this._loading = false;
    this._configSection = "";
    this._configData = null;
    this._configLoading = false;
    this._configDirty = false;
    this._configSaving = false;
    this._configMessage = "";
  }

  async firstUpdated() {
    await this._loadDevices();
  }

  async _loadDevices() {
    try {
      const result = await wsCommand(this.hass, "akari_manager/devices");
      this._devices = result.devices || [];
      if (this._devices.length > 0 && !this._selectedEntry) {
        this._selectedEntry = this._devices[0].entry_id;
        this._refresh();
      }
    } catch (err) {
      console.error("Errore caricamento devices:", err);
    }
  }

  async _refresh() {
    if (!this._selectedEntry) return;
    this._loading = true;
    try {
      const [diag, status] = await Promise.all([
        wsCommand(this.hass, "akari_manager/diagnostics", {
          entry_id: this._selectedEntry,
        }),
        wsCommand(this.hass, "akari_manager/status", {
          entry_id: this._selectedEntry,
        }),
      ]);
      this._diagnostics = diag;
      this._statusData = status;
    } catch (err) {
      console.error("Errore refresh:", err);
    }
    this._loading = false;
  }

  _onDeviceChange(e) {
    this._selectedEntry = e.target.value;
    this._diagnostics = null;
    this._statusData = null;
    this._configData = null;
    this._configSection = "";
    this._refresh();
  }

  _onTabChange(tab) {
    this._activeTab = tab;
    if (tab === "configurazione" && !this._configSection) {
      this._configSection = "system";
      this._loadConfigSection("system");
    }
  }

  async _loadConfigSection(section) {
    if (!this._selectedEntry) return;
    this._configSection = section;
    this._configLoading = true;
    this._configDirty = false;
    this._configMessage = "";
    try {
      const data = await wsCommand(this.hass, "akari_manager/config_get", {
        entry_id: this._selectedEntry,
        section,
      });
      this._configData = data;
    } catch (err) {
      console.error("Errore caricamento config:", err);
      this._configData = null;
    }
    this._configLoading = false;
  }

  async _saveConfig() {
    if (!this._selectedEntry || !this._configSection || !this._configData) return;
    this._configSaving = true;
    this._configMessage = "";
    try {
      const result = await wsCommand(this.hass, "akari_manager/config_update", {
        entry_id: this._selectedEntry,
        section: this._configSection,
        data: this._configData,
      });
      this._configDirty = false;
      if (result.restart_required) {
        this._configMessage = "Salvato. Riavvio necessario per applicare le modifiche.";
      } else {
        this._configMessage = "Salvato.";
      }
    } catch (err) {
      this._configMessage = `Errore: ${err.message || err}`;
    }
    this._configSaving = false;
  }

  async _restartDevice() {
    if (!this._selectedEntry) return;
    if (!confirm("Riavviare il dispositivo Akari?")) return;
    try {
      await wsCommand(this.hass, "akari_manager/restart", {
        entry_id: this._selectedEntry,
      });
      this._configMessage = "Riavvio in corso...";
    } catch (err) {
      this._configMessage = `Errore riavvio: ${err.message || err}`;
    }
  }

  // ─── Render ──────────────────────────────────────────

  render() {
    return html`
      <div class="panel">
        <div class="header">
          <h1>Akari Manager</h1>
          <div class="header-actions">
            ${this._devices.length > 1
              ? html`
                  <select @change=${this._onDeviceChange}>
                    ${this._devices.map(
                      (d) =>
                        html`<option
                          value=${d.entry_id}
                          ?selected=${d.entry_id === this._selectedEntry}
                        >
                          ${d.name || d.device_id}
                        </option>`
                    )}
                  </select>
                `
              : this._devices.length === 1
              ? html`<span class="device-name">${this._devices[0].name || this._devices[0].device_id}</span>`
              : html`<span class="device-name">Nessun dispositivo</span>`}
          </div>
        </div>

        <div class="tabs">
          <button
            class="tab ${this._activeTab === "diagnostica" ? "active" : ""}"
            @click=${() => this._onTabChange("diagnostica")}
          >
            Diagnostica
          </button>
          <button
            class="tab ${this._activeTab === "configurazione" ? "active" : ""}"
            @click=${() => this._onTabChange("configurazione")}
          >
            Configurazione
          </button>
        </div>

        <div class="content">
          ${this._activeTab === "diagnostica"
            ? this._renderDiagnostica()
            : this._renderConfigurazione()}
        </div>
      </div>
    `;
  }

  // ─── Diagnostica Tab ─────────────────────────────────

  _renderDiagnostica() {
    if (this._loading) {
      return html`<div class="loading">Caricamento...</div>`;
    }
    if (!this._diagnostics || !this._statusData) {
      return html`<div class="empty">Nessun dato disponibile</div>`;
    }

    const si = this._statusData.system_info || {};
    const st = this._statusData.status || {};
    const d = this._diagnostics;

    return html`
      <div class="toolbar">
        <button class="btn btn-secondary" @click=${() => this._refresh()}>
          Aggiorna
        </button>
        <button class="btn btn-danger" @click=${() => this._restartDevice()}>
          Riavvia
        </button>
      </div>

      <div class="grid">
        <!-- Sistema -->
        <div class="card">
          <h3>Sistema</h3>
          <table>
            <tr><td>Nome</td><td>${st.name || st.id || "N/D"}</td></tr>
            <tr><td>Versione</td><td>${si.version || "N/D"}</td></tr>
            <tr><td>CPU</td><td>${si.cpu_temp != null ? si.cpu_temp + " C" : "N/D"}</td></tr>
            <tr><td>RAM</td><td>${si.memory_used_mb != null ? `${si.memory_used_mb} / ${si.memory_total_mb} MB` : "N/D"}</td></tr>
            <tr><td>Uptime</td><td>${formatUptime(si.uptime_seconds)}</td></tr>
            <tr><td>Overlay</td><td>${si.overlay_active ? "Attivo" : "Disattivo"}</td></tr>
          </table>
        </div>

        <!-- MCP23017 -->
        <div class="card">
          <h3>
            MCP23017
            <span class="badge" style="background:${statusColor(d.mcp?.status)}">${statusLabel(d.mcp?.status)}</span>
          </h3>
          ${d.mcp?.chips?.length
            ? html`
                <table>
                  <thead>
                    <tr><th>Nome</th><th>Indirizzo</th><th>Active Low</th><th>Stato</th></tr>
                  </thead>
                  <tbody>
                    ${d.mcp.chips.map(
                      (c) => html`
                        <tr>
                          <td>${c.name}</td>
                          <td>${c.address}</td>
                          <td>${c.active_low ? "Si'" : "No"}</td>
                          <td>${chipBadge(c.online)}</td>
                        </tr>
                      `
                    )}
                  </tbody>
                </table>
              `
            : html`<p class="muted">Nessun chip configurato</p>`}
        </div>

        <!-- PCA9555 -->
        <div class="card">
          <h3>
            PCA9555
            <span class="badge" style="background:${statusColor(d.pca?.status)}">${statusLabel(d.pca?.status)}</span>
          </h3>
          ${d.pca?.chips?.length
            ? html`
                <table>
                  <thead>
                    <tr><th>Nome</th><th>Indirizzo</th><th>Active Low</th><th>Stato</th></tr>
                  </thead>
                  <tbody>
                    ${d.pca.chips.map(
                      (c) => html`
                        <tr>
                          <td>${c.name}</td>
                          <td>${c.address}</td>
                          <td>${c.active_low ? "Si'" : "No"}</td>
                          <td>${chipBadge(c.online)}</td>
                        </tr>
                      `
                    )}
                  </tbody>
                </table>
              `
            : html`<p class="muted">Nessun chip configurato</p>`}
        </div>

        <!-- GPIO -->
        <div class="card">
          <h3>GPIO</h3>
          <table>
            <tr>
              <td>Disponibile</td>
              <td>${chipBadge(d.gpio?.available)}</td>
            </tr>
            <tr><td>Chip path</td><td>${d.gpio?.chip_path || "N/D"}</td></tr>
          </table>
        </div>

        <!-- Modbus -->
        <div class="card">
          <h3>
            Modbus
            ${d.modbus?.enabled
              ? html`<span class="badge" style="background:${statusColor(d.modbus?.adapter_online)}">${d.modbus?.adapter_online ? "Online" : "Offline"}</span>`
              : html`<span class="badge" style="background:#9e9e9e">Disabilitato</span>`}
          </h3>
          ${d.modbus?.enabled
            ? html`
                <table>
                  <tr><td>Porta</td><td>${d.modbus.adapter_port || "N/D"}</td></tr>
                </table>
                ${d.modbus.devices?.length
                  ? html`
                      <table style="margin-top:8px">
                        <thead>
                          <tr><th>Device</th><th>Connesso</th></tr>
                        </thead>
                        <tbody>
                          ${d.modbus.devices.map(
                            (dev) => html`
                              <tr>
                                <td>${dev.name}</td>
                                <td>${chipBadge(dev.connected)}</td>
                              </tr>
                            `
                          )}
                        </tbody>
                      </table>
                    `
                  : html`<p class="muted">Nessun device</p>`}
              `
            : html`<p class="muted">Modbus non abilitato</p>`}
        </div>

        <!-- Sensori -->
        <div class="card">
          <h3>Sensori</h3>
          <table>
            <tr><td>DS18B20</td><td>${d.ds18b20?.count || 0} sensori</td></tr>
            ${d.ds18b20?.sensors?.length
              ? html`<tr><td>Topics</td><td>${d.ds18b20.sensors.join(", ")}</td></tr>`
              : ""}
            <tr><td>CPU Temp</td><td>${d.cpu_temp?.enabled ? "Abilitato" : "Disabilitato"}</td></tr>
          </table>
        </div>
      </div>
    `;
  }

  // ─── Configurazione Tab ──────────────────────────────

  _renderConfigurazione() {
    return html`
      <div class="config-layout">
        <nav class="config-nav">
          ${CONFIG_GROUPS.map(
            (group) => html`
              <div class="nav-group">
                <div class="nav-group-label">${group.label}</div>
                ${group.sections.map(
                  (s) => html`
                    <button
                      class="nav-item ${this._configSection === s.key ? "active" : ""}"
                      @click=${() => this._loadConfigSection(s.key)}
                    >
                      ${s.label}
                    </button>
                  `
                )}
              </div>
            `
          )}
        </nav>

        <div class="config-content">
          ${this._configLoading
            ? html`<div class="loading">Caricamento...</div>`
            : this._configData != null
            ? this._renderConfigForm()
            : html`<div class="empty">Seleziona una sezione</div>`}
        </div>
      </div>
    `;
  }

  _renderConfigForm() {
    const section = this._configSection;
    const data = this._configData;

    return html`
      <div class="config-form">
        <div class="config-header">
          <h3>${CONFIG_GROUPS.flatMap((g) => g.sections).find((s) => s.key === section)?.label || section}</h3>
          <div class="config-actions">
            <button
              class="btn btn-primary"
              ?disabled=${!this._configDirty || this._configSaving}
              @click=${() => this._saveConfig()}
            >
              ${this._configSaving ? "Salvataggio..." : "Salva"}
            </button>
            <button
              class="btn btn-secondary"
              ?disabled=${!this._configDirty}
              @click=${() => this._loadConfigSection(section)}
            >
              Annulla
            </button>
          </div>
        </div>
        ${this._configMessage
          ? html`<div class="config-message ${this._configMessage.startsWith("Errore") ? "error" : "success"}">${this._configMessage}</div>`
          : ""}

        <div class="form-body">
          ${this._renderFields(data, [])}
        </div>
      </div>
    `;
  }

  _renderFields(obj, path) {
    if (obj == null) return "";
    if (Array.isArray(obj)) {
      return this._renderArrayField(obj, path);
    }
    if (typeof obj === "object") {
      return html`
        ${Object.entries(obj).map(([key, value]) => {
          const newPath = [...path, key];
          const pathStr = newPath.join(".");

          if (value != null && typeof value === "object") {
            return html`
              <fieldset class="nested">
                <legend>${key}</legend>
                ${this._renderFields(value, newPath)}
              </fieldset>
            `;
          }

          return this._renderScalarField(key, value, newPath);
        })}
      `;
    }
    return "";
  }

  _renderScalarField(key, value, path) {
    const pathStr = path.join(".");
    const type = typeof value;

    if (type === "boolean") {
      return html`
        <div class="form-row">
          <label>${key}</label>
          <label class="toggle">
            <input
              type="checkbox"
              ?checked=${value}
              @change=${(e) => this._updateValue(path, e.target.checked)}
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      `;
    }

    if (type === "number") {
      return html`
        <div class="form-row">
          <label>${key}</label>
          <input
            type="number"
            .value=${String(value)}
            @input=${(e) => {
              const v = e.target.value;
              this._updateValue(path, v.includes(".") ? parseFloat(v) : parseInt(v, 10));
            }}
          />
        </div>
      `;
    }

    // String (default)
    // Detect selects for known fields
    if (key === "level" && path.length >= 2 && path[path.length - 2] === "logging") {
      return html`
        <div class="form-row">
          <label>${key}</label>
          <select
            .value=${value}
            @change=${(e) => this._updateValue(path, e.target.value)}
          >
            ${["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map(
              (l) => html`<option value=${l} ?selected=${value === l}>${l}</option>`
            )}
          </select>
        </div>
      `;
    }

    if (key === "qos") {
      return html`
        <div class="form-row">
          <label>${key}</label>
          <select
            .value=${String(value)}
            @change=${(e) => this._updateValue(path, parseInt(e.target.value, 10))}
          >
            ${[0, 1, 2].map(
              (q) => html`<option value=${q} ?selected=${value === q}>${q}</option>`
            )}
          </select>
        </div>
      `;
    }

    // Readonly for id fields at root level of system.instance
    const isReadonly = key === "id" && path.length === 2 && path[0] === "instance";

    return html`
      <div class="form-row">
        <label>${key}</label>
        <input
          type="text"
          .value=${String(value ?? "")}
          ?readonly=${isReadonly}
          @input=${(e) => this._updateValue(path, e.target.value)}
        />
      </div>
    `;
  }

  _renderArrayField(arr, path) {
    return html`
      <div class="array-field">
        ${arr.map((item, idx) => {
          const itemPath = [...path, idx];
          if (item != null && typeof item === "object") {
            return html`
              <div class="array-item">
                <div class="array-item-header">
                  <span>#${idx + 1}</span>
                  <button
                    class="btn btn-small btn-danger"
                    @click=${() => this._removeArrayItem(path, idx)}
                  >
                    Rimuovi
                  </button>
                </div>
                ${this._renderFields(item, itemPath)}
              </div>
            `;
          }
          return html`
            <div class="form-row">
              <label>#${idx + 1}</label>
              <input
                type="text"
                .value=${String(item ?? "")}
                @input=${(e) => this._updateValue(itemPath, e.target.value)}
              />
              <button
                class="btn btn-small btn-danger"
                @click=${() => this._removeArrayItem(path, idx)}
              >
                X
              </button>
            </div>
          `;
        })}
        <button
          class="btn btn-small btn-secondary"
          @click=${() => this._addArrayItem(path)}
        >
          + Aggiungi
        </button>
      </div>
    `;
  }

  _updateValue(path, value) {
    // Deep clone and set
    const data = JSON.parse(JSON.stringify(this._configData));
    let obj = data;
    for (let i = 0; i < path.length - 1; i++) {
      obj = obj[path[i]];
    }
    obj[path[path.length - 1]] = value;
    this._configData = data;
    this._configDirty = true;
  }

  _removeArrayItem(path, idx) {
    const data = JSON.parse(JSON.stringify(this._configData));
    let obj = data;
    for (let i = 0; i < path.length - 1; i++) {
      obj = obj[path[i]];
    }
    const arr = obj[path[path.length - 1]];
    arr.splice(idx, 1);
    this._configData = data;
    this._configDirty = true;
  }

  _addArrayItem(path) {
    const data = JSON.parse(JSON.stringify(this._configData));
    let obj = data;
    for (let i = 0; i < path.length - 1; i++) {
      obj = obj[path[i]];
    }
    const arr = obj[path[path.length - 1]];
    // Infer template from first item or add empty string
    if (arr.length > 0 && typeof arr[0] === "object") {
      const template = {};
      for (const key of Object.keys(arr[0])) {
        const v = arr[0][key];
        if (typeof v === "boolean") template[key] = false;
        else if (typeof v === "number") template[key] = 0;
        else if (typeof v === "string") template[key] = "";
        else if (Array.isArray(v)) template[key] = [];
        else if (typeof v === "object" && v !== null) template[key] = {};
        else template[key] = "";
      }
      arr.push(template);
    } else {
      arr.push("");
    }
    this._configData = data;
    this._configDirty = true;
  }

  // ─── Styles ──────────────────────────────────────────

  static get styles() {
    return css`
      :host {
        display: block;
        font-family: var(--paper-font-body1_-_font-family, "Roboto", sans-serif);
        color: var(--primary-text-color, #212121);
        background: var(--primary-background-color, #fafafa);
        min-height: 100vh;
      }

      .panel {
        max-width: 1200px;
        margin: 0 auto;
        padding: 16px;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }

      .header h1 {
        margin: 0;
        font-size: 1.5em;
        font-weight: 500;
      }

      .device-name {
        font-size: 1em;
        opacity: 0.7;
      }

      select {
        padding: 6px 12px;
        border-radius: 4px;
        border: 1px solid var(--divider-color, #e0e0e0);
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #212121);
        font-size: 0.95em;
      }

      /* Tabs */
      .tabs {
        display: flex;
        gap: 0;
        border-bottom: 2px solid var(--divider-color, #e0e0e0);
        margin-bottom: 16px;
      }

      .tab {
        padding: 10px 24px;
        border: none;
        background: none;
        cursor: pointer;
        font-size: 1em;
        color: var(--secondary-text-color, #757575);
        border-bottom: 2px solid transparent;
        margin-bottom: -2px;
        transition: color 0.2s, border-color 0.2s;
      }

      .tab.active {
        color: var(--primary-color, #03a9f4);
        border-bottom-color: var(--primary-color, #03a9f4);
        font-weight: 500;
      }

      .tab:hover {
        color: var(--primary-text-color, #212121);
      }

      /* Toolbar */
      .toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
      }

      /* Cards Grid */
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
        gap: 16px;
      }

      .card {
        background: var(--card-background-color, #fff);
        border-radius: 8px;
        padding: 16px;
        box-shadow: var(--ha-card-box-shadow, 0 2px 2px rgba(0,0,0,0.1));
      }

      .card h3 {
        margin: 0 0 12px 0;
        font-size: 1.1em;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .badge {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 4px;
        color: #fff;
        font-size: 0.8em;
        font-weight: 500;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9em;
      }

      th, td {
        text-align: left;
        padding: 6px 8px;
        border-bottom: 1px solid var(--divider-color, #e0e0e0);
      }

      th {
        font-weight: 500;
        color: var(--secondary-text-color, #757575);
        font-size: 0.85em;
      }

      .muted {
        color: var(--secondary-text-color, #757575);
        font-style: italic;
        font-size: 0.9em;
      }

      .loading, .empty {
        text-align: center;
        padding: 40px;
        color: var(--secondary-text-color, #757575);
      }

      /* Buttons */
      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9em;
        transition: opacity 0.2s;
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-primary {
        background: var(--primary-color, #03a9f4);
        color: #fff;
      }

      .btn-secondary {
        background: var(--secondary-background-color, #e0e0e0);
        color: var(--primary-text-color, #212121);
      }

      .btn-danger {
        background: #f44336;
        color: #fff;
      }

      .btn-small {
        padding: 4px 10px;
        font-size: 0.8em;
      }

      /* Config Layout */
      .config-layout {
        display: flex;
        gap: 16px;
        min-height: 500px;
      }

      .config-nav {
        width: 200px;
        flex-shrink: 0;
        background: var(--card-background-color, #fff);
        border-radius: 8px;
        padding: 8px;
        box-shadow: var(--ha-card-box-shadow, 0 2px 2px rgba(0,0,0,0.1));
      }

      .nav-group {
        margin-bottom: 8px;
      }

      .nav-group-label {
        font-size: 0.75em;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--secondary-text-color, #757575);
        padding: 8px 12px 4px;
      }

      .nav-item {
        display: block;
        width: 100%;
        text-align: left;
        padding: 8px 12px;
        border: none;
        background: none;
        cursor: pointer;
        border-radius: 4px;
        font-size: 0.9em;
        color: var(--primary-text-color, #212121);
        transition: background 0.15s;
      }

      .nav-item:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }

      .nav-item.active {
        background: var(--primary-color, #03a9f4);
        color: #fff;
      }

      .config-content {
        flex: 1;
        min-width: 0;
      }

      .config-form {
        background: var(--card-background-color, #fff);
        border-radius: 8px;
        padding: 16px;
        box-shadow: var(--ha-card-box-shadow, 0 2px 2px rgba(0,0,0,0.1));
      }

      .config-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }

      .config-header h3 {
        margin: 0;
      }

      .config-actions {
        display: flex;
        gap: 8px;
      }

      .config-message {
        padding: 8px 12px;
        border-radius: 4px;
        margin-bottom: 12px;
        font-size: 0.9em;
      }

      .config-message.success {
        background: #e8f5e9;
        color: #2e7d32;
      }

      .config-message.error {
        background: #ffebee;
        color: #c62828;
      }

      .form-body {
        max-height: 600px;
        overflow-y: auto;
      }

      .form-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 10px;
      }

      .form-row label {
        min-width: 140px;
        font-size: 0.9em;
        font-weight: 500;
      }

      .form-row input[type="text"],
      .form-row input[type="number"],
      .form-row select {
        flex: 1;
        padding: 6px 10px;
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 4px;
        background: var(--primary-background-color, #fafafa);
        color: var(--primary-text-color, #212121);
        font-size: 0.9em;
      }

      .form-row input[readonly] {
        opacity: 0.6;
        cursor: not-allowed;
      }

      /* Toggle */
      .toggle {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
        min-width: 44px;
      }

      .toggle input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .toggle-slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: #ccc;
        border-radius: 24px;
        transition: 0.3s;
      }

      .toggle-slider:before {
        content: "";
        position: absolute;
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background: white;
        border-radius: 50%;
        transition: 0.3s;
      }

      .toggle input:checked + .toggle-slider {
        background: var(--primary-color, #03a9f4);
      }

      .toggle input:checked + .toggle-slider:before {
        transform: translateX(20px);
      }

      /* Nested fieldset */
      fieldset.nested {
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 6px;
        padding: 12px;
        margin: 8px 0;
      }

      fieldset.nested legend {
        font-weight: 500;
        font-size: 0.9em;
        padding: 0 6px;
        color: var(--secondary-text-color, #757575);
      }

      /* Array items */
      .array-field {
        margin: 4px 0;
      }

      .array-item {
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 6px;
        padding: 12px;
        margin-bottom: 8px;
      }

      .array-item-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        font-weight: 500;
        font-size: 0.9em;
      }

      /* Responsive */
      @media (max-width: 768px) {
        .config-layout {
          flex-direction: column;
        }
        .config-nav {
          width: 100%;
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .nav-group {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          align-items: center;
          margin-bottom: 0;
        }
        .nav-group-label {
          padding: 4px 8px;
        }
        .grid {
          grid-template-columns: 1fr;
        }
      }
    `;
  }
}

customElements.define("akari-manager-panel", AkariManagerPanel);
