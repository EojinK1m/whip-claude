use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, WebviewWindow,
};

const WINDOW_W: f64 = 420.0;

fn toggle_window(window: &WebviewWindow, tray_pos: Option<PhysicalPosition<f64>>) {
    let visible = window.is_visible().unwrap_or(false);
    if visible {
        let _ = window.hide();
        return;
    }

    if let Some(pos) = tray_pos {
        let scale = window.scale_factor().unwrap_or(1.0);
        let monitor = window.current_monitor().ok().flatten();
        let mut x = pos.x - (WINDOW_W * scale) / 2.0;
        let y = pos.y + 8.0 * scale;

        if let Some(m) = monitor {
            let m_pos = m.position();
            let m_size = m.size();
            let min_x = m_pos.x as f64;
            let max_x = m_pos.x as f64 + m_size.width as f64 - WINDOW_W * scale;
            if x < min_x {
                x = min_x;
            }
            if x > max_x {
                x = max_x;
            }
        }

        let _ = window.set_position(PhysicalPosition::new(x, y));
    }

    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Right-click menu on the tray: theme toggle + Quit. Without
            // this the user has no way to exit since the dock icon is hidden.
            let light = CheckMenuItem::with_id(
                app,
                "light",
                "Light mode",
                true,
                false,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "Quit whip-claude", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&light, &quit])?;

            if let Some(tray) = app.tray_by_id("main-tray") {
                tray.set_menu(Some(menu))?;
                // The menu would normally open on left-click too; suppress
                // that so left-click can still toggle the bubble window.
                tray.set_show_menu_on_left_click(false)?;

                // Clone the check item into the menu-event closure so we
                // can read its post-toggle state and forward the new theme
                // to the webview. CheckMenuItem auto-flips its check on
                // click; we just observe and broadcast.
                let light_item = light.clone();
                tray.on_menu_event(move |app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "light" => {
                        let checked = light_item.is_checked().unwrap_or(false);
                        let theme = if checked { "light" } else { "dark" };
                        let _ = app.emit("set-theme", theme);
                    }
                    _ => {}
                });

                tray.on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            toggle_window(&window, Some(position));
                        }
                    }
                });
            }

            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = w.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
