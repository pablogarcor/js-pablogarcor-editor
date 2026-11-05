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
- [ ] Pega texto con formato desde una web: entra como texto plano, sin HTML.
- [ ] Arrastra texto o un fichero sobre el editor: no pasa nada (de momento).

## Resto

- [ ] Las imágenes, los bloques de código y los bloques «Markdown sin editar» no se pueden modificar.
- [ ] **Nuevo post** con cambios pendientes pregunta antes de descartarlos.
- [ ] Recarga con cambios: el navegador avisa antes de salir.
- [ ] En la consola del navegador no hay errores, tampoco de CSP.
