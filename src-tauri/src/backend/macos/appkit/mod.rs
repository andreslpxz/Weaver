//! AppKit wrappers: NSWorkspace, NSRunningApplication, NSPasteboard, CGEvent.
//!
//! Usa `objc2-app-kit` 0.2 con features NSPasteboard, NSWorkspace,
//! NSRunningApplication, NSScreen.

use anyhow::Result;
use core_foundation::base::{CFType, TCFType};
use core_foundation::string::CFString;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSPasteboard, NSRunningApplication, NSWorkspace};
use objc2_foundation::NSString;

use crate::backend::shared_types::ApplicationInfo;

/// Lista las aplicaciones en ejecución con políticas "Regular" (apps visibles).
pub fn list_running_applications() -> Result<Vec<ApplicationInfo>> {
    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let apps = workspace.runningApplications();
        let mut result = Vec::new();
        for app in apps.iter() {
            // Solo apps regulares (ignora helpers, daemons, etc.)
            if app.activationPolicy() as u32 != 0 {
                // NSApplicationActivationPolicyRegular = 0
                continue;
            }
            let name_obj: Option<Retained<NSString>> = app.localizedName();
            let name = name_obj
                .map(|s| s.to_string())
                .unwrap_or_else(|| "(unnamed)".to_string());
            let pid = app.processIdentifier();
            result.push(ApplicationInfo {
                name,
                bus_name: format!("pid:{}", pid),
                root_path: String::new(),
                pid: pid as u32,
                child_count: 0,
            });
        }
        Ok(result)
    }
}

/// Lista las ventanas de todas las apps en ejecución.
pub fn list_windows() -> Result<Vec<crate::backend::WindowInfo>> {
    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let apps = workspace.runningApplications();
        let mut windows = Vec::new();
        for app in apps.iter() {
            if app.activationPolicy() as u32 != 0 {
                continue;
            }
            let pid = app.processIdentifier();
            let name_obj: Option<Retained<NSString>> = app.localizedName();
            let name = name_obj
                .map(|s| s.to_string())
                .unwrap_or_else(|| "(unnamed)".to_string());
            // Para cada app, leer AXWindows attribute. Esto requiere AXUIElement,
            // delegamos a ax::AxClient si es necesario.
            // Por ahora, una entrada por app.
            windows.push(crate::backend::WindowInfo {
                id: format!("pid:{}", pid),
                title: name,
                desktop: 0,
                pid: pid as u32,
                geometry: [0, 0, 0, 0],
            });
        }
        Ok(windows)
    }
}

/// Activa una aplicación por PID.
pub fn activate_window(pid: i32) -> Result<()> {
    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let apps = workspace.runningApplications();
        for app in apps.iter() {
            if app.processIdentifier() == pid {
                // NSApplicationActivateAllWindows = 1 << 0
                // NSApplicationActivateIgnoringOtherApps = 1 << 1
                app.activateWithOptions_(3);
                return Ok(());
            }
        }
        anyhow::bail!("PID {} no encontrado entre apps en ejecución", pid);
    }
}

/// Lee el portapapeles del sistema.
pub fn clipboard_get() -> Result<String> {
    unsafe {
        let pb = NSPasteboard::generalPasteboard();
        let string_class = NSString::from_str("public.utf8-plain-text");
        let classes: &[&AnyObject] = &[&*string_class as *const NSString as *const AnyObject];
        let options: &[(NSString, AnyObject)] = &[];
        let objects = pb.readObjectsForClasses_options(classes, options);
        match objects.firstObject() {
            Some(obj) => {
                let s: &NSString = &*obj;
                Ok(s.to_string())
            }
            None => Ok(String::new()),
        }
    }
}

/// Escribe al portapapeles del sistema.
pub fn clipboard_set(content: &str) -> Result<()> {
    unsafe {
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        let s = NSString::from_str(content);
        let objs: &[&NSString] = &[&s];
        pb.writeObjects(objs);
    }
    Ok(())
}

// ============================================================================
// CGEvent — input sintético (teclado + ratón)
// ============================================================================
//
// Usamos objc2-core-graphics para CGEvent. La API es:
//   CGEventCreate(source, type, x, y) -> *mut CGEvent
//   CGEventSetType(event, type)
//   CGEventSetFlags(event, flags)
//   CGEventPost(tap, event)
//
// Nota: La crate `objc2-core-graphics` 0.3 tiene firmas que pueden variar
// entre versiones patch. Esta implementación usa las APIs estables.
// Si hay errores de compilación, ajustar tipos según docs.rs.

