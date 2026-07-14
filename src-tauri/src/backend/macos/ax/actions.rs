//! Acciones sobre elementos AXUIElement.
//!
//! macOS Accessibility expone acciones nombradas (`AXPress`, `AXConfirm`,
//! `AXPick`, etc.) que se invocan via `AXUIElementPerformAction`.
//! Para escribir texto se usa el atributo `AXValue` (set).

use anyhow::{anyhow, Result};
use accessibility::{AXUIElement, AXUIElementAttributes, AXUIElementActions};

/// Hace clic en el elemento: usa `AXPress` action si está disponible,
/// si no, hace clic con CGEvent en el centro del bounding box.
pub fn click(element: &AXUIElement) -> Result<()> {
    // Verificar que el elemento soporta AXPress.
    if let Some(actions) = element
        .attribute(&AXUIElementAttributes::action_names)
        .ok()
        .and_then(|v| {
            unsafe {
                let ptr = v.as_CFTypeRef() as *const core_foundation::array::__CFArray;
                if ptr.is_null() {
                    return None;
                }
                Some(core_foundation::array::CFArray::wrap_under_get_rule(ptr as *mut _))
            }
        })
    {
        for i in 0..actions.count() {
            if let Some(name) = unsafe {
                let item = actions.get(i);
                let cf_str = item.as_CFTypeRef() as *const core_foundation::string::__CFString;
                if cf_str.is_null() {
                    None
                } else {
                    Some(
                        core_foundation::string::CFString::wrap_under_get_rule(cf_str as *mut _)
                            .to_string(),
                    )
                }
            } {
                if name == "AXPress" {
                    return element
                        .perform_action(&AXUIElementActions::press)
                        .map_err(|e| anyhow!("AXPress falló: {e:?}"));
                }
            }
        }
    }

    // Fallback: clic con CGEvent en el centro del bounding box.
    use crate::backend::macos::ax::tree::read_rect;
    let rect = read_rect(element)?;
    let center_x = rect.x + rect.width / 2;
    let center_y = rect.y + rect.height / 2;

    crate::backend::macos::appkit::input::click_at(center_x, center_y, 1)
        .map_err(|e| anyhow!("click_at CGEvent fallback falló: {e}"))?;
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
///   2. Si no: foco + CGEvent keyboard.
pub fn type_text(element: &AXUIElement, text: &str) -> Result<()> {
    // Intentar set AXValue.
    // accessibility crate requiere AXUIElement::set_attribute
    let cf_string = core_foundation::string::CFString::new(text);
    let cf_value = core_foundation::base::CFType::from(cf_string);

    let result = element.set_attribute(&AXUIElementAttributes::value, &cf_value);
    if result.is_ok() {
        return Ok(());
    }

    // Fallback: foco + CGEvent keyboard.
    element
        .set_attribute(&AXUIElementAttributes::focused, &core_foundation::boolean::CFBoolean::true_value().into())
        .map_err(|e| anyhow!("AXSetFocused falló: {e:?}"))?;

    crate::backend::macos::appkit::input::type_text(text)
        .map_err(|e| anyhow!("type_text CGEvent fallback falló: {e}"))?;
    Ok(())
}

/// Lee el texto del elemento (atributo `AXValue`).
pub fn get_text(element: &AXUIElement) -> Result<Option<String>> {
    if let Some(value) = element
        .attribute(&AXUIElementAttributes::value)
        .ok()
        .and_then(|v| {
            unsafe {
                let cf_str = v.as_CFTypeRef() as *const core_foundation::string::__CFString;
                if cf_str.is_null() {
                    return None;
                }
                Some(
                    core_foundation::string::CFString::wrap_under_get_rule(cf_str as *mut _)
                        .to_string(),
                )
            }
        })
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
    element
        .set_attribute(
            &AXUIElementAttributes::focused,
            &core_foundation::boolean::CFBoolean::true_value().into(),
        )
        .map_err(|e| anyhow!("AXSetFocused falló: {e:?}"))
}
