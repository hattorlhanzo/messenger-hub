const { session } = require("electron");

// Работа с хранилищем сессий мессенджеров.
//
// Каждый аккаунт живёт в своём разделе (partition), поэтому несколько номеров
// не мешают друг другу. Здесь всё, что этих разделов касается: права страниц,
// дозапись данных на диск и очистка входа.

const configuredPartitions = new Set();

const allowedPermissions = [
  "notifications",
  "media",
  "fullscreen",
  "clipboard-sanitized-write",
  // Право «не удаляй мои данные». Без него IndexedDB мессенджеров считается
  // расходной и вычищается при нехватке квоты — со всеми сессиями сразу.
  "persistent-storage",
  // Нужен service worker'ам мессенджеров, чтобы доставить сообщения,
  // накопившиеся, пока связи не было.
  "background-sync"
];

// Всё, что не в списке, странице не выдаётся: доступ к геопозиции, буферу
// обмена на чтение и прочему мессенджеру для работы не нужен.
function isAllowedWebMessengerPermission(permission) {
  return allowedPermissions.includes(permission);
}

function configureAccountSession(partition) {
  if (!partition || configuredPartitions.has(partition)) {
    return;
  }

  configuredPartitions.add(partition);
  const accountSession = session.fromPartition(partition);

  accountSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(isAllowedWebMessengerPermission(permission));
  });

  accountSession.setPermissionCheckHandler((_webContents, permission) =>
    isAllowedWebMessengerPermission(permission)
  );
}

// Chromium держит свежие куки и localStorage в памяти. Instagram регулярно
// перевыпускает sessionid, и выход до записи на диск означал вход заново.
async function flushSessions(partitions) {
  const unique = new Set([...partitions].filter(Boolean));

  await Promise.all(
    [...unique].map(async (partition) => {
      try {
        const accountSession = session.fromPartition(partition);
        await accountSession.cookies.flushStore();
        accountSession.flushStorageData();
      } catch (error) {
        console.error(`Failed to flush ${partition}:`, error.message);
      }
    })
  );
}

// Очистка входа при удалении аккаунта. Папка раздела на диске остаётся,
// но данные входа из неё вычищаются: куки, localStorage, IndexedDB.
async function clearAccountSession(partition) {
  const accountSession = session.fromPartition(partition);

  await accountSession.clearStorageData({
    storages: [
      "cookies",
      "filesystem",
      "indexdb",
      "localstorage",
      "shadercache",
      "websql",
      "serviceworkers",
      "cachestorage"
    ]
  });

  await accountSession.clearCache();
}

module.exports = {
  allowedPermissions,
  clearAccountSession,
  configureAccountSession,
  flushSessions,
  isAllowedWebMessengerPermission
};
