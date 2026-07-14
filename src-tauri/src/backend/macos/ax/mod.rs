//! Wrapper sobre macOS Accessibility API (AXUIElement).
//!
//! Módulo placeholder — la implementación real vivirá aquí cuando se ejecute
//! la Fase M2 (ver `PLAN_MACOS.md`).
//!
//! Contendrá:
//! - `client.rs`: `AXUIElementCreateApplication(pid)` + helpers
//! - `tree.rs`: recursión sobre atributo `AXChildren`
//! - `types.rs`: conversión `AXRole` → `Role` canónico
//! - `actions.rs`: `AXPress`, `AXSetValue`, `AXSetFocused` + fallback CGEvent
