//! Backend Windows: UIAutomation + Win32 APIs.
//!
//! Implementación real del trait [`Backend`] para Windows usando:
//!
//! - `uiautomation` crate: árbol de accesibilidad (UIAutomation COM API).
//! - `win32` module: clipboard, EnumWindows, SendInput.
//!
//! Estado: **implementado** (Fases W2, W3, W4). Ver `PLAN_WINDOWS.md`.

#![cfg(target_os = "windows")]

pub mod uiautomation;
pub mod win32;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use tokio::sync::OnceCell;

use crate::backend::shared_types::{AccessibleNode, ApplicationInfo, Rect};
use crate::backend::{Backend, NodeRef, WindowInfo};
use crate::backend::windows::uiautomation::UiaClient;

/// Backend Windows.
///
/// Mantiene una única instancia `UiaClient` (inicialización COM costosa)
/// vía `OnceCell` para reutilizarla entre llamadas.
pub struct WindowsBackend {
    client: OnceCell<UiaClient>,
}

impl WindowsBackend {
    pub fn new() -> Self {
        Self {
            client: OnceCell::new(),
        }
    }

    async fn client(&self) -> Result<&UiaClient> {
        self.client
            .get_or_try_init(|| async {
                UiaClient::new()
            })
            .await
    }
}

impl Default for WindowsBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Backend for WindowsBackend {
    // ── Accesibilidad ───────────────────────────────────────────────────

    async fn list_applications(&self) -> Result<Vec<ApplicationInfo>> {
        let client = self.client().await?;
        client.list_applications()
    }

    async fn query_tree(
        &self,
        app: &ApplicationInfo,
        max_depth: u32,
    ) -> Result<AccessibleNode> {
        let client = self.client().await?;
        let element = client.find_by_path(&app.root_path)?;
        crate::backend::windows::uiautomation::tree::read_node(&element, max_depth)
    }

    async fn get_focused_subtree(&self, max_depth: u32) -> Result<Option<AccessibleNode>> {
        let client = self.client().await?;
        let focused = client.focused_element()?;
        match crate::backend::windows::uiautomation::tree::read_node(&focused, max_depth) {
            Ok(node) => Ok(Some(node)),
            Err(e) => {
                tracing::debug!("get_focused_subtree: {e}");
                Ok(None)
            }
        }
    }

    async fn click(&self, node: &NodeRef) -> Result<()> {
        let client = self.client().await?;
        let element = client.find_by_path(&node.path)?;
        crate::backend::windows::uiautomation::actions::click(&element)
    }

    async fn double_click(&self, node: &NodeRef) -> Result<()> {
        let client = self.client().await?;
        let element = client.find_by_path(&node.path)?;
        crate::backend::windows::uiautomation::actions::double_click(&element)
    }

    async fn type_text(&self, node: &NodeRef, text: &str) -> Result<()> {
        let client = self.client().await?;
        let element = client.find_by_path(&node.path)?;
        crate::backend::windows::uiautomation::actions::type_text(&element, text)
    }

    async fn press_key(&self, key: &str) -> Result<()> {
        // Las teclas sintéticas en Windows son síncronas (SendInput es blocking).
        // Las envolvemos en spawn_blocking para no bloquear el runtime async.
        let key = key.to_string();
        tokio::task::spawn_blocking(move || {
            crate::backend::windows::win32::input::press_key_combo(&key)
        })
        .await?
    }

    async fn get_text(&self, node: &NodeRef) -> Result<Option<String>> {
        let client = self.client().await?;
        let element = client.find_by_path(&node.path)?;
        crate::backend::windows::uiautomation::actions::get_text(&element)
    }

    async fn get_extents(&self, node: &NodeRef) -> Result<Rect> {
        let client = self.client().await?;
        let element = client.find_by_path(&node.path)?;
        crate::backend::windows::uiautomation::actions::get_extents(&element)
    }

    async fn focus(&self, node: &NodeRef) -> Result<()> {
        let client = self.client().await?;
        let element = client.find_by_path(&node.path)?;
        crate::backend::windows::uiautomation::actions::focus(&element)
    }

    // ── Automatización ──────────────────────────────────────────────────

    async fn clipboard_get(&self) -> Result<String> {
        let result = tokio::task::spawn_blocking(|| {
            crate::backend::windows::win32::clipboard::clipboard_get()
        })
        .await??;
        Ok(result)
    }

    async fn clipboard_set(&self, content: &str) -> Result<()> {
        let content = content.to_string();
        tokio::task::spawn_blocking(move || {
            crate::backend::windows::win32::clipboard::clipboard_set(&content)
        })
        .await??;
        Ok(())
    }

    async fn list_windows(&self) -> Result<Vec<WindowInfo>> {
        let windows = tokio::task::spawn_blocking(|| {
            crate::backend::windows::win32::windows::list_windows()
        })
        .await??;
        Ok(windows)
    }

    async fn activate_window(&self, id_or_title: &str) -> Result<()> {
        let id_or_title = id_or_title.to_string();
        tokio::task::spawn_blocking(move || {
            crate::backend::windows::win32::windows::activate_window(&id_or_title)
        })
        .await??;
        Ok(())
    }

    async fn key_tap(&self, key: &str) -> Result<()> {
        // Igual que press_key pero con un solo tap (sin hold).
        self.press_key(key).await
    }

    async fn mouse_click_at(&self, x: i32, y: i32, button: u8) -> Result<()> {
        tokio::task::spawn_blocking(move || {
            crate::backend::windows::win32::input::click_at(x, y, button)
        })
        .await?
        .map_err(|e| anyhow!("mouse_click_at falló: {e}"))?;
        Ok(())
    }
}
