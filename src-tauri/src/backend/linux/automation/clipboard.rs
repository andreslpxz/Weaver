//! Portapapeles. Usa `wl-copy`/`wl-paste` en Wayland y `xclip`/`xsel` en X11.

use anyhow::{anyhow, Result};
use std::process::Command;

pub async fn clipboard_get() -> Result<String> {
    if std::env::var("WAYLAND_DISPLAY").is_ok() && which::which("wl-paste").is_ok() {
        let out = Command::new("wl-paste").output()?;
        if !out.status.success() {
            return Err(anyhow!("wl-paste falló"));
        }
        return Ok(String::from_utf8_lossy(&out.stdout).to_string());
    }
    if which::which("xclip").is_ok() {
        let out = Command::new("xclip")
            .args(["-selection", "clipboard", "-o"])
            .output()?;
        if !out.status.success() {
            return Err(anyhow!("xclip get falló"));
        }
        return Ok(String::from_utf8_lossy(&out.stdout).to_string());
    }
    Err(anyhow!("no hay herramienta de portapapeles disponible (instala wl-clipboard o xclip)"))
}

pub async fn clipboard_set(content: &str) -> Result<()> {
    if std::env::var("WAYLAND_DISPLAY").is_ok() && which::which("wl-copy").is_ok() {
        let mut child = Command::new("wl-copy")
            .stdin(std::process::Stdio::piped())
            .spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(content.as_bytes())?;
        }
        let _ = child.wait()?;
        return Ok(());
    }
    if which::which("xclip").is_ok() {
        let mut child = Command::new("xclip")
            .args(["-selection", "clipboard"])
            .stdin(std::process::Stdio::piped())
            .spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(content.as_bytes())?;
        }
        let _ = child.wait()?;
        return Ok(());
    }
    Err(anyhow!("no hay herramienta de portapapeles disponible"))
}
