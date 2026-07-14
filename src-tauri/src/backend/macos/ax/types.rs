//! Mapeo de tipos AXUIElement → tipos canónicos de Weaver.
//!
//! macOS Accessibility API expone cada elemento con un `AXRole` string
//! (`"AXButton"`, `"AXTextField"`, etc.). Aquí lo convertimos al enum
//! `Role` canónico que comparten Linux/Windows/macOS.

use crate::backend::shared_types::{Role, StateSet};
use std::collections::BTreeSet;

/// Convierte un string `AXRole` de macOS al `Role` canónico.
///
/// Lista de roles de macOS:
/// https://developer.apple.com/documentation/appkit/axrole
pub fn ax_role_to_role(ax_role: &str) -> Role {
    match ax_role {
        "AXButton" => Role::PushButton,
        "AXCheckBox" => Role::CheckBox,
        "AXRadioButton" => Role::RadioButton,
        "AXPopUpButton" => Role::ComboBox,
        "AXMenuButton" => Role::ComboBox,
        "AXComboBox" => Role::ComboBox,
        "AXTextField" => Role::Entry,
        "AXTextArea" => Role::Text,
        "AXStaticText" => Role::Label,
        "AXGroup" => Role::Panel,
        "AXRow" => Role::ListItem,
        "AXOutline" => Role::Tree,
        "AXOutlineRow" => Role::TreeItem,
        "AXList" => Role::List,
        "AXMenu" => Role::Menu,
        "AXMenuBar" => Role::MenuBar,
        "AXMenuBarItem" => Role::MenuItem,
        "AXMenuItem" => Role::MenuItem,
        "AXPopUpButton" => Role::ComboBox,
        "AXTabGroup" => Role::TabList,
        "AXTab" => Role::Tab,
        "AXTable" => Role::Table,
        "AXCell" => Role::TableCell,
        "AXLink" => Role::Link,
        "AXImage" => Role::Image,
        "AXSlider" => Role::Slider,
        "AXIncrementor" => Role::SpinButton,
        "AXScrollArea" => Role::Panel,
        "AXScrollBar" => Role::ScrollBar,
        "AXProgressIndicator" => Role::Unknown,
        "AXBusyIndicator" => Role::Unknown,
        "AXWindow" => Role::Window,
        "AXSheet" => Role::Dialog,
        "AXDrawer" => Role::Dialog,
        "AXHelpTag" => Role::Dialog,
        "AXToolbar" => Role::Panel,
        "AXBrowser" => Role::Panel,
        "AXColumn" => Role::Panel,
        "AXOutline" => Role::Tree,
        "AXSplitGroup" => Role::Panel,
        "AXSplitter" => Role::Separator,
        "AXUnknown" => Role::Unknown,
        _ => Role::Unknown,
    }
}

/// Construye un `StateSet` a partir de atributos AXUIElement.
///
/// macOS usa atributos booleanos como `AXEnabled`, `AXFocused`, etc.
pub fn build_state_set(
    is_enabled: bool,
    is_focused: bool,
    is_focusable: bool,
    is_password: bool,
) -> StateSet {
    let mut states = BTreeSet::new();
    if is_enabled {
        states.insert("enabled".to_string());
    }
    if is_focused {
        states.insert("focused".to_string());
    }
    if is_focusable {
        states.insert("focusable".to_string());
    }
    if is_password {
        states.insert("password".to_string());
    }
    // En macOS no hay "is_offscreen" directo; asumimos visible.
    states.insert("visible".to_string());
    StateSet(states)
}
