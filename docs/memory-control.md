# Memoria — Control del usuario

Weaver tiene dos tipos de memoria:

- **Semántica (facts)**: hechos que el agente ha aprendido sobre ti y
  tus tareas. Ej: `user.timezone = America/Mexico_City`.
- **Episódica (episodes)**: historial de tareas completadas, con plan,
  trace y lecciones aprendidas.

Hoy los facts/episodios se guardan en SQLite pero el usuario no tenía
dónde verlos, editarlos ni borrarlos. El **panel de Memoria** (icono 🧠
en el sidebar) da control real sobre qué recuerda el agente.

## 1. Vista Memoria

### Pestaña Facts

Tabla editable con:

- **Clave** (`user.timezone`, `project.weaver.stack`, …).
- **Valor** (texto libre, multilínea).
- **Origen** (`user` | `agent` | `system`).
- **Actualizado** (timestamp).

Acciones:

- **Editar** valor en caliente (cambia el origen a `user`).
- **Borrar** fact individual.
- **Nuevo** fact (clave + valor + se guarda como `user`).
- **Borrar todo** (facts + episodios + memories importadas).

### Pestaña Episodios

Lista cronológica de tareas completadas:

- **Objetivo** (texto).
- **Outcome** (success | failure | partial | aborted) con badge de
  color.
- **Subtareas** (lista con status ✓ ✗ ⊘ •).
- **Criterio de éxito** de cada subtarea.
- **Lecciones** aprendidas.
- **Trace** (últimas 8 entradas del log de ejecución: thoughts, tool
  calls, observations, errors).

Acciones:

- **Expandir/contraer** cada episodio.

## 2. ¿Por qué importa esto?

Si vas a hacer **memoria importada de otras IAs** (ChatGPT, Claude,
Gemini), ahí se acumula info sensible sin que el usuario la vea nunca.
El panel de Memoria le da visibilidad y control:

- Saber **exactamente** qué sabe el agente sobre ti.
- **Editar** lo que esté mal o desactualizado.
- **Borrar** lo que no quieras que recuerde (sensible, obsoleto, etc.).
- **Auditar** antes de compartir la app o sync con otro dispositivo.

## 3. Diferencia con ME

| Aspecto       | ME (espacio personal)              | Memoria (del agente)                |
| ------------- | ---------------------------------- | ----------------------------------- |
| De quién es   | Del USUARIO                        | Del AGENTE                          |
| Qué contiene  | Calendario, tareas, notas, salud   | Facts + episodios de tareas         |
| Quién lo edita | El usuario manualmente            | El agente lo aprende, usuario lo audita |
| Sensible      | Sí (vida personal)                 | Sí (info acumulada del agente)      |
| Se borra      | Manualmente                        | Manualmente + auto-reflexión        |

ME es **tu espacio** donde el agente anota cosas que tú le pides. La
Memoria es **lo que el agente ha aprendido** sobre ti y tus tareas.

## 4. Memoria importada

Si usaste "Importar memoria de otra IA" (Ajustes → Importar memoria),
las entradas importadas aparecen como facts con `source: 'user'` y
categorías (persona, tareas, herramientas, etc.). Puedes editarlas o
borrarlas individualmente desde aquí.

## 5. Limitaciones actuales

- No hay búsqueda full-text en facts (sólo scroll). Para muchos facts,
  considerar añadir un campo de búsqueda.
- No hay exportación a JSON/CSV (próximamente).
- Los episodios no se pueden borrar individualmente (sólo "borrar todo").
- No hay diff entre episodios similares para detectar patrones.
