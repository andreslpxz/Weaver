//! Cliente D-Bus para AT-SPI2.
//!
//! AT-SPI2 expone el servicio `org.a11y.atspi.Registry` en la sesión D-Bus.
//! El root accessible está en `/org/a11y/atspi/accessible/root` e implementa
//! la interfaz `org.a11y.atspi.Socket` (método `Embed`) además de
//! `org.a11y.atspi.Accessible`.
//!
//! Para cada aplicación registrada, su raíz cuelga como hijo del root.
//! Cada Accessible implementa varias interfaces D-Bus:
//!   - `org.a11y.atspi.Accessible`: Name, Description, Role, Parent, ChildCount,
//!     GetChildAtIndex, GetChildren, GetRelationSet.
//!   - `org.a11y.atspi.Action`: NActions, GetActionName, DoAction.
//!   - `org.a11y.atspi.Component`: GetExtents, GrabFocus, Contains.
//!   - `org.a11y.atspi.Text`: GetText, SetText, CharacterCount.
//!   - `org.a11y.atspi.Value`: CurrentValue (get/set).

use anyhow::{Context, Result};
use zbus::{proxy, Connection};

use super::types::{AccessibleNode, ApplicationInfo, Rect, Role, StateSet};

/// Proxy al root accessible del registry AT-SPI.
#[proxy(
    interface = "org.a11y.atspi.Accessible",
    default_service = "org.a11y.atspi.Registry",
    default_path = "/org/a11y/atspi/accessible/root"
)]
pub trait RegistryAccessible {
    fn get_name(&self) -> zbus::Result<String>;
    fn get_role_name(&self) -> zbus::Result<String>;
    fn get_child_count(&self) -> zbus::Result<i32>;
    fn get_child_at_index(&self, index: i32) -> zbus::Result<(String, zbus::zvariant::OwnedObjectPath)>;
    fn get_children(&self) -> zbus::Result<Vec<(String, zbus::zvariant::OwnedObjectPath)>>;
}

/// Proxy genérico a `org.a11y.atspi.Accessible` para cualquier objeto.
#[proxy(interface = "org.a11y.atspi.Accessible")]
pub trait Accessible {
    fn get_name(&self) -> zbus::Result<String>;
    fn get_description(&self) -> zbus::Result<String>;
    fn get_role_name(&self) -> zbus::Result<String>;
    fn get_child_count(&self) -> zbus::Result<i32>;
    fn get_child_at_index(&self, index: i32) -> zbus::Result<(String, zbus::zvariant::OwnedObjectPath)>;
    fn get_children(&self) -> zbus::Result<Vec<(String, zbus::zvariant::OwnedObjectPath)>>;
    fn get_states(&self) -> zbus::Result<Vec<String>>;
    fn get_parent(&self) -> zbus::Result<(String, zbus::zvariant::OwnedObjectPath)>;
}

/// Proxy a `org.a11y.atspi.Action`.
#[proxy(interface = "org.a11y.atspi.Action")]
pub trait Action {
    fn n_actions(&self) -> zbus::Result<i32>;
    fn get_action_name(&self, index: i32) -> zbus::Result<String>;
    fn get_action_description(&self, index: i32) -> zbus::Result<String>;
    fn do_action(&self, index: i32) -> zbus::Result<bool>;
}

/// Proxy a `org.a11y.atspi.Component`.
/// El argumento `coord_type` es un `u32`: 0 = screen, 1 = window.
#[proxy(interface = "org.a11y.atspi.Component")]
pub trait Component {
    fn get_extents(&self, coord_type: u32) -> zbus::Result<(i32, i32, i32, i32)>;
    fn grab_focus(&self) -> zbus::Result<bool>;
    fn contains(&self, x: i32, y: i32, coord_type: u32) -> zbus::Result<bool>;
}

/// Proxy a `org.a11y.atspi.Text`.
#[proxy(interface = "org.a11y.atspi.Text")]
pub trait Text {
    fn get_text(&self, start_offset: i32, end_offset: i32) -> zbus::Result<String>;
    fn set_text(&self, content: &str) -> zbus::Result<()>;
    fn character_count(&self) -> zbus::Result<i32>;
    fn get_caret_offset(&self) -> zbus::Result<i32>;
    fn set_caret_offset(&self, offset: i32) -> zbus::Result<bool>;
}

/// Cliente AT-SPI. Una conexión D-Bus reutilizable.
#[derive(Clone)]
pub struct AtspiClient {
    conn: Connection,
}

