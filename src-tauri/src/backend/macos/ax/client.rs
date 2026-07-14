//! Cliente AXUIElement: inicializa la API de Accessibility de macOS.
//!
//! macOS requiere que la app tenga permiso de Accessibility en
//! System Settings → Privacy & Security → Accessibility. Sin este permiso,
//! las llamadas a AXUIElement devuelven datos vacíos o errores silentes.
//!
//! Verificación de permiso:
//! ```text
//! use accessibility::AXIsProcessTrustedWithOptions;
//! let options = CFDictionary::from_CFType_pairs(&[
//!     (CFString::new("AXTrustedCheckOptionPrompt"), true.into())
//! ]);
//! AXIsProcessTrustedWithOptions(Some(&options));
//! ```

use anyhow::{anyhow, Context, Result};
use accessibility::{AXUIElement, AXUIElementAttributes};
use core_foundation::base::{CFType, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;

use crate::backend::shared_types::ApplicationInfo;

/// Cliente AXUIElement raíz.
///
/// Mantiene una referencia al system-wide element para listar aplicaciones.
pub struct AxClient {
    /// Elemento system-wide: raíz para listar apps.
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
        // Construir options dict con kAXTrustedCheckOptionPrompt = prompt.
        let key = CFString::new("AXTrustedCheckOptionPrompt");
        let value = CFBoolean::from(prompt);
        let options = CFDictionary::from_CFType_pairs(&[(&key, &value)]);

        // AXIsProcessTrustedWithOptions está en accessibility crate.
        unsafe {
            // Llamada directa via FFI — la crate `accessibility` no expone
            // esta función directamente, así que usamos el raw binding.
            extern "C" {
                fn AXIsProcessTrustedWithOptions(
                    options: *const core_foundation::base::CFTypeRef,
                ) -> bool;
            }
            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef() as *const _)
        }
    }

    /// Lista las aplicaciones en ejecución vía NSWorkspace.
    ///
    /// En macOS no hay un "registry" como AT-SPI; usamos
    /// `NSWorkspace::runningApplications` para obtener la lista, y luego
    /// `AXUIElementCreateApplication(pid)` para crear el elemento accessible
    /// de cada una.
    pub fn list_applications(&self) -> Result<Vec<ApplicationInfo>> {
        // Obtener lista de PIDs de apps visibles via NSWorkspace.
        let pids = list_running_application_pids()?;

        let mut apps = Vec::with_capacity(pids.len());
        for pid in pids {
            let app_element = AXUIElement::application(pid);

            // Nombre de la app.
            let name = app_element
                .attribute(&AXUIElementAttributes::title)
                .ok()
                .and_then(|v| cfstring_to_string(&v))
                .unwrap_or_else(|| format!("pid:{pid}"));

            // Count de ventanas top-level.
            let child_count = app_element
                .attribute_count(&AXUIElementAttributes::windows)
                .unwrap_or(0) as i32;

            // En macOS, "bus_name" es el PID como string y "root_path" es
            // un identificador interno (típicamente "app:{pid}").
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
            .attribute(&AXUIElementAttributes::focused_ui_element)
            .map_err(|e| anyhow!("AXFocusedUIElement falló: {e:?}"))?;
        // focused es un CFType que contiene un AXUIElement ref.
        cf_type_to_ax_ui_element(&focused)
            .ok_or_else(|| anyhow!("no se pudo obtener focused element"))
    }

    /// Busca un elemento por su path (formato "app:{pid}" + subpath interno).
    ///
    /// En macOS no hay un "RuntimeId" como en Windows; usamos una
    /// codificación jerárquica "app:PID/child_index/child_index/...".
    pub fn find_by_path(&self, path: &str) -> Result<AXUIElement> {
        // Parsear "app:PID/0/1/2/..."
        let (pid_part, subpath) = path
            .split_once('/')
            .unwrap_or((path, ""));
        let pid: u32 = pid_part
            .strip_prefix("app:")
            .ok_or_else(|| anyhow!("path inválido (debe empezar con 'app:'): {path}"))?
            .parse()
            .with_context(|| format!("PID inválido en path: {path}"))?;

        let app = AXUIElement::application(pid);

        if subpath.is_empty() {
            return Ok(app);
        }

        // Navegar por índices.
        let mut current = app;
        for index_str in subpath.split('/') {
            let index: usize = index_str
                .parse()
                .with_context(|| format!("índice inválido en path: {index_str}"))?;
            let children = current
                .attribute(&AXUIElementAttributes::children)
                .map_err(|e| anyhow!("AXChildren falló: {e:?}"))?;
            let array = cf_type_to_array(&children)
                .ok_or_else(|| anyhow!("AXChildren no es un array"))?;
            current = cf_type_to_ax_ui_element(&array.get(index))
                .ok_or_else(|| anyhow!("índice {index} fuera de rango"))?;
        }
        Ok(current)
    }
}

// ── Helpers para CFType ↔ AXUIElement ─────────────────────────────────────

fn cfstring_to_string(value: &CFType) -> Option<String> {
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
    // AXUIElement es un toll-free bridged con CFTypeRef.
    // Casting directo es seguro según la documentación de macOS.
    unsafe {
        let ptr = value.as_CFTypeRef() as *const accessibility::sys::AXUIElement;
        if ptr.is_null() {
            return None;
        }
        Some(AXUIElement::wrap_under_get_rule(ptr as *mut _))
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

/// Lista los PIDs de las aplicaciones en ejecución vía NSWorkspace.
///
/// Implementación simplificada usando `NSRunningApplication::runningApplicationsWithActivationPolicy:`
/// con `NSApplicationActivationPolicyRegular` (apps con UI visible).
fn list_running_application_pids() -> Result<Vec<u32>> {
    // Esta función requiere bindings objc2-app-kit que están en `appkit/workspace.rs`.
    // Para mantener `ax/` enfocado en Accessibility, delegamos a appkit.
    crate::backend::macos::appkit::workspace::list_running_application_pids()
}
