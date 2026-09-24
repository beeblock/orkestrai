<p align="center">
  <img src="orkestrai-branding/logo.svg" alt="Orkestrai" width="360">
</p>

<p align="center">
  <strong>Orquesta equipos de IA para crear, diseñar, promocionar y entregar en un lienzo visual.</strong>
</p>

<p align="center">
  <a href="https://github.com/beeblock/orkestrai/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/beeblock/orkestrai?label=release&color=f3c34f"></a>
  <img alt="macOS, Windows y Linux" src="https://img.shields.io/badge/desktop-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-171b20">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/beeblock/orkestrai?color=171b20"></a>
</p>

<p align="center">
  <a href="https://github.com/beeblock/orkestrai/releases/latest"><strong>Descargar para macOS, Windows o Linux</strong></a> · <a href="https://orkestrai.app/es">orkestrai.app</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · Español
</p>

<p align="center"><img src="docs/media/readme/orchestrate.webp" alt="El agente Maestro crea una tarea por el puente de Orkestrai, delega un comando al agente Frontend y recibe la respuesta en el canvas" width="880"></p>

Orkestrai es una aplicación de escritorio local-first para macOS, Windows y
Linux. Reúne Claude Code, Codex CLI, Kimi Code, OpenCode, Cursor, Antigravity,
Cline, Devin, shells, tareas, notas,
navegadores y worktrees de Git en un lienzo persistente donde developers, vibe
coders, diseñadores, marketers y creators pueden dirigir un equipo de IA.

## Míralo en acción

