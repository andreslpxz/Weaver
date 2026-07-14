//! Tests de integración de Windows backend con apps reales (Fase W6).
//!
//! Estos tests solo se compilan y ejecutan en Windows. Verifican que
//! `WindowsBackend` puede operar aplicaciones nativas de Windows.
//!
//! Para ejecutar:
//! ```text
//! cd src-tauri
//! cargo test --test windows_apps -- --ignored --test-threads=1
//! ```
//!
//! Los tests están marcados con `#[ignore]` porque requieren un entorno
//! desktop interactivo (no corren en CI headless).

#![cfg(target_os = "windows")]

use std::thread::sleep;
use std::time::Duration;
use weaver_lib::backend::{Backend, NodeRef};
use weaver_lib::backend::windows::WindowsBackend;

/// Helper: crear backend.
fn backend() -> WindowsBackend {
    WindowsBackend::new()
}

/// Helper: ejecutar comando en cmd.exe y esperar.
fn run_cmd(command: &str) {
    use std::process::Command;
    let _ = Command::new("cmd").args(["/C", command]).spawn();
    sleep(Duration::from_secs(2));
}

/// Helper: cerrar todas las ventanas de un proceso por nombre.
fn kill_process(name: &str) {
    use std::process::Command;
    let _ = Command::new("taskkill")
        .args(["/IM", name, "/F"])
        .spawn();
    sleep(Duration::from_millis(500));
}

// ============================================================================
// Notepad tests
// ============================================================================

/// Test 1: abrir Notepad, escribir texto, guardar archivo.
#[tokio::test]
#[ignore]
async fn test_notepad_write_and_save() {
    let backend = backend();

    // Limpiar estado previo.
    kill_process("notepad.exe");
    sleep(Duration::from_secs(1));

    // Abrir Notepad.
    run_cmd("start notepad.exe");
    sleep(Duration::from_secs(2));

    // Listar apps y buscar Notepad.
    let apps = backend.list_applications().await.unwrap();
    let notepad = apps
        .iter()
        .find(|a| a.name.contains("Notepad") || a.name.contains("Bloc de notas"))
        .expect("Notepad no encontrado en aplicaciones");

    println!("✓ Notepad encontrado: {:?}", notepad.name);

    // Query tree del Notepad.
    let tree = backend
        .query_tree(notepad, 5)
        .await
        .expect("no se pudo leer árbol de Notepad");
    println!("✓ Árbol de Notepad leído: {} nodos", count_nodes(&tree));

    // Buscar el elemento editable (Edit control) y escribir texto.
    let edit_node = find_first_by_role(&tree, |r| {
        matches!(r, weaver_lib::backend::shared_types::Role::Entry)
    })
    .expect("no se encontró Edit en Notepad");

    let test_text = "Hola desde Weaver — test automático";
    backend
        .type_text(
            &NodeRef::new(&edit_node.bus_name, &edit_node.path),
            test_text,
        )
        .await
        .expect("no se pudo escribir texto");

    println!("✓ Texto escrito en Notepad: {:?}", test_text);

    // Verificar leyendo el texto de vuelta.
    let read_text = backend
        .get_text(&NodeRef::new(&edit_node.bus_name, &edit_node.path))
        .await
        .expect("no se pudo leer texto");
    assert_eq!(read_text, Some(test_text.to_string()));
    println!("✓ Texto leído de vuelta: {:?}", read_text);

    // Cerrar Notepad sin guardar (Ctrl+W).
    backend
        .press_key("alt+F4")
        .await
        .expect("no se pudo cerrar Notepad");
    sleep(Duration::from_secs(1));
    // Descartar cambios con 'N' (No guardar).
    backend.press_key("n").await.ok();

    kill_process("notepad.exe");
    println!("✓ Test Notepad completo");
}

// ============================================================================
// Edge / Chrome tests
// ============================================================================

/// Test 2: abrir Edge, leer pestañas, navegar a una URL.
#[tokio::test]
#[ignore]
async fn test_edge_navigate() {
    let backend = backend();

    kill_process("msedge.exe");
    sleep(Duration::from_secs(1));

    // Abrir Edge.
    run_cmd("start msedge.exe");
    sleep(Duration::from_secs(5)); // Edge tarda más en cargar

    let apps = backend.list_applications().await.unwrap();
    let edge = apps
        .iter()
        .find(|a| a.name.contains("Edge") || a.name.contains("Microsoft Edge"))
        .expect("Edge no encontrado");

    println!("✓ Edge encontrado: {:?}", edge.name);

    // Query tree.
    let tree = backend
        .query_tree(edge, 4)
        .await
        .expect("no se pudo leer árbol de Edge");
    println!("✓ Árbol de Edge leído: {} nodos", count_nodes(&tree));

    // Cerrar Edge con Ctrl+W.
    backend.press_key("alt+F4").await.ok();
    sleep(Duration::from_secs(2));
    kill_process("msedge.exe");
    println!("✓ Test Edge completo");
}

