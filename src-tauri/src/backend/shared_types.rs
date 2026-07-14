//! Tipos compartidos del trait `Backend`.
//!
//! Estos tipos existen para que Windows y macOS no tengan que depender de
//! `crate::backend::linux::atspi::types`. En Linux se re-exportan directamente
//! desde ahí por compatibilidad histórica con `commands.rs` y el código
//! existente; en Windows/macOS se usan estas definiciones independientes.
//!
//! Si en el futuro se quiere unificar totalmente, mover estos tipos a
//! `backend/mod.rs` y eliminar el re-export de Linux.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Bounding box de un elemento accesible, en coordenadas de pantalla.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Conjunto de estados serializado como lista legible.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StateSet(pub BTreeSet<String>);

impl StateSet {
    pub fn has(&self, s: &str) -> bool {
        self.0.contains(s)
    }
}

/// Rol canónico (subconjunto estable, mapeado desde el rol crudo de cada OS).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Window,
    Dialog,
    Frame,
    Panel,
    PushButton,
    ToggleButton,
    CheckBox,
    RadioButton,
    ComboBox,
    EditBar,
    Entry,
    Text,
    Label,
    MenuItem,
    Menu,
    MenuBar,
    List,
    ListItem,
    Tree,
    TreeItem,
    Table,
    TableCell,
    Tab,
    TabList,
    ScrollBar,
    Slider,
    SpinButton,
    Link,
    Image,
    Separator,
    Canvas,
    Unknown,
}

/// Información breve de una aplicación.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplicationInfo {
    pub name: String,
    pub bus_name: String,
    pub root_path: String,
    pub pid: u32,
    pub child_count: i32,
}

/// Nodo del árbol de accesibilidad.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessibleNode {
    pub path: String,
    pub bus_name: String,
    pub name: String,
    pub description: String,
    pub role: Role,
    pub role_raw: String,
    pub states: StateSet,
    pub rect: Option<Rect>,
    pub text: Option<String>,
    pub actions: Vec<String>,
    pub children: Vec<AccessibleNode>,
}
