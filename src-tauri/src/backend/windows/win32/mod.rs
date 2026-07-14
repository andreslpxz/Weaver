//! APIs Win32 que no cubre UIAutomation.
//!
//! - `clipboard.rs`: portapapeles vía `OpenClipboard` / `GetClipboardData`.
//! - `windows.rs`: `EnumWindows` / `SetForegroundWindow`.
//! - `input.rs`: `SendInput` para teclado y ratón (fallback de patrones).

pub mod clipboard;
pub mod input;
pub mod windows;

pub use clipboard::{clipboard_get, clipboard_set};
pub use input::{click_at, press_key_combo, type_text};
pub use windows::{activate_window, list_windows};
