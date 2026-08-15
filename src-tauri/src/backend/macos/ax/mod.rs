//! Wrapper sobre macOS Accessibility API (AXUIElement).
//!
//! Usa la crate `accessibility` que envuelve ApplicationServices.framework.
//! Requiere permiso de Accessibility (System Settings → Privacy & Security).
//!
//! Nota: La crate `accessibility` 0.2 tiene API ligeramente distinta entre
//! versiones patch. Esta implementación usa las APIs estables:
//!   - AXUIElement::new(CFString) para crear el system-wide element
//!   - AXUIElement::attribute(&self, &cf_str) -> Result<CFArray>
//!   - AXUIElement::set_value(&self, &cf_str, &value)
//!   - AXUIElement::perform_action(&self, &cf_str)
//!
//! Si la crate falla al compilar por diferencias de versión, fijar a
//! `accessibility = "=0.2.4"` en Cargo.toml.

use anyhow::{anyhow, Result};
use accessibility::{AXUIElement, AXValueRef};
use core_foundation::base::{CFType, TCFType};
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::array::CFArray;
use std::ffi::c_void;

use crate::backend::shared_types::{AccessibleNode, Rect, Role};

/// Cliente que envuelve AXUIElement.
pub struct AxClient {
    system_element: AXUIElement,
}

impl AxClient {
    pub fn new() -> Result<Self> {
        // AXUIElement::system returns a system-wide element.
        // Different versions of the crate expose this differently.
        // Fallback: create via `AXUIElement::new` with empty CFString.
        let system_element = AXUIElement::system();
        Ok(Self { system_element })
    }

    /// Verifica permiso de Accessibility. Si `prompt` es true, muestra el
    /// diálogo nativo de System Settings si no hay permiso.
    pub fn check_permission(prompt: bool) -> bool {
        // `accessibility` crate 0.2 expone `AXIsProcessTrustedWithOptions`.
        unsafe {
            let opts = if prompt {
                let key = CFString::new("AXTrustedCheckOptionPrompt");
                // kCFBooleanTrue — usar core_foundation::boolean::CFBoolean
                let val: *const c_void = core_foundation::boolean::CFBoolean::true_value()
                    .as_concrete_TypeRef() as *const c_void;
                Some(core_foundation::dictionary::CFDictionary::from_CFType_pairs(&[(
                    key.as_concrete_TypeRef() as *const c_void,
                    val,
                )]))
            } else {
                None
            };

            // Llamar a la función CoreGraphics directamente.
            extern "C" {
                fn AXIsProcessTrustedWithOptions(options: *mut c_void) -> bool;
            }
            let opts_ptr = opts
                .as_ref()
                .map(|d| d.as_concrete_TypeRef() as *mut c_void)
                .unwrap_or(std::ptr::null_mut());
            AXIsProcessTrustedWithOptions(opts_ptr)
        }
    }

    /// Lista las aplicaciones accesibles (vía atributo kAXFocusedApplicationAttribute
    /// del system element + NSWorkspace).
    pub fn list_applications(&self) -> Result<Vec<crate::backend::shared_types::ApplicationInfo>> {
        // Por simplicidad, delegamos a appkit::workspace.
        crate::backend::macos::appkit::list_running_applications()
    }

    /// Construye el árbol de accesibilidad desde un elemento raíz.
    pub fn read_node(&self, element: &AXUIElement, max_depth: u32) -> Result<AccessibleNode> {
        read_node_recursive(element, 0, max_depth)
    }

    /// Obtiene el elemento con foco.
    pub fn focused_element(&self) -> Result<AXUIElement> {
        let key = CFString::new("AXFocusedApplication");
        let val = self
            .system_element
            .attribute(&key)
            .map_err(|e| anyhow!("AXFocusedApplication: {:?}", e))?;
        // val es un CFType que debería ser AXUIElement.
        // AXUIElement en la crate 0.2 es un wrapper sobre CFType.
        let element = unsafe { AXUIElement::from_void(*val.as_CFTypeRef() as *mut c_void) };
        Ok(element)
    }

    /// Realiza la acción "AXPress" en un elemento.
    pub fn press(&self, element: &AXUIElement) -> Result<()> {
        let action = CFString::new("AXPress");
        element
            .perform_action(&action)
            .map_err(|e| anyhow!("AXPress: {:?}", e))
    }

