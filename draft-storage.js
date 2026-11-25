(() => {
  const LEGACY_KEY = "lingua-lab-personal-drafts-v1";
  const DATABASE_NAME = "interslation-personal-drafts-v1";
  const STORE_NAME = "drafts";
  const BROADCAST_CHANNEL_NAME = "interslation-personal-drafts";
  const STORAGE_SIGNAL_KEY = "interslation-personal-drafts-updated";
  let database = null;
  let usingLocalStorage = false;
  let drafts = readLegacyDrafts();
  let readyPromise;
  const broadcastChannel = typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(BROADCAST_CHANNEL_NAME)
    : null;

  function readLegacyDrafts() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(LEGACY_KEY) || "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch (error) {
      console.error("Không thể đọc bản nháp cũ:", error);
      return {};
    }
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Không thể đọc kho bản nháp."));
    });
  }

  function transactionComplete(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Không thể lưu kho bản nháp."));
      transaction.onabort = () => reject(transaction.error || new Error("Đã hủy thao tác lưu bản nháp."));
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: "topic" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Không thể mở kho bản nháp."));
      request.onblocked = () => reject(new Error("Kho bản nháp đang được mở ở thẻ khác. Hãy tải lại trang."));
    });
  }

  async function readDatabaseDrafts() {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const complete = transactionComplete(transaction);
    const records = await requestResult(transaction.objectStore(STORE_NAME).getAll());
    await complete;
    return Object.fromEntries(records
      .filter((record) => typeof record.topic === "string" && record.draft)
      .map((record) => [record.topic, record.draft]));
  }

  async function writeRecords(records, clear = false) {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const complete = transactionComplete(transaction);
    const store = transaction.objectStore(STORE_NAME);
    if (clear) store.clear();
    records.forEach((record) => store.put(record));
    await complete;
  }

  function notifyOtherTabs() {
    if (broadcastChannel) {
      broadcastChannel.postMessage("updated");
    } else {
      try {
        window.localStorage.setItem(STORAGE_SIGNAL_KEY, String(Date.now()));
      } catch (error) {
        console.warn("Không thể gửi thông báo bản nháp sang thẻ khác:", error);
      }
    }
  }

  function dispatchLoaded() {
    window.dispatchEvent(new Event("interslation:drafts-loaded"));
  }

  async function initialize() {
    if (!window.indexedDB) {
      usingLocalStorage = true;
      dispatchLoaded();
      return;
    }

    try {
      database = await openDatabase();
      database.onversionchange = () => database.close();
      const savedDrafts = await readDatabaseDrafts();
      const legacyDrafts = readLegacyDrafts();
      const missingLegacyDrafts = Object.entries(legacyDrafts)
        .filter(([topic]) => !Object.prototype.hasOwnProperty.call(savedDrafts, topic))
        .map(([topic, draft]) => ({ topic, draft }));
      if (missingLegacyDrafts.length) {
        await writeRecords(missingLegacyDrafts);
        missingLegacyDrafts.forEach(({ topic, draft }) => {
          savedDrafts[topic] = draft;
        });
      }
      drafts = savedDrafts;
      if (Object.keys(legacyDrafts).length) {
        try {
          window.localStorage.removeItem(LEGACY_KEY);
        } catch (error) {
          console.warn("Không thể xóa bản nháp cũ sau khi di chuyển:", error);
        }
      }
    } catch (error) {
      database?.close();
      database = null;
      usingLocalStorage = true;
      console.error("Không thể khởi tạo IndexedDB cho bản nháp:", error);
      window.dispatchEvent(new CustomEvent("interslation:draft-storage-error", {
        detail: { message: error.message || "không thể mở kho IndexedDB." }
      }));
    }
    dispatchLoaded();
  }

  readyPromise = initialize();

  async function getAllAsync() {
    await readyPromise;
    if (database) drafts = await readDatabaseDrafts();
    return { ...drafts };
  }

  async function save(topic, draft) {
    await readyPromise;
    if (database) {
      await writeRecords([{ topic, draft }]);
      drafts[topic] = draft;
    } else {
      const updatedDrafts = { ...drafts, [topic]: draft };
      window.localStorage.setItem(LEGACY_KEY, JSON.stringify(updatedDrafts));
      drafts = updatedDrafts;
    }
    window.dispatchEvent(new Event("interslation:drafts-changed"));
    notifyOtherTabs();
    return { usingLocalStorage };
  }

  async function replaceAll(nextDrafts) {
    await readyPromise;
    const records = Object.entries(nextDrafts || {}).map(([topic, draft]) => ({ topic, draft }));
    if (database) {
      await writeRecords(records, true);
      drafts = Object.fromEntries(records.map(({ topic, draft }) => [topic, draft]));
      try {
        window.localStorage.removeItem(LEGACY_KEY);
      } catch (error) {
        console.warn("Không thể xóa bản nháp cũ sau khi đồng bộ:", error);
      }
    } else {
      window.localStorage.setItem(LEGACY_KEY, JSON.stringify(nextDrafts || {}));
      drafts = { ...(nextDrafts || {}) };
    }
    notifyOtherTabs();
  }

  async function refreshFromDatabase() {
    if (!database) return;
    drafts = await readDatabaseDrafts();
    dispatchLoaded();
  }

  window.interslationDraftStorage = {
    getAll: () => ({ ...drafts }),
    getAllAsync,
    save,
    replaceAll
  };

  if (broadcastChannel) {
    broadcastChannel.onmessage = () => {
      refreshFromDatabase().catch((error) => console.error("Không thể cập nhật bản nháp từ thẻ khác:", error));
    };
  }
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_SIGNAL_KEY) {
      refreshFromDatabase().catch((error) => console.error("Không thể cập nhật bản nháp từ thẻ khác:", error));
    }
  });
})();
