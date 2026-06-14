use std::net::TcpListener;
use std::sync::Mutex;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_shell::ShellExt;

// ---------------------------------------------------------------------------
// Sidecar lifecycle — keeps the Go process alive for the app's lifetime.
// ---------------------------------------------------------------------------

#[allow(dead_code)]
struct SidecarChild(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Bind a temporary TCP socket to `127.0.0.1:0` and return the OS-assigned
/// port number.  The socket is closed before returning so the port is freed
/// for the Go sidecar to bind.
fn pick_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("failed to bind to find free port")
        .local_addr()
        .unwrap()
        .port()
}

/// Bring the main window to the foreground (show + unminimize + focus).
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// ---------------------------------------------------------------------------
// Tauri entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ---- plugins ----
        .plugin(tauri_plugin_shell::init())
        // Auto-update is a future feature (see docs/.../desktop-packaging-design.md).
        // tauri-plugin-updater requires a `plugins.updater` config block (pubkey +
        // endpoints) and is not wired up yet, so it is intentionally omitted —
        // re-add it together with that config when implementing updates.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        // ---- setup (runs once at startup) ----
        .setup(|app| {
            // 1. Pick a free localhost port and spawn the Go sidecar
            let port = pick_free_port();
            let addr = format!("127.0.0.1:{}", port);

            let (rx, child) = app
                .shell()
                .sidecar("wisper-backend")
                .expect("wisper-backend not found in externalBin — run `make sidecar` first")
                .args(["-addr", &addr])
                .spawn()
                .expect("failed to spawn wisper sidecar");

            app.manage(SidecarChild(Mutex::new(Some(child))));

            // Stream sidecar stdout/stderr to the terminal (helpful for debugging)
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                let mut rx = rx;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!(
                                "[wisper] {}",
                                String::from_utf8_lossy(&line).trim_end()
                            );
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!(
                                "[wisper:err] {}",
                                String::from_utf8_lossy(&line).trim_end()
                            );
                        }
                        CommandEvent::Terminated(status) => {
                            if let Some(code) = status.code {
                                eprintln!("[wisper] sidecar exited with code {}", code);
                            } else {
                                eprintln!("[wisper] sidecar terminated");
                            }
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // 2. Create the main window — starts hidden, shown via tray click
            let url_str = format!("http://{}", addr);
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(url_str.parse().unwrap()),
            )
            .title("Wisper")
            .inner_size(900.0, 700.0)
            .min_inner_size(600.0, 400.0)
            .visible(false)
            .build()?;

            // Close button → hide to tray instead of quitting
            let w = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = w.hide();
                }
            });

            // 3. System tray — always present so tunnels keep running in background
            let show_item = MenuItemBuilder::with_id("show", "Show").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit Wisper").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .items(&[&show_item, &quit_item])
                .build()?;

            let _tray = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("Wisper")
                .on_menu_event(|app_handle, event| match event.id().as_ref() {
                    "show" => show_main_window(app_handle),
                    "quit" => {
                        // TODO: send graceful shutdown signal to sidecar before exit
                        // (SIGTERM on Unix; the Go sidecar saves config on SIGTERM)
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run wisper desktop app");
}
