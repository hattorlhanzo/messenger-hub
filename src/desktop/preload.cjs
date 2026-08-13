const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("messengerShell", {
  getAccounts: () => ipcRenderer.invoke("accounts:list"),
  addAccount: (input) => ipcRenderer.invoke("accounts:add", input),
  updateAccount: (id, patch) => ipcRenderer.invoke("accounts:update", id, patch),
  openAccountMenu: (id) => ipcRenderer.invoke("accounts:menu", id),
  requestRemoveAccount: (id, options) =>
    ipcRenderer.invoke("accounts:request-remove", id, options),
  reorderAccounts: (ids) => ipcRenderer.invoke("accounts:reorder", ids),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  showSettingsFile: () => ipcRenderer.invoke("settings:show-file"),
  showLogs: () => ipcRenderer.invoke("logs:show"),
  reportError: (level, text) => ipcRenderer.send("log:renderer", level, text),
  selectAccount: (id) => ipcRenderer.invoke("accounts:select", id),
  reload: () => ipcRenderer.invoke("view:reload"),
  goBack: () => ipcRenderer.invoke("view:back"),
  goForward: () => ipcRenderer.invoke("view:forward"),
  openDevTools: () => ipcRenderer.invoke("view:devtools"),
  setOverlayOpen: (open) => ipcRenderer.invoke("view:overlay", open),
  setLocked: (locked) => ipcRenderer.invoke("view:locked", locked),
  setPin: (pin) => ipcRenderer.invoke("security:set-pin", pin),
  disablePin: () => ipcRenderer.invoke("security:disable-pin"),
  verifyPin: (pin) => ipcRenderer.invoke("security:verify-pin", pin),
  onAccountChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("accounts:changed", listener);
    return () => ipcRenderer.off("accounts:changed", listener);
  },
  onAccountListChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("accounts:list-changed", listener);
    return () => ipcRenderer.off("accounts:list-changed", listener);
  },
  onNavigationChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("view:navigation", listener);
    return () => ipcRenderer.off("view:navigation", listener);
  },
  onCommandOpen: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("command:open", listener);
    return () => ipcRenderer.off("command:open", listener);
  },
  onAccountEditRequested: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("accounts:edit", listener);
    return () => ipcRenderer.off("accounts:edit", listener);
  },
  onSecurityLock: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("security:lock", listener);
    return () => ipcRenderer.off("security:lock", listener);
  }
});
