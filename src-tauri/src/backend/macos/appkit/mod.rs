//! APIs AppKit que no cubre Accessibility.
//!
//! Módulo placeholder — la implementación real vivirá aquí cuando se ejecute
//! la Fase M4 (ver `PLAN_MACOS.md`).
//!
//! Contendrá:
//! - `input.rs`: `CGEvent` (keyboard/mouse) — fallback de `enigo`
//! - `clipboard.rs`: `NSPasteboard::generalPasteboard` + `stringForType:`
//! - `workspace.rs`: `NSWorkspace::runningApplications` + `NSRunningApplication::activateWithOptions`
