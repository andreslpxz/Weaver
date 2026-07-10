//! Gestión de ventanas (lista, activación).
//!
//! En X11: usa `wmctrl` si está disponible (más fiable que EWMH crudo).
//! En Wayland: la lista de ventanas no es accesible por diseño; el usuario
//! debe usar el switcher nativo del compositor.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub id: String,      // window id hex de wmctrl
    pub title: String,
    pub desktop: i32,
    pub pid: u32,
    pub geometry: (i32, i32, i32, i32),
}

/// Lista las ventanas top-level. Devuelve `[]` si `wmctrl` no está disponible.
pub async fn list_windows() -> Result<Vec<WindowInfo>> {
    if which::which("wmctrl").is_err() {
        return Ok(vec![]);
    }
    let out = Command::new("wmctrl")
        .args(["-l", "-p", "-G"])
        .output()?;
    if !out.status.success() {
        return Err(anyhow!("wmctrl -l falló"));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut windows = Vec::new();
    for line in stdout.lines() {
        // Formato wmctrl -l -p -G:
        // 0x01200004  0 1234  0   0    1920 1080 host title goes here
        let mut it = line.split_whitespace();
        let id = it.next().unwrap_or_default().to_string();
        let desktop: i32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(-1);
        let pid: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let x: i32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let y: i32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let w: i32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let h: i32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        // Los siguientes campos son hostname (1 token) y luego el título (resto).
        let _host = it.next();
        let title: String = it.collect::<Vec<_>>().join(" ");
        windows.push(WindowInfo {
            id,
            title,
            desktop,
            pid,
            geometry: (x, y, w, h),
        });
    }
    Ok(windows)
}

/// Activa una ventana por id (formato hex de wmctrl) o por título (substring).
pub async fn activate_window(id_or_title: &str) -> Result<()> {
    if which::which("wmctrl").is_err() {
        return Err(anyhow!("wmctrl no está instalado"));
    }
    let status = Command::new("wmctrl")
        .args(["-a", id_or_title])
        .status()?;
    if !status.success() {
        return Err(anyhow!("wmctrl -a falló"));
    }
    Ok(())
}
