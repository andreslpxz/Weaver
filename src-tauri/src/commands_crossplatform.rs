//! Comandos IPC cross-platform (funcionan en Linux, Windows y macOS).
//!
//! Estos comandos no dependen del backend de accesibilidad (AT-SPI /
//! UIAutomation / AXUIElement), solo de crates que funcionan en todas
//! las plataformas:
//! - keyring: usa libsecret (Linux), Credential Manager (Windows), Keychain (macOS)
//! - tools: shell_exec, file_read/write/list (funciona en todas las plataformas)

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

// ============================================================================
// Keyring — API keys en el llavero del OS (cross-platform)
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
