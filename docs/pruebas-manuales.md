# Pruebas manuales del editor

Lo que depende del navegador y no cubren los tests de Node: eventos de teclado reales, cursor, composición y portapapeles. Pásalas en **Chrome y Firefox** antes de mergear cambios en `src/editor/editor.js`, `src/editor/selection.js` o `src/editor/view.js`.

Arranca con `node serve.js`, abre http://localhost:8000 y despliega el panel **Markdown** al final de la página: ahí se comprueba el resultado de cada prueba.

## Abrir y no tocar

- [ ] Abre un post con imágenes (`index.md` + sus `.webp`). Se ven las imágenes y la barra dice «sin cambios».
- [ ] Haz clic en varios sitios sin escribir. Sigue «sin cambios».
- [ ] Recarga sin haber cambiado nada: no pregunta si quieres salir.

## Escribir

- [ ] Escribe en medio de un párrafo. El texto aparece donde está el cursor y el cursor avanza.
- [ ] Escribe justo después de una palabra en **negrita**: lo nuevo sale en negrita. Después de un `código` o un enlace, no.
- [ ] Selecciona una palabra y escribe: la sustituye.
- [ ] Tildes con tecla muerta (´ y luego a → á), la ñ y la diéresis (¨ y u → ü). Salen bien, una sola vez y el cursor queda detrás.
- [ ] Un emoji (Super+. o el selector del sistema). Backspace lo borra entero de una vez, también 👍🏽.

## Enter y Shift+Enter

