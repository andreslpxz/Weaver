//! Backend macOS: Accessibility API (AXUIElement) + AppKit + CoreGraphics.
//!
//! Estado: **implementación real con `accessibility` 0.2 y `objc2-app-kit` 0.2**.
//! Requiere permiso de Accessibility (System Settings → Privacy & Security).
//!
//! Nota importante: esta implementación no ha sido compilada en macOS real
//! porque el entorno de desarrollo es Linux. Las APIs usadas son las estables
//! documentadas en docs.rs/accessibility/0.2 y docs.rs/objc2-app-kit/0.2.
//! Si hay pequeñas diferencias de tipo (ej: `Retained<CGEvent>` vs `*mut CGEvent`),
//! se resuelven iterando en macOS real — el código está estructurado para eso.

#![cfg(target_os = "macos")]

pub mod appkit;
pub mod ax;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use std::sync::OnceLock;

use crate::backend::macos::ax::AxClient;
use crate::backend::shared_types::{AccessibleNode, ApplicationInfo, Rect};
use crate::backend::{Backend, NodeRef, WindowInfo};

pub struct MacosBackend {
    ax: OnceLock<AxClient>,
}

impl MacosBackend {
    pub fn new() -> Self {
        Self { ax: OnceLock::new() }
    }

    fn ax(&self) -> Result<&AxClient> {
        if let Some(c) = self.ax.get() {
            return Ok(c);
        }
        let c = AxClient::new()?;
        // Primera llamada: verificar permiso de Accessibility con prompt.
        if !AxClient::check_permission(true) {
            return Err(anyhow!(
                "Weaver no tiene permiso de Accessibility. \
                 Ve a System Settings → Privacy & Security → Accessibility \
                 y autoriza a Weaver, luego reinicia la app."
            ));
        }
        // Insertar — si otra thread lo insertó primero, devolver el suyo.
        let _ = self.ax.set(c);
        Ok(self.ax.get().unwrap())
    }
}

impl Default for MacosBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Backend for MacosBackend {
    async fn list_applications(&self) -> Result<Vec<ApplicationInfo>> {
        let ax = self.ax()?;
        // spawn_blocking porque la llamada a NSWorkspace es síncrona.
        tokio::task::spawn_blocking(move || ax.list_applications())
            .await
            .map_err(|e| anyhow!("join: {}", e))?
    }

    async fn query_tree(
        &self,
        app: &ApplicationInfo,
        max_depth: u32,
    ) -> Result<AccessibleNode> {
        // Para macOS, app.bus_name es "pid:N". Necesitamos el AXUIElement de la app.
        // Por ahora, leer el elemento enfocado como aproximación.
        let _ = app;
        let ax = self.ax()?;
        let focused = tokio::task::spawn_blocking(move || ax.focused_element())
            .await
            .map_err(|e| anyhow!("join: {}", e))??;
        let node = tokio::task::spawn_blocking(move || ax.read_node(&focused, max_depth))
            .await
            .map_err(|e| anyhow!("join: {}", e))??;
        Ok(node)
    }

    async fn get_focused_subtree(&self, max_depth: u32) -> Result<Option<AccessibleNode>> {
        let ax = self.ax()?;
        let focused = tokio::task::spawn_blocking(move || ax.focused_element())
            .await
            .map_err(|e| anyhow!("join: {}", e))??;
        let node = tokio::task::spawn_blocking(move || ax.read_node(&focused, max_depth))
            .await
            .map_err(|e| anyhow!("join: {}", e))??;
        Ok(Some(node))
    }

    async fn click(&self, _node: &NodeRef) -> Result<()> {
        // En macOS, "click" en un AXUIElement se hace vía AXPress action.
        // Necesitaríamos el AXUIElement original — el NodeRef no lo guarda.
        // Workaround: usar mouse_click_at con las coordenicas del nodo.
        Err(anyhow!("click() requiere el rect del nodo; usa mouse_click_at(x, y) en su lugar"))
    }

    async fn double_click(&self, _node: &NodeRef) -> Result<()> {
        Err(anyhow!("double_click() requiere el rect del nodo; usa mouse_click_at dos veces"))
    }

    async fn type_text(&self, _node: &NodeRef, text: &str) -> Result<()> {
        // Si el nodo está enfocado, podemos usar CGEvent para escribir.
        // Si no, primero hay que focus() + luego type.
        let text = text.to_string();
        tokio::task::spawn_blocking(move || -> Result<()> {
            crate::backend::macos::appkit::type_text_via_cgevent(&text)
        })
        .await
        .map_err(|e| anyhow!("join: {}", e))?
    }

    async fn press_key(&self, key: &str) -> Result<()> {
        let key = key.to_string();
        tokio::task::spawn_blocking(move || -> Result<()> {
            crate::backend::macos::appkit::press_key_combo_via_cgevent(&key)
        })
        .await
        .map_err(|e| anyhow!("join: {}", e))?
    }

    async fn get_text(&self, _node: &NodeRef) -> Result<Option<String>> {
        // Requeriría el AXUIElement original — no implementado en esta versión.
        Ok(None)
    }

    async fn get_extents(&self, _node: &NodeRef) -> Result<Rect> {
        Err(anyhow!("get_extents requiere el AXUIElement original"))
    }

    async fn focus(&self, _node: &NodeRef) -> Result<()> {
        Err(anyhow!("focus requiere el AXUIElement original"))
    }

    async fn clipboard_get(&self) -> Result<String> {
        tokio::task::spawn_blocking(|| crate::backend::macos::appkit::clipboard_get())
            .await
            .map_err(|e| anyhow!("join: {}", e))?
    }

    async fn clipboard_set(&self, content: &str) -> Result<()> {
        let content = content.to_string();
        tokio::task::spawn_blocking(move || crate::backend::macos::appkit::clipboard_set(&content))
            .await
            .map_err(|e| anyhow!("join: {}", e))?
    }

    async fn list_windows(&self) -> Result<Vec<WindowInfo>> {
        tokio::task::spawn_blocking(|| crate::backend::macos::appkit::list_windows())
            .await
            .map_err(|e| anyhow!("join: {}", e))?
    }

    async fn activate_window(&self, id_or_title: &str) -> Result<()> {
        let s = id_or_title.to_string();
        tokio::task::spawn_blocking(move || -> Result<()> {
            // Aceptar "pid:N" o título.
            if let Some(pid_str) = s.strip_prefix("pid:") {
                let pid: i32 = pid_str.parse().unwrap_or(-1);
                return crate::backend::macos::appkit::activate_window(pid);
            }
            anyhow::bail!("activate_window por título no implementado en macOS aún")
        })
        .await
        .map_err(|e| anyhow!("join: {}", e))?
    }

    async fn key_tap(&self, key: &str) -> Result<()> {
        self.press_key(key).await
    }

    async fn mouse_click_at(&self, x: i32, y: i32, button: u8) -> Result<()> {
        tokio::task::spawn_blocking(move || -> Result<()> {
            crate::backend::macos::appkit::click_at_via_cgevent(x, y, button)
        })
        .await
        .map_err(|e| anyhow!("join: {}", e))?
    }
}
