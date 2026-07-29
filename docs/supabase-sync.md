# Sincronización con Supabase

Weaver puede conectarse a tu cuenta de Supabase usando un **Personal Access
Token (PAT)** para listar tus proyectos existentes y, al elegir uno,
**crear automáticamente un proyecto local** con el mismo nombre. También
puedes **crear un nuevo proyecto Supabase** desde Weaver — el proyecto se
provisiona en la nube de Supabase y se crea el correspondiente local al
mismo tiempo.

## 1. Cómo conseguir el token

1. Inicia sesión en <https://supabase.com>.
2. Ve a **Account → Access Tokens**:
   <https://supabase.com/dashboard/account/tokens>
3. Pulsa **Generate new token**, dale un nombre (por ejemplo `weaver`)
   y cópialo. El token tiene el formato `sbp_...`.

> El token **sólo** se envía a `api.supabase.com` sobre HTTPS. Nunca sale
> de tu máquina hacia otros servidores.

## 2. Dónde se guarda el token

| Modo              | Almacenamiento                                            |
| ----------------- | --------------------------------------------------------- |
| **Tauri (prod)**  | Keyring del OS (libsecret en Linux, Cred Manager en Win, Keychain en macOS) bajo el `provider_id` `supabase_pat`. |
| **Navegador (dev)** | `localStorage`. **No es seguro** — sólo para desarrollo. |

Para almacenamiento seguro ejecuta `npm run tauri:dev`.

## 3. Cómo usarlo en Weaver

1. Abre **Configuración** (icono engrane en el ActivityBar).
2. Baja hasta la tarjeta **Sincronización Supabase**.
3. Pega el token (`sbp_...`) y pulsa **Conectar**.
4. Weaver valida el token contra `GET /v1/organizations` y
   `GET /v1/projects` y muestra:
   - El número de organizaciones y proyectos.
   - El listado completo de tus proyectos Supabase con región, estado
     (`ACTIVE`, `PAUSED`, …) y host de la BD.
5. Para cada proyecto remoto, pulsa **Importar** — Weaver crea un
   proyecto local con el mismo nombre y lo vincula al ID de Supabase
   (mapeo persistido en `localStorage:weaver:supabase_project_map`).
6. Si un proyecto local con ese nombre ya existe, **sólo se vincula**
   (no se duplica).

## 4. Crear un proyecto Supabase nuevo

Pulsa **Crear nuevo proyecto Supabase** dentro de la misma tarjeta.
Weaver te pide:

| Campo             | Descripción                                                  |
| ----------------- | ------------------------------------------------------------ |
| Nombre            | Nombre del proyecto (también se usará como subdominio).      |
| Organización      | Tomada de `GET /v1/organizations`.                           |
| Región            | us-east-1, eu-west-1, ap-southeast-1, etc.                   |
| Contraseña BD     | Mínimo 6 caracteres. **Guárdala** — Supabase no la muestra.  |

Al confirmar, Weaver hace `POST /v1/projects` y, en cuanto recibe el ID,
crea un proyecto local vinculado. El plan `free` tarda ~2 minutos en
aprovisionarse por parte de Supabase.

## 5. Endpoints usados

| Método | Endpoint                  | Uso                                  |
| ------ | ------------------------- | ------------------------------------ |
| GET    | `/v1/organizations`       | Listar organizaciones del usuario.   |
| GET    | `/v1/projects`            | Listar proyectos Supabase.           |
| POST   | `/v1/projects`            | Crear nuevo proyecto Supabase.       |

Todos los endpoints requieren cabecera `Authorization: Bearer sbp_...`.

Referencia oficial:
<https://supabase.com/docs/reference/api/introduction>

## 6. Desconectar

Pulsa el botón **X** dentro de la tarjeta. Weaver borra el token del
keyring (o de `localStorage`) y olvida el listado de proyectos remotos.
Los proyectos locales **no se borran** — sólo se desconecta el origen
Supabase.

## 7. Seguridad

- El PAT da acceso de **gestión** a tu cuenta Supabase (crear/borrar
  proyectos, modificar BD, etc.). Trátalo como una contraseña.
- Si lo filtras, regénéralo desde <https://supabase.com/dashboard/account/tokens>
  y actualízalo en Weaver.
- Weaver **no** almacena ni envía la contraseña de la BD. Esa contraseña
  se usa una sola vez al crear el proyecto y luego se descarta.
- El mapeo `weaver:supabase_project_map` sólo guarda IDs, nunca tokens
  ni contraseñas.

## 8. Limitaciones actuales

- No hay **bidireccional sync** de datos aún. La integración hoy
  vincula el proyecto local al ID de Supabase para futuras
  sincronizaciones (episodios, facts, configuración).
- No se pueden **pausar / reanudar / borrar** proyectos Supabase desde
  Weaver. Usa el dashboard oficial para eso.
- El listado se actualiza **bajo demanda** (botón Refrescar). No hay
  polling automático.

## 9. Próximos pasos previstos

- Sincronización bidireccional de `weaver_episodes` y `weaver_facts`
  con tablas Supabase.
- Polling automático cada N minutos.
- Botón "Pausar" / "Reanudar" proyecto.
- Selector de proyecto Supabase al crear un proyecto local, en lugar
  de sólo importar.
