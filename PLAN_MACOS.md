# Weaver — Plan de macOS

> Extiende Weaver a **macOS 13+ (Ventura/Sonoma/Sequoia)** usando **Accessibility API** (`AXUIElement`) en lugar de AT-SPI.
>
> **Stack adicional:** Rust + `accessibility` crate (bindings a `ApplicationServices.framework`) + `core-graphics` (CGEvent para input sintético) + `cocoa`/`objc` (AppKit para ventanas).

---

## 0. Visión para macOS

Weaver en macOS será capaz de:

- Leer el árbol de accesibilidad de cualquier app nativa (AppKit, SwiftUI, Electron, Chrome, Firefox, VSCode) vía **AXUIElement**.
- Clickear, escribir, leer texto, focar, obtener bounding boxes de elementos.
- Emular teclado y ratón vía **CGEvent** (Core Graphics).
- Operar el portapapeles vía `NSPasteboard`.
- Listar y activar ventanas vía `NSWorkspace`.
- Almacenar API keys en **Keychain** (la crate `keyring` ya lo soporta).

La UI de Tauri se ve **pixel-perfect idéntica** en macOS porque usa WKWebView (Safari). El frontend no necesita ni una línea nueva.

---

## 1. Decisiones técnicas

### 1.1. Accessibility API wrapper

| Opción | Pros | Contras | Decisión |
|--------|------|---------|----------|
| `accessibility` crate | Bindings Rust a AXUIElement | Mantenimiento community, API algo limitada | ✅ **Primaria** |
| `objc` crate + bindings manuales a `ApplicationServices.framework` | Acceso total | Muy verboso, mucho unsafe | Fallback para casos edge |
| `screenplain` / `appscript` (AppleScript bridge) | Sencillo | Performance pobre, dependencia de osascript | ❌ Descartado |

