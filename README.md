# js-pablogarcor-editor

Editor de bloques para escribir y publicar posts de [pablogarcor.com](https://www.pablogarcor.com) directamente en su repositorio, [pablogarcor/js-pablogarcor-web](https://github.com/pablogarcor/js-pablogarcor-web).

JavaScript puro con módulos ES. Sin dependencias, sin `package.json`, sin paso de build: se sirve tal cual y los tests corren con el runner que trae Node.

## Estado

| Parte | Estado |
| --- | --- |
| Modelo de documento (bloques, marcas inline, deshacer/rehacer) | Hecho y testeado |
| Markdown ⇄ modelo, con ida y vuelta sin pérdidas | Hecho, probado contra los 23 posts del blog |
| Convenciones de Hugo (rutas, front matter, slug, traducciones) | Hecho |
| Publicación en GitHub (rama + commit único + PR) | Hecho, testeado con una API falsa |
| Conversión de imágenes a WebP en el navegador | Hecho (solo navegador, sin test) |
| Servidor local (`serve.js`) con CSP estricta | Hecho y testeado |
| Vista (`index.html`, `src/editor/`) | Hecho; la vista se testea en Node contra los posts reales |
| Edición de texto: escribir, Enter, Backspace/Supr, deshacer, selección entre bloques | Hecho; los comandos y el mapeo de la selección se testean en Node, el resto con `docs/pruebas-manuales.md` |
| Barra de herramientas: negrita, cursiva, código, enlaces, tipo de bloque, insertar y eliminar bloques | Hecho; los comandos se testean en Node |
| Metadatos: título, idioma, fecha, slug, translationKey, etiquetas, descripción, con las comprobaciones de `validatePost` en vivo | Hecho; las reglas se testean en Node |
| Imágenes nuevas, pegar HTML | **Pendiente** |
| Borradores locales (IndexedDB) | **Pendiente** |

## Estructura

```
src/
├── model/          El documento. No sabe nada de Markdown ni del DOM.
│   ├── inline.js     Texto como lista plana de "runs" con marcas (negrita,
│   │                 cursiva, código, enlace) y las operaciones del editor:
│   │                 insertar, borrar, aplicar o quitar una marca.
│   ├── document.js   Bloques (párrafo, título, lista, cita, código, imagen,
│   │                 separador, raw) y operaciones inmutables sobre ellos.
│   ├── history.js    Deshacer/rehacer agrupando la escritura seguida.
│   ├── editing.js    Qué hacen escribir, Enter, Backspace y Supr: comandos
│   │                 puros sobre el documento y una selección.
│   └── formatting.js Marcas, enlaces, tipo de bloque, insertar y quitar
│                     bloques: los comandos de la barra.
├── markdown/       Markdown ⇄ modelo.
│   ├── parse.js      Parser de bloques (subconjunto de CommonMark).
│   ├── inline.js     Parser y serializador inline (algoritmo de CommonMark).
│   ├── serialize.js  Modelo → Markdown, con verificación de cada bloque.
│   └── frontmatter.js  El subconjunto de YAML que usan los posts.
├── hugo/
│   └── post.js     Lo único que conoce las convenciones del blog.
├── github/
│   ├── client.js   Cliente REST mínimo sobre fetch.
│   └── publish.js  Rama + commit con todos los ficheros + PR contra main.
├── media/
│   └── webp.js     Imagen → WebP con OffscreenCanvas.
└── editor/         La página.
    ├── view.js       Documento → árbol de objetos planos (vnodes). Sin DOM.
    ├── dom.js        vnodes → elementos.
    ├── selection.js  Puntos del DOM ⇄ posiciones del modelo.
    ├── editor.js     La superficie editable: eventos → comandos → repintado.
    ├── toolbar.js    Barra de herramientas y panel de enlaces.
    ├── meta-form.js  Formulario del front matter y avisos de validatePost.
    ├── app.js        Arranque de la página, abrir y nuevo post.
    └── editor.css
index.html          La página del editor.
serve.js            Servidor local, solo para 127.0.0.1.
tests/              node --test, sin librerías.
```

Por qué está separado así:

- **`model/` y `markdown/` no tocan el DOM.** Por eso se pueden probar en Node, incluido el test que pasa por todos los posts reales.
- **`hugo/` es la única capa que conoce tu blog.** Rutas, orden del front matter, slug y `translationKey` viven ahí. Si cambias el blog, solo tocas ese módulo.
- **`github/` es lo único que habla con la red y lo único que ve el token.**
- **`editor/view.js` no toca el DOM.** Decide qué se muestra y se prueba en Node; `dom.js` solo lo convierte en elementos.

## Cómo se conserva tu Markdown

Cada bloque que viene de un post existente guarda dos cosas:
- **`raw`**: el texto exacto del que salió.
- **`sep`**: lo que había justo antes de él.

Mientras no tocas un bloque, se vuelve a escribir desde `raw`. Así, abrir un post de 2024, corregir una frase y publicar produce un PR que solo cambia esa frase: los espacios al final y las dobles líneas en blanco de alrededor se quedan como estaban. Al editar un bloque, ese bloque pasa a escribirse desde el modelo con el estilo de la casa (`*` en listas, `**negrita**`, `*cursiva*`, `**_ambas_**`).

Cada bloque escrito desde el modelo se verifica: se vuelve a parsear y tiene que dar exactamente el mismo bloque. Si no lo da, se reintenta escapando más. Algunos casos no se pueden expresar con `**` o `_` según CommonMark, como `**"cita"**palabra`, donde la negrita acaba en puntuación pegada a una letra. En esos casos se escribe la letra vecina como entidad (`&#x70;`), que se ve igual. Es la misma solución que usa remark.

Lo que el editor no sabe editar visualmente se queda como bloque `raw`: tablas, HTML, listas anidadas, citas o elementos de lista con varios párrafos, shortcodes y definiciones de enlaces de referencia. El editor lo mostrará como Markdown en crudo. Ahora mismo ninguno de tus posts tiene bloques así.

## Ejecutar en local

```sh
node serve.js
```

Abre http://localhost:8000 y pulsa **Abrir post…**. Elige un `index.md` de tu copia del blog y, si quieres ver sus imágenes, selecciónalas en el mismo diálogo. Las imágenes se muestran desde tu disco con URLs `blob:`; no se sube nada. Otro puerto: `PORT=9000 node serve.js`.

También puedes empezar un **Nuevo post**. Se puede editar el texto, pero todavía no se guarda nada: el panel **Markdown**, al final de la página, muestra en vivo lo que se escribiría. La barra de estado dice cuántos bloques tiene el post, cuántos se quedan como Markdown sin editar y si hay cambios respecto al fichero abierto.

### Datos del post

Encima del texto está el formulario del front matter. En un post nuevo:
- el slug sigue al título (con `slugify`) hasta que lo escribes a mano, y el translationKey sigue al slug; si vacías el campo, vuelve a seguirlo;
- la fecha es la de hoy en Europe/Madrid y el autor es fijo;
- las etiquetas se escriben separadas por comas y se guardan como lista, sin repetidas;
- la descripción cuenta caracteres hasta 160.

En un post abierto, el slug y el translationKey no se pueden cambiar: el slug es la URL publicada. Editar un campo reescribe solo su línea del front matter.

Debajo se listan en vivo los errores y avisos de `validatePost`: lo que impedirá publicar y lo que conviene revisar. Los cambios del formulario se deshacen con Ctrl+Z como los del texto.

### Cómo funciona la edición

Toda la zona de texto es un único `contenteditable`. El navegador nunca modifica el DOM por su cuenta: cada evento `beforeinput` se cancela y se convierte en un comando de `model/editing.js`; después se vuelven a pintar solo los bloques que han cambiado y el cursor se recoloca desde el modelo. Un único elemento editable (en lugar de uno por bloque) da gratis el movimiento del cursor entre bloques, la selección de varios bloques y Ctrl+A.

| Tecla | Qué hace |
| --- | --- |
| Enter | Divide el párrafo o el elemento de lista. Al final de un título o una cita, crea un párrafo. En un elemento de lista vacío, sale de la lista. |
| Shift+Enter | Salto de línea dentro del bloque (no en títulos). |
| Backspace al principio | Une con el bloque anterior. Un título o una cita pasa a párrafo; el primer elemento de una lista sale de ella. Nunca borra una imagen ni un bloque de código. |
| Supr al final | Une con el bloque siguiente si es de texto. |
| Ctrl+Backspace / Ctrl+Supr | Borra una palabra. |
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | Deshacer y rehacer. La escritura seguida en un bloque es un solo paso. |
| Pegar | Solo texto plano por ahora: las líneas en blanco separan párrafos. |
| Ctrl+B / Ctrl+I / Ctrl+E | Negrita, cursiva, código. Sin nada seleccionado, se aplica a lo que escribas a continuación. |
| Ctrl+K | Enlace sobre la selección, o cambiar el enlace en el que está el cursor. Solo admite `https://`, `http://`, `mailto:` y rutas (`/…`, `#…`); un dominio sin protocolo recibe `https://`. |

La barra cambia el tipo de bloque (párrafo, títulos 2 a 4, cita, lista, lista numerada) de todo lo seleccionado; en una lista, solo de los elementos seleccionados. Elegir el tipo que ya tiene lo devuelve a párrafo. Varios párrafos convertidos en lista forman una sola lista, que se une a la lista vecina del mismo tipo.

Los bloques que no son texto se editan con sus propios controles: el lenguaje y el código de un bloque de código, el texto alternativo de una imagen, el Markdown de un bloque sin editar. Todos tienen un botón × para eliminarlos. La barra inserta separadores y bloques de código después del bloque del cursor. La composición de teclado (teclas muertas, métodos de entrada) no se puede cancelar: mientras dura, el navegador edita el DOM, y al terminar se aplica el texto al modelo y se repinta.

Las pruebas que dependen del navegador están en [`docs/pruebas-manuales.md`](docs/pruebas-manuales.md).

Hace falta un servidor porque los módulos ES no cargan desde `file://`. `serve.js`:
- escucha solo en `127.0.0.1` y rechaza peticiones con un `Host` que no sea local;
- sirve únicamente `index.html` y `src/`;
- envía una Content-Security-Policy estricta: solo scripts y estilos servidos por él, nada inline. Cuando el editor tenga el token, ningún script ajeno podrá leerlo.

El contenido de los posts llega a la página solo como texto (`textContent`, `setAttribute`), nunca con `innerHTML`.

## Publicar

1. El editor crea o actualiza la rama `post/<idioma>/<slug>` a partir de `main`.
2. Sube el `index.md` y las imágenes en **un solo commit**, usando la API de Git Data.
3. Abre un PR contra `main` o reutiliza el que ya exista.
4. Azure Static Web Apps genera la vista previa del PR, y al hacer merge el post queda publicado.

`publishFiles` se niega a escribir directamente en `main`.

Para no hacer commits en `main` por error, `postLocation` decide dónde va un post nuevo:
- Sin imágenes: `dd/<slug>.md`.
- Con imágenes: `dd/index.md` (un bundle de Hugo).
- Si ese día ya hay otro post: `dd/<slug>/index.md`.

El caso del mismo día importa. Si en una carpeta con `index.md` metes otro `.md`, Hugo lo trata como un recurso del bundle y no lo publica, sin avisar.

### Token

Un *fine-grained personal access token* con lo mínimo:

- Repositorio: solo `pablogarcor/js-pablogarcor-web`.
- Permisos: **Contents: Read and write** y **Pull requests: Read and write**. Metadata: Read se añade solo.
- Caducidad corta (por ejemplo 90 días).

**Riesgo:** con ese token se puede crear, cambiar o borrar cualquier fichero del repo en cualquier rama a la que tenga acceso. No puede tocar `.github/workflows` porque no tiene el permiso Workflows.

Para que el daño posible se limite a ramas, crea una regla de rama sobre `main` con estas opciones:
- *Require a pull request before merging*, sin aprobaciones obligatorias (no puedes aprobar tus propios PR).
- Nadie en la lista de *bypass*.
- Bloqueo de force push y de borrado.

En el editor, el token debe vivir en memoria o en `sessionStorage`, nunca en `localStorage`. Además, el editor debe ejecutarse en local: cualquier fallo XSS en una página publicada podría leer el token.

## Tests

```sh
node --test
```

Requiere Node 20.11 o superior. El test de ida y vuelta busca una copia del blog en `../js-pablogarcor-web`. Si la tienes en otro sitio:

```sh
BLOG_DIR=/ruta/al/blog node --test
```

Si no encuentra el blog, ese test se salta y el resto se ejecuta igual.

Qué se comprueba:
- **`corpus.test.js`**, para cada post real:
  - escribirlo sin tocar devuelve el mismo fichero byte a byte;
  - cada bloque escrito desde el modelo se verifica;
  - el post entero escrito desde el modelo da los mismos bloques y el mismo front matter;
  - el estilo de la casa es estable.

  Estado actual: 23/23 posts sin pérdidas. 14/23 salen idénticos escritos desde el modelo y 741/767 bloques también. El resto difiere solo en espacios al final de línea, dobles líneas en blanco y `_cursiva_` frente a `*cursiva*`.
- **`fuzz.test.js`**: 3000 bloques aleatorios con marcas mezcladas y los caracteres que suelen romper Markdown. Con semilla fija, así que un fallo se puede reproducir. En desarrollo se pasó con 150.000 casos sin fallos.
- **El resto de tests** cubren el modelo, el parser de bloques, el front matter, las reglas de Hugo y la publicación contra una API de GitHub falsa en memoria.

El workflow también comprueba los tipos JSDoc de `src/` con `tsc -p jsconfig.json`. El código sigue siendo JavaScript: `tsc` solo lo lee. Se descarga con `npx` en el CI, así que no hace falta `package.json`. Para ejecutarlo en local necesitas TypeScript instalado globalmente (`npm install -g typescript`).

El workflow `.github/workflows/test.yml` ejecuta los tests contra el blog en cada push y también cada lunes. Así, si un post nuevo usa algo que el parser no entiende, te enteras.

## Límites conocidos

- El parser de verificación sigue CommonMark 0.31, que trata los emojis como puntuación. Goldmark, el parser de Hugo, podría diferir en casos muy rebuscados de emoji pegado a `**`.
- Las extensiones de Hugo se tratan de forma conservadora:
  - las tablas quedan como `raw`;
  - `~~` se escapa;
  - `: ` al principio de línea se escapa, para no crear una lista de definiciones.
- Los enlaces de referencia (`[texto][id]`) no se interpretan.
- `src/media/webp.js` depende de `OffscreenCanvas` y de que el navegador sepa codificar WebP. Chrome y Firefox pueden; si el navegador no puede, lo avisa con un error.

## Siguiente fase

- Pegar HTML o texto convirtiéndolo a bloques.
- Arrastrar imágenes, que pasan por `media/webp.js`.
- `src/storage/drafts.js`: borradores en IndexedDB.
- Pantalla de publicación:
  - muestra los errores y avisos de `validatePost` y `checkIdentity`;
  - llama a `planPublish` y después a `publishFiles`.
