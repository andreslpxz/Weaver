//! Wrapper sobre macOS Accessibility API (AXUIElement).
//!
//! Módulo principal de la API de accesibilidad de macOS. Implementa:
//!
//! - `client.rs`: `AxClient` con verificación de permiso + helpers de búsqueda.
//! - `tree.rs`: recorrido recursivo del árbol con `AXChildren`.
//! - `types.rs`: mapeo `AXRole` → `Role` canónico + `StateSet`.
//! - `actions.rs`: `click` (AXPress), `type_text` (AXValue), `get_text`, `focus`.
//!
//! La crate `accessibility` (v0.2+) provee bindings Rust a `AXUIElement`
//! de `ApplicationServices.framework`.
//!
//! IMPORTANTE: macOS requiere permiso de Accessibility en
//! System Settings → Privacy & Security. Verificar al iniciar con
//! `AxClient::check_accessibility_permission(true)`.

pub mod actions;
pub mod client;
pub mod tree;
pub mod types;

pub use client::AxClient;
