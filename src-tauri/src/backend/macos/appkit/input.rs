//! Emulación de input vía enigo (CGEvent bajo el hood).
//!
//! Usamos `enigo` crate en lugar de CGEvent directo porque:
//! 1. Es más simple y menos propenso a errores de tipos entre versiones
//! 2. Ya está en las dependencias (también se usa en Windows)
//! 3. Maneja automáticamente la conversión de keycodes y modificadores
//!
//! Requiere permiso de Accessibility (verificado en `ax/client.rs`).

use anyhow::{anyhow, Result};
use enigo::{Enigo, Key, Keyboard, Mouse, Settings, MouseControllable as _, KeyboardControllable as _};

/// Hace clic del botón indicado en (x, y) coordenadas absolutas de pantalla.
///
/// `button`: 1 = izquierdo, 2 = medio, 3 = derecho.
pub fn click_at(x: i32, y: i32, button: u8) -> Result<()> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| anyhow!("Enigo::new falló: {e}"))?;

    // Determinar botón.
    let btn = match button {
        1 => enigo::MouseButton::Left,
        2 => enigo::MouseButton::Middle,
        3 => enigo::MouseButton::Right,
        _ => return Err(anyhow!("botón inválido: {button}")),
    };

    // Mover cursor y clickear en una sola llamada de enigo.
    enigo
        .move_mouse(x, y)
        .map_err(|e| anyhow!("move_mouse falló: {e}"))?;
    enigo
        .mouse_down(btn)
        .map_err(|e| anyhow!("mouse_down falló: {e}"))?;
    enigo
        .mouse_up(btn)
        .map_err(|e| anyhow!("mouse_up falló: {e}"))?;

    Ok(())
}

/// Escribe una cadena de texto vía enigo.
pub fn type_text(text: &str) -> Result<()> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| anyhow!("Enigo::new falló: {e}"))?;
    enigo
        .key_sequence(text)
        .map_err(|e| anyhow!("Enigo::key_sequence falló: {e}"))?;
    Ok(())
}

/// Presiona una combinación de teclas estilo xdotool: "cmd+c", "Return",
/// "alt+Tab", "ctrl+s".
pub fn press_key_combo(combo: &str) -> Result<()> {
    let parts: Vec<&str> = combo.split('+').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return Err(anyhow!("combo vacío"));
    }

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| anyhow!("Enigo::new falló: {e}"))?;

    // Modificadores: press down al inicio.
    let modifiers: Vec<Key> = parts[..parts.len() - 1]
        .iter()
        .map(|s| modifier_key(s))
        .collect::<Result<Vec<_>>>()?;

    for m in &modifiers {
        enigo
            .key_down(*m)
            .map_err(|e| anyhow!("key_down modifier falló: {e}"))?;
    }

    // Tecla principal down + up.
    let main_key = key_name_to_key(parts[parts.len() - 1])?;
    enigo
        .key_down(main_key)
        .map_err(|e| anyhow!("key_down falló: {e}"))?;
    enigo
        .key_up(main_key)
        .map_err(|e| anyhow!("key_up falló: {e}"))?;

    // Modificadores up (en orden inverso).
    for m in modifiers.iter().rev() {
        enigo
            .key_up(*m)
            .map_err(|e| anyhow!("key_up modifier falló: {e}"))?;
    }

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────

fn modifier_key(name: &str) -> Result<Key> {
    Ok(match name.to_ascii_lowercase().as_str() {
        "ctrl" | "control" => Key::Control,
        "alt" | "option" => Key::Alt,
        "shift" => Key::Shift,
        "super" | "meta" | "cmd" | "win" => Key::Meta,
        other => return Err(anyhow!("modificador desconocido: {other}")),
    })
}

fn key_name_to_key(name: &str) -> Result<Key> {
    Ok(match name.to_ascii_lowercase().as_str() {
        "return" | "enter" => Key::Return,
        "tab" => Key::Tab,
        "escape" | "esc" => Key::Escape,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "space" => Key::Space,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" | "page_up" => Key::PageUp,
        "pagedown" | "page_down" => Key::PageDown,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "f1" => Key::F1, "f2" => Key::F2, "f3" => Key::F3, "f4" => Key::F4,
        "f5" => Key::F5, "f6" => Key::F6, "f7" => Key::F7, "f8" => Key::F8,
        "f9" => Key::F9, "f10" => Key::F10, "f11" => Key::F11, "f12" => Key::F12,
        single if single.chars().count() == 1 => {
            let c = single.chars().next().unwrap();
            Key::Layout(c)
        }
        other => return Err(anyhow!("tecla desconocida: {other}")),
    })
}
