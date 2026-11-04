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
| Interfaz del editor (`index.html`, vista, barra de herramientas) | **Pendiente** |
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
│   └── history.js    Deshacer/rehacer agrupando la escritura seguida.
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
└── media/
    └── webp.js     Imagen → WebP con OffscreenCanvas.
tests/              node --test, sin librerías.
```

Por qué está separado así:

- **`model/` y `markdown/` no tocan el DOM.** Por eso se pueden probar en Node, incluido el test que pasa por todos los posts reales.
- **`hugo/` es la única capa que conoce tu blog.** Rutas, orden del front matter, slug y `translationKey` viven ahí. Si cambias el blog, solo tocas ese módulo.
- **`github/` es lo único que habla con la red y lo único que ve el token.**

## Cómo se conserva tu Markdown

Cada bloque que viene de un post existente guarda dos cosas:
- **`raw`**: el texto exacto del que salió.
- **`sep`**: lo que había justo antes de él.

Mientras no tocas un bloque, se vuelve a escribir desde `raw`. Así, abrir un post de 2024, corregir una frase y publicar produce un PR que solo cambia esa frase: los espacios al final y las dobles líneas en blanco de alrededor se quedan como estaban. Al editar un bloque, ese bloque pasa a escribirse desde el modelo con el estilo de la casa (`*` en listas, `**negrita**`, `*cursiva*`, `**_ambas_**`).

Cada bloque escrito desde el modelo se verifica: se vuelve a parsear y tiene que dar exactamente el mismo bloque. Si no lo da, se reintenta escapando más. Algunos casos no se pueden expresar con `**` o `_` según CommonMark, como `**"cita"**palabra`, donde la negrita acaba en puntuación pegada a una letra. En esos casos se escribe la letra vecina como entidad (`&#x70;`), que se ve igual. Es la misma solución que usa remark.

Lo que el editor no sabe editar visualmente se queda como bloque `raw`: tablas, HTML, listas anidadas, citas o elementos de lista con varios párrafos, shortcodes y definiciones de enlaces de referencia. El editor lo mostrará como Markdown en crudo. Ahora mismo ninguno de tus posts tiene bloques así.

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

- `index.html` y `src/editor/`:
  - cada bloque es un `contenteditable` propio;
  - se capturan los eventos `beforeinput` y se aplican al modelo con las funciones de `model/`;
  - la vista se vuelve a pintar desde el modelo.
- Barra de herramientas: negrita, cursiva, código, enlace y tipo de bloque.
- Pegar HTML o texto convirtiéndolo a bloques.
- Arrastrar imágenes, que pasan por `media/webp.js`.
- `src/storage/drafts.js`: borradores en IndexedDB.
- Pantalla de publicación:
  - muestra los errores y avisos de `validatePost` y `checkIdentity`;
  - llama a `planPublish` y después a `publishFiles`.
