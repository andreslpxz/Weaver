//! Portapapeles vía Win32 API.
//!
//! Usa `OpenClipboard` + `GetClipboardData(CF_UNICODETEXT)` para leer, y
//! `EmptyClipboard` + `SetClipboardData` para escribir. La crate `windows`
//! provee bindings seguros.

use anyhow::{anyhow, Result};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::Ole::CF_UNICODETEXT;
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
};
use windows::Win32::System::DataExchange::GetClipboardData;

/// Lee el texto del portapapeles del sistema.
pub fn clipboard_get() -> Result<String> {
    unsafe {
        // Abrir portapapeles (HWND(0) = cualquier ventana).
        OpenClipboard(HWND(0))
            .map_err(|e| anyhow!("OpenClipboard falló: {e}"))?;

        let result = (|| {
            let handle = GetClipboardData(CF_UNICODETEXT.0 as u32)
                .map_err(|e| anyhow!("GetClipboardData falló: {e}"))?;

            let ptr = GlobalLock(handle.0 as isize) as *const u16;
            if ptr.is_null() {
                return Err(anyhow!("GlobalLock devolvió NULL"));
            }

            // Leer string UTF-16 hasta null terminator.
            let mut len = 0usize;
            while *ptr.add(len) != 0 {
                len += 1;
            }
            let slice = std::slice::from_raw_parts(ptr, len);
            let text = String::from_utf16_lossy(slice);

            let _ = GlobalUnlock(handle.0 as isize);
            Ok(text)
        })();

        let _ = CloseClipboard();
        result
    }
}

/// Escribe texto en el portapapeles del sistema.
pub fn clipboard_set(content: &str) -> Result<()> {
    unsafe {
        OpenClipboard(HWND(0))
            .map_err(|e| anyhow!("OpenClipboard falló: {e}"))?;

        let result = (|| -> Result<()> {
            EmptyClipboard()
                .map_err(|e| anyhow!("EmptyClipboard falló: {e}"))?;

            // Convertir a UTF-16 + null terminator.
            let mut utf16: Vec<u16> = content.encode_utf16().collect();
            utf16.push(0);

            let byte_len = utf16.len() * 2;
            let handle = GlobalAlloc(GMEM_MOVEABLE, byte_len)
                .map_err(|e| anyhow!("GlobalAlloc falló: {e}"))?;

            let ptr = GlobalLock(handle.0 as isize) as *mut u16;
            if ptr.is_null() {
                return Err(anyhow!("GlobalLock devolvió NULL"));
            }
            std::ptr::copy_nonoverlapping(utf16.as_ptr(), ptr, utf16.len());
            let _ = GlobalUnlock(handle.0 as isize);

            SetClipboardData(CF_UNICODETEXT.0 as u32, handle.0 as *mut _)
                .map_err(|e| anyhow!("SetClipboardData falló: {e}"))?;

            Ok(())
        })();

        let _ = CloseClipboard();
        result
    }
}