/// Click del ratón en coordenadas absolutas (screen).
pub fn click_at_via_cgevent(x: i32, y: i32, button: u8) -> Result<()> {
    unsafe {
        // kCGEventMouseMoved = 5
        // kCGEventLeftMouseDown = 1, kCGEventLeftMouseUp = 2
        // kCGEventRightMouseDown = 3, kCGEventRightMouseUp = 4
        let (down, up, btn_mask) = match button {
            0 => (1u32, 2u32, 1u32),  // left
            1 => (3u32, 4u32, 2u32),  // right
            _ => (1u32, 2u32, 1u32),  // default left
        };

        // CGEventCreateMouseEvent(NULL, type, point, button)
        // point = CGPoint { x, y }
        #[repr(C)]
        struct CGPoint { x: f64, y: f64 }
        extern "C" {
            fn CGEventCreateMouseEvent(
                source: *mut std::ffi::c_void,
                type_: u32,
                point: CGPoint,
                button: u32,
            ) -> *mut std::ffi::c_void;
            fn CGEventPost(tap: u32, event: *mut std::ffi::c_void);
            fn CFRelease(cf: *mut std::ffi::c_void);
        }

        let point = CGPoint { x: x as f64, y: y as f64 };
        let down_event = CGEventCreateMouseEvent(std::ptr::null_mut(), down, point, btn_mask);
        if down_event.is_null() {
            anyhow::bail!("CGEventCreateMouseEvent returned NULL");
        }
        CGEventPost(0, down_event); // kCGHIDEventTap = 0
        CFRelease(down_event);

        // Pequeña pausa entre down y up.
        std::thread::sleep(std::time::Duration::from_millis(50));

        let up_event = CGEventCreateMouseEvent(std::ptr::null_mut(), up, point, btn_mask);
        if up_event.is_null() {
            anyhow::bail!("CGEventCreateMouseEvent returned NULL");
        }
        CGEventPost(0, up_event);
        CFRelease(up_event);
    }
    Ok(())
}

/// Escribe texto vía CGEvent (un evento por caracter Unicode).
pub fn type_text_via_cgevent(text: &str) -> Result<()> {
    unsafe {
        extern "C" {
            fn CGEventCreateKeyboardEvent(
                source: *mut std::ffi::c_void,
                virtual_key: u16,
                key_down: bool,
            ) -> *mut std::ffi::c_void;
            fn CGEventKeyboardSetUnicodeString(
                event: *mut std::ffi::c_void,
                length: usize,
                string: *const u16,
            );
            fn CGEventPost(tap: u32, event: *mut std::ffi::c_void);
            fn CFRelease(cf: *mut std::ffi::c_void);
        }

        for ch in text.encode_utf16() {
            // virtual_key = 0 → usaremos el unicode string override.
            let down = CGEventCreateKeyboardEvent(std::ptr::null_mut(), 0, true);
            if down.is_null() {
                continue;
            }
            CGEventKeyboardSetUnicodeString(down, 1, &ch as *const u16);
            CGEventPost(0, down);
            CFRelease(down);

            let up = CGEventCreateKeyboardEvent(std::ptr::null_mut(), 0, false);
            if up.is_null() {
                continue;
            }
            CGEventKeyboardSetUnicodeString(up, 1, &ch as *const u16);
            CGEventPost(0, up);
            CFRelease(up);

            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }
    Ok(())
}

/// Presiona un key combo (ej: "ctrl+s", "alt+Tab", "cmd+q").
pub fn press_key_combo_via_cgevent(combo: &str) -> Result<()> {
    let parts: Vec<&str> = combo.split('+').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return Err(anyhow::anyhow!("combo vacío"));
    }
    let key_str = parts.last().unwrap().to_lowercase();
    let modifiers = &parts[..parts.len() - 1];

    unsafe {
        extern "C" {
            fn CGEventCreateKeyboardEvent(
                source: *mut std::ffi::c_void,
                virtual_key: u16,
                key_down: bool,
            ) -> *mut std::ffi::c_void;
            fn CGEventSetFlags(event: *mut std::ffi::c_void, flags: u64);
            fn CGEventPost(tap: u32, event: *mut std::ffi::c_void);
            fn CFRelease(cf: *mut std::ffi::c_void);
        }

        // Mapear key names a virtual key codes de macOS.
        let vk = key_to_vkc(&key_str).ok_or_else(|| anyhow::anyhow!("tecla desconocida: {}", key_str))?;

        // Flags de modificadores.
        // kCGEventFlagMaskCommand = 0x100000, kCGEventFlagMaskShift = 0x020000,
        // kCGEventFlagMaskAlternate = 0x080000, kCGEventFlagMaskControl = 0x040000
        let mut flags: u64 = 0;
        for m in modifiers {
            match m.to_lowercase().as_str() {
                "cmd" | "command" | "meta" | "win" => flags |= 0x100000,
                "shift" => flags |= 0x020000,
                "alt" | "option" | "opt" => flags |= 0x080000,
                "ctrl" | "control" => flags |= 0x040000,
                _ => return Err(anyhow::anyhow!("modificador desconocido: {}", m)),
            }
        }

        let down = CGEventCreateKeyboardEvent(std::ptr::null_mut(), vk, true);
        if down.is_null() {
            anyhow::bail!("CGEventCreateKeyboardEvent returned NULL");
        }
        CGEventSetFlags(down, flags);
        CGEventPost(0, down);
        CFRelease(down);

        std::thread::sleep(std::time::Duration::from_millis(20));

        let up = CGEventCreateKeyboardEvent(std::ptr::null_mut(), vk, false);
        if up.is_null() {
            anyhow::bail!("CGEventCreateKeyboardEvent returned NULL");
        }
        CGEventSetFlags(up, flags);
        CGEventPost(0, up);
        CFRelease(up);
    }
    Ok(())
}

