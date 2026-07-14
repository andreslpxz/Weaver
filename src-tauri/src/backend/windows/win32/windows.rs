//! Gestión de ventanas vía Win32 API.
//!
//! Usa `EnumWindows` para listar ventanas top-level visibles, y
//! `SetForegroundWindow` + `AllowSetForegroundWindow` para activarlas.

use anyhow::{anyhow, Result};
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, GetClassNameW, IsWindowVisible,
    SetForegroundWindow, GetWindowThreadProcessId, AllowSetForegroundWindow,
    ASFW_ANY,
};
use windows::Win32::System::Threading::OpenProcess;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
};

use crate::backend::shared_types::Rect;
use crate::backend::WindowInfo;

/// Lista las ventanas top-level visibles.
pub fn list_windows() -> Result<Vec<WindowInfo>> {
    let mut windows: Vec<WindowInfo> = Vec::new();
    let windows_ptr = &mut windows as *mut Vec<WindowInfo>;

    unsafe {
        EnumWindows(
            Some(enum_proc),
            LPARAM(windows_ptr as isize),
        )
        .map_err(|e| anyhow!("EnumWindows falló: {e}"))?;
    }

    Ok(windows)
}

unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let windows = &mut *(lparam.0 as *mut Vec<WindowInfo>);

    // Solo ventanas visibles.
    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }

    // Título.
    let mut title_buf = [0u16; 512];
    let title_len = GetWindowTextW(hwnd, &mut title_buf);
    let title = if title_len > 0 {
        OsString::from_wide(&title_buf[..title_len as usize])
            .to_string_lossy()
            .into_owned()
    } else {
        String::new()
    };

    // Saltar ventanas sin título (suelen ser helpers invisibles).
    if title.is_empty() {
        return BOOL(1);
    }

    // Class name.
    let mut class_buf = [0u16; 256];
    let class_len = GetClassNameW(hwnd, &mut class_buf);
    let class_name = if class_len > 0 {
        OsString::from_wide(&class_buf[..class_len as usize])
            .to_string_lossy()
            .into_owned()
    } else {
        String::new()
    };

    // PID + process name.
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    let process_name = process_name_by_pid(pid).unwrap_or_else(|_| String::new());

    windows.push(WindowInfo {
        id: format!("hwnd:{}", hwnd.0 as usize),
        title,
        class_name,
        process_name,
        rect: None, // TODO W4: GetWindowRect
    });

    BOOL(1) // continuar enumeración
}

/// Activa una ventana por HWND (formato "hwnd:1234") o por título (substring).
pub fn activate_window(id_or_title: &str) -> Result<()> {
    // Si es "hwnd:NNN", buscar por handle directo.
    if let Some(hwnd_str) = id_or_title.strip_prefix("hwnd:") {
        let hwnd_val: usize = hwnd_str
            .parse()
            .map_err(|_| anyhow!("HWND inválido: {hwnd_str}"))?;
        let hwnd = HWND(hwnd_val as *mut _);
        return activate_hwnd(hwnd);
    }

    // Si no, buscar por título (substring match case-insensitive).
    let target_lower = id_or_title.to_lowercase();

    // Enumerar ventanas hasta encontrar una cuyo título contenga el target.
    let windows = list_windows()?;
    let found = windows
        .into_iter()
        .find(|w| w.title.to_lowercase().contains(&target_lower))
        .ok_or_else(|| anyhow!("ventana no encontrada: {id_or_title}"))?;

    // El campo `id` está en formato "hwnd:NNN".
    if let Some(hwnd_str) = found.id.strip_prefix("hwnd:") {
        let hwnd_val: usize = hwnd_str
            .parse()
            .map_err(|_| anyhow!("HWND inválido: {hwnd_str}"))?;
        let hwnd = HWND(hwnd_val as *mut _);
        return activate_hwnd(hwnd);
    }

    Err(anyhow!("no se pudo obtener HWND de la ventana encontrada"))
}

fn activate_hwnd(hwnd: HWND) -> Result<()> {
    unsafe {
        // Permitir que cualquier proceso establezca el foreground.
        let _ = AllowSetForegroundWindow(ASFW_ANY);

        SetForegroundWindow(hwnd)
            .ok()
            .map_err(|e| anyhow!("SetForegroundWindow falló: {e}"))?;
    }
    Ok(())
}

/// Devuelve el nombre del proceso dado su PID.
fn process_name_by_pid(pid: u32) -> Result<String> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
            .map_err(|e| anyhow!("CreateToolhelp32Snapshot falló: {e}"))?;

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if Process32FirstW(snapshot, &mut entry).is_err() {
            return Err(anyhow!("Process32First falló"));
        }

        loop {
            if entry.th32ProcessID == pid {
                let name = OsString::from_wide(&entry.szExeFile)
                    .to_string_lossy()
                    .into_owned();
                // Quitar null terminators.
                let name = name.trim_end_matches('\0').to_string();
                return Ok(name);
            }
            if Process32NextW(snapshot, &mut entry).is_err() {
                break;
            }
        }

        Err(anyhow!("PID {pid} no encontrado"))
    }
}
