//! Portapapeles vía NSPasteboard (AppKit).
//!
//! Usa `NSPasteboard::generalPasteboard` para obtener el portapapeles global,
//! y `stringForType:` + `setString:forType:` para leer/escribir texto plano.

use anyhow::{anyhow, Result};
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
use objc2_foundation::NSString;

/// Lee el texto del portapapeles del sistema.
pub fn clipboard_get() -> Result<String> {
    unsafe {
        let pb = NSPasteboard::generalPasteboard();
        let type_string = NSPasteboardTypeString;
        let string: Option<Retained<NSString>> =
            pb.stringForType(&type_string.into());
        match string {
            Some(s) => Ok(s.to_string()),
            None => Ok(String::new()),
        }
    }
}

/// Escribe texto en el portapapeles del sistema.
pub fn clipboard_set(content: &str) -> Result<()> {
    unsafe {
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        let ns_string = NSString::from_str(content);
        let type_string = NSPasteboardTypeString;
        let ok = pb.setString_forType(&ns_string, &type_string.into());
        if !ok {
            return Err(anyhow!("NSPasteboard::setString falló"));
        }
        Ok(())
    }
}
