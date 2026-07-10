//! Comandos IPC expuestos al frontend Tauri.
//!
//! Todos los comandos que el frontend puede invocar con `invoke('name', args)`.

use crate::atspi::{AtspiClient, AccessibleNode, ApplicationInfo, Rect};
use crate::automation::{self, WindowInfo};
use serde::{Deserialize, Serialize};
use tauri::State;

/// Estado compartido: cliente AT-SPI perezoso.
pub struct AppState {
    pub atspi: tokio::sync::OnceCell<AtspiClient>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            atspi: tokio::sync::OnceCell::new(),
        }
    }
}

async fn atspi(state: &AppState) -> Result<&AtspiClient, String> {
    state
        .atspi
        .get_or_try_init(|| async {
            AtspiClient::connect()
                .await
                .map_err(|e| e.to_string())
        })
        .await
}

// ============================================================================
// AT-SPI
// ============================================================================

#[tauri::command]
pub async fn atspi_list_applications(state: State<'_, AppState>) -> Result<Vec<ApplicationInfo>, String> {
    let client = atspi(&state).await?;
    client.list_applications().await.map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct QueryTreeArgs {
    pub bus_name: String,
    pub root_path: String,
    pub max_depth: Option<u32>,
}

#[tauri::command]
pub async fn atspi_query_tree(args: QueryTreeArgs, state: State<'_, AppState>) -> Result<AccessibleNode, String> {
    let client = atspi(&state).await?;
    client
        .query_tree(&args.bus_name, &args.root_path, args.max_depth.unwrap_or(4))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn atspi_get_focused_subtree(max_depth: Option<u32>, state: State<'_, AppState>) -> Result<Option<AccessibleNode>, String> {
    let client = atspi(&state).await?;
    client
        .get_focused_subtree(max_depth.unwrap_or(6))
        .await
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct NodeRef {
    pub bus_name: String,
    pub path: String,
}

#[tauri::command]
pub async fn atspi_click(node: NodeRef, state: State<'_, AppState>) -> Result<(), String> {
    let client = atspi(&state).await?;
    crate::atspi::actions::click(client.connection(), &node.bus_name, &node.path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn atspi_double_click(node: NodeRef, state: State<'_, AppState>) -> Result<(), String> {
    let client = atspi(&state).await?;
    crate::atspi::actions::double_click(client.connection(), &node.bus_name, &node.path)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct TypeTextArgs {
    pub bus_name: String,
    pub path: String,
    pub text: String,
}

#[tauri::command]
pub async fn atspi_type_text(args: TypeTextArgs, state: State<'_, AppState>) -> Result<(), String> {
    let client = atspi(&state).await?;
    crate::atspi::actions::type_text(client.connection(), &args.bus_name, &args.path, &args.text)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn atspi_press_key(key: String) -> Result<(), String> {
    crate::atspi::actions::press_key(&key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn atspi_get_text(node: NodeRef, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let client = atspi(&state).await?;
    crate::atspi::actions::get_text(client.connection(), &node.bus_name, &node.path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn atspi_get_extents(node: NodeRef, state: State<'_, AppState>) -> Result<Rect, String> {
    let client = atspi(&state).await?;
    let (x, y, w, h) = crate::atspi::actions::get_extents(client.connection(), &node.bus_name, &node.path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Rect { x, y, width: w, height: h })
}

#[tauri::command]
pub async fn atspi_focus(node: NodeRef, state: State<'_, AppState>) -> Result<(), String> {
    let client = atspi(&state).await?;
    crate::atspi::actions::focus(client.connection(), &node.bus_name, &node.path)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// Automation
// ============================================================================

#[tauri::command]
pub async fn auto_clipboard_get() -> Result<String, String> {
    automation::clipboard_get().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auto_clipboard_set(content: String) -> Result<(), String> {
    automation::clipboard_set(&content).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auto_list_windows() -> Result<Vec<WindowInfo>, String> {
    automation::list_windows().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auto_activate_window(id_or_title: String) -> Result<(), String> {
    automation::activate_window(&id_or_title)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct KeyTapArgs {
    pub key: String,
}

#[tauri::command]
pub async fn auto_key_tap(args: KeyTapArgs) -> Result<(), String> {
    automation::press_key_combo(&args.key)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct MouseClickArgs {
    pub x: i32,
    pub y: i32,
    pub button: Option<u8>,
}

#[tauri::command]
pub async fn auto_mouse_click_at(args: MouseClickArgs) -> Result<(), String> {
    automation::click_at(args.x, args.y, args.button.unwrap_or(1))
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// Keyring
// ============================================================================

#[derive(Deserialize)]
pub struct SetKeyArgs {
    pub provider_id: String,
    pub api_key: String,
}

#[tauri::command]
pub async fn keyring_set_api_key(args: SetKeyArgs) -> Result<(), String> {
    crate::keyring::set_api_key(&args.provider_id, &args.api_key).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct GetKeyArgs {
    pub provider_id: String,
}

#[derive(Serialize)]
pub struct GetKeyResult {
    pub provider_id: String,
    pub has_key: bool,
    pub masked: Option<String>,
}

#[tauri::command]
pub async fn keyring_get_api_key(args: GetKeyArgs) -> Result<GetKeyResult, String> {
    let key = crate::keyring::get_api_key(&args.provider_id).map_err(|e| e.to_string())?;
    Ok(match key {
        Some(k) => {
            let masked = if k.len() > 8 {
                format!("{}…{}", &k[..4], &k[k.len() - 4..])
            } else {
                "••••".to_string()
            };
            GetKeyResult {
                provider_id: args.provider_id,
                has_key: true,
                masked: Some(masked),
            }
        }
        None => GetKeyResult {
            provider_id: args.provider_id,
            has_key: false,
            masked: None,
        },
    })
}

/// Devuelve la API key sin enmascarar. El frontend la necesita para hacer
/// llamadas HTTP directas a los proveedores. Marcar como sensible en logs.
#[tauri::command]
pub async fn keyring_get_api_key_raw(args: GetKeyArgs) -> Result<Option<String>, String> {
    crate::keyring::get_api_key(&args.provider_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn keyring_delete_api_key(provider_id: String) -> Result<(), String> {
    crate::keyring::delete_api_key(&provider_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn keyring_list_providers() -> Result<Vec<String>, String> {
    Ok(crate::keyring::list_providers_with_keys())
}