Usaremos `accessibility` crate (https://crates.io/crates/accessibility) y complementaremos con `objc2` para APIs no cubiertas (NSWorkspace, NSPasteboard).

### 1.2. Mapeo de tipos AXUIElement → tipos compartidos

Los tipos `AccessibleNode`, `ApplicationInfo`, `Rect`, `Role`, `StateSet` ya están definidos en `atspi/types.rs`. macOS solo necesita:

- Implementar el trait `Backend` (ver `PLAN_WINDOWS.md` sección 2.1) para devolver los mismos tipos.
- Mapear `AXRole` strings a `Role` canónico:
  - `"AXButton"` → `PushButton`
  - `"AXTextField"` → `Entry`
  - `"AXTextArea"` → `Text`
  - `"AXStaticText"` → `Label`
  - `"AXMenu"` → `Menu`
  - `"AXMenuItem"` → `MenuItem`
  - `"AXList"` → `List`
  - `"AXRow"` → `ListItem`
  - etc.
- Mapear atributos AX a `StateSet`:
  - `AXEnabled` → `enabled`
  - `AXFocused` → `focused`
  - `AXFocusedUIElement` (comparison) → `focusable`

### 1.3. Input sintético

Usaremos **`enigo`** crate (usa CGEvent en macOS). Cubre:

- `key_sequence(...)` para escribir texto
- `key_click(Key::Control)` para combos (con Command en macOS)
- `mouse_move_to(x, y)` + `mouse_click(MouseButton::Left)`

**Importante**: CGEvent requiere que Weaver tenga permiso de **Accessibility** en System Settings → Privacy & Security. macOS lo pide la primera vez que la app intenta enviar input sintético. Sin este permiso, los eventos se descartan silenciosamente.

### 1.4. Empaquetado

| Formato | Uso | Herramienta |
|---------|-----|-------------|
| `.dmg` | Distribución estándar | `tauri build` con `app` bundle + create-dmg |
| `.pkg` | Corporativo | productbuild (futuro) |
| App Store (futuro) | Masivo | Requiere sandbox + entitlements limitados |

Tauri v2 produce `.app` + `.dmg` out of the box. Code signing con `codesign` y notarización con `xcrun notarytool` requeridos para distribución fuera del App Store.

---

## 2. Arquitectura del backend macOS

### 2.1. Trait común (mismo que Windows)

Ver sección 2.1 de `PLAN_WINDOWS.md`. macOS implementa `MacosBackend` con el mismo trait `Backend`.

### 2.2. Estructura de carpetas

```
src-tauri/src/
├── backend/
│   ├── mod.rs           # trait Backend + factory cfg-based
│   ├── linux.rs         # LinuxBackend
│   ├── windows.rs       # WindowsBackend
│   └── macos.rs         # MacosBackend (NUEVO)
├── ax/                  # NUEVO — wrapper sobre macOS Accessibility API
│   ├── mod.rs
│   ├── client.rs        # AxClient: conexión al sistema AX
│   ├── tree.rs          # query_tree recursivo con AXChildren
│   ├── types.rs         # Conversión AXRole → Role
│   └── actions.rs       # click, type_text, get_text, focus vía AXPress/AXSetValue
├── atspi/               # existente — Linux
├── automation/          # existente — Linux
├── uiautomation/        # (futuro) — Windows
├── appkit/              # NUEVO — APIs AppKit que no cubre Accessibility
│   ├── mod.rs
│   ├── input.rs         # CGEvent (keyboard/mouse) — fallback de enigo
│   ├── clipboard.rs     # NSPasteboard
│   └── workspace.rs     # NSWorkspace (listar/activar apps y ventanas)
├── commands.rs          # refactored para usar trait Backend
├── db/                  # sin cambios
├── keyring/             # sin cambios (ya soporta Keychain)
└── tools/               # sin cambios
```

### 2.3. Dependencias Cargo (target macOS)

```toml
[target.'cfg(target_os = "macos")'.dependencies]
accessibility = "0.2"          # AXUIElement bindings
objc2 = "0.5"                  # Objective-C runtime
objc2-app-kit = { version = "0.2", features = [
    "NSPasteboard",
    "NSWorkspace",
    "NSRunningApplication",
    "NSScreen",
] }
objc2-core-graphics = "0.2"    # CGEvent para input sintético
enigo = "0.2"                  # Wrapper cross-platform (usa CGEvent en macOS)
core-foundation = "0.10"       # CFString, CFArray bindings
```

---

## 3. Permisos macOS — CRÍTICO

macOS tiene **3 permisos diferentes** que Weaver necesita:

### 3.1. Permiso de Accessibility (requerido)

- **Para qué**: leer árbol AXUIElement de otras apps + enviar CGEvent (teclado/ratón sintético).
- **Cómo se pide**: la primera vez que Weaver llama a `AXIsProcessTrustedWithOptions` o envía un CGEvent, macOS muestra un diálogo pidiendo al usuario ir a System Settings.
- **Sin este permiso**: Weaver NO puede funcionar. Es bloqueante.

```rust
// Diálogo nativo pidiendo permiso
use accessibility::AXIsProcessTrustedWithOptions;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;

let options = CFDictionary::from_CFType_pairs(&[
    (CFString::new("AXTrustedCheckOptionPrompt"), true.into())
]);
AXIsProcessTrustedWithOptions(Some(&options));
```

### 3.2. Permiso de Screen Recording (opcional, futuro)

- **Para qué**: si en el futuro añadimos fallback de screenshots+VLM.
- **Sin este permiso**: las capturas salen negras excepto la propia ventana de Weaver.
- Por ahora **no se requiere** porque Weaver NO usa visión.

### 3.3. Permiso de Automation (AppleScript) — no necesario

Si en el futuro controlamos apps vía AppleScript (Finder, Mail, etc.), necesitaríamos permiso de `NSAppleEventsUsageDescription`. Por ahora no lo usamos.

### 3.4. Entitlements (`*.entitlements` file)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <false/>
    <key>com.apple.security.automation.apple-events</key>
    <true/>
</dict>
</plist>
```

Weaver **NO** usará sandbox (necesita acceso total al árbol AX de otras apps). Esto impide App Store distribution, pero `.dmg` firmado y notarizado es la vía estándar.

---

## 4. Plan de fases macOS

### Fase M1 — Trait Backend + refactor (compartido con Windows)

- [ ] Crear `backend/mod.rs` con trait `Backend` (común con Fase W1)
- [ ] Refactorizar `commands.rs` para usar trait
- [ ] Verificar que Linux MVP sigue funcionando

### Fase M2 — Accessibility wrapper (3-4 sesiones)

- [ ] Crear `ax/client.rs`: inicializar `AXUIElementCreateApplication(pid)` por app
- [ ] `list_applications()`: usar `NSWorkspace::runningApplications` → mapear a `ApplicationInfo`
- [ ] `query_tree()`: recursión sobre atributo `AXChildren` del elemento root
- [ ] Mapear `AXRole` → `Role` (tabla en `ax/types.rs`)
- [ ] Mapear atributos (`AXTitle`, `AXHelp`, `AXPosition`, `AXSize`, `AXEnabled`, `AXFocused`) a `AccessibleNode`
- [ ] Limitar profundidad con `max_depth`
- [ ] Tests con: TextEdit, Safari, Mail, VSCode, Finder

### Fase M3 — Acciones sobre elementos (2 sesiones)

- [ ] `click(node)`: usar `AXPress` action si disponible, fallback CGEvent con coords de `AXPosition` + `AXSize`
- [ ] `type_text(node, text)`: usar `AXSetValue` si el elemento lo soporta, fallback clic + CGEvent keyboard
- [ ] `press_key(key)`: usar `enigo` directo (mapear "Ctrl" → Cmd en macOS donde aplique)
- [ ] `get_text(node)`: leer `AXValue` attribute
- [ ] `get_extents(node)`: `AXPosition` + `AXSize` → `Rect`
- [ ] `focus(node)`: `AXSetFocused` attribute

### Fase M4 — Automation AppKit (2 sesiones)

- [ ] `clipboard_get/set`: `NSPasteboard::generalPasteboard` + `NSString`/`NSData`
- [ ] `list_windows`: leer `AXWindows` attribute del app object
- [ ] `activate_window`: `NSRunningApplication::activate` + `NSApplication::activateIgnoringOtherApps`
- [ ] `mouse_click_at(x, y, button)`: `CGEventCreateMouseEvent` + `CGEventPost(kCGHIDEventTap)`

### Fase M5 — Empaquetado + Notarización (3 sesiones)

- [ ] `tauri.conf.json`: añadir `macos` config (icono `.icns`, bundle id, signing identity)
- [ ] Code signing con cert "Developer ID Application: <nombre>" (requiere cuenta Apple Developer $99/año)
- [ ] Notarización con `xcrun notarytool submit ... --wait`
- [ ] Stapler: `xcrun stapler staple Weaver.app`
- [ ] DMG con `create-dmg`
- [ ] GitHub Actions workflow `build-macos.yml`:
  - `macos-14` runner (Apple Silicon)
  - `cargo build --release --target aarch64-apple-darwin`
  - `cargo build --release --target x86_64-apple-darwin`
  - Universal binary con `lipo`
  - Notarize + staple
  - Upload `.dmg`

### Fase M6 — Tests con apps reales (2 sesiones)

- [ ] TextEdit: abrir, escribir, guardar
- [ ] Safari: leer pestañas, navegar
- [ ] Mail: redactar correo nuevo
- [ ] VSCode: abrir archivo, editar
- [ ] Finder: navegar carpetas
- [ ] Notes: crear nota, escribir
- [ ] Documentar compatibilidad en `PROGRESS.md`

---

## 5. Comparativa rápida Linux vs macOS

| Aspecto | Linux | macOS |
|---------|-------|-------|
| API accesibilidad | AT-SPI2 / D-Bus | AXUIElement |
| Wrapper Rust | `zbus` (manual) | `accessibility` crate + `objc2` |
| Input sintético | `x11rb` / `wtype` | `CGEvent` / `enigo` |
| Clipboard | `xclip` / `wl-clipboard` | `NSPasteboard` |
| Ventanas | `wmctrl` (X11) | `NSWorkspace` / `AXWindows` |
| Keyring | libsecret | Keychain |
| Permisos especiales | `gsettings toolkit-accessibility` | **Accessibility permission (TCC)** |
| Limitaciones | Wayland sintético | Sin sandbox para App Store |
| Empaquetado | `.deb`, `.AppImage`, `.rpm` | `.dmg`, `.app` |
| Code signing | Opcional | Obligatorio para distribución |

---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Permiso Accessibility denegado por usuario | Detectar con `AXIsProcessTrusted()` y mostrar banner en UI con link a System Settings |
| `accessibility` crate inmaduro | Fallback a `objc2` con bindings directos a `ApplicationServices.framework` |
| Apps con `AXManualAccessibility` desactivado (algunas Electron) | Documentar flag `--force-renderer-accessibility` |
| Code signing costoso ($99/año + proceso de revisión Apple) | Distribuir versión sin firma con instrucciones de `xattr -dr` |
| Notarización falla por uses-non-public-API | Auditoría de dependencias Rust con `cargo audit` |
| Universal binary duplica tamaño | `lipo` solo para release; dev builds por arquitectura |

---

## 7. Criterios de "MVP macOS"

El MVP macOS se considera listo cuando:

1. Weaver arranca en macOS 14+ sin errores
2. Al primer arranque, pide permiso de Accessibility y el usuario lo concede
3. El usuario configura API key de OpenAI/Anthropic/Ollama
4. Pide: *"Abre TextEdit y escribe 'Hola desde Weaver', guarda en `~/weaver-test.txt`"*
5. Ve al agente planificar, ejecutar cada paso vía AXUIElement, verificar y reportar
6. El log episódico se persiste en SQLite local
7. El `.dmg` firmado y notarizado se genera en CI

---

## 8. Estado actual

- [ ] **No implementado** — pendiente iniciar Fase M1 (trait Backend, compartido con Windows)
- [ ] UI ya funciona en macOS (Tauri compila cross-platform sin cambios)
- [ ] Frontend 100% reusable
- [ ] `keyring` ya soporta Keychain (sin cambios)
- [ ] SQLite cross-platform (sin cambios)

**Estimación total**: 14-16 sesiones para MVP macOS completo (más que Windows por la curva de code signing + notarización).

---

## 9. Estrategia de release conjunto

| Plataforma | Fase | ETA |
|------------|------|-----|
| Linux (X11) | ✅ MVP listo | Hecho |
| Linux (Wayland) | Fase 7 | +2 sesiones |
| Windows 10/11 | Fases W1-W6 | +12-14 sesiones |
| macOS 14+ | Fases M1-M6 | +14-16 sesiones |

**Release 1.0** = Linux X11+Wayland + Windows + macOS con los 3 backends funcionando y CI generando instaladores firmados para cada OS.
