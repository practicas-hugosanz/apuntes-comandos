# Apuntes de comandos Linux y PowerShell

Apuntes de estudio + **simulador de terminal** para practicar el examen.

Abre `index.html` (no necesita servidor ni instalar nada).

## Qué hay

- **Linux** y **PowerShell**: apuntes, cómo responder en el examen y banco de ejercicios con las soluciones.
- **Simulador** (pestaña nueva): terminal simulado de Linux (bash) y de PowerShell 5.1, con ~220 ejercicios del banco
  agrupados en series. El estado de ficheros se arrastra de un ejercicio al siguiente, como en el examen.
  - *Modo práctica*: vale cualquier comando que haga lo mismo que la solución; con pistas.
  - *Modo examen*: la respuesta se compara como texto y debe empezar por `$ ` (Linux) o `> ` (PowerShell).
  - *Terminal libre*: sandbox para probar comandos.

## Estructura

| Fichero | Contenido |
| --- | --- |
| `index.html` | Apuntes y página principal |
| `datos.js` | Bancos de ejercicios `E` (Linux) y `P` (PowerShell) |
| `js/vfs.js` | Sistema de ficheros virtual (inodos, enlaces duros/simbólicos, permisos, comodines) |
| `js/linux.js` | Shell Linux: tuberías, redirecciones, comodines y ~50 comandos |
| `js/pwsh.js` | PowerShell: cmdlets, alias, canalización de objetos, script blocks sencillos |
| `js/ejercicios.js` | Series de ejercicios y corrector |
| `js/terminal.js` | Interfaz del terminal y del panel de ejercicios |
| `css/estilo.css`, `css/simulador.css` | Diseño |
