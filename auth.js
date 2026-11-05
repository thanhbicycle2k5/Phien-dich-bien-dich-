(() => {
  const SESSION_KEY = "interslation-supabase-session-v1";
  const dialog = document.querySelector("#auth-dialog");
  const message = document.querySelector("#auth-message");
  const emailLink = document.querySelector("#auth-email-link");
  const identity = document.querySelector("#auth-identity");
  const openButton = document.querySelector("#auth-open");
  const signoutButton = document.querySelector("#auth-signout");
  let session = null;
  function setMessage(text, isError = false, inboxUrl = "") {
    message.textContent = text;
    message.classList.toggle("is-error", isError);
    emailLink.hidden = !inboxUrl;
    emailLink.href = inboxUrl || "#";
    emailLink.textContent = inboxUrl === "https://mail.google.com/" ? "Mở Gmail" : "Mở hộp thư";
  }

  function setView(view) {
    document.querySelectorAll("[data-auth-form]").forEach((form) => {
      form.hidden = form.dataset.authForm !== view;
    });
    document.querySelectorAll("[data-auth-view]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.authView === view));
    });
    document.querySelector("#auth-switch").hidden = view === "recovery";
    document.querySelector("#auth-title").textContent = view === "recovery"
      ? "Đặt mật khẩu mới"
      : view === "signup" ? "Tạo tài khoản" : view === "forgot" ? "Đặt lại mật khẩu" : "Tài khoản Interslation";
    setMessage("");
  }

  function readConfig() {
    const config = window.interslationSupabaseConfig;
    if (!config || typeof config.url !== "string" || typeof config.key !== "string" || !config.key.trim()) {
      throw new Error("Ứng dụng chưa được cấu hình kết nối Supabase.");
    }

    let url;
    try {
      url = new URL(config.url);
    } catch (error) {
      throw new Error("Project URL Supabase không hợp lệ.");
    }
    const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && localHost))
      || url.username || url.password || url.search || url.hash || !config.key.trim()) {
      throw new Error("Hãy kiểm tra Project URL và public key Supabase.");
    }

    return { url: url.toString().replace(/\/+$/, ""), key: config.key.trim() };
  }

  function saveSession(response, announce = true) {
    if (!response || typeof response.access_token !== "string" || typeof response.refresh_token !== "string") {
      throw new Error("Supabase không trả về phiên đăng nhập hợp lệ.");
    }
    session = {
      access_token: response.access_token,
      refresh_token: response.refresh_token,
      expires_at: Number(response.expires_at) || Math.floor(Date.now() / 1000) + (Number(response.expires_in) || 3600),
      user: response.user || session?.user || null
    };
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (error) {
      session = null;
      throw new Error("Không thể lưu phiên đăng nhập trên thiết bị này.");
    }
    renderIdentity();
    if (announce) announceSession();
  }

  function announceSession() {
    if (!session?.user?.id) return;
    window.dispatchEvent(new CustomEvent("interslation:auth-change", {
      detail: { userId: session.user.id, accessToken: session.access_token, signedIn: true }
    }));
  }

  function clearSession() {
    session = null;
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch (error) {
      throw new Error("Không thể xóa phiên đăng nhập trên thiết bị này.");
    }
    renderIdentity();
    window.dispatchEvent(new CustomEvent("interslation:auth-change", { detail: { signedIn: false } }));
  }

  window.interslationAuth = {
    updateSession(response) {
      saveSession(response, false);
    }
  };

  function renderIdentity() {
    const email = session?.user?.email;
    identity.textContent = email || "Không gian luyện tập của bạn";
    openButton.hidden = Boolean(email);
    signoutButton.hidden = !email;
  }

  function authError(data, fallback) {
    const raw = data?.msg || data?.message || data?.error_description || data?.error;
    if (typeof raw !== "string") return fallback;
    const knownMessages = {
      "Invalid login credentials": "Email hoặc mật khẩu không đúng.",
      "Email not confirmed": "Email chưa được xác nhận. Hãy kiểm tra hộp thư.",
      "User already registered": "Email này đã có tài khoản. Hãy đăng nhập hoặc đặt lại mật khẩu.",
      "Password should be at least 6 characters": "Mật khẩu cần có ít nhất 6 ký tự.",
      "Email rate limit exceeded": "Đã gửi quá nhiều email. Vui lòng thử lại sau."
    };
    return knownMessages[raw] || raw;
  }

  async function requestAuth(path, options = {}) {
    const config = readConfig();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(`${config.url}/auth/v1/${path}`, {
        method: options.method || "POST",
        headers: {
          apikey: config.key,
          Authorization: "Bearer " + (options.token || config.key),
          "Content-Type": "application/json"
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("Supabase phản hồi quá lâu. Hãy kiểm tra kết nối mạng rồi thử lại.");
      }
      throw new Error("Không kết nối được Supabase. Hãy kiểm tra mạng và thử lại.");
    } finally {
      window.clearTimeout(timeoutId);
    }
    const responseText = await response.text();
    let data = {};
    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch (error) {
        throw new Error("Supabase trả về phản hồi không hợp lệ.");
      }
    }
    if (!response.ok) {
      const error = new Error(authError(data, "Không thể hoàn tất yêu cầu tài khoản."));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function redirectUrl() {
    const url = new URL(window.location.href);
    url.hash = "";
    return url.toString();
  }

  function emailInboxUrl(email) {
    const domain = email.split("@").at(-1)?.toLowerCase();
    const inboxUrls = {
      "gmail.com": "https://mail.google.com/",
      "googlemail.com": "https://mail.google.com/",
      "outlook.com": "https://outlook.live.com/mail/",
      "hotmail.com": "https://outlook.live.com/mail/",
      "live.com": "https://outlook.live.com/mail/",
      "yahoo.com": "https://mail.yahoo.com/",
      "icloud.com": "https://www.icloud.com/mail/",
      "me.com": "https://www.icloud.com/mail/",
      "proton.me": "https://mail.proton.me/",
      "protonmail.com": "https://mail.proton.me/"
    };
    return inboxUrls[domain] || "";
  }

  function openDialog() {
    if (!dialog.open) dialog.showModal();
    if (window.location.protocol === "file:") {
      setMessage("Để kết nối Supabase, hãy chạy python3 server.py rồi mở http://localhost:8000.", true);
    }
  }

  function showAuthError(error, fallback) {
    setMessage(error.message || fallback, true);
  }

  function setFormBusy(form, busy) {
    form.querySelectorAll("button[type=submit]").forEach((button) => {
      button.disabled = busy;
    });
  }

  document.querySelectorAll(".auth-password-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const input = button.parentElement.querySelector("input");
      const isVisible = input.type === "text";
      input.type = isVisible ? "password" : "text";
      const label = isVisible ? "Hiện mật khẩu" : "Ẩn mật khẩu";
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      button.setAttribute("aria-pressed", String(!isVisible));
    });
  });

  function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  document.querySelectorAll("[data-auth-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.authView));
  });

  document.querySelector("#auth-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    setFormBusy(form, true);
    setMessage("Đang đăng nhập...");
    try {
      const data = await requestAuth("token?grant_type=password", {
        body: { email: values.email.trim(), password: values.password }
      });
      saveSession(data);
      setMessage("Đăng nhập thành công.");
      form.reset();
    } catch (error) {
      showAuthError(error, "Không thể đăng nhập.");
    } finally {
      setFormBusy(form, false);
    }
  });

  document.querySelector("#auth-signup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    if (values.password !== values["confirm-password"]) {
      setMessage("Mật khẩu nhập lại chưa khớp.", true);
      return;
    }
    setFormBusy(form, true);
    setMessage("Đang tạo tài khoản...");
    try {
      const data = await requestAuth(`signup?redirect_to=${encodeURIComponent(redirectUrl())}`, {
        body: { email: values.email.trim(), password: values.password }
      });
      if (data.access_token) {
        saveSession(data);
        setMessage("Tạo tài khoản và đăng nhập thành công.");
      } else {
        setMessage(
          "Tài khoản đã được tạo. Hãy mở email xác nhận; sau khi xác nhận, bạn sẽ được đưa về ứng dụng.",
          false,
          emailInboxUrl(values.email.trim())
        );
      }
      form.reset();
    } catch (error) {
      showAuthError(error, "Không thể tạo tài khoản.");
    } finally {
      setFormBusy(form, false);
    }
  });

  document.querySelector("#auth-forgot-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    setFormBusy(form, true);
    setMessage("Đang gửi email...");
    try {
      await requestAuth(`recover?redirect_to=${encodeURIComponent(redirectUrl())}`, {
        body: { email: values.email.trim() }
      });
      setMessage(
        "Nếu email có tài khoản, liên kết đặt lại mật khẩu sẽ được gửi tới hộp thư.",
        false,
        emailInboxUrl(values.email.trim())
      );
      form.reset();
    } catch (error) {
      showAuthError(error, "Không thể gửi email đặt lại mật khẩu.");
    } finally {
      setFormBusy(form, false);
    }
  });

  document.querySelector("#auth-recovery-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    if (values.password !== values["confirm-password"]) {
      setMessage("Mật khẩu nhập lại chưa khớp.", true);
      return;
    }
    if (!session?.access_token) {
      setMessage("Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới.", true);
      return;
    }
    setFormBusy(form, true);
    setMessage("Đang cập nhật mật khẩu...");
    try {
      await requestAuth("user", {
        method: "PUT",
        token: session.access_token,
        body: { password: values.password }
      });
      setView("login");
      form.reset();
      setMessage("Mật khẩu đã được cập nhật. Bạn có thể đăng nhập bằng mật khẩu mới.");
    } catch (error) {
      setMessage(error.message || "Không thể cập nhật mật khẩu.", true);
    } finally {
      setFormBusy(form, false);
    }
  });

  openButton.addEventListener("click", openDialog);
  document.querySelector("#auth-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) dialog.close();
  });

  signoutButton.addEventListener("click", async () => {
    if (!session?.access_token) return;
    signoutButton.disabled = true;
    try {
      await requestAuth("logout", { token: session.access_token });
      clearSession();
      setMessage("Đã đăng xuất.");
    } catch (error) {
      try {
        clearSession();
        setMessage(`Đã đăng xuất trên thiết bị này, nhưng Supabase chưa xác nhận: ${error.message}`, true);
      } catch (storageError) {
        setMessage("Không thể xóa phiên đăng nhập trên thiết bị này.", true);
      }
    } finally {
      signoutButton.disabled = false;
    }
  });

  async function restoreSession() {
    let hadSavedSession = false;
    try {
      const saved = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
      if (!saved?.access_token) return;
      hadSavedSession = true;
      session = saved;
      if (Number(saved.expires_at) <= Math.floor(Date.now() / 1000) + 60) {
        if (!saved.refresh_token) {
          clearSession();
          return;
        }
        const refreshed = await requestAuth("token?grant_type=refresh_token", {
          body: { refresh_token: saved.refresh_token }
        });
        saveSession(refreshed);
      }
      if (!session.user?.email) {
        const user = await requestAuth("user", { method: "GET", token: session.access_token });
        saveSession({ ...session, user });
      } else {
        renderIdentity();
        announceSession();
      }
    } catch (error) {
      if (error.status === 400 || error.status === 401) {
        try {
          clearSession();
        } catch (storageError) {
          console.error("Không thể xóa phiên Supabase hết hạn:", storageError);
        }
      } else {
        renderIdentity();
      }
      console.error("Không thể khôi phục phiên Supabase:", error);
      if (hadSavedSession) {
        openDialog();
        setMessage("Phiên đăng nhập không thể khôi phục. Hãy đăng nhập lại.", true);
      }
    }
  }

  async function handleAuthCallback() {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const type = parameters.get("type");
    const accessToken = parameters.get("access_token");
    if (parameters.has("error_description")) {
      openDialog();
      setMessage(parameters.get("error_description"), true);
      return true;
    }
    if (!accessToken || !["recovery", "signup", "email"].includes(type)) return false;

    try {
      const expiresIn = Number(parameters.get("expires_in")) || 3600;
      saveSession({
        access_token: accessToken,
        refresh_token: parameters.get("refresh_token") || "",
        expires_at: Number(parameters.get("expires_at")) || Math.floor(Date.now() / 1000) + expiresIn,
        user: { email: parameters.get("email") || "" }
      });
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      const user = await requestAuth("user", { method: "GET", token: session.access_token });
      saveSession({ ...session, user });
      if (type === "recovery") {
        setView("recovery");
        openDialog();
        setMessage("Tạo mật khẩu mới cho tài khoản của bạn.");
      } else {
        openDialog();
        setMessage("Email đã được xác nhận. Bạn có thể tiếp tục sử dụng tài khoản.");
      }
    } catch (error) {
      openDialog();
      setMessage(error.message || "Không thể hoàn tất xác nhận tài khoản.", true);
    }
    return true;
  }

  renderIdentity();
  handleAuthCallback().then((hasCallback) => {
    if (!hasCallback) return restoreSession();
  }).catch((error) => {
    openDialog();
    setMessage(error.message || "Không thể khôi phục phiên Supabase.", true);
  });
})();
