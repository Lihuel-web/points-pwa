cat > supabase/README.md << 'EOF'

\# Supabase – Esquema de la base de datos (`prod.sql`)



Este directorio contiene una \*\*instantánea del esquema\*\* de la base de datos de Supabase usada por este proyecto.  

El objetivo principal es:



\- Tener el estado de la base versionado en Git.

\- Permitir que herramientas como \*\*Codex\*\* (u otras IAs) entiendan la estructura real de la base sin entrar al dashboard.

\- Evitar tener que copiar y pegar RLS, funciones y definiciones de tablas a mano.



Actualmente, el archivo principal es:



\- `supabase/schemas/prod.sql` → dump del \*\*esquema\*\* (sin datos) de la base de producción.



---



\## 1. ¿Qué incluye `prod.sql`?



El archivo `supabase/schemas/prod.sql` fue generado con:



\- `pg\_dump` de \*\*PostgreSQL 17\*\* (cliente local, no servidor).

\- Contra la instancia de Supabase (servidor PostgreSQL 17.x).

\- Usando las opciones:



&nbsp;   --schema-only     # sólo esquema, sin datos  

&nbsp;   --no-owner        # sin comandos de cambio de dueño  

&nbsp;   --no-privileges   # sin GRANT/REVOKE  



En general, aquí se ve:



\- Tablas, columnas y tipos.

\- Constraints (PK, FK, UNIQUE, CHECK).

\- Índices.

\- Vistas.

\- Funciones y triggers.

\- Políticas de seguridad (RLS).



> ⚠️ Importante: este archivo \*\*no\*\* debe contener credenciales ni contraseñas; sólo definición de objetos SQL.



---



\## 2. Prerrequisitos para actualizar el esquema



Este flujo está pensado para \*\*WSL con Ubuntu\*\*.



Antes de actualizar `prod.sql` necesitas:



1\. Tener instalado el \*\*cliente de PostgreSQL 17\*\* (no el servidor completo).  

&nbsp;  Debería existir el binario:



&nbsp;       /usr/lib/postgresql/17/bin/pg\_dump --version



&nbsp;  y mostrar algo como:



&nbsp;       pg\_dump (PostgreSQL) 17.x



2\. Tener una \*\*connection string\*\* válida de Supabase (desde el Dashboard → botón “Connect” → opción `psql` o “session pooler”).  

&nbsp;  Tendrá esta forma general (ejemplo genérico):



&nbsp;       postgresql://postgres.\[PROJECT\_REF]:TU\_PASSWORD@aws-0-XXXXXXXX-YYYY-1-ZZ-1.db.XXXXX.supabase.com:5432/postgres



&nbsp;  > ⚠️ Nunca commitear esta cadena en Git. Usarla sólo en local (como variable de entorno).



---



\## 3. Cómo actualizar `supabase/schemas/prod.sql` (paso a paso)



Siempre desde la raíz del proyecto (por ejemplo: `~/projects/pwa-points/points-pwa`):



1\. \*\*Exportar la connection string\*\* como variable de entorno (ajustar con tus datos reales de Supabase):



&nbsp;       export PG\_CONN\_STR="postgresql://postgres.\[PROJECT\_REF]:TU\_PASSWORD@aws-0-XXXXXXXX-YYYY-1-ZZ-1.db.XXXXX.supabase.com:5432/postgres"



&nbsp;  - `\[PROJECT\_REF]` es el identificador del proyecto en Supabase.

&nbsp;  - `TU\_PASSWORD` es la contraseña que te muestra Supabase en la sección de conexión.

&nbsp;  - No guardes esta línea en ningún archivo versionado.



2\. \*\*Asegurarse de que existe la carpeta de schemas\*\*:



&nbsp;       mkdir -p supabase/schemas



3\. \*\*Generar el dump del esquema\*\* usando el cliente de PostgreSQL 17:



&nbsp;       /usr/lib/postgresql/17/bin/pg\_dump \\

&nbsp;         --schema-only \\

&nbsp;         --no-owner \\

&nbsp;         --no-privileges \\

&nbsp;         "$PG\_CONN\_STR" \\

&nbsp;         > supabase/schemas/prod.sql



4\. \*\*Revisar el diff\*\* antes de commitear (para ver qué cambió en la DB):



&nbsp;       git diff supabase/schemas/prod.sql



5\. Si el cambio tiene sentido, \*\*commitear\*\* la nueva versión:



&nbsp;       git add supabase/schemas/prod.sql

&nbsp;       git commit -m "Update Supabase schema snapshot"



---



\## 4. Uso recomendado con Codex (VS Code)



Cuando se trabaje con \*\*Codex\*\* (o cualquier agente que edite código y SQL):



1\. Recordarle que use este archivo como referencia de la base:



&nbsp;       Use @supabase/schemas/prod.sql as the source of truth for the database schema

&nbsp;       (tables, relationships, RLS, functions) when making changes to any Supabase-related

&nbsp;       code in this project.



2\. Antes de pedir cambios grandes a la DB (nuevas tablas, RLS, funciones):



&nbsp;  - Pedirle que primero \*\*lea\*\* el esquema actual (`prod.sql`).

&nbsp;  - Luego que guíe sus propuestas de cambios en función de lo que ve ahí, en lugar de inventar la estructura.



3\. Si se aplica un cambio directo en Supabase (desde el dashboard):



&nbsp;  - Volver a generar `prod.sql` con el procedimiento de la sección 3.

&nbsp;  - Commitear el cambio para que el repo siga siendo la \*\*fuente de verdad\*\* del estado de la DB.



---



\## 5. Buenas prácticas



\- \*\*No\*\* guardar ni commitear la connection string completa (con contraseña) en ningún archivo del repo.

\- Si Supabase cambia la versión de PostgreSQL en el futuro:

&nbsp; - Habrá que instalar el cliente correspondiente (por ejemplo `postgresql-client-18`) y actualizar la ruta de `pg\_dump`.

\- Si más adelante se introduce un sistema de migraciones (por ejemplo `supabase db diff` / `db push`):

&nbsp; - Este archivo puede convivir con una carpeta de migraciones (`supabase/migrations/`) y seguir utilizándose como snapshot de referencia.

\- Si el archivo se vuelve muy grande:

&nbsp; - En general es útil mantener una sola “foto” global, pero si es necesario se podría separar por esquemas.



---



\## 6. Resumen rápido



\- `supabase/schemas/prod.sql` es la \*\*foto actual del esquema de producción\*\*.

\- Se actualiza manualmente con `pg\_dump` (cliente Postgres 17) usando la connection string de Supabase.

\- Se versiona en Git para:

&nbsp; - tener histórico de cambios de la DB,

&nbsp; - ayudar a Codex/IA a entender la estructura de la base,

&nbsp; - evitar copiar/pegar RLS y funciones desde el dashboard.

EOF



