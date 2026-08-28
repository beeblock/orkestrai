import type { DocsCatalog } from './types.js';

/** Contenido de la página /docs en español — espejo de pt-BR.js (mismos ids, orden y estructura). */
export const DOCS_ES: DocsCatalog = {
  quickstart: [
    'Crea un workspace (botón + en la barra lateral) apuntando a la carpeta de tu proyecto.',
    'Abre Agentes en la barra inferior, elige un servicio disponible y arrastra un rectángulo en el canvas — nómbralo, elige modelo/esfuerzo si quieres y marca Líder si comandará el equipo.',
    'Dibuja más agentes y conéctalos arrastrando desde la bolita (handle) de uno hasta el otro.',
    'Abre el tablero Tareas (+ Tareas), crea tarjetas y asígnalas — cada tarea cae directo en la terminal del agente.',
    'Habla con cualquier agente desde su propia terminal, o deja que el líder distribuya todo solo vía CLI orkestrai.',
  ],
  sections: [
    {
      id: 'workspaces',
      title: 'Workspaces',
      body: `Un workspace = un equipo en un proyecto: directorio de trabajo, ícono y layout del canvas guardados. Créalo con el botón + en la barra lateral. Varios workspaces corren al mismo tiempo — los agentes siguen vivos en background al cambiar. Las instrucciones en AGENTS.md/CLAUDE.md se inyectan en los agentes (edita con el lápiz junto al nombre). El botón ⏻ (Descargar) cierra sus terminales vivas y mantiene el workspace en pausa entre navegaciones y reinicios de la app, sin borrar nada. Abre ese workspace explícitamente para reanudar sus agentes y conversaciones. En macOS, los proyectos dentro de Descargas, Documentos o Escritorio requieren consentimiento del sistema; si el acceso expira, Canvas y Workbench muestran Autorizar carpeta para elegir nuevamente el mismo directorio y continuar sin reiniciar la app.`,
    },
    {
      id: 'workspace-folders',
      title: 'Organiza workspaces en carpetas',
      body: `Agrupa workspaces en carpetas en la barra lateral cuando tengas varios proyectos (por cliente, por equipo, por entorno). Escribe un nombre en "Nueva carpeta" al final de la lista para crear una en la raíz; arrastra un workspace sobre el encabezado de una carpeta para guardarlo ahí, o arrástralo al espacio vacío de la lista para devolverlo a la raíz. Un workspace nuevo también puede empezar ya dentro de una carpeta: usa el ícono de más en su encabezado, o elige cualquier carpeta en el campo Carpeta del propio diálogo de nuevo workspace. Las carpetas se anidan dentro de otras carpetas de la misma forma, sin límite de profundidad — arrastra una carpeta sobre otra para convertirla en subcarpeta, o usa el ícono de "nueva subcarpeta" en el encabezado de cualquier carpeta para crear una ya dentro de ella; una carpeta nunca puede soltarse dentro de sí misma o de una subcarpeta suya. Haz doble clic en el nombre de la carpeta o usa su ícono de lápiz para renombrarla, y cada carpeta recuerda si está colapsada entre reinicios. Eliminar una carpeta (ícono de papelera, con confirmación) nunca es destructivo: cada workspace y subcarpeta dentro de ella sube a la raíz en lugar de eliminarse.`,
    },
    {
      id: 'wsl-runtime',
      title: 'Workspaces de Windows con WSL',
      body: `En Windows, el entorno seleccionado al crear o editar un workspace es el predeterminado del equipo. Cada terminal puede heredarlo o usar Entorno de ejecución en el diálogo de creación y en su menú compacto para forzar Windows nativo o una distribución WSL específica. Selecciona exactamente Ubuntu, Ubuntu-22.04, Ubuntu-24.04, Debian u otra instalación e indica la ruta Linux de la misma carpeta del proyecto. Un único workspace puede combinar agentes Windows y WSL, incluso distribuciones diferentes. Un indicador WIN o WSL identifica la excepción. Detección y modelos del provider, PTY, reanudación exacta de la conversación, Council, agentes reclutados y el puente orkestrai siguen el runtime efectivo de cada terminal. Los reclutas del Maestro heredan el Piso activo del líder y solo se confirman después de que la PTY inicia en el entorno correcto; un fallo elimina el nodo incompleto. Al asignar una tarea, Orkestrai inicia o reanuda un agente desconectado y solo mueve la tarjeta a En progreso después de entregar el briefing completo. Orkestrai valida la CLI dentro de esa distribución y confirma el transcript del provider en su propia home Linux antes de persistir o restaurar un id; un agente vacío comienza limpio en vez de adivinar la conversación más reciente. Cambiar el runtime reinicia solo esa terminal. Una distribución, directorio o comando ausente produce errores distintos y accionables, sin fallback silencioso a Windows nativo.`,
    },
    {
      id: 'agentes',
      title: 'Agentes: crear, nombrar, modelo y esfuerzo',
      body: `El menú Agentes de la barra inferior reúne Claude, Codex, Kimi, OpenCode, Cursor, Antigravity, Cline, Devin y GitHub Copilot sin saturar el canvas. Fija hasta cuatro favoritos para mantenerlos junto al menú; el orden elegido persiste entre workspaces y reinicios, y un agente fijado no disponible sigue guardado sin ocupar la barra. No necesitas conocer la terminal ni usar todos los providers: empieza con el servicio que ya usas y agrega otro cuando quieras una perspectiva independiente. Los agentes que requieren configuración llevan a la Central de Providers, también disponible desde el icono de cable en la barra lateral, Cmd/Ctrl+2 o el menú nativo Workspace. Al dibujar un agente, el diálogo pide nombre, modelo y esfuerzo solo cuando el provider los ofrece, además de Líder. Después, el menú compacto del encabezado reúne cambio de provider y perfil, rol, una selección visual de 15 temas ANSI, recarga con contexto, Modo Maestro y eliminación; el título sigue siendo editable con doble clic. Cambiar el provider conserva conexiones, rol, piso y posición, cierra la conversación anterior e inicia una sesión limpia.`,
    },
    {
      id: 'provider-center',
      title: 'Central de Providers',
      body: `La Central verifica localmente las nueve CLIs compatibles y separa los agentes listos de los que todavía requieren configuración. Expande un provider para ver su guía oficial, un comando de instalación para tu sistema cuando esté disponible, instrucciones de inicio de sesión, capacidades detectadas, estado público en vivo cuando exista y Perfiles con nombre mediante el mecanismo documentado de directorio de cuenta de la CLI. Orkestrai nunca autentica un agente en silencio ni guarda credenciales de Perfil en los datos del canvas; el inicio de sesión permanece en la CLI oficial y los valores del perfil se resuelven en el servidor solo al iniciar la PTY. Después de instalar, usa Verificar de nuevo y regresa al canvas.`,
    },
    {
      id: 'roles',
      title: 'Roles (papeles del equipo)',
      body: `Los roles son instrucciones guardadas en .orkestrai/roles/<slug>/role.json, por lo que viajan con el repositorio. En el panel Roles, Catálogo ofrece funciones completas de liderazgo, producto, arquitectura, frontend, backend, Svelar, QA, seguridad, accesibilidad, documentación, release y rendimiento; instala con + y personaliza en En el workspace. En presets, Claude recibe el rol como system prompt, Codex como instrucciones de developer y Kimi mediante su archivo de agente antes del primer mensaje; los demás providers reciben solo una referencia breve al AGENTS.md del rol, sin pegar el prompt largo en la terminal. El líder también puede reasignar roles con orkestrai reassign. "Descubrir en otra carpeta..." elige cualquier directorio e importa los role.json encontrados dentro de su .orkestrai/roles/, para reutilizar un rol creado en un proyecto desde otro sin relación.`,
    },
    {
      id: 'times',
      title: 'Equipos: paralelo, líder y Loop',
      body: `Todos los agentes corren en paralelo (procesos independientes). La coordinación es por conexiones: agente pregunta a agente con orkestrai ask, o el Líder (★ Maestro) distribuye con task/ask y recluta/despide con recruit/dismiss. El nodo Loop Ralph es el modo secuencial: líder planea → ingeniero implementa → tester revisa, hasta N rondas. Las rutinas disparan prompts programados en cualquier terminal.`,
    },
    {
      id: 'council',
      title: 'Council: compara perspectivas independientes',
      body: `Abre Consejo directamente desde la barra del Canvas, en la parte superior del workspace en Workbench o mediante Command/Ctrl+K. Pedir perspectivas en una tarea lleva su briefing completo; el menú del líder lo preselecciona para la síntesis. Ejecuta entre dos y cinco agentes reales sobre el mismo objetivo, elige modo consultivo o implementación, asigna un enfoque distinto a cada agente, selecciona el criterio de decisión y define un límite estricto de ejecuciones. Cada perspectiva devuelve el mismo contrato estructurado de evidencias, riesgos, pruebas, divergencias, recomendación y confianza; el fallo de un provider no descarta las respuestas completadas. Una síntesis opcional del líder consume una ejecución adicional, pero la decisión final de seleccionar, pedir consenso o rechazar siempre es humana y persistente. Council es la capa de decisión; Pisos son la capa de aislamiento. Las implementaciones Git se ejecutan en pisos separados y solo el resultado seleccionado y confirmado en commit puede aterrizar después de una nueva vista previa de diff, cambios pendientes y conflictos. Nada hace merge ni push automáticamente.`,
    },
    {
      id: 'control-center',
      title: 'Centro de control y comunicaciones verificadas',
      body: `Abre el Centro de control en la parte superior de cada workspace expandido en el explorador del Workbench. Reconstruye el estado de cada agente de Planta baja y de los Pisos actualmente activos desde un historial append-only; los agentes de pisos terminados permanecen en el historial, pero no entran en los conteos actuales. Los badges de piso distinguen los worktrees activos. Los estados incluyen iniciando, trabajando, esperando respuesta o permiso, bloqueado, inactivo, completado, error o desconectado. Cada fila muestra la tarea actual, última acción relevante, tiempo en el estado, provider, role y uso disponible. Actividad presenta el mismo historial como una línea temporal semántica de mensajes, tareas, revisiones, decisiones, Git y eventos del sistema; los metadatos brutos quedan plegados para diagnóstico. Comunicaciones proyecta cada transición en cola, enviada, entregada, recibida, respondida o fallida en un sobre duradero con huella del contenido, correlación, clave de deduplicación e historial de intentos. Repetir el mismo evento es idempotente, mientras reutilizar un id con otro contenido o destinatario es rechazado. El Centro de atención global, abierto con la campana junto a Canvas/Workbench, reúne preguntas, solicitudes de permiso, bloqueos y fallos de todos los workspaces, prioriza el actual y permite leer, posponer, resolver y abrir el origen exacto. Command/Ctrl+K busca este historial con filtros como type:, agent:, workspace:, status:, has:error, before: y after:. Estos estados sobreviven al cambio de pantalla y al reinicio de la app sin despertar terminales inactivas. Las edges siguen como historial visual de conversaciones reales, pero la entrega usa el bridge y no depende de una edge.`,
    },
    {
      id: 'workstreams',
      title: 'Flujos de trabajo: un rastro desde la tarea hasta la entrega',
      body: `Abre Flujos de trabajo bajo un workspace en el explorador de Workbench o mediante Command/Ctrl+K. Un flujo no es otro gestor de proyectos: cada tarea activa de Kanban es la identidad canónica y la vista proyecta su columna actual, responsable, Piso y branch activos, actividad semántica, Consejos, registros del Centro de revisión, revisión Git exacta, evidencias, pruebas, riesgos y archivos vinculados. Las etapas pendiente, activo, revisión, bloqueado y completado se derivan de esas fuentes reales. Iniciar un Consejo desde el flujo lleva el briefing de la tarea, mientras abrir el tablero o Centro de revisión vuelve al registro editable original. Las decisiones, revisiones, actividades y rutas modificadas sin vínculo siguen contabilizadas en lugar de atribuirse silenciosamente a la tarea equivocada.`,
    },
    {
      id: 'workspace-memory',
      title: 'Memoria del workspace con evidencias',
      body: `Abre Memoria del workspace con Command/Ctrl+K, desde el Canvas o el explorador del workspace en Workbench. Guarda solo decisiones, hechos, preferencias, restricciones, referencias y aprendizajes duraderos; cada entrada exige una o más fuentes explícitas como una declaración del usuario, nota, tarea, mensaje canónico, archivo del workspace, URL, evidencia Git, revisión, Consejo o agente. Las fuentes conservan identificación, extractos limitados, enlaces y fingerprints de contenido. Las revisiones nunca sobrescriben el conocimiento anterior: lo sustituyen con protección de concurrencia optimista, mientras el archivado conserva la auditoría. Los agentes usan memory_search solo cuando el contexto es relevante y memory_add o memory_revise con evidencia; Orkestrai nunca inyecta toda la memoria en cada prompt ni trata una conversación casual como un hecho.`,
    },
    {
      id: 'annotation-center',
      title: 'Centro de Anotaciones: feedback con su origen',
      body: `Abre el Centro de Anotaciones desde Canvas, el explorador del workspace en Workbench o Command/Ctrl+K. No copia comentarios a otro gestor: proyecta cada comentario de código del Centro de revisión y cada hilo del Design nativo desde su artefacto canónico. Busca feedback abierto o resuelto e inspecciona autor, archivo, línea o capa exacta, revisión capturada, actualización y relación con una tarea. Un comentario de código se marca obsoleto cuando su contenido capturado ya no coincide con el archivo actual. Abrir origen vuelve a la revisión o documento de Design original, donde la resolución sigue siendo autoritativa.`,
    },
    {
      id: 'team-packs',
      title: 'Team Packs: equipos portátiles y versionados',
      body: `Abre Team Packs desde la biblioteca de presets del Canvas. Los presets existentes y el catálogo integrado siguen siendo compatibles; un snapshot personalizado comienza en 1.0.0 e incluye agentes, roles, skills portátiles, etapas y tareas plantilla, rutinas, servidores MCP adicionales, conexiones y layout. Publica una versión semántica mayor con notas para crear una revisión local inmutable. Exporta un archivo .orkestrai-team-pack.json protegido por checksum o importa uno tras validar schema, tamaño, integridad y contenido con límites. Se eliminan sesiones, ids de conversación, credenciales y demás runtime. La importación crea un pack local nuevo en vez de reemplazar silenciosamente otro con la misma identidad.`,
    },
    {
      id: 'huddles',
      title: 'Huddles: conversaciones persistentes con personas y agentes',
      body: `Abre Huddles desde la barra de Canvas, el explorador de Workbench, el menú nativo Workspace, Command/Ctrl+K o la PWA Remota. Inicia una sala activa por workspace con tema, agenda opcional, un facilitador y hasta once agentes además de la persona que la inicia. Dicta o escribe cada turno, dirígelo a hasta cinco agentes participantes y escucha las respuestas nuevas mediante el TTS local existente si lo deseas. La transcripción limitada, el historial de participantes, las respuestas pendientes o fallidas y el ciclo de vida sobreviven a la navegación y al reinicio sin despertar terminales ajenos. Un agente contribuye con huddle list/say en la CLI o tools MCP tipadas sin provocar respuestas recursivas. Termina el huddle explícitamente o crea una tarea Kanban vinculada con agenda y transcripción; Flujos de trabajo muestra la sesión como evidencia de entrega. La colaboración remota aplica permisos separados para ver, hablar y gestionar sobre el transporte cifrado existente. Es una conversación estructurada asistida por voz, no una llamada de audio siempre abierta.`,
    },
    {
      id: 'review-center',
      title: 'Control de código y Centro de revisión',
      body: `Abre el Centro de revisión de cada workspace en el explorador del Workbench para inspeccionar cambios preparados y no preparados sin salir de Orkestrai. El encabezado muestra la rama, el upstream y los commits por delante o detrás; la lista permite preparar, quitar de preparación, crear commits, hacer pull, push y descartar ediciones rastreadas solo tras una confirmación. Al seleccionar un archivo se abre un diff lado a lado y limitado en Monaco; los archivos binarios o demasiado grandes muestran estados seguros explícitos. Inicia una revisión para vincular la revisión Git exacta con una tarea, agente responsable, resumen, evidencias, pruebas, riesgos y archivos seleccionados. Haz clic en cualquier lado del diff para comentar el archivo o una línea. Cuando cambia el repositorio, los comentarios anteriores siguen visibles como contexto desactualizado en vez de apuntar silenciosamente a otra línea. Aprueba, solicita cambios o rechaza con lenguaje directo; los cambios solicitados se envían al agente responsable cuando su terminal está disponible y permanecen guardados cuando está desconectado.`,
    },
    {
      id: 'portal-design-mode',
      title: 'Portal Design Mode',
      body: `En la aplicación instalada, abre un Portal y elige Inspeccionar diseño en su encabezado. El hover resalta el elemento real de la página sin modificarlo; el clic captura un selector limitado, texto visible, estilos computados relevantes, viewport y un PNG recortado. Revisa ese contexto, describe el resultado esperado y regístralo como una tarea nueva para revisión del líder, una tarea nueva ya asignada a un agente o una actualización de una tarea existente. La captura y el contexto quedan juntos en el Kanban para mantener la trazabilidad. Escape cancela la inspección. El HTML bruto se usa solo en la vista previa sanitizada; query strings, cookies, headers, tokens, storage y estado oculto nunca se agregan automáticamente.`,
    },
    {
      id: 'mobile-device',
      title: 'Dispositivo móvil en Canvas y Workbench',
      body: `Agrega Dispositivo móvil desde la barra del Canvas. Es un único nodo persistente del workspace; Workbench lista y abre el mismo nodo y la misma sesión. En Macs Apple Silicon con Xcode instalado, elige un iOS Simulator. En macOS, Windows o Linux con Platform Tools de Android Studio instalado, elige un AVD local o un dispositivo USB o de red autorizado en ADB; los dispositivos físicos requieren confirmación explícita antes de conectarse. El panel transmite la pantalla y envía toques, swipes, gestos de pinza, rotación, Home, texto y los botones Android Atrás y Recientes. La pantalla completa se ajusta a Canvas y Workbench; controles independientes permiten reducir, ampliar, restaurar el ajuste automático o usar 1:1 con scroll horizontal y vertical. El cajón instala builds .app/.ipa o .apk, abre un bundle id de iOS o package/activity de Android, guarda capturas en .orkestrai/devices/screenshots, lee logs limitados y el árbol de accesibilidad o UIAutomator e inspecciona o cambia permisos. Los agentes reciben las mismas acciones confinadas al workspace mediante la CLI orkestrai device y las tools MCP después de que el usuario inicia la sesión. Orkestrai detiene solo helpers y simuladores o emuladores iniciados por él; cada workspace admite un nodo y una sesión, y las sesiones inactivas se limpian.`,
    },
    {
      id: 'api-client',
      title: 'Cliente de API para contratos y colecciones REST',
      body: `Agrega Cliente de API desde la barra del Canvas para trabajar con HTTP/REST, GraphQL, WebSocket y gRPC sin cambiar de aplicación. Crea carpetas anidadas, arrastra solicitudes por su asa y configura query, encabezados, autenticación Bearer, Basic, clave API u OAuth 2.0, cookies, proxy, CA, certificados de cliente y TLS. GraphQL tiene editores de query, variables y operación; WebSocket ofrece mensajes, keepalive, reconexión y transcripción; gRPC carga proto local y ejecuta los cuatro modos de streaming. Los campos estructurados usan editores con sintaxis y las respuestas JSON/XML aparecen como árboles expandibles. En Scripts, elige Orkestrai nativo, Postman o Bruno. Las colecciones Postman usan Postman Runtime oficial; los scripts Bruno y OpenCollection usan el runtime QuickJS seguro oficial de Bruno. Las APIs de ámbito, helpers de solicitud y respuesta, callbacks de red, cookies, control de flujo, pruebas, Chai y visualizaciones se ejecutan sin traducir el script. El vault queda cifrado en la aplicación de escritorio. Los runners conservan orden, entorno, datos de iteración, intervalo y regla de parada. Importa Bruno, OpenCollection, Postman v2.1, Swagger 2.0 u OpenAPI 3.x y exporta Bruno, OpenCollection, Postman, OpenAPI 3.1, entornos Postman o la copia Orkestrai sin pérdidas. Los orígenes Bruno, OpenCollection y Postman tienen sincronización protegida y bidireccional; OpenAPI permanece pull-only. Los servicios alojados de Postman, como Package Library de equipo y datasets, requieren el backend Postman y no son comportamiento portable de la colección. El mismo nodo persiste en Canvas y Workbench, y los agentes conectados usan api_client_list y api_client_execute sin recibir credenciales guardadas en el inventario.`,
    },
    {
      id: 'api-client-scripts',
      title: 'Scripts y pruebas del Cliente de API',
      body: 'Usa esta referencia en los editores Scripts y en la pestaña Pruebas, que separa Assertions y JavaScript. El editor completa bru.*, req/res, test/expect y pm.* según el runtime elegido y ocupa todo el panel disponible. Los ejemplos se pueden copiar directamente.',
      bullets: [
        'El orden es: pre-request de colección, pre-request de carpetas desde la raíz hasta la hoja, pre-request de solicitud, llamada de red, post-response de solicitud, JavaScript de Pruebas, post-response de carpetas desde la hoja hasta la raíz, post-response de colección y assertions nativas.',
        'Los ámbitos Postman permanecen separados en pm.globals, pm.collectionVariables, pm.environment, pm.iterationData y pm.variables. Bruno expone los equivalentes de entorno, global, colección, runtime, secrets e iteración del runner. Usa {{nombre}} en cualquier campo de la solicitud.',
        'Postman admite pm.sendRequest, pm.execution.runRequest/setNextRequest/skipRequest, cookies, vault, visualizer, APIs legadas, pm.require para bibliotecas incluidas, metadatos de iteración correctos en pm.info y Chai completo incluido. Bruno admite bru.sendRequest/runRequest, helpers req/res, variables de solicitud y carpeta, bloques de variables post-response, assertions declarativas, bloques tests, cookies, flujo del runner, visualizaciones, bibliotecas incluidas y test/expect/assert globales.',
        'Los scripts importados se preservan y ejecutan con el runtime de origen seleccionado, sin transpilar JavaScript. Package Library de equipo, datasets alojados, mocks y otros estados en la nube de Postman requieren sus servicios y no forman parte de un archivo de colección portable. Bruno permanece en el runtime QuickJS seguro oficial: el acceso NodeVM inseguro al filesystem, procesos y módulos locales arbitrarios del equipo queda deliberadamente deshabilitado. .orkestrai-api.json sigue siendo la copia sin pérdidas del estado exclusivo de Orkestrai.',
        'Agentes y líderes pueden importar una colección Bruno, OpenCollection o Postman existente con api_client_import y una ruta relativa al repositorio. Si el workspace coordina varios repositorios hermanos, abre Editar workspace > Repositorios adicionales, autoriza cada raíz y usa su alias, como @api-tests/bruno. api_client_read/replace edita el mismo nodo visible en la UI y escribe por defecto en los orígenes vinculados; sync-status, pull y push muestran conflictos antes de reemplazar cualquiera de los lados. Las rutas absolutas, carpetas principales no autorizadas y escapes mediante enlaces simbólicos siguen bloqueados. Las solicitudes, carpetas, scripts, pruebas y variables nativas del formato quedan en archivos comunes listos para git, Bruno, Postman y CI; la configuración de runners exclusiva de Orkestrai permanece en el nodo y en la copia nativa sin pérdidas.',
      ],
      examples: [
        {
          id: 'postman',
          title: 'Scripts compatibles con Postman',
          description: 'Selecciona Postman: Pre-request prepara datos, Post-response captura variables y Pruebas > JavaScript recibe pm.test/pm.expect. Cada fila alimenta pm.iterationData.',
          snippets: [
            {
              id: 'pre-request',
              title: 'Solicitud · Pre-request',
              code: `const requestId = 'req-' + Date.now();

const tenant = pm.iterationData.get('tenant');

pm.variables.set('requestId', requestId);
pm.globals.set('lastTenant', tenant);
pm.request.headers.upsert({
  key: 'X-Request-Id',
  value: requestId,
});

pm.vault.get('apiKey').then((apiKey) => {
  pm.request.headers.upsert({ key: 'X-API-Key', value: apiKey });
});

console.log('Solicitud preparada:', requestId, tenant);`,
            },
            {
              id: 'post-response',
              title: 'Solicitud · Post-response',
              code: `let body;

pm.test('El status es 200', () => {
  pm.expect(pm.response.code).to.equal(200);
});

pm.test('El body es JSON válido', () => {
  body = pm.response.json();
});

if (body) {
  pm.test('La respuesta contiene access_token', () => {
    pm.expect(body).to.have.property('access_token');
  });

  pm.test('La respuesta contiene el id del usuario', () => {
    pm.expect(body).to.have.property('user');
    pm.expect(body.user).to.have.property('id');
  });

  if (body.access_token) {
    pm.environment.set('accessToken', body.access_token);
  }

  if (body.user?.id) {
    pm.environment.set('userId', body.user.id);
  }

  pm.execution.setNextRequest('Cargar usuario');
  console.log('Usuario autenticado:', body.user?.id);
}`,
            },
            {
              id: 'javascript-tests',
              title: 'Pruebas > JavaScript',
              code: `pm.test('El status es 200', () => {
  pm.expect(pm.response.code).to.equal(200);
  pm.expect(pm.response.json()).to.have.property('user');
});`,
            },
            {
              id: 'next-request',
              title: 'Siguiente solicitud · uso de variables',
              code: `GET {{baseUrl}}/users/{{userId}}
Authorization: Bearer {{accessToken}}
X-Request-Id: {{requestId}}`,
            },
          ],
        },
        {
          id: 'bruno',
          title: 'Scripts compatibles con Bruno',
          description: 'Selecciona Bruno: usa Pre/Post-response para automatización y Pruebas > JavaScript para el cuerpo oficial test(...). Al exportar se envuelve en tests { } automáticamente.',
          snippets: [
            {
              id: 'pre-request',
              title: 'Solicitud · Pre-request',
              code: `const login = await bru.runRequest('Auth / Login');
const token = login.data.access_token || bru.getVar('accessToken');

if (!token) {
  throw new Error('Falta la variable accessToken');
}

req.setHeader('Authorization', 'Bearer ' + token);
req.setHeader('Accept', 'application/json');

console.log('Solicitud autenticada');`,
            },
            {
              id: 'post-response',
              title: 'Solicitud · Post-response',
              code: `const body = res.getBody();

test('El usuario fue creado', () => {
  expect(res.getStatus()).to.equal(201);
  expect(body).to.have.property('id');
});

bru.setVar('createdUserId', body.id);
bru.setVar('lastStatus', res.getStatus());
bru.setNextRequest('Cargar usuario');

console.log('Usuario creado:', body.id);`,
            },
            {
              id: 'javascript-tests',
              title: 'Pruebas > JavaScript',
              code: `test('El usuario fue creado', () => {
  expect(res.getStatus()).to.equal(201);
  expect(res.getBody()).to.have.property('id');
});`,
            },
          ],
        },
        {
          id: 'orkestrai-native',
          title: 'Orkestrai nativo: assertions y JavaScript',
          description: 'En Pruebas, alterna entre assertions estructuradas y JavaScript. El runtime nativo acepta pm.test/pm.expect o test/expect; usa assertions para verificaciones simples.',
          snippets: [
            {
              id: 'javascript-tests',
              title: 'Pruebas > JavaScript',
              code: `test('El status es 200', () => {
  expect(res.getStatus()).to.equal(200);
});

pm.test('El body es JSON', () => {
  pm.expect(pm.response.json()).to.have.property('data');
});`,
            },
            {
              id: 'declarative-tests',
              title: 'Pestaña Pruebas · assertions',
              code: `Fuente          Ruta             Operador       Esperado
Status          —                Igual          200
Body            data.user.id     Existe         —
Header          content-type     Contiene       application/json
Tiempo respuesta —               Menor que      1000`,
            },
            {
              id: 'variables',
              title: 'Entorno y template nativos',
              code: `Variable de colección: baseUrl = https://api.example.com
Variable de entorno: accessToken = <token del entorno activo>
Variable creada por script: userId = 42

URL: {{baseUrl}}/users/{{userId}}
Header: Authorization = Bearer {{accessToken}}`,
            },
          ],
        },
      ],
    },
    {
      id: 'notas',
      title: 'Notas como canales de trabajo',
      body: `Las notas son markdown vivo compartido con los agentes. La convención: conecta la nota a quien debe leerla/escribirla y di el propósito en el título y el contenido. Ej.: nota "Backlog (líder escribe)" conectada al líder — escribes "divide en tareas para el equipo" y él la lee con orkestrai note read y distribuye en el tablero. Nota "Para mí (humano)" — pide al líder que registre estado/decisiones en ella con orkestrai note write/edit, y tú lo sigues formateado (ícono de ojo). Doble clic en el título renombra la nota. Suelta, pega o selecciona imágenes, PDFs, otros archivos y enlaces HTTP/HTTPS; los archivos de hasta 10 MB quedan en .orkestrai/attachments/ y su referencia markdown se inserta en el cursor. Al eliminar un adjunto con su X, la referencia también desaparece de la nota y el archivo almacenado en el workspace se borra.`,
    },
    {
      id: 'tarefas',
      title: 'Tareas (kanban)',
      body: `El nodo Tareas (+ Tareas en la barra inferior) es el tablero del workspace. Usa el icono de columnas para crear hasta diez etapas que representen tu proceso. El líder y el equipo ven esas etapas automáticamente y mantienen el estado real de cada entrega. "Agregar tarea" abre un composer con título, descripción markdown e imágenes, PDFs, archivos o enlaces; también puedes soltarlos directo sobre una tarjeta. Asignar una tarjeta envía su título, descripción y todas las referencias al agente. Al iniciar, el líder recibe cada tarea sin responsable con el briefing completo y debe registrarla/asignarla en el tablero antes de delegar por mensaje. task done envía una notificación identificada como Tarea completada y entrega automáticamente el handoff al líder cuando su composer queda libre; Proyecto completado se reserva para el final real del proyecto. El trabajo concluido puede archivarse sin perder historial.`,
    },
    {
      id: 'imagens',
      title: 'Nodo de Imagen (referencia visual)',
      body: `La herramienta Imagen (barra inferior) crea un nodo de referencia visual en el canvas: mockup, screenshot, diagrama de arquitectura. Pega con Ctrl+V o haz clic para elegir el archivo — la imagen queda guardada en el workspace (.orkestrai/images/). Conecta el nodo al líder (o a un agente específico, como el diseñador) para dejar claro quién debe usar esa referencia, y di en el chat qué hacer con ella. Doble clic en el título renombra; el ícono de imagen en el encabezado cambia el archivo.`,
    },
    {
      id: 'image-workflows',
      title: 'Flujos nativos de generación de imágenes',
      body: `Abre el menú Imagen en la barra del Canvas y elige Generar imágenes. El flujo forma parte del canvas existente: conecta Notas para paleta, reglas del personaje, dirección de arte, restricciones o contexto de campaña; conecta hasta cinco referencias ordenadas de Imagen PNG, JPEG o WebP; y conecta un agente Codex activo como ejecutor. Se requiere una cuenta o suscripción de Codex autenticada con ImageGen disponible; no se necesita una clave de API de OpenAI. Las miniaturas numeradas muestran el orden exacto. Escribe el prompt, elige de uno a diez resultados, solicita opcionalmente un fondo PNG realmente transparente y define una carpeta relativa del workspace (generated/images por defecto) con un prefijo seguro. Generar delega un único run lógico a esa sesión de Codex; el contrato de la tool nativa no tiene parámetro de cantidad, por lo que el agente hace automáticamente una llamada autenticada de image_gen.imagegen por resultado y presenta todo como una ejecución combinada. Orkestrai nunca solicita ni almacena una clave de API de imagen, nunca llama directamente a un endpoint del provider y no inventa controles de modelo, calidad, tamaño o formato que la tool nativa no expone. Un Codex conectado tiene control tipado completo de este flujo visible mediante image_workflow_*: puede crear y configurar un borrador sin ejecutarlo, conectar, desconectar o reordenar Notas e Imágenes, agregar archivos de referencia del workspace, asumir y ejecutar la generación, completar o cancelar y eliminar el flujo. El ejecutor copia cada resultado nativo al destino preasignado en el workspace y llama a image_workflow_complete. Orkestrai solo acepta ese Codex conectado y esas rutas exactas, luego valida la firma y el tamaño antes de crear nodos Imagen conectados con hash de inputs, flujo de origen, id de ejecución, índice del resultado, duración e historial limitado. Los resultados pueden alimentar otro flujo como referencias. Cancelar invalida el run activo para impedir que se materialice una finalización tardía; no interrumpe una llamada nativa que ya está en curso. Canvas, Workbench, CLI y MCP operan el mismo grafo persistido sin un estado paralelo de automatización.`,
      bullets: [
        'Cada terminal Codex iniciado desde Canvas recibe el launcher MCP de la instalación actual de Orkestrai solo para esa sesión. Una configuración global antigua de Codex no oculta las tools image_workflow_*, y el archivo de configuración del usuario nunca se reescribe.',
      ],
    },
    {
      id: 'visual-annotations',
      title: 'Formas y anotaciones visuales',
      body: `Usa Formas en la barra del Canvas para dibujar rectángulos, cajas redondeadas, elipses, rombos y flechas curvas editables alrededor del trabajo. Haz doble clic para editar el texto; el control de estilo cambia fondo, opacidad, borde, trazo, tipografía y anclas de la flecha. Selecciona una forma y usa la acción de duplicar o Cmd/Ctrl+D para conservar exactamente tamaño, texto, estilo y geometría de la flecha con un pequeño desplazamiento. Cmd/Ctrl+C y Cmd/Ctrl+V copian y pegan una o varias formas seleccionadas manteniendo el espaciado relativo; cada copia es un nodo persistente separado y se puede editar de forma independiente.`,
    },
    {
      id: 'design-mode',
      title: 'Modo Diseño nativo',
      body: `Agrega Diseño desde la barra del Canvas para crear un documento visual estructurado guardado en .orkestrai/designs dentro del proyecto. Haz doble clic en la vista previa o usa expandir para abrir el mismo documento en el Modo Diseño del Canvas o en Workbench. Dibuja frames, rectángulos, elipses, texto y paths en cualquier tamaño; Shift conserva proporciones y Alt/Option crea o redimensiona desde el centro. Pluma muestra una vista previa del siguiente segmento y del cierre: haz clic para esquinas, arrastra para curvas, pulsa la primera ancla para cerrar o usa Enter/Escape para terminar un path abierto. Selecciona un path y pulsa Enter o haz doble clic para entrar en edición vectorial. Arrastra anclas y manejadores, arrastra un segmento para curvarlo, haz doble clic en el segmento para dividirlo y elige tangentes Esquina, Reflejado, Asimétrico o Desconectado en la barra contextual. Usa Shift-clic o selección por caja para elegir varios puntos y moverlos, desplazarlos con el teclado, eliminarlos o redimensionarlos juntos; selecciona Pluma y pulsa un extremo para continuar un path abierto. Las capas seleccionadas muestran ocho controles de tamaño, la geometría del path escala con sus límites, los vectores rotados se editan en su lugar y el texto admite edición directa en el canvas y múltiples líneas. Usa Shift para seleccionar capas, alinear, distribuir, combinar por unión, resta, intersección o exclusión y crear o liberar máscaras. Agrupa con Cmd/Ctrl+G y desagrupa con Shift+Cmd/Ctrl+G; mover o redimensionar un grupo transforma sus descendientes, mientras Alt selecciona directamente una capa interna. Apila rellenos y trazos sólidos o con gradiente lineal/radial; agrega sombras, blur, blend modes, reglas, guías persistentes y ajuste. Las herramientas de color listan y seleccionan todas las capas con el mismo relleno o contorno, aplican un color a la selección o reemplazan sólidos y stops de gradiente coincidentes en la página. Los frames admiten auto layout horizontal, vertical, wrap o grid, padding y gaps, con constraints responsivas. Pega, arrastra o elige un SVG para convertir paths, formas primitivas, la jerarquía original de grupos, transforms anidados, estilos, gradientes y referencias en capas vectoriales nativas editables; PNG, JPEG, WebP y GIF siguen como assets raster reutilizables. Copia la selección como SVG o PNG o exporta el arte seleccionado o la página completa en SVG, PNG, JPEG, WebP o PDF; los controles de edición nunca aparecen en exports ni miniaturas. Abre Variables junto a Capas para crear tokens tipados en colecciones, agregar modos como Claro y Oscuro, reutilizar un token mediante alias y vincular relleno, contorno, opacidad, radio, tipografía, espaciado, padding o efectos compatibles desde el inspector. Empieza con presets de producto, marketing o mobile, importa DTCG JSON o CSS variables, exporta DTCG, CSS o Tailwind y audita tokens duplicados o sin uso, valores repetidos y candidatos a componente. En Componentes, convierte un frame o grupo en fuente reutilizable, crea instancias vinculadas, expone propiedades de texto, visibilidad y slot, cambia una instancia o variante, conserva overrides locales o desvincula una copia. En Bibliotecas, publica una versión solo para workspaces seleccionados, importa y sincroniza sin perder la posición local o conserva copias editables al desvincularla. En Código, el escaneo de solo lectura extrae CSS variables, configuración Tailwind estática y contratos Svelte, React o Vue sin ejecutar archivos del proyecto; vincula componentes visuales y sincroniza tokens por hash de origen. Cambiar el modo activo actualiza inmediatamente todas las capas vinculadas. Tokens y componentes aparecen en la búsqueda global y el resumen del nodo Diseño. Los tooltips muestran atajos, Delete elimina puntos o capas, Escape sale por etapas de la edición de puntos y vectores, las flechas desplazan uno y Shift diez, y deshacer/rehacer usa operaciones tipadas. Cada mutación registra revisión e historial limitado. Conecta el nodo Diseño a un líder o especialista para editar el mismo scene graph mediante tools MCP tipadas de Orkestrai, incluidos tokens, componentes, instancias, propiedades, variantes, slots y vínculos de bibliotecas; las ediciones humanas y de agentes usan control optimista, actualizan los editores abiertos y no requieren reescribir JSON.`,
    },
    {
      id: 'design-collaboration',
      title: 'Colaboración en vivo en Diseño',
      body: `Abre Colaboración en el inspector de Diseño para trabajar en el mismo documento nativo con personas y agentes. La presencia en vivo muestra la página, el cursor y la selección de cada participante; Seguir mantiene tu viewport sobre una persona hasta que lo detengas. Seleccionar una capa toma un lease corto y renovable, así otra persona recibe un conflicto claro en lugar de sobrescribir la misma capa. Crea una conversación en la página o capa seleccionada, menciona personas, responde, resuelve o reabre; las conversaciones y la autoría permanecen en el historial aunque se elimine la capa. Una propuesta visual muestra una vista previa de posición, tamaño, opacidad y relleno sin modificar el documento, enumera su diff estructural y solo aplica todas las operaciones de forma atómica después de una aprobación explícita. Envía la propuesta a Council para obtener perspectivas independientes o crea un Piso Git paralelo para una implementación aislada. Los agentes conectados usan las mismas operaciones versionadas de comentario, propuesta y decisión mediante el MCP de Orkestrai y no pueden simular una aprobación humana. En el uso compartido cifrado, el acceso a Diseño se aprueba por separado para cada dispositivo como Ninguno, Ver, Comentar, Proponer o Editar y decidir. Remote recibe páginas, actividad, conversaciones y resúmenes de propuestas sanitizados, nunca el scene graph completo, assets, archivos, credenciales ni rutas locales.`,
    },
    {
      id: 'design-quality',
      title: 'Calidad y recuperación del Diseño',
      body: `Abre Calidad en el inspector de Diseño para auditar nombres útiles de capas, texto o contenido recortado, superposición accidental, contraste de texto según WCAG y metadatos de accesibilidad. Seleccionar un problema enfoca su capa exacta. El mismo panel aplica templates completos y editables de producto, marketing, mobile o design system mediante el command bus protegido por revisión. Cada escritura válida conserva un backup automático; los documentos principales corruptos se recuperan desde él, los historiales grandes se compactan automáticamente y la restauración manual crea una nueva revisión. Los documentos de más de 500 capas renderizan solo la región visible, la selección y su jerarquía. Los agentes conectados pueden ejecutar la misma auditoría o aplicar un template mediante comandos MCP y CLI tipados.`,
    },
    {
      id: 'presets',
      title: 'Presets de equipo',
      body: `La Biblioteca de presets está en el icono de plantilla de la barra lateral y en Presets de la barra inferior. Además de Producto, React, Next.js, SvelteKit, Svelar y Laravel, incluye Campaña y lanzamiento, Brand y diseño, Contenido y SEO y Orkestrai Contributing. Cada receta trae líder, especialistas, roles operativos extensos, skills, briefing, tablero, tarea inicial y layout; el equipo de contribución también exige consenso entre Claude, Codex y Kimi. Los agentes comienzan con acceso total autónomo y reciben el rol mediante el mecanismo nativo de la CLI, sin dejar la terminal bloqueada por texto pegado. El líder recibe la tarea inicial completa y debe asignarla antes de delegar. Usa Nuevo workspace para otra carpeta o + para sumar el equipo al canvas actual.`,
    },
    {
      id: 'fluxos',
      title: 'Flujos (pipelines de agentes)',
      body: `El nodo Flujo (+ Flujo en la barra inferior) es un pipeline visual: pasos en secuencia, donde la salida de un agente se vuelve la entrada del siguiente vía {{input}} en el prompt. El paso "Agente" conversa con el agente elegido (la arista se enciende mientras tanto) — si el terminal del agente nunca se abrió, el flujo inicia su sesión solo; el paso "Aprobación" pausa hasta que hagas clic en Aprobar — humano en el loop. Repetición con límite (hasta 5 rondas). Dos superpoderes: el botón SINCRONIZAR crea un paso Agente por cada agente conectado al flujo (en el orden de las aristas — arma el pipeline dibujando); y FLUJOS ENCADENADOS — cuando un Flujo termina con éxito, su salida final dispara los Flujos conectados a él (el fallo no encadena, los ciclos se bloquean). El progreso aparece en vivo en el nodo, los errores aparecen en un banner arriba del nodo (nada falla en silencio) y el historial de las últimas 5 ejecuciones queda guardado en él. Úsalo para revisiones encadenadas (escribe → revisa → aprueba), pipelines compuestos (investigación → redacción → SEO) o fan-out de un flujo a varios.`,
    },
    {
      id: 'sem-medo',
      title: 'Diff, Loop y Pisos — sin miedo (para no-devs)',
      body: `Tres botones que asustan pero son amigables: DIFF es solo un comparador — muestra lado a lado qué cambió en el código entre dos versiones, sin tocar nada. LOOP (Loop Ralph) es un piloto automático: el equipo repite solo el ciclo planear → hacer → revisar hasta el número de rondas que elijas. PISOS son copias de seguridad del proyecto: cada equipo trabaja en una copia separada y nadie desordena la versión principal — al final, la app ayuda a juntar todo de vuelta (y avisa si hay conflicto antes). Haz clic sin miedo: nada aquí borra tu trabajo.`,
    },
    {
      id: 'conexoes',
      title: 'Conexiones',
      body: `Arrastra desde la bolita de un nodo hasta otro — la conexión es bidireccional y la bolita flota por el borde siempre en el punto más cercano al otro nodo. La cuerda punteada tiene física (se balancea al mover) y se pone verde animada mientras los agentes conversan. Orkestrai reduce automáticamente la simulación en canvases grandes y conexiones fuera de pantalla, conservando la señal visual de las conversaciones seleccionadas o activas; las ventanas ocultas y el modo de movimiento reducido detienen las animaciones. El hover muestra la X de eliminar; el clic fija la X. Conectar instala la skill del puente en los agentes (aprenden la CLI orkestrai solos).`,
    },
    {
      id: 'andares',
      title: 'Pisos (worktrees)',
      body: `Un piso es un git worktree del repositorio con branch propia. Para Planta baja y cada worktree activo, el panel Pisos muestra agentes y una lista de tareas con título, etapa y responsable, además de archivos modificados, sincronización de la branch y último commit. Workbench y Centro de control identifican el piso de los agentes activos. Al aterrizar o eliminar, las terminales, copias de layout y edges de ese piso se archivan automáticamente: siguen disponibles para atribución histórica, pero no inflan los conteos ni aparecen como agentes actuales. Clonar el layout nunca reutiliza una sesión PTY ni la conversación del provider. Crea desde el panel o la CLI con orkestrai floor create/list/preview/land/remove; recruit --floor coloca un agente nuevo en el piso activo seleccionado. Aterrizar hace merge después de una vista previa de diff y conflictos. Los conflictos nunca se ocultan: el error lista archivos y la resolución se convierte en tarea explícita.`,
    },
    {
      id: 'rotinas',
      title: 'Automatizaciones',
      body: `Abre Automatizaciones desde la barra del Canvas, el explorador del Workbench o Command/Ctrl+K. El disparador puede ser manual, programado, un cambio de tarea, un mensaje confirmado de agente, commit Git, pull request de GitHub, webhook, cambio de archivo o carpeta o límite de uso de provider. Las acciones envían un prompt a un agente, crean una tarea trazable en Kanban o muestran una notificación explícita de escritorio. Las recetas de desarrollo, diseño, marketing, investigación y operaciones ofrecen puntos de partida seguros. Cada ejecución registra entrada, agente/provider de destino, snapshots de cuota, confirmación de salida, duración, intento y fallo recuperable; los reintentos son limitados y los eventos duplicados son idempotentes. Los tokens de GitHub se cifran con safeStorage de Electron y nunca entran en la base del workspace. Las Rutinas programadas anteriores siguen compatibles y aparecen aquí automáticamente.`,
    },
    {
      id: 'portal',
      title: 'Portal (navegador de los agentes)',
      body: `El nodo Portal es un navegador embebido. Dale a cada Portal un nombre persistente con el lápiz del encabezado; la dirección queda en la barra de navegación separada. Los agentes listan todos los Portales del workspace con nombre, URL, id y estado de conexión y eligen por nombre único o id: orkestrai portal <nombre-o-nodeId> navigate (abrir URL), eval (correr JS en la página), dom (leer el HTML), screenshot. Un Portal no conectado todavía existe y debe reutilizarse; crear otro exige intención explícita. Conectado a un agente, se vuelve los ojos del agente. Úsalo para probar la aplicación que el equipo está construyendo (apunta el portal al dev server) o investigar en la web. En la app de escritorio, los enlaces y logins que solicitan una ventana nueva se abren en un Portal aislado de Orkestrai, no en el navegador del sistema, conservando window.opener y la misma sesión. Las cookies persistentes y el almacenamiento web se escriben en disco, y el nodo restaura la última URL navegada después de reiniciar; los sitios aún pueden usar cookies de sesión que expiran al cerrar. La automatización completa corre en Electron; en un navegador común el portal es solo visor. El ícono de teléfono en el encabezado del Portal abre una barra de responsividad, parecida al device toolbar de un navegador: elige un dispositivo (iPhone, Pixel, iPad, laptop, desktop) o escribe un ancho/alto exacto, rota la orientación, o desactívala para volver a llenar el nodo. El viewport real de la página cambia a ese tamaño exacto — igual que redimensionar una ventana real — así que su propio CSS responsivo reacciona con normalidad; si el tamaño emulado es más grande que el nodo, el Portal se desplaza hasta ahí en vez de encoger o distorsionar la página.`,
    },
    {
      id: 'mcp',
      title: 'MCP (tools externas de los agentes)',
      body: `MCP es el estándar para dar herramientas externas a los agentes (GitHub, Gmail, Figma, Drive, Postgres...). EL MODO FÁCIL: página Skills (barra lateral) → pestaña MCPs — busca en la curaduría oficial o el registry MCP e instala con un clic; si un servidor necesita clave/token, la app explica dónde obtenerla. Los remotos no requieren comandos. AVANZADO: lápiz junto al workspace → "Servidores MCP". AUTOMÁTICO: Orkestrai provisiona su puente para Claude/Kimi (.mcp.json), OpenCode (opencode.json), Cursor (.cursor/mcp.json), Cline (.cline/mcp.json), Devin (.devin/mcp_config.json) y Antigravity (.agents/mcp_config.json), además de skills y un bloque preservado en AGENTS.md. Codex recibe el puente de Orkestrai y el MCP oficial de Figma como parámetros temporales al iniciar, sin reescribir ~/.codex/config.toml. Cada agente recibe tools tipadas del canvas limitadas al workspace correcto.`,
    },
    {
      id: 'cli',
      title: 'CLI orkestrai (el puente)',
      body: `Los agentes usan la CLI orkestrai para actuar en el canvas: list, ask, usage, huddle list/say, note read/write/edit/create, task list/columns/add/move/assign/done/archive/history, role show/write/edit, floor create/list/preview/land/remove, notify, recruit/dismiss/connect/reassign, portal, device, port, fs, run, say, clip, notes y portals. ask conserva mensajes de varias palabras sin comillas, pero una conversación solo cuenta cuando el puente devuelve Respuesta confirmada; un timeout o una respuesta no confirmada termina con error. usage devuelve las cuotas actuales y la recomendación configurada en el nodo Uso. huddle list/say permite que un agente participante lea la transcripción limitada y contribuya sin provocar respuestas recursivas. task columns devuelve las etapas que definiste; task add --column y task move permiten que líder y equipo sigan cualquier proceso, no solo un kanban de software. device lista, conecta, controla, inspecciona, captura y detiene el simulador móvil del workspace. task done también avisa al líder automáticamente. Los agentes que hablan MCP reciben las mismas acciones como tools nativas vía orkestrai mcp. El provisionamiento del puente es automático y el token queda en .orkestrai/workspace.json.`,
    },
    {
      id: 'usage-routing',
      title: 'Uso y ruteo según la cuota',
      body: `Abre Uso en la barra inferior y usa Agregar al canvas para mantener visible la capacidad de los providers en el workspace. El ruteo del líder aparece primero en el nodo: elige origen, fallback, ventana de 5 horas/semanal/mensual y umbral sin redimensionarlo. Los detalles de providers quedan después en un área de desplazamiento contenida compatible con mouse, trackpad, tacto y teclado sin aplicar zoom al canvas; los nodos compactos guardados anteriormente usan el mismo comportamiento. Claude, Codex y Kimi exponen ventanas legibles por máquina usando las credenciales que ya pertenecen a sus CLI; solo esos porcentajes verificados participan en el ruteo automático entre origen y fallback. El mismo panel lista Antigravity, Cursor, Devin, OpenCode y Cline con su capacidad oficial real: Antigravity expone la cuota en los paneles AI Credits y Model Quotas, Cursor y Devin requieren credenciales administrativas separadas de Team/Enterprise y OpenCode/Cline muestran el uso en la consola de la cuenta, los ajustes o el provider de modelo seleccionado. Ningún provider no disponible recibe un porcentaje inventado. El nodo actualiza las fuentes automáticas cada cinco minutos, enlaza la documentación oficial y avisa cuando la ventana elegida no está disponible. Una tarea en curso nunca cambia de terminal silenciosamente.`,
    },
    {
      id: 'appearance',
      title: 'Temas y apariencia',
      body: `En Configuración → Apariencia, elige Orkestrai Dark, Graphite, Midnight u Orkestrai Light. El modo oscuro predeterminado combina superficies grafito con el dorado de la marca; el tema claro mantiene contraste legible en paneles, nodos, iconos, marcas de providers, botones y estados hover. Para personalizar, duplica cualquier tema y edita sus tokens semánticos; la vista previa aparece al instante y Guardar conserva la elección. Los temas personalizados se pueden exportar o importar como JSON validado, sin aceptar CSS arbitrario.`,
    },
    {
      id: 'atalhos',
      title: 'Atajos',
      body: `⌘P paleta · ⌘K (o Ctrl+K) buscar en la documentación desde cualquier pantalla · ⌘2 Central de Providers · ⌘⇧A próxima atención · ⌘⇧T organizar los nodos seleccionados o todo el canvas cuando no hay selección · Cmd/Ctrl+D duplicar formas seleccionadas · Cmd/Ctrl+C y Cmd/Ctrl+V copiar y pegar formas seleccionadas · ⌘G agrupar · ⌘⇧G desagrupar · N nueva nota · L conectar seleccionados · Alt+1…9 enfocar terminal · Alt+Espacio dictado por voz · ⌘F buscar en la terminal · ⌘Z deshacer · Backspace eliminar. En las terminales de Windows, Ctrl+V pega el texto del portapapeles nativo; cuando no hay texto, el atajo original de la CLI sigue disponible para pegar imágenes. En Windows, la barra de título estilizada ofrece Archivo, Editar, Ver, Workspace, Ventana y Ayuda sin perder los controles de la ventana; macOS y Linux conservan sus menús de plataforma.`,
    },
  ],
  useCases: [
    {
      id: 'leader-team',
      title: 'Equipo de desarrollo con líder (zero-config)',
      body: 'Crea un Claude y dile: "orquesta para mí la feature X". Él propone el equipo, tú apruebas, y él recluta, conecta y distribuye mediante kanban. Cada consulta por ask solo cuenta tras la confirmación explícita del puente; cuando un agente usa task done, el líder recibe automáticamente el handoff para revisar y coordinar el siguiente paso.',
      tags: ['Líder/Maestro', 'recruit/dismiss', 'kanban'],
    },
    {
      id: 'watch-24-7',
      title: 'Empleado 24/7 (vigía de tareas)',
      body: 'Rutina cada 1–5 min en el líder: "verifica el tablero (orkestrai task list); asigna lo que esté sin dueño; si falta agente, recluta". El equipo entero trabaja sin que toques nada — asignar despacha la tarea directo a la terminal del agente.',
      tags: ['Rutinas', 'task assign', 'auto-dispatch'],
    },
    {
      id: 'parallel-features',
      title: 'Dos features en paralelo sin conflicto',
      body: 'Un piso (worktree) por feature: equipo A en la Planta Baja en main, equipo B en el piso "auth-refactor". Al terminar, floor preview muestra conflictos antes; el land mergea. El conflicto se vuelve tarea para que un agente la resuelva.',
      tags: ['Pisos/worktrees', 'floor land', 'branches'],
    },
    {
      id: 'council-decision',
      title: 'Compara enfoques antes de comprometer al equipo',
      body: 'Abre Consejo desde la barra del Canvas, la parte superior del workspace en Workbench o Command/Ctrl+K. Si empiezas desde una tarea, lleva el briefing completo. Pide a tres agentes que evalúen de forma independiente arquitectura, riesgo de entrega y costo. Usa el modo consultivo solo para decidir o implementación para prototipos aislados. Compara la matriz normalizada, lee la síntesis opcional del líder y registra tu selección, solicitud de consenso o rechazo. Solo una implementación seleccionada, con destino limpio y vista previa sin conflictos, puede aterrizar.',
      tags: ['Council', 'decisión humana', 'pisos aislados'],
    },
    {
      id: 'api-client-workflow',
      title: 'Probar APIs de Bruno o Postman sin salir del Canvas',
      body: 'Agrega un Cliente de API e importa Bruno, OpenCollection YAML, Postman v2.1, Swagger 2.0 u OpenAPI 3.x. En un proyecto que ya contiene pruebas Bruno/Postman, pide al líder o agente usar api_client_import con la ruta relativa al repositorio. Si el workspace coordina repositorios hermanos, autorízalos en Editar workspace > Repositorios adicionales y usa alias como @api-tests/bruno. La misma colección aparece en Canvas y Workbench, las ediciones posteriores con api_client_replace persisten en los archivos del repositorio real y las rutas principales no autorizadas siguen bloqueadas. Organiza carpetas, entornos y runners, escribe automatización y pruebas JavaScript con autocompletado, ejecuta la suite, revisa conflictos de sincronización y luego versiona la colección modificada junto con el proyecto.',
      tags: ['Colecciones REST', 'scripts + pruebas', 'Canvas + Workbench'],
    },
    {
      id: 'visual-annotations',
      title: 'Reutilizar una explicación visual sin reconstruirla',
      body: 'Estiliza una forma o un arreglo completo de etiquetas, contenedores y flechas. Duplica la forma seleccionada con su acción o Cmd/Ctrl+D, o copia y pega una selección múltiple para crear otra versión con la misma geometría y el mismo espaciado. Edita el texto y los colores de la copia de forma independiente sin cambiar el original.',
      tags: ['Formas', 'copiar y pegar', 'anotaciones en Canvas'],
    },
    {
      id: 'visual-qa',
      title: 'QA visual de tu aplicación',
      body: 'Portal apuntando al dev server (http://localhost:5173) conectado a un agente: "abre el portal, haz el flujo de checkout, toma screenshot y dime qué se rompió". El agente navega, ejecuta JS, lee el DOM y reporta.',
      tags: ['Portal', 'screenshot', 'eval/dom'],
    },
    {
      id: 'mobile-qa',
      title: 'Reproducir y validar un flujo en iOS o Android',
      body: 'Agrega Dispositivo móvil al Canvas o ábrelo desde Workbench. Conecta un iOS Simulator en Apple Silicon, un AVD Android en macOS, Windows o Linux, o confirma explícitamente un dispositivo Android físico autorizado en ADB; luego instala un build del workspace. El mismo nodo persistente y la misma sesión continúan en ambas vistas. La pantalla completa se ajusta al panel por defecto; usa zoom, 1:1 y scroll en ambos ejes para inspeccionar detalles. Tú o un agente pueden tocar, deslizar, escribir, girar, usar botones del sistema, cambiar permisos, inspeccionar accesibilidad, capturar pantallas y recopilar logs limitados manteniendo todos los artefactos dentro del proyecto.',
      tags: ['iOS/Android', 'QA móvil', 'CLI/MCP'],
    },
    {
      id: 'research-summary',
      title: 'Investigación automatizada con resumen',
      body: '"Usa el Portal Investigación para leer sobre X, crea una nota llamada Resumen X y escribe los hallazgos en bullet points." El agente navega, extrae y escribe — tú lo lees formateado en la nota conectada.',
      tags: ['Portal', 'notas', 'note create'],
    },
    {
      id: 'inbox-files',
      title: 'Bandeja de archivos procesada sola',
      body: 'Rutina cada 2 min: "lista ./inbox; para cada imagen nueva, descríbela y clasifícala; muévela a ./inbox/done y regístrala en el tablero". Suelta archivos en la carpeta y el equipo procesa en lote, sin parar.',
      tags: ['Rutinas', 'carpetas', 'lote'],
    },
    {
      id: 'cross-review',
      title: 'Revisión cruzada entre providers',
      body: 'Conecta Claude y Codex: Claude implementa, Codex revisa (orkestrai ask), el veredicto vuelve por la misma cuerda (se enciende verde durante la conversación). Dos miradas de modelos diferentes en cada cambio.',
      tags: ['Conexiones', 'ask', 'multi-provider'],
    },
    {
      id: 'choose-agent-provider',
      title: 'Elegir un agente sin aprender CLIs',
      body: 'Usa un provider que ya tengas instalado y autenticado; Orkestrai se ocupa de la terminal, el puente y la reanudación de la conversación. Claude, Codex, Kimi, OpenCode, Cursor, Antigravity, Cline y Devin aparecen en la misma barra cuando están disponibles. Para campañas, identidad visual, investigación, contenido o producto, nombra a los agentes por el resultado esperado y agrega un segundo provider solo cuando quieras una revisión independiente.',
      tags: ['8 providers', 'sin conocer terminal', 'cualquier profesión'],
    },
    {
      id: 'pin-favorite-agents',
      title: 'Mantener tus agentes favoritos a un clic',
      body: 'Abre Agentes en la barra inferior y fija hasta cuatro servicios que uses con más frecuencia. Los favoritos listos se convierten en botones directos junto al menú, en el orden elegido, en todos los workspaces y reinicios; un servicio temporalmente no disponible sigue guardado sin ocupar espacio.',
      tags: ['Menú Agentes', 'favoritos fijados', 'preferencia global'],
    },
    {
      id: 'setup-agent-provider',
      title: 'Preparar un provider de IA sin adivinar comandos',
      body: 'Abre la Central de Providers para ver qué agentes ya puede usar este dispositivo. Expande Claude, Codex, Kimi, OpenCode, Cursor, Antigravity, Cline o Devin, sigue la instalación indicada para tu sistema, completa el inicio de sesión en la CLI oficial y usa Verificar de nuevo antes de volver al canvas.',
      tags: ['Central de Providers', 'configuración guiada', 'credenciales locales'],
    },
    {
      id: 'deploy-sentinel',
      title: 'Centinela de deploy/tests',
      body: 'Rutina cada hora en un shell o agente: "corre los tests; si fallan, abre una tarea para el equipo y notifícame (orkestrai notify)". Recibes notificación nativa del sistema y el kanban ya tiene la tarjeta.',
      tags: ['Rutinas', 'notify', 'CI local'],
    },
    {
      id: 'automate-workspace',
      title: 'Automatizar trabajo repetible con trazabilidad',
      body: 'Abre Automatizaciones en Canvas o Workbench, empieza con una receta de operaciones, investigación, diseño, marketing o desarrollo y elige el disparador y la acción exactos. Usa eventos de tarea y mensaje para coordinación, cambios de archivo o commit para flujos locales, límites de uso como protección de routing, webhooks para sistemas externos y la conexión cifrada de GitHub para pull requests. El historial muestra qué disparó, qué agente lo recibió, qué acción terminó y si hay un reintento limitado disponible.',
      tags: ['Automatizaciones', 'disparadores', 'historial de ejecución'],
    },
    {
      id: 'framework-preset',
      title: 'Preset de tu framework (proyecto nuevo en 30s)',
      body: 'Abre la Biblioteca de presets y elige React, Next.js, SvelteKit, Svelar o Laravel. El proyecto nace con líder, implementación, arquitectura y QA conectados, roles completos, skills para Claude/Codex, tablero y tarea inicial. Las terminales usan el modo autónomo de acceso total del adapter del provider para que el equipo ejecute sin confirmaciones repetidas. Guarda el workspace como preset para duplicar y personalizar la receta.',
      tags: ['Biblioteca de presets', 'roles/skills', 'bootstrap'],
    },
    {
      id: 'portable-role-library',
      title: 'Reutilizar un rol especialista de otro proyecto',
      body: 'Abre Roles, elige "Descubrir en otra carpeta..." y selecciona el proyecto que contiene el rol. Orkestrai valida los archivos limitados en .orkestrai/roles de ese proyecto, importa solo nombres nuevos y nunca sobrescribe un rol existente en el workspace.',
      tags: ['Roles', 'instrucciones portátiles', 'importación segura'],
    },
    {
      id: 'custom-workflow',
      title: 'Un tablero con las etapas de tu proceso',
      body: 'Abre Etapas en el encabezado de Tareas y crea el flujo que corresponde a tu trabajo: Ideas → Producción → Revisión → Aprobación → Publicado. El líder y los especialistas leen y actualizan esas etapas automáticamente, sin que tengas que aprender comandos.',
      tags: ['Etapas personalizadas', 'aprobación', 'cualquier proceso'],
    },
    {
      id: 'campaign-launch',
      title: 'Una campaña completa sin armar el equipo',
      body: 'Elige Campaña y lanzamiento en la Biblioteca. El canvas nace con líder de campaña, investigación de mercado, copy, canales y métricas, además de briefing y primera tarea. Para trabajo visual o editorial, usa Brand y diseño o Contenido y SEO.',
      tags: ['Marketing', 'diseño', 'contenido'],
    },
    {
      id: 'orkestrai-contributing',
      title: 'Contribuir a Orkestrai con tres perspectivas',
      body: 'Aplica Orkestrai Contributing. Claude lidera, Codex y Kimi actúan como oráculos independientes y ambos deben aprobar el plan antes de crear cualquier tarea; especialistas Svelar, desktop y QA/release ejecutan el plan documentado.',
      tags: ['Claude + Codex + Kimi', 'consenso', 'open source'],
    },
    {
      id: 'approval-pipeline',
      title: 'Pipeline escribe → revisa → aprueba',
      body: 'Flujo con 3 pasos: Dev escribe la feature, Revisor la critica (la salida de uno se vuelve {{input}} del otro) y el paso de Aprobación pausa hasta que des OK en el nodo. El progreso aparece en vivo y las últimas ejecuciones quedan en el historial del flujo.',
      tags: ['Flujos', 'aprobación humana', 'pipeline'],
    },
    {
      id: 'chained-flows',
      title: 'Flujos encadenados (pipeline de pipelines)',
      body: 'Conecta un Flujo a otro en el canvas: cuando el primero termina con éxito, su salida final dispara el siguiente automáticamente (el fallo no encadena, los ciclos se bloquean). Ej.: Flujo "Investigación" → Flujo "Redacción" → Flujo "Revisión SEO", o fan-out — un Flujo "extraer tópicos" alimentando los Flujos "traducción EN" y "traducción ES" al mismo tiempo. Y con el botón Sincronizar, cada agente conectado al Flujo se vuelve un paso en el orden de las aristas — el pipeline es el propio dibujo.',
      tags: ['Flujos', 'encadenamiento', 'fan-out'],
    },
    {
      id: 'ui-exploration',
      title: 'Crea tres direcciones completas de UI antes de implementar',
      body: 'Abre Diseño en la barra del Canvas y elige Tres direcciones completas de UI. Indica objetivo, público, plataforma, destino del código, restricciones, referencias y si Light y Dark son obligatorios. Orkestrai crea un grupo trazable con una spec vinculada, ocho tareas progresivas en Kanban y tres documentos Diseño nativos: Claridad, Expresiva y Eficiente. Cada diseñador comienza solamente con una pantalla principal desktop y una mobile, preferiblemente mediante importación semántica HTML/CSS, y debe mostrar la primera revisión en hasta cinco minutos. El estado del nodo distingue esperando, trabajando, estancado y listo para revisión. Abre el documento y usa Revisión visual dentro de Calidad para aprobarlo o devolver feedback trazable; el conteo de capas y la auditoría estructural no sustituyen esa inspección. Solo la dirección aprobada se expande a estados responsivos, tokens tipados, componentes, prototipo y vista previa de código real. Navega documentos anchos con trackpad, Mano (H), Espacio+arrastrar o el botón central y usa Ajustar. Finaliza validando el resultado aprobado contra un Portal o dispositivo móvil y registrándolo en Review Center.',
      tags: ['3 direcciones de UI', 'diseño + tokens + código', 'aprobación humana'],
    },
    {
      id: 'design-figma',
      title: 'Diseña una interfaz junto con tu equipo de IA',
      body: 'Agrega un nodo Diseño nativo y ábrelo en el Modo Diseño del Canvas o en Workbench. Crea paths vectoriales, máscaras, gradientes, frames responsivos con auto layout y assets reutilizables o pega un SVG para convertir paths, transforms, estilos y gradientes en capas nativas editables. Agrupa o desagrupa el arte, selecciona todas las capas que usan el mismo color, reemplaza colores coincidentes en sólidos y stops de gradiente y copia la selección como SVG o PNG. En Variables, usa presets, importa o exporta tokens, define modos y aliases, vincula propiedades y audita repeticiones. En Componentes, crea fuentes, instancias, propiedades, variantes, slots y overrides. Publica bibliotecas versionadas solo para workspaces autorizados o extrae y sincroniza CSS variables, Tailwind y contratos Svelte, React o Vue mediante el escaneo estático de Código. En la pestaña Figma, mantén el MCP remoto oficial administrado para agentes compatibles, guarda un token REST de solo lectura en la bóveda del sistema operativo, inspecciona el enlace del archivo, elige páginas o frames e importa capas, vectores, assets, estilos, variables, componentes, variantes, instancias locales e identidades de bibliotecas externas al mismo documento nativo. Los orígenes vinculados comparan hashes remotos y locales antes de una sincronización selectiva para decidir entre el cambio de Figma, la edición local y un conflicto. Elegir la versión local agrega solo esa capa revisada a la cola de Figma. El plugin propio transfiere la selección activa de Figma con imágenes raster, copia SVG editable o JSON estructural, crea una página de Figma con assets, variables, estilos, componentes y variantes nativos del documento Orkestrai y envía únicamente los cambios vinculados en cola de vuelta al archivo actual mediante una conexión del workspace restringida al loopback. Conecta el documento al Diseñador o líder: el agente lee la revisión exacta, combina el MCP oficial de Figma con tools tipadas de inspección, importación y sincronización de Orkestrai y verifica el resultado mientras el editor se actualiza en vivo. Los mappings existentes de Code Connect completan el vínculo persistente nodo Figma → capa Orkestrai → implementación. Exporta la selección o página aprobada en SVG, PNG, JPEG, WebP o PDF. Documento, assets, miniaturas, design system, vínculos Figma e historial de revisiones quedan en el workspace y siguen disponibles en la búsqueda junto con tareas, notas, archivos, portales y el resto del equipo.',
      tags: ['Modo Diseño nativo', 'vectores + auto layout', 'manual + agentes'],
    },
    {
      id: 'design-delivery',
      title: 'Convertir diseño en código y validar la implementación',
      body: 'Abre un documento Diseño nativo y elige Componentes → Código. Importa estructuras HTML/Tailwind, Svelte, React/JSX o Vue como capas nativas editables sin ejecutar código del proyecto. Para entregar, selecciona un frame o grupo, elige el adapter Svelar/Svelte 5, React, Next.js, Vue 3 o HTML/Tailwind, revisa el archivo generado completo y solo entonces escríbelo dentro del workspace. Los mappings compatibles de Code Connect reutilizan primero los componentes reales del proyecto; el artefacto vinculado se abre directamente en Monaco y se niega a sobrescribir un archivo modificado después de la vista previa. Los agentes conectados usan design_import_code y design_generate_code_preview/apply mediante el MCP tipado de Orkestrai, o los comandos equivalentes de la CLI incluida, con la misma revisión y atribución a la tarea. En Validar, elige un Portal en vivo o dispositivo iOS/Android conectado y un viewport de frame, móvil, tablet o escritorio. Orkestrai captura la implementación, normaliza ambas imágenes y muestra diseño, implementación, overlay ajustable y pixel diff. Crea una tarea de feedback en Kanban con las tres capturas o una entrada del Centro de Review vinculada al cambio Git real para que un líder o especialista pueda reproducir, asignar y aprobar el resultado.',
      tags: ['diseño a código', 'pixel diff', 'Monaco + Centro de Review'],
    },
    {
      id: 'design-prototype',
      title: 'Prototipa y anima la experiencia antes de implementarla',
      body: 'Abre un documento Diseño nativo y cambia el inspector derecho de Diseño a Prototipo. Crea uno o más flujos iniciales, selecciona cualquier capa y vincula interacciones de clic, presión, hover o tiempo que navegan a un frame, abren o cierran un overlay, vuelven por el historial, desplazan hasta un contenido o cambian el modo de una variable. Los frames pueden desplazarse horizontal o verticalmente mientras los hijos elegidos permanecen fijos. Ejecuta el flujo en el player de presentación enfocado con transiciones, hotspots, marco de dispositivo, pantalla completa y controles de reinicio/volver; después comparte un prototipo HTML autocontenido y de solo lectura sin exponer el workspace. En Motion, crea tokens reutilizables de duración y easing, agrega tracks y keyframes por capa, previsualiza el resultado y copia keyframes CSS o código Motion.dev. Prototipo, animación, variables, componentes, artefactos de código e historial de revisiones siguen en el mismo documento nativo, por lo que diseñadores y agentes conectados editan la misma fuente mediante el command bus MCP protegido por revisión.',
      tags: ['prototipo interactivo', 'timeline de motion', 'manual + agentes'],
    },
    {
      id: 'design-collaboration',
      title: 'Revisa trabajo visual con personas y agentes',
      body: 'Abre Colaboración en un documento Diseño nativo. Sigue a un participante en vivo, deja un comentario en la página o capa y pide a un agente una propuesta versionada en vez de una edición inmediata. Revisa el diff estructural y la vista previa; luego aprueba, rechaza, envía a Council o crea un Piso paralelo. Para un revisor externo, comparte el workspace y concede solo el nivel de Diseño necesario; Companion recibe resúmenes sanitizados en vez del scene graph o los archivos del proyecto.',
      tags: ['presencia en vivo', 'comentarios + propuestas', 'Council + Pisos'],
    },
    {
      id: 'design-quality',
      title: 'Audita y recupera un diseño de producción',
      body: 'Abre Calidad en un documento Diseño nativo para encontrar problemas de nombres, recortes, superposición, contraste y accesibilidad y saltar directamente a cada capa. Inicia un producto, página de marketing, flujo mobile o design system real desde un template nativo editable. Backup automático, migración de schema, historial limitado, restauración explícita y renderizado incremental protegen documentos grandes. Un agente conectado puede usar design_audit y aplicar los mismos templates sin ignorar revisiones.',
      tags: ['auditoría de calidad', 'backup + recuperación', 'documentos grandes'],
    },
    {
      id: 'mcp-tools',
      title: 'Agentes con tools externas vía MCP',
      body: 'Agrega servidores MCP en el editor del workspace (ej.: filesystem, web, base de datos) — los agentes ganan las tools nativamente, y el propio Orkestrai aparece como servidor MCP con las acciones del canvas (orkestrai mcp). Los presets pueden cargar los MCPs junto con el equipo.',
      tags: ['MCP', 'tools tipadas', '.mcp.json'],
    },
    {
      id: 'managed-ports',
      title: 'Liberar puertos dejados por dev servers',
      body: 'Crea un Portal local para la app (ej.: http://localhost:5173). El panel Puertos, justo después de Uso en la barra inferior, muestra si ese listener está activo, qué proceso/PID lo ocupa y permite detenerlo con confirmación. Solo aparecen puertos vinculados a Portales locales del workspace; el servidor del propio Orkestrai queda protegido.',
      tags: ['Puertos', 'Portal', 'dev server'],
    },
    {
      id: 'leader-dictation',
      title: 'Dictar en cualquier campo de texto',
      body: 'Enfoca cualquier campo editable — título o descripción del kanban, rol, nota o formulario — y usa la esfera de voz global o Alt+Espacio. Desde el primer clic, el campo se conserva y la transcripción entra en el cursor sin requerir líder. En Configuración → Dictado por voz, puedes activar el envío automático: en terminales, la transcripción también presiona Enter; los campos comunes siguen recibiendo solo el texto. El indicador clicable muestra si la esfera está fijada o libre y abre directamente los controles de posición; el tooltip también presenta el atajo Ctrl+clic o Command+clic. En el Workbench, la posición fijada usa un espacio propio del encabezado y no cubre pestañas ni acciones; al liberarla, vuelve a moverse libremente. Sin campo activo, el control encuentra al líder del workspace tanto en Canvas como en el Workbench. En macOS, Fn/Globe por sí sola pertenece al sistema; elige una combinación o una tecla F1–F12.',
      tags: ['Dictado global', 'campos de texto', 'voz local'],
    },
    {
      id: 'audio-devices',
      title: 'Elegir micrófono y altavoz',
      body: 'Abre Configuración → Voz para elegir y probar el micrófono usado por todo dictado local y el altavoz usado en vistas previas y respuestas habladas. Autoriza el micrófono para revelar los nombres, observa el medidor de entrada en vivo y reproduce un tono corto en la salida antes de guardar. El dictado graba PCM directo por la misma ruta Web Audio del medidor y normaliza la voz baja antes del STT local. Si desaparece el dispositivo elegido, Orkestrai vuelve al predeterminado del sistema. Permiso denegado, dispositivo ausente, captura interrumpida, probable contención y un dispositivo que abre sin producir señal reciben indicaciones distintas; las plataformas que no pueden dirigir el audio de la app a una salida específica explican la limitación en lugar de ignorar la selección.',
      tags: ['Dispositivos de audio', 'prueba de micrófono', 'prueba de altavoz'],
    },
    {
      id: 'switch-agent-provider',
      title: 'Cambiar el provider de un miembro del equipo',
      body: 'Abre ⇄ en el encabezado del agente y elige otro provider instalado. Orkestrai cierra solo la PTY y la conversación anteriores, conserva nombre, rol, Modo Maestro, piso, posición y conexiones, e inicia el reemplazo en el mismo nodo.',
      tags: ['Providers', 'cambio sin recrear', 'equipo preservado'],
    },
    {
      id: 'devin-local-agent',
      title: 'Usar Devin como miembro local del equipo',
      body: 'Instala y autentica la CLI oficial de Devin y crea un agente Devin desde el canvas. Busca en la lista de modelos de la cuenta dentro del selector limitado y desplazable, elige uno e inicia con acceso autónomo al workspace. Orkestrai provisiona el puente MCP y la skill nativos y reanuda la conversación local exacta después de reiniciar la app.',
      tags: ['Devin CLI', 'agente local', 'reanudación exacta'],
    },
    {
      id: 'multilingual-spoken-replies',
      title: 'Escuchar respuestas en tu idioma',
      body: 'En Configuración → Voz, elige una de las tres voces locales: portugués de Brasil, inglés de Estados Unidos o español latinoamericano. Ajusta la velocidad entre 0,75× y 1,50× y usa Escuchar vista previa para comparar antes de activar el altavoz en el encabezado del agente. Parakeet sigue a cargo únicamente del dictado; las respuestas usan Supertonic 3 offline y comienzan a sonar por frases para reducir la espera.',
      tags: ['TTS', 'Supertonic 3', 'pt-BR · en-US · es-MX'],
    },
    {
      id: 'quota-aware-delegation',
      title: 'Distribuir trabajo sin agotar la cuota',
      body: 'Agrega el nodo Uso al canvas, define Claude como origen y Codex como fallback y elige la ventana de 5 horas, semanal o mensual y su porcentaje. Antes de delegar trabajo nuevo, el líder consulta orkestrai usage y recomienda el agente saludable cuando el origen cruza ese límite. El panel también explica por qué Antigravity, Cursor, Devin, OpenCode o Cline no proporcionan el mismo porcentaje automático y enlaza cada fuente oficial en lugar de adivinar; las conversaciones y tareas en curso permanecen en su provider actual.',
      tags: ['Uso en el canvas', 'fallback', 'delegación'],
    },
    {
      id: 'organize-canvas',
      title: 'Reorganizar un workspace que creció',
      body: 'Selecciona los nodos que deseas realinear y elige Organizar canvas en la barra o la paleta de comandos. Orkestrai organiza solo la selección; sin nada seleccionado, organiza todo el canvas en filas deterministas sin superponer nodos. Las conexiones permanecen detrás de todos los nodos.',
      tags: ['Layout del canvas', 'selección', 'conexiones'],
    },
    {
      id: 'focused-workspace-view',
      title: 'Trabajar con varios artefactos en el Workbench',
      body: 'Usa el selector Canvas/Workbench en la esquina superior izquierda para abrir el explorador agrupado de workspaces. Los elementos abiertos usan pestañas verticales por defecto; en Configuración → Apariencia, puedes elegir pestañas horizontales sobre cada panel. Divide el panel activo a la derecha o abajo y organiza hasta ocho terminales, tableros, notas, portales, archivos, flujos o nodos de uso redimensionables. Arrastra una pestaña a otro panel o usa su menú Mover a. El layout se guarda por workspace, los layouts anteriores migran automáticamente y las referencias inválidas se descartan de forma segura. Los artefactos del canvas conservan su identidad persistida para mantener sesiones, contenido y cambios sincronizados; los archivos usan pestañas locales y no crean nodos en el canvas. Las métricas de fuente y la geometría del panel se estabilizan antes de adjuntar una PTY existente, manteniendo el cursor parpadeante alineado después de pasar por Configuración, documentación, Canvas o Workbench. El pie muestra todas las ventanas de uso de Claude, Codex y Kimi y abre los detalles con un clic, usando el mismo snapshot de cinco minutos que el panel y el nodo Uso. Command/Ctrl+Page Up o Page Down recorre los elementos, Shift cambia de panel y Command/Ctrl+\\ divide el panel. La esfera de voz también usa al líder del workspace activo en esta vista. Al volver al Canvas, Orkestrai conserva el workspace y centra el nodo seleccionado.',
      tags: ['Workbench', 'hasta 8 paneles', 'divisiones recursivas'],
    },
    {
      id: 'monitor-team-control-center',
      title: 'Ver lo que el equipo realmente está haciendo',
      body: 'Abre el Centro de control desde un workspace expandido en Workbench para comparar quién trabaja, está inactivo, bloqueado, espera una respuesta o está offline. El explorador compacto muestra la tarea, el estado y el Piso de cada agente activo; los agentes y nodes de Pisos aterrizados o eliminados permanecen en el historial sin inflar los conteos actuales. La bandeja de comunicaciones demuestra si un handoff entró en cola, fue entregado, recibido, respondido o falló bajo un id persistente. Cambia de workspace o reinicia la app sin despertar terminales inactivos: el historial reconstruye la misma vista operativa.',
      tags: ['Centro de control', 'entrega verificada', 'actividad de agentes'],
    },
    {
      id: 'triage-attention-across-workspaces',
      title: 'Gestionar todos los workspaces desde un centro de atención',
      body: 'Abre la campana junto a Canvas/Workbench para ver preguntas, solicitudes de permiso, bloqueos y fallos de todos los workspaces, con el actual primero. Expande cualquier elemento para leer el fallo y la solicitud original completos sin salir del centro. Abrir origen es una acción separada y queda deshabilitada cuando el agente o la tarea ya fueron eliminados; el contenido persistido sigue siendo legible. Márcalo como leído, posponlo o resuélvelo sin perder el historial. Usa Command/Ctrl+K con type:attention, workspace:"Nombre", agent:"Nombre", status:open, has:error, before: o after: para recuperar el mismo evento después.',
      tags: ['Centro de atención', 'triaje entre workspaces', 'operadores de búsqueda'],
    },
    {
      id: 'trace-delivery-workstream',
      title: 'Rastrear una entrega desde el briefing hasta la evidencia Git',
      body: 'Crea y asigna el trabajo en Kanban y abre Flujos de trabajo en Workbench. La tarea se convierte en la identidad estable de la entrega: agente y Piso aparecen automáticamente, las decisiones del Consejo mantienen el mismo briefing, el Centro de revisión vincula la revisión y los archivos exactos, y la línea temporal explica cada transición. Abre el tablero, Consejo o revisión original cuando quieras; el flujo nunca sustituye ni duplica esos registros.',
      tags: ['Flujos de trabajo', 'trazabilidad integral', 'Kanban a Git'],
    },
    {
      id: 'preserve-sourced-workspace-memory',
      title: 'Conserva una decisión sin perder su fuente',
      body: 'Abre Memoria del workspace, registra la decisión o restricción reutilizable y adjunta la declaración del usuario, tarea, nota, archivo, URL, mensaje, revisión o Consejo que la respalda. Los agentes consultan la misma evidencia solo cuando sea relevante. Cuando la decisión cambie, revísala contra la versión actual para conservar el valor anterior auditable e impedir que ediciones concurrentes se sobrescriban en silencio.',
      tags: ['Memoria del workspace', 'procedencia', 'decisiones versionadas'],
    },
    {
      id: 'triage-traceable-annotations',
      title: 'Clasifica feedback de código y diseño en un solo lugar',
      body: 'Abre el Centro de Anotaciones desde Canvas o Workbench para comparar todos los comentarios abiertos del Centro de revisión y los hilos del Design nativo. Busca por feedback, autor, archivo, capa o artefacto, inspecciona revisión y obsolescencia y abre la fuente canónica para responder o resolver. El centro nunca crea una copia desconectada del feedback.',
      tags: ['Centro de Anotaciones', 'feedback de código + diseño', 'trazabilidad de revisión'],
    },
    {
      id: 'version-and-share-team-pack',
      title: 'Versiona y comparte un equipo completo',
      body: 'Captura el workspace actual como Team Pack personalizado, publica una versión semántica con notas e inspecciona sus checksums inmutables. Exporta el pack a otra instalación o importa uno compartido tras validar schema, tamaño, contenido y SHA-256. Agentes, roles, skills, etapas, rutinas, configuración MCP y layout viajan; las sesiones y credenciales no.',
      tags: ['Team Packs', 'versiones semánticas', 'importación y exportación seguras'],
    },
    {
      id: 'run-agent-huddle',
      title: 'Llega a una decisión con un huddle persistente de agentes',
      body: 'Abre Huddles, define tema y agenda, elige facilitador y agentes participantes y escribe o dicta un turno a quienes deban opinar. Sigue las respuestas pendientes y completas en una transcripción ordenada, escucha las nuevas cuando TTS esté activo y permite que los agentes participantes registren hallazgos concisos por el bridge. Termina la sala cuando la decisión esté clara y crea una tarea Kanban vinculada para conservar agenda y transcripción en el flujo de entrega. Un colaborador remoto participa en la misma sala sanitizada según su permiso para ver, hablar o gestionar.',
      tags: ['Huddle persistente', 'dictado + TTS', 'evidencia en la tarea'],
    },
    {
      id: 'edit-and-preview-files',
      title: 'Editar e inspeccionar archivos sin salir del Workbench',
      body: 'Expande Archivos en la barra lateral del Workbench y abre un archivo del workspace directamente en una pestaña local, sin crear un nodo en el canvas. El árbol de archivos del Canvas y Command/Ctrl+K usan la misma apertura directa. Monaco conserva cursor, undo, selección y estado sin guardar entre paneles. Busca o reemplaza texto, navega por símbolos, formatea archivos compatibles y elige minimapa, ajuste de línea, tamaño de fuente o guardado automático opcional en Configuración → Apariencia. Markdown alterna entre fuente y vista previa sanitizada; los PDFs tienen navegación y zoom; las imágenes permiten zoom, desplazamiento, dimensiones y transparencia; los binarios muestran metadatos y se abren con la aplicación del sistema. Los archivos mayores de 512 KB se abren en una vista limitada de solo lectura para no sobrescribir contenido que no fue cargado.',
      tags: ['Editor Monaco', 'vistas offline', 'estado sin guardar'],
    },
    {
      id: 'share-reference-material',
      title: 'Entregar contexto completo al equipo',
      body: 'Arrastra una imagen, PDF, archivo o enlace HTTP/HTTPS a una nota de briefing, el composer de un agente o una tarjeta del kanban. Orkestrai guarda archivos de hasta 10 MB dentro del workspace, inserta una referencia legible y entrega el título, la descripción y todos los adjuntos cuando el líder o agente recibe la tarea.',
      tags: ['Adjuntos', 'drag and drop', 'briefing completo'],
    },
    {
      id: 'universal-workspace-search',
      title: 'Encontrar cualquier elemento sin navegar por menús',
      body: 'Presiona Command/Ctrl+K desde cualquier pantalla para buscar workspaces, agentes, tareas, notas, herramientas, roles, skills, archivos, configuración y comandos. La búsqueda muestra contexto y vista previa, recuerda elementos recientes y favoritos y puede abrir un artefacto en el panel actual, a la derecha o abajo. Usa el prefijo content: para buscar dentro del contenido de los archivos. La lectura permanece confinada a la carpeta del workspace.',
      tags: ['Búsqueda universal', 'Command/Ctrl+K', 'archivos y comandos'],
    },
    {
      id: 'review-delivery',
      title: 'Revisar una entrega con evidencias y una decisión clara',
      body: 'Abre el Centro de revisión en Workbench, selecciona los archivos modificados y crea una revisión vinculada a la tarea del kanban y al agente responsable. Registra capturas o evidencias de la entrega, pruebas realizadas y riesgos conocidos. Agrega comentarios a archivos o líneas exactas y después aprueba, solicita cambios o rechaza. Los cambios solicitados se envían al terminal del agente cuando está disponible; si el código cambia antes, el comentario original se conserva marcado como contexto desactualizado.',
      tags: ['Centro de revisión', 'diff Monaco', 'feedback al agente'],
    },
    {
      id: 'portal-design-feedback',
      title: 'Señalar un problema visual en vez de describirlo de memoria',
      body: 'Abre la aplicación en un Portal y elige Inspeccionar diseño. Haz clic en el botón, título, campo, imagen o área de layout que necesita atención, revisa la captura recortada y el contexto seguro del elemento y describe el resultado esperado. Crea una tarea sin responsable para revisión del líder, una tarea ya asignada a un especialista o agrega el feedback a una tarea existente. Cada envío queda trazable en el Kanban sin exponer secretos del navegador.',
      tags: ['Portal Design Mode', 'feedback visual', 'inspección segura'],
    },
    {
      id: 'remote-collaboration',
      title: 'Compartir un workspace sin compartir tu equipo',
      body: 'Habilita el uso compartido experimental, inicia una sesión cifrada de extremo a extremo y elige una invitación para Navegador/móvil o App Orkestrai. El enlace web abre la PWA Remote instalable. La invitación de la app abre automáticamente Orkestrai instalado; el invitado también puede usar Workspace → Entrar a workspace remoto y pegar la invitación. Ambos eliminan el secreto de la URL antes de conectar y guardan una clave de emparejamiento no extraíble solo en ese dispositivo. Comprueba la huella y elige Lector, Colaborador, Operador o Administrador. Un Operador puede mantener conversaciones sanitizadas y trazables con el líder u otro agente y dictar en cualquiera de ellas mediante el STT local del host. La pantalla principal conserva visible el historial del líder; cuando usa herramientas y responde en varias etapas, Remote espera el final real del turno y reúne todos los bloques antes de publicar la respuesta. Un Administrador también puede iniciar o restaurar un agente desconectado. El terminal sin filtrar es un permiso separado y exclusivo del Administrador en ese dispositivo, desactivado por defecto, limitado a un terminal adaptable a la pantalla, con límite de tráfico, cifrado y auditoría. El dictado del terminal inserta el texto sin presionar Enter. No habilita navegación de archivos, visualización de Portales o dispositivos móviles ni edición del Canvas. Revoca el dispositivo o detén la sesión en cualquier momento y consulta los comandos aceptados y rechazados en la auditoría.',
      tags: ['PWA Remote cifrada', 'dictado en el host', 'terminal adaptable opt-in'],
    },
    {
      id: 'custom-app-theme',
      title: 'Adaptar la apariencia a tu trabajo',
      body: 'Elige uno de los tres temas oscuros o el tema claro de alto contraste en Configuración → Apariencia. Duplica el más cercano a tu preferencia, ajusta los tokens de color con vista previa inmediata y exporta el JSON para usar el mismo tema en otra instalación.',
      tags: ['Temas', 'tokens semánticos', 'importar/exportar'],
    },
    {
      id: 'windows-wsl-agents',
      title: 'Usar herramientas instaladas solo dentro de WSL',
      body: 'Elige el runtime más usado al crear o editar el workspace en Windows. Para combinar entornos, abre el menú compacto de cada terminal, selecciona Entorno de ejecución y elige Predeterminado del workspace, Windows nativo o la distribución WSL exacta donde está instalado Kimi, Claude, Codex u otra CLI. Indica la ruta Linux correspondiente a la misma carpeta del proyecto. El indicador WIN/WSL confirma la excepción y solo se reinicia esa terminal. Canvas, archivos, tareas y notas siguen compartidos mientras cada agente usa sus propias herramientas.',
      tags: ['Windows + WSL', 'múltiples distribuciones', 'providers locales'],
    },
    {
      id: 'provider-profiles',
      title: 'Separar cuentas personales y de trabajo de los providers',
      body: 'Abre la Central de Providers, expande Claude, Codex, Kimi, GitHub Copilot, Cursor, Cline u OpenCode y agrega un Perfil con nombre que apunte al directorio o los directorios de configuración de esa cuenta, según la documentación de la CLI. Elígelo en el diálogo de Nuevo agente al crearlo, o después en el menú de la terminal, o enruta trabajo nuevo hacia él desde el nodo Uso. Orkestrai guarda en la base solo la referencia del Perfil y las rutas; las credenciales permanecen en los archivos de la propia CLI y se resuelven en el servidor únicamente al iniciar la PTY. No se puede eliminar un Perfil usado por una terminal o regla de ruteo. Antigravity y Devin quedan deshabilitados aquí hasta contar con un override de cuenta de CLI seguro, documentado y verificable en todas las plataformas.',
      tags: ['Perfiles de provider', 'múltiples cuentas', 'aislamiento de credenciales'],
    },
    {
      id: 'saved-terminal-commands',
      title: 'Reabrir una terminal lista para trabajar',
      body: 'Abre el menú de opciones de una terminal y elige Comandos guardados. Guarda atajos exclusivos de esa terminal o comandos globales disponibles en todas, busca por nombre o contenido y ejecuta cualquier elemento manualmente. En shells puros, activa Ejecutar al reanudar para enviar los comandos una sola vez al crear o restaurar la sesión, incluso en WSL. Orkestrai nunca autoejecuta texto en Claude, Codex, Kimi u otro agente para no contaminar conversaciones. Los comandos se guardan como texto simple: usa variables de entorno o la bóveda de la herramienta para secretos, nunca contraseñas ni tokens en el comando. Las terminales conservan el entorno del sistema operativo y el puente de Orkestrai, pero excluyen los valores privados del servidor de escritorio para que el .env de cada proyecto, incluida APP_KEY de Laravel, tenga prioridad.',
      tags: ['Comandos guardados', 'autoejecución segura', 'shells y WSL'],
    },
    {
      id: 'creative-image-workflow',
      title: 'Crea un personaje, aplica la marca y entrega un carrusel',
      body: 'Inicia el caso de uso guiado para validar la cadena completa sin montar el Canvas manualmente. Al avanzar, Orkestrai crea un Director Creativo Codex, briefs reutilizables de personaje y campaña, un logo PNG de prueba y tres workflows secuenciales: Personaje Master, Personaje con Marca y Carrusel XYZ. Hazlo por mí dispara cada generación real; el tour solo habilita la siguiente etapa después de validar los archivos del workspace y materializar nodos Imagen. El primer resultado de una etapa se conecta automáticamente como referencia ordenada de la siguiente, preservando prompts, rutas, procedencia e historial. El ejemplo genera tres masters, dos poses con marca y tres slides para una validación rápida; cada workflow acepta hasta diez resultados. Se requiere una cuenta o suscripción Codex autenticada con ImageGen, sin clave de API de OpenAI.',
      tags: ['Codex ImageGen', 'personaje y marca', 'carrusel guiado'],
    },
    {
      id: 'desktop-diagnostics',
      title: 'Diagnosticar una acción del escritorio que no responde',
      body: 'Abre Ver > Herramientas de desarrollo y reproduce el problema observando Console. Luego elige Ayuda > Abrir carpeta de logs y comparte orkestrai.log con soporte. El log local rotativo incluye errores del renderer, fallos del servidor interno y cierres inesperados; las credenciales comunes se ocultan y la salida normal de los agentes no se guarda.',
      tags: ['Herramientas de desarrollo', 'logs locales', 'soporte'],
    },
  ],
  changelog: [
    {
      date: '27 ago 2026 · 0.22.0',
      title: 'Orkestrai 0.22.0: flujos nativos de imagen para personas y agentes',
      summary: 'Construye grafos reutilizables de generación de imágenes a partir de briefs, referencias y agentes sin salir del workspace.',
      items: [
        'Los nodos de Generación de Imágenes combinan el prompt con el contexto de Notas conectadas, hasta cinco referencias ordenadas de Imagen y un Codex activo conectado, y luego devuelven cada resultado validado al canvas y a la carpeta elegida del workspace.',
        'El ejecutor Codex usa su tool nativa autenticada image_gen.imagegen una vez por resultado; las referencias se pasan mediante referenced_image_paths y la transparencia PNG real se solicita en el prompt.',
        'Un Codex conectado puede crear y configurar borradores, gestionar entradas ordenadas de Notas e Imágenes y ejecutar un único run lógico con hasta diez resultados mediante las tools tipadas image_workflow_*.',
        'Orkestrai nunca solicita ni almacena una clave de API de imagen y nunca llama directamente a un endpoint del provider. Solo el Codex asignado completa el run, y las rutas exactas, firmas, tamaños y errores públicos se limitan antes de persistir.',
        'Los runs conservan historial y procedencia trazables, mientras Canvas, Workbench, CLI/MCP y el tour de equipo creativo operan el mismo flujo visible sin un estado paralelo de automatización.',
        'El caso de uso guiado ahora monta y valida Personaje → Marca → Carrusel: crea briefs y un logo de prueba, espera resultados reales y conecta automáticamente cada resultado con la siguiente etapa.',
        'El panel avisa que ImageGen requiere una cuenta o suscripción autenticada de Codex sin solicitar una clave de API de OpenAI.',
        'Los agentes nuevos o recuperados nunca reanudan la última conversación de otra terminal: Orkestrai reanuda solo el ID exacto atribuido al nodo e inicia una conversación limpia cuando ese vínculo aún no existe.',
        'Las terminales Codex interactivas reciben siempre el MCP actual de la aplicación antes de resume, los builds incluyen el runtime WebADB completo y las llamadas de imagen ya no fallan por un MCP global antiguo o un módulo Android ausente.',
        'Los Portales no disponibles usan reintentos progresivos limitados y retry manual; las solicitudes antiguas del tablero devuelven no encontrado; la limpieza ConPTY de Windows y los probes locales dejan de contaminar los logs con errores esperados.',
        'Los logs del escritorio siguen siendo accionables: los resultados esperados del Portal usan respuestas estructuradas, la captura del micrófono usa AudioWorklet, Electron y el actualizador usan APIs actuales y las derivaciones Svelte inertes dejan de emitir avisos.',
      ],
    },
    {
      date: '27 ago 2026 · 0.21.2',
      title: 'Orkestrai 0.21.2: pegado confiable en terminales de Windows',
      summary: 'Ctrl+V ahora pega el texto copiado en vez de ser confundido con un comando para pegar imágenes por las CLIs de agentes.',
      items: [
        'Las terminales de Windows detectan texto en el portapapeles nativo y disparan un pegado real de xterm, incluido el bracketed paste usado por CLIs interactivas.',
        'El contenido del portapapeles permanece dentro de Electron y nunca se expone mediante el puente del renderer; solo la ventana enfocada de Orkestrai puede solicitar el pegado.',
        'Cuando el portapapeles no contiene texto, Ctrl+V conserva el carácter de control original para que los providers con pegado de imágenes mantengan ese flujo.',
      ],
    },
    {
      date: '26 ago 2026 · 0.21.1',
      title: 'Orkestrai 0.21.1: workspaces en pausa y Windows en segundo plano',
      summary: 'La descarga ahora es persistente y los runtimes internos ya no roban el foco en Windows.',
      items: [
        'Descargar un workspace persiste su estado en pausa y detiene las terminales vivas, la creación de sesiones por tareas y el encolado de automatizaciones en segundo plano, manteniéndolo inactivo entre navegaciones y reinicios hasta que lo abras explícitamente.',
        'Los workspaces en pausa se identifican en Canvas y Workbench, mientras su layout y las conversaciones exactas de los agentes quedan guardados para la siguiente apertura explícita.',
        'Las invocaciones internas de la CLI y el servidor ya no activan el foco de instancia única en Windows; abrir intencionalmente la app, la bandeja, las notificaciones y los enlaces de colaboración sigue funcionando normalmente.',
      ],
    },
    {
      date: '26 ago 2026 · 0.21.0',
      title: 'Orkestrai 0.21.0: Roles portátiles y creación más rápida de workspaces',
      summary: 'Reutiliza Roles especialistas, elige la cuenta correcta del provider y archiva el workspace en una carpeta durante la creación.',
      items: [
        'Agregado el botón "Descubrir en otra carpeta..." junto al discover del repositorio ya existente en Roles: elige cualquier carpeta en un diálogo nativo y Orkestrai importa cada `role.json` encontrada dentro de `.orkestrai/roles/` ahí.',
        'Los archivos de rol importados tienen límites de tamaño y cantidad, se validan antes de persistir, quedan confinados al proyecto seleccionado y nunca sobrescriben un rol existente en el workspace.',
        'Agregado un campo Perfil en el diálogo de Nuevo agente para providers con Perfiles de multi-cuenta configurados.',
        'El par perfil/provider se valida antes de persistir la terminal; las credenciales permanecen en el almacenamiento seguro y nunca entran en los datos del canvas.',
        'Agregado un campo Carpeta en el diálogo de Nuevo workspace, y un ícono de más en el encabezado de cada carpeta que abre el diálogo con ella preseleccionada como destino.',
        'Los workspaces normales o basados en preset se guardan directamente en el destino validado, evitando una creación parcial en la raíz cuando la carpeta es inválida.',
        'Cambiar solo el perfil de una terminal ahora muestra la confirmación correcta del perfil, y la vista enfocada envía esa selección al backend en vez de descartarla.',
        'Usage y el pie de Workbench ahora identifican las filas por el id único de enrutamiento provider/perfil, evitando claves duplicadas y mostrando el nombre de cada cuenta.',
        'Después de confirmar el reinicio, Windows y Linux instalan la actualización verificada en silencio y vuelven a abrir la app sin mostrar el asistente del instalador.',
        'Los paneles laterales ahora quedan debajo de la barra de título de 36px de Windows y mantienen el borde inferior dentro del área visible.',
        'El submenú de tema de la terminal ahora se desplaza dentro de su propio límite en vez de desbordarse fuera de la pantalla.',
        'Los botones nativos interactivos y los controles con role ahora usan un cursor de puntero, mientras los controles deshabilitados mantienen su cursor no interactivo.',
      ],
    },
    {
      date: '25 ago 2026 · 0.20.1',
      title: 'Orkestrai 0.20.1: configuración MCP segura en Codex',
      summary: 'Codex mantiene el puente automático del workspace sin perder el control de su dotfile global ni la visibilidad en Git.',
      items: [
        'Codex recibe las definiciones MCP de Orkestrai y del Figma oficial mediante parámetros temporales al iniciar en runtime nativo o WSL; el aprovisionamiento deja de reescribir ~/.codex/config.toml.',
        'La estructura exacta de args multilínea huérfanos y env duplicado escrita por builds anteriores se repara tras validarla, con backup, acceso serializado y reemplazo atómico; el TOML inválido no relacionado permanece intacto.',
        'AGENTS.md, los archivos MCP de providers y opencode.json dejan de ocultarse mediante .git/info/exclude; los bloques heredados exactos se reducen a directorios de runtime y skills propiedad de Orkestrai.',
        'Los fallos al aprovisionar el puente ahora entran en los diagnósticos del escritorio en lugar de desaparecer silenciosamente.',
      ],
    },
    {
      date: '25 ago 2026 · 0.20.0',
      title: 'Orkestrai 0.20.0: workspaces organizados y providers más completos',
      summary: 'Carpetas anidadas, pruebas responsivas en Portal, más personalización de terminales y gestión segura de MCPs y skills para todos los providers llegan juntas.',
      items: [
        'Los servidores MCP y las skills agregados al workspace ahora se propagan a los formatos nativos de Cursor, Cline, Devin, Antigravity y OpenCode, junto con los providers ya cubiertos por el puente de Orkestrai.',
        'El marketplace de Skills abre con un catálogo curado, combina resultados en vivo de forma segura y valida las descargas del registro antes de que lleguen al workspace.',
        'Los workspaces pueden organizarse en carpetas anidadas persistentes en la barra lateral del Canvas, con arrastrar y soltar, subcarpetas, renombrado, estado colapsado, prevención de ciclos y eliminación no destructiva.',
        'Portal incorpora nombre persistente editable separado de la dirección, automatización por nombre único o id, inventario de todos los Portales del workspace con conexión explícita, reutilización de URLs repetidas, barra de dirección coherente con el tema activo y viewport responsivo real con desplazamiento contenido.',
        'Configuración muestra una vista previa de colores, fuente y padding de la terminal, usa el modificador correcto del sistema y agrega Monokai, Ayu Dark, Rosé Pine y Solarized Light.',
        'La selección de terminal es precisa con cualquier zoom del Canvas, el Uso de Perfiles de Claude lee credenciales específicas del Keychain en macOS, los íconos de providers y herramientas se mantienen consistentes entre temas, los estados de carga de Workbench exponen semántica asistiva válida y eliminar el workspace activo cambia de forma segura desde sus PTY finalizados.',
        'Los builds de escritorio instalados vuelven a mostrar las Herramientas de desarrollo y permiten abrir una carpeta de diagnóstico rotativa y limitada que registra fallos del renderer y del servidor interno ocultando credenciales comunes.',
        'El aprovisionamiento de workspaces mantiene compatibilidad con flujos de creación que omiten la lista opcional de repositorios adicionales, tratándola como vacía en lugar de fallar.',
      ],
    },
    {
      date: '24 ago 2026 · 0.19.0',
      title: 'Orkestrai 0.19.0: cuentas, estado, identidad de providers y enrutamiento más claro',
      summary: 'Es más fácil identificar, monitorear y enrutar providers entre varias cuentas, con un nuevo tema de terminal y un nodo de Uso realmente utilizable.',
      items: [
        'Uso y ruteo ahora abre con un tamaño inicial útil, muestra el ruteo del líder antes de los providers, reorganiza controles en anchos estrechos y contiene el desplazamiento por mouse, trackpad, tacto y teclado sin ampliar el canvas.',
        'Se agregaron Perfiles de provider con nombre, enrutamiento de Uso por perfil, estado público en vivo, marcas específicas en los agentes del Canvas, GitHub Copilot como provider de agente y el tema de terminal Obsidian.',
        'Las credenciales de Perfiles nunca entran en el payload del canvas: solo persisten la referencia y rutas no secretas, los valores se resuelven en el servidor al iniciar la PTY, se verifica el almacenamiento seguro, las referencias activas impiden borrar y las claves API de Devin no se aceptan como perfil de su CLI local.',
        'Los nombres de Perfil son únicos sin distinguir mayúsculas, las colisiones heredadas migran con seguridad, los UUID completos sobreviven al ruteo de Uso, los errores están traducidos y un fallo al consultar el estado público aparece como no disponible, no como saludable.',
        'El WebSocket de PTY acepta conexiones del navegador solo desde Orkestrai en el puerto exacto de la aplicación, evitando que otro sitio en localhost abra o controle sesiones de terminal.',
      ],
    },
    {
      date: '24 ago 2026 · 0.18.1',
      title: 'Orkestrai 0.18.1: estado confiable de proyecto, Portal, voz y terminal',
      summary: 'Los entornos del proyecto quedan aislados mientras navegación, dictado y terminales se recuperan de forma confiable en el escritorio.',
      items: [
        'Los procesos de terminal conservan el entorno del sistema operativo y el puente de Orkestrai, pero eliminan la APP_KEY del escritorio y cada variable privada cargada por el runtime de la aplicación. Los registros cifrados, cookies y sesiones de Laravel usan así el .env del proyecto y dejan de fallar con “The MAC is invalid”.',
        'Los pop-ups de login de los Portales ahora se abren en una ventana aislada de Orkestrai con la misma sesión persistente, en lugar de escapar al navegador del sistema. Las cookies y el almacenamiento se escriben en disco, y cada nodo Portal restaura su última URL navegada.',
        'El dictado ahora graba PCM directo por la misma ruta Web Audio del medidor, normaliza la voz baja e identifica claramente cuando el micrófono seleccionado se abrió sin producir señal.',
        'La fuente y la geometría de la terminal se estabilizan antes de volver a adjuntar la PTY, y el historial ANSI termina de procesarse antes del redibujado final, manteniendo alineado el cursor de xterm al volver al Canvas.',
      ],
    },
    {
      date: '23 ago 2026 · 0.18.0',
      title: 'Orkestrai 0.18.0: coordinación duradera, conocimiento con fuentes y equipos reutilizables',
      summary: 'Mensajes, actividad, atención, entrega, memoria, anotaciones, Team Packs y Huddles conservan ahora su contexto operativo.',
      items: [
        'Cada mensaje entre agentes tiene ahora un sobre canónico con destinatario y contenido verificados, recibos duraderos, correlación, deduplicación y protección contra replay.',
        'El Centro de control añade una línea temporal semántica de Actividad para mensajes, tareas, revisiones, decisiones, Git y eventos del sistema, con diagnósticos brutos bajo demanda.',
        'Un Centro de atención global prioriza preguntas, solicitudes de permiso, bloqueos y fallos de todos los workspaces y permite leer, posponer, resolver y abrir el origen.',
        'Command/Ctrl+K ahora indexa actividad, mensajes canónicos y atención con operadores de tipo, agente, workspace, estado, error y fecha.',
        'Workbench añade Flujos de trabajo, una proyección en vivo de cada tarea de Kanban hasta responsable, Piso, decisiones del Consejo, revisiones, actividad semántica y evidencia Git exacta.',
        'La Memoria del workspace conserva decisiones, hechos, preferencias, restricciones, referencias y aprendizajes con fuentes, búsqueda, revisiones inmutables, protección contra conflictos, historial y acceso bajo demanda para agentes por MCP/CLI.',
        'El Centro de Anotaciones proyecta feedback de revisión de código y Design nativo sin perder artefacto canónico, autor, objetivo, revisión, resolución ni alerta de código obsoleto.',
        'Los presets personalizados son ahora Team Packs versionados con releases semánticos, historial local inmutable, verificación SHA-256, importación limitada y sin runtime vivo ni credenciales.',
        'Los fallos al importar, exportar o publicar versiones de Team Packs permanecen ahora en el idioma elegido en la UI sin exponer mensajes internos del servidor.',
        'Los Huddles persistentes reúnen personas y agentes seleccionados en una transcripción limitada con dictado, TTS opcional, respuestas dirigidas, contribuciones por CLI/MCP, permisos remotos cifrados, recuperación del ciclo de vida y evidencia vinculada a Kanban y Flujos de trabajo.',
        'La ventana de Huddles ahora aprovecha el área disponible, mantiene historial y transcripción con desplazamiento independiente, reorganiza el contenido en ventanas estrechas y ofrece una acción de cierre siempre visible.',
        'La paleta Command/Ctrl+P ahora usa la pila compartida de modales y vuelve a cerrarse correctamente con Escape o al hacer clic fuera, incluso después de abrir Huddles.',
        'Los agentes ahora vinculan colecciones Bruno, OpenCollection y Postman mediante una ruta relativa o un alias autorizado de repositorio hermano, como @api-tests/bruno. Canvas y Workbench muestran las mismas solicitudes, mientras la sincronización atómica persiste scripts y pruebas en los archivos del repositorio real, bloquea escapes no autorizados y muestra conflictos antes de reemplazar cualquier lado.',
        'En Windows, Ctrl+C y el clic derecho copian el texto seleccionado de la terminal mediante el portapapeles nativo; sin selección, Ctrl+C sigue interrumpiendo el proceso activo.',
        'Los elementos del Centro de atención ahora se expanden en el lugar para mostrar el fallo y la solicitud original completos, separan la navegación al origen e identifican agentes o tareas eliminados.',
        'Las respuestas de agentes ahora se correlacionan con el turno exacto del provider incluso después de mensajes posteriores o de descubrir tarde la sesión; las entregas concurrentes a una terminal se serializan y ya no generan falsos fallos de transcript estructurado.',
        'El reclutamiento del Maestro ahora hereda el Piso activo, inicia y valida la PTY en el runtime correcto incluso en WSL y revierte nodos incompletos. Las tareas asignadas solo pasan a En progreso después de iniciar o reanudar el agente y entregar el briefing a su terminal.',
        'Los briefings largos enviados a Codex en Windows y WSL ahora esperan que el composer procese el texto, confirman actividad después del envío y repiten solo Enter cuando el TUI no lo reconoce.',
      ],
    },
    {
      date: '22 ago 2026 · 0.17.0',
      title: 'Orkestrai 0.17.0: autoría completa de pruebas de API para personas y agentes',
      summary: 'Pruebas JavaScript por runtime, autocompletado y autoría protegida por MCP/CLI comparten un único modelo de colección.',
      items: [
        'La pestaña Pruebas alterna entre assertions estructuradas y un editor JavaScript de altura completa con autocompletado contextual para Bruno, Postman y Orkestrai nativo. Los scripts de prueba se ejecutan separados de la automatización post-response y hacen round-trip en exportaciones Bruno y Postman.',
        'Agentes y líderes conectados pueden crear, leer, reemplazar con fingerprint, ejecutar y exportar colecciones completas mediante tools MCP api_client_* o CLI. Los cambios concurrentes de UI quedan protegidos, los secretos locales siguen ocultos y los archivos exportados permanecen dentro del workspace.',
      ],
    },
    {
      date: '22 ago 2026 · 0.16.0',
      title: 'Orkestrai 0.16.0: runtimes oficiales de scripts Postman y Bruno',
      summary: 'El Cliente de API nativo ejecuta automatizaciones importadas con runtimes oficiales compatibles con el origen, ámbitos portables y secretos cifrados.',
      items: [
        'Los scripts del Cliente de API ahora se ejecutan con Postman Runtime oficial o con el runtime QuickJS seguro oficial de Bruno, con ámbitos separados, sendRequest/runRequest, cookies, control de flujo, visualizaciones, bibliotecas incluidas, pruebas Chai completas y vault cifrado por el sistema operativo. Las variables, assertions y bloques tests importados de Bruno se ejecutan de forma nativa, mientras los runners exponen datos y metadatos correctos de iteración.',
        'La documentación ahora incluye una referencia completa y buscable de scripts del Cliente de API, con ejemplos copiables y separados para Postman Runtime, Bruno QuickJS y pruebas declarativas nativas, además del límite explícito de los servicios exclusivos de la nube Postman.',
      ],
    },
    {
      date: '20 ago 2026 · 0.15.0',
      title: 'Orkestrai 0.15.0: comandos reutilizables y Cliente de API multiprotocolo',
      summary: 'El inicio de las terminales se vuelve repetible mientras el Cliente de API cubre edición, ejecución, seguridad, respuestas y sincronización en el trabajo diario.',
      items: [
        'Los scripts previos o posteriores inválidos ahora identifican la etapa exacta de la solicitud o colección y la línea de origen, en vez de reducir los fallos de QuickJS a un error genérico de ejecución de API.',
        'El Cliente de API nativo ahora ejecuta solicitudes HTTP/REST, GraphQL, WebSocket y gRPC. GraphQL incluye query, variables y selección de operación; WebSocket agrega cola de mensajes, reconexión, keepalive y transcripción bidireccional; gRPC carga archivos proto locales y ofrece los cuatro modos de streaming.',
        'OAuth 2.0 asistido ofrece authorization code con state y PKCE, además de los grants directos client credentials, contraseña y refresh token. HTTP y WebSocket comparten cookies, proxy, CA propia, certificados de cliente PEM o PKCS#12 y control de verificación TLS.',
        'Los orígenes Bruno y OpenCollection vinculados ahora permiten pull, push, vigilancia cada cinco segundos, fingerprints, limpieza de archivos obsoletos y resolución explícita de conflictos. Los enlaces Postman y OpenAPI siguen siendo solo de pull.',
        'Los campos JSON, JavaScript, GraphQL y XML ahora usan editores con sintaxis, búsqueda, ajuste de línea y formato. Las respuestas JSON/XML aparecen como árboles expandibles, las transcripciones de protocolo se abren directamente y las vistas activas de solicitud, script y respuesta usan un estado temático inequívoco.',
        'El modal de runners de la colección API ahora mantiene todo el pie de acciones visible en ventanas de menor altura y reorganiza los controles de forma responsiva. Al reordenar solicitudes y carpetas, la interfaz muestra el destino exacto antes, después o dentro de la carpeta.',
        'Cada terminal ahora tiene comandos guardados con búsqueda, exclusivos o globales. El administrador marca claramente el ámbito activo, los comandos de inicio idénticos se deduplican entre ambos ámbitos y un respawn del PTY no envía dos veces el mismo comando de reanudación.',
        'El Cliente de API nativo ahora ofrece carpetas anidadas, drag-and-drop que no mueve el nodo, acciones de clic derecho y varios runners persistentes con selección y orden de solicitudes, entorno, iteraciones, intervalo, parada al fallar y variables encadenadas entre solicitudes.',
        'Las colecciones de API ahora se pueden exportar a Bruno mediante su serializador oficial o a Postman v2.1 preservando metadatos REST que Orkestrai no edita directamente. Un formato versionado de Orkestrai restaura todo el estado nativo, incluidas carpetas, runners, entornos, scripts e historial.',
        'Los contratos Swagger 2.0 y OpenAPI 3.x ahora se importan con referencias locales limitadas, ejemplos generados, mapeo de autenticación y notas visibles de fidelidad. Las colecciones se exportan como OpenAPI 3.1 JSON/YAML u OpenCollection YAML y los entornos Postman se mueven por separado.',
        'El inglés ahora es el idioma predeterminado real del inicio, incluida la pantalla de Electron que aparece antes de cargar los ajustes; el idioma guardado sigue aplicándose cuando la app está lista.',
        'Los avisos de credenciales, tokens, timeout y API del provider en Uso ahora emplean códigos estables traducidos a pt-BR, inglés y español, sin mostrar texto interno del backend en portugués.',
        'Crear o editar una solicitud API ya no eleva toda el área invisible del nodo sobre vecinos de capa superior; los menús de terminal y herramientas del Canvas siguen siendo accesibles tras usar el Cliente de API.',
        'Los atajos de teclado del Canvas y Design Studio ahora ignoran de forma segura los eventos del navegador cuyo objetivo sea Window, un nodo de texto u otro objetivo que no sea un elemento, en vez de fallar con “closest is not a function”.',
        'DOMPurify 3.4.14 ahora se aplica en todo el árbol de dependencias de Monaco, eliminando todos los avisos conocidos de npm audit sin degradar ni reemplazar el editor.',
        'Los formularios de Automatizaciones vuelven a crear, editar y activar automatizaciones y a guardar integraciones de GitHub sin rechazar incorrectamente los parámetros internos de la ruta.',
        'Cambiar el idioma durante el onboarding ahora mantiene el asistente abierto en el paso de bienvenida mientras la interfaz se vuelve a montar.',
        'Eliminar un workspace ahora detiene sus terminales activas antes de borrar los nodos persistidos, evitando procesos huérfanos y eventos de actividad tardíos.',
        'Volver a Workbench desde un enlace directo del Canvas ahora conserva el nodo exacto en su panel existente en vez de perder la división de la pantalla.',
        'Crear un agente ahora reutiliza el estado del provider ya verificado para el runtime del workspace, evitando otra búsqueda de CLIs y un botón bloqueado sin necesidad.',
        'Los nodos del Canvas y Workbench ahora aparecen sin esperar la búsqueda más lenta de providers; las terminales recién creadas y seleccionadas recuperan el foco después de persistir la sesión y el cambio de vista conserva el nodo durante la carga asíncrona.',
        'La entrada escrita durante el handshake de la PTY ahora se conserva en una cola corta y se entrega a la sesión creada, mientras xterm permanece montado al persistir su ID.',
        'El tour de exploración guiada de UI ahora crea briefing, tablero de tareas y tres direcciones editables mediante Hacerlo por mí, en vez de quedar detenido detrás de una configuración sin enviar.',
      ],
    },
    {
      date: '19 ago 2026 · 0.14.0',
      title: 'Orkestrai 0.14.0: paquetes RPM nativos para Linux',
      summary: 'Fedora, RHEL, CentOS y distribuciones compatibles ahora cuentan con un instalador nativo de Orkestrai.',
      items: [
        'Cada release de Linux ahora publica un RPM junto con el AppImage existente.',
        'El paquete incluye los metadatos públicos de mantenedor requeridos por instaladores nativos de Linux.',
        'Los archivos RPM usan el mismo nombre estable del producto Orkestrai que los demás instaladores.',
        'El pipeline de release verifica el RPM y su entrada en latest-linux.yml antes de publicar cualquier artefacto.',
        'Las instalaciones RPM usan el flujo de actualización de Linux compatible con el gestor de paquetes.',
      ],
    },
    {
      date: '18 ago 2026 · 0.13.0',
      items: [
        'Orkestrai 0.13.0 mantiene la entrada de teclado del terminal aislada de los atajos de accesibilidad del Canvas. Escape llega correctamente a Vim, editores de merge/rebase, paginadores y otras TUIs sin deseleccionar el nodo ni quitar el foco de xterm; la búsqueda y el dictado siguen siendo locales al terminal.',
        'El desplazamiento dentro de terminales y otros nodos del Canvas ahora permanece aislado incluso al llegar al inicio o al final del contenido. El zoom del Canvas solo responde cuando el puntero está sobre el área libre del propio Canvas.',
        'Las formas del Canvas ahora muestran una acción visible para duplicar y aceptan Cmd/Ctrl+D. Cmd/Ctrl+C y Cmd/Ctrl+V copian y pegan una forma o un arreglo completo de selección múltiple conservando tamaño, texto, estilos, geometría editable de las flechas y espaciado relativo.',
        'Nuevo Cliente de API nativo en Canvas y Workbench: crea y envía solicitudes con método, URL, encabezados, autenticación Bearer/Basic, cuerpo y variables, revisa estado, duración, tamaño y respuesta formateada, importa carpetas Bruno mediante el parser oficial o colecciones Postman v2.1 y vuelve a abrir el origen en la aplicación instalada.',
        'Las terminales shell nativas ahora conservan su carpeta actual después de reiniciar Orkestrai. Cursor y los demás providers también reciben una tool explícita para listar notas existentes antes de leer o editar, evitando duplicados y resultados vacíos.',
        'Command/Ctrl+K vuelve a buscar toda la documentación localizada junto con el contenido de los workspaces. Los temas, casos de uso y entradas del changelog ignoran diferencias de acento, se abren en el ancla exacta y siguen disponibles aunque falle la búsqueda del workspace.',
        'Los documentos Diseño grandes ahora expanden el área de trabajo alrededor de todos los frames en vez de recortar lo que supera la página nominal. Usa trackpad o scroll, la herramienta Mano (H), Espacio+arrastrar o el botón central para navegar; Ajustar encuadra todo el contenido y el zoom llega al 2 %. Las exportaciones y miniaturas usan los mismos límites completos. Los agentes conectados consultan design_reference una vez, crean hasta 2.000 capas con design_create_elements o aplican capas, tokens, bindings, componentes, prototipo y motion juntos con design_apply_blueprint. Las exploraciones guiadas prohíben inspeccionar la instalación, hacer probes del schema o crear scratch scripts de descubrimiento.',
        'Workbench y Centro de control ya no acumulan agentes, tableros y otros nodes de Pisos aterrizados o eliminados. La actualización archiva los registros antiguos, el cierre del piso elimina edges obsoletas, los agentes activos muestran el nombre del piso y los clones de layout comienzan sin reutilizar una sesión PTY ni una conversación del provider. El reclutamiento por el bridge ahora respeta y valida el Piso solicitado.',
        'La exploración guiada de UI ahora usa gates progresivos. Cada dirección entrega primero solo una pantalla desktop y una mobile mediante composición semántica compacta, con la primera revisión prevista en hasta cinco minutos. Los nodos muestran esperando, trabajando, estancado o listo; la pestaña Calidad permite aprobar la revisión actual o solicitar cambios con feedback trazable. Solo la dirección aprobada se expande a estados, tokens, componentes, prototipo y código, y la auditoría estructural ya no se presenta como prueba de calidad visual. Las exploraciones creadas antes de esta actualización siguen reconocidas.',
        'La geometría de conexiones del Canvas ahora reutiliza índices de nodes y adyacencias por snapshot inmutable en lugar de recorrer el grafo completo para cada edge y handle. Los cambios realizados por agentes actualizan snapshots brutos de nodes, edges y pisos sin volver a comprobar todos los providers.',
        'La configuración de audio ahora selecciona y prueba el micrófono usado por todo dictado local y el altavoz usado por vistas previas y respuestas habladas. Los dispositivos retirados vuelven al predeterminado del sistema, y los fallos distinguen permiso, hardware ausente, captura interrumpida y probable contención por la única entrada.',
        'Las conexiones del canvas ahora adaptan física, tasa de cuadros y renderizado a la cantidad de aristas, la visibilidad en el viewport, la ventana oculta y la preferencia de movimiento reducido. Los workspaces densos conservan los colores de conversación activa mientras las aristas inactivas o fuera de pantalla usan paths estáticos ligeros.',
        'Calidad y escala en Design Studio: una auditoría en vivo encuentra problemas de nombres, recortes, superposición, contraste WCAG y accesibilidad y enfoca la capa afectada; cuatro templates nativos completos crean bases editables de producto, marketing, mobile o design system; backup automático, recuperación de corrupción, migración de schema, historial limitado, restauración explícita y renderizado incremental protegen documentos grandes. Los agentes reciben las mismas operaciones de auditoría y template mediante CLI/MCP tipadas.',
        'Las terminales WSL en Windows ahora validan la distribución, directorio, PATH de inicio y CLI exactos antes del spawn y rastrean conversaciones de providers dentro de la home Linux de esa distribución. Solo se persisten o reanudan transcripts confirmados; los ids inválidos comienzan limpios en vez de invocar una conversación reciente especulativa, y los errores de distribución, ruta o comando ausente son distintos y accionables.',
        'Uso ahora inventaría los ocho providers de agentes desde un único catálogo de capacidades. Claude, Codex y Kimi conservan ventanas automáticas verificadas y ruteo; Antigravity, Cursor, Devin, OpenCode y Cline muestran sus limitaciones documentadas de CLI, API administrativa o provider de modelo con enlaces oficiales, sin porcentajes inventados.',
        'Los documentos Diseño nativos ahora admiten colaboración en vivo entre personas y agentes con presencia, cursores, selecciones, modo seguir, leases cortos de capa, conversaciones ancladas, propuestas visuales versionadas, diff estructural y aprobación atómica. Las propuestas se pueden revisar en Council o implementar en un Piso aislado. Remote Companion cifrado usa permisos de Diseño independientes por dispositivo y recibe solo resúmenes sanitizados de actividad, conversaciones y propuestas; los agentes conectados usan las mismas operaciones de comentar, proponer y decidir mediante tools tipadas del MCP de Orkestrai.',
        'Design Studio ahora incluye prototipos interactivos y motion nativos dentro del mismo documento versionado. Crea varios flujos iniciales; vincula interacciones de clic, presión, hover y tiempo para navegación, overlays, volver, desplazamiento o modos de variables; previsualiza transiciones, capas fijas, overflow, hotspots, marco de dispositivo y pantalla completa en un player enfocado; y comparte un prototipo HTML autocontenido y de solo lectura. Tokens de motion reutilizables, tracks por capa, keyframes, easing, keyframes CSS y salida Motion.dev quedan disponibles en la búsqueda y para agentes conectados mediante el mismo command bus MCP.',
        'La entrega nativa del Modo Diseño ahora importa estructuras HTML/Tailwind, Svelte, React/JSX y Vue como capas editables y genera Svelar/Svelte 5, React, Next.js, Vue 3 o HTML/Tailwind con vista previa antes de escribir. Los mappings existentes de Code Connect se reutilizan primero, los artefactos generados permanecen vinculados al documento Diseño y se abren en Monaco, y un Portal en vivo o dispositivo móvil conectado puede compararse con el frame seleccionado mediante pixel diff y overlay ajustable. La evidencia se convierte en una tarea trazable del Kanban o una entrada del Centro de Review vinculada al cambio Git real.',
        'La interoperabilidad oficial con Figma ahora provisiona el MCP remoto administrado para providers compatibles e importa páginas o frames seleccionados como capas, vectores, assets, estilos, variables, componentes, variantes, instancias nativas e identidades de bibliotecas externas. Los orígenes de Figma conservan mappings persistentes, aparecen en la búsqueda universal y pasan por una vista previa selectiva de conflictos antes de sincronizar. Un plugin propio de Orkestrai restringido al loopback transfiere selecciones en vivo con imágenes raster, SVG editable o JSON estructural, crea una página de Figma con recursos de diseño nativos de un documento Orkestrai y envía únicamente los cambios revisados en cola de vuelta al archivo actual. La credencial REST permanece cifrada por el sistema operativo y los agentes reciben tools tipadas de inspección, importación, vista previa y sincronización mediante el MCP de Orkestrai.',
        'La fase de Design Systems del Modo Diseño está completa: presets de tokens para producto, marketing y mobile; importación DTCG/CSS y exportación DTCG/CSS/Tailwind; auditoría de duplicados, valores hardcoded y candidatos a componente; componentes, instancias, propiedades, variantes, slots y overrides; bibliotecas versionadas entre workspaces autorizados; y extracción estática de CSS variables, Tailwind y contratos Svelte, React o Vue sin ejecutar código del proyecto. Tokens y componentes también aparecen en la búsqueda global, la vista previa del Canvas y el command bus MCP.',
        'El Modo Diseño nativo ahora ofrece variables de diseño tipadas en colecciones y modos, aliases, vínculos de propiedades con búsqueda, vista previa inmediata de modos y el command bus visual completo y protegido por revisión para agentes mediante el MCP de Orkestrai.',
        'Pegar, arrastrar o importar SVG ahora crea capas vectoriales nativas editables en vez de un asset aplanado. Agrupar/desagrupar, selección profunda, lista y selección por el mismo color, reemplazo en stops de gradiente, exportación según la selección y Copiar como SVG/PNG funcionan con deshacer/rehacer.',
        'El Modo Diseño ahora separa selección de capas y edición vectorial. Pluma previsualiza y continúa paths, curva o divide segmentos, ofrece tangentes Esquina, Reflejado, Asimétrico y Desconectado, selección por caja y transformación de múltiples puntos, edición rotada, resize directo de capas y texto multilínea editable en el canvas. Los overlays quedan fuera de exports y miniaturas.',
        'El Modo Diseño nativo incorpora paths de Pluma editables, operaciones booleanas, máscaras, múltiples pinturas sólidas o con gradiente, efectos y blend modes; ajuste, reglas, guías, alineación y distribución; auto layout responsivo horizontal, vertical, con wrap o grid; assets raster reutilizables e importación SVG estructural editable por selector, pegado o arrastre; exportación SVG, PNG, JPEG, WebP y PDF; y miniaturas raster vinculadas a la revisión para vistas grandes eficientes en Canvas.',
        'Se agregó la primera fase del Modo Diseño nativo: nodos Diseño persistentes compartidos por Canvas y Workbench, scene graph estructurado con frames, rectángulos, elipses y texto, edición manual de propiedades, capas, zoom, deshacer/rehacer, historial de revisiones, actualizaciones en vivo de agentes y operaciones tipadas por CLI/MCP con protección contra conflictos. Las formas ahora se crean arrastrando con vista previa y tamaño libre; Delete queda aislado en el editor y ya no elimina el nodo Diseño del Canvas; la rotación y alineación de texto están disponibles en las propiedades.',
      ],
    },
    {
      date: '15 ago 2026 · 0.12.0',
      items: [
        'Orkestrai 0.12.0 permite combinar Windows nativo y múltiples distribuciones WSL en un mismo equipo. El workspace define el runtime predeterminado, cada terminal puede heredarlo o seleccionar su propio entorno, y detección/modelos del provider, PTY, reanudación, Council, reclutamiento y puente siguen el runtime efectivo. El cambio reinicia solo la terminal afectada y valida distribución, ruta y CLI sin fallback silencioso.',
        'El servidor empaquetado ahora incluye los módulos necesarios del runtime WSL, lo que permite crear, restaurar y ejecutar workspaces WSL también en la aplicación instalada.',
        'Al crear o editar un workspace WSL, Orkestrai deriva y bloquea automáticamente la carpeta visible desde Windows a partir de la ruta Linux, sin exigir una segunda ruta equivalente ni rechazar la configuración por error.',
      ],
    },
    {
      date: '15 ago 2026 · 0.11.0',
      items: [
        'Orkestrai 0.11.0 incorpora conversaciones remotas trazables con el líder u otro agente, vinculadas a la pregunta y sesión exactas en todos los providers registrados. La pantalla principal conserva el historial del líder y espera el final real del turno cuando hay mensajes intermedios y uso de herramientas. El STT local del host funciona en el líder, el agente y el terminal; en el terminal solo inserta texto. Iniciar o restaurar sigue siendo exclusivo del Administrador, y el terminal sin filtrar requiere aprobación separada, viene desactivado, se adapta al móvil, se limita a una sesión y mantiene control de tráfico, cifrado y auditoría. Abrir el terminal cierra la conversación antes de ocupar toda la pantalla.',
        'Las invitaciones de navegador y móvil ahora llegan a la cola de aprobación del host después de recrear el relay de producción con el origen oficial de la PWA Remote habilitado.',
        'La barra de herramientas del Canvas ahora prioriza iconos compactos con tooltips; el encabezado de Cómo usar permanece visible durante el desplazamiento; el changelog separa versiones plegables y cambios numerados; los campos del modal de uso compartido quedan alineados; y Canvas junto al menú Workspace ahora muestran una entrada explícita para acceder a un workspace remoto.',
        'La interfaz de la app se reconstruyó sobre tokens semánticos de tema: el modo oscuro predeterminado combina superficies grafito con el dorado de la marca, el tema claro ganó contraste real, y Canvas, Workbench, Configuración, documentación, Central de Providers, paneles, modales, menús, campos y acople de la esfera de voz comparten una misma jerarquía adaptable.',
        'Las carpetas de workspace protegidas por macOS ahora tienen descripciones de privacidad localizadas. Canvas y Workbench sustituyen los errores técnicos EPERM/EACCES por una recuperación que vuelve a autorizar la carpeta exacta y reintenta abrir el workspace sin reiniciar la app.',
        'El uso compartido ahora ofrece invitaciones separadas para Navegador/móvil y App Orkestrai. La PWA Remote instalable sigue agentes, tareas, revisiones, actividad y uso de proveedores, conserva una clave WebCrypto no extraíble y elimina el secreto de la invitación de la URL antes de conectar.',
        'El uso compartido del workspace ahora utiliza de forma predeterminada el endpoint de producción relay.orkestrai.app. El relay acepta el origen local dinámico de la aplicación instalada y los orígenes web oficiales configurados, mientras rechaza sitios no relacionados.',
        'El uso compartido experimental de workspace ahora crea una sesión host cifrada de extremo a extremo con invitaciones únicas por enlace y código QR, aprobación explícita mediante la huella digital del dispositivo, roles Lector/Colaborador/Operador/Administrador, revocación inmediata, auditoría de comandos y un companion remoto limitado para estado del equipo, tareas, revisiones y mensajes al líder. El relay opaco nunca recibe contenido en texto abierto, mientras que la salida PTY, archivos, notas, portales, credenciales, URLs privadas y rutas locales quedan excluidos.',
        'Las Rutinas evolucionaron a Automatizaciones con disparadores manual, agenda, tarea, mensaje, commit Git, pull request de GitHub, webhook, cambio de archivo y límite de uso; acciones de prompt, tarea y notificación; recetas; jobs idempotentes en cola; historial recuperable; y credenciales de GitHub cifradas por la app instalada.',
        'El modo enfocado evolucionó a Workbench con elementos abiertos persistentes, pestañas verticales por defecto y pestañas horizontales opcionales en Configuración.',
        'Ahora se pueden organizar hasta ocho artefactos en vivo en divisiones redimensionables hacia la derecha o abajo, cambiar el panel activo y restaurar el layout por workspace sin duplicar sesiones.',
        'El explorador ahora agrupa agentes, trabajo, contenido y herramientas; las pestañas se mueven arrastrando o por menú y los layouts anteriores migran de forma segura.',
        'Command/Ctrl+K ahora abre una búsqueda universal de workspaces, agentes, tareas, notas, roles, skills, archivos, configuración y comandos, con vista previa, recientes, favoritos y apertura directa en paneles.',
        'La búsqueda de archivos usa ripgrep confinado al workspace y virtualiza listas grandes para mantener la interfaz ágil.',
        'Imágenes, PDFs, archivos y enlaces ahora se pueden soltar, pegar o seleccionar en agentes, tareas, notas y composers; los archivos de hasta 10 MB quedan confinados en .orkestrai/attachments/ y acompañan el briefing completo.',
        'El pie del Workbench muestra todas las ventanas de uso de Claude, Codex y Kimi con los mismos colores de severidad y el mismo snapshot compartido de cinco minutos del panel y nodo Uso.',
        'La esfera de voz fijada ahora usa un espacio dedicado del encabezado del Workbench y ya no cubre pestañas ni acciones del artefacto abierto.',
        'Abrir al lado desde otro workspace ahora cambia primero el contexto, sin crear paneles vacíos ni mezclar artefactos de workspaces diferentes.',
        'Inter, Sora y JetBrains Mono ahora se incluyen en la app, eliminando la dependencia de Google Fonts y de internet para la tipografía.',
        'Canvas y Workbench ya no esperan el diagnóstico lento de providers para abrir, y la búsqueda global ya no bloquea el montaje por un ciclo reactivo ni comprime su lista y vista previa.',
        'Cerrar el panel activo ahora conserva su artefacto visible, y los indicadores de terminal y textos compactos usan semántica y contraste accesibles.',
        'La restauración ahora comparte verificaciones repetidas por workspace, aísla entre workspaces el acceso a carpetas protegidas y repara los archivos del puente de forma asíncrona, para que un permiso pendiente de macOS no bloquee el Canvas o Workbench en otro lugar.',
        'Eliminar un adjunto de una nota ahora también quita su markdown renderizado y borra el archivo del workspace, sin dejar contenido huérfano.',
        'El Workbench ahora tiene un explorador nativo del workspace. Los archivos se abren directamente en pestañas locales desde el explorador, el árbol del Canvas o la búsqueda global, sin crear nodos Editor desconectados, mientras Monaco conserva modelos, cambios sin guardar, símbolos, formato y búsqueda/reemplazo.',
        'Markdown, PDFs, imágenes y binarios ahora se abren en vistas offline dedicadas, con límites seguros para archivos grandes, navegación y zoom, dimensiones de imagen, metadatos y apertura mediante la aplicación del sistema.',
        'Los assets de producción ahora reciben los mismos headers de aislamiento de la app, manteniendo los workers de Monaco y PDF fuera del hilo de la interfaz en builds instalados.',
        'Workbench ahora incluye un Centro de control con estados persistentes de agentes, tareas actuales, duración del estado, uso de proveedores y una bandeja de comunicaciones verificadas.',
        'Los mensajes del puente ahora conservan un único id entre los eventos en cola, enviado, entregado, recibido, respondido y falló; ask solo tiene éxito tras una respuesta confirmada.',
        'Los indicadores de actividad de Canvas y Workbench ahora se actualizan por eventos WebSocket en vez de polling cada diez segundos, y los eventos informativos ya no disparan notificaciones nativas.',
        'Los nombres y roles de los agentes ahora se distribuyen en líneas propias en el explorador del Workbench, y los elementos abiertos en vertical muestran el nombre completo sin ocultar la parte que distingue a cada agente con puntos suspensivos.',
        'Workbench ahora incluye un Centro de revisión con cambios Git preparados y no preparados estructurados, sincronización de rama, diffs Monaco limitados, comentarios persistentes por archivo y línea, detección de contexto desactualizado, tarea y agente vinculados y decisiones de aprobar, solicitar cambios o rechazar con envío directo al agente.',
        'Portal Design Mode ahora resalta elementos reales de la página, captura una imagen recortada y contexto seguro limitado, muestra una vista previa antes del envío y registra cada feedback en el Kanban: como tarea nueva para revisión del líder, tarea nueva asignada a un agente o actualización de una tarea existente. Cookies, tokens, storage, headers y query strings quedan excluidos.',
        'Council ahora ejecuta entre dos y cinco agentes reales como perspectivas independientes con presupuesto limitado, evidencias, riesgos, pruebas, divergencias y confianza estructurados, tolerancia a fallos parciales, síntesis opcional del líder y decisión humana persistente. Las perspectivas de implementación usan pisos Git aislados y exigen una nueva vista previa limpia y sin conflictos antes de aterrizar el resultado seleccionado y confirmado en commit.',
        'Las funcionalidades de las fases 0 a 8 ahora tienen descubrimiento consistente: Consejo aparece en la barra del Canvas, Workbench y la búsqueda global; los tours permanecen visibles entre Canvas y Workbench; cada caso de uso documentado inicia su tour correspondiente; y el catálogo de tours incluye búsqueda y un flujo específico para adjuntos.',
        'Canvas y Workbench ahora comparten un nodo persistente de Dispositivo móvil y una sesión por workspace. Además de iOS Simulator en Apple Silicon, Android ahora encuentra las herramientas de Android Studio en macOS, Windows y Linux, inicia o se conecta a AVDs y solo accede a dispositivos físicos autorizados tras una confirmación explícita. Un servidor scrcpy 3.1 incluido y WebCodecs acelerado por hardware ofrecen video H.264 en vivo, toques y gestos, Atrás/Home/Recientes, rotación, texto, instalación de APK y apertura de package, capturas, logcat limitado, árbol UIAutomator, permisos, limpieza del ciclo de vida, reinicio estable de AVD y tools equivalentes en la CLI orkestrai y MCP.',
      ],
    },
    {
      date: '11 ago 2026 · 0.10.0',
      items: [
        'Orkestrai 0.10.0 incorpora el modo Terminales, con un explorador con búsqueda para todos los workspaces que abre terminales, tableros, notas, portales, archivos, flujos y uso en toda el área, conservando el nodo seleccionado al volver al canvas.',
        'La esfera de voz ahora encuentra y abre al líder del workspace activo también en modo Terminales, sin indicar incorrectamente que falta un workspace o líder.',
        'Las sesiones PTY existentes ahora ocupan toda el área enfocada en modo Terminales, sin conservar las dimensiones pequeñas del nodo en el Canvas ni mostrar el chat comprimido o corrupto.',
        'El encabezado de la terminal ahora usa un menú compacto para provider, rol, tema, recarga, Modo Maestro y eliminación, sin controles superpuestos en nodos estrechos.',
        'La acción para localizar el elemento en el Canvas ahora usa un único ícono centrado, sin símbolos superpuestos en el encabezado del modo Terminales.',
        'Las terminales ahora ofrecen 10 paletas ANSI completas con selección visual por nombre; Configuración explica por qué macOS no permite usar Fn/Globe por sí sola como atajo de la app.',
      ],
    },
    {
      date: '11 ago 2026 · 0.9.1',
      items: [
        'Los archivos de role de Kimi ahora incluyen el frontmatter obligatorio del perfil, y los archivos antiguos o ausentes se reparan antes de iniciar la terminal en vez de cerrar la PTY con un error de agent file inválido.',
        'La esfera de voz global ahora tiene un indicador clicable de posición fijada o libre que abre directamente los controles, y el tooltip también indica el atajo correcto de la plataforma.',
      ],
    },
    {
      date: '11 ago 2026 · 0.9.0',
      items: [
        'Los presets ahora configuran roles mediante los mecanismos nativos de Claude, Codex y Kimi; los demás providers reciben una referencia breve al archivo en lugar de texto largo pegado en la terminal.',
        'El enrutamiento por uso permite monitorear la ventana de 5 horas, semanal o mensual y explica cuando un provider no reporta el período elegido.',
        'El colector entiende la respuesta actual de Kimi y los límites adicionales de Codex, mostrando una vez cada ventana reportada en el panel y el nodo.',
        'El toggle shadcn vuelve a representar visualmente su estado y el editor de workspace tiene layout adaptable, desplazamiento limitado y pie estable.',
        'En Windows, la línea debajo de la barra de título ahora ocupa todo el ancho de la ventana.',
      ],
    },
    {
      date: '10 ago 2026 · 0.8.3',
      items: [
        'Orkestrai 0.8.3: el selector de modelos con búsqueda ahora sigue la composición oficial de shadcn-svelte, abre sin cortar la búsqueda y mantiene icono, lista y foco alineados.',
        'Configuración ahora permite enviar automáticamente el dictado en terminales con Enter sin enviar formularios ni otros campos de texto.',
      ],
    },
    {
      date: '10 ago 2026 · 0.8.2',
      items: [
        'Orkestrai 0.8.2: las conversaciones entre Claude y Codex se validaron en ambos sentidos con respuestas reales confirmadas desde el transcript correcto.',
        'Las sesiones Codex usan el directorio real del workspace y las sesiones Kimi usan el hash exacto de la ruta, sin cruzar conversaciones entre proyectos concurrentes.',
        'ask conserva mensajes de varias palabras sin comillas, mientras timeouts y respuestas no confirmadas ahora fallan explícitamente.',
        'task done entrega automáticamente el handoff al líder sin mezclar el mensaje con un borrador humano sin terminar.',
      ],
    },
    {
      date: '10 ago 2026 · 0.8.1',
      items: [
        'La esfera de voz global ahora reconoce el campo enfocado desde el primer clic, se puede fijar o arrastrar y se aparta de los paneles abiertos.',
        'Los selectores de modelos ahora tienen búsqueda y desplazamiento, incluso para cuentas Devin con catálogos grandes.',
        'Orkestrai Light ahora ofrece contraste consistente en paneles, nodos, textos, botones, iconos, marcas de providers y hovers.',
        'Organizar canvas ahora alinea los nodos seleccionados o todo el workspace, con las conexiones siempre detrás de los nodos.',
        'Los colores de severidad del nodo Uso coinciden con el panel Uso, y Skills carga resultados iniciales útiles.',
        'La recuperación del workspace valida la conversación del provider antes de reanudar, evitando sesiones obsoletas y reinyección innecesaria de roles.',
        'Windows ahora usa el launcher correcto de las CLIs, selección de terminal ajustada al DPI y una barra de título y menú estilizados.',
      ],
    },
    {
      date: '10 ago 2026 · 0.8.0',
      items: [
        'El panel Uso ahora se puede agregar al canvas como nodo persistente con las cuotas de Claude, Codex y Kimi.',
        'El nodo Uso configura origen, fallback y límite; líderes y agentes consultan la recomendación mediante la nueva acción usage de CLI y MCP antes de distribuir trabajo nuevo.',
        'Configuración ahora incluye Apariencia con tres temas oscuros, uno claro y un editor de tokens semánticos con vista previa inmediata.',
        'Los temas personalizados se pueden duplicar, importar y exportar como JSON validado y persisten entre reinicios.',
        'Canvas, nodos, Central de Providers, Skills, documentación y Configuración ahora respetan los tokens globales del tema.',
      ],
    },
    {
      date: '10 ago 2026 · 0.7.0',
      items: [
        'Los botones de providers se consolidaron en un único menú Agentes, mientras Shell sigue disponible directamente.',
        'Se pueden fijar hasta cuatro agentes favoritos junto al menú, con el orden guardado globalmente entre workspaces y reinicios.',
        'Los agentes no disponibles siguen visibles con acceso directo a la Central de Providers y nunca ocupan la barra.',
      ],
    },
    {
      date: '10 ago 2026 · 0.6.0',
      items: [
        'Devin ahora es un provider nativo con detección local, modelos de la cuenta, sesiones interactivas autónomas y reanudación exacta de la conversación.',
        'El puente de Orkestrai provisiona la configuración MCP y la skill de Devin, mientras los transcripts ATIF entregan respuestas limpias entre agentes y para TTS.',
        'Los agentes Devin concurrentes se vinculan a sus propias sesiones locales por el directorio del workspace, sin inspeccionar ni modificar los datos de Devin.',
        'Cursor ahora inicia con confianza en el workspace y aprobación de MCP, mientras Antigravity inicia de forma autónoma y expone sus niveles de esfuerzo.',
      ],
    },
    {
      date: '10 ago 2026 · 0.5.2',
      items: [
        'Las grabaciones largas de dictado ahora llegan a la transcripción sin chocar con el límite predeterminado de 512 KB del servidor empaquetado tras pocos segundos.',
        'Las grabaciones de más de aproximadamente 15 minutos muestran un mensaje de límite claro y traducido tanto en el dictado global como en la terminal.',
        'Los Portales guardados reintentan la carga cuando el dev server local inicia después del canvas y esperan la página real antes de automatizar.',
        'Las terminales Claude concurrentes reservan IDs de conversación distintos, evitando transcripts cruzados y respuestas corruptas entre agentes.',
        'Los errores de Portal conservan el detalle útil y las respuestas de providers nunca vuelven a usar el redibujado bruto de la terminal.',
        'Reanudar un workspace ya no inyecta los roles otra vez: solo los agentes con tareas asignadas aún abiertas, o el líder con trabajo sin responsable, reciben un prompt de continuación.',
        'El servidor sigue respondiendo mientras macOS espera el permiso de la carpeta del workspace y reintenta de forma segura un aprovisionamiento interrumpido.',
      ],
    },
    {
      date: '10 ago 2026 · 0.5.1',
      items: [
        'Las terminales ahora descartan IDs locales de PTY obsoletos después de reiniciar la aplicación y reanudan automáticamente la conversación conservada de cada provider.',
        'La recuperación de sesión usa un código WebSocket estable y espera que el nuevo ID quede guardado antes de reconectar.',
      ],
    },
    {
      date: '10 ago 2026 · 0.5.0',
      items: [
        'El dictado local ahora escribe en el campo de texto activo de cualquier pantalla; sin campo activo en el canvas, todavía se envía al líder.',
        'El provider de un agente puede cambiarse desde el encabezado sin perder nombre, rol, Modo Maestro, piso, posición ni conexiones.',
        'Los roles de presets ahora incluyen misión, contexto, proceso, criterios de aceptación y handoff, y se aplican automáticamente al iniciar la PTY.',
        'El líder recibe la fila inicial del kanban con título, descripción, imágenes y nota vinculada y debe asignar cada trabajo antes de delegar.',
        'Las notificaciones distinguen Tarea completada, Proyecto completado y Atención para no confundir una entrega parcial con todo el proyecto.',
        'Pisos muestra las tareas reales, sus etapas y responsables en cada worktree y en planta baja.',
        'La edición de texto en formas respeta el tamaño, peso y alineación renderizados, incluso con fuentes grandes.',
      ],
    },
    {
      date: '09 ago 2026 · 0.4.0',
      items: [
        'Cursor, Antigravity y Cline ahora se integran al canvas como providers nativos junto a Claude, Codex, Kimi y OpenCode.',
        'Las opciones de provider, modelo y esfuerzo provienen de los adapters instalados, sin enums fijos en la UI, los schemas ni el puente de reclutamiento.',
        'Cada provider recibe la skill y la configuración MCP en el formato que reconoce; Cline usa ajustes aislados por workspace.',
        'La reanudación rastrea IDs exactos en transcritos, manifestos y caches de cada CLI, evitando abrir la conversación de otro agente.',
        'La Central de Providers ahora detecta las CLIs localmente y ofrece instalación por sistema, orientación oficial de inicio de sesión, capacidades y nueva verificación en un clic.',
        'Las instalaciones nuevas comienzan en inglés y preguntan primero el idioma en el onboarding, guardando portugués brasileño, inglés o español inmediatamente.',
        'La aplicación ahora espera el idioma inicial guardado antes de habilitar la interfaz, evitando pantallas mezcladas y clics perdidos al iniciar.',
        'Las terminales de presets ahora comienzan con las flags autónomas de acceso total de cada provider; las terminales antiguas sin argumentos se reparan sin sobrescribir comandos personalizados.',
      ],
    },
    {
      date: '09 ago 2026 · 0.3.0',
      items: [
        'Los tableros ahora aceptan hasta diez etapas personalizadas con nombre, color y orden; líder y equipo consultan y actualizan automáticamente el mismo flujo.',
        'La Biblioteca incorporó Campaña y lanzamiento, Brand y diseño y Contenido y SEO, con briefings y roles adecuados también para marketers, diseñadores y creators.',
        'Orkestrai Contributing combina un líder Claude, oráculos Codex y Kimi, especialistas Svelar/desktop/QA y un Flow que exige consenso antes de crear tareas.',
      ],
    },
    {
      date: '09 ago 2026 · 0.2.0',
      items: [
        'La biblioteca de presets llegó al lienzo con búsqueda, filtros y equipos listos de Producto, React, Next.js, SvelteKit, Svelar y Laravel; úsala en un workspace nuevo o intégrala al equipo actual.',
        'Preset v2 conserva las descripciones y los estados completos de las tareas y skills portátiles, sin copiar sesiones PTY ni sobrescribir skills personalizadas en el proyecto de destino.',
        'Roles ahora incluye un catálogo traducido con 12 funciones completas de liderazgo, ingeniería, calidad y operaciones.',
        'Pisos ahora muestra agentes activos, tareas asignadas y el estado Git de cada worktree y de la planta baja.',
        'La app de escritorio incorporó menús nativos traducidos, y Configuración y Documentación ahora comparten la base visual del sitio.',
      ],
    },
    {
      date: '09 ago 2026 · 0.1.5',
      items: [
        'Los mensajes automáticos ahora esperan a que el usuario termine su borrador y se entregan en una cola, sin mezclar texto de otros agentes en la terminal del líder.',
        'Los mensajes entre agentes ya no se truncan silenciosamente al alcanzar 4.000 caracteres.',
        'El silencio de la terminal ahora es un estado neutro de inactividad y ya no genera falsas notificaciones de atención en el escritorio.',
        'Los textos en portugués de Brasil recibieron una revisión de acentuación, respaldada por una prueba contra errores frecuentes.',
      ],
    },
    {
      date: '08 ago 2026 · 0.1.4',
      items: [
        'Orkestrai 0.1.4 es la primera release para macOS firmada con Developer ID Application y notarizada por Apple; la firma ad-hoc queda restringida a builds locales.',
        'El pipeline detiene la release si falta cualquiera de las cinco credenciales Apple, evitando publicar de nuevo un paquete sin firma confiable.',
        'El CI valida autoridad, Team ID, Hardened Runtime, aceptación de Gatekeeper y el ticket de notarización en las versiones Apple Silicon e Intel antes de publicar.',
        'Esta versión también se publica en el feed legado para alcanzar instalaciones existentes y migra la app al repositorio principal para futuras actualizaciones.',
      ],
    },
    {
      date: '07 ago 2026 · 0.1.3',
      items: [
        'Orkestrai 0.1.3 corrige el paquete macOS de la 0.1.2: los archivos estaban íntegros, pero una firma ad-hoc parcial hacía que Gatekeeper informara que la app estaba dañada.',
        'Los bundles macOS sin certificado ahora reciben una firma ad-hoc completa; el CI valida firmas profundas, DMGs y ZIPs para Apple Silicon e Intel antes de publicar.',
        'Los updaters antiguos quedan bloqueados en Mac para que no eliminen la instalación actual; la app nueva detecta releases mediante la API pública y dirige a una instalación manual segura.',
        'En el primer inicio sin Developer ID, intenta abrir la app, cierra el aviso y usa Ajustes del Sistema → Privacidad y seguridad → Seguridad → Abrir de todos modos; autentícate y confirma Abrir. Windows no fue afectado.',
      ],
    },
    {
      date: '07 ago 2026 · 0.1.2',
      items: [
        'Orkestrai 0.1.2: el panel Uso ahora actualiza Claude, Codex y Kimi automáticamente cada 5 minutos en lugar de cada 60 segundos, reduciendo llamadas innecesarias y el riesgo de respuestas HTTP 429.',
        'La caché del servidor usa el mismo intervalo y evita consultas duplicadas al reabrir el panel o volver a la aplicación.',
        'El botón de actualización manual sigue obteniendo datos nuevos de inmediato y omite la caché solo cuando se utiliza explícitamente.',
      ],
    },
    {
      date: '07 ago 2026 · 0.1.1',
      items: [
        'Orkestrai 0.1.1 incluye electron-updater en la aplicación instalada; Configuración ya no confunde un módulo ausente con la ejecución fuera de la app de escritorio.',
        'Las instalaciones 0.0.1 y 0.1.0 necesitan una actualización manual única a 0.1.1. Después, Windows y Linux vuelven a las actualizaciones automáticas; macOS sin firma mantiene la descarga manual segura.',
        'Las tareas creadas por el usuario llegan al líder solo después de persistir el título, la descripción markdown y todas las imágenes adjuntas.',
        'El briefing enviado al líder y al agente asignado siempre contiene título, descripción y la lista completa de imágenes de referencia.',
      ],
    },
    {
      date: '07 ago 2026',
      items: [
        'Orkestrai 0.1.0: primera release pública preparada para actualizar las instalaciones 0.0.1.',
        'El pipeline por tag genera macOS Apple Silicon/Intel, Windows x64 y Linux x64 y publica solo los binarios en el repositorio público de releases.',
        'La release solo se hace pública después de validar instaladores, blockmaps, manifests latest-*.yml, tamaños y SHA-512; macOS exige ZIPs de update para ambas arquitecturas y el instalador de Windows usa exactamente el nombre referenciado por latest.yml.',
        '“Verificar ahora” devuelve el estado real y ya no queda trabado en “Verificando”; los eventos del inicio tampoco se pierden si la pantalla monta después.',
        'Un fallo temporal al consultar GitHub ya no abre el diálogo manual. El fallback aparece solo si una actualización encontrada falla al descargar o instalar.',
        'Windows NSIS y Linux AppImage actualizan sin firma; en macOS sin certificado Apple, la app mantiene la descarga manual segura.',
      ],
    },
    {
      date: '06 ago 2026',
      items: [
        'Nuevo panel Puertos justo después de Uso: lista listeners vinculados a los Portales locales del workspace, con proceso, PID y estado en uso/libre.',
        'MCP de Codex corregido en Windows: config.toml ahora usa rutas absolutas para el runtime y la CLI, sin depender de PATH, PATHEXT, archivos .cmd ni Node.js externo.',
        'El handshake global de orkestrai mcp ahora inicia incluso fuera de un workspace; token y URL solo se exigen cuando una tool accede realmente al puente.',
        'Cierre seguro de puertos con confirmación, revalidación del PID y protección del proceso de Orkestrai; los puertos arbitrarios de la máquina nunca aparecen.',
        'Nueva esfera de dictado arriba a la derecha: activa exactamente el flujo del micrófono del líder y escribe la transcripción directo en su terminal, incluso en otro piso; sin líder, muestra un toast claro.',
        'Corrección en la reanudación de Claude: los transcripts de subagentes y archivos de inicio sin un mensaje reanudable ya no reemplazan el ID válido de la conversación del líder.',
        'Después de borrar los modelos locales de voz, el micrófono de la terminal y la esfera del líder vuelven a pedir confirmación antes de descargar; la interfaz también informa si falla el borrado.',
        'Supertonic 3 reemplaza a Kokoro en las respuestas habladas, con audio local de 44,1 kHz; Parakeet y todo el flujo de STT permanecen sin cambios.',
        'Tres presets de voz — pt-BR, en-US y español latino — con vista previa, velocidad ajustable de 0,75× a 1,50× y migración automática de las voces anteriores.',
        'Las respuestas largas se sintetizan por frases, con precarga del siguiente tramo y PCM binario por IPC para comenzar antes sin superponer voces.',
        'El nuevo modelo INT8 tiene una descarga menor, se verifica con SHA-256 y solo elimina el Kokoro anterior después de una instalación exitosa.',
        'La búsqueda global de documentación con Cmd/Ctrl+K ahora cubre por completo los monitores anchos y mantiene el diálogo centrado.',
        'Interfaz, documentación, casos de uso y tres tours nuevos traducidos a pt-BR, English y Español (16 tours en el onboarding).',
      ],
    },
    {
      date: '05 ago 2026',
      items: [
        'Kanban estilo Trello: composer con título, descripción en markdown e imágenes adjuntas ya en la creación de la tarea (Ctrl+V o selector, con miniaturas).',
        'Descripción de la tarea formateada en la tarjeta (doble clic edita) y soportada en la API/CLI.',
        'Markdown completo en notas, roles e historial del kanban: enlaces, checkboxes, tablas y código — sanitizado.',
        'Nuevo nodo Imagen en el canvas: referencia visual conectable a los agentes (pega con Ctrl+V o elige el archivo).',
        'Todos los placeholders de la app traducidos (pt-BR/English/Español).',
        'Cobertura i18n del 100%: toda la app (canvas, nodos, paneles, diálogos, paleta, páginas) habla pt-BR, English y Español — más de 500 claves nuevas.',
        'Documentación "Cómo usar" traducida por completo: tópicos, casos de uso, quickstart y changelog siguen el idioma elegido.',
        'CLI: task add acepta --description en markdown (también en la tool MCP).',
        'Flujo que funciona de verdad: los agentes sin sesión son iniciados por el propio pipeline, los errores aparecen en un banner en el nodo (fin de los fallos silenciosos) y los estados vacíos te guían.',
        'Icono de carpeta (el default) seleccionable en el editor del workspace — el picker tenía 24 iconos pero no el original.',
        'Inyección de texto en los terminales 100% unificada (roles incluidas): texto y Enter siempre en writes separados — el composer no se cuelga en ningún provider (Claude, Codex, Kimi).',
        'Flujos encadenados: un Flujo conectado a otro dispara el siguiente con su salida final (el fallo no encadena, ciclos bloqueados) — pipelines compuestos y fan-out.',
        'Botón Sincronizar en el Flujo: cada agente conectado se vuelve un paso en el orden de las aristas — el pipeline es el propio dibujo.',
        'Nuevo tour guiado "Flujos encadenados" en el onboarding (12 tours ahora): crea los dos flujos, los conecta y ejecutas el encadenamiento.',
        'Modal de onboarding pulida: el anillo morado de selección/foco ya no es cortado por el scroll, fade al final de la lista y etapa de casos de uso más ancha.',
        'El onboarding siempre guía desde cero: bienvenida → crear workspace nuevo → caso de uso, incluso con un workspace abierto (el atajo "usar actual" sigue).',
        '"Hazlo por mí" aparece al instante en el canvas: nodos y conexiones creados por tour, CLI o API disparan live refresh — sin salir y volver al workspace.',
        'Fix: el onboarding no abría en inglés/español — el cambio de idioma remontaba la página después de limpiar la URL y el wizard moría; la intención ahora sobrevive al remount (test de regresión incluido).',
        'Fix: el tour de investigación ya no se traba en el último paso — los pasos ahora ejecutan varias acciones en secuencia (las dos conexiones se hacen) y el tour concluye solo cuando pasa el último check.',
        'Fix: la búsqueda de MCPs rompía la lista cuando el registry devolvía duplicados (ahora deduplica) — buscar "Figma" funciona y la curaduría aparece primero.',
        'Caso de uso + tour nuevo "De Figma al código": agente Diseñador, nodo Imagen con el mockup y Figma MCP para leer el archivo directo (13 tours).',
        'Fix serio: las respuestas entre agentes vienen del transcript limpio de la CLI (sin basura de TUI, barra de estado o caracteres duplicados) — fin del composer abriendo editor externo con texto corrupto.',
        'Fix: el servidor MCP de Orkestrai hablaba el framing equivocado (LSP) y Kimi daba timeout de 30s — ahora es NDJSON, el estándar oficial de MCP (Claude, Kimi y cia conectan).',
        'Toda inyección de texto en composer es sanitizada: sin bytes de control y sin Enter suelto (submit parcial) en ningún provider.',
        'Fix serio en los tours: un paso con acción sin check nunca avanzaba (y cada clic creaba otro agente) — ahora avanza solo, con guarda anti-duplicados. Una auditoría e2e corre los 13 tours completos en cada build.',
        'Fix: tools MCP con campos equivocados (ask mandaba text en vez de message, notes apuntaban a rutas inexistentes, dismiss mandaba agent en vez de target) — ahora cubiertas por test de mapeo cuerpo a cuerpo con los schemas del puente.',
        'Contrato MCP completo: las 23 tools se validan contra las rutas y schemas reales del puente en cada build; las tools de maestro sin identidad dan un error claro en vez de 422.',
        'Ask ya no devuelve basura de boot: si el transcript aún está vacío (pantalla de trust, eco del composer), el puente espera la respuesta de verdad en vez de pasar la pantalla cruda.',
        'Codex, Kimi y OpenCode ahora NACEN sabiendo del puente: bloque en AGENTS.md (merge, no borra nada tuyo), MCP de Codex en ~/.codex/config.toml y opencode.json en el proyecto — antes solo Claude recibía las instrucciones.',
        'Borrar un nodo pide confirmación (Delete del teclado y la X del nodo): no más perder un agente y su contexto por accidente.',
        'La respuesta de un agente ya no se inyecta en el composer del otro (ya llega por el retorno del comando) — fin del texto pegado a tu escritura.',
        'Kimi destrabado de verdad: el puente espera que el TUI termine el boot antes de escribir (Enter se volvía newline en el composer), reenvía el Enter si nada pasa y lee la respuesta del wire.jsonl real — verificado con el Kimi real respondiendo limpio.',
        'Los títulos duplicados ya no rompen el ruteo: los agentes nuevos ganan sufijo automático (Dev 2, Dev 3) y un ask ambiguo explica cómo resolverlo en vez de escribirle al agente equivocado.',
        'orkestrai list ahora marca quién lidera con [LIDER] — los agentes ya no adivinan "orkestrai ask Maestro" (Maestro es el rol, no un título).',
      ],
    },
    {
      date: '04 ago 2026',
      items: [
        'Ciclo de conversación por voz: dictaste, el agente responde hablando — en portugués de Brasil de verdad.',
        'Voz 100% autocontenida (sin Node, sin Docker): runtime propio descargado junto con el modelo, verificación de espacio en disco y opción de borrar el modelo.',
        'La voz lee solo la respuesta actual — sin markdown, URLs ni caracteres extraños.',
        'Kanban: adjuntar imágenes en las tarjetas funcionando (Ctrl+V y selector).',
        'Flecha sin punta desbordando; panel de estilo con sliders y cabeza de flecha configurable.',
        'El usage de Kimi renueva la credencial solo.',
        'Sin pelea de puertos entre workspaces: orkestrai port devuelve puerto libre y los agentes aprenden a nunca matar proceso de puerto ajeno.',
        'Botón Descargar con confirmación y feedback; Configuración rediseñada; changelog aquí en la página.',
        'Actualizaciones automáticas: la app busca versión nueva sola e instala en el cambio, sin tocar tus datos.',
        'Skeletons de carga en la sidebar, usage, skills y Configuración — sin saltos en la UI.',
        'Kanban con historial: archiva concluidas sin perder el registro de lo entregado.',
        'Tarea con nota de spec vinculada: se archiva junto, protegida contra eliminación, leída por el historial.',
        'La voz lee el transcript de la sesión: respuesta completa del agente, sin caracteres invisibles.',
        'Presets de equipo: guarda el workspace como plantilla y empieza proyectos con el equipo listo.',
        'Flujos: pipelines visuales de agentes con aprobación humana e historial de ejecuciones.',
        'Servidor MCP propio + tools CLI nuevas (fs, say, run, clip) + gestor de MCPs.',
        'Respuesta entre agentes enviada sola — el composer ya no se queda colgado.',
        'Reconexión automática tras suspensión del portátil, con el contexto restaurado.',
        'Botón Recargar en cada terminal (reinicia la sesión con el contexto).',
        'Las ventanas nunca nacen más pequeñas que el mínimo — sin botones desbordando.',
        'Tooltips en toda la toolbar; textos de Diff/Loop/Pisos en lenguaje simple.',
        '⌘K / Ctrl+K global: busca en la documentación desde cualquier pantalla.',
        'Marketplace de MCPs en la página Skills: curaduría oficial + registry, instalación con 1 clic y campos de token guiados.',
        'App en Portugués, English y Español: selector de idioma en Configuración (paraglide).',
        'Design pass: página Skills & MCPs rediseñada (pestañas segmentadas, tarjetas con badges) y docs pulidas.',
        'Onboarding interactivo: 11 tours guiados por caso de uso, con "Hazlo por mí" y auto-conclusión, en 3 idiomas.',
        'El ícono de workspace ahora es selector Lucide (sidebar, editor y presets); el emoji antiguo sigue funcionando.',
      ],
    },
    {
      date: '03 ago 2026',
      items: [
        'Voz embebida sin Docker y sin Python, con confirmación antes de la descarga.',
        'Kanban con imágenes de referencia y líder avisado de tarea nueva; roles con editor markdown.',
        'Soporte completo a Windows; notificaciones nativas con marca, workspace y agente.',
      ],
    },
    {
      date: '02 ago 2026',
      items: [
        'Modo Maestro arreglado de punta a punta: el líder recluta, conecta y distribuye solo.',
        'Panel de usage de los providers y marketplace de skills (skills.sh) dentro de la app.',
        'Orquestación automática en el canvas: organigrama, aristas vivas, kanban y portal.',
        'Dictado offline con atajo configurable; builds Linux/Windows y fondo del DMG con la marca.',
      ],
    },
    {
      date: '01 ago 2026',
      items: [
        'Nace Orkestrai: canvas de agentes, puente CLI, pisos (worktrees), rutinas, roles, kanban, portal y Modo Maestro.',
        'Multi-workspace con resume exacto de contexto; app de escritorio para macOS, Linux y Windows.',
      ],
    },
  ],
};
