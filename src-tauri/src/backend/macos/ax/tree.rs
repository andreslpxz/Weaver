//! Recorrido recursivo del árbol AXUIElement.
//!
//! Lee las propiedades de cada elemento y construye un `AccessibleNode`
//! hasta `max_depth` niveles de profundidad. Usa el atributo `AXChildren`
//! para recorrer jerárquicamente.

use anyhow::{anyhow, Result};
use accessibility::{AXUIElement, AXUIElementAttributes};
use core_foundation::base::TCFType;
use core_foundation::string::CFString;

use crate::backend::shared_types::{AccessibleNode, Rect, StateSet};
use crate::backend::macos::ax::types::{ax_role_to_role, build_state_set};

/// Lee recursivamente un elemento y sus hijos hasta `max_depth`.
pub fn read_node(element: &AXUIElement, depth_left: u32, pid: u32) -> Result<AccessibleNode> {
    // Rol.
    let role_raw = element
        .attribute(&AXUIElementAttributes::role)
        .ok()
        .and_then(|v| cf_type_to_string(&v))
        .unwrap_or_default();
    let role = ax_role_to_role(&role_raw);

    // Nombre (AXTitle).
    let name = element
        .attribute(&AXUIElementAttributes::title)
        .ok()
        .and_then(|v| cf_type_to_string(&v))
        .unwrap_or_default();

    // Descripción (AXHelp).
    let description = element
        .attribute(&AXUIElementAttributes::help)
        .ok()
        .and_then(|v| cf_type_to_string(&v))
        .unwrap_or_default();

    // Estados.
    let is_enabled = element
        .attribute(&AXUIElementAttributes::enabled)
        .ok()
        .and_then(|v| cf_type_to_bool(&v))
        .unwrap_or(false);
    let is_focused = element
        .attribute(&AXUIElementAttributes::focused)
        .ok()
        .and_then(|v| cf_type_to_bool(&v))
        .unwrap_or(false);
    let is_focusable = element
        .attribute(&AXUIElementAttributes::can_set_focus)
        .ok()
        .and_then(|v| cf_type_to_bool(&v))
        .unwrap_or(false);
    let is_password = role_raw == "AXSecureTextField";
    let states: StateSet =
        build_state_set(is_enabled, is_focused, is_focusable, is_password);

    // Bounding box: AXPosition + AXSize.
    let rect = read_rect(element).ok();

    // Texto: AXValue.
    let text = element
        .attribute(&AXUIElementAttributes::value)
        .ok()
        .and_then(|v| cf_type_to_string(&v));

    // Actions: AXActionNames enumera las acciones disponibles.
    let actions = list_actions(element);

    // Hijos recursivos (limitados por depth y por número para evitar hangs).
    let mut children = Vec::new();
    if depth_left > 0 {
        if let Some(child_array) = element
            .attribute(&AXUIElementAttributes::children)
            .ok()
            .and_then(|v| cf_type_to_array(&v))
        {
            // Limitar a 200 hijos por nodo (mismo límite que Linux/Windows).
            for i in 0..child_array.count().min(200) {
                if let Some(child) = cf_type_to_ax_ui_element(child_array.get(i)) {
                    match read_node(&child, depth_left - 1, pid) {
                        Ok(n) => children.push(n),
                        Err(e) => {
                            tracing::debug!("skip child de {pid}: {e}");
                        }
                    }
                }
            }
        }
    }

    // Generar path jerárquico "app:PID/0/1/2/...".
    // En macOS no hay RuntimeId; usamos el índice en el padre (requiere
    // pasar el index desde el padre, pero para simplicidad generamos
    // un path único con el hash del puntero del elemento).
    let path = format!("app:{pid}/ptr:{:p}", element);

    Ok(AccessibleNode {
        path,
        bus_name: format!("pid:{pid}"),
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

/// Lee el bounding box del elemento: AXPosition (CGPoint) + AXSize (CGSize).
fn read_rect(element: &AXUIElement) -> Result<Rect> {
    use core_foundation::dictionary::CFDictionary;

    let position = element
        .attribute(&AXUIElementAttributes::position)
        .map_err(|e| anyhow!("AXPosition falló: {e:?}"))?;
    let size = element
        .attribute(&AXUIElementAttributes::size)
        .map_err(|e| anyhow!("AXSize falló: {e:?}"))?;

    let (x, y) = cf_value_to_point(&position)?;
    let (w, h) = cf_value_to_size(&size)?;

    Ok(Rect {
        x: x as i32,
        y: y as i32,
        width: w as i32,
        height: h as i32,
    })
}

/// Lista las acciones disponibles en el elemento.
///
/// macOS expone `AXActionNames` que es un array de strings.
fn list_actions(element: &AXUIElement) -> Vec<String> {
    if let Some(actions_val) = element
        .attribute(&AXUIElementAttributes::action_names)
        .ok()
        .and_then(|v| cf_type_to_array(&v))
    {
        let mut actions = Vec::new();
        for i in 0..actions_val.count() {
            if let Some(name) = cf_type_to_string(&actions_val.get(i).into()) {
                actions.push(name);
            }
        }
        return actions;
    }
    Vec::new()
}

// ── Helpers CFType ────────────────────────────────────────────────────────

fn cf_type_to_string(value: &core_foundation::base::CFType) -> Option<String> {
    unsafe {
        let cf_str = value.as_CFTypeRef() as *const core_foundation::string::__CFString;
        if cf_str.is_null() {
            return None;
        }
        let s = CFString::wrap_under_get_rule(cf_str as *mut _);
        Some(s.to_string())
    }
}

fn cf_type_to_bool(value: &core_foundation::base::CFType) -> Option<bool> {
    unsafe {
        let cf_bool = value.as_CFTypeRef() as *const core_foundation::boolean::__CFBoolean;
        if cf_bool.is_null() {
            return None;
        }
        let b = core_foundation::boolean::CFBoolean::wrap_under_get_rule(cf_bool as *mut _);
        Some(b == true)
    }
}

fn cf_type_to_array(
    value: &core_foundation::base::CFType,
) -> Option<core_foundation::array::CFArray> {
    unsafe {
        let ptr = value.as_CFTypeRef() as *const core_foundation::array::__CFArray;
        if ptr.is_null() {
            return None;
        }
        Some(core_foundation::array::CFArray::wrap_under_get_rule(ptr as *mut _))
    }
}

fn cf_type_to_ax_ui_element(
    value: core_foundation::base::CFType,
) -> Option<AXUIElement> {
    unsafe {
        let ptr = value.as_CFTypeRef() as *const accessibility::sys::AXUIElement;
        if ptr.is_null() {
            return None;
        }
        Some(AXUIElement::wrap_under_get_rule(ptr as *mut _))
    }
}

/// Convierte un CFValue (AXValueRef con tipo kAXValueCGPointType) a (x, y).
fn cf_value_to_point(value: &core_foundation::base::CFType) -> Result<(f64, f64)> {
    // CGPoint es {x: f64, y: f64}.
    // accessibility crate expone AXValueRef; aquí hacemos cast inseguro.
    unsafe {
        let ptr = value.as_CFTypeRef() as *const accessibility::sys::AXValueRef;
        if ptr.is_null() {
            return Err(anyhow!("AXValue NULL"));
        }
        let mut point: CGPoint = std::mem::zeroed();
        let ok = accessibility::sys::AXValueGetValue(
            ptr,
            accessibility::sys::AXValueType_kAXValueCGPointType,
            &mut point as *mut _ as *mut _,
        );
        if !ok {
            return Err(anyhow!("AXValueGetValue CGPoint falló"));
        }
        Ok((point.x, point.y))
    }
}

/// Convierte un CFValue (AXValueRef con tipo kAXValueCGSizeType) a (w, h).
fn cf_value_to_size(value: &core_foundation::base::CFType) -> Result<(f64, f64)> {
    unsafe {
        let ptr = value.as_CFTypeRef() as *const accessibility::sys::AXValueRef;
        if ptr.is_null() {
            return Err(anyhow!("AXValue NULL"));
        }
        let mut size: CGSize = std::mem::zeroed();
        let ok = accessibility::sys::AXValueGetValue(
            ptr,
            accessibility::sys::AXValueType_kAXValueCGSizeType,
            &mut size as *mut _ as *mut _,
        );
        if !ok {
            return Err(anyhow!("AXValueGetSize CGSize falló"));
        }
        Ok((size.width, size.height))
    }
}

// Re-declaraciones para evitar imports complejos.
#[repr(C)]
#[derive(Copy, Clone)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct CGSize {
    width: f64,
    height: f64,
}