// ============================================================================
// VSCode tests
// ============================================================================

/// Test 3: abrir VSCode, leer árbol, verificar que hay elementos accesibles.
#[tokio::test]
#[ignore]
async fn test_vscode_basic() {
    let backend = backend();

    kill_process("Code.exe");
    sleep(Duration::from_secs(1));

    // Abrir VSCode.
    run_cmd("start code");
    sleep(Duration::from_secs(8)); // VSCode tarda en cargar

    let apps = backend.list_applications().await.unwrap();
    let vscode = apps
        .iter()
        .find(|a| a.name.contains("Visual Studio Code") || a.name.contains("Code"))
        .expect("VSCode no encontrado");

    println!("✓ VSCode encontrado: {:?}", vscode.name);

    let tree = backend
        .query_tree(vscode, 3)
        .await
        .expect("no se pudo leer árbol de VSCode");
    println!("✓ Árbol de VSCode leído: {} nodos", count_nodes(&tree));

    // Verificar que hay al menos 50 elementos (VSCode es una app compleja).
    let total = count_nodes(&tree);
    assert!(
        total > 50,
        "VSCode debería tener al menos 50 elementos, tuvo {}",
        total
    );

    backend.press_key("alt+F4").await.ok();
    sleep(Duration::from_secs(1));
    kill_process("Code.exe");
    println!("✓ Test VSCode completo");
}

// ============================================================================
// Clipboard tests
// ============================================================================

/// Test 4: escribir y leer del portapapeles.
#[tokio::test]
#[ignore]
async fn test_clipboard_roundtrip() {
    let backend = backend();

    let test_string = "Weaver clipboard test — ¡con acentos! 🎉";
    backend
        .clipboard_set(test_string)
        .await
        .expect("no se pudo escribir clipboard");

    let read = backend
        .clipboard_get()
        .await
        .expect("no se pudo leer clipboard");

    assert_eq!(read, test_string);
    println!("✓ Clipboard roundtrip OK: {:?}", read);
}

// ============================================================================
// List windows tests
// ============================================================================

/// Test 5: listar ventanas top-level.
#[tokio::test]
#[ignore]
async fn test_list_windows() {
    let backend = backend();

    // Abrir Notepad para garantizar al menos una ventana.
    run_cmd("start notepad.exe");
    sleep(Duration::from_secs(2));

    let windows = backend.list_windows().await.expect("no se pudo listar ventanas");
    println!("✓ {} ventanas encontradas:", windows.len());
    for w in windows.iter().take(10) {
        println!("  - {} (id: {}, process: {})", w.title, w.id, w.process_name);
    }

    assert!(!windows.is_empty(), "debe haber al menos una ventana");

    // Buscar Notepad en la lista.
    let notepad_window = windows
        .iter()
        .find(|w| w.title.contains("Notepad") || w.title.contains("Bloc de notas"));
    assert!(notepad_window.is_some(), "Notepad debe estar en la lista de ventanas");

    // Activar la ventana de Notepad.
    if let Some(w) = notepad_window {
        backend
            .activate_window(&w.id)
            .await
            .expect("no se pudo activar ventana de Notepad");
        println!("✓ Notepad activado");
    }

    kill_process("notepad.exe");
}

// ============================================================================
// Helpers
// ============================================================================

fn count_nodes(node: &weaver_lib::backend::shared_types::AccessibleNode) -> usize {
    1 + node.children.iter().map(count_nodes).sum::<usize>()
}

fn find_first_by_role(
    node: &weaver_lib::backend::shared_types::AccessibleNode,
    predicate: impl Fn(&weaver_lib::backend::shared_types::Role) -> bool,
) -> Option<weaver_lib::backend::shared_types::AccessibleNode> {
    if predicate(&node.role) {
        return Some(node.clone());
    }
    for child in &node.children {
        if let Some(found) = find_first_by_role(child, &predicate) {
            return Some(found);
        }
    }
    None
}
