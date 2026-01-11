# Contexto del Proyecto: Points PWA

## Stack Tecnológico
- **Frontend:** HTML5, CSS3 (Variables nativas), Vanilla JavaScript (ES Modules).
- **Backend:** Supabase (Auth, Database, Edge Functions).
- **Herramientas:** - `vite` para servidor de desarrollo (Hot Reload).
  - `npm` para gestión de paquetes.

## Archivos Clave
- `app.js`: Lógica principal. Usa `import` de `esm.sh` para Supabase.
- `config.js`: Credenciales (ignoradas por git). NO modificar estructura.
- `index.html`: Entry point.
- `westhill.css`: Estilos globales.

## Reglas de Desarrollo
1. **Módulos:** No usar `require()`. Usar sintaxis ES6 `import`.
2. **Servidor Local:** Para probar cambios, ejecutar `npx vite`.
3. **Base de Datos:**
   - Preferir RPCs existentes (`team_pool_adjust`, `reset_all_points`) sobre lógica compleja en cliente.
   - Tablas principales: `students`, `teams`, `transactions`.
   
# Estructura de Base de Datos
La estructura de la base de datos está definida en el archivo: `supabase-types.js`.
Úsalo como referencia absoluta para nombres de tablas, columnas y tipos de datos.

Tablas clave:
- students: Alumnos (id, nombre, puntos).
- minigames: Registro de juegos.
- points: Historial de transacciones de puntos.
