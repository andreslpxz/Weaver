//! Emulación de teclado.
//!
//! Estrategia:
//! - Si `$WAYLAND_DISPLAY` está puesto, intentar `wtype` (si está instalado).
//! - Si no, usar X11 (XTest) vía `x11rb`.
//! - Si todo falla, devolver error claro al usuario.

use anyhow::{anyhow, Result};
use std::process::Command;

/// Devuelve true si estamos en Wayland puro (sin X11/Xwayland activo).
fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok() && std::env::var("DISPLAY").is_err()
}

fn have_binary(name: &str) -> bool {
    which::which(name).is_ok()
}

/// Escribe una cadena de texto completa (sin modificadores).
pub async fn type_text(text: &str) -> Result<()> {
    if is_wayland() && have_binary("wtype") {
        let status = Command::new("wtype").arg(text).status()?;
        if !status.success() {
            return Err(anyhow!("wtype falló"));
        }
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        if !is_wayland() {
            return type_text_x11(text);
        }
    }

    Err(anyhow!("no hay backend de teclado disponible (instala wtype en Wayland o usa X11)"))
}

/// Presiona una combinación de teclas estilo xdotool: "ctrl+s", "alt+Tab",
/// "Return", "ctrl+shift+c".
pub async fn press_key_combo(combo: &str) -> Result<()> {
    let parts: Vec<&str> = combo.split('+').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return Err(anyhow!("combo vacío"));
    }

    if is_wayland() && have_binary("wtype") {
        let mut args: Vec<String> = Vec::new();
        for m in &parts[..parts.len() - 1] {
            args.push("-M".into());
            args.push(modifier_name(m)?.to_string());
        }
        args.push("-k".into());
        args.push(key_name(parts[parts.len() - 1])?.to_string());
        for m in &parts[..parts.len() - 1] {
            args.push("-m".into());
            args.push(modifier_name(m)?.to_string());
        }
        let status = Command::new("wtype").args(&args).status()?;
        if !status.success() {
            return Err(anyhow!("wtype falló"));
        }
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        if !is_wayland() {
            return press_key_x11(&parts);
        }
    }

    Err(anyhow!("no hay backend de teclado disponible"))
}

fn modifier_name(s: &str) -> Result<&'static str> {
    Ok(match s.to_ascii_lowercase().as_str() {
        "ctrl" | "control" => "ctrl",
        "alt" | "option" => "alt",
        "shift" => "shift",
        "super" | "meta" | "win" => "super",
        other => return Err(anyhow!("modificador desconocido: {other}")),
    })
}

fn key_name(s: &str) -> Result<&'static str> {
    Ok(match s.to_ascii_lowercase().as_str() {
        "return" | "enter" => "Return",
        "tab" => "Tab",
        "escape" | "esc" => "Escape",
        "backspace" => "BackSpace",
        "delete" | "del" => "Delete",
        "space" => "space",
        "home" => "Home",
        "end" => "End",
        "pageup" | "page_up" => "Page_Up",
        "pagedown" | "page_down" => "Page_Down",
        "up" => "Up",
        "down" => "Down",
        "left" => "Left",
        "right" => "Right",
        "f1" => "F1", "f2" => "F2", "f3" => "F3", "f4" => "F4",
        "f5" => "F5", "f6" => "F6", "f7" => "F7", "f8" => "F8",
        "f9" => "F9", "f10" => "F10", "f11" => "F11", "f12" => "F12",
        single if single.chars().count() == 1 => " ", // se maneja abajo
        other => return Err(anyhow!("tecla desconocida: {other}")),
    })
}

// --- X11 --------------------------------------------------------------------

#[cfg(target_os = "linux")]
fn type_text_x11(text: &str) -> Result<()> {
    // Para simplicidad del MVP, delegamos en xdotool si está disponible.
    if have_binary("xdotool") {
        let status = Command::new("xdotool")
            .arg("type")
            .arg("--clearmodifiers")
            .arg("--")
            .arg(text)
            .status()?;
        if !status.success() {
            return Err(anyhow!("xdotool type falló"));
        }
        return Ok(());
    }
    Err(anyhow!("xdotool no está instalado (requerido para type_text en X11 en este MVP)"))
}

#[cfg(target_os = "linux")]
fn press_key_x11(parts: &[&str]) -> Result<()> {
    if have_binary("xdotool") {
        let combo: String = parts.join("+");
        let status = Command::new("xdotool")
            .arg("key")
            .arg("--clearmodifiers")
            .arg(&combo)
            .status()?;
        if !status.success() {
            return Err(anyhow!("xdotool key falló"));
        }
        return Ok(());
    }
    Err(anyhow!("xdotool no está instalado (requerido para press_key en X11 en este MVP)"))
}
