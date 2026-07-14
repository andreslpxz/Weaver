//! Acciones sobre elementos AXUIElement.
//!
//! macOS Accessibility expone acciones nombradas (`AXPress`, `AXConfirm`,
//! `AXPick`, etc.) que se invocan via `AXUIElementPerformAction`.
//! Para escribir texto se usa el atributo `AXValue` (set).

use anyhow::{anyhow, Result};
use accessibility::{AXUIElement, AXUIElementAttributes};
use core_foundation::base::TCFType;
use core_foundation::string::CFString;

/// Hace clic en el elemento: usa `AXPress` action si está disponible,
/// si no, hace clic con enigo en el centro del bounding box.
pub fn click(element: &AXUIElement) -> Result<()> {
    // Verificar que el elemento soporta AXPress.
    if let Some(actions) = element
        .attribute(&AXUIElementAttributes::action_names)
        .ok()
        .and_then(|v| cf_type_to_array(&v))
    {
        let mut supports_press = false;
        for i in 0..actions.count() {
            if let Some(name) = cf_type_to_string(&actions.get(i).into()) {
                if name == "AXPress" {
                    supports_press = true;
                    break;
                }
            }
        }
        if supports_press {
            return element
                .perform_action(&accessibility::AXUIElementActions::press)
                .map_err(|e| anyhow!("AXPress falló: {e:?}"));
        }
    }

    // Fallback: clic con enigo en el centro del bounding box.
    use crate::backend::macos::ax::tree::read_rect;
    let rect = read_rect(element)?;
    let center_x = rect.x + rect.width / 2;
    let center_y = rect.y + rect.height / 2;

    crate::backend::macos::appkit::input::click_at(center_x, center_y, 1)
        .map_err(|e| anyhow!("click_at enigo fallback falló: {e}"))?;
    Ok(())
}

/// Doble clic: dos `click()` con pausa de 80ms.
pub fn double_click(element: &AXUIElement) -> Result<()> {
    click(element)?;
    std::thread::sleep(std::time::Duration::from_millis(80));
    click(element)?;
    Ok(())
}

/// Escribe texto en un elemento editable:
///   1. `AXValue` set si el elemento lo soporta.
///   2. Si no: foco + enigo keyboard.
pub fn type_text(element: &AXUIElement, text: &str) -> Result<()> {
    // Intentar set AXValue.
    let cf_string = CFString::new(text);
    let cf_value = core_foundation::base::CFType::from(cf_string);

    let result = element.set_attribute(&AXUIElementAttributes::value, &cf_value);
    if result.is_ok() {
        return Ok(());
    }

    // Fallback: foco + enigo keyboard.
    let true_value = core_foundation::base::CFType::from(core_foundation::boolean::CFBoolean::true_value());
    element
        .set_attribute(&AXUIElementAttributes::focused, &true_value)
        .map_err(|e| anyhow!("AXSetFocused falló: {e:?}"))?;

    crate::backend::macos::appkit::input::type_text(text)
        .map_err(|e| anyhow!("type_text enigo fallback falló: {e}"))?;
    Ok(())
}

/// Lee el texto del elemento (atributo `AXValue`).
pub fn get_text(element: &AXUIElement) -> Result<Option<String>> {
    if let Some(value) = element
        .attribute(&AXUIElementAttributes::value)
        .ok()
        .and_then(|v| cf_type_to_string(&v))
    {
        return Ok(Some(value));
    }
    Ok(None)
}

/// Devuelve el bounding box del elemento (AXPosition + AXSize).
pub fn get_extents(element: &AXUIElement) -> Result<crate::backend::shared_types::Rect> {
    crate::backend::macos::ax::tree::read_rect(element)
}

/// Pone el foco en el elemento (set AXFocused = true).
pub fn focus(element: &AXUIElement) -> Result<()> {
    let true_value = core_foundation::base::CFType::from(core_foundation::boolean::CFBoolean::true_value());
    element
        .set_attribute(&AXUIElementAttributes::focused, &true_value)
        .map_err(|e| anyhow!("AXSetFocused falló: {e:?}"))
}

// ── Helpers CFType (duplicados de tree.rs para mantener el módulo self-contained) ──

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
