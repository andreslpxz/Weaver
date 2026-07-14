//! Backend macOS: Accessibility API (AXUIElement) + AppKit + CoreGraphics.
//!
//! Este módulo está bajo `cfg(target_os = "macos")` y solo compila en macOS.
//! Implementa el trait [`Backend`] usando:
//!
//! - `accessibility` crate: bindings a AXUIElement (ApplicationServices.framework).
//! - `objc2-app-kit`: NSPasteboard, NSWorkspace.
//! - `objc2-core-graphics`: CGEvent para input sintético.
//! - `enigo` crate: wrapper cross-platform (usa CGEvent en macOS).
//!
//! Estado: **STUB** — compila pero las funciones devuelven `Err(NotImplemented)`.
//! La implementación real está planificada en `PLAN_MACOS.md` Fases M2-M4.
//!
//! IMPORTANTE: macOS requiere permiso de Accessibility en System Settings →
//! Privacy & Security. Sin él, los CGEvent se descartan silenciosamente.
//! Verificar con `AXIsProcessTrusted()` al iniciar.

#![cfg(target_os = "macos")]

use anyhow::{anyhow, Result};
use async_trait::async_trait;

use crate::backend::{AccessibleNode, ApplicationInfo, Backend, NodeRef, Rect, WindowInfo};

const NOT_IMPLEMENTED: &str = "macOS backend no implementado aún (ver PLAN_MACOS.md)";

pub struct MacosBackend;

impl MacosBackend {
    pub fn new() -> Self {
        Self
    }

    /// Verifica que la app tiene permiso de Accessibility.
    /// Llamar al iniciar para guiar al usuario si no lo tiene.
    pub fn check_accessibility_permission() -> bool {
        // TODO M2: usar accessibility::AXIsProcessTrustedWithOptions
        // con prompt = true para mostrar diálogo nativo.
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
        // TODO M2: NSWorkspace::runningApplications → mapear a ApplicationInfo
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn query_tree(
        &self,
        _app: &ApplicationInfo,
        _max_depth: u32,
    ) -> Result<AccessibleNode> {
        // TODO M2: AXUIElementCreateApplication(pid) + recursión sobre AXChildren
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn get_focused_subtree(&self, _max_depth: u32) -> Result<Option<AccessibleNode>> {
        // TODO M2: AXUIElementCopyAttributeValue(kAXFocusedUIElementAttribute)
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn click(&self, _node: &NodeRef) -> Result<()> {
        // TODO M3: AXPress action, fallback CGEvent en AXPosition + AXSize
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn double_click(&self, _node: &NodeRef) -> Result<()> {
        // TODO M3: dos AXPress + pausa 80ms
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn type_text(&self, _node: &NodeRef, _text: &str) -> Result<()> {
        // TODO M3: AXSetValue, fallback CGEvent keyboard
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn press_key(&self, _key: &str) -> Result<()> {
        // TODO M3: enigo::key_click con mapeo "cmd+c" → Key::Meta + 'C'
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn get_text(&self, _node: &NodeRef) -> Result<Option<String>> {
        // TODO M3: AXValue attribute
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn get_extents(&self, _node: &NodeRef) -> Result<Rect> {
        // TODO M3: AXPosition + AXSize
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn focus(&self, _node: &NodeRef) -> Result<()> {
        // TODO M3: AXSetFocused attribute
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn clipboard_get(&self) -> Result<String> {
        // TODO M4: NSPasteboard::generalPasteboard + stringForType:
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn clipboard_set(&self, _content: &str) -> Result<()> {
        // TODO M4: NSPasteboard::clearContents + setString:forType:
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn list_windows(&self) -> Result<Vec<WindowInfo>> {
        // TODO M4: leer AXWindows de cada app activa
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn activate_window(&self, _id_or_title: &str) -> Result<()> {
        // TODO M4: NSRunningApplication::activateWithOptions
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn key_tap(&self, _key: &str) -> Result<()> {
        // TODO M4: enigo::key_click
        Err(anyhow!(NOT_IMPLEMENTED))
    }

    async fn mouse_click_at(&self, _x: i32, _y: i32, _button: u8) -> Result<()> {
        // TODO M4: CGEventCreateMouseEvent + CGEventPost(kCGHIDEventTap)
        Err(anyhow!(NOT_IMPLEMENTED))
    }
}
