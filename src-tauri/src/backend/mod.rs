//! Trait común para abstraer el backend de accesibilidad y automatización
//! entre Linux (AT-SPI), Windows (UIAutomation) y macOS (AXUIElement).
//!
//! Cada plataforma implementa [`Backend`] y los comandos Tauri delegan
//! al backend activo según `cfg!(target_os)`.
//!
//! Esto permite que el frontend TypeScript sea 100% agnóstico al OS: solo
//! llama comandos Tauri con la misma firma, sin importar si está en Linux,
//! Windows o macOS.

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

// Re-export de tipos compartidos para que los backends de cada OS no
// tengan que referenciar `crate::backend::linux::atspi::types` (lo cual
// acoplaría Windows/macOS al código Linux). Los tipos viven en Linux
// históricamente, pero conceptualmente son cross-platform.
#[cfg(target_os = "linux")]
pub use crate::backend::linux::atspi::types::{AccessibleNode, ApplicationInfo, Rect, Role, StateSet};

#[cfg(any(target_os = "windows", target_os = "macos"))]
mod shared_types;

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub use crate::backend::shared_types::{AccessibleNode, ApplicationInfo, Rect, Role, StateSet};

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "macos")]
pub mod macos;

/// Referencia opaca a un nodo del árbol de accesibilidad.
///
/// En Linux: `bus_name` + `path` (D-Bus object path).
/// En Windows: `bus_name` = HWND como string, `path` = RuntimeId serializado.
/// En macOS: `bus_name` = PID como string, `path` = AXUIElement ref encoded.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeRef {
    pub bus_name: String,
    pub path: String,
}

impl NodeRef {
    pub fn new(bus_name: impl Into<String>, path: impl Into<String>) -> Self {
        Self {
            bus_name: bus_name.into(),
            path: path.into(),
        }
    }
}

/// Información de una ventana (cross-platform).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    /// ID opaco: HWND en Windows, X11 window id, NSWindow pointer.
    pub id: String,
    pub title: String,
    /// Class name (X11 WM_CLASS, Windows ClassName, macOS bundle id).
    pub class_name: String,
    /// Nombre del proceso dueño.
    pub process_name: String,
    /// Bounding box en coords de pantalla.
    pub rect: Option<Rect>,
}

/// Trait que cada plataforma implementa.
///
/// Todos los métodos son async para permitir operaciones que requieren
/// IPC (D-Bus en Linux) o llamadas COM/UI threads (Windows/macOS).
#[async_trait]
pub trait Backend: Send + Sync {
    // ── Accesibilidad ─────────────────────────────────────────────────

    /// Lista las aplicaciones registradas en el sistema de accesibilidad.
    async fn list_applications(&self) -> Result<Vec<ApplicationInfo>>;

    /// Consulta el árbol de accesibilidad de una app, hasta `max_depth`.
    async fn query_tree(
        &self,
        app: &ApplicationInfo,
        max_depth: u32,
    ) -> Result<AccessibleNode>;

    /// Devuelve el sub-árbol con foco actual (útil para no escanear todo).
    async fn get_focused_subtree(&self, max_depth: u32) -> Result<Option<AccessibleNode>>;

    /// Hace clic en un elemento accesible.
    async fn click(&self, node: &NodeRef) -> Result<()>;

    /// Hace doble clic en un elemento accesible.
    async fn double_click(&self, node: &NodeRef) -> Result<()>;

    /// Escribe texto en un elemento editable.
    async fn type_text(&self, node: &NodeRef, text: &str) -> Result<()>;

    /// Presiona una tecla o combinación (ej. "Return", "Ctrl+C", "Super").
    async fn press_key(&self, key: &str) -> Result<()>;

    /// Lee el texto de un elemento.
    async fn get_text(&self, node: &NodeRef) -> Result<Option<String>>;

    /// Devuelve el bounding box de un elemento.
    async fn get_extents(&self, node: &NodeRef) -> Result<Rect>;

    /// Pone el foco en un elemento.
    async fn focus(&self, node: &NodeRef) -> Result<()>;

    // ── Automatización ────────────────────────────────────────────────

    /// Lee el portapapeles del sistema.
    async fn clipboard_get(&self) -> Result<String>;

    /// Escribe en el portapapeles del sistema.
    async fn clipboard_set(&self, content: &str) -> Result<()>;

    /// Lista las ventanas top-level visibles.
    async fn list_windows(&self) -> Result<Vec<WindowInfo>>;

    /// Activa una ventana por ID o título (substring match).
    async fn activate_window(&self, id_or_title: &str) -> Result<()>;

    /// Emula un tap de tecla (igual que `press_key` pero sin retención).
    async fn key_tap(&self, key: &str) -> Result<()>;

    /// Clic del ratón en coordenadas absolutas de pantalla.
    async fn mouse_click_at(&self, x: i32, y: i32, button: u8) -> Result<()>;
}

/// Factory que devuelve el backend activo según el OS de compilación.
pub fn create_backend() -> Box<dyn Backend> {
    #[cfg(target_os = "linux")]
    {
        Box::new(crate::backend::linux::LinuxBackend::new())
    }
    #[cfg(target_os = "windows")]
    {
        Box::new(crate::backend::windows::WindowsBackend::new())
    }
    #[cfg(target_os = "macos")]
    {
        Box::new(crate::backend::macos::MacosBackend::new())
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        compile_error!("Weaver requires Linux, Windows or macOS");
    }
}
