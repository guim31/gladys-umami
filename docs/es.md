# Umami

[Umami](https://umami.is/) es una herramienta de analítica web sencilla y
respetuosa con la privacidad, libre (MIT), autoalojada o en Umami Cloud. Esta
integración lleva las cifras de sus sitios Umami a Gladys: cada sitio se
convierte en un dispositivo con sus visitantes ahora mismo y sus visitantes,
visitas, páginas vistas, tasa de rebote y página más vista del día. Las
escenas pueden reaccionar a un pico de visitantes, al primer visitante del día
o a un sitio que ya no recibe visitas (script de seguimiento roto), un widget
del panel resume el día de un vistazo, y una acción de escena pone las cifras
de un sitio en un mensaje.

Probada con un Umami 3.4.0 y 2.19.0 autoalojado real (Docker, PostgreSQL);
todavía no con Umami Cloud: sus comentarios son bienvenidos en
[las issues](https://github.com/guim31/gladys-umami/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- Un Umami: en [Umami Cloud](https://cloud.umami.is/), o su propio servidor
  (Umami 2 o 3), accesible desde la máquina de Gladys.
- Para conectarse, una de estas opciones:
  - Umami Cloud: una **clave de API**;
  - su servidor, desde Umami 3.4: una **clave de API** (empieza por `umami_`);
  - su servidor, cualquier versión: un **nombre de usuario y su
    contraseña**. Basta un usuario con el rol «solo lectura», y la cuenta no
    debe usar la doble autenticación.

En cada actualización, la integración envía dos peticiones por sitio
(visitantes ahora mismo, cifras del día), más la página más vista cada 5
minutos, las visitas de las últimas horas cada 15 minutos y la lista de sitios
cada 10 minutos. En Umami Cloud (50 peticiones por 15 segundos), la integración se frena a sí misma a 40 peticiones por 15 segundos: con muchos sitios, elija un intervalo más largo para que cada lectura llegue a tiempo. Gladys acepta 300 estados por minuto: con el intervalo de 30 segundos, añada como máximo 25 sitios a Gladys.

## Primeros pasos

### 1. Crear una clave de API, o un usuario

- Umami Cloud, o su servidor desde Umami 3.4: en Umami, abra **Settings → API
  keys**, cree una clave y cópiela (solo se muestra una vez).
- Si no: en **Settings → Users**, cree un usuario con el rol **View only** y
  dele acceso a los sitios (o use su propia cuenta).

### 2. Configurar la integración

En Gladys, abra **Integraciones → Umami → Configuración**:

- **Dirección de Umami**: vacía para Umami Cloud, o la dirección de su
  servidor (por ejemplo `http://192.168.1.10:3000`). Se entiende una dirección
  copiada del navegador.
- **Clave de API**, o **Nombre de usuario** y **Contraseña**: vea arriba. Con
  una clave de API, el usuario y la contraseña no se usan.
- **Intervalo de actualización**: de 30 segundos a 5 minutos (1 minuto por
  defecto).
- **Pico de visitantes a partir de**: los visitantes simultáneos que activan
  «Pico de visitantes» (10 por defecto).
- **Sin visitas desde hace (horas)**: las horas sin ninguna visita que activan
  «Sin visitas desde hace un tiempo» (24 por defecto).
- **Idioma de los nombres**: idioma de los nombres de las funciones y de los
  resultados de escena (francés por defecto).

Guarde y haga clic en **Probar la conexión**: el resultado indica el número de
sitios, los visitantes del día y los de ahora mismo.

### 3. Añadir los sitios

Abra la pestaña **Descubrir**: cada sitio se propone con su nombre. Añada los
que quiera ver en Gladys. Los disparadores de escena y el widget funcionan para
todos los sitios, añadidos o no.

## Los dispositivos

Cada sitio se convierte en un dispositivo con:

- **Visitantes ahora mismo**: los visitantes de los últimos 5 minutos, como en
  la página «Realtime» de Umami.
- **Visitantes hoy**: visitantes únicos desde la medianoche.
- **Visitas hoy**: visitas (sesiones) desde la medianoche.
- **Páginas vistas hoy**: páginas vistas desde la medianoche.
- **Tasa de rebote hoy**: la parte de las visitas que vieron una sola página,
  en porcentaje.
- **Página más vista hoy**: su ruta, por ejemplo `/posts/hello`; «-» antes de
  la primera página vista del día.

«Hoy» empieza a medianoche en la zona horaria de Gladys: las cifras del día
vuelven a 0 a medianoche. Un valor que no cambia se envía de nuevo cada 12
horas, para que Gladys lo mantenga reciente.

## Panel

El widget **Umami hoy** muestra cuatro mosaicos (visitantes ahora mismo,
visitantes, visitas y páginas vistas del día), sumados sobre los sitios
mostrados, y luego una línea por sitio con sus visitantes del día y de ahora
mismo, el más visitado primero. Con un solo sitio, se muestra en su lugar la
página más vista del día. En los ajustes del widget, elija algunos sitios para
mostrar solo esos (dispositivos añadidos a Gladys). El botón **Actualizar**
vuelve a leer Umami.

## Escenas

### Desencadenantes

- **Pico de visitantes**: los visitantes actuales de un sitio alcanzan el
  umbral de la configuración. Una vez por pico, y al menos 30 minutos entre dos avisos para un sitio: un pico aún en curso al final de la pausa se anuncia en ese momento. Variables: nombre del sitio,
  dominio, visitantes ahora mismo, umbral.
- **Primer visitante del día**: un sitio recibe su primer visitante desde la
  medianoche. Variables: nombre del sitio, dominio, visitantes hoy. Si la integración estaba detenida, el primer visitante se anuncia en la primera lectura tras su reinicio.
- **Sin visitas desde hace un tiempo**: un sitio que tenía visitas no recibe
  ninguna durante las horas de la configuración: quizá el script de
  seguimiento falla, o el sitio está caído. Una vez, hasta que vuelva una
  visita. Variables: nombre del sitio, dominio, horas sin visitas.

Cada disparador puede limitarse a algunos sitios (vacío: todos). Lo que
recuerdan los disparadores se guarda en el volumen `/data`: un reinicio de
Gladys o de la integración no anuncia dos veces un pico o un primer visitante.
No se anuncia nada en la primera lectura de un sitio: un pico o un silencio ya
en curso solo se registra.

### Acciones

- **Leer las cifras de un sitio**: da el nombre (`name`), los visitantes ahora
  mismo (`active`), los `visitors`, `visits`, `pageviews` y `bounce_rate` del
  día, la página más vista (`top_page`) y una frase lista (`sentence`), por
  ejemplo «Blog: 132 visitante(s) y 410 página(s) vista(s) hoy, 4 ahora
  mismo, página más vista /posts/hello.».

### Ideas de escenas

- Cuando **Pico de visitantes** se active para su tienda, envíe un mensaje de
  Telegram «Afluencia en {{website}}: {{visitors}} visitantes ahora mismo».
- Cuando **Sin visitas desde hace un tiempo** se active, envíe una
  notificación «Ninguna visita en {{website}} desde hace {{hours}} h: revise
  el script de seguimiento».
- Cada noche a las 21:00, **Leer las cifras de un sitio** y enviar la frase
  por mensaje.
- Con la función **Visitantes ahora mismo** como condición de escena,
  encienda una lámpara en verde mientras haya alguien en el sitio.

## Solución de problemas

- **«Umami Cloud: pegue su clave de API»**: la dirección está vacía, así que
  la integración usa Umami Cloud. Indique la dirección de su servidor si aloja
  Umami usted mismo.
- **«clave de API, nombre de usuario o contraseña rechazados»**: copie de
  nuevo la clave, o compruebe el usuario y la contraseña iniciando sesión en
  Umami con ellos.
- **«esta cuenta usa doble autenticación»**: cree una clave de API (Umami
  3.4+), o un usuario dedicado de solo lectura sin doble autenticación.
- **«no hay ningún Umami en esta dirección»**: compruebe la dirección y el
  puerto (3000 por defecto). Detrás de un proxy inverso con subruta
  (`BASE_PATH`), inclúyala.
- **«la dirección redirige»**: introduzca directamente la dirección
  `https://`.
- **«demasiadas peticiones»**: elija un intervalo más largo.
- Falta un sitio: el usuario o la clave debe tener acceso a él (sitios de un
  equipo incluidos). La lista se vuelve a leer cada 10 minutos, o con
  **Buscar** en la pestaña Descubrir.
- Los registros de la integración (**Integraciones → Umami**) dicen más; no se
  escribe nada en ellos durante un ciclo de lectura normal.

## Límites

- Solo lectura: la integración no modifica nada en Umami.
- Las cifras son las de Umami en el momento de la lectura, con el intervalo de
  actualización como retraso. «Visitantes ahora mismo» es la ventana de 5
  minutos de Umami.
- Una sola cuenta de Umami (Cloud o servidor) por integración.
- Los umbrales de «Pico de visitantes» y «Sin visitas desde hace un tiempo» son
  los mismos para todos los sitios.
- Umami 1 no es compatible (su API es diferente). Los sitios de un equipo se leen desde Umami 3; en Umami 2, solo los de la cuenta o de los equipos que posee o gestiona.
- Todavía no probada con Umami Cloud, y sin relación con Umami Software.