impl AtspiClient {
    /// Conecta a la sesión D-Bus y verifica que el registry AT-SPI responde.
    pub async fn connect() -> Result<Self> {
        let conn = Connection::session()
            .await
            .context("no se pudo conectar a la sesión D-Bus (¿estás en un escritorio real?)")?;

        // Sanity check: pedir el nombre del root accessible.
        let registry = RegistryAccessibleProxy::new(&conn).await?;
        let name = registry.get_name().await.context(
            "AT-SPI registry no respondió. Verifica que el bus de accesibilidad esté activo \
             (gsettings org.gnome.desktop.interface toolkit-accessibility true).",
        )?;
        tracing::debug!("AT-SPI registry root name = {name:?}");

        Ok(Self { conn })
    }

    /// Devuelve una referencia a la conexión D-Bus subyacente.
    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    /// Lista todas las aplicaciones registradas en el registry AT-SPI.
    pub async fn list_applications(&self) -> Result<Vec<ApplicationInfo>> {
        let registry = RegistryAccessibleProxy::new(&self.conn).await?;
        let children = registry.get_children().await?;

        let mut apps = Vec::with_capacity(children.len());
        for (bus_name, path) in children {
            let acc = AccessibleProxy::builder(&self.conn)
                .destination(bus_name.as_str())?
                .path(path.as_str())?
                .build()
                .await;
            let acc = match acc {
                Ok(a) => a,
                Err(e) => {
                    tracing::warn!("skip {bus_name} {path}: {e}");
                    continue;
                }
            };
            let name = acc.get_name().await.unwrap_or_default();
            let role = acc.get_role_name().await.unwrap_or_default();
            let child_count = acc.get_child_count().await.unwrap_or(0);
            apps.push(ApplicationInfo {
                name: if name.is_empty() { bus_name.clone() } else { name },
                bus_name,
                root_path: path.to_string(),
                pid: 0,
                child_count,
            });
            let _ = role; // role del app root normalmente es "application"
        }
        Ok(apps)
    }

    /// Devuelve el sub-árbol de accesibilidad a partir de un object path,
    /// hasta `max_depth` niveles de profundidad.
    pub async fn query_tree(
        &self,
        bus_name: &str,
        root_path: &str,
        max_depth: u32,
    ) -> Result<AccessibleNode> {
        let conn = self.conn.clone();
        let node = read_node(&conn, bus_name, root_path, max_depth).await?;
        Ok(node)
    }
}

/// Lee recursivamente un nodo Accessible con sus hijos.
async fn read_node(
    conn: &Connection,
    bus_name: &str,
    path: &str,
    depth_left: u32,
) -> Result<AccessibleNode> {
    let acc = AccessibleProxy::builder(conn)
        .destination(bus_name)?
        .path(path)?
        .build()
        .await?;

    let name = acc.get_name().await.unwrap_or_default();
    let description = acc.get_description().await.unwrap_or_default();
    let role_raw = acc.get_role_name().await.unwrap_or_default();
    let role = Role::from_raw(&role_raw);
    let states_raw = acc.get_states().await.unwrap_or_default();
    let states = StateSet(states_raw.into_iter().collect());

    // Extents (opcional, algunos objetos no implementan Component).
    let rect = match ComponentProxy::builder(conn)
        .destination(bus_name)?
        .path(path)?
        .build()
        .await
    {
        Ok(c) => c
            .get_extents(0)
            .await
            .ok()
            .map(|(x, y, w, h)| Rect { x, y, width: w, height: h }),
        Err(_) => None,
    };

    // Texto (opcional).
    let text = if let Ok(t) = TextProxy::builder(conn)
        .destination(bus_name)?
        .path(path)?
        .build()
        .await
    {
        match t.character_count().await {
            Ok(count) if count > 0 && count < 50_000 => t.get_text(0, count).await.ok(),
            _ => None,
        }
    } else {
        None
    };

    // Actions.
    let mut actions = Vec::new();
    if let Ok(action_proxy) = ActionProxy::builder(conn)
        .destination(bus_name)?
        .path(path)?
        .build()
        .await
    {
        if let Ok(n) = action_proxy.n_actions().await {
            for i in 0..n.max(0) {
                if let Ok(an) = action_proxy.get_action_name(i).await {
                    actions.push(an);
                }
            }
        }
    }

    // Hijos recursivos.
    let mut children = Vec::new();
    if depth_left > 0 {
        if let Ok(child_list) = acc.get_children().await {
            for (cbus, cpath) in child_list.into_iter().take(200) {
                // Algunos backends reportan su propio bus name; usarlo si está vacío.
                let cbus = if cbus.is_empty() { bus_name.to_string() } else { cbus };
                // Box::pin necesario: async fn recursiva requiere indirección.
                if let Ok(child) = Box::pin(read_node(conn, &cbus, cpath.as_str(), depth_left - 1)).await {
                    children.push(child);
                }
            }
        }
    }

    Ok(AccessibleNode {
        path: path.to_string(),
        bus_name: bus_name.to_string(),
        name,
        description,
        role,
        role_raw,
        states,
        rect,
        text,
        actions,
        children,
    })
}
