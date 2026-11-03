(function () {
  let currentPort = 23518;
  const selectedMode = "embed";
  let currentLang = "zh-CN";

  const I18N = {
    "zh-CN": {
      header_title: "小蠢 AI 伴侣 设置",
      header_desc: "选择虚拟形象的呈现形态与常驻运行模式",
      section_mode: "运行形态配置",
      embed_title: "Cindy 内嵌伴侣视窗",
      embed_badge_noinstall: "免安装 · 开箱即用",
      embed_desc: "直接在 Cindy 侧边栏/主视窗中渲染伴侣视窗，支持实时伴读、肢体动作、服装切换与面部表情。开箱即用，0 门槛免安装，不占用桌面置顶层。",
      desktop_title: "桌面独立桌宠形态",
      desktop_badge_unsupported: "暂不支持",
      desktop_desc: "暂不支持桌面独立桌宠形态，当前仅支持 Cindy 侧边栏内嵌视窗模式。",
      repo_title: "Project XiaoChun · 开源来源声明",
      repo_author: "作者：",
      repo_license: "协议：",
      repo_version: "版本：",
      repo_github: "GitHub 仓库",
      repo_official: "官方主页",
      footer_security: "✨ 小蠢作为原生 3D AI 伴侣轻量常驻 Cindy 侧边栏，开箱即用。",
      btn_save: "保存设置",
      toast_saved_embed: "✅ 设置已成功保存！"
    },
    "en": {
      header_title: "XiaoChun AI Companion Settings",
      header_desc: "Choose avatar presence mode and resident running configuration",
      section_mode: "Runtime Mode Configuration",
      embed_title: "Cindy Embed Panel Window",
      embed_badge_noinstall: "Zero-Install · Instant Ready",
      embed_desc: "Renders the companion window directly in Cindy sidebar or main tab. Supports synchronized reading, body motions, outfit swap, and facial expressions. Zero install, ready to use, no desktop footprint.",
      desktop_title: "Desktop Standalone Pet",
      desktop_badge_unsupported: "Not Supported",
      desktop_desc: "Desktop Standalone Pet mode is not supported at this stage. Cindy Embedded View mode is currently supported.",
      repo_title: "Project XiaoChun · Open Source Statement",
      repo_author: "Author: ",
      repo_license: "License: ",
      repo_version: "Version: ",
      repo_github: "GitHub Repo",
      repo_official: "Official Site",
      footer_security: "✨ XiaoChun stays light in Cindy sidebar as a native 3D AI companion, zero-install.",
      btn_save: "Save Settings",
      toast_saved_embed: "✅ Settings successfully saved!"
    },
    "ja": {
      header_title: "小蠢 AIパートナー設定",
      header_desc: "アバターの表示形態と常駐実行モードを選択",
      section_mode: "動作形態の設定",
      embed_title: "Cindy 内蔵パネル視窗",
      embed_badge_noinstall: "インストール不要 · すぐ使える",
      embed_desc: "Cindy のサイドバーやメインタブ内で直接パートナー視窓をレンダリング。リアルタイム朗読、動作、着せ替え、表情変化に対応。インストール不要で即座に使えます。",
      desktop_title: "デスクトップ独立ペット",
      desktop_badge_unsupported: "現在非対応",
      desktop_desc: "デスクトップ独立ペット形態は現在非対応です。Cindy 内蔵パネル視窓をご利用ください。",
      repo_title: "Project XiaoChun · オープンソース宣言",
      repo_author: "作者：",
      repo_license: "ライセンス：",
      repo_version: "バージョン：",
      repo_github: "GitHub リポジトリ",
      repo_official: "公式サイト",
      footer_security: "✨ 小蠢はインストール不要の Cindy サイドバー専属 3D パートナーとして動作します。",
      btn_save: "設定を保存",
      toast_saved_embed: "✅ 設定を保存しました！"
    },
    "ko": {
      header_title: "샤오춘 AI 메이트 설정",
      header_desc: "아바타 표현 형태 및 상주 실행 모드 선택",
      section_mode: "실행 형태 설정",
      embed_title: "Cindy 내장 패널 뷰",
      embed_badge_noinstall: "무설치 · 즉시 사용",
      embed_desc: "Cindy 사이드바 및 메인 탭에 메이트 뷰를 직접 렌더링합니다. 실시간 낭독, 모션, 의상 변경, 표정 연동을 지원하며 설치 없이 바로 사용 가능합니다。",
      desktop_title: "데스크톱 독립 펫 형태",
      desktop_badge_unsupported: "현재 미지원",
      desktop_desc: "데스크톱 독립 펫 형태는 현재 지원되지 않으며, Cindy 내장 패널 뷰만 지원됩니다。",
      repo_title: "Project XiaoChun · 오픈소스 성명",
      repo_author: "작성자: ",
      repo_license: "라이선스: ",
      repo_version: "버전: ",
      repo_github: "GitHub 저장소",
      repo_official: "공식 홈페이지",
      footer_security: "✨ 샤오춘은 별도 설치 없이 Cindy 사이드바 상주 3D AI 메이트로 동작합니다。",
      btn_save: "설정 저장",
      toast_saved_embed: "✅ 설정이 저장되었습니다!"
    }
  };

  function t(key) {
    const dict = I18N[currentLang] || I18N["zh-CN"];
    return dict[key] || I18N["zh-CN"][key] || key;
  }

  const cardEmbed = document.getElementById("card-embed");
  const cardDesktop = document.getElementById("card-desktop");
  const btnSave = document.getElementById("btn-save");
  const toast = document.getElementById("toast");

  function applyLocale(lang) {
    if (!I18N[lang]) {
      if (lang && lang.startsWith("zh")) lang = "zh-CN";
      else if (lang && lang.startsWith("ja")) lang = "ja";
      else if (lang && lang.startsWith("ko")) lang = "ko";
      else lang = "en";
    }
    currentLang = lang;
    document.documentElement.lang = lang;

    const setTxt = (id, key) => {
      const el = document.getElementById(id);
      if (el) el.textContent = t(key);
    };

    setTxt("header-title", "header_title");
    setTxt("header-desc", "header_desc");
    setTxt("section-title", "section_mode");
    setTxt("mode-name-embed", "embed_title");
    setTxt("badge-embed-noinstall", "embed_badge_noinstall");
    setTxt("mode-desc-embed", "embed_desc");
    setTxt("mode-name-desktop", "desktop_title");
    setTxt("badge-desktop-unsupported", "desktop_badge_unsupported");
    setTxt("mode-desc-desktop", "desktop_desc");
    setTxt("repo-title-text", "repo_title");
    setTxt("repo-link-github", "repo_github");
    setTxt("repo-link-official", "repo_official");
    setTxt("footer-security-text", "footer_security");
    setTxt("btn-save", "btn_save");

    const authorEl = document.getElementById("repo-author-text");
    if (authorEl) authorEl.innerHTML = t("repo_author") + "<strong>FireTable</strong>";
    const licenseEl = document.getElementById("repo-license-text");
    if (licenseEl) licenseEl.innerHTML = t("repo_license") + "<strong>MIT</strong>";
    const versionEl = document.getElementById("repo-version-text");
    if (versionEl) versionEl.innerHTML = t("repo_version") + "<strong>v1.0.6</strong>";
  }

  async function initLocale() {
    let detected = null;
    // 1. 优先尝试读取 Cindy 官方推荐的 /app-context 宿主端点 (带超时保护防死锁)
    try {
      const r = await fetch("/app-context", { signal: AbortSignal.timeout(400) });
      if (r.ok) {
        const data = await r.json();
        if (data && data.context && data.context.locale) {
          detected = data.context.locale;
        } else if (data && data.locale) {
          detected = data.locale;
        }
      }
    } catch (_) {}

    // 2. 尝试 cindy.request 宿主桥接 (带超时保护防死锁)
    if (!detected) {
      try {
        if (typeof window.cindy !== "undefined" && typeof window.cindy.request === "function") {
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 400));
          const res = await Promise.race([window.cindy.request({ kind: "app-context" }), timeoutPromise]);
          if (res && res.context && res.context.locale) {
            detected = res.context.locale;
          }
        }
      } catch (_) {}
    }

    if (!detected) {
      const urlLang = new URLSearchParams(window.location.search).get("lang");
      if (urlLang) detected = urlLang;
      else {
        const nav = (navigator.language || "").toLowerCase();
        if (nav.startsWith("zh")) detected = "zh-CN";
        else if (nav.startsWith("ja")) detected = "ja";
        else if (nav.startsWith("ko")) detected = "ko";
        else detected = "en";
      }
    }

    applyLocale(detected || "zh-CN");

    try {
      if (typeof window.cindy !== "undefined" && window.cindy.onHostMessage) {
        window.cindy.onHostMessage((msg) => {
          if (msg && msg.type === "host-context-changed" && msg.context && msg.context.locale) {
            applyLocale(msg.context.locale);
          }
        });
      }
    } catch (_) {}
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2600);
  }

  // 始终锁定 embed 模式
  if (cardEmbed) cardEmbed.classList.add("active");
  if (cardDesktop) {
    cardDesktop.classList.remove("active");
    cardDesktop.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
  }

  // 外部链接安全调起宿主系统默认浏览器
  function openExternalUrl(e, url) {
    if (e) e.preventDefault();
    try {
      if (typeof window.cindy !== "undefined" && typeof window.cindy.openExternal === "function") {
        window.cindy.openExternal(url);
        return;
      }
    } catch (_) {}
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const linkGithub = document.getElementById("repo-link-github");
  if (linkGithub) linkGithub.onclick = (e) => openExternalUrl(e, "https://github.com/FireTable/project-xiaochun");
  const linkOfficial = document.getElementById("repo-link-official");
  if (linkOfficial) linkOfficial.onclick = (e) => openExternalUrl(e, "https://xiaochun.firetable.tech");

  // 获取桥接端口与配置
  async function loadConfig() {
    currentPort = 23518;
    try {
      const res = await fetch("/bridge-port.json?t=" + Date.now(), { signal: AbortSignal.timeout(400) });
      if (res.ok) {
        const data = await res.json();
        if (data && data.port && typeof data.port === "number") currentPort = data.port;
      }
    } catch (_) {}
  }

  // 保存设置
  if (btnSave) {
    btnSave.onclick = async () => {
      let saved = false;
      try {
        const res = await fetch(
          `http://127.0.0.1:${currentPort}/api/config`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ preferredMode: "embed" }),
            signal: AbortSignal.timeout(1200)
          },
        );
        if (res.ok) saved = true;
      } catch (_) {}

      if (!saved && currentPort !== 23518) {
        try {
          const resFallback = await fetch(
            `http://127.0.0.1:23518/api/config`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ preferredMode: "embed" }),
              signal: AbortSignal.timeout(1200)
            },
          );
          if (resFallback.ok) {
            saved = true;
            currentPort = 23518;
          }
        } catch (_) {}
      }

      showToast(t("toast_saved_embed"));
      try {
        if (typeof BroadcastChannel !== "undefined") {
          const bc = new BroadcastChannel("xiaochun_cindy_bridge");
          bc.postMessage({ type: "mode_changed", mode: "embed" });
        }
      } catch (_) {}
    };
  }

  initLocale();
  loadConfig();
})();