    /// Establece el valor de un elemento (AXValue).
    pub fn set_value(&self, element: &AXUIElement, value: &str) -> Result<()> {
        let key = CFString::new("AXValue");
        let cf_value = CFString::new(value);
        element
            .set_value(&key, &cf_value)
            .map_err(|e| anyhow!("AXValue set: {:?}", e))
    }

    /// Obtiene el valor (texto) de un elemento.
    pub fn get_value(&self, element: &AXUIElement) -> Result<Option<String>> {
        let key = CFString::new("AXValue");
        match element.attribute(&key) {
            Ok(val) => {
                if val.as_CFTypeRef().is_null() {
                    return Ok(None);
                }
                let s = unsafe {
                    let cf_str = val.as_CFTypeRef() as *const core_foundation::string::__CFString;
                    if cf_str.is_null() {
                        return Ok(None);
                    }
                    CFString::wrap_under_create_rule(cf_str).to_string()
                };
                Ok(Some(s))
            }
            Err(_) => Ok(None),
        }
    }
}

/// Recursivamente construye un AccessibleNode desde un AXUIElement.
fn read_node_recursive(element: &AXUIElement, depth: u32, max_depth: u32) -> Result<AccessibleNode> {
    let role_str = get_attribute_string(element, "AXRole").unwrap_or_default();
    let title = get_attribute_string(element, "AXTitle").unwrap_or_default();
    let desc = get_attribute_string(element, "AXHelp").unwrap_or_default();
    let position = get_position(element);
    let size = get_size(element);
    let text = get_attribute_string(element, "AXValue").unwrap_or_default();
    let actions = get_actions(element);

    let role = map_role(&role_str);

    let mut children = Vec::new();
    if depth < max_depth {
        if let Ok(children_arr) = get_children(element) {
            for child in children_arr.iter().take(200) {
                if let Ok(child_node) = read_node_recursive(child, depth + 1, max_depth) {
                    children.push(child_node);
                }
            }
        }
    }

    let rect = match (position, size) {
        (Some((x, y)), Some((w, h))) => Some(Rect { x, y, width: w, height: h }),
        _ => None,
    };

    // Construir states desde atributos booleanos comunes.
    let mut states = Vec::new();
    if let Ok(enabled) = element_attribute_bool(element, "AXEnabled") {
        if enabled { states.push("enabled".into()); }
    }
    if let Ok(focused) = element_attribute_bool(element, "AXFocused") {
        if focused { states.push("focused".into()); }
    }
    if let Ok(focusable) = element_attribute_bool(element, "AXFocusable") {
        if focusable { states.push("focusable".into()); }
    }

    // Para NodeRef, usamos un identificador interno basado en AXTitle + AXPosition.
    // macOS no tiene un RuntimeId como Windows; el "path" lo construimos
    // jerárquicamente en find_by_path() (no implementado en esta versión).
    Ok(AccessibleNode {
        path: format!("macos-ax-{:x}", element as *const _ as usize),
        bus_name: String::new(),
        name: title,
        description: desc,
        role,
        role_raw: role_str,
        states,
        rect,
        text: if text.is_empty() { None } else { Some(text) },
        actions,
        children,
    })
}

fn get_attribute_string(element: &AXUIElement, attr: &str) -> Result<String> {
    let key = CFString::new(attr);
    let val = element.attribute(&key).map_err(|e| anyhow!("{}: {:?}", attr, e))?;
    if val.as_CFTypeRef().is_null() {
        return Ok(String::new());
    }
    unsafe {
        let cf_str = val.as_CFTypeRef() as *const core_foundation::string::__CFString;
        if cf_str.is_null() {
            return Ok(String::new());
        }
        Ok(CFString::wrap_under_create_rule(cf_str).to_string())
    }
}

fn element_attribute_bool(element: &AXUIElement, attr: &str) -> Result<bool> {
    let key = CFString::new(attr);
    let val = element.attribute(&key).map_err(|e| anyhow!("{}: {:?}", attr, e))?;
    if val.as_CFTypeRef().is_null() {
        return Ok(false);
    }
    // CFBoolean
    unsafe {
        let cf_bool = val.as_CFTypeRef() as *const core_foundation::boolean::__CFBoolean;
        if cf_bool.is_null() {
            return Ok(false);
        }
        // CFBooleanGetValue existe en core_foundation-sys.
        extern "C" {
            fn CFBooleanGetValue(b: *const core_foundation::boolean::__CFBoolean) -> bool;
        }
        Ok(CFBooleanGetValue(cf_bool))
    }
}

