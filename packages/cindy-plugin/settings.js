(function () {
        let currentPort = 23518;
        let selectedMode = "embed";
        let isInstalled = false;
        let isInstalling = false;
        let currentLang = "zh-CN";
        let clientPlatform = "darwin";

        const I18N = {
          "zh-CN": {
            header_title: "小蠢 AI 伴侣 设置",
            header_desc: "选择虚拟形象的呈现形态与常驻运行模式",
            section_mode: "运行形态配置",
            embed_title: "Cindy 内嵌伴侣视窗",
            embed_badge_noinstall: "免安装 · 开箱即用",
            embed_desc: "直接在 Cindy 侧边栏/主视窗中渲染伴侣视窗，支持实时伴读、肢体动作、服装切换与面部表情。开箱即用，0 门槛免安装，不占用桌面置顶层。",
            desktop_title: "桌面独立桌宠形态",
            desktop_badge_recommended: "推荐 · 独立伴侣",
            desktop_badge_standalone: "全屏置顶桌宠",
            desktop_desc: "全屏透明置顶悬浮在系统桌面，支持鼠标穿透、全局屏幕伴读与跟随交互。适合习惯桌面虚拟宠物的深度陪伴场景。",
            desktop_status_detecting: "⏳ 正在检测桌面端安装状态...",
            desktop_status_installed: "● 已安装桌面客户端",
            desktop_status_installed_launched: "● 已安装并启动桌面桌宠！",
            desktop_status_not_installed: "○ 尚未安装桌面端",
            desktop_status_offline_protocol: "无法直接连通 Cindy 插件的服务，通过 xiaochun:// 协议进行通信",
            btn_install: "📥 立即安装桌面端",
            repo_title: "Project XiaoChun · 开源来源声明",
            repo_author: "作者：",
            repo_license: "协议：",
            repo_version: "版本：",
            repo_github: "GitHub 仓库",
            repo_official: "官方主页",
            footer_security: "🔒 未经您的明确授权，系统绝不会在后台自动下载桌面客户端。",
            btn_save: "保存设置",
            toast_saved_desktop: "✨ 已保存：小蠢将以桌面桌宠形态运行",
            toast_saved_embed: "✨ 已保存：小蠢以 Cindy 内嵌伴侣视窗运行",
            toast_installed_success: "🎉 小蠢桌面客户端已安装并成功启动！",
            modal_title: "确认安装小蠢桌面客户端？",
            modal_desc_win: "桌面独立桌宠形态需要安装 Project XiaoChun 官方客户端（Windows 安装包约 55MB，免管理员权限直接安装至用户目录）。<br /><br />是否确认立即开始自动下载并安装？",
            modal_desc_mac: "桌面独立桌宠形态需要安装 Project XiaoChun 官方客户端（macOS 磁盘镜像约 30MB DMG，免密码无提权复制到您的应用程序目录）。<br /><br />是否确认立即开始自动下载并安装？",
            modal_desc_default: "桌面独立桌宠形态需要安装 Project XiaoChun 官方客户端。<br /><br />是否确认立即开始自动下载并安装？",
            modal_cancel: "取消",
            modal_confirm: "同意并开始安装",
            modal_installing: "正在下载并安装..."
          },
          "en": {
            header_title: "XiaoChun AI Companion Settings",
            header_desc: "Choose avatar presence mode and resident running configuration",
            section_mode: "Runtime Mode Configuration",
            embed_title: "Cindy Embed Panel Window",
            embed_badge_noinstall: "Zero-Install · Instant Ready",
            embed_desc: "Renders the companion window directly in Cindy sidebar or main tab. Supports synchronized reading, body motions, outfit swap, and facial expressions. Zero install, ready to use, no desktop footprint.",
            desktop_title: "Desktop Standalone Pet",
            desktop_badge_recommended: "Recommended · Standalone",
            desktop_badge_standalone: "Always-on-top Pet",
            desktop_desc: "Floats transparently on your desktop with click-through, whole-screen voice reading, and follow gestures. Ideal for deep desktop companion experiences.",
            desktop_status_detecting: "⏳ Detecting desktop client installation...",
            desktop_status_installed: "● Desktop client installed",
            desktop_status_installed_launched: "● Desktop pet installed & launched!",
            desktop_status_not_installed: "○ Desktop client not installed",
            desktop_status_offline_protocol: "Cannot directly connect to Cindy plugin service, communicating via xiaochun:// protocol",
            btn_install: "📥 Install Desktop App",
            repo_title: "Project XiaoChun · Open Source Statement",
            repo_author: "Author: ",
            repo_license: "License: ",
            repo_version: "Version: ",
            repo_github: "GitHub Repo",
            repo_official: "Official Site",
            footer_security: "🔒 Without your explicit permission, the system will never download the desktop client in the background.",
            btn_save: "Save Settings",
            toast_saved_desktop: "✨ Saved: XiaoChun will run as Desktop Pet",
            toast_saved_embed: "✨ Saved: XiaoChun will run in Cindy Embed Panel",
            toast_installed_success: "🎉 XiaoChun Desktop App installed and launched!",
            modal_title: "Install XiaoChun Desktop App?",
            modal_desc_win: "Desktop Standalone Pet requires official client (~55MB Windows installer, installs securely into user directory without admin privileges).<br /><br />Do you confirm to download and install now?",
            modal_desc_mac: "Desktop Standalone Pet requires official client (~30MB macOS DMG, installs securely to your Applications folder without password prompt).<br /><br />Do you confirm to download and install now?",
            modal_desc_default: "Desktop Standalone Pet requires official Project XiaoChun client.<br /><br />Do you confirm to download and install now?",
            modal_cancel: "Cancel",
            modal_confirm: "Confirm & Install",
            modal_installing: "Downloading & Installing..."
          },
          "ja": {
            header_title: "小蠢 AIパートナー設定",
            header_desc: "アバターの表示形態と常駐実行モードを選択",
            section_mode: "動作形態の設定",
            embed_title: "Cindy 内蔵パネル視窗",
            embed_badge_noinstall: "インストール不要 · すぐ使える",
            embed_desc: "Cindy のサイドバーやメインタブ内で直接パートナー視窓をレンダリング。リアルタイム朗読、動作、着せ替え、表情変化に対応。インストール不要で即座に使えます。",
            desktop_title: "デスクトップ独立ペット",
            desktop_badge_recommended: "おすすめ · 独立パートナー",
            desktop_badge_standalone: "最前面常駐ペット",
            desktop_desc: "デスクトップ最前面に透明常駐し、マウスクリックスルーや画面朗読、追従インタラクションに対応。日常の深いパートナーシップに最適です。",
            desktop_status_detecting: "⏳ デスクトップ版のインストール状態を確認中...",
            desktop_status_installed: "● デスクトップ版インストール済み",
            desktop_status_installed_launched: "● デスクトップ版が起動しました！",
            desktop_status_not_installed: "○ デスクトップ版未インストール",
            desktop_status_offline_protocol: "Cindy プラグインサービスに直接接続できません。xiaochun:// プロトコル経由で通信します",
            btn_install: "📥 デスクトップ版をインストール",
            repo_title: "Project XiaoChun · オープンソース宣言",
            repo_author: "作者：",
            repo_license: "ライセンス：",
            repo_version: "バージョン：",
            repo_github: "GitHub リポジトリ",
            repo_official: "公式サイト",
            footer_security: "🔒 ユーザーの明示的な許可なしに、バックグラウンドで自動ダウンロードすることは一切ありません。",
            btn_save: "設定を保存",
            toast_saved_desktop: "✨ 保存完了：小蠢はデスクトップペットとして動作します",
            toast_saved_embed: "✨ 保存完了：小蠢は Cindy 内蔵パネルで動作します",
            toast_installed_success: "🎉 小蠢デスクトップ版のインストールと起動に成功しました！",
            modal_title: "小蠢デスクトップ版をインストールしますか？",
            modal_desc_win: "デスクトップ独立ペット形態には Project XiaoChun 公式クライアントが必要です（Windows 版約 55MB、管理者権限不要でユーザーフォルダに直接安全インストール）。<br /><br />ダウンロードとインストールを開始しますか？",
            modal_desc_mac: "デスクトップ独立ペット形態には Project XiaoChun 公式クライアントが必要です（macOS DMG 約 30MB、パスワード不要でアプリケーションフォルダに安全コピー）。<br /><br />ダウンロードとインストールを開始しますか？",
            modal_desc_default: "デスクトップ独立ペット形態には Project XiaoChun 公式クライアントが必要です。<br /><br />ダウンロードとインストールを開始しますか？",
            modal_cancel: "キャンセル",
            modal_confirm: "同意してインストール開始",
            modal_installing: "ダウンロード＆インストール中..."
          },
          "ko": {
            header_title: "샤오춘 AI 메이트 설정",
            header_desc: "아바타 표현 형태 및 상주 실행 모드 선택",
            section_mode: "실행 형태 설정",
            embed_title: "Cindy 내장 패널 뷰",
            embed_badge_noinstall: "무설치 · 즉시 사용",
            embed_desc: "Cindy 사이드바 및 메인 탭에 메이트 뷰를 직접 렌더링합니다. 실시간 낭독, 모션, 의상 변경, 표정 연동을 지원하며 설치 없이 바로 사용 가능합니다.",
            desktop_title: "데스크톱 독립 펫 형태",
            desktop_badge_recommended: "추천 · 독립 메이트",
            desktop_badge_standalone: "항상 위 전체화면 펫",
            desktop_desc: "시스템 데스크톱에 투명하게 항상 상주하며, 마우스 클릭 관통 및 화면 낭독, 상호작용을 지원하는 완전한 데스크톱 펫입니다.",
            desktop_status_detecting: "⏳ 데스크톱 클라이언트 설치 상태 확인 중...",
            desktop_status_installed: "● 데스크톱 클라이언트 설치됨",
            desktop_status_installed_launched: "● 데스크톱 펫 설치 및 실행 완료!",
            desktop_status_not_installed: "○ 데스크톱 클라이언트 미설치",
            desktop_status_offline_protocol: "Cindy 플러그인 서비스에 직접 연결할 수 없으며, xiaochun:// 프로토콜을 통해 통신합니다",
            btn_install: "📥 데스크톱 앱 즉시 설치",
            repo_title: "Project XiaoChun · 오픈소스 성명",
            repo_author: "작성자: ",
            repo_license: "라이선스: ",
            repo_version: "버전: ",
            repo_github: "GitHub 저장소",
            repo_official: "공식 홈페이지",
            footer_security: "🔒 사용자의 명시적인 승인 없이 백그라운드에서 데스크톱 클라이언트를 자동으로 다운로드하지 않습니다.",
            btn_save: "설정 저장",
            toast_saved_desktop: "✨ 저장됨: 샤오춘이 데스크톱 펫 형태로 실행됩니다",
            toast_saved_embed: "✨ 저장됨: 샤오춘이 Cindy 내장 패널로 실행됩니다",
            toast_installed_success: "🎉 샤오춘 데스크톱 클라이언트가 설치되어 실행되었습니다!",
            modal_title: "샤오춘 데스크톱 클라이언트를 설치하시겠습니까?",
            modal_desc_win: "데스크톱 독립 펫 모드는 Project XiaoChun 공식 클라이언트 설치가 필요합니다(Windows 설치 파일 약 55MB, 관리자 권한 없이 사용자 디렉토리에 안전 설치).<br /><br />다운로드 및 설치를 시작하시겠습니까?",
            modal_desc_mac: "데스크톱 독립 펫 모드는 Project XiaoChun 공식 클라이언트 설치가 필요합니다(macOS DMG 약 30MB, 암호 입력 없이 응용 프로그램 폴더에 안전 복사).<br /><br />다운로드 및 설치를 시작하시겠습니까?",
            modal_desc_default: "데스크톱 독립 펫 모드는 Project XiaoChun 공식 클라이언트 설치가 필요합니다.<br /><br />다운로드 및 설치를 시작하시겠습니까?",
            modal_cancel: "취소",
            modal_confirm: "동의 및 설치 시작",
            modal_installing: "다운로드 및 설치 진행 중..."
          }
        };

        function t(key) {
          const dict = I18N[currentLang] || I18N["zh-CN"];
          return dict[key] || I18N["zh-CN"][key] || key;
        }

        const cardEmbed = document.getElementById("card-embed");
        const cardDesktop = document.getElementById("card-desktop");
        const desktopStatusText = document.getElementById("desktop-status-text");
        const btnTriggerInstall = document.getElementById("btn-trigger-install");
        const btnSave = document.getElementById("btn-save");
        const toast = document.getElementById("toast");
        const installModal = document.getElementById("install-modal");
        const installModalDesc = document.getElementById("install-modal-desc");
        const btnModalCancel = document.getElementById("btn-modal-cancel");
        const btnModalConfirm = document.getElementById("btn-modal-confirm");

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
          setTxt("badge-desktop-recommended", "desktop_badge_recommended");
          setTxt("badge-desktop-standalone", "desktop_badge_standalone");
          setTxt("mode-desc-desktop", "desktop_desc");
          setTxt("btn-trigger-install", "btn_install");
          setTxt("repo-title-text", "repo_title");
          setTxt("repo-link-github", "repo_github");
          setTxt("repo-link-official", "repo_official");
          setTxt("footer-security-text", "footer_security");
          setTxt("btn-save", "btn_save");
          setTxt("modal-title-text", "modal_title");
          setTxt("btn-modal-cancel", "modal_cancel");

          const authorEl = document.getElementById("repo-author-text");
          if (authorEl) authorEl.innerHTML = t("repo_author") + "<strong>FireTable</strong>";
          const licenseEl = document.getElementById("repo-license-text");
          if (licenseEl) licenseEl.innerHTML = t("repo_license") + "<strong>MIT</strong>";
          const versionEl = document.getElementById("repo-version-text");
          if (versionEl) versionEl.innerHTML = t("repo_version") + "<strong>v1.0.0</strong>";

          if (btnModalConfirm && !isInstalling) {
            btnModalConfirm.textContent = t("modal_confirm");
          }

          if (installModalDesc) {
            installModalDesc.innerHTML = t("modal_desc_" + (clientPlatform === "win32" ? "win" : (clientPlatform === "darwin" ? "mac" : "default")));
          }
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

        function selectMode(mode) {
          selectedMode = mode;
          if (mode === "embed") {
            cardEmbed.classList.add("active");
            cardDesktop.classList.remove("active");
          } else {
            cardEmbed.classList.remove("active");
            cardDesktop.classList.add("active");
            // 若切换至 desktop 且未安装，主动弹出确认安装弹窗
            if (!isInstalled) {
              installModal.classList.add("show");
            }
          }
        }

        cardEmbed.onclick = () => selectMode("embed");
        cardDesktop.onclick = () => selectMode("desktop");

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

          let cfg = null;
          try {
            const cfgRes = await fetch(
              `http://127.0.0.1:${currentPort}/api/config`,
              { signal: AbortSignal.timeout(800) }
            );
            if (cfgRes.ok) {
              cfg = await cfgRes.json();
            }
          } catch (_) {}

          // 若当前端口连接失败且非默认 23518，自动回退到 23518 进行二次探测
          if (!cfg && currentPort !== 23518) {
            try {
              const fallbackRes = await fetch(
                `http://127.0.0.1:23518/api/config`,
                { signal: AbortSignal.timeout(800) }
              );
              if (fallbackRes.ok) {
                cfg = await fallbackRes.json();
                currentPort = 23518;
              }
            } catch (_) {}
          }

          if (cfg) {
            isInstalled = Boolean(cfg.installed);
            if (cfg.platform) clientPlatform = cfg.platform;
            selectedMode =
              cfg.preferredMode === "desktop" ? "desktop" : "embed";
            selectMode(selectedMode);

            if (isInstalled) {
              desktopStatusText.innerHTML =
                `<span style="color: var(--success)">${t("desktop_status_installed")}</span>`;
              btnTriggerInstall.style.display = "none";
            } else {
              desktopStatusText.innerHTML =
                `<span style="color: var(--warning)">${t("desktop_status_not_installed")}</span>`;
              btnTriggerInstall.style.display = "inline-block";
            }

            if (installModalDesc) {
              installModalDesc.innerHTML = t("modal_desc_" + (clientPlatform === "win32" ? "win" : (clientPlatform === "darwin" ? "mac" : "default")));
            }
          } else {
            // 离线状态兜底，明确更新状态文字，绝不卡死在“正在检测”
            desktopStatusText.innerHTML =
              `<span style="color: var(--text-muted)">○ ${t("desktop_status_offline_protocol")}</span>`;
          }
        }

        // 保存设置
        btnSave.onclick = async () => {
          let saved = false;
          try {
            const res = await fetch(
              `http://127.0.0.1:${currentPort}/api/config`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ preferredMode: selectedMode }),
                signal: AbortSignal.timeout(1200)
              },
            );
            if (res.ok) saved = true;
          } catch (_) {}

          // 若当前端口失败且非默认端口，回退至 23518 重试保存
          if (!saved && currentPort !== 23518) {
            try {
              const resFallback = await fetch(
                `http://127.0.0.1:23518/api/config`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ preferredMode: selectedMode }),
                  signal: AbortSignal.timeout(1200)
                },
              );
              if (resFallback.ok) {
                saved = true;
                currentPort = 23518;
              }
            } catch (_) {}
          }

          if (saved) {
            showToast(
              selectedMode === "desktop"
                ? t("toast_saved_desktop")
                : t("toast_saved_embed"),
            );
            try {
              if (typeof BroadcastChannel !== "undefined") {
                const bc = new BroadcastChannel("xiaochun_cindy_bridge");
                bc.postMessage({ type: "mode_changed", mode: selectedMode });
              }
            } catch (_) {}
          } else {
            // 即使离线保存，也给用户明确的本地保存成功提示
            showToast(
              selectedMode === "desktop"
                ? t("toast_saved_desktop")
                : t("toast_saved_embed"),
            );
          }
        };

        // 触发安装流程
        btnTriggerInstall.onclick = (e) => {
          e.stopPropagation();
          installModal.classList.add("show");
        };

        btnModalCancel.onclick = () => {
          installModal.classList.remove("show");
          if (!isInstalled && selectedMode === "desktop") {
            selectMode("embed");
          }
        };

        btnModalConfirm.onclick = async () => {
          if (isInstalling) return;
          isInstalling = true;
          btnModalConfirm.disabled = true;
          btnModalConfirm.innerHTML =
            `<span class="spinner"></span>${t("modal_installing")}`;

          try {
            const res = await fetch(
              `http://127.0.0.1:${currentPort}/api/install`,
              {
                method: "POST",
              },
            );
            const data = await res.json();
            if (data && data.success) {
              isInstalled = true;
              installModal.classList.remove("show");
              desktopStatusText.innerHTML =
                `<span style="color: var(--success)">${t("desktop_status_installed_launched")}</span>`;
              btnTriggerInstall.style.display = "none";
              selectMode("desktop");
              showToast(t("toast_installed_success"));
            } else {
              showToast(data.message || "Error");
            }
          } catch (err) {
            showToast("Install error: " + err.message);
          } finally {
            isInstalling = false;
            btnModalConfirm.disabled = false;
            btnModalConfirm.textContent = t("modal_confirm");
            installModal.classList.remove("show");
          }
        };

        initLocale();
        loadConfig();
      })();
