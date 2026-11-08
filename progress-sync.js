(() => {
  const SESSION_KEY = "interslation-supabase-session-v1";
  const LOCAL_OWNER_KEY = "interslation-progress-owner-v1";
  const HISTORY_KEY = "lingua-lab-practice-history-v1";
  const TRANSLATION_HISTORY_KEY = "lingua-lab-translation-history-v1";
  const DELETED_TRANSLATION_HISTORY_KEY = "interslation-deleted-translation-history-v1";
  const MATERIALS_KEY = "lingua-lab-personal-materials-v1";
  const TOPICS_KEY = "lingua-lab-personal-topics-v1";
  const DRAFTS_KEY = "lingua-lab-personal-drafts-v1";
  const HISTORY_TOMBSTONES_KEY = "interslation-deleted-history-v1";
  const DATABASE_NAME = "interslation-practice-media-v1";
  const MEDIA_STORE = "sessions";
  const TABLE = "interslation_user_progress";
  const BUCKET = "interslation-user-progress";
  const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
  const MAX_HISTORY = 30;
  const MAX_TRANSLATION_HISTORY = 30;
  const statusElement = document.querySelector("#progress-sync-status");
  const toastElement = document.querySelector("#progress-sync-toast");
  let activeUserId = "";
  let syncTimer = null;
  let syncPromise = null;
  let syncAgain = false;
  let applyingRemoteData = false;

  function setStatus(text, isError = false) {
    statusElement.textContent = text;
    statusElement.classList.toggle("is-error", isError);
    toastElement.hidden = !text;
  }

  document.querySelector("#dismiss-sync-toast").addEventListener("click", () => {
    toastElement.hidden = true;
  });

  function getSession() {
    const session = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    if (!session?.access_token || !session?.user?.id) {
      throw new Error("Không tìm thấy phiên đăng nhập hợp lệ để đồng bộ.");
    }
    return session;
  }

  function getConfig() {
    const config = window.interslationSupabaseConfig;
    if (!config?.url || !config?.key) throw new Error("Ứng dụng chưa được cấu hình kết nối Supabase.");
    return { url: config.url.replace(/\/+$/, ""), key: config.key };
  }

  function parseLocalValue(key, fallback, validator) {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    if (!validator(value)) throw new Error(`Dữ liệu tiến trình “${key}” không đúng định dạng.`);
    return value;
  }

  function readLocalProgress() {
    return {
      history: parseLocalValue(HISTORY_KEY, [], Array.isArray),
      translationHistory: parseLocalValue(TRANSLATION_HISTORY_KEY, [], Array.isArray),
      translationHistoryTombstones: parseLocalValue(DELETED_TRANSLATION_HISTORY_KEY, [], Array.isArray),
      materials: parseLocalValue(MATERIALS_KEY, [], Array.isArray),
      topics: parseLocalValue(TOPICS_KEY, [], Array.isArray),
      drafts: parseLocalValue(DRAFTS_KEY, {}, (value) => value && typeof value === "object" && !Array.isArray(value)),
      historyTombstones: parseLocalValue(HISTORY_TOMBSTONES_KEY, [], Array.isArray)
    };
  }

  function writeLocalProgress(progress) {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(progress.history));
    window.localStorage.setItem(TRANSLATION_HISTORY_KEY, JSON.stringify(progress.translationHistory || []));
    window.localStorage.setItem(DELETED_TRANSLATION_HISTORY_KEY, JSON.stringify(progress.translationHistoryTombstones || []));
    window.localStorage.setItem(MATERIALS_KEY, JSON.stringify(progress.materials));
    window.localStorage.setItem(TOPICS_KEY, JSON.stringify(progress.topics));
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(progress.drafts));
    window.localStorage.setItem(HISTORY_TOMBSTONES_KEY, JSON.stringify(progress.historyTombstones));
  }

  function openMediaDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("Trình duyệt này không hỗ trợ đồng bộ bản ghi âm."));
        return;
      }
      const request = window.indexedDB.open(DATABASE_NAME, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Không thể mở kho bản ghi âm."));
      request.onblocked = () => reject(new Error("Kho bản ghi âm đang được dùng ở thẻ khác."));
    });
  }

  async function getLocalMedia() {
    const database = await openMediaDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(MEDIA_STORE, "readonly");
      const request = transaction.objectStore(MEDIA_STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Không thể đọc bản ghi âm trên thiết bị."));
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => database.close();
    });
  }

  async function writeLocalMedia(records) {
    const database = await openMediaDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(MEDIA_STORE, "readwrite");
      const store = transaction.objectStore(MEDIA_STORE);
      store.clear();
      records.forEach((record) => store.put(record));
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error || new Error("Không thể khôi phục bản ghi âm trên thiết bị."));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error || new Error("Khôi phục bản ghi âm đã bị hủy."));
      };
    });
  }

  async function refreshAccessToken() {
    const config = getConfig();
    const session = getSession();
    if (!session.refresh_token) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để đồng bộ.");
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: config.key, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    const result = await readResponse(response, "Không thể gia hạn phiên đăng nhập.");
    if (!result.access_token || !result.refresh_token) throw new Error("Supabase không trả về phiên đăng nhập mới hợp lệ.");
    const updatedSession = {
      ...session,
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_at: Number(result.expires_at) || Math.floor(Date.now() / 1000) + (Number(result.expires_in) || 3600),
      user: result.user || session.user
    };
    if (window.interslationAuth?.updateSession) {
      window.interslationAuth.updateSession(updatedSession);
    } else {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(updatedSession));
    }
    return updatedSession;
  }

  async function readResponse(response, fallback) {
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error("Supabase trả về phản hồi không hợp lệ.");
      }
    }
    if (!response.ok) {
      const message = data.message || data.msg || data.error_description || data.error || fallback;
      const error = new Error(message);
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  }

  async function supabaseFetch(path, options = {}, canRefresh = true) {
    const config = getConfig();
    let session = getSession();
    if (Number(session.expires_at) <= Math.floor(Date.now() / 1000) + 60) {
      session = await refreshAccessToken();
    }
    const response = await fetch(`${config.url}${path}`, {
      ...options,
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${session.access_token}`,
        ...(options.headers || {})
      }
    });
    if (response.status === 401 && canRefresh) {
      await refreshAccessToken();
      return supabaseFetch(path, options, false);
    }
    return response;
  }

  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function mergeUnique(first, second, keyOf) {
    const values = new Map();
    [...first, ...second].forEach((value) => {
      const key = keyOf(value);
      if (key !== undefined && key !== null && key !== "") values.set(String(key), value);
    });
    return [...values.values()];
  }

  function uniqueTopic(topics, topic) {
    return !topics.some((existing) => existing.toLocaleLowerCase() === topic.toLocaleLowerCase());
  }

  function mergeDrafts(cloudDrafts, localDrafts, topics) {
    const drafts = { ...cloudDrafts };
    Object.entries(localDrafts).forEach(([topic, draft]) => {
      if (!drafts[topic] || canonical(drafts[topic]) === canonical(draft)) {
        drafts[topic] = draft;
        return;
      }
      let copyTopic = `${topic} (thiết bị)`;
      let suffix = 2;
      while (drafts[copyTopic]) {
        copyTopic = `${topic} (thiết bị ${suffix})`;
        suffix += 1;
      }
      drafts[copyTopic] = draft;
      if (uniqueTopic(topics, copyTopic)) topics.push(copyTopic);
    });
    return drafts;
  }

  function mergeProgress(cloudProgress, localProgress) {
    const topics = mergeUnique(cloudProgress.topics || [], localProgress.topics || [],
      (topic) => typeof topic === "string" ? topic.trim().toLocaleLowerCase() : "");
    const topicNames = topics.filter((topic) => typeof topic === "string" && topic.trim());
    const drafts = mergeDrafts(cloudProgress.drafts || {}, localProgress.drafts || {}, topicNames);
    const historyTombstones = mergeUnique(
      cloudProgress.historyTombstones || [],
      localProgress.historyTombstones || [],
      (item) => item?.id
    ).filter((item) => item && Number(item.deletedAt) > Date.now() - 30 * 24 * 60 * 60 * 1000);
    const deletedIds = new Set(historyTombstones.map((item) => item.id));
    const history = mergeUnique(cloudProgress.history || [], localProgress.history || [],
      (entry) => entry?.storageId || entry?.date)
      .filter((entry) => entry && typeof entry.date === "string")
      .filter((entry) => !deletedIds.has(entry.storageId || entry.date))
      .filter((entry) => (Number(entry.expiresAt) || Date.parse(entry.date) + RETENTION_MS) > Date.now())
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, MAX_HISTORY);
    const translationHistoryTombstones = mergeUnique(
      cloudProgress.translationHistoryTombstones || [],
      localProgress.translationHistoryTombstones || [],
      (item) => item?.id
    ).filter((item) => item && typeof item.id === "string" && Number.isFinite(Number(item.deletedAt)));
    const deletedTranslationIds = new Set(translationHistoryTombstones.map((item) => item.id));
    const translationHistory = mergeUnique(
      cloudProgress.translationHistory || [],
      localProgress.translationHistory || [],
      (entry) => entry?.id
    )
      .filter((entry) => entry && typeof entry.id === "string" && typeof entry.date === "string")
      .filter((entry) => !deletedTranslationIds.has(entry.id))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, MAX_TRANSLATION_HISTORY);
    const materials = mergeUnique(cloudProgress.materials || [], localProgress.materials || [], (item) => item?.id);
    return { history, translationHistory, translationHistoryTombstones, materials, topics: topicNames, drafts, historyTombstones };
  }

  function mediaPath(userId, mediaId, name) {
    if (!/^[\w-]+$/.test(userId) || !/^[\w-]+$/.test(mediaId) || !/^(source|source-recording|voice)$/.test(name)) {
      throw new Error("Đường dẫn bản ghi âm không hợp lệ.");
    }
    return `${userId}/${mediaId}/${name}`;
  }

  function encodedStoragePath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  async function loadCloudProgress(userId) {
    const response = await supabaseFetch(`/rest/v1/${TABLE}?select=payload&user_id=eq.${encodeURIComponent(userId)}`);
    const rows = await readResponse(response, "Không thể tải tiến trình từ Supabase.");
    if (!Array.isArray(rows) || !rows.length) {
      return { history: [], translationHistory: [], translationHistoryTombstones: [], materials: [], topics: [], drafts: {}, historyTombstones: [], media: [] };
    }
    const payload = rows[0].payload;
    if (!payload || payload.version !== 1 || !payload.progress) {
      throw new Error("Dữ liệu tài khoản có phiên bản không hỗ trợ; dữ liệu cục bộ chưa bị thay đổi.");
    }
    return {
      ...payload.progress,
      media: Array.isArray(payload.media) ? payload.media : []
    };
  }

  async function saveCloudProgress(userId, progress, media) {
    const row = {
      user_id: userId,
      payload: { version: 1, progress, media },
      updated_at: new Date().toISOString()
    };
    const updateExisting = async () => {
      const response = await supabaseFetch(
        `/rest/v1/${TABLE}?user_id=eq.${encodeURIComponent(userId)}&select=user_id`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify(row)
        }
      );
      const updatedRows = await readResponse(response, "Không thể cập nhật tiến trình trên Supabase.");
      return Array.isArray(updatedRows) && updatedRows.length > 0;
    };

    if (await updateExisting()) return;

    const response = await supabaseFetch(`/rest/v1/${TABLE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row)
    });
    try {
      await readResponse(response, "Không thể lưu tiến trình vào Supabase.");
    } catch (error) {
      if (error.status !== 409 && error.code !== "23505") throw error;
      if (!(await updateExisting())) throw error;
    }
  }

  async function uploadMedia(userId, mediaId, field, blob) {
    if (!(blob instanceof Blob)) return "";
    const path = mediaPath(userId, mediaId, field);
    const response = await supabaseFetch(`/storage/v1/object/${BUCKET}/${encodedStoragePath(path)}`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream", "x-upsert": "true" },
      body: blob
    });
    await readResponse(response, "Không thể tải bản ghi âm lên Supabase Storage.");
    return path;
  }

  async function downloadMedia(userId, path) {
    if (typeof path !== "string" || !path.startsWith(`${userId}/`)) {
      throw new Error("Đường dẫn bản ghi âm trên đám mây không hợp lệ.");
    }
    const response = await supabaseFetch(`/storage/v1/object/${BUCKET}/${encodedStoragePath(path)}`);
    if (!response.ok) await readResponse(response, "Không thể tải bản ghi âm từ Supabase Storage.");
    return response.blob();
  }

  async function deleteOrphanedMedia(cloudManifest, retainedManifest) {
    const retainedPaths = new Set(retainedManifest.flatMap((record) => Object.values(record.objects || {})));
    const stalePaths = [...new Set(cloudManifest.flatMap((record) => Object.values(record.objects || {})))]
      .filter((path) => typeof path === "string" && !retainedPaths.has(path));
    if (!stalePaths.length) return;
    const response = await supabaseFetch(`/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: stalePaths })
    });
    await readResponse(response, "Không thể dọn bản ghi âm đã hết hạn khỏi Supabase Storage.");
  }

  async function synchronizeMedia(userId, cloudManifest, localMedia, retainedHistory) {
    const historyIds = new Set(retainedHistory.map((entry) => entry.storageId).filter(Boolean));
    const localById = new Map(localMedia.filter((record) => record?.id && historyIds.has(record.id)).map((record) => [record.id, record]));
    const cloudById = new Map(cloudManifest.filter((record) => record?.id && historyIds.has(record.id)).map((record) => [record.id, record]));
    const combined = [];
    const manifest = [];

    for (const id of historyIds) {
      const local = localById.get(id);
      const cloud = cloudById.get(id);
      if (!local && !cloud) continue;
      const refs = { ...(cloud?.objects || {}) };
      const record = local || {
        id,
        expiresAt: cloud.expiresAt,
        sourceType: cloud.sourceType,
        sourceName: cloud.sourceName,
        sourceUrlText: cloud.sourceUrlText,
        sourceTimeline: Array.isArray(cloud.sourceTimeline) ? cloud.sourceTimeline : [],
        voiceMimeType: cloud.voiceMimeType
      };
      const blobs = [
        ["source", "sourceBlob"],
        ["source-recording", "sourceRecordingBlob"],
        ["voice", "voiceBlob"]
      ];
      for (const [field, property] of blobs) {
        const blob = local?.[property];
        if (blob) refs[field] = await uploadMedia(userId, id, field, blob);
        else if (cloud && refs[field]) record[property] = await downloadMedia(userId, refs[field]);
      }
      record.expiresAt = Number(record.expiresAt) || Number(cloud?.expiresAt) || Date.now() + RETENTION_MS;
      combined.push(record);
      manifest.push({
        id,
        expiresAt: record.expiresAt,
        sourceType: record.sourceType || cloud?.sourceType || "",
        sourceName: record.sourceName || cloud?.sourceName || "",
        sourceUrlText: record.sourceUrlText || cloud?.sourceUrlText || "",
        sourceTimeline: Array.isArray(record.sourceTimeline)
          ? record.sourceTimeline
          : Array.isArray(cloud?.sourceTimeline) ? cloud.sourceTimeline : [],
        voiceMimeType: record.voiceMimeType || cloud?.voiceMimeType || "audio/webm",
        objects: refs
      });
    }
    return { combined, manifest };
  }

  async function runSync(userId) {
    const session = getSession();
    if (session.user.id !== userId) return;
    setStatus("");
    const localOwner = window.localStorage.getItem(LOCAL_OWNER_KEY);
    const switchingAccount = Boolean(localOwner && localOwner !== userId);
    const [cloud, local, localMedia] = await Promise.all([
      loadCloudProgress(userId),
      Promise.resolve(switchingAccount
        ? { history: [], translationHistory: [], translationHistoryTombstones: [], materials: [], topics: [], drafts: {}, historyTombstones: [] }
        : readLocalProgress()),
      switchingAccount ? Promise.resolve([]) : getLocalMedia()
    ]);
    if (activeUserId !== userId) return;
    const merged = mergeProgress(cloud, local);
    const media = await synchronizeMedia(userId, cloud.media || [], localMedia, merged.history);
    if (activeUserId !== userId) return;
    await deleteOrphanedMedia(cloud.media || [], media.manifest);
    await saveCloudProgress(userId, merged, media.manifest);
    applyingRemoteData = true;
    try {
      writeLocalProgress(merged);
      await writeLocalMedia(media.combined);
      window.localStorage.setItem(LOCAL_OWNER_KEY, userId);
    } finally {
      applyingRemoteData = false;
    }
    window.dispatchEvent(new Event("interslation:progress-restored"));
    setStatus("");
  }

  function isStaleConflictError(error) {
    const message = String(error?.message || "");
    return error?.code === "42P10"
      || /no unique or exclusion constraint matching the ON CONFLICT specification/i.test(message);
  }

  function syncErrorMessage(error) {
    if (/index row size \d+ exceeds btree version \d+ maximum \d+ for index "interslation_user_progress_pkey"/i.test(String(error?.message || ""))) {
      return "Cấu hình bảng đồng bộ Supabase chưa đúng. Hãy chạy lại supabase/schema.sql trong SQL Editor để sửa khóa chính.";
    }
    return `Không thể đồng bộ tiến trình: ${error?.message || "Đã xảy ra lỗi."}`;
  }

  function scheduleSync(delay = 1200) {
    if (!activeUserId || applyingRemoteData) return;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      if (syncPromise) {
        syncAgain = true;
        return;
      }
      const userId = activeUserId;
      syncPromise = runSync(userId)
        .catch((error) => {
          if (activeUserId === userId) {
            if (isStaleConflictError(error)) setStatus("");
            else setStatus(syncErrorMessage(error), true);
            console.error("Không thể đồng bộ tiến trình Supabase:", error);
          }
        })
        .finally(() => {
          syncPromise = null;
          if (syncAgain && activeUserId) {
            syncAgain = false;
            scheduleSync(0);
          }
        });
    }, delay);
  }

  window.addEventListener("interslation:auth-change", (event) => {
    window.clearTimeout(syncTimer);
    if (!event.detail?.signedIn || !event.detail.userId) {
      activeUserId = "";
      syncAgain = false;
      setStatus("");
      return;
    }
    activeUserId = event.detail.userId;
    scheduleSync(0);
  });

  window.addEventListener("interslation:progress-changed", () => scheduleSync());
  window.addEventListener("online", () => scheduleSync(0));
  window.addEventListener("storage", (event) => {
    if ([HISTORY_KEY, MATERIALS_KEY, TOPICS_KEY, DRAFTS_KEY].includes(event.key)) scheduleSync();
  });
  try {
    const session = getSession();
    activeUserId = session.user.id;
    scheduleSync(0);
  } catch (error) {
    if (window.localStorage.getItem(SESSION_KEY)) {
      setStatus("Không thể đọc phiên đăng nhập để đồng bộ. Hãy đăng xuất rồi đăng nhập lại.", true);
    }
  }
})();