Cada clip de abajo se grabó en la app real: terminales, comandos y resultados
reales, sin nada simulado. Míralos con subtítulos en español, inglés y portugués
en [orkestrai.app](https://orkestrai.app/es).

### Arma el equipo en el canvas

Arrastra terminales, notas, tableros de tareas, flujos y más desde el dock
directamente al canvas, anota lo que el equipo necesita saber y conéctalo al
agente correcto.

<p align="center"><img src="docs/media/readme/canvas-tools.webp" alt="Arrastrando herramientas del dock al canvas de Orkestrai y conectando una nota a un agente" width="880"></p>

### Trabaja lado a lado en el Workbench

Pasa del canvas al Workbench en un clic, arrastra elementos a paneles divididos y
mantén terminales reales a tamaño completo junto a tableros, notas y archivos.

<p align="center"><img src="docs/media/readme/workbench.webp" alt="Abriendo artefactos del canvas en el Workbench, arrastrándolos a paneles divididos y usando una terminal real" width="880"></p>

### Encadena agentes con aprobación humana

Los flujos pasan el trabajo de un agente al siguiente, esperan tu aprobación y
registran cada ejecución.

<p align="center"><img src="docs/media/readme/flow.webp" alt="Un flujo ejecuta las pruebas en el agente Frontend, espera la aprobación humana y sigue en el Maestro" width="880"></p>

### Automatiza el trabajo recurrente

Crea una automatización en segundos: elige el agente y lo que debe hacer, y
ejecútala ahora o con un disparador.

<p align="center"><img src="docs/media/readme/automations.webp" alt="Creando una automatización en el panel de Automatizaciones y ejecutándola en la terminal de Frontend" width="880"></p>

### Un Segundo cerebro que todo el equipo puede buscar

Importa documentos, sigue cada conexión en el grafo de conocimiento y explóralo en
3D. Los agentes buscan los mismos pasajes con fuente por el puente.

<p align="center"><img src="docs/media/readme/knowledge.webp" alt="Importando documentos al Segundo cerebro y explorando el grafo de conocimiento en 3D" width="880"></p>

### Convierte código real en diseño nativo

Importa un diseño desde el código de tu proyecto, refínalo en el inspector y
convierte cada cambio en una revisión que vuelve como código.

<p align="center"><img src="docs/media/readme/design.webp" alt="Un diseño importado del código del checkout y refinado en el inspector de diseño de Orkestrai" width="880"></p>

### Genera imágenes consistentes con Codex

Las referencias y el contexto se vuelven un atlas del personaje, y el Codex
conectado genera cada imagen directo en tu workspace: seis vistas, el mismo
personaje.

<p align="center"><img src="docs/media/readme/image-flow.webp" alt="Un flujo de imagen convierte un atlas de referencia en seis vistas consistentes del mismo personaje" width="880"></p>

### Produce video con el proveedor que elijas

Las escenas aprobadas alimentan flujos de video en fal.ai, BytePlus ModelArk o
Higgsfield, con vista previa de costo antes de cada ejecución. Los clips se
vuelven la película final en una secuencia en el canvas.

<p align="center"><img src="docs/media/readme/video-flow.webp" alt="Escenas aprobadas alimentan flujos de video; los clips generados se reproducen en el canvas y se vuelven la película final" width="880"></p>

### Sigue el workspace desde el celular

Escanea el código QR, aprueba el dispositivo exacto en el host y sigue agentes,
tareas y actividad desde cualquier navegador. Las terminales solo se abren cuando
concedes ese acceso al dispositivo.

<p align="center"><img src="docs/media/readme/remote.webp" alt="El host comparte el workspace con un código QR, aprueba un celular con acceso a la terminal y el celular ejecuta un comando en la terminal de un agente" width="880"></p>

## Todas las funciones

<details>
<summary><strong>Todo lo que hace Orkestrai</strong> (haz clic para expandir)</summary>

- **Segundo cerebro nativo:** arrastra PDF, Markdown, XLSX, CSV y otros archivos al Canvas como nodos. Busca pasajes con fuentes junto a notas, tareas y memoria; explora etiquetas, backlinks y grafo en Canvas o Workbench. Extracción local con límites y actualización explícitos; los PDF escaneados y mixtos reciben OCR sin conexión en inglés, portugués y español con modelos integrados, cita de página y confianza del reconocimiento; los originales se mantienen intactos.
- **Aprendizaje duradero de agentes:** conserva lecciones con evidencia entre sesiones y proveedores. Elige automático, revisión o desactivado; revisa historial y activa, rechaza o archiva lecciones. Las tareas reciben lecciones relevantes mediante CLI/MCP, sin cambiar permisos ni entrenar pesos del modelo. Guía y tour en Cómo usar > Segundo cerebro.

- **Asistentes continuos en el escritorio:** supervisa una conversación autorizada,
  agrupa los mensajes recibidos y deja que el agente del Canvas responda con una
  persona consistente. Memoria privada opcional, voces locales y recordatorios de
  calendario vinculados a tareas respetan la autorización del contacto. Los adjuntos
  dependen de los controles de la aplicación; los archivos de audio no son notas de
  voz nativas. La observación funciona en segundo plano; el envío puede requerir
  foco temporal. Configúralo en **Computadora > Respuestas de conversación** y
  **Automatizaciones**.

- **Base del Core 24/7:** actívala para mantener el Core de ejecución local y el
  trabajo activo disponibles en la bandeja después de cerrar todas las ventanas
  y, si quieres, iniciarlo silenciosamente al entrar al sistema. Configuración
  muestra el estado y tiempo activo, permite un reinicio protegido y conserva
  **Salir de Orkestrai** como la parada explícita.
- **Autonomía limitada y Bóveda cifrada:** aprueba una vez el perímetro
  rutinario del workspace en vez de supervisar cada comando. Capacidades,
  raíces, hosts, horario silencioso y concurrencia forman la autorización
  permanente; las acciones destructivas o externas pueden exigir al responsable,
  un revisor o el Council. Las credenciales permanecen en el almacén cifrado del
  sistema operativo y llegan a conectores confiables solo mediante SecretRefs
  vinculados al destino. La parada de emergencia aborta ejecuciones activas y la
  exportación encadenada separa acciones mediadas exactas de efectos inferidos del shell.
- **Agentes persistentes e integraciones nativas:** elige runtimes Interactivo,
  Bajo demanda o Persistente y conecta Gmail, Slack, Telegram, WhatsApp, GitHub
  o webhooks con permisos por operación. Los agentes pueden leer buzones
  autorizados, clasificar trabajo y entregar informes o PDFs sin recibir el token.
- **Control limitado del escritorio:** pide al agente que abra Calculadora o
  use el navegador con sesión iniciada en el escritorio, localmente o por Remote.
  Crea la nota, la tarea y el nodo Equipo; tú autorizas las aplicaciones y los
  permisos del sistema, sin montar el flujo manualmente. El nodo opera solo aplicaciones y
  pantallas aprobadas en macOS, Windows y Linux X11 compatible, con comandos
  tipados, idempotencia, evidencia confinada y auditoría sin contenido escrito.
  Consulta la [guía de Computer Control](docs/computer-control.md) para comandos,
  gates, credenciales protegidas y limitaciones por plataforma.
- **Tool Workshop:** convierte trabajo repetido en una herramienta nativa y
  versionada del workspace sin editar Orkestrai. Compone integraciones, HTTP,
  transformaciones deterministas o comandos confinados; valida contratos JSON y
  fixtures, ejecuta una prueba seca y publica una revisión inmutable. Los agentes
  pueden proponer borradores, pero solo el dueño activa una versión. Las
  automatizaciones ejecutan la revisión aprobada con idempotencia, límites,
  SecretRefs vinculadas al destino, historial saneado y los mismos gates y auditoría.
- **Lienzo de agentes en vivo:** organiza terminales PTY reales, notas, tableros
  de tareas, portales de navegador, árboles de archivos, loops y formas. Las
  conexiones muestran la colaboración entre agentes mientras ocurre. La física
  se adapta a la densidad, y Configuración permite forzar líneas elásticas o
  conexiones totalmente estáticas, sin física ni animación, en equipos menos
  potentes. Duplica
  formas estilizadas con Cmd/Ctrl+D o copia y pega arreglos visuales completos
  conservando su distribución relativa.
- **Creación organizada de workspaces:** crea un workspace normal o basado en
  preset directamente dentro de una carpeta anidada validada de la barra
  lateral, desde el encabezado de la carpeta o el diálogo de Nuevo workspace,
  sin un elemento intermedio en la raíz.
- **Workbench configurable:** mantén abiertas terminales, tableros, notas,
  portales, archivos, flujos y uso en pestañas verticales por defecto u
  horizontales opcionales, y organiza hasta ocho artefactos en vivo en divisiones
  redimensionables hacia la derecha o abajo. Las pestañas se mueven entre paneles
  arrastrando o con un menú accesible. El Workbench referencia los artefactos
  del canvas sin duplicar sesiones, mientras los archivos permanecen como
  pestañas locales, y la esfera de voz sigue el workspace activo.
  El pie mantiene visibles todas las ventanas de cuota informadas por Claude,
  Codex y Kimi sin abrir otro panel.
- **Grafo nativo de inteligencia de código:** indexa de forma segura repositorios
  TypeScript, JavaScript, Svelte y PHP aprobados sin ejecutar código del proyecto.
  Busca símbolos, rutas, firmas y docblocks y explora imports, llamadas,
  instancias, herencia e implementaciones entrantes y salientes en el mismo nodo
  de Canvas y Workbench. Los agentes consultan ese grafo persistido mediante MCP
  tipado o `orkestrai graph`; los repositorios hermanos autorizados siguen como
  proyectos separados y nunca se exponen SQL ni Cypher arbitrarios.
- **Cliente de API nativo:** crea y ejecuta solicitudes HTTP/REST, GraphQL,
  WebSocket y gRPC junto al equipo, con autenticación Bearer/Basic/clave API u
  OAuth 2.0, cookies, proxy, CA y certificados. Los scripts importados de Postman
  se ejecutan con Postman Runtime oficial; Bruno y OpenCollection usan el runtime
  QuickJS seguro oficial de Bruno. Ámbitos separados, sendRequest/runRequest,
  cookies, flujo de colección, visualizaciones, bibliotecas incluidas, Chai y APIs legadas permanecen
  disponibles, mientras el vault cifra valores con el sistema operativo. Los
  runners aceptan datos JSON por iteración. Importa y exporta Bruno,
  OpenCollection, Postman, OpenAPI y la copia `.orkestrai-api.json` sin pérdidas.
  El mismo nodo persiste en Canvas y Workbench y los agentes conectados ejecutan
  solicitudes por tools MCP sin recibir credenciales. Package Library, datasets
  y otros servicios en la nube de Postman siguen dependiendo del backend
  Postman porque no forman parte del archivo portable de la colección. Los
  scripts Bruno permanecen deliberadamente en el runtime QuickJS seguro oficial:
  no se habilita el acceso NodeVM inseguro al filesystem, procesos ni módulos
  locales arbitrarios del equipo.
- **Flujos nativos de vídeo:** elige fal.ai, BytePlus ModelArk o Higgsfield,
  con cuentas cifradas separadas, contratos revisados y presupuestos previos.
  Busca el catálogo de fal.ai, incluyendo Seedance
  2.5, con contratos por modelo y referencias de imagen, video y audio. Cuenta, modelos,
  agentes, envío de datos y reservas requieren autorización del workspace.
  La clave permanece en la bóveda del escritorio. Ejecuciones persistentes,
  descargas recuperables y nodos de medios conservan los archivos originales en el proyecto,
  Canvas y Workbench. CLI/MCP comparte el contrato; las imágenes Codex no cambian.
  Los personajes aprobados conservan versiones de apariencia y voz. Arrastra desde
  la biblioteca compartida a otro workspace para copiar todas las referencias como
  nodos nativos, sin transferir credenciales ni autorizar generaciones de pago.
- **Producción creativa:** storyboards ordenados, comparación y revisión humana,
  ediciones contextuales, dirección de cámara y kits de marca aprobados en Canvas
  y Workbench. Guarda flujos versionados con referencias locales, guion y formato;
  reutilízalos como storyboards editables, sin copiar credenciales ni iniciar trabajos.
  La cola muestra el estado real de imágenes/vídeos y la recuperación de descargas.
  Monta clips entregados en una Secuencia de vídeo nativa: reordena, recorta,
  subtitula, ajusta el audio y exporta un MP4 local sin alterar los originales.
- **Flujos nativos de imágenes:** conecta Notas, referencias ordenadas de Imagen
  PNG/JPEG/WebP y un agente Codex activo a un nodo Generar imágenes en el mismo
  canvas; el mismo nodo se abre en Workbench. El Codex conectado usa la tool
  nativa `image_gen.imagegen` de su propia sesión autenticada, con una llamada por
  resultado y transparencia PNG real solicitada en el prompt. Orkestrai nunca solicita ni almacena una clave de API
  de imagen. Valida los destinos preasignados dentro del workspace antes de que
  los resultados vuelvan como nodos Imagen conectados, con procedencia e
  historial limitado, listos para alimentar otra rama. Personas, CLI y tools MCP
  tipadas operan el mismo flujo visible.
- **Dispositivos móviles integrados:** agrega un nodo persistente de Dispositivo
  móvil desde la barra del Canvas; Workbench lista y abre el mismo nodo y la misma
  sesión. Controla iPhone y iPad Simulators en Macs Apple Silicon o AVDs Android
  y dispositivos físicos autorizados explícitamente en macOS, Windows y Linux.
  Transmite la pantalla, envía gestos y botones del sistema, instala y abre apps
  del workspace, gestiona permisos, inspecciona logs y accesibilidad limitados y
  guarda capturas. Android usa Platform Tools de Android Studio y el servidor
  scrcpy incluido; WebCodecs decodifica la pantalla. Los agentes ejecutan el mismo
  flujo limitado al workspace mediante la CLI o las tools MCP incluidas.
- **Centro de control operativo:** consulta la tarea actual, estado, duración,
  proveedor, rol y uso de cada agente. La bandeja persistente demuestra si cada
  handoff entró en cola, fue entregado, recibido, respondido o falló bajo un id
  de mensaje, sin despertar terminales inactivos tras reiniciar.
- **Memoria del workspace con fuentes:** conserva decisiones, hechos,
  preferencias, restricciones, referencias y aprendizajes reutilizables con
  evidencia explícita, revisiones inmutables, protección contra conflictos,
  búsqueda e historial de archivo. Los agentes consultan la misma memoria bajo
  demanda mediante tools MCP/CLI tipadas, sin recibirla completa en cada prompt.
- **Anotaciones trazables:** revisa feedback de código y de Design nativo desde
  un Centro de Anotaciones en Canvas o Workbench. Cada elemento conserva su
  artefacto canónico, autor, objetivo, revisión capturada, estado de resolución y
  alerta de código obsoleto; abrirlo vuelve a la revisión o documento original.
- **Team Packs versionados:** convierte un workspace real en un equipo portátil
  con agentes, roles, skills, etapas, rutinas, configuración MCP y layout.
  Versiones semánticas, notas, historial inmutable, verificación SHA-256,
  importaciones limitadas y eliminación del runtime permiten compartir sin
  transportar sesiones ni credenciales.
- **Uso compartido cifrado del workspace (experimental):** aloja una sesión
  cifrada de extremo a extremo, elige una invitación para navegador/móvil u otra
  aplicación instalada, comprueba la huella del dispositivo y asigna el rol
  Lector, Colaborador, Operador o Administrador. La PWA Remote instalable sigue
  el estado sanitizado del equipo, tareas, revisiones, actividad, uso de
  proveedores y mensajes al líder; su clave de emparejamiento no puede extraerse
  del navegador y el secreto sale de la URL antes de conectar. Terminales,
  archivos, notas, portales, credenciales, URLs privadas y rutas locales
  permanecen en el host. El acceso puede revocarse y cada comando queda
  registrado en la auditoría.
- **Centro de revisión Git:** inspecciona cambios staged y unstaged, compara
  archivos en un diff Monaco, crea revisiones vinculadas a tareas y responsables,
  deja comentarios persistentes por archivo y línea, y aprueba, rechaza o solicita
  cambios. El feedback vuelve al agente responsable sin perder el historial.
- **Portal Design Mode:** señala el elemento exacto de la interfaz que necesita
  atención, revisa su captura recortada y contexto visual seguro y registra el
  feedback en una tarea nueva para revisión del líder, una tarea asignada o una
  tarea existente. Los secretos y el estado oculto se excluyen.
- **Modo Diseño nativo:** crea documentos de interfaz en Canvas y abre el mismo
  artefacto en Workbench. Dibuja paths vectoriales editables, combina formas,
  usa máscaras, gradientes, efectos, ajuste, guías, auto layout, grids y
  constraints responsivas; importa imágenes o SVG reutilizables por selector,
  pegado o arrastre y exporta SVG, PNG, JPEG, WebP o PDF. Crea tokens con presets,
  modos, aliases, importación DTCG/CSS, exportación DTCG/CSS/Tailwind y auditoría.
  Convierte frames en componentes con instancias, propiedades, variantes, slots y
  overrides; publica bibliotecas versionadas solo para workspaces autorizados y
  extrae CSS variables, Tailwind y contratos Svelte, React o Vue sin ejecutar
  código del proyecto. Diseñador y líder editan la misma revisión mediante tools
  tipadas mientras la UI se actualiza en vivo. Componentes y tokens están en la
  búsqueda; documentos, assets, miniaturas e historial quedan en
  `.orkestrai/designs` dentro del workspace.
- **Interoperabilidad oficial con Figma:** el MCP oficial administrado ofrece
  contexto de diseño a los agentes compatibles, mientras la pestaña Figma
  nativa inspecciona enlaces e importa páginas o frames, vectores, assets,
  estilos, variables, componentes, variantes, instancias e identidades de
  bibliotecas externas seleccionadas al mismo
  documento Orkestrai. Los orígenes vinculados comparan hashes remotos y locales
  antes de una sincronización selectiva, y los mappings de Code Connect forman
  la relación nodo Figma → capa Orkestrai → código. Un plugin propio incluido en
  la app y restringido al loopback transfiere selecciones en vivo, SVG editable
  o JSON estructural, abre un documento Orkestrai con recursos nativos en una
  nueva página de Figma y envía solo cambios locales vinculados y revisados de
  vuelta al archivo actual. La credencial
  REST queda cifrada en la bóveda del sistema operativo.
- **Decisiones con Council:** abre Consejo desde la barra del Canvas, el workspace
  en Workbench o `Cmd/Ctrl+K` y pide perspectivas independientes y limitadas por
  presupuesto a entre dos y cinco agentes reales sobre una tarea u objetivo,
  compara el mismo contrato de evidencias, riesgos, pruebas, divergencias y
  confianza y registra la selección, solicitud de consenso o rechazo humano.
  Los prototipos permanecen en pisos Git aislados y solo aterrizan después de
  una vista previa segura explícita.
- **Búsqueda universal:** presiona `Cmd/Ctrl+K` para encontrar workspaces,
  agentes, tareas, notas, roles, skills, archivos, configuración y comandos,
  con elementos recientes/favoritos y apertura en el panel actual, derecho o inferior.
- **Editor local completo y vistas previas:** navega por el árbol nativo del
  workspace y abre archivos directamente en pestañas locales del Workbench, sin
  crear nodos en el canvas. Monaco se carga bajo demanda y conserva undo, cursor
  y estado sin guardar
  persistentes, búsqueda/reemplazo, formato, símbolos, minimapa, ajuste de línea
  y guardado automático opcional. Markdown, PDFs e imágenes tienen vista previa
  offline; los binarios muestran metadatos seguros y se abren con la aplicación
  del sistema.
- **Material de referencia compartido:** suelta, pega o selecciona imágenes,
  PDFs, archivos y enlaces HTTP/HTTPS en prompts de agentes, tarjetas, notas y
  composers. Los archivos de hasta 10 MB quedan en el workspace bajo
  `.orkestrai/attachments/`, y el agente recibe el path relativo o URL completo.
- **Modo Maestro:** asigna un líder que puede proponer un equipo, reclutar
  agentes, delegar briefings completos, coordinar el trabajo y retirar agentes
  cuando ya no sean necesarios.
- **Equipos listos:** inicia o amplía un workspace con presets de Producto,
  Campaña y lanzamiento, Brand y diseño, Contenido y SEO, React, Next.js,
  SvelteKit, Svelar, Laravel y Orkestrai Contributing. Los agentes comienzan en
  modo autónomo de acceso total y con roles en el nivel nativo de system/developer
  prompt, con frontmatter válido en el archivo de agente Kimi y sin instrucciones
  largas bloqueando la terminal como texto pegado. El líder recibe y asigna la
  tarea inicial completa sin solicitudes repetidas.
- **Flujos que corresponden al trabajo:** nombra, colorea y ordena hasta diez
  etapas del tablero. Líder y agentes descubren y actualizan el mismo proceso.
- **Vistas operativas del equipo:** instala funciones especializadas desde un
  catálogo de 12 roles o descubre definiciones reutilizables en
  `.orkestrai/roles/` desde otra carpeta de proyecto seleccionada, y consulta
  título, etapa, responsable y estado Git de cada piso. Los roles importados
  tienen límites, se validan y quedan confinados al proyecto elegido.
- **Puente nativo para agentes:** la CLI `orkestrai` y el servidor MCP incluidos
  exponen comandos tipados para mensajes, tareas, notas, portales, dispositivos
  móviles, pisos, roles y notificaciones de escritorio. Codex recibe las
  definiciones MCP de Orkestrai y del Figma oficial como parámetros temporales
  al iniciar, sin reescribir el `~/.codex/config.toml` global del usuario.
- **Workspaces paralelos:** los agentes continúan trabajando cuando cambias de
  workspace, con indicadores de actividad y notificaciones nativas.
- **Runtimes Windows y WSL combinados:** define el entorno predeterminado del
  workspace y deja que cada terminal lo herede, use Windows nativo o apunte a
  una distribución WSL y ruta Linux exactas. Detección de providers, sesiones,
  reanudación, Council, agentes reclutados y puente siguen a cada terminal, para
  combinar herramientas de Windows, Ubuntu o Debian en un mismo equipo.
- **Pisos Git:** aísla el trabajo en worktrees, inspecciona conflictos e integra
  cambios terminados desde el lienzo.
- **Voz local:** dicta en cualquier campo de texto o usa el atajo del workspace sin
  foco para el líder y escucha respuestas en portugués de Brasil, inglés de
  Estados Unidos o español latinoamericano. El indicador de la esfera muestra si
  está fijada o libre y abre directamente los controles de posición; el tooltip
  también presenta el atajo de la plataforma. STT y TTS se ejecutan localmente.
- **Delegación según la cuota:** fija el uso de Claude, Codex y Kimi en el canvas,
  configura origen, fallback, ventana de 5 horas/semanal/mensual y límite, y deja
  que el líder consulte la misma recomendación por CLI o MCP antes de asignar
  trabajo nuevo.
- **Apariencia personalizada:** parte del sistema oscuro grafito y dorado de la
  marca o del tema claro de alto contraste, elige los demás temas incluidos o
  duplica uno y edita tokens semánticos con vista previa e importación/exportación JSON.
- **Terminales legibles:** elige 1 de 10 paletas ANSI completas desde el menú
  compacto de la terminal, junto a los controles de provider, rol, recarga y Maestro.
- **Controles operativos:** administra puertos de portales locales, configura
  rutinas recurrentes e instala skills desde el marketplace.
- **Central de Providers:** detecta localmente las nueve CLIs compatibles, sigue
  la instalación adecuada al sistema y el inicio de sesión oficial, y elige
  perfiles de cuenta con nombre al crear agentes sin persistir credenciales en
  el canvas.
- **Barra de agentes personal:** elige cualquier servicio desde un menú Agentes
  compacto y fija hasta cuatro favoritos listos entre workspaces y reinicios.
- **Providers reemplazables:** cambia un miembro de Claude a Codex, Kimi u otro
  provider instalado conservando su rol, piso y conexiones.
- **Continuidad de sesión:** cada terminal reanuda su propia conversación del
  proveedor después de cerrar y volver a abrir la aplicación.

</details>

## Plataformas Compatibles

| Plataforma | Arquitecturas | Paquete |
| --- | --- | --- |
| macOS | Apple Silicon e Intel | DMG y ZIP de actualización |
| Windows | x64 | Instalador NSIS |
| Linux | x64 | AppImage y RPM |

La aplicación de escritorio utiliza las CLIs de agentes instaladas localmente.
Instala y autentica solamente los proveedores que quieras usar:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex CLI](https://github.com/openai/codex)
- [Kimi Code](https://www.kimi.com/code)
- [OpenCode](https://opencode.ai/)
- [Cursor Agent CLI](https://docs.cursor.com/en/cli/overview)
- [Antigravity CLI](https://antigravity.google/docs/cli/getting-started)
- [Cline CLI](https://docs.cline.bot/cli/cli-reference)
- [Devin CLI](https://docs.devin.ai/cli)

No necesitas instalar todos los providers ni conocer la terminal. Orkestrai
activa las CLIs que detecta, mantiene cada conversación separada y permite
organizar los agentes por resultado: investigación, diseño, contenido,
marketing, producto, ingeniería o revisión.
Abre la Central desde el icono de cable del canvas, `Cmd/Ctrl+2` o el menú nativo
Workspace para preparar un provider y verificarlo de nuevo después de instalar.
Las instalaciones nuevas comienzan en inglés y preguntan el idioma preferido
como primer paso del onboarding.

## Solución de problemas

Para diagnosticar la aplicación de escritorio, abre **Ver → Herramientas de
desarrollo** y reproduce el problema con Console visible. **Ayuda → Abrir
carpeta de logs** abre el `orkestrai.log` rotativo, que registra fallos del
renderer y del servidor interno ocultando credenciales comunes; la salida
normal de los agentes no se guarda.

## Desarrollo

Requisitos:

- Node.js 24 o posterior
- npm 11 o posterior
- Git

```bash
git clone https://github.com/beeblock/orkestrai.git
cd orkestrai
npm ci

npm run dev            # SvelteKit en http://localhost:5173
npm run electron:dev   # build de producción seguido por Electron
```

La voz funciona sin Docker ni Python. En el primer uso, Orkestrai solicita
confirmación antes de descargar el runtime integrado y los modelos locales. Un
sidecar de voz compatible con OpenAI sigue disponible como backend opcional.

## Arquitectura

Orkestrai está construido con Svelte 5, SvelteKit, Electron, Svelar, SQLite,
`node-pty` y `@xyflow/svelte`.

- `src/lib/modules/agent-room/` contiene las capas de aplicación, dominio,
  persistencia, PTY, bridge, voz y adaptadores de proveedores.
- `src/lib/modules/collaboration/` controla sesiones host, proyecciones
  sanitizadas, políticas de rol, comandos, aprobación y revocación de
  dispositivos y registros de auditoría.
- `src/routes/canvas/`, `src/routes/terminal/` y
  `src/lib/components/agent-room/canvas/` implementan las dos vistas del
  workspace de escritorio.
- `packages/orkestrai-cli/` ofrece la CLI y el puente MCP para los agentes.
- `packages/orkestrai-collaboration-protocol/` define el sobre cifrado
  versionado para clientes Node y WebCrypto en el navegador;
  `packages/orkestrai-relay/` es un transporte
  WebSocket opaco que no puede descifrar el contenido del workspace. El
  servicio de producción está en `wss://relay.orkestrai.app/v1/connect`.
- `electron/` controla el ciclo de vida de escritorio, las notificaciones
  nativas y las actualizaciones.
- `docs/` contiene la documentación de build y releases.

Lee [AGENTS.md](AGENTS.md) antes de cambiar la arquitectura. El archivo documenta
el flujo obligatorio de Svelar, las reglas de i18n, la disciplina de releases y
las restricciones de plataforma.

## Controles De Calidad

```bash
npm test
npm run build
npm run test:e2e
```

Las pruebas end-to-end se ejecutan en serie contra el build de producción. Sigue
las reglas de limpieza de [AGENTS.md](AGENTS.md) después de builds de instaladores
o pruebas E2E.

## Contribuir

Las contribuciones son bienvenidas. Comienza con
[CONTRIBUTING.md](CONTRIBUTING.md) y usa GitHub Issues para bugs reproducibles y
propuestas concretas. Reporta problemas de seguridad de forma privada como se
describe en [SECURITY.md](SECURITY.md).

## Releases

Las tags siguen Versionado Semántico. El workflow `Release Desktop` compila todas
las plataformas, valida los manifests de actualización y publica los artefactos
verificados en las [Releases de GitHub](https://github.com/beeblock/orkestrai/releases).
Consulta [docs/releases.md](docs/releases.md) para ver el proceso completo.

## Licencia

Orkestrai se distribuye bajo la [Apache License 2.0](LICENSE). Los componentes
de terceros y los modelos descargados siguen sujetos a las licencias indicadas
en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
