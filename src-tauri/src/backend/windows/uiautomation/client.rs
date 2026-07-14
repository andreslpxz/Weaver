//! Cliente UIAutomation: inicializa COM y provee helpers de alto nivel.
//!
//! Esta crate envuelve la API COM `IUIAutomation` de Microsoft. La instancia
//! se crea una sola vez y se reutiliza para todas las operaciones.

use anyhow::{anyhow, Context, Result};
use uiautomation::UIAutomation;
use uiautomation::UIElement;

use crate::backend::shared_types::{ApplicationInfo, Rect};

/// Cliente UIAutomation con la instancia COM raíz.
pub struct UiaClient {
    automation: UIAutomation,
}

impl UiaClient {
    /// Inicializa COM (thread apartment) y crea la instancia IUIAutomation.
    ///
    /// Windows requiere `CoInitializeEx` antes de cualquier llamada COM.
    /// La crate `uiautomation` lo hace internamente, así que solo la creamos.
    pub fn new() -> Result<Self> {
        let automation = UIAutomation::new()
            .map_err(|e| anyhow!("no se pudo inicializar UIAutomation: {e}"))?;
        Ok(Self { automation })
    }

    /// Devuelve el elemento raíz (desktop).
    pub fn root(&self) -> Result<UIElement> {
        self.automation
            .get_root_element()
            .map_err(|e| anyhow!("GetRootElement falló: {e}"))
    }

    /// Devuelve el elemento con foco de teclado actual.
    pub fn focused_element(&self) -> Result<UIElement> {
        self.automation
            .get_focused_element()
            .map_err(|e| anyhow!("GetFocusedElement falló: {e}"))
    }

    /// Lista las aplicaciones (ventanas top-level) registradas.
    ///
    /// En Windows no hay un "registry" como en AT-SPI; enumeramos las ventanas
    /// hijas del desktop que tengan ControlType::Window.
    pub fn list_applications(&self) -> Result<Vec<ApplicationInfo>> {
        let root = self.root()?;
        let children = root
            .get_children()
            .map_err(|e| anyhow!("GetChildren falló: {e}"))?;

        let mut apps = Vec::with_capacity(children.len());
        for child in children {
            // Solo nos interesan las ventanas top-level.
            let control_type = child.get_control_type();
            if control_type != uiautomation::types::ControlType::Window {
                continue;
            }
            let name = child.get_name().unwrap_or_default();
            let pid = child.get_process_id().unwrap_or(0);
            let class_name = child.get_classname().unwrap_or_default();
            let child_count = child
                .get_children()
                .map(|c| c.len() as i32)
                .unwrap_or(0);

            // En Windows, "bus_name" es el PID y "root_path" es el RuntimeId
            // serializado. Esto permite a `NodeRef` ser opaco y portable.
            let bus_name = format!("pid:{}", pid);
            let root_path = runtime_id_to_path(&child)
                .unwrap_or_else(|_| format!("class:{}", class_name));

            apps.push(ApplicationInfo {
                name: if name.is_empty() {
                    class_name
                } else {
                    name
                },
                bus_name,
                root_path,
                pid,
                child_count,
            });
        }
        Ok(apps)
    }

    /// Busca un elemento por su RuntimeId (el `path` de `NodeRef`).
    ///
    /// Como UIAutomation no permite buscar directamente por RuntimeId,
    /// hacemos una búsqueda desde la raíz. Esto es O(n) pero suficiente
    /// para el MVP. En el futuro podemos cachear elementos por ID.
    pub fn find_by_path(&self, path: &str) -> Result<UIElement> {
        let root = self.root()?;
        find_element_by_runtime_id(&root, path)
            .ok_or_else(|| anyhow!("elemento con path {:?} no encontrado", path))
    }

    /// Devuelve la instancia UIAutomation subyacente (para uso de tree.rs).
    pub fn inner(&self) -> &UIAutomation {
        &self.automation
    }
}

/// Convierte el RuntimeId de un elemento a un string path portable.
///
/// El RuntimeId es un `Vec<i32>` (ej. `[42, 1234567]`). Lo serializamos
/// como "42:1234567" para usar como `path` en `NodeRef`.
pub fn runtime_id_to_path(element: &UIElement) -> Result<String> {
    let ids = element
        .get_runtime_id()
        .map_err(|e| anyhow!("GetRuntimeId falló: {e}"))?;
    Ok(ids
        .iter()
        .map(|i| i.to_string())
        .collect::<Vec<_>>()
        .join(":"))
}

/// Busca recursivamente un elemento por RuntimeId path.
///
/// Hace BFS limitado para evitar explosión de búsqueda en árboles grandes.
fn find_element_by_runtime_id(root: &UIElement, target_path: &str) -> Option<UIElement> {
    use std::collections::VecDeque;

    let mut queue: VecDeque<UIElement> = VecDeque::new();

    // Comprobar la raíz primero.
    if let Ok(id) = runtime_id_to_path(root) {
        if id == target_path {
            return Some(root.clone());
        }
    }

    // Añadir hijos directos.
    if let Ok(children) = root.get_children() {
        for child in children {
            queue.push_back(child);
        }
    }

    // BFS con límite de nodos visitados para evitar hangs en árboles enormes.
    let mut visited = 0usize;
    const MAX_VISITS: usize = 10_000;

    while let Some(elem) = queue.pop_front() {
        visited += 1;
        if visited > MAX_VISITS {
            tracing::warn!(
                "find_by_path: alcanzado límite de {} nodos, abortando",
                MAX_VISITS
            );
            return None;
        }

        if let Ok(id) = runtime_id_to_path(&elem) {
            if id == target_path {
                return Some(elem);
            }
        }

        if let Ok(children) = elem.get_children() {
            for child in children {
                queue.push_back(child);
            }
        }
    }

    None
}

/// Convierte un Rect de uiautomation a nuestro Rect compartido.
pub fn uia_rect_to_rect(rect: uiautomation::types::Rect) -> Rect {
    Rect {
        x: rect.get_left(),
        y: rect.get_top(),
        width: rect.get_width(),
        height: rect.get_height(),
    }
}
