//! Recorrido recursivo del árbol UIAutomation.
//!
//! Lee las propiedades de cada elemento y construye un `AccessibleNode`
//! hasta `max_depth` niveles de profundidad.

use anyhow::{anyhow, Result};
use uiautomation::UIElement;

use crate::backend::shared_types::{AccessibleNode, Rect, StateSet};
use crate::backend::windows::uiautomation::client::{runtime_id_to_path, uia_rect_to_rect};
use crate::backend::windows::uiautomation::types::{
    build_state_set, control_type_name, control_type_to_role,
};

/// Lee recursivamente un elemento y sus hijos hasta `max_depth`.
pub fn read_node(element: &UIElement, depth_left: u32) -> Result<AccessibleNode> {
    let name = element.get_name().unwrap_or_default();
    let description = element.get_help_text().unwrap_or_default();

    let control_type = element.get_control_type();
    let role = control_type_to_role(control_type);
    let role_raw = control_type_name(control_type);

    // Estados desde propiedades booleanas.
    let is_enabled = element.get_is_enabled().unwrap_or(false);
    let has_keyboard_focus = element.get_has_keyboard_focus().unwrap_or(false);
    let is_keyboard_focusable = element.get_is_keyboard_focusable().unwrap_or(false);
    let is_password = element.get_is_password().unwrap_or(false);
    let is_offscreen = element.get_is_offscreen().unwrap_or(false);
    let states: StateSet = build_state_set(
        is_enabled,
        has_keyboard_focus,
        is_keyboard_focusable,
        is_password,
        is_offscreen,
    );

    // Bounding rectangle (puede fallar para elementos sin layout).
    let rect: Option<Rect> = element
        .get_bounding_rectangle()
        .ok()
        .map(uia_rect_to_rect);

    // Texto: intentamos ValuePattern primero, luego TextPattern.
    let text = read_text(element).ok().flatten();

    // Actions: las listamos como strings legibles.
    // UIAutomation no expone "actions" como AT-SPI; en su lugar, los patrones
    // disponibles (InvokePattern, ValuePattern, etc.) definen qué se puede
    // hacer. Mapeamos los más comunes a strings.
    let actions = list_actions(element);

    // Bus name y path: usamos PID + RuntimeId.
    let pid = element.get_process_id().unwrap_or(0);
    let bus_name = format!("pid:{}", pid);
    let path = runtime_id_to_path(element).unwrap_or_default();

    // Hijos recursivos (limitados por depth y por número para evitar hangs).
    let mut children = Vec::new();
    if depth_left > 0 {
        if let Ok(child_list) = element.get_children() {
            // Limitar a 200 hijos por nodo (mismo límite que en Linux).
            for child in child_list.into_iter().take(200) {
                match read_node(&child, depth_left - 1) {
                    Ok(n) => children.push(n),
                    Err(e) => {
                        tracing::debug!("skip child de {bus_name}:{path}: {e}");
                    }
                }
            }
        }
    }

    Ok(AccessibleNode {
        path,
        bus_name,
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

/// Intenta leer el texto de un elemento vía ValuePattern o TextPattern.
fn read_text(element: &UIElement) -> Result<Option<String>> {
    // ValuePattern (inputs, editables).
    if let Ok(Some(value_pattern)) = element.cast::<uiautomation::patterns::ValuePattern>() {
        if let Ok(value) = value_pattern.get_value() {
            return Ok(Some(value));
        }
    }

    // TextPattern (documentos ricos: Word, browsers, etc.).
    if let Ok(Some(text_pattern)) = element.cast::<uiautomation::patterns::TextPattern>() {
        let ranges = text_pattern
            .get_visible_ranges()
            .map_err(|e| anyhow!("TextPattern::GetVisibleRanges falló: {e}"))?;
        let mut text = String::new();
        for range in ranges {
            if let Ok(t) = range.get_text() {
                text.push_str(&t);
                text.push('\n');
            }
        }
        if !text.is_empty() {
            return Ok(Some(text));
        }
    }

    Ok(None)
}

/// Lista las "acciones" disponibles en el elemento, basadas en los patrones
/// soportados. Esto es análogo a las acciones AT-SPI (click, press, etc.).
fn list_actions(element: &UIElement) -> Vec<String> {
    let mut actions = Vec::new();

    if element
        .cast::<uiautomation::patterns::InvokePattern>()
        .ok()
        .flatten()
        .is_some()
    {
        actions.push("invoke".to_string());
    }

    if element
        .cast::<uiautomation::patterns::TogglePattern>()
        .ok()
        .flatten()
        .is_some()
    {
        actions.push("toggle".to_string());
    }

    if element
        .cast::<uiautomation::patterns::SelectionItemPattern>()
        .ok()
        .flatten()
        .is_some()
    {
        actions.push("select".to_string());
    }

    if element
        .cast::<uiautomation::patterns::ExpandCollapsePattern>()
        .ok()
        .flatten()
        .is_some()
    {
        actions.push("expand".to_string());
        actions.push("collapse".to_string());
    }

    if element
        .cast::<uiautomation::patterns::ScrollItemPattern>()
        .ok()
        .flatten()
        .is_some()
    {
        actions.push("scroll_into_view".to_string());
    }

    actions
}
