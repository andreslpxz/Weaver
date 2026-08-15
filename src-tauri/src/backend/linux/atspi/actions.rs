//! Acciones de alto nivel sobre elementos accesibles.
//!
//! Todas las funciones reciben `(bus_name, path)` para identificar el elemento
//! de forma opaca y robusta (sin coordenadas).

use anyhow::{anyhow, Context, Result};
use zbus::zvariant::OwnedObjectPath;

use super::client::{ActionProxy, ComponentProxy, TextProxy};
use zbus::Connection;

/// Hace clic en el elemento identificado por `(bus_name, path)`.
/// Internamente: `Component::grab_focus` + `Action::do_action(0)` (la acción 0
/// suele ser "click"/"press"/"jump" en la mayoría de backends AT-SPI).
pub async fn click(conn: &Connection, bus_name: &str, path: &str) -> Result<()> {
    let component = ComponentProxy::builder(conn)
        .destination(bus_name)?
        .path(path)?
        .build()
        .await
        .context("el elemento no implementa Component")?;
    let _ = component.grab_focus().await;

    let action = ActionProxy::builder(conn)
        .destination(bus_name)?
        .path(path)?
        .build()
        .await
        .context("el elemento no implementa Action")?;

    let n = action.n_actions().await?;
    if n <= 0 {
        return Err(anyhow!("el elemento no tiene acciones"));
    }
    // Buscar la acción "click" preferentemente.
    let mut idx = 0i32;
    for i in 0..n {
        if let Ok(name) = action.get_action_name(i).await {
            let lower = name.to_ascii_lowercase();
            if lower.contains("click") || lower.contains("press") || lower.contains("activate") {
                idx = i;
                break;
            }
        }
    }
    let _ok = action.do_action(idx).await?;
    Ok(())
}

/// Doble clic: dos `do_action` con una pequeña pausa entre medias.
pub async fn double_click(conn: &Connection, bus_name: &str, path: &str) -> Result<()> {
    click(conn, bus_name, path).await?;
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    click(conn, bus_name, path).await?;
    Ok(())
}

/// Escribe texto en un elemento editable (Entry, EditBar, Text).
/// Sigue esta cascada:
///   1. `Text::set_text(content)` (algunos backends lo soportan).
///   2. Si falla: `Component::grab_focus` + emulación de teclado vía
///      `crate::automation::keyboard::type_text`.
pub async fn type_text(
    conn: &Connection,
    bus_name: &str,
    path: &str,
    text: &str,
) -> Result<()> {
    if let Ok(t) = TextProxy::builder(conn)
        .destination(bus_name)?
        .path(path)?
        .build()
        .await
    {
        if t.set_text(text).await.is_ok() {
            return Ok(());
        }
    }

    // Fallback: foco + teclado sintético.
    if let Ok(c) = ComponentProxy::builder(conn)
        .destination(bus_name)?
        .path(path)?
        .build()
        .await
    {
        let _ = c.grab_focus().await;
    }
    crate::backend::linux::automation::keyboard::type_text(text)
        .await
        .map_err(|e| anyhow!("type_text fallback falló: {e}"))?;
    Ok(())
}

/// Presiona una tecla o combinación (formato xdotool-like: "ctrl+s", "Return",
/// "alt+Tab"). Implementación: delega al módulo de automation.
pub async fn press_key(key_combo: &str) -> Result<()> {
    crate::backend::linux::automation::keyboard::press_key_combo(key_combo)
        .await
        .map_err(|e| anyhow!("press_key falló: {e}"))?;
    Ok(())
}

/// Devuelve el texto contenido en el elemento, o `None` si no implementa Text.
pub async fn get_text(
    conn: &Connection,
    bus_name: &str,
    path: &str,
) -> Result<Option<String>> {
    let t = TextProxy::builder(conn)
        .destination(bus_name)?
        .path(path)?
        .build()
        .await;
    let Ok(t) = t else { return Ok(None) };
    let count = t.character_count().await?;
    if count <= 0 {
        return Ok(Some(String::new()));
    }
    let text = t.get_text(0, count.min(50_000)).await?;
    Ok(Some(text))
}

/// Devuelve las coordenadas (x, y, w, h) del elemento en pantalla.
pub async fn get_extents(
    conn: &Connection,
    bus_name: &str,
    path: &str,
) -> Result<(i32, i32, i32, i32)> {
    let c = ComponentProxy::builder(conn)
        .destination(bus_name)?
        .path(path)?
        .build()
        .await
        .context("el elemento no implementa Component")?;
    Ok(c.get_extents(0).await?)
}

/// Pone el foco en el elemento.
pub async fn focus(
    conn: &Connection,
    bus_name: &str,
    path: &str,
) -> Result<()> {
    let c = ComponentProxy::builder(conn)
        .destination(bus_name)?
        .path(path)?
        .build()
        .await
        .context("el elemento no implementa Component")?;
    let _ = c.grab_focus().await?;
    Ok(())
}

/// Helper para construir un OwnedObjectPath con validación.
#[allow(dead_code)]
pub fn owned_path(p: &str) -> Result<OwnedObjectPath> {
    OwnedObjectPath::try_from(p)
        .map_err(|e| anyhow!("path inválido {p:?}: {e}"))
}
