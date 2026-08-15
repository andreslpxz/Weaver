//! Backend Windows: UIAutomation + Win32 APIs.
//!
//! Estado: **STUB** — la implementación real requiere iteración en Windows
//! real para resolver diferencias de API entre versiones de las crates
//! `uiautomation` (v0.16) y `windows` (v0.58 vs v0.59).
//!
//! Ver `PLAN_WINDOWS.md` para el plan completo de implementación.
//! Los submódulos `uiautomation/` y `win32/` contienen código estructural
//! que servirá como base cuando se resuelvan los issues de tipos.

#![cfg(target_os = "windows")]

// Los submódulos NO se compilan para evitar errores de tipos.
// Se reactivarán cuando se resuelvan los conflictos de versiones.
// pub mod uiautomation;
// pub mod win32;

use anyhow::{anyhow, Result};
use async_trait::async_trait;

use crate::backend::shared_types::{AccessibleNode, ApplicationInfo, Rect};
use crate::backend::{Backend, NodeRef, WindowInfo};

const NOT_IMPLEMENTED: &str = "Windows backend en desarrollo — ver PLAN_WINDOWS.md. \
    Web tools (web_search, web_fetch, shell_exec, save_file) funcionan. \
    Desktop automation (UIAutomation) requiere iteración con cargo check en Windows.";

pub struct WindowsBackend;

impl WindowsBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Default for WindowsBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Backend for WindowsBackend {
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
