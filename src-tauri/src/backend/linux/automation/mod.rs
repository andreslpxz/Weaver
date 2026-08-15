//! Automatización de bajo nivel: teclado, ratón, portapapeles, ventanas.
//!
//! En Linux hay dos caminos:
//!   - **X11**: emulación directa vía `x11rb` (XTest extension). Funciona sin
//!     privilegios extra y permite inyectar eventos en cualquier ventana.
//!   - **Wayland**: por seguridad, los compositores modernos no permiten
//!     eventos sintéticos globales. La alternativa es invocar herramientas
//!     externas como `wtype`, `ydotool` (con daemon) o pedir al usuario
//!     configurar atajos. Por ahora el módulo detecta `$WAYLAND_DISPLAY` y
//!     delega a `wtype`/`wl-copy` si está disponible.

pub mod clipboard;
pub mod keyboard;
pub mod mouse;
pub mod windows;

pub use clipboard::{clipboard_get, clipboard_set};
pub use keyboard::{press_key_combo, type_text};
pub use mouse::click_at;
pub use windows::{list_windows, activate_window, WindowInfo};
