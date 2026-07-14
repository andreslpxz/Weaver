//! Helpers de alto nivel para navegar el árbol AT-SPI.

use anyhow::Result;

use super::client::AtspiClient;
use super::types::AccessibleNode;

impl AtspiClient {
    /// Devuelve el sub-árbol colgando del objeto con foco, hasta `max_depth`.
    /// Útil para evitar leer el árbol completo cuando solo importa la ventana
    /// activa.
    pub async fn get_focused_subtree(&self, max_depth: u32) -> Result<Option<AccessibleNode>> {
        let apps = self.list_applications().await?;
        for app in apps {
            let tree = self
                .query_tree(&app.bus_name, &app.root_path, 1)
                .await
                .unwrap_or(AccessibleNode {
                    path: app.root_path.clone(),
                    bus_name: app.bus_name.clone(),
                    name: app.name.clone(),
                    description: String::new(),
                    role: super::types::Role::Unknown,
                    role_raw: String::new(),
                    states: super::types::StateSet::default(),
                    rect: None,
                    text: None,
                    actions: vec![],
                    children: vec![],
                });
            for child in &tree.children {
                if child.states.has("focused") || child.states.has("active") {
                    let deep = self
                        .query_tree(&child.bus_name, &child.path, max_depth)
                        .await?;
                    return Ok(Some(deep));
                }
            }
        }
        Ok(None)
    }
}
