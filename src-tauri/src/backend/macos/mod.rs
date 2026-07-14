//! Backend macOS: Accessibility API (AXUIElement) + AppKit + CoreGraphics.
//!
//! Implementación real del trait [`Backend`] para macOS usando:
//!
//! - `ax` module: AXUIElement bindings (accesibilidad).
//! - `appkit` module: NSPasteboard, NSWorkspace, CGEvent.
//!
//! Estado: **implementado** (Fases M2, M3, M4). Ver `PLAN_MACOS.md`.
//!
//! IMPORTANTE: macOS requiere permiso de Accessibility en
//! System Settings → Privacy & Security → Accessibility. Sin este permiso,
//! los CGEvent se descartan silenciosamente y los AXUIElement devuelven
//! datos vacíos. Verificar al iniciar con `AxClient::check_accessibility_permission(true)`.

#![cfg(target_os = "macos")]

pub mod appkit;
pub mod ax;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use tokio::sync::OnceCell;

use crate::backend::shared_types::{AccessibleNode, ApplicationInfo, Rect};
use crate::backend::{Backend, NodeRef, WindowInfo};
use crate::backend::macos::ax::AxClient;

/// Backend macOS.
///
/// Mantiene una única instancia `AxClient` (inicialización costosa)
/// vía `OnceCell` para reutilizarla entre llamadas.
pub struct MacosBackend {
    client: OnceCell<AxClient>,
}

impl MacosBackend {
    pub fn new() -> Self {
        Self {
            client: OnceCell::new(),
        }
    }

    async fn client(&self) -> Result<&AxClient> {
        self.client
            .get_or_try_init(|| async {
                // Verificar permiso de Accessibility al primer uso.
                if !AxClient::check_accessibility_permission(false) {
                    tracing::warn!(
                        "Weaver no tiene permiso de Accessibility. \
                         Algunas operaciones fallarán silenciosamente. \
                         Ve a System Settings → Privacy & Security → Accessibility."
                    );
                    // Pedir permiso con diálogo nativo.
                    AxClient::check_accessibility_permission(true);
                }
                AxClient::new()
            })
            .await
    }

    /// Extrae el PID de un `NodeRef.bus_name` con formato "pid:NNN".
    fn pid_from_node(node: &NodeRef) -> Result<u32> {
        node.bus_name
            .strip_prefix("pid:")
            .ok_or_else(|| anyhow!("bus_name inválido (debe ser 'pid:NNN'): {}", node.bus_name))?
            .parse()
            .map_err(|e| anyhow!("PID inválido: {e}"))
    }
}

impl Default for MacosBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Backend for MacosBackend {
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
        crate::backend::macos::ax::tree::read_node(&element, max_depth, app.pid)
    }

    async fn get_focused_subtree(&self, max_depth: u32) -> Result<Option<AccessibleNode>> {
        let client = self.client().await?;
        let focused = client.focused_element().ok();
        if let Some(element) = focused {
            // Obtener PID del elemento focused.
            let pid = 0; // TODO M2: obtener PID del elemento via AXUIElementGetPid
            match crate::backend::macos::ax::tree::read_node(&element, max_depth, pid) {
                Ok(node) => return Ok(Some(node)),
                Err(e) => {
                    tracing::debug!("get_focused_subtree: {e}");
                }
            }
        }
        Ok(None)
    }

    async fn click(&self, node: &NodeRef) -> Result<()> {
        let client = self.client().await?;
        let element = client.find_by_path(&node.path)?;
        crate::backend::macos::ax::actions::click(&element)
    }

    async fn double_click(&self, node: &NodeRef) -> Result<()> {
        let client = self.client().await?;
        let element = client.find_by_path(&node.path)?;
        crate::backend::macos::ax::actions::double_click(&element)
    }

    async fn type_text(&self, node: &NodeRef, text: &str) -> Result<()> {
        let client = self.client().await?;
        let element = client.find_by_path(&node.path)?;
        crate::backend::macos::ax::actions::type_text(&element, text)
    }

    async fn press_key(&self, key: &str) -> Result<()> {
        let key = key.to_string();
        tokio::task::spawn_blocking(move || {
            crate::backend::macos::appkit::input::press_key_combo(&key)
        })
        .await?
    }

    async fn get_text(&self, node: &NodeRef) -> Result<Option<String>> {
        let client = self.client().await?;
        let element = client.find_by_path(&node.path)?;
        crate::backend::macos::ax::actions::get_text(&element)
    }

    async fn get_extents(&self, node: &NodeRef) -> Result<Rect> {
        let client = self.client().await?;
        let element = client.find_by_path(&node.path)?;
        crate::backend::macos::ax::actions::get_extents(&element)
    }

    async fn focus(&self, node: &NodeRef) -> Result<()> {
        let client = self.client().await?;
        let element = client.find_by_path(&node.path)?;
        crate::backend::macos::ax::actions::focus(&element)
    }

    // ── Automatización ──────────────────────────────────────────────────

    async fn clipboard_get(&self) -> Result<String> {
        let result = tokio::task::spawn_blocking(|| {
            crate::backend::macos::appkit::clipboard::clipboard_get()
        })
        .await??;
        Ok(result)
    }

    async fn clipboard_set(&self, content: &str) -> Result<()> {
        let content = content.to_string();
        tokio::task::spawn_blocking(move || {
            crate::backend::macos::appkit::clipboard::clipboard_set(&content)
        })
        .await??;
        Ok(())
    }

    async fn list_windows(&self) -> Result<Vec<WindowInfo>> {
        let windows = tokio::task::spawn_blocking(|| {
            crate::backend::macos::appkit::workspace::list_windows()
        })
        .await??;
        Ok(windows)
    }

    async fn activate_window(&self, id_or_title: &str) -> Result<()> {
        let id_or_title = id_or_title.to_string();
        tokio::task::spawn_blocking(move || {
            crate::backend::macos::appkit::workspace::activate_window(&id_or_title)
        })
        .await??;
        Ok(())
    }

    async fn key_tap(&self, key: &str) -> Result<()> {
        self.press_key(key).await
    }

    async fn mouse_click_at(&self, x: i32, y: i32, button: u8) -> Result<()> {
        tokio::task::spawn_blocking(move || {
            crate::backend::macos::appkit::input::click_at(x, y, button)
        })
        .await?
        .map_err(|e| anyhow!("mouse_click_at falló: {e}"))?;
        Ok(())
    }
}
