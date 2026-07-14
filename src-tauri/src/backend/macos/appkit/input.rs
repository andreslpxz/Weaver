//! Emulación de input vía CGEvent (CoreGraphics).
//!
//! Usado como fallback cuando las acciones AXUIElement no están disponibles
//! (por ejemplo, clic en elementos sin `AXPress`, o escritura en campos
//! que no soportan `AXValue`).
//!
//! Requiere permiso de Accessibility (verificado en `ax/client.rs`).

use anyhow::{anyhow, Result};
use objc2_core_graphics::{
    CGEventCreate, CGEventCreateMouseEvent, CGEventCreateKeyboardEvent,
    CGEventPost, CGEventSetFlags, CGEventSourceCreate,
    CGMouseButton, CGEventField, CGEventFlags,
    CGPoint,
};
use objc2_foundation::CGFloat;

/// Hace clic del botón indicado en (x, y) coordenadas absolutas de pantalla.
///
/// `button`: 1 = izquierdo, 2 = medio, 3 = derecho.
pub fn click_at(x: i32, y: i32, button: u8) -> Result<()> {
    unsafe {
        let source = CGEventSourceCreate(None)
            .ok_or_else(|| anyhow!("CGEventSourceCreate falló"))?;

        let cg_button = match button {
            1 => CGMouseButton::Left,
            2 => CGMouseButton::Center,
            3 => CGMouseButton::Right,
            _ => return Err(anyhow!("botón inválido: {button}")),
        };

        let point = CGPoint { x: x as f64, y: y as f64 };

        // Mouse down.
        let down = CGEventCreateMouseEvent(
            Some(&source),
            objc2_core_graphics::CGEventType::LeftMouseDown
                .raw_value() as u32,
            point,
            cg_button,
        )
        .ok_or_else(|| anyhow!("CGEventCreateMouseEvent (down) falló"))?;
        CGEventPost(objc2_core_graphics::CGEventTapLocation::HID, &down);

        // Mouse up.
        let up = CGEventCreateMouseEvent(
            Some(&source),
            objc2_core_graphics::CGEventType::LeftMouseUp
                .raw_value() as u32,
            point,
            cg_button,
        )
        .ok_or_else(|| anyhow!("CGEventCreateMouseEvent (up) falló"))?;
        CGEventPost(objc2_core_graphics::CGEventTapLocation::HID, &up);
    }
    Ok(())
}

/// Escribe una cadena de texto vía CGEvent keyboard (con Unicode chars).
///
/// Cada caracter se envía como un CGEvent de tipo keyDown + keyUp.
/// Usamos `CGEventKeyboardSetUnicodeString` para soportar cualquier caracter.
pub fn type_text(text: &str) -> Result<()> {
    unsafe {
        let source = CGEventSourceCreate(None)
            .ok_or_else(|| anyhow!("CGEventSourceCreate falló"))?;

        for ch in text.chars() {
            // Crear evento keyDown con virtual key 0 (no usado para Unicode).
            let down = CGEventCreateKeyboardEvent(Some(&source), 0, true)
                .ok_or_else(|| anyhow!("CGEventCreateKeyboardEvent (down) falló"))?;
            // Set Unicode string.
            set_unicode_string(&down, ch);

            // Crear evento keyUp.
            let up = CGEventCreateKeyboardEvent(Some(&source), 0, false)
                .ok_or_else(|| anyhow!("CGEventCreateKeyboardEvent (up) falló"))?;
            set_unicode_string(&up, ch);

            CGEventPost(objc2_core_graphics::CGEventTapLocation::HID, &down);
            CGEventPost(objc2_core_graphics::CGEventTapLocation::HID, &up);
        }
    }
    Ok(())
}

/// Presiona una combinación de teclas estilo xdotool: "cmd+c", "Return",
/// "alt+Tab", "ctrl+s".
///
/// Mapeo de nombres comunes a virtual key codes de macOS.
pub fn press_key_combo(combo: &str) -> Result<()> {
    let parts: Vec<&str> = combo.split('+').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return Err(anyhow!("combo vacío"));
    }

    // Modificadores: press down al inicio, up al final.
    let modifiers: Vec<u64> = parts[..parts.len() - 1]
        .iter()
        .map(|s| modifier_flag(s))
        .collect::<Result<Vec<_>>>()?;

    let key_vk = key_name_to_vk(parts[parts.len() - 1])?;

    unsafe {
        let source = CGEventSourceCreate(None)
            .ok_or_else(|| anyhow!("CGEventSourceCreate falló"))?;

        // Combinar flags de modificadores.
        let combined_flags: u64 = modifiers.iter().fold(0, |acc, f| acc | f);

        // Key down.
        let down = CGEventCreateKeyboardEvent(Some(&source), key_vk, true)
            .ok_or_else(|| anyhow!("CGEventCreateKeyboardEvent (down) falló"))?;
        if combined_flags != 0 {
            CGEventSetFlags(&down, CGEventFlags::from_bits_retain(combined_flags));
        }
        CGEventPost(objc2_core_graphics::CGEventTapLocation::HID, &down);

        // Key up.
        let up = CGEventCreateKeyboardEvent(Some(&source), key_vk, false)
            .ok_or_else(|| anyhow!("CGEventCreateKeyboardEvent (up) falló"))?;
        if combined_flags != 0 {
            CGEventSetFlags(&up, CGEventFlags::from_bits_retain(combined_flags));
        }
        CGEventPost(objc2_core_graphics::CGEventTapLocation::HID, &up);
    }
    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────

