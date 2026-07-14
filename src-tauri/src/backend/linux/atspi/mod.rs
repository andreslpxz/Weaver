//! AT-SPI2 client (Linux Accessibility).
//!
//! Habla con `org.a11y.atspi.Registry` sobre D-Bus (session bus) usando `zbus`.
//! Permite leer el árbol de accesibilidad de cualquier aplicación y disparar
//! acciones (clic, escribir, foco, etc.) sin necesidad de visión por computadora.

pub mod actions;
pub mod client;
pub mod tree;
pub mod types;

pub use client::AtspiClient;
pub use types::{AccessibleNode, ApplicationInfo, Rect, Role, StateSet};
