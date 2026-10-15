const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("messengerShell", {
  // Нужна сразу, до первого ответа главного процесса: от неё зависит верстка
  // боковой панели — на macOS сверху место под кнопки окна.
  platform: process.platform,
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
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  reportError: (level, text) => ipcRenderer.send("log:renderer", level, text),
  selectAccount: (id) => ipcRenderer.invoke("accounts:select", id),
  reload: (accountId) => ipcRenderer.invoke("view:reload", accountId),
  togglePanel: () => ipcRenderer.invoke("layout:toggle-panel"),
  focusPane: (pane) => ipcRenderer.invoke("layout:focus-pane", pane),
  swapPanes: () => ipcRenderer.invoke("layout:swap"),
  closeSplit: () => ipcRenderer.invoke("layout:close-split"),
  goBack: () => ipcRenderer.invoke("view:back"),
  goForward: () => ipcRenderer.invoke("view:forward"),
  openDevTools: () => ipcRenderer.invoke("view:devtools"),
  setOverlayOpen: (open) => ipcRenderer.invoke("view:overlay", open),
  setLocked: (locked) => ipcRenderer.invoke("view:locked", locked),
  setPin: (pin, currentPin) => ipcRenderer.invoke("security:set-pin", pin, currentPin),
  disablePin: (currentPin) => ipcRenderer.invoke("security:disable-pin", currentPin),
  verifyPin: (pin) => ipcRenderer.invoke("security:verify-pin", pin),
  setTaskbarBadge: (dataUrl, text) => ipcRenderer.send("badge:overlay", dataUrl, text),
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