/// Llama a `CGEventKeyboardSetUnicodeString` para setear un caracter Unicode.
fn set_unicode_string(event: &objc2_core_graphics::CGEvent, ch: char) {
    // CGEventKeyboardSetUnicodeString está en CoreGraphics.
    unsafe {
        extern "C" {
            fn CGEventKeyboardSetUnicodeString(
                event: *mut objc2_core_graphics::sys::CGEventRef,
                maxStringLength: u64,
                string: *const u16,
            );
        }
        let utf16: Vec<u16> = ch.encode_utf16().collect();
        let event_ptr = event.as_ptr();
        CGEventKeyboardSetUnicodeString(event_ptr, utf16.len() as u64, utf16.as_ptr());
    }
}

/// Mapeo de nombre de modificador a CGEventFlags.
fn modifier_flag(name: &str) -> Result<u64> {
    Ok(match name.to_ascii_lowercase().as_str() {
        "ctrl" | "control" => 1 << 18,      // kCGEventFlagMaskControl
        "alt" | "option" => 1 << 19,        // kCGEventFlagMaskAlternate
        "shift" => 1 << 17,                  // kCGEventFlagMaskShift
        "super" | "meta" | "cmd" | "win" => 1 << 20, // kCGEventFlagMaskCommand
        other => return Err(anyhow!("modificador desconocido: {other}")),
    })
}

/// Mapeo de nombre de tecla a virtual key code de macOS.
///
/// Ver: https://developer.apple.com/library/archive/technotes/tn2450/
fn key_name_to_vk(name: &str) -> Result<u16> {
    Ok(match name.to_ascii_lowercase().as_str() {
        "return" | "enter" => 0x24,   // kVK_Return
        "tab" => 0x30,                 // kVK_Tab
        "escape" | "esc" => 0x35,      // kVK_Escape
        "backspace" | "delete" => 0x33, // kVK_Delete (backspace en Mac)
        "del" => 0x75,                 // kVK_ForwardDelete
        "space" => 0x31,               // kVK_Space
        "home" => 0x73,                // kVK_Home
        "end" => 0x77,                 // kVK_End
        "pageup" | "page_up" => 0x74,  // kVK_PageUp
        "pagedown" | "page_down" => 0x79, // kVK_PageDown
        "up" => 0x7E,                  // kVK_UpArrow
        "down" => 0x7D,                // kVK_DownArrow
        "left" => 0x7B,                // kVK_LeftArrow
        "right" => 0x7C,               // kVK_RightArrow
        "f1" => 0x7A, "f2" => 0x78, "f3" => 0x63, "f4" => 0x76,
        "f5" => 0x60, "f6" => 0x61, "f7" => 0x62, "f8" => 0x64,
        "f9" => 0x65, "f10" => 0x6D, "f11" => 0x67, "f12" => 0x6F,
        single if single.chars().count() == 1 => {
            let c = single.chars().next().unwrap();
            if c.is_ascii_lowercase() {
                // Virtual key codes para letras a-z (en macOS son los mismos que A-Z).
                (c as u8 - b'a' + b'A') as u16
            } else if c.is_ascii_uppercase() {
                c as u16
            } else if c.is_ascii_digit() {
                // 0-9 en top row: 0x1D (0) to 0x19 (9) — varían.
                match c {
                    '0' => 0x1D, '1' => 0x12, '2' => 0x13, '3' => 0x14, '4' => 0x15,
                    '5' => 0x17, '6' => 0x16, '7' => 0x1A, '8' => 0x1C, '9' => 0x19,
                    _ => return Err(anyhow!("dígito no soportado: {single}")),
                }
            } else {
                return Err(anyhow!("tecla de un solo caracter no soportada: {single}"));
            }
        }
        other => return Err(anyhow!("tecla desconocida: {other}")),
    })
}
