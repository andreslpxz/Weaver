//! Gestión de aplicaciones y ventanas vía NSWorkspace (AppKit).
//!
//! Usa `NSWorkspace::runningApplications` para listar apps activas, y
//! `NSRunningApplication::activateWithOptions` para activarlas.

use anyhow::{anyhow, Result};
use objc2::rc::Retained;
use objc2_app_kit::{
    NSApplicationActivationPolicy, NSRunningApplication, NSWorkspace,
};
use objc2_foundation::NSArray;

use crate::backend::shared_types::Rect;
use crate::backend::WindowInfo;

/// Lista los PIDs de las aplicaciones con UI visible.
///
/// Filtra por `NSApplicationActivationPolicyRegular` (apps con dock icon).
pub fn list_running_application_pids() -> Result<Vec<u32>> {
    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let apps: Retained<NSArray<NSRunningApplication>> =
            workspace.runningApplications();
        let mut pids = Vec::with_capacity(apps.count());
        for i in 0..apps.count() {
            let app = apps.objectAtIndex(i);
            // Solo apps regulares (con UI).
            if app.activationPolicy() == NSApplicationActivationPolicy::Regular {
                pids.push(app.processIdentifier() as u32);
            }
        }
        Ok(pids)
    }
}

/// Lista las ventanas top-level visibles usando AXUIElement por cada app.
///
/// Esta función requiere permiso de Accessibility.
pub fn list_windows() -> Result<Vec<WindowInfo>> {
    let pids = list_running_application_pids()?;
    let mut windows = Vec::new();

    for pid in pids {
        use accessibility::{AXUIElement, AXUIElementAttributes};
        let app = AXUIElement::application(pid);

        // Nombre de la app.
        let app_name = app
            .attribute(&AXUIElementAttributes::title)
            .ok()
            .and_then(|v| {
                unsafe {
                    let cf_str = v.as_CFTypeRef() as *const core_foundation::string::__CFString;
                    if cf_str.is_null() {
                        return None;
                    }
                    Some(
                        core_foundation::string::CFString::wrap_under_get_rule(cf_str as *mut _)
                            .to_string(),
                    )
                }
            })
            .unwrap_or_else(|| format!("pid:{pid}"));

        // AXWindows: array de ventanas top-level.
        if let Some(windows_array) = app
            .attribute(&AXUIElementAttributes::windows)
            .ok()
            .and_then(|v| {
                unsafe {
                    let ptr = v.as_CFTypeRef() as *const core_foundation::array::__CFArray;
                    if ptr.is_null() {
                        return None;
                    }
                    Some(core_foundation::array::CFArray::wrap_under_get_rule(ptr as *mut _))
                }
            })
        {
            for i in 0..windows_array.count() {
                let win_cf = windows_array.get(i);
                unsafe {
                    let win_ptr = win_cf.as_CFTypeRef() as *const accessibility::sys::AXUIElement;
                    if win_ptr.is_null() {
                        continue;
                    }
                    let win = AXUIElement::wrap_under_get_rule(win_ptr as *mut _);

                    // Título de la ventana.
                    let title = win
                        .attribute(&AXUIElementAttributes::title)
                        .ok()
                        .and_then(|v| {
                            let cf_str = v.as_CFTypeRef() as *const core_foundation::string::__CFString;
                            if cf_str.is_null() {
                                return None;
                            }
                            Some(
                                core_foundation::string::CFString::wrap_under_get_rule(cf_str as *mut _)
                                    .to_string(),
                            )
                        })
                        .unwrap_or_default();

                    if !title.is_empty() {
                        windows.push(WindowInfo {
                            id: format!("pid:{pid}/win:{i}"),
                            title,
                            class_name: String::new(),
                            process_name: app_name.clone(),
                            rect: None, // TODO: leer AXPosition + AXSize
                        });
                    }
                }
            }
        }
    }
    Ok(windows)
}

/// Activa una ventana por ID ("pid:NNN/win:NN") o por título (substring).
pub fn activate_window(id_or_title: &str) -> Result<()> {
    // Si es "pid:NNN/win:NN", activar esa app.
    if let Some(pid_str) = id_or_title.strip_prefix("pid:") {
        let pid_str = pid_str.split('/').next().unwrap_or(pid_str);
        let pid: i32 = pid_str
            .parse()
            .map_err(|_| anyhow!("PID inválido: {pid_str}"))?;
        return activate_app_by_pid(pid);
    }

    // Si no, buscar por título (substring match case-insensitive).
    let target_lower = id_or_title.to_lowercase();
    let windows = list_windows()?;
    let found = windows
        .into_iter()
        .find(|w| w.title.to_lowercase().contains(&target_lower))
        .ok_or_else(|| anyhow!("ventana no encontrada: {id_or_title}"))?;

    if let Some(pid_str) = found.id.strip_prefix("pid:") {
        let pid_str = pid_str.split('/').next().unwrap_or(pid_str);
        let pid: i32 = pid_str
            .parse()
            .map_err(|_| anyhow!("PID inválido: {pid_str}"))?;
        return activate_app_by_pid(pid);
    }

    Err(anyhow!("no se pudo obtener PID de la ventana encontrada"))
}

/// Activa la app dado su PID usando NSRunningApplication.
fn activate_app_by_pid(pid: i32) -> Result<()> {
    unsafe {
        let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
            .ok_or_else(|| anyhow!("NSRunningApplication no encontrada para PID {pid}"))?;

        // ActivateWithOptions: NSApplicationActivateIgnoringOtherApps = 1 << 1 = 2.
        const NS_APPLICATION_ACTIVATE_IGNORING_OTHER_APPS: u64 = 1 << 1;
        app.activateWithOptions(NS_APPLICATION_ACTIVATE_IGNORING_OTHER_APPS);
    }
    Ok(())
}
