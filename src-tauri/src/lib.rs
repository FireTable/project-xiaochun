use std::sync::{
  atomic::{AtomicBool, AtomicU64, Ordering},
  Arc, Mutex,
};
use std::thread;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_window_state::StateFlags;

static MSG_COUNTER: AtomicU64 = AtomicU64::new(1);

fn generate_msg_id() -> String {
  let ms = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or(0);
  let seq = MSG_COUNTER.fetch_add(1, Ordering::SeqCst);
  format!("{}_{}", ms, seq)
}

fn resolve_file_path(path_str: &str) -> std::path::PathBuf {
  let p = path_str.trim();
  if p.starts_with("~/") || p == "~" {
    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
      let rest = if p == "~" { "" } else { &p[2..] };
      return std::path::Path::new(&home).join(rest);
    }
  }
  std::path::PathBuf::from(p)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolMessage {
  pub id: Option<String>,
  pub action: String,
  pub payload: serde_json::Value,
  #[serde(rename = "rawUrl")]
  pub raw_url: Option<String>,
}

#[derive(Default)]
pub struct ProtocolState {
  pub pending_messages: Mutex<Vec<ProtocolMessage>>,
  /// Short-window dedupe of raw URLs (cold-start get_current retries / Opened + on_open_url).
  pub recent_raw_urls: Mutex<Vec<(String, u64)>>,
}

fn parse_deep_link_url(raw_url: &str) -> Option<ProtocolMessage> {
  let parsed = url::Url::parse(raw_url).ok()?;
  if parsed.scheme() != "xiaochun" {
    return None;
  }

  let host = parsed.host_str().unwrap_or("");
  let path = parsed.path().trim_start_matches('/');
  let action = if !host.is_empty() && host != "action" {
    host.to_string()
  } else if !path.is_empty() {
    path.to_string()
  } else {
    let mut act = String::new();
    for (k, v) in parsed.query_pairs() {
      if k == "action" {
        act = v.to_string();
        break;
      }
    }
    if act.is_empty() {
      "speak".to_string()
    } else {
      act
    }
  };

  let mut payload_map = serde_json::Map::new();
  for (k, v) in parsed.query_pairs() {
    if k != "action" {
      payload_map.insert(k.to_string(), serde_json::Value::String(v.to_string()));
    }
  }

  // 如果包含 file 路径且没有有效的 text，在原生 Rust 端直接读取文件内容（绕过浏览器沙箱）
  if let Some(serde_json::Value::String(file_path_str)) = payload_map.get("file").cloned() {
    let has_empty_text = payload_map
      .get("text")
      .and_then(|v| v.as_str())
      .map(|s| s.trim().is_empty())
      .unwrap_or(true);

    if has_empty_text {
      let resolved = resolve_file_path(&file_path_str);
      match std::fs::read_to_string(&resolved) {
        Ok(content) => {
          log::info!("[Protocol] 成功从本地文件读取文本 (路径: {:?}, 字符数: {})", resolved, content.len());
          payload_map.insert("text".to_string(), serde_json::Value::String(content));
        }
        Err(err) => {
          log::error!("[Protocol] 读取文件失败 (路径: {:?}): {}", resolved, err);
          payload_map.insert(
            "fileError".to_string(),
            serde_json::Value::String(format!("无法读取文件 {:?}: {}", resolved, err)),
          );
        }
      }
    }
  }

  Some(ProtocolMessage {
    id: Some(generate_msg_id()),
    action,
    payload: serde_json::Value::Object(payload_map),
    raw_url: Some(raw_url.to_string()),
  })
}

fn protocol_trace(line: &str) {
  log::info!("{line}");
  if cfg!(debug_assertions) {
    let _ = std::fs::OpenOptions::new()
      .create(true)
      .append(true)
      .open("/tmp/xiaochun-protocol-trace.log")
      .and_then(|mut f| {
        use std::io::Write;
        let ms = std::time::SystemTime::now()
          .duration_since(std::time::UNIX_EPOCH)
          .map(|d| d.as_millis())
          .unwrap_or(0);
        writeln!(f, "{ms} {line}")
      });
  }
}

