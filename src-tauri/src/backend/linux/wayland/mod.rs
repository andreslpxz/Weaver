//! Soporte Wayland vía `xdg-desktop-portal`.
//!
//! Fase 7 — Linux polishing.
//!
//! ## Problema
//!
//! Wayland, por diseño de seguridad, **no permite** que apps inyecten eventos
//! sintéticos de teclado/ratón globalmente. `xdotool` y `wtype` no funcionan
//! en sesiones Wayland puras (solo en Xwayland para ventanas X11).
//!
//! ## Solución
//!
//! Usar el portal `org.freedesktop.portal.RemoteDesktop` + `ScreenCast`:
//!
//! 1. Pedir al usuario (diálogo nativo) permiso para compartir pantalla+input.
//! 2. Obtener un fd de socket wayland y un stream de pipewire.
//! 3. Emular input vía la API del portal (no vía XTest/wtype).
//!
//! Esto funciona en GNOME, KDE Plasma y Sway con `xdg-desktop-portal` >= 1.7.
//!
//! ## Estado
//!
//! **STUB** — la implementación real requiere más trabajo:
//! - Conexión D-Bus al portal (zbus ya disponible).
//! - Negociación de sesión (CreateSession, SelectDevices, Start).
//! - Llamadas a `NotifyKeyboardKeycode` / `NotifyPointerMotion` etc.
//!
//! Por ahora, detectamos Wayland y devolvemos un error claro que guía al
//! usuario a usar X11 o a aceptar limitaciones.

use anyhow::{anyhow, Result};
use std::env;

/// Devuelve true si estamos en una sesión Wayland pura (sin Xwayland).
pub fn is_pure_wayland() -> bool {
    env::var("WAYLAND_DISPLAY").is_ok() && env::var("DISPLAY").is_err()
}

/// Devuelve true si Xwayland está activo (podemos usar xdotool/wtype).
pub fn has_xwayland() -> bool {
    env::var("WAYLAND_DISPLAY").is_ok() && env::var("DISPLAY").is_ok()
}

/// Detecta el backend de input disponible.
pub fn detect_input_backend() -> InputBackend {
    if !is_pure_wayland() && env::var("DISPLAY").is_ok() {
        InputBackend::X11
    } else if which::which("wtype").is_ok() && which::which("wl-copy").is_ok() {
        InputBackend::WaylandWithWtype
    } else if is_pure_wayland() {
        InputBackend::WaylandPortal
    } else {
        InputBackend::None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputBackend {
    /// X11 puro o Xwayland — xdotool funciona.
    X11,
    /// Wayland con wtype/wl-clipboard instalados.
    WaylandWithWtype,
    /// Wayland puro sin herramientas — necesita portal.
    WaylandPortal,
    /// Ningún backend disponible.
    None,
}

impl std::fmt::Display for InputBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::X11 => write!(f, "X11 (xdotool)"),
            Self::WaylandWithWtype => write!(f, "Wayland + wtype"),
            Self::WaylandPortal => write!(f, "Wayland (requiere xdg-desktop-portal)"),
            Self::None => write!(f, "Ninguno"),
        }
    }
}

/// Intenta iniciar sesión con el portal RemoteDesktop.
///
/// Muestra un diálogo nativo al usuario pidiendo permiso para compartir
/// pantalla y emular input. Si acepta, devuelve un session handle.
///
/// **STUB**: por ahora devuelve error explicando limitación.
pub async fn start_portal_session() -> Result<PortalSession> {
    Err(anyhow!(
        "xdg-desktop-portal RemoteDesktop session no implementada aún. \
         En Wayland puro, instala 'wtype' + 'wl-clipboard' como workaround, \
         o usa sesión X11/Xwayland."
    ))
}

/// Sesión activa del portal RemoteDesktop.
///
/// Cuando se implemente, contendrá:
/// - session_handle: ObjectPath de D-Bus
/// - stream_fd: file descriptor del stream PipeWire
/// - devices: bitmask de teclado/ratón/touch permitidos
pub struct PortalSession {
    _private: (),
}

impl PortalSession {
    /// Envía un evento de tecla (keycode Linux + estado pressed/released).
    pub async fn notify_key(&self, _keycode: u32, _pressed: bool) -> Result<()> {
        Err(anyhow!("PortalSession::notify_key no implementado"))
    }

    /// Mueve el ratón a (x, y) relativo o absoluto.
    pub async fn notify_pointer_motion(&self, _x: f64, _y: f64) -> Result<()> {
        Err(anyhow!("PortalSession::notify_pointer_motion no implementado"))
    }

    /// Click del botón indicado.
    pub async fn notify_pointer_button(&self, _button: u32, _pressed: bool) -> Result<()> {
        Err(anyhow!("PortalSession::notify_pointer_button no implementado"))
    }

    /// Cierra la sesión del portal.
    pub async fn close(self) -> Result<()> {
        Ok(())
    }
}

/// Devuelve un mensaje legible para mostrar al usuario cuando estamos en
/// Wayland puro sin herramientas.
pub fn wayland_help_message() -> String {
    String::from(
        "Estás en Wayland puro sin 'wtype' instalado. Weaver necesita emular \
         teclado/ratón para operar apps. Opciones:\n\
         1. Instala 'wtype' y 'wl-clipboard' (recomendado):\n\
            Debian/Ubuntu: sudo apt install wtype wl-clipboard\n\
            Arch: sudo pacman -S wtype wl-clipboard\n\
         2. Usa sesión X11 en lugar de Wayland (loguea con gear → Xorg).\n\
         3. Espera soporte completo xdg-desktop-portal (en desarrollo).",
    )
}
