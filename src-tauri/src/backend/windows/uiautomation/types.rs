//! Mapeo de tipos UIAutomation → tipos canónicos de Weaver.
//!
//! Microsoft UIAutomation expone cada elemento con un `ControlType` enum
//! (`ButtonControlType`, `EditControlType`, etc.). Aquí lo convertimos al
//! enum `Role` canónico que comparten Linux/Windows/macOS.

use crate::backend::shared_types::Role;

/// Convierte un `ControlType` de la crate `uiautomation` al `Role` canónico.
pub fn control_type_to_role(control_type: uiautomation::types::ControlType) -> Role {
    use uiautomation::types::ControlType::*;

    match control_type {
        Button => Role::PushButton,
        CheckBox => Role::CheckBox,
        RadioButton => Role::RadioButton,
        ComboBox => Role::ComboBox,
        Edit => Role::Entry,
        Document | Text => Role::Text,
        Text_Pane => Role::Panel,
        Hyperlink => Role::Link,
        Image => Role::Image,
        List => Role::List,
        ListItem => Role::ListItem,
        Menu => Role::Menu,
        MenuBar => Role::MenuBar,
        MenuItem => Role::MenuItem,
        ProgressBar => Role::Unknown,
        ScrollBar => Role::ScrollBar,
        Slider => Role::Slider,
        Spinner => Role::SpinButton,
        StatusBar => Role::Panel,
        Tab => Role::Tab,
        TabItem => Role::Tab,
        ToolBar => Role::Panel,
        ToolTip => Role::Label,
        Tree => Role::Tree,
        TreeItem => Role::TreeItem,
        Custom => Role::Unknown,
        Group => Role::Panel,
        Thumb => Role::Unknown,
        DataGrid => Role::Table,
        DataItem => Role::TableCell,
        Document_Pane => Role::Text,
        SplitButton => Role::PushButton,
        Window => Role::Window,
        Pane => Role::Panel,
        Header => Role::Panel,
        HeaderItem => Role::Panel,
        Table => Role::Table,
        TitleBar => Role::Label,
        Separator => Role::Separator,
        Calendar => Role::Unknown,
        _ => Role::Unknown,
    }
}

/// Mapea el nombre crudo del ControlType a string para `role_raw`.
pub fn control_type_name(control_type: uiautomation::types::ControlType) -> String {
    format!("{:?}", control_type)
}

/// Construye un `StateSet` a partir de las propiedades booleanas del elemento.
pub fn build_state_set(
    is_enabled: bool,
    has_keyboard_focus: bool,
    is_keyboard_focusable: bool,
    is_password: bool,
    is_offscreen: bool,
) -> crate::backend::shared_types::StateSet {
    use crate::backend::shared_types::StateSet;
    use std::collections::BTreeSet;

    let mut states = BTreeSet::new();
    if is_enabled {
        states.insert("enabled".to_string());
    }
    if has_keyboard_focus {
        states.insert("focused".to_string());
    }
    if is_keyboard_focusable {
        states.insert("focusable".to_string());
    }
    if is_password {
        states.insert("password".to_string());
    }
    if !is_offscreen {
        states.insert("visible".to_string());
    }

    StateSet(states)
}
