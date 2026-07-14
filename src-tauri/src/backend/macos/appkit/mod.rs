//! APIs AppKit que no cubre Accessibility.
//!
//! - `clipboard.rs`: NSPasteboard para portapapeles.
//! - `workspace.rs`: NSWorkspace + NSRunningApplication para listar/activar apps.
//! - `input.rs`: CGEvent para emular teclado y ratón (fallback de AXPress/AXValue).

pub mod clipboard;
pub mod input;
pub mod workspace;

pub use clipboard::{clipboard_get, clipboard_set};
pub use input::{click_at, press_key_combo, type_text};
pub use workspace::{activate_window, list_windows, list_running_application_pids};