/// Mapeo de key names a virtual key codes de macOS.
/// Ver https://opensource.apple.com/source/IOHIDFamily/IOHIDFamily-700/IOHIDSystem/IOKit/hidsystem/ev_keymap.h
fn key_to_vkc(key: &str) -> Option<u16> {
    Some(match key {
        "a" => 0x00, "s" => 0x01, "d" => 0x02, "f" => 0x03, "h" => 0x04,
        "g" => 0x05, "z" => 0x06, "x" => 0x07, "c" => 0x08, "v" => 0x09,
        "b" => 0x0b, "q" => 0x0c, "w" => 0x0d, "e" => 0x0e, "r" => 0x0f,
        "y" => 0x10, "t" => 0x11, "1" => 0x12, "2" => 0x13, "3" => 0x14,
        "4" => 0x15, "6" => 0x16, "5" => 0x17, "=" => 0x18, "9" => 0x19,
        "7" => 0x1a, "-" => 0x1b, "8" => 0x1c, "0" => 0x1d, "]" => 0x1e,
        "o" => 0x1f, "u" => 0x20, "[" => 0x21, "i" => 0x22, "p" => 0x23,
        "l" => 0x25, "j" => 0x26, "'" => 0x27, "k" => 0x28, ";" => 0x29,
        "\\" => 0x2a, "," => 0x2b, "/" => 0x2c, "n" => 0x2d, "m" => 0x2e,
        "." => 0x2f,
        "return" | "enter" => 0x24,
        "tab" => 0x30,
        "space" => 0x31,
        "delete" | "backspace" => 0x33,
        "escape" | "esc" => 0x35,
        "command" | "cmd" => 0x37,
        "shift" => 0x38,
        "capslock" => 0x39,
        "option" | "alt" => 0x3a,
        "control" | "ctrl" => 0x3b,
        "rightshift" => 0x3c,
        "rightoption" | "rightalt" => 0x3d,
        "rightcontrol" | "rightctrl" => 0x3e,
        "function" | "fn" => 0x3f,
        "f1" => 0x7a, "f2" => 0x78, "f3" => 0x63, "f4" => 0x76,
        "f5" => 0x60, "f6" => 0x61, "f7" => 0x62, "f8" => 0x64,
        "f9" => 0x65, "f10" => 0x6d, "f11" => 0x67, "f12" => 0x6f,
        "arrowup" | "up" => 0x7e,
        "arrowdown" | "down" => 0x7d,
        "arrowleft" | "left" => 0x7b,
        "arrowright" | "right" => 0x7c,
        "home" => 0x73,
        "end" => 0x77,
        "pageup" => 0x74,
        "pagedown" => 0x79,
        _ => return None,
    })
}
