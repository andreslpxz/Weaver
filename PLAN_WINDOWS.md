# Weaver — Plan de Windows

> Extiende Weaver a **Windows 10/11** usando **UIAutomation** (API de accesibilidad nativa de Microsoft) en lugar de AT-SPI.
>
> **Stack adicional:** Rust + `uiautomation` crate (wrapper sobre `UIAutomationClient` COM) + `windows` crate (Win32 APIs) + `enigo` (input sintético).

---

## 0. Visión para Windows

Weaver en Windows será capaz de:

- Leer el árbol de accesibilidad de cualquier app nativa (Win32, WPF, WinForms, Electron, Edge WebView2, Firefox, Chrome) vía **UIAutomation**.
- Clickear, escribir, leer texto, focar, obtener bounding boxes de elementos.
- Emular teclado y ratón vía `SendInput` (mucho más confiable que `xdotool`).
- Operar el portapapeles vía `OpenClipboard`/`GetClipboardData`.
- Listar y activar ventanas vía `EnumWindows`/`SetForegroundWindow`.
- Almacenar API keys en **Windows Credential Manager** (la crate `keyring` ya lo soporta).

La UI de Tauri se ve **pixel-perfect idéntica** en Windows porque usa WebView2 (Chromium). El frontend no necesita ni una línea nueva.

---

## 1. Decisiones técnicas

### 1.1. UIAutomation wrapper

| Opción | Pros | Contras | Decisión |
|--------|------|---------|----------|
| `uiautomation` crate (purpos-built) | API idiomática Rust, cubre IUIAutomation/IUIAutomationElement/IUIAutomationTreeWalker | Mantenimiento community | ✅ **Primaria** |
| `windows` crate con bindings COM directos | Acceso total a la API oficial de Microsoft | Verboso, código unsafe extenso | Fallback |
| IronPython + pywinauto | Rápido de prototipar | Dependencia Python, peor perf | ❌ Descartado |

