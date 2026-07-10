//! Emulación de ratón: clics en coordenadas absolutas de pantalla.

use anyhow::{anyhow, Result};
use std::process::Command;

/// Hace clic (botón 1) en `(x, y)` coordenadas absolutas de pantalla.
pub async fn click_at(x: i32, y: i32, button: u8) -> Result<()> {
    let btn = match button {
        1 => "1",
        2 => "2",
        3 => "3",
        _ => return Err(anyhow!("botón inválido: {button}")),
    };
    if which::which("xdotool").is_ok() {
        let status = Command::new("xdotool")
            .arg("mousemove")
            .arg("--sync")
            .arg(x.to_string())
            .arg(y.to_string())
            .arg("click")
            .arg(btn)
            .status()?;
        if !status.success() {
            return Err(anyhow!("xdotool click falló"));
        }
        return Ok(());
    }
    Err(anyhow!("xdotool no está instalado (requerido para click_at)"))
}
