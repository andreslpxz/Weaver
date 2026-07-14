//! Weaver — backend library.
//!
//! Expone a Tauri los módulos comunes + un backend por OS:
//! - [`backend`]: trait `Backend` común + factory `cfg!`.
//! - [`backend::linux`]: AT-SPI2 (D-Bus) + automation X11/Wayland.
//! - [`backend::windows`]: UIAutomation + Win32 APIs (solo Windows).
//! - [`backend::macos`]: AXUIElement + AppKit (solo macOS).
//! - [`commands`]: comandos Tauri (Linux-specific por ahora).
//! - [`keyring`]: almacenamiento seguro de API keys en el llavero del OS.
//! - [`db`]: SQLite para memoria episódica/semántica, conversaciones, proyectos, skills.
//! - [`tools`]: shell_exec, file_read/write/list.
//! - [`mcp`]: runtime MCP (Model Context Protocol) sobre stdio JSON-RPC.

pub mod backend;
#[cfg(target_os = "linux")]
pub mod commands;
pub mod db;
pub mod keyring;
pub mod mcp;
pub mod tools;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,weaver_lib=debug")),
        )
        .init();

    // Abrir SQLite (puede fallar si el HOME no está disponible; en ese caso
    // dejamos el frontend caer al fallback localStorage).
    let db_state = match db::open() {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("No se pudo abrir SQLite ({e}); frontend usará localStorage.");
            // Fallback: en memoria para que los comandos no paniqueen.
            db::DbState(std::sync::Mutex::new(
                rusqlite::Connection::open_in_memory().expect("in-memory sqlite"),
            ))
        }
    };

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(db_state)
        .manage(mcp::McpState::default())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    win.open_devtools();
                }
            }
            tracing::info!("Weaver backend started");
            Ok(())
        });

    // En Linux, registrar los comandos AT-SPI/automation/keyring que viven
    // en `commands.rs`. En Windows/macOS aún no existen; el frontend cae
    // al modo browser-fallback.
    #[cfg(target_os = "linux")]
    {
        builder = builder
            .manage(commands::AppState::default())
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
                // Tools (shell, fs)
                tools::tools_shell_exec,
                tools::tools_file_read,
                tools::tools_file_write,
                tools::tools_file_list,
                // Memory (SQLite)
                db::memory_list_episodes,
                db::memory_save_episode,
                db::memory_delete_episode,
                db::memory_clear_all,
                db::memory_list_facts,
                db::memory_set_fact,
                db::memory_get_fact,
                db::memory_delete_fact,
                // Projects
                db::projects_list,
                db::projects_create,
                db::projects_delete,
                db::projects_rename,
                // Conversations + messages
                db::conversations_list,
                db::conversations_create,
                db::conversations_set_project,
                db::conversations_rename,
                db::conversations_delete,
                db::messages_list,
                db::messages_save,
                db::messages_delete,
                // Skills
                db::skills_list,
                db::skills_save,
                db::skills_delete,
                // MCP (Model Context Protocol)
                mcp::mcp_list_servers,
                mcp::mcp_add_server,
                mcp::mcp_remove_server,
                mcp::mcp_start_server,
                mcp::mcp_list_tools,
                mcp::mcp_call_tool,
                mcp::mcp_generate_id,
            ]);
    }

    // En Windows/macOS, registrar solo los comandos cross-platform (MCP, db, tools, keyring).
    // TODO: cuando los backends Windows/macOS estén implementados, añadir
    // aquí los comandos que delegan al trait `Backend`.
    #[cfg(not(target_os = "linux"))]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            // MCP
            mcp::mcp_list_servers,
            mcp::mcp_add_server,
            mcp::mcp_remove_server,
            mcp::mcp_start_server,
            mcp::mcp_list_tools,
            mcp::mcp_call_tool,
            mcp::mcp_generate_id,
            // Memory (SQLite)
            db::memory_list_episodes,
            db::memory_save_episode,
            db::memory_delete_episode,
            db::memory_clear_all,
            db::memory_list_facts,
            db::memory_set_fact,
            db::memory_get_fact,
            db::memory_delete_fact,
            // Projects
            db::projects_list,
            db::projects_create,
            db::projects_delete,
            db::projects_rename,
            // Conversations + messages
            db::conversations_list,
            db::conversations_create,
            db::conversations_set_project,
            db::conversations_rename,
            db::conversations_delete,
            db::messages_list,
            db::messages_save,
            db::messages_delete,
            // Skills
            db::skills_list,
            db::skills_save,
            db::skills_delete,
        ]);
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running Weaver");
}
