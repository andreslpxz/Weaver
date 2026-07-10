//! Weaver — backend library.
//!
//! Expone a Tauri los módulos:
//! - [`atspi`]: cliente AT-SPI2 sobre D-Bus (árbol de accesibilidad Linux).
//! - [`automation`]: emulación de teclado/ratón, portapapeles, gestión de ventanas.
//! - [`keyring`]: almacenamiento seguro de API keys en el llavero del OS.

pub mod atspi;
pub mod automation;
pub mod commands;
pub mod keyring;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,weaver_lib=debug")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::default())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                if let Some(win) = app.get_webview_window("main") {
                    win.open_devtools();
                }
            }
            tracing::info!("Weaver backend started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // AT-SPI
            commands::atspi_list_applications,
            commands::atspi_query_tree,
            commands::atspi_get_focused_subtree,
            commands::atspi_click,
            commands::atspi_double_click,
            commands::atspi_type_text,
            commands::atspi_press_key,
            commands::atspi_get_text,
            commands::atspi_get_extents,
            commands::atspi_focus,
            // Automation
            commands::auto_clipboard_get,
            commands::auto_clipboard_set,
            commands::auto_list_windows,
            commands::auto_activate_window,
            commands::auto_key_tap,
            commands::auto_mouse_click_at,
            // Keyring
            commands::keyring_set_api_key,
            commands::keyring_get_api_key,
            commands::keyring_get_api_key_raw,
            commands::keyring_delete_api_key,
            commands::keyring_list_providers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Weaver");
}