Elegimos `uiautomation` (https://crates.io/crates/uiautomation) como wrapper principal, y `windows` crate para los APIs Win32 que no cubre (`SendInput`, clipboard, `EnumWindows`).

### 1.2. Mapeo de tipos UIAutomation → tipos compartidos

Los tipos `AccessibleNode`, `ApplicationInfo`, `Rect`, `Role`, `StateSet` ya están definidos en `atspi/types.rs`. Windows solo necesita:

- Implementar el trait `Backend` (ver sección 2.1) para devolver los mismos tipos.
- Mapear `ControlType` UIAutomation → `Role` canónico:
  - `ButtonControlType` → `PushButton`
  - `EditControlType` → `Entry`
  - `TextControlType` → `Text`
  - `ListItemControlType` → `ListItem`
  - `MenuItemControlType` → `MenuItem`
  - etc.
- Mapear propiedades UIAutomation a `StateSet`:
  - `IsEnabled` → `enabled`
  - `HasKeyboardFocus` → `focused`
  - `IsKeyboardFocusable` → `focusable`
  - `IsPassword` → `password`
  - `IsOffscreen` → (excluir)

### 1.3. Input sintético

Usaremos **`enigo`** crate (cross-platform, ya soporta Win32 `SendInput` bajo el hood). Cubre:

- `key_sequence(...)` para escribir texto
- `key_click(Key::Control)` para combos
- `mouse_move_to(x, y)` + `mouse_click(MouseButton::Left)`

Como backup, si enigo falla en algún caso edge (UAC prompts, etc.), llamadas directas a `SendInput` vía `windows` crate.

### 1.4. Empaquetado

| Formato | Uso | Herramienta |
|---------|-----|-------------|
| `.msi` | Instalador corporativo | WiX + `tauri-build` |
| `.exe` (NSIS) | Instalador estándar | Tauri NSIS bundler |
| `.appx` | Microsoft Store (futuro) | `tauri build` con `--target universal-windows-platform` (TODO) |

Tauri v2 ya soporta NSIS y MSI out of the box. Code signing con `signtool.exe` requerido para evitar SmartScreen warnings.

---

## 2. Arquitectura del backend Windows

### 2.1. Trait común (refactor)

Para abstraer Linux/Windows/macOS, definimos un trait `Backend` en un nuevo módulo `backend/`:

```rust
// src-tauri/src/backend/mod.rs
#[async_trait]
pub trait Backend: Send + Sync {
    async fn list_applications(&self) -> Result<Vec<ApplicationInfo>>;
    async fn query_tree(&self, app: &ApplicationInfo, max_depth: u32) -> Result<AccessibleNode>;
    async fn get_focused_subtree(&self, max_depth: u32) -> Result<Option<AccessibleNode>>;
    async fn click(&self, node: &NodeRef) -> Result<()>;
    async fn double_click(&self, node: &NodeRef) -> Result<()>;
    async fn type_text(&self, node: &NodeRef, text: &str) -> Result<()>;
    async fn press_key(&self, key: &str) -> Result<()>;
    async fn get_text(&self, node: &NodeRef) -> Result<Option<String>>;
    async fn get_extents(&self, node: &NodeRef) -> Result<Rect>;
    async fn focus(&self, node: &NodeRef) -> Result<()>;
    // automation
    async fn clipboard_get(&self) -> Result<String>;
    async fn clipboard_set(&self, content: &str) -> Result<()>;
    async fn list_windows(&self) -> Result<Vec<WindowInfo>>;
    async fn activate_window(&self, id_or_title: &str) -> Result<()>;
    async fn key_tap(&self, key: &str) -> Result<()>;
    async fn mouse_click_at(&self, x: i32, y: i32, button: u8) -> Result<()>;
}

pub struct NodeRef {
    pub bus_name: String,  // En Windows: proceso HWND como string
    pub path: String,      // En Windows: runtimeId serializado
}
```

Implementaciones:
- `LinuxBackend` (envuelve el `AtspiClient` + automation actuales)
- `WindowsBackend` (envuelve `uiautomation` + `enigo` + `windows`)
- `MacosBackend` (envuelve `accessibility` + `core-graphics`)

`commands.rs` se reescribe para delegar al `Backend` activo según `cfg!(target_os)`.

### 2.2. Estructura de carpetas

```
src-tauri/src/
├── backend/
│   ├── mod.rs           # trait Backend + factory cfg-based
│   ├── linux.rs         # LinuxBackend (envuelve atspi + automation existentes)
│   ├── windows.rs       # WindowsBackend (NUEVO)
│   └── macos.rs         # MacosBackend (futuro)
├── uiautomation/        # NUEVO — wrapper sobre Microsoft UIAutomation
│   ├── mod.rs
│   ├── client.rs        # UiaClient: conexión COM inicial
│   ├── tree.rs          # query_tree recursivo con TreeWalker
│   ├── types.rs         # Conversión ControlType → Role
│   └── actions.rs       # click, type_text, get_text, focus vía InvokePattern/ValuePattern
├── atspi/               # existente — Linux
├── automation/          # existente — Linux
├── win32/               # NUEVO — APIs Win32 que no cubre UIAutomation
│   ├── mod.rs
│   ├── input.rs         # SendInput (keyboard/mouse) — fallback de enigo
│   ├── clipboard.rs     # OpenClipboard / GetClipboardData
│   └── windows.rs       # EnumWindows / SetForegroundWindow
├── commands.rs          # refactored para usar trait Backend
├── db/                  # sin cambios
├── keyring/             # sin cambios (ya soporta Windows)
└── tools/               # sin cambios
```

### 2.3. Dependencias Cargo (target Windows)

```toml
[target.'cfg(target_os = "windows")'.dependencies]
uiautomation = "0.16"          # UIAutomation wrapper
windows = { version = "0.58", features = [
    "Win32_Foundation",
    "Win32_UI_Input_KeyboardAndMouse",   # SendInput
    "Win32_UI_WindowsAndMessaging",       # EnumWindows, SetForegroundWindow
    "Win32_System_DataExchange",          # Clipboard API
    "Win32_System_Ole",
    "Win32_System_Com",
] }
enigo = "0.2"                  # Cross-platform input synth (usa SendInput en Windows)
```

---

## 3. Plan de fases Windows

### Fase W1 — Trait Backend + refactor (1-2 sesiones)

- [ ] Crear `backend/mod.rs` con trait `Backend` y `NodeRef`
- [ ] Mover `atspi` + `automation` bajo `LinuxBackend`
- [ ] Refactorizar `commands.rs` para usar `app.state::<Box<dyn Backend>>`
- [ ] Tests: verificar que Linux MVP sigue funcionando

### Fase W2 — UIAutomation wrapper (3-4 sesiones)

- [ ] Crear `uiautomation/client.rs`: inicialización COM (`CoInitializeEx`) + `IUIAutomation` instance
- [ ] `list_applications()`: usar `GetGUIThreadInfo` + `EnumWindows` para listar ventanas top-level, mapear a `ApplicationInfo`
- [ ] `query_tree()`: usar `IUIAutomationTreeWalker::GetFirstChildElement` recursivo
- [ ] Mapear `ControlType` → `Role` (tabla en `uiautomation/types.rs`)
- [ ] Mapear propiedades (`Name`, `HelpText`, `BoundingRectangle`, `IsEnabled`, `HasKeyboardFocus`) a `AccessibleNode`
- [ ] Limitar profundidad con `max_depth` para evitar árboles gigantes (Electron)
- [ ] Tests con: Notepad, Calculadora, Edge, VSCode

### Fase W3 — Acciones sobre elementos (2 sesiones)

- [ ] `click(node)`: usar `InvokePattern` si disponible, fallback `SendInput` con coords de `BoundingRectangle`
- [ ] `type_text(node, text)`: usar `ValuePattern::SetValue` si disponible, fallback clic + `SendInput` keyboard
- [ ] `press_key(key)`: usar `enigo` directo
- [ ] `get_text(node)`: usar `ValuePattern::CurrentValue` o `TextPattern::GetVisibleRanges`
- [ ] `get_extents(node)`: `CurrentBoundingRectangle` → `Rect`
- [ ] `focus(node)`: `SetFocus()` en el elemento

### Fase W4 — Automation Win32 (2 sesiones)

- [ ] `clipboard_get/set`: `OpenClipboard` + `GetClipboardData(CF_UNICODETEXT)` + `GlobalLock`
- [ ] `list_windows`: `EnumWindows` callback → filtrar visibles → `WindowInfo { id: hwnd, title, class_name }`
- [ ] `activate_window`: `SetForegroundWindow` + `AllowSetForegroundWindow(ASFW_ANY)`
- [ ] `mouse_click_at(x, y, button)`: `SetCursorPos` + `mouse_event` (o `SendInput` con `MOUSEINPUT`)

### Fase W5 — Empaquetado + CI (2 sesiones)

- [ ] `tauri.conf.json`: añadir `windows` config (NSIS installer, icono `.ico`)
- [ ] GitHub Actions workflow `build-windows.yml`:
  - `windows-latest` runner
  - `cargo build --release`
  - `tauri build` produce `.msi` y `.exe` NSIS
  - Upload artifact
- [ ] Code signing opcional con cert EV (en otro PR)

### Fase W6 — Tests con apps reales (2 sesiones)

- [ ] Notepad: abrir, escribir, guardar
- [ ] Edge: leer pestañas, navegar
- [ ] VSCode: abrir archivo, editar
- [ ] File Explorer: navegar carpetas
- [ ] Calculadora: operaciones básicas
- [ ] Documentar compatibilidad en `PROGRESS.md`

---

## 4. Permisos y consideraciones Windows

### 4.1. Sin permisos especiales para UIAutomation
UIAutomation no requiere elevación. Cualquier proceso del usuario puede leer el árbol de accesibilidad de cualquier app del mismo usuario.

### 4.2. Limitaciones conocidas
- **UAC prompts (Secure Desktop)**: Weaver no puede leer ni interactuar con el escritorio seguro (altamente restringido por diseño de Windows).
- **Apps con UI Hardening**: algunos apps de banking/screen-lockers deshabilitan UIAutomation explícitamente. Detectar y reportar.
- **Electron con `disableHardwareAcceleration`**: a veces expone menos elementos. Solución: sugerir `--force-renderer-accessibility` flag en la app Electron.
- **Chrome/Edge**: necesitan `--force-renderer-accessibility=true` para exponer árbol completo.

### 4.3. Antivirus / Defender
- `SendInput` puede ser marcado como keylogger por AVs agresivos. Solución: firmar el binario y/o documentar exclusiones.
- No requiere driver kernel (a diferencia de macOS con kext).

### 4.4. Code Signing
Para evitar warnings de SmartScreen:
- Certificado de code signing EV (~$300/año con DigiCert/Sectigo)
- `signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a target/release/weaver.exe`

Sin firma, SmartScreen mostrará "Windows protected your PC" la primera vez. Funciona, pero espanta usuarios.

---

## 5. Comparativa rápida Linux vs Windows

| Aspecto | Linux | Windows |
|---------|-------|---------|
| API accesibilidad | AT-SPI2 / D-Bus | UIAutomation COM |
| Wrapper Rust | `zbus` (manual) | `uiautomation` crate |
| Input sintético | `x11rb` / `wtype` (Wayland) | `SendInput` / `enigo` |
| Clipboard | `xclip` / `wl-clipboard` | Win32 Clipboard API |
| Ventanas | `wmctrl` (X11) | `EnumWindows` |
| Keyring | libsecret | Credential Manager |
| Permisos especiales | gsettings toolkit-accessibility | Ninguno |
| Limitaciones | Wayland sintético | Secure Desktop (UAC) |
| Empaquetado | `.deb`, `.AppImage`, `.rpm` | `.msi`, `.exe` NSIS |

---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| `uiautomation` crate inmaduro | Fallback a `windows` crate con bindings directos (más verboso) |
| Electron con accesibilidad desactivada | Documentar flag `--force-renderer-accessibility` |
| Apps antiguas (Win32 puro) exponen poco árbol | Detectar y degradar: ofrecer modo screenshot+VLM en futuro |
| Smartscreen bloquea binario sin firma | Documentar; ofrecer versión firmada en release |
| `SendInput` marcado como keylogger | Firmar binario; documentar exclusiones AV |

---

## 7. Criterios de "MVP Windows"

El MVP Windows se considera listo cuando:

1. Weaver arranca en Windows 11 sin errores
2. El usuario configura API key de OpenAI/Anthropic/Ollama
3. Pide: *"Abre Notepad y escribe 'Hola desde Weaver', guarda en `~/weaver-test.txt`"*
4. Ve al agente planificar, ejecutar cada paso vía UIAutomation, verificar y reportar
5. El log episódico se persiste en SQLite local
6. El instalador `.exe` se genera en CI sin firma (con warning de SmartScreen)

---

## 8. Estado actual

- [ ] **No implementado** — pendiente iniciar Fase W1 (trait Backend)
- [ ] UI ya funciona en Windows (Tauri compila cross-platform sin cambios)
- [ ] Frontend 100% reusable
- [ ] `keyring` ya soporta Credential Manager (sin cambios)
- [ ] SQLite cross-platform (sin cambios)

**Estimación total**: 12-14 sesiones para MVP Windows completo.
