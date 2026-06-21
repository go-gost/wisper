use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_shell::ShellExt;

// ---------------------------------------------------------------------------
// Sidecar lifecycle — keeps the Go process alive for the app's lifetime.
// ---------------------------------------------------------------------------

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

/// Block until the Go sidecar accepts TCP connections on `addr`, or until the
/// timeout elapses. We wait so the webview never paints a "connection refused"
/// page on startup. Best-effort: if the sidecar is slow we still proceed and
/// let the webview retry its own navigation.
fn wait_for_sidecar(addr: &str) {
    let Ok(socket_addr) = addr.parse::<SocketAddr>() else {
        eprintln!("[wisper:desktop] invalid sidecar addr: {addr}");
        return;
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&socket_addr, Duration::from_millis(200)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    eprintln!("[wisper:desktop] sidecar not ready within 5s, showing window anyway");
}

/// Bring the main window to the foreground (show + unminimize + focus).
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Stop the Go sidecar before the desktop app exits.
///
/// On Unix we send SIGTERM (the Go sidecar catches it to persist tunnel/
/// entrypoint config and shut its HTTP server down cleanly), wait briefly for
/// it to exit, then escalate to SIGKILL. `tauri_plugin_shell`'s `CommandChild`
/// only exposes a SIGKILL-style `kill()`, so we signal via `libc` to get the
/// graceful path. On other platforms we fall back to that hard kill.
fn shutdown_sidecar(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<SidecarChild>() else {
        return;
    };

    #[cfg(unix)]
    {
        let pid = match state.inner().0.lock().unwrap().as_ref() {
            Some(child) => child.pid() as i32,
            None => return,
        };
        // 1. Graceful: SIGTERM lets the Go sidecar save config on the way out.
        unsafe {
            libc::kill(pid, libc::SIGTERM);
        }
        // 2. Wait up to 1.5s for it to exit (kill(pid, 0) == 0 means still alive).
        let deadline = Instant::now() + Duration::from_millis(1500);
        while Instant::now() < deadline {
            if unsafe { libc::kill(pid, 0) } != 0 {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        // 3. Force.
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
    }

    #[cfg(not(unix))]
    {
        if let Ok(mut guard) = state.inner().0.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
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
                .sidecar("wisper-api")
                .expect("wisper-api not found in externalBin — run `make sidecar` first")
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

            // 2. Create the main window. We wait for the sidecar's HTTP server
            //    first (no "connection refused" flash), then build the window
            //    visible-from-birth. Creating it visible rather than
            //    hidden-then-shown keeps the native title-bar controls
            //    (minimize / maximize / close) responsive on WebKitGTK/Linux —
            //    a hidden→show transition leaves them unclickable until a
            //    resize/maximize.
            wait_for_sidecar(&addr);
            let url_str = format!("http://{}", addr);
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(url_str.parse().unwrap()),
            )
            .title("Wisper")
            .inner_size(900.0, 700.0)
            .min_inner_size(600.0, 400.0)
            .build()?;

            // Close button → hide to tray instead of quitting.
            let w = window.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = w.hide();
                }
                // Workaround for tauri#11856: on Linux/Wayland the native
                // title-bar buttons (min/max/close) stop responding after the
                // window is hidden then shown again — including our close→
                // hide-to-tray→show flow. Toggling resizable off→on when the
                // window regains focus forces the compositor to recompute the
                // input region, restoring the buttons. set_focus() in
                // show_main_window fires Focused(true), so this runs on each
                // re-show.
                #[cfg(target_os = "linux")]
                WindowEvent::Focused(true) => {
                    let _ = w.set_resizable(false);
                    let _ = w.set_resizable(true);
                }
                _ => {}
            });

            // 3. System tray — always present so tunnels keep running in background
            let tray_menu = MenuBuilder::new(app)
                .text("show", "Show")
                .text("quit", "Quit Wisper")
                .build()?;

            let _tray = TrayIconBuilder::new()
                // Dedicated tray icon: just the ghost on a transparent
                // background. The full app icon wastes the canvas on a black
                // border, making the ghost tiny at tray size. Loaded from an
                // embedded PNG (needs the `image-png` Cargo feature).
                .icon(
                    tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))
                        .expect("failed to decode tray icon"),
                )
                .menu(&tray_menu)
                .tooltip("Wisper")
                .on_menu_event(|app_handle, event| match event.id().as_ref() {
                    "show" => show_main_window(app_handle),
                    "quit" => {
                        // Tear down the Go sidecar (SIGTERM → save config, then
                        // SIGKILL fallback) before exiting, so it doesn't linger.
                        shutdown_sidecar(app_handle);
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
