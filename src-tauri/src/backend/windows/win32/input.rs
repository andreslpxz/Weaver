//! Emulación de input vía Win32 `SendInput`.
//!
//! Usado como fallback cuando los patrones UIAutomation no están disponibles
//! (por ejemplo, clic en un elemento sin `InvokePattern`, o escritura en
//! un campo que no implementa `ValuePattern`).
//!
//! Para teclado, `enigo` crate es más simple pero `SendInput` directo es
//! más confiable para caracteres especiales y teclas multimedia.

use anyhow::{anyhow, Result};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_TYPE, KEYBDINPUT, KEYEVENTF_UNICODE,
    KEYEVENTF_KEYUP, MOUSEINPUT, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_MIDDLEDOWN,
    MOUSEEVENTF_MIDDLEUP, MOUSE_EVENT_FLAGS,
    VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;

/// Hace clic del botón indicado en (x, y) coordenadas absolutas de pantalla.
///
/// `button`: 1 = izquierdo, 2 = medio, 3 = derecho.
pub fn click_at(x: i32, y: i32, button: u8) -> Result<()> {
    // Mover cursor.
    unsafe {
        SetCursorPos(x, y)
            .map_err(|e| anyhow!("SetCursorPos falló: {e}"))?;
    }

    // Determinar flags down/up según botón.
    let (down_flag, up_flag): (u32, u32) = match button {
        1 => (MOUSEEVENTF_LEFTDOWN.0, MOUSEEVENTF_LEFTUP.0),
        2 => (MOUSEEVENTF_MIDDLEDOWN.0, MOUSEEVENTF_MIDDLEUP.0),
        3 => (MOUSEEVENTF_RIGHTDOWN.0, MOUSEEVENTF_RIGHTUP.0),
        _ => return Err(anyhow!("botón inválido: {button}")),
    };

    // Enviar down.
    send_mouse(down_flag)?;
    // Enviar up.
    send_mouse(up_flag)?;

    Ok(())
}

/// Escribe una cadena de texto via `KEYEVENTF_UNICODE`.
///
/// Cada caracter se envía como dos eventos: keydown + keyup.
pub fn type_text(text: &str) -> Result<()> {
    for ch in text.encode_utf16() {
        send_unicode_key(ch, false)?;
        send_unicode_key(ch, true)?;
    }
    Ok(())
}

/// Presiona una combinación de teclas estilo xdotool: "ctrl+s", "Return",
/// "alt+Tab", "win+d".
///
/// Mapeo de nombres comunes a virtual key codes.
pub fn press_key_combo(combo: &str) -> Result<()> {
    let parts: Vec<&str> = combo.split('+').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return Err(anyhow!("combo vacío"));
    }

    // Modificadores: press down al inicio, up al final.
    let modifiers: Vec<u16> = parts[..parts.len() - 1]
        .iter()
        .map(|s| modifier_vk(s))
        .collect::<Result<Vec<_>>>()?;

    let key_vk = key_name_to_vk(parts[parts.len() - 1])?;

    // Modificadores down.
    for &vk in &modifiers {
        send_key(vk, false)?;
    }

    // Tecla principal down + up.
    send_key(key_vk, false)?;
    send_key(key_vk, true)?;

    // Modificadores up (en orden inverso).
    for &vk in modifiers.iter().rev() {
        send_key(vk, true)?;
    }

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────

/// Envia un evento de ratón con los flags indicados (down/up por separado).
fn send_mouse(flags: u32) -> Result<()> {
    let input = INPUT {
        r#type: INPUT_TYPE(0), // INPUT_MOUSE
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: 0,
                dwFlags: MOUSE_EVENT_FLAGS(flags),
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    unsafe {
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32)
            .map_err(|e| anyhow!("SendInput mouse falló: {e}"))?;
    }
    Ok(())
}

/// Envia un evento de teclado Unicode (caracter arbitrario).
fn send_unicode_key(ch: u16, key_up: bool) -> Result<()> {
    let mut flags = KEYEVENTF_UNICODE;
    if key_up {
        flags |= KEYEVENTF_KEYUP;
    }

    let input = INPUT {
        r#type: INPUT_TYPE(1), // INPUT_KEYBOARD
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(0),
                wScan: ch,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    unsafe {
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32)
            .map_err(|e| anyhow!("SendInput falló: {e}"))?;
    }
    Ok(())
}

/// Envia un evento de teclado con virtual key code.
fn send_key(vk: u16, key_up: bool) -> Result<()> {
    let mut flags: u32 = 0;
    if key_up {
        flags |= KEYEVENTF_KEYUP;
    }

    let input = INPUT {
        r#type: INPUT_TYPE(1), // INPUT_KEYBOARD
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    unsafe {
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32)
            .map_err(|e| anyhow!("SendInput falló: {e}"))?;
    }
    Ok(())
}

/// Mapeo de nombre de modificador a virtual key code.
fn modifier_vk(name: &str) -> Result<u16> {
    Ok(match name.to_ascii_lowercase().as_str() {
        "ctrl" | "control" => 0x11, // VK_CONTROL
        "alt" | "option" => 0x12,   // VK_MENU
        "shift" => 0x10,            // VK_SHIFT
        "super" | "meta" | "win" => 0x5B, // VK_LWIN
        other => return Err(anyhow!("modificador desconocido: {other}")),
    })
}

/// Mapeo de nombre de tecla a virtual key code.
fn key_name_to_vk(name: &str) -> Result<u16> {
    Ok(match name.to_ascii_lowercase().as_str() {
        "return" | "enter" => 0x0D, // VK_RETURN
        "tab" => 0x09,              // VK_TAB
        "escape" | "esc" => 0x1B,   // VK_ESCAPE
        "backspace" => 0x08,        // VK_BACK
        "delete" | "del" => 0x2E,   // VK_DELETE
        "space" => 0x20,            // VK_SPACE
        "home" => 0x24,             // VK_HOME
        "end" => 0x23,              // VK_END
        "pageup" | "page_up" => 0x21, // VK_PRIOR
        "pagedown" | "page_down" => 0x22, // VK_NEXT
        "up" => 0x26,               // VK_UP
        "down" => 0x28,             // VK_DOWN
        "left" => 0x25,             // VK_LEFT
        "right" => 0x27,            // VK_RIGHT
        "f1" => 0x70, "f2" => 0x71, "f3" => 0x72, "f4" => 0x73,
        "f5" => 0x74, "f6" => 0x75, "f7" => 0x76, "f8" => 0x77,
        "f9" => 0x78, "f10" => 0x79, "f11" => 0x7A, "f12" => 0x7B,
        single if single.chars().count() == 1 => {
            let c = single.chars().next().unwrap();
            if c.is_ascii_uppercase() {
                c as u16
            } else if c.is_ascii_lowercase() {
                c.to_ascii_uppercase() as u16
            } else if c.is_ascii_digit() {
                c as u16
            } else {
                return Err(anyhow!("tecla de un solo caracter no soportada: {single}"));
            }
        }
        other => return Err(anyhow!("tecla desconocida: {other}")),
    })
}
