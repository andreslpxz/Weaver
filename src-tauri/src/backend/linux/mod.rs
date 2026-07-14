//! Implementación del trait [`Backend`] para Linux.
//!
//! Envuelve los módulos [`atspi`] y [`automation`] (que ahora viven dentro
//! de este mismo módulo) bajo una interfaz común para que `commands.rs`
//! pueda delegar al trait `Backend` independientemente del OS.
//!
//! Nota: por compatibilidad con el código existente, los comandos Tauri
//! actuales siguen usando `AtspiClient` directamente vía `OnceCell`. Este
//! backend está disponible para que futuras refactorizaciones unifiquen
//! el flujo bajo el trait `Backend`.

pub mod atspi;
pub mod automation;
pub mod wayland;

use anyhow::Result;
use async_trait::async_trait;
use tokio::sync::OnceCell;

use crate::backend::{Backend, NodeRef, WindowInfo};

use atspi::types::{AccessibleNode, ApplicationInfo, Rect};
use atspi::AtspiClient;

/// Backend Linux: usa AT-SPI2 (vía D-Bus) y automatización X11/Wayland.
pub struct LinuxBackend {
    atspi: OnceCell<AtspiClient>,
}

impl LinuxBackend {
    pub fn new() -> Self {
        Self {
            atspi: OnceCell::new(),
        }
    }

    async fn client(&self) -> Result<&AtspiClient> {
        self.atspi
            .get_or_try_init(|| async { AtspiClient::connect().await })
            .await
    }
}

impl Default for LinuxBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Backend for LinuxBackend {
    async fn list_applications(&self) -> Result<Vec<ApplicationInfo>> {
        let client = self.client().await?;
        client.list_applications().await
    }

    async fn query_tree(
        &self,
        app: &ApplicationInfo,
        max_depth: u32,
    ) -> Result<AccessibleNode> {
        let client = self.client().await?;
        client
            .query_tree(&app.bus_name, &app.root_path, max_depth)
            .await
    }

    async fn get_focused_subtree(&self, max_depth: u32) -> Result<Option<AccessibleNode>> {
        let client = self.client().await?;
        client.get_focused_subtree(max_depth).await
    }

    async fn click(&self, node: &NodeRef) -> Result<()> {
        let client = self.client().await?;
        atspi::actions::click(client.connection(), &node.bus_name, &node.path).await
    }

    async fn double_click(&self, node: &NodeRef) -> Result<()> {
        let client = self.client().await?;
        atspi::actions::double_click(client.connection(), &node.bus_name, &node.path).await
    }

    async fn type_text(&self, node: &NodeRef, text: &str) -> Result<()> {
        let client = self.client().await?;
        atspi::actions::type_text(client.connection(), &node.bus_name, &node.path, text).await
    }

    async fn press_key(&self, key: &str) -> Result<()> {
        automation::keyboard::press_key_combo(key).await
    }

    async fn get_text(&self, node: &NodeRef) -> Result<Option<String>> {
        let client = self.client().await?;
        atspi::actions::get_text(client.connection(), &node.bus_name, &node.path).await
    }

    async fn get_extents(&self, node: &NodeRef) -> Result<Rect> {
        let client = self.client().await?;
        let (x, y, w, h) = atspi::actions::get_extents(
            client.connection(),
            &node.bus_name,
            &node.path,
        )
        .await?;
        Ok(Rect { x, y, width: w, height: h })
    }

    async fn focus(&self, node: &NodeRef) -> Result<()> {
        let client = self.client().await?;
        atspi::actions::focus(client.connection(), &node.bus_name, &node.path).await
    }

    async fn clipboard_get(&self) -> Result<String> {
        automation::clipboard::clipboard_get().await
    }

    async fn clipboard_set(&self, content: &str) -> Result<()> {
        automation::clipboard::clipboard_set(content).await
    }

    async fn list_windows(&self) -> Result<Vec<WindowInfo>> {
        let wins = automation::windows::list_windows().await?;
        Ok(wins
            .into_iter()
            .map(|w| WindowInfo {
                id: w.id,
                title: w.title,
                class_name: String::new(),
                process_name: format!("pid:{}", w.pid),
                rect: Some(Rect {
                    x: w.geometry.0,
                    y: w.geometry.1,
                    width: w.geometry.2,
                    height: w.geometry.3,
                }),
            })
            .collect())
    }

    async fn activate_window(&self, id_or_title: &str) -> Result<()> {
        automation::windows::activate_window(id_or_title).await
    }

    async fn key_tap(&self, key: &str) -> Result<()> {
        automation::keyboard::press_key_combo(key).await
    }

    async fn mouse_click_at(&self, x: i32, y: i32, button: u8) -> Result<()> {
        automation::mouse::click_at(x, y, button).await
    }
}