fn should_skip_duplicate_url(app: &AppHandle, url_str: &str) -> bool {
  let Some(state) = app.try_state::<Arc<ProtocolState>>() else {
    return false;
  };
  let Ok(mut recent) = state.recent_raw_urls.lock() else {
    return false;
  };
  let now = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0);
  recent.retain(|(_, t)| now.saturating_sub(*t) < 5000);
  if recent.iter().any(|(u, _)| u == url_str) {
    return true;
  }
  recent.push((url_str.to_string(), now));
  false
}

fn dispatch_protocol_url(app: &AppHandle, url_str: &str) {
  protocol_trace(&format!("[Protocol] 收到协议 URL: {url_str}"));
  if should_skip_duplicate_url(app, url_str) {
    protocol_trace(&format!("[Protocol] skip duplicate raw URL within 5s: {url_str}"));
    return;
  }
  if let Some(msg) = parse_deep_link_url(url_str) {
    if let Some(win) = app.get_webview_window("main") {
      let _ = win.unminimize();
      let _ = win.show();
      let _ = win.set_focus();
    }
    // 1. 存入待处理队列（解决冷启动时前端尚未初始化完成导致的事件丢失）
    if let Some(state) = app.try_state::<Arc<ProtocolState>>() {
      if let Ok(mut pending) = state.pending_messages.lock() {
        pending.push(msg.clone());
      }
    }
    // 2. 同时 emit 给可能已经就绪的前端监听器
    let _ = app.emit("protocol:action", msg);
  } else {
    protocol_trace(&format!("[Protocol] URL parse failed: {url_str}"));
  }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct InteractiveRect {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

#[derive(Default, Clone)]
pub struct AlphaMaskData {
  pub width: u32,
  pub height: u32,
  pub win_width: f64,
  pub win_height: f64,
  pub mask: Vec<u8>,
}

#[derive(Default)]
pub struct PassthroughState {
  pub enabled: AtomicBool,
  pub interacting: AtomicBool,
  /// HTML overlay (menu / dialog) or pointer currently over DOM, not canvas.
  pub dom_blocks: AtomicBool,
  pub ui_rects: Mutex<Vec<InteractiveRect>>,
  pub alpha_mask: Mutex<Option<AlphaMaskData>>,
  pub ignoring: AtomicBool,
}

#[tauri::command]
fn set_passthrough_enabled(
  state: tauri::State<'_, Arc<PassthroughState>>,
  window: WebviewWindow,
  enabled: bool,
) -> Result<(), String> {
  state.enabled.store(enabled, Ordering::SeqCst);
  if !enabled {
    if state.ignoring.swap(false, Ordering::SeqCst) {
      let _ = window.set_ignore_cursor_events(false);
    }
  }
  Ok(())
}

#[tauri::command]
fn set_is_interacting(
  state: tauri::State<'_, Arc<PassthroughState>>,
  window: WebviewWindow,
  interacting: bool,
) -> Result<(), String> {
  state.interacting.store(interacting, Ordering::SeqCst);
  if interacting {
    if state.ignoring.swap(false, Ordering::SeqCst) {
      let _ = window.set_ignore_cursor_events(false);
    }
  }
  Ok(())
}

#[tauri::command]
fn set_dom_blocks_passthrough(
  state: tauri::State<'_, Arc<PassthroughState>>,
  window: WebviewWindow,
  blocks: bool,
) -> Result<(), String> {
  state.dom_blocks.store(blocks, Ordering::SeqCst);
  if blocks {
    if state.ignoring.swap(false, Ordering::SeqCst) {
      let _ = window.set_ignore_cursor_events(false);
    }
  }
  Ok(())
}

#[tauri::command]
fn update_interactive_rects(
  state: tauri::State<'_, Arc<PassthroughState>>,
  rects: Vec<InteractiveRect>,
) -> Result<(), String> {
  let mut lock = state.ui_rects.lock().map_err(|e| e.to_string())?;
  *lock = rects;
  Ok(())
}

#[tauri::command]
fn update_alpha_bitmask(
  state: tauri::State<'_, Arc<PassthroughState>>,
  width: u32,
  height: u32,
  window_width: f64,
  window_height: f64,
  mask: Vec<u8>,
) -> Result<(), String> {
  let mut lock = state.alpha_mask.lock().map_err(|e| e.to_string())?;
  *lock = Some(AlphaMaskData {
    width,
    height,
    win_width: window_width,
    win_height: window_height,
    mask,
  });
  Ok(())
}

#[tauri::command]
fn get_pending_protocol_actions(
  state: tauri::State<'_, Arc<ProtocolState>>,
) -> Result<Vec<ProtocolMessage>, String> {
  let mut lock = state.pending_messages.lock().map_err(|e| e.to_string())?;
  let messages = lock.drain(..).collect();
  Ok(messages)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let passthrough_state = Arc::new(PassthroughState::default());
  let monitor_state = Arc::clone(&passthrough_state);
  let protocol_state = Arc::new(ProtocolState::default());

  tauri::Builder::default()
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_opener::init())
    .manage(passthrough_state)
    .manage(protocol_state)
    // ponytail: 持久化窗口尺寸 / 位置 — 启动时回放, resize/move 自动保存
    // 缩窄到只持久化 POSITION | SIZE, 不动 decorations/visible/fullscreen/maximized,
    // 避免和 tauri.conf.json 的硬配置 (decorations:false, transparent:true, alwaysOnTop:true)
    // 撞车, 也避免 startup restore 时窗口被瞬时 resize 打断 corner drag。
    .plugin(
      tauri_plugin_window_state::Builder::default()
        .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
        .build()
    )
    .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
      for arg in args {
        if arg.starts_with("xiaochun://") {
          dispatch_protocol_url(app, &arg);
        }
      }
    }))
    .plugin(tauri_plugin_deep_link::init())
    .invoke_handler(tauri::generate_handler![
      set_passthrough_enabled,
      set_is_interacting,
      set_dom_blocks_passthrough,
      update_interactive_rects,
      update_alpha_bitmask,
      get_pending_protocol_actions
    ])
    .setup(move |app| {
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

      // Install file logger before any protocol dispatch so cold-start lines are captured.
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
      {
        use tauri_plugin_deep_link::DeepLinkExt;
        let _ = app.deep_link().register_all();
        let app_handle = app.handle().clone();
        app.deep_link().on_open_url(move |event| {
          protocol_trace("[Protocol] on_open_url fired");
          for url in event.urls() {
            dispatch_protocol_url(&app_handle, url.as_str());
          }
        });

        // Cold start (esp. macOS): launch URL often is NOT in argv.
        // RunEvent::Opened may arrive slightly after setup, so poll get_current.
        let cold_handle = app.handle().clone();
        let drain_current = move |label: &str| {
          match cold_handle.deep_link().get_current() {
            Ok(Some(urls)) => {
              for url in urls {
                protocol_trace(&format!(
                  "[Protocol] cold-start URL recovered via get_current ({label}): {url}"
                ));
                dispatch_protocol_url(&cold_handle, url.as_str());
              }
              true
            }
            Ok(None) => {
              protocol_trace(&format!(
                "[Protocol] get_current ({label}): no cold-start deep link URLs"
              ));
              false
            }
            Err(err) => {
              protocol_trace(&format!("[Protocol] get_current ({label}) failed: {err}"));
              false
            }
          }
        };
        let _ = drain_current("setup-immediate");
        let poll_handle = app.handle().clone();
        thread::spawn(move || {
          for (i, delay_ms) in [100u64, 500, 1500].into_iter().enumerate() {
            thread::sleep(Duration::from_millis(delay_ms));
            match poll_handle.deep_link().get_current() {
              Ok(Some(urls)) if !urls.is_empty() => {
                for url in urls {
                  protocol_trace(&format!(
                    "[Protocol] cold-start URL recovered via get_current (poll#{i}): {url}"
                  ));
                  dispatch_protocol_url(&poll_handle, url.as_str());
                }
                break;
              }
              Ok(_) => {
                protocol_trace(&format!(
                  "[Protocol] get_current (poll#{i}): still empty"
                ));
              }
              Err(err) => {
                protocol_trace(&format!(
                  "[Protocol] get_current (poll#{i}) failed: {err}"
                ));
              }
            }
          }
        });
      }

      // 启动参数扫描（支持冷启动时直接传参 xiaochun:// 协议）
      let startup_handle = app.handle().clone();
      for arg in std::env::args() {
        if arg.starts_with("xiaochun://") {
          protocol_trace(&format!("[Protocol] argv deep link: {arg}"));
          dispatch_protocol_url(&startup_handle, &arg);
        }
      }

      #[cfg(target_os = "macos")]
      {
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.set_shadow(false);
        }

        // 方案 3：macOS 原生级 Canvas 像素透明度位图 (Alpha Bitmask) 高频判定线程 (16ms / ~60Hz)
        let app_handle: AppHandle = app.handle().clone();
        let state = monitor_state;

        thread::spawn(move || {
          loop {
            thread::sleep(Duration::from_millis(16));

            if !state.enabled.load(Ordering::SeqCst) {
              continue;
            }

            // 长按拖拽、或指针在 HTML（菜单/对话框/顶栏）上：整窗吃点击，不查 canvas 位图
            if state.interacting.load(Ordering::SeqCst) || state.dom_blocks.load(Ordering::SeqCst) {
              if state.ignoring.swap(false, Ordering::SeqCst) {
                if let Some(window) = app_handle.get_webview_window("main") {
                  let _ = window.set_ignore_cursor_events(false);
                }
              }
              continue;
            }

            let window = match app_handle.get_webview_window("main") {
              Some(w) => w,
              None => continue,
            };

            let cursor_pos = match app_handle.cursor_position() {
              Ok(pos) => pos,
              Err(_) => continue,
            };

            let win_pos = match window.outer_position() {
              Ok(pos) => pos,
              Err(_) => continue,
            };

            let scale = window.scale_factor().unwrap_or(1.0);
            let local_x = (cursor_pos.x - win_pos.x as f64) / scale;
            let local_y = (cursor_pos.y - win_pos.y as f64) / scale;

            let win_size = match window.inner_size() {
              Ok(size) => size.to_logical::<f64>(scale),
              Err(_) => continue,
            };

            // 鼠标超出窗口范围时，恢复为非穿透状态
            if local_x < 0.0 || local_y < 0.0 || local_x > win_size.width || local_y > win_size.height {
              if state.ignoring.swap(false, Ordering::SeqCst) {
                let _ = window.set_ignore_cursor_events(false);
              }
              continue;
            }

            // 1. 优先检查是否落在 UI 交互矩形（如顶栏操作区、右键菜单）
            let mut hit = false;
            if let Ok(rects) = state.ui_rects.lock() {
              for r in rects.iter() {
                if local_x >= r.x && local_x <= (r.x + r.width)
                  && local_y >= r.y && local_y <= (r.y + r.height) {
                  hit = true;
                  break;
                }
              }
            }

            // 2. 方案 3：查验 Canvas 真实像素 Alpha 透明度位图（1 纳秒位运算索引）
            if !hit {
              if let Ok(mask_lock) = state.alpha_mask.lock() {
                if let Some(mask_data) = mask_lock.as_ref() {
                  if mask_data.win_width > 0.0 && mask_data.win_height > 0.0 {
                    let norm_x = local_x / mask_data.win_width;
                    let norm_y = local_y / mask_data.win_height;
                    if norm_x >= 0.0 && norm_x < 1.0 && norm_y >= 0.0 && norm_y < 1.0 {
                      let mx = (norm_x * mask_data.width as f64) as usize;
                      let my = (norm_y * mask_data.height as f64) as usize;
                      let pixel_idx = my * mask_data.width as usize + mx;
                      let byte_idx = pixel_idx / 8;
                      let bit_idx = pixel_idx % 8;
                      if byte_idx < mask_data.mask.len() {
                        hit = (mask_data.mask[byte_idx] & (1 << bit_idx)) != 0;
                      }
                    }
                  }
                }
              }
            }

            if hit {
              // 落在有像素的角色实体上（服装/身体/发饰/鞋袜）或 UI 上，恢复窗口交互
              if state.ignoring.swap(false, Ordering::SeqCst) {
                let _ = window.set_ignore_cursor_events(false);
              }
            } else {
              // 落在透明像素（双腿缝隙、身体两侧空白），无缝穿透到底层桌面
              if !state.ignoring.swap(true, Ordering::SeqCst) {
                let _ = window.set_ignore_cursor_events(true);
              }
            }
          }
        });
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      #[cfg(any(target_os = "macos", target_os = "ios"))]
      if let tauri::RunEvent::Opened { urls } = &event {
        protocol_trace(&format!(
          "[Protocol] RunEvent::Opened ({} url(s))",
          urls.len()
        ));
        for url in urls {
          dispatch_protocol_url(app_handle, url.as_str());
        }
      }
      let _ = (app_handle, &event);
    });
}
