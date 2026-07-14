# Windows Code Signing (Fase W5)

Weaver se distribuye para Windows como `.msi` (WiX) y `.exe` (NSIS). Para
evitar el warning "Windows protected your PC" de SmartScreen, los binarios
deben estar **firmados con un certificado de code signing**.

## Tipos de certificado

| Tipo | Costo | SmartScreen | Revisión Apple |
|------|-------|-------------|---------------|
| Self-signed | Gratis | ❌ Bloquea | N/A |
| OV (Organization Validated) | ~$200/año | ⚠️ Requiere reputación | N/A |
| **EV (Extended Validation)** | ~$300-400/año | ✅ Inmediato | N/A |

**Recomendado**: certificado EV. Sin reputación previa, SmartScreen bloquea
binarios OV durante semanas/meses hasta que suficientes usuarios los descarguen.

## Proveedores recomendados

- **DigiCert** (~$399/año) — gold standard, soporte excelente
- **Sectigo** (~$300/año) — más económico
- **SSL.com** (~$250/año) — budget option

## Configuración en GitHub Actions

### 1. Convertir certificado .pfx a base64

```bash
# En tu máquina local (con el .pfx descargado del proveedor):
base64 -w 0 cert.pfx > cert_b64.txt
```

### 2. Añadir secrets al repo

Ve a **Settings → Secrets and variables → Actions → New repository secret**:

| Nombre | Valor |
|--------|-------|
| `WINDOWS_CERT_PFX` | Contenido de `cert_b64.txt` (string base64 sin newlines) |
| `WINDOWS_CERT_PASS` | Password del .pfx |

### 3. Habilitar el job de signing

El workflow `.github/workflows/build-windows.yml` ya tiene un job `sign`
que se ejecuta automáticamente cuando:
- Se pushea un tag `v*` (ej. `v0.2.0`)
- El secret `WINDOWS_CERT_PFX` está configurado

Si los secrets no están, el job se omite y solo se suben los binarios sin firma.

## Firma manual (alternativa)

Si prefieres firmar fuera de CI:

```powershell
# 1. Instalar Windows SDK con signtool
# https://developer.microsoft.com/windows/downloads/windows-sdk/

# 2. Firmar
signtool sign /f cert.pfx /p PASSWORD `
  /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 `
  /d "Weaver — Desktop agent" `
  weaver-0.2.0.msi weaver-0.2.0-setup.exe

# 3. Verificar firma
signtool verify /pa /v weaver-0.2.0.msi
```

## Verificación

Después de firmar, los usuarios pueden verificar la firma:

1. Click derecho en el `.exe` o `.msi` → **Properties**
2. Tab **Digital Signatures**
3. Seleccionar la firma → **Details**
4. Debe decir "This digital signature is OK"

## Notas importantes

- **EV certificados se guardan en hardware USB** (token USB o HSM). Algunos
  proveedores permiten exportar a .pfx para uso en CI, otros no. Verificar
  con el proveedor antes de comprar.

- **Rotación de certificados**: al renovar, los binarios firmados con el
  certificado anterior siguen siendo válidos (la firma incluye timestamp).

- **Reputación SmartScreen**: con EV, se obtiene inmediatamente. Con OV,
  hay que enviar el binario a Microsoft para revisión manual:
  https://www.microsoft.com/en-us/wdsi/filesubmission

- **Antivirus**: algunos AVs marcan binarios sin firma como sospechosos.
  Con firma EV, esto es extremadamente raro.
