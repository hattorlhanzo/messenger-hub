const { contextBridge, ipcRenderer, webFrame } = require("electron");

// Мост уведомлений для страниц мессенджеров.
//
// Раньше уведомления передавались через console.info со специальным префиксом,
// а главный процесс разбирал вообще все сообщения консоли всех восьми страниц.
// Теперь это отдельный канал: главный процесс определяет отправителя по самой
// вкладке, а не по тексту в консоли, и посторонние записи в лог его не трогают.
//
// Подменять Notification приходится в мире самой страницы: она вызывает свой
// собственный объект, и из изолированного мира его не достать. Поэтому шим
// живёт здесь строкой и ставится через webFrame, а наружу торчит только
// одна функция отправки.

const bridgeName = "__messengerHubBridge";

contextBridge.exposeInMainWorld(bridgeName, {
  notify(payload) {
    ipcRenderer.send("account:notification", {
      title: String(payload?.title ?? ""),
      body: String(payload?.body ?? ""),
      tag: String(payload?.tag ?? "")
    });
  }
});

const notificationShim = `
  (() => {
    if (window.__messengerHubNotificationBridgeInstalled) return;
    window.__messengerHubNotificationBridgeInstalled = true;

    const bridge = window.${bridgeName};
    const OriginalNotification = window.Notification;

    function HubNotification(title, options = {}) {
      try {
        bridge.notify({
          title: String(title || ""),
          body: String(options.body || ""),
          tag: String(options.tag || "")
        });
      } catch (_) {}

      const target = document.createDocumentFragment();
      const notification = {
        title: String(title || ""),
        body: String(options.body || ""),
        tag: String(options.tag || ""),
        icon: String(options.icon || ""),
        dir: options.dir || "auto",
        lang: options.lang || "",
        data: options.data,
        onclick: null,
        onclose: null,
        onerror: null,
        onshow: null,
        close() {
          if (typeof notification.onclose === "function") {
            notification.onclose({ target: notification });
          }
        },
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
        dispatchEvent: target.dispatchEvent.bind(target)
      };

      setTimeout(() => {
        if (typeof notification.onshow === "function") {
          notification.onshow({ target: notification });
        }
      }, 0);

      return notification;
    }

    Object.defineProperty(HubNotification, "permission", {
      get() {
        return "granted";
      }
    });

    HubNotification.requestPermission = (callback) => {
      if (typeof callback === "function") callback("granted");
      return Promise.resolve("granted");
    };

    if (OriginalNotification) {
      HubNotification.prototype = OriginalNotification.prototype;
    }

    window.Notification = HubNotification;
  })();
`;

webFrame.executeJavaScript(notificationShim).catch((error) => {
  console.error("Failed to install notification bridge:", error?.message || error);
});
