//! Tipos canónicos del módulo AT-SPI.
//!
//! Estos tipos cruzan la frontera Tauri (Rust ↔ TypeScript) vía `serde`, por lo
//! que cualquier cambio aquí debe reflejar los tipos en `src/lib/tauri.ts`.

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

/// Conjunto de estados AT-SPI serializado como lista legible.
/// Ejemplos: `focused`, `focusable`, `editable`, `visible`, `enabled`, `pressed`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StateSet(pub BTreeSet<String>);

impl StateSet {
    pub fn has(&self, s: &str) -> bool {
        self.0.contains(s)
    }
}

/// Rol AT-SPI normalizado a un subconjunto estable.
/// Los roles crudos son strings tipo `"push button"`; aquí los canonicalizamos.
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

impl Role {
    pub fn from_raw(raw: &str) -> Self {
        match raw.to_ascii_lowercase().as_str() {
            "window" => Role::Window,
            "dialog" => Role::Dialog,
            "frame" => Role::Frame,
            "panel" | "filler" | "viewport" => Role::Panel,
            "push button" => Role::PushButton,
            "toggle button" => Role::ToggleButton,
            "check box" => Role::CheckBox,
            "radio button" => Role::RadioButton,
            "combo box" => Role::ComboBox,
            "editbar" => Role::EditBar,
            "entry" => Role::Entry,
            "text" | "paragraph" | "heading" => Role::Text,
            "label" => Role::Label,
            "menu item" => Role::MenuItem,
            "menu" => Role::Menu,
            "menu bar" => Role::MenuBar,
            "list" => Role::List,
            "list item" => Role::ListItem,
            "tree" | "tree table" => Role::Tree,
            "tree item" => Role::TreeItem,
            "table" => Role::Table,
            "table cell" => Role::TableCell,
            "page tab" => Role::Tab,
            "page tab list" => Role::TabList,
            "scroll bar" => Role::ScrollBar,
            "slider" => Role::Slider,
            "spin button" => Role::SpinButton,
            "link" => Role::Link,
            "image" => Role::Image,
            "separator" => Role::Separator,
            "canvas" | "html container" => Role::Canvas,
            _ => Role::Unknown,
        }
    }
}

/// Información breve de una aplicación registrada en AT-SPI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplicationInfo {
    /// Nombre legible (ej. `"firefox"`, `"gnome-text-editor"`).
    pub name: String,
    /// Bus name en D-Bus (ej. `":1.42"`).
    pub bus_name: String,
    /// Object path del root accessible (ej. `"/org/a11y/atspi/accessible/123"`).
    pub root_path: String,
    /// PID si está disponible, 0 si no.
    pub pid: u32,
    /// Número de hijos top-level (ventanas).
    pub child_count: i32,
}

/// Nodo del árbol de accesibilidad.
///
/// El campo `path` es el object path D-Bus del elemento, y se usa como
/// referencia opaca para todas las operaciones (`click`, `type_text`, etc.).
/// Esto evita mandar coordenadas por la red y permite operar incluso si la
/// ventana se mueve entre la consulta y la acción.
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
