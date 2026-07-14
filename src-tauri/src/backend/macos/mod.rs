//! Backend macOS: Accessibility API (AXUIElement) + AppKit + CoreGraphics.
//!
//! Estado: **STUB** — la implementación real requiere iteración en macOS
//! real para resolver diferencias de API entre versiones de las crates
//! `accessibility`, `objc2-app-kit`, `objc2-core-graphics` y `enigo`.
//!
//! Ver `PLAN_MACOS.md` para el plan completo de implementación.
//! Los submódulos `ax/` y `appkit/` contienen código estructural que
//! servirá como base cuando se resuelvan los issues de tipos.

#![cfg(target_os = "macos")]

pub mod appkit;
pub mod ax;

use anyhow::{anyhow, Result};
use async_trait::async_trait;

use crate::backend::shared_types::{AccessibleNode, ApplicationInfo, Rect};
use crate::backend::{Backend, NodeRef, WindowInfo};

const NOT_IMPLEMENTED: &str = "macOS backend en desarrollo — ver PLAN_MACOS.md. \
    Los submódulos ax/ y appkit/ tienen código estructural pero requiere \
    iteración en macOS real para resolver diferencias de API entre versiones \
    de las crates accessibility/objc2/enigo.";

pub struct MacosBackend;

impl MacosBackend {
    pub fn new() -> Self {
        Self
    }

    /// Verifica que la app tiene permiso de Accessibility.
    /// Llamar al iniciar para guiar al usuario si no lo tiene.
    pub fn check_accessibility_permission(_prompt: bool) -> bool {
        false
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
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn query_tree(
        &self,
        _app: &ApplicationInfo,
        _max_depth: u32,
    ) -> Result<AccessibleNode> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn get_focused_subtree(&self, _max_depth: u32) -> Result<Option<AccessibleNode>> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn click(&self, _node: &NodeRef) -> Result<()> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn double_click(&self, _node: &NodeRef) -> Result<()> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn type_text(&self, _node: &NodeRef, _text: &str) -> Result<()> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn press_key(&self, _key: &str) -> Result<()> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn get_text(&self, _node: &NodeRef) -> Result<Option<String>> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn get_extents(&self, _node: &NodeRef) -> Result<Rect> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn focus(&self, _node: &NodeRef) -> Result<()> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn clipboard_get(&self) -> Result<String> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn clipboard_set(&self, _content: &str) -> Result<()> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn list_windows(&self) -> Result<Vec<WindowInfo>> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn activate_window(&self, _id_or_title: &str) -> Result<()> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn key_tap(&self, _key: &str) -> Result<()> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn mouse_click_at(&self, _x: i32, _y: i32, _button: u8) -> Result<()> {
        Err(anyhow!(NOT_IMPLEMENTED))
    }
}
