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
//
// Клик по системному уведомлению возвращается обратно в страницу: у каждого
// уведомления есть номер, и по нему вызывается onclick, который повесил сам
// мессенджер. Так открывается нужный чат, а не просто вкладка аккаунта.

const bridgeName = "__messengerHubBridge";
const clickHandlerName = "__messengerHubNotificationClick";

contextBridge.exposeInMainWorld(bridgeName, {
  notify(payload) {
    ipcRenderer.send("account:notification", {
      title: String(payload?.title ?? ""),
      body: String(payload?.body ?? ""),
      tag: String(payload?.tag ?? ""),
      id: Number.isSafeInteger(payload?.id) ? payload.id : 0
    });
  }
});

ipcRenderer.on("account:notification-click", (_event, id) => {
  // В строку кода попадает только целое число — ничего другого сюда не пускаем.
  if (!Number.isSafeInteger(id) || id <= 0) {
    return;
  }

  webFrame
    .executeJavaScript(`window.${clickHandlerName} && window.${clickHandlerName}(${id})`)
    .catch(() => {});
});

const notificationShim = `
  (() => {
    if (window.__messengerHubNotificationBridgeInstalled) return;
    window.__messengerHubNotificationBridgeInstalled = true;

    const bridge = window.${bridgeName};
    const OriginalNotification = window.Notification;

    // Номера начинаются с отметки времени: после перезагрузки страницы клик
    // по старому уведомлению не попадёт в новое с тем же порядковым номером.
    let nextId = Date.now() * 1000;
    const shown = new Map();
    const maxRemembered = 50;

    function HubNotification(title, options = {}) {
      const id = ++nextId;

      try {
        bridge.notify({
          title: String(title || ""),
          body: String(options.body || ""),
          tag: String(options.tag || ""),
          id
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
          shown.delete(id);
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

      shown.set(id, notification);
      if (shown.size > maxRemembered) {
        shown.delete(shown.keys().next().value);
      }

      return notification;
    }

    window.${clickHandlerName} = (id) => {
      const notification = shown.get(id);
      if (!notification) return false;

      const event = {
        type: "click",
        target: notification,
        currentTarget: notification,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        }
      };

      try {
        if (typeof notification.onclick === "function") {
          notification.onclick.call(notification, event);
        }
      } catch (_) {}

      try {
        notification.dispatchEvent(new Event("click"));
      } catch (_) {}

      return true;
    };

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
