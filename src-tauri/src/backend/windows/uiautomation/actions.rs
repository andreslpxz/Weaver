//! Acciones sobre elementos UIAutomation vía Patterns.
//!
//! UIAutomation no tiene `do_action(0)` como AT-SPI; en su lugar, cada
//! elemento implementa "patterns" (`InvokePattern`, `ValuePattern`,
//! `TextPattern`, etc.). Aquí los usamos para implementar las acciones
//! del trait `Backend`.

use anyhow::{anyhow, Result};
use uiautomation::UIElement;
use uiautomation::patterns::{InvokePattern, ValuePattern};

/// Hace clic en el elemento: usa `InvokePattern::Invoke` si está disponible,
/// si no, hace clic con el ratón en las coordenadas del bounding rectangle.
pub fn click(element: &UIElement) -> Result<()> {
    // Intentar InvokePattern primero.
    if let Ok(Some(invoke)) = element.cast::<InvokePattern>() {
        return invoke
            .invoke()
            .map_err(|e| anyhow!("InvokePattern::Invoke falló: {e}"));
    }

    // Fallback: clic con ratón en el centro del bounding rectangle.
    let rect = element
        .get_bounding_rectangle()
        .map_err(|e| anyhow!("GetBoundingRectangle falló: {e}"))?;

    let center_x = rect.get_left() + rect.get_width() / 2;
    let center_y = rect.get_top() + rect.get_height() / 2;

    crate::backend::windows::win32::input::click_at(center_x, center_y, 1)
        .map_err(|e| anyhow!("click_at fallback falló: {e}"))?;
    Ok(())
}

/// Doble clic: dos `click()` con pausa de 80ms.
pub fn double_click(element: &UIElement) -> Result<()> {
    click(element)?;
    std::thread::sleep(std::time::Duration::from_millis(80));
    click(element)?;
    Ok(())
}

/// Escribe texto en un elemento editable:
///   1. `ValuePattern::SetValue` si está disponible.
///   2. Si no: clic + `SendInput` keyboard.
pub fn type_text(element: &UIElement, text: &str) -> Result<()> {
    // Intentar ValuePattern primero.
    if let Ok(Some(value_pattern)) = element.cast::<ValuePattern>() {
        return value_pattern
            .set_value(text)
            .map_err(|e| anyhow!("ValuePattern::SetValue falló: {e}"));
    }

    // Fallback: foco + SendInput.
    element
        .set_focus()
        .map_err(|e| anyhow!("SetFocus falló: {e}"))?;

    crate::backend::windows::win32::input::type_text(text)
        .map_err(|e| anyhow!("type_text SendInput fallback falló: {e}"))?;
    Ok(())
}

/// Lee el texto de un elemento (mismo lógica que en tree.rs::read_text).
pub fn get_text(element: &UIElement) -> Result<Option<String>> {
    if let Ok(Some(value_pattern)) = element.cast::<ValuePattern>() {
        if let Ok(value) = value_pattern.get_value() {
            return Ok(Some(value));
        }
    }

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

/// Devuelve el bounding box del elemento.
pub fn get_extents(element: &UIElement) -> Result<crate::backend::shared_types::Rect> {
    use crate::backend::windows::uiautomation::client::uia_rect_to_rect;
    let rect = element
        .get_bounding_rectangle()
        .map_err(|e| anyhow!("GetBoundingRectangle falló: {e}"))?;
    Ok(uia_rect_to_rect(rect))
}

/// Pone el foco en el elemento.
pub fn focus(element: &UIElement) -> Result<()> {
    element
        .set_focus()
        .map_err(|e| anyhow!("SetFocus falló: {e}"))
}
