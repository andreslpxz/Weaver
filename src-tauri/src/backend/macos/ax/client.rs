//! Cliente AXUIElement: inicializa la API de Accessibility de macOS.
//!
//! macOS requiere que la app tenga permiso de Accessibility en
//! System Settings → Privacy & Security → Accessibility. Sin este permiso,
//! las llamadas a AXUIElement devuelven datos vacíos o errores silentes.

use anyhow::{anyhow, Result};
use accessibility::AXUIElement;
use core_foundation::base::{CFType, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;

use crate::backend::shared_types::ApplicationInfo;

/// Cliente AXUIElement raíz.
pub struct AxClient {
    /// Elemento system-wide: raíz para listar apps.
    #[allow(dead_code)]
    system: AXUIElement,
}

impl AxClient {
    /// Crea el cliente. NO llama a `AXIsProcessTrusted` aquí — eso se hace
    /// explícitamente con `check_accessibility_permission()` al iniciar.
    pub fn new() -> Result<Self> {
        let system = AXUIElement::system_application();
        Ok(Self { system })
    }

    /// Verifica si la app tiene permiso de Accessibility.
    /// Si `prompt` es true, muestra diálogo nativo pidiendo el permiso.
    pub fn check_accessibility_permission(prompt: bool) -> bool {
        let key = CFString::new("AXTrustedCheckOptionPrompt");
        let value = CFBoolean::from(prompt);
        let options = CFDictionary::from_CFType_pairs(&[(&key, &value)]);

        unsafe {
            extern "C" {
                fn AXIsProcessTrustedWithOptions(
                    options: *const core_foundation::base::CFTypeRef,
                ) -> bool;
            }
            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef() as *const _)
        }
    }

    /// Lista las aplicaciones en ejecución vía NSWorkspace.
    pub fn list_applications(&self) -> Result<Vec<ApplicationInfo>> {
        let pids = crate::backend::macos::appkit::workspace::list_running_application_pids()?;

        let mut apps = Vec::with_capacity(pids.len());
        for pid in pids {
            let app_element = AXUIElement::application(pid);

            // Nombre de la app (AXTitle attribute).
            let name = app_element
                .attribute(&accessibility::AXUIElementAttributes::title)
                .ok()
                .and_then(|v| cf_type_to_string(&v))
                .unwrap_or_else(|| format!("pid:{pid}"));

            // Count de ventanas top-level.
            let child_count = app_element
                .attribute_count(&accessibility::AXUIElementAttributes::windows)
                .unwrap_or(0) as i32;

            apps.push(ApplicationInfo {
                name,
                bus_name: format!("pid:{pid}"),
                root_path: format!("app:{pid}"),
                pid,
                child_count,
            });
        }
        Ok(apps)
    }

    /// Devuelve el AXUIElement de una aplicación dado su PID.
    pub fn app_element(&self, pid: u32) -> Result<AXUIElement> {
        Ok(AXUIElement::application(pid))
    }

    /// Devuelve el elemento con foco de teclado actual.
    pub fn focused_element(&self) -> Result<AXUIElement> {
        let system = AXUIElement::system_wide();
        let focused = system
            .attribute(&accessibility::AXUIElementAttributes::focused_ui_element)
            .map_err(|e| anyhow!("AXFocusedUIElement falló: {e:?}"))?;
        cf_type_to_ax_ui_element(&focused)
            .ok_or_else(|| anyhow!("no se pudo obtener focused element"))
    }

    /// Busca un elemento por su path (formato "app:{pid}/child_index/child_index/...").
    pub fn find_by_path(&self, path: &str) -> Result<AXUIElement> {
        let (pid_part, subpath) = path.split_once('/').unwrap_or((path, ""));
        let pid: u32 = pid_part
            .strip_prefix("app:")
            .ok_or_else(|| anyhow!("path inválido (debe empezar con 'app:'): {path}"))?
            .parse()
            .map_err(|e| anyhow!("PID inválido: {e}"))?;

        let app = AXUIElement::application(pid);

        if subpath.is_empty() {
            return Ok(app);
        }

        let mut current = app;
        for index_str in subpath.split('/') {
            // Saltarse segmentos tipo "ptr:0x123" (no navegables por índice).
            if index_str.starts_with("ptr:") {
                continue;
            }
            let index: usize = index_str
                .parse()
                .map_err(|e| anyhow!("índice inválido en path: {e}"))?;
            let children = current
                .attribute(&accessibility::AXUIElementAttributes::children)
                .map_err(|e| anyhow!("AXChildren falló: {e:?}"))?;
            let array = cf_type_to_array(&children)
                .ok_or_else(|| anyhow!("AXChildren no es un array"))?;
            if index >= array.count() {
                return Err(anyhow!("índice {index} fuera de rango (count={})", array.count()));
            }
            current = cf_type_to_ax_ui_element(&array.get(index))
                .ok_or_else(|| anyhow!("elemento hijo no es AXUIElement"))?;
        }
        Ok(current)
    }
}

// ── Helpers para CFType ───────────────────────────────────────────────────

fn cf_type_to_string(value: &CFType) -> Option<String> {
    unsafe {
        let cf_str = value.as_CFTypeRef() as *const core_foundation::string::__CFString;
        if cf_str.is_null() {
            return None;
        }
        let s = CFString::wrap_under_get_rule(cf_str as *mut _);
        Some(s.to_string())
    }
}

fn cf_type_to_ax_ui_element(value: &CFType) -> Option<AXUIElement> {
    // AXUIElement es toll-free bridged con CFTypeRef.
    // Casting directo es seguro según documentación de macOS.
    unsafe {
        // Usamos el método `wrap_under_create_rule` para tomar ownership
        // del CFType sin incrementar el refcount (que ya fue retenido por
        // la llamada a `attribute`).
        let cf_type = value.clone();
        // AXUIElement en `accessibility` crate tiene From<CFType> implícito.
        // Hacemos un cast inseguro al tipo interno.
        let raw = cf_type.as_CFTypeRef() as *mut std::ffi::c_void;
        if raw.is_null() {
            return None;
        }
        // AXUIElement::wrap_under_get_rule espera *mut AXUIElementRef.
        // El cast desde *mut c_void es válido porque son toll-free bridged.
        Some(AXUIElement::wrap_under_get_rule(raw as *mut _))
    }
}

fn cf_type_to_array(value: &CFType) -> Option<core_foundation::array::CFArray> {
    unsafe {
        let ptr = value.as_CFTypeRef() as *const core_foundation::array::__CFArray;
        if ptr.is_null() {
            return None;
        }
        Some(core_foundation::array::CFArray::wrap_under_get_rule(ptr as *mut _))
    }
}
