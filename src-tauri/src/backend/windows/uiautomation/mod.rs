//! Wrapper sobre Microsoft UIAutomation.
//!
//! Módulo principal de la API de accesibilidad de Windows. Implementa:
//!
//! - `client.rs`: `UiaClient` con la instancia COM raíz + helpers de búsqueda.
//! - `tree.rs`: recorrido recursivo del árbol con `get_children()`.
//! - `types.rs`: mapeo `ControlType` → `Role` canónico + `StateSet`.
//! - `actions.rs`: `click`, `type_text`, `get_text`, `focus` vía Patterns.
//!
//! La crate `uiautomation` (v0.16+) envuelve la API COM `IUIAutomation` de
//! Microsoft sin requerir código unsafe manual.

pub mod actions;
pub mod client;
pub mod tree;
pub mod types;

pub use client::UiaClient;