- [ ] Enter en medio de un párrafo lo divide en dos; el cursor queda al principio del segundo.
- [ ] Enter al final de un título crea un párrafo debajo. Al principio de un título, crea un párrafo encima.
- [ ] Enter en un elemento de lista crea otro elemento. Enter otra vez (elemento vacío) sale de la lista a un párrafo.
- [ ] En una lista numerada, sal de la lista desde un elemento del medio: quedan dos listas y la segunda conserva su numeración.
- [ ] Shift+Enter en un párrafo hace un salto de línea (en el Markdown, `\` al final de la línea). En un título no hace nada.

## Borrar

- [ ] Backspace al principio de un párrafo lo une al anterior, y el cursor queda en el punto de unión.
- [ ] Backspace al principio de un título o una cita lo convierte en párrafo.
- [ ] Backspace al principio del segundo elemento de una lista lo une al primero. En el primero, lo saca de la lista.
- [ ] Backspace justo después de una imagen no la borra. Si el párrafo está vacío, desaparece el párrafo.
- [ ] Supr al final de un párrafo une el siguiente.
- [ ] Ctrl+Backspace y Ctrl+Supr borran palabra a palabra.
- [ ] Selecciona desde la mitad de un párrafo hasta la mitad de otro, con una imagen en medio, y pulsa Backspace: se borra todo lo seleccionado, imagen incluida, y los dos trozos quedan unidos.
- [ ] Ctrl+A y Backspace: queda el primer bloque, vacío, y se puede escribir en él. Límite conocido: una imagen o un bloque de código antes del primer texto o después del último no se borra, porque la selección solo llega hasta los bloques de texto.
- [ ] Ctrl+X corta (y se puede pegar en otro programa).

## Deshacer

- [ ] Escribe una frase y pulsa Ctrl+Z: se deshace entera de una vez.
- [ ] Ctrl+Z varias veces hasta el principio: la barra vuelve a «sin cambios».
- [ ] Ctrl+Shift+Z y Ctrl+Y rehacen. El cursor vuelve a donde estaba.

## Pegar

- [ ] Pega texto con líneas en blanco desde otro programa: cada bloque de texto es un párrafo.
- [ ] Copia un trozo de una web con títulos, listas, negritas y enlaces, y pégalo en medio de un párrafo: el primer párrafo pegado se une al texto anterior y el último al posterior; el formato se conserva.
- [ ] Pega desde Google Docs: lo que no es negrita no sale en negrita.
- [ ] Pega algo con imágenes: no entran, y la barra de estado dice cuántas se han omitido.
- [ ] Ctrl+Shift+V pega sin formato.
- [ ] Arrastra texto dentro del editor: no pasa nada.

## Imágenes

- [ ] Con un slug puesto, **Imagen…** con una foto JPEG grande: se convierte (la consola muestra el tamaño), se llama `<slug>.webp`, aparece después del bloque del cursor y el foco está en su texto alternativo.
- [ ] Arrastra una imagen PNG sobre un párrafo: queda después de ese párrafo y se llama `<slug>-2.webp`.
- [ ] Pega una captura de pantalla (Impr Pant y Ctrl+V): se añade igual.
- [ ] Sin texto alternativo, la lista de avisos lo dice; al escribirlo, el aviso desaparece.
- [ ] En Firefox, las imágenes también se convierten (si el navegador no sabe codificar WebP, lo dice la barra de estado).

## Barra de herramientas

- [ ] Selecciona texto y pulsa N (o Ctrl+B): queda en negrita y el botón se marca. Otra vez: se quita. Igual con K (Ctrl+I) y `</>` (Ctrl+E).
- [ ] Sin seleccionar nada, Ctrl+B, escribe, Ctrl+B, escribe: solo lo de en medio sale en negrita.
- [ ] Selecciona texto de dos párrafos y ponlo en cursiva: se aplica a las dos partes.
- [ ] Ctrl+K con texto seleccionado abre el panel de enlace. `javascript:alert(1)` da error; `ejemplo.com` se guarda como `https://ejemplo.com`. Enter aplica, Escape cancela y devuelve el cursor al texto.
- [ ] Con el cursor dentro de un enlace, Ctrl+K muestra su dirección y permite cambiarla o quitarla.
- [ ] Ctrl+K sin selección y fuera de un enlace avisa en la barra de estado.
- [ ] El selector de tipo refleja el bloque del cursor. Cambiar a Título 2, Cita, Lista y Lista numerada funciona; elegir el mismo tipo otra vez lo devuelve a párrafo.
- [ ] Selecciona tres párrafos y elige Lista: queda una sola lista de tres elementos.
- [ ] En una lista de cuatro elementos, selecciona el segundo y el tercero y elige Párrafo: la lista se parte en dos y la segunda mantiene su numeración.
- [ ] Separador y Bloque de código se insertan después del bloque del cursor; el bloque de código recibe el foco.
- [ ] En un bloque de código, escribe varias líneas (Enter hace salto de línea, no un bloque nuevo) y un lenguaje. El Markdown lo refleja y el foco no salta.
- [ ] En una imagen, cambia el texto alternativo. Ctrl+Z dentro del campo deshace en el campo; fuera, deshace el cambio entero.
- [ ] El botón × elimina imágenes, separadores, bloques de código y bloques sin editar. Ctrl+Z los recupera.
- [ ] Los botones ↶ ↷ deshacen y rehacen, y se desactivan cuando no hay nada que deshacer o rehacer.

## Datos del post

- [ ] **Nuevo post**: el foco está en el título, la fecha es la de hoy y la lista de avisos dice que falta el título y que el post está vacío.
- [ ] Escribe un título con tildes y signos (`¿Qué es Hugo?`): el slug y el translationKey se rellenan solos (`que-es-hugo`).
- [ ] Escribe el slug a mano: deja de seguir al título; el translationKey sigue al slug. Vacía el slug: vuelve a seguir al título.
- [ ] Etiquetas `a, b, A,`: mientras escribes no se borra la coma; al salir del campo quedan `a, b`.
- [ ] La descripción muestra el contador y se pone en rojo pasados 160 caracteres (aviso en la lista).
- [ ] Ctrl+Z en el texto deshace también los cambios del formulario, y los campos se actualizan.
- [ ] Abre un post publicado: slug y translationKey son de solo lectura y no aparece el idioma. Cambia el título: en el panel Markdown solo cambia la línea `title:`.

## Resto

- [ ] **Nuevo post** con cambios pendientes pregunta antes de descartarlos.
- [ ] Recarga con cambios: el navegador avisa antes de salir.
- [ ] En la consola del navegador no hay errores, tampoco de CSP.