fn get_children(element: &AXUIElement) -> Result<CFArray<AXUIElement>> {
    let key = CFString::new("AXChildren");
    let val = element.attribute(&key).map_err(|e| anyhow!("AXChildren: {:?}", e))?;
    // val es un CFTypeRef que apunta a un CFArray.
    let arr_ref = val.as_CFTypeRef() as *const core_foundation::array::__CFArray;
    if arr_ref.is_null() {
        return Ok(CFArray::from_CFTypes(&[]));
    }
    unsafe {
        // Wrap sin ownership transfer (la ref ya la tiene val).
        let arr = CFArray::<AXUIElement>::wrap_under_get_rule(arr_ref);
        Ok(arr)
    }
}

fn get_position(element: &AXUIElement) -> Option<(i32, i32)> {
    let key = CFString::new("AXPosition");
    let val = element.attribute(&key).ok()?;
    if val.as_CFTypeRef().is_null() {
        return None;
    }
    // AXValue de tipo CGPoint = (x, y) floats.
    let val_ref = val.as_CFTypeRef() as AXValueRef;
    let mut point: CGPoint = CGPoint { x: 0.0, y: 0.0 };
    unsafe {
        // AXValueGetValue existe en ApplicationServices.framework.
        extern "C" {
            fn AXValueGetValue(value: AXValueRef, type_: u32, out: *mut CGPoint) -> bool;
        }
        // kAXValueCGPointType = 1
        if !AXValueGetValue(val_ref, 1, &mut point) {
            return None;
        }
    }
    Some((point.x as i32, point.y as i32))
}

fn get_size(element: &AXUIElement) -> Option<(i32, i32)> {
    let key = CFString::new("AXSize");
    let val = element.attribute(&key).ok()?;
    if val.as_CFTypeRef().is_null() {
        return None;
    }
    let val_ref = val.as_CFTypeRef() as AXValueRef;
    let mut size: CGSize = CGSize { width: 0.0, height: 0.0 };
    unsafe {
        extern "C" {
            fn AXValueGetValue(value: AXValueRef, type_: u32, out: *mut CGSize) -> bool;
        }
        // kAXValueCGSizeType = 2
        if !AXValueGetValue(val_ref, 2, &mut size) {
            return None;
        }
    }
    Some((size.width as i32, size.height as i32))
}

fn get_actions(element: &AXUIElement) -> Vec<String> {
    let key = CFString::new("AXActionNames");
    let val = match element.attribute(&key) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    if val.as_CFTypeRef().is_null() {
        return Vec::new();
    }
    let arr_ref = val.as_CFTypeRef() as *const core_foundation::array::__CFArray;
    if arr_ref.is_null() {
        return Vec::new();
    }
    let mut actions = Vec::new();
    unsafe {
        let arr = CFArray::<CFString>::wrap_under_get_rule(arr_ref);
        for s in arr.iter() {
            actions.push(s.to_string());
        }
    }
    actions
}

#[repr(C)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
struct CGSize {
    width: f64,
    height: f64,
}

/// Mapea AXRole a nuestro enum Role canónico.
fn map_role(ax_role: &str) -> Role {
    match ax_role {
        "AXButton" => Role::PushButton,
        "AXCheckBox" => Role::CheckBox,
        "AXRadioButton" => Role::RadioButton,
        "AXTextField" => Role::Entry,
        "AXTextArea" => Role::Text,
        "AXStaticText" => Role::Label,
        "AXImage" => Role::Image,
        "AXMenu" => Role::Menu,
        "AXMenuItem" => Role::MenuItem,
        "AXMenuBar" => Role::MenuBar,
        "AXMenuBarItem" => Role::MenuItem,
        "AXList" => Role::List,
        "AXRow" => Role::Row,
        "AXColumn" => Role::Column,
        "AXCell" => Role::Cell,
        "AXTable" => Role::Table,
        "AXWindow" => Role::Window,
        "AXApplication" => Role::Application,
        "AXGroup" => Role::Group,
        "AXScrollArea" => Role::ScrollPane,
        "AXSlider" => Role::Slider,
        "AXPopUpButton" => Role::ComboBox,
        "AXComboBox" => Role::ComboBox,
        "AXTab" => Role::Tab,
        "AXTabGroup" => Role::TabGroup,
        "AXLink" => Role::Link,
        "AXProgressIndicator" => Role::ProgressBar,
        _ => Role::Unknown,
    }
}
