# Roque Nights — Plan consolidado (WebMCP Challenge)

Salida del panel de diseño (3 diseñadores + juez adversarial, 31-ago-2026). Este documento manda sobre cualquier idea nueva de las 2 de la mañana: **nada entra si no está aquí**.

## Deadline y regla de oro

- **Cierre: jueves 3-sep-2026, 1:00pm PDT = 21:00 hora canaria.**
- **Parada dura: 3-sep a las 11:00 hora canaria.** Vídeo subido a YouTube (privado→público al enviar) y formulario de Devpost relleno con margen. Devpost estará saturado ese día.

## Concepto (tesis, no "features")

**La página no es una fuente de datos: es un instrumento compartido.** El agente no consulta Roque Nights, lo *maneja contigo*: lee lo que el humano mira, propone planes que el humano ve como "fantasma" y acepta/rechaza con el ratón, y apunta el cielo que ambos comparten. Todo el cálculo es 100 % client-side (astronomy-engine): **no existe API que un MCP server pudiera envolver — WebMCP es literalmente la única forma de agentificar esto**. Ese es el argumento central del texto de la submission.

Puntuación del juez adversarial (asumiendo buena ejecución): Leverage 9 · Execution 8 · Impact 7 · Creativity 8. Los arreglos de abajo van dirigidos a subir Impact y Creativity.

## Las 14 tools (tope duro; ni una más)

| # | Tool | Annotations | Notas |
|---|------|-------------|-------|
| 1 | `get_observing_conditions` ✅ | readOnly, ¬openWorld | HECHA (spike). Oscuridad astronómica, luna, horas sin luna |
| 2 | `find_observable_targets` | readOnly, ¬openWorld | Messier+planetas filtrados; devuelve candidatos **y rechazados con motivo** |
| 3 | `rank_nights` | readOnly, ¬openWorld | Puntúa un rango de noches por oscuridad lunar; honra AbortSignal |
| 4 | `point_sky_map` | readOnly | Centra/resalta en la cúpula con animación (el humano LO VE) |
| 5 | `set_observing_time` | idempotent | Mueve el deslizador de tiempo |
| 6 | `describe_current_view` | readOnly | **Página→agente**: centro/FOV del mapa, selección, filtros, ring buffer de ~20 acciones humanas |
| 7 | `propose_plan` | — | Plan FANTASMA punteado con badge "proposed by agent" → `proposal_id` |
| 8 | `commit_proposal` | — | Aplica; el humano también acepta/rechaza ítem a ítem y el motivo vuelve al agente |
| 9 | `modify_plan` | idempotent | UNA tool para add/remove/reorder (operaciones en batch) |
| 10 | `get_current_plan` | readOnly | Estado del plan con horarios óptimos |
| 11 | `clear_plan` | **destructive**, ¬idempotent | Requiere `confirm:true`; devuelve token de undo |
| 12 | `export_plan` | readOnly | .ics + CSV + **schema abierto `observing-plan.v1.json`** publicado en el propio sitio |
| 13 | `import_plan` | — | **LA PALANCA MÁXIMA**: importa el plan de otro observador (URL) y lo REVALIDA para el cielo/latitud local devolviendo diff con motivos |
| 14 | `compare_dark_sky_sites` | readOnly, **openWorld** | ~20 sitios Starlight del mundo + nubes de Open-Meteo en UNA petición multi-coordenada |

**API declarativa (2 usos justificados)**: form de emplazamiento (`set_observing_site` vía `toolname`/`agentInvoked`/`respondWith`) y form de objetivo personalizado (stretch). Justificación para el README: el agente rellena el mismo form que el humano, misma validación, una sola fuente de verdad.

## Decisiones cerradas (resoluciones del juez)

1. **Mapa: canvas 2D propio, proyección estereográfica de TODO el cielo** ("cúpula"). NO Aladin Lite (beta+WASM+tiles remotos+LGPL = agujero negro de integración). Datos vendorizados: `stars.6.json` podado a mag ≤5.5 (~150 kB), `constellations.lines.json` (27 kB), `messier.json` (110 objetos) — BSD-3 de d3-celestial. Capas: gradiente crepúsculo, horizonte+cardinales, estrellas por mag/B-V, 89 constelaciones, Messier con glifo por tipo, planetas, **Luna con halo escalado por iluminación**, ruta del plan numerada, retículo animado con easing.
2. **Zustand vanilla como sustrato colaborativo**: tools = envoltorios finos sobre las MISMAS acciones que llaman los botones. Cada acción lleva `source: 'human' | 'agent'` → activity log con atribución y animación de acciones del agente. La bidireccionalidad es propiedad de la arquitectura, no una feature.
3. **Human-in-the-loop = ghost plan (propose/commit)** como primitivo primario + `pendingConfirmation` no bloqueante para `clear_plan`. NADA de tools cuyo execute espere un clic (riesgo de timeout del turno del agente delante de los autores del spec).
4. **Modo noche ACOTADO**: toggle de luz roja (estética/identidad SIEMPRE visible) + registro dinámico de 2-3 tools contextuales cuando existe un plan (justifica `toolchange` con honestidad). NO una segunda fase de producto completa. La tool que dispara el cambio devuelve `tools_added`/`tools_removed` en su payload (los modelos no releen la lista: díselo tú).
5. **Nombre: Roque Nights** con tagline en inglés. La autenticidad geográfica es el activo, no un lastre.
6. **Meteo**: Open-Meteo (sin key, CORS ok) + proxies de altura: seeing ~ `wind_speed_200hPa` (jet stream), transparencia ~ `relative_humidity_700hPa` (sobre la inversión del Roque). 7Timer DESCARTADO (sin CORS). Snapshot horneado 1-5 sep como fallback etiquetado "cached forecast" — la demo nunca se rompe.
7. **Retornos ricos y verificables en TODAS las tools**: `{ok, summary (frase citable), data (números usados), rejected[{name,reason}], caveats, as_of, site}`. Devolver los rechazados con motivo es el mayor ROI del proyecto.
8. **PWA/offline SOLO si se demuestra en cámara en modo avión**; si se corta, se corta también la frase del vídeo/README.
9. **UNA submission**, no dos. 10 ganadores / 5.005 participantes: las últimas 8 h van a iterar descriptions y pulir, no a un segundo proyecto.
10. **Idioma del producto y README: inglés** (jurado anglosajón). Vídeo: voz o subtítulos en inglés.

## Estética (identidad = puntos)

Luz roja de observatorio: fondo #05060A, paneles #101319, ámbar #FFB454, rojo #FF5C4D. Cifras en IBM Plex Mono. Densidad de instrumento, cero burbujas de app-de-IA. Pieza visual protagonista además de la cúpula: **timeline altitud×tiempo** con bandas de crepúsculo, interferencia lunar y bloques del plan. Toggle "daylight" cian para planificar de día.

## Riesgos capitales (con mitigación ya decidida)

- **RA horas vs grados** (astronomy-engine toma HORAS; messier.json da GRADOS envueltos ±180): helper único `normalizeRA` + test golden M31 61.6°. ✅ Verificado en spike (`scripts/smoke.cjs`).
- **StrictMode desregistra tools** (doble montaje + abort del cleanup): registro FUERA de React, a nivel de módulo. ✅ Hecho en spike. Verificar siempre contra `npm run build && npm run preview`, no contra dev server.
- **El agente no llama las tools**: nombres verbo+dominio, "Use this when…" en cada description, inputs acotados con enums.
- **Percepción "chatbot sobre catálogo"**: la cúpula debe moverse por orden del agente en los primeros 20 s del vídeo; activity log con badges HUMAN/AGENT siempre visible.
- **Navegador de ChatGPT distinto de Chrome**: grabar metraje-seguro en cuanto funcione; panel harness in-app como vía de demo alternativa; requiere GPT-5.6 Sol o Terra (Luna NO).
- **Husos horarios** (Canarias UTC+1, efemérides UTC, deadline PDT): todo Date interno en UTC, un único formateador con `timeZone` explícito, tools devuelven UTC+local etiquetados.
- **Repo con pinta de generado por IA**: commits por bloque con mensajes reales, .gitignore desde el minuto 0, LICENSE en el commit 1 ✅, CREDITS.md con licencias de datos.

## Plan de bloques (línea de corte MVP marcada)

- **A — 31-ago noche ✅ (spike)**: scaffold + 1 tool real end-to-end + build ok. **PENDIENTE de A: verificar en Chrome (flag) y en ChatGPT desktop, y primer deploy a Cloudflare Pages/Netlify (necesita login del humano).**
- **B — 1-sep mañana**: motor astro completo (`src/astro/`) headless + vitest con valores golden (oscuridad 2-sep 20:52:50Z; luna 66% 22:43:32Z; M31 61.6°; normalizeRA con M2) + vendorizar catálogos + store completo.
- **C — 1-sep tarde**: LA CÚPULA (canvas, capas, deslizador de tiempo + play). Es el WOW.
- **D — 1-sep noche**: las 14 tools sobre el store + annotations + harness in-app (`getTools()` + invocación manual) + layout completo.
- **E — 2-sep**: pase de diseño, estados vacíos/error, "Agent playbook" (5 prompts copiables), README con tabla de tools, TOOLS.md autogenerado, import/export + schema publicado, compare_dark_sky_sites.
- **F — 2-sep noche / 3-sep mañana**: vídeo 2:30-2:40 (guion cronometrado, rótulos "TOOL CALL: x", metraje real del Roque grabado ANTES), texto de Devpost, verificación desde máquina limpia, ENTREGA a las 11:00 canaria.

**MVP innegociable si todo se tuerce**: cúpula + deslizador + 6 tools (1,2,4,7/9,10 y export) + deploy + README con licencia. Eso ya es producto completo, no PoC.

**Stretch por valor/hora**: confirmación en clear_plan → form declarativo → registro dinámico → compare_dark_sky_sites → export .ics → snapshot compartible → campo `active_showers` (JSON de 12 lluvias IMO, 20 min; las Perseidas para el guion).

**Cortado sin piedad**: Aladin, 7Timer, Bortle/contaminación lumínica, cuentas/login, log post-sesión (va como roadmap en README), multiidioma, móvil más allá de "no está roto".

## Vídeo (2:30-2:40, beats)

1. Cold open SIN logo: plano nocturno real del Roque (grabar esta noche o mañana). "I'm an engineer at the world's largest optical telescope. This is how my nights start."
2. 0:20: ChatGPT desktop, Site tools visible, "plan me tonight" → **la cúpula se mueve sola** + rótulo TOOL CALL.
3. Ghost plan: el agente propone 5, el humano acepta 4 con el ratón, el agente renegocia el quinto (lee el motivo del rechazo).
4. `describe_current_view`: el humano arrastra el mapa a una zona y pregunta "what's that cluster?" — el agente responde sobre LO QUE ÉL MIRA.
5. Palanca máxima: enviar la URL del plan a "un amigo en Madrid" → su agente lo REVALIDA para su cielo y explica el diff.
6. Cierre: export .ics aterrizando en el calendario + "110 Messier objects, zero servers, one shared sky." + URL.

## Checklist de entrega (Devpost)

- [ ] URL viva (Cloudflare Pages o Netlify — ambos sponsors)
- [ ] Repo público, LICENSE MIT visible arriba ✅ (creada)
- [ ] Vídeo <3 min con audio en YouTube, sin música con copyright
- [ ] Texto: por qué WebMCP (cálculo client-side ⇒ sin WebMCP no hay agente posible), qué pueden hacer humano+agente juntos que antes era imposible, cómo está implementado
- [ ] Probado en Chrome 151 + flag Y en ChatGPT desktop (GPT-5.6 Sol/Terra)
- [ ] Releer /rules el día 3 antes de enviar (criterios y hora, por si editan)

---

## Addendum 1-sep-2026 (tarde): feedback de GPT-5.6 vía Site tools + dirección visual

Primer test real con un agente externo (ChatGPT desktop, GPT-5.6, Site tools sobre https://roque-nights.netlify.app). La tool se descubrió y se usó bien (encadenó fechas, validó errores). Decisiones tomadas sobre su informe; **entran en los bloques B y D, no son un bloque aparte**.

### Bugs de robustez (prioridad alta, un juez puede pisarlos)

1. **Husos en coordenadas custom.** La tool aceptaba lat/lon de Mauna Kea y etiquetaba las horas "locales" en Atlantic/Canary. Decisión: el input pasa a ser un objeto `site: { latitude, longitude, elevation_m?, time_zone?, name? }` (par completo o nada, resuelto por el propio schema). Si no llega `time_zone` IANA para unas coordenadas custom: **solo UTC** en `summary` y `data`, `local_times: null`, y un `caveat` explícito que dice cómo pedir horas locales. Si las coordenadas caen a <1° de un sitio del catálogo de cielos oscuros (`src/data/sites.ts`, ~24 sitios con IANA tz), se infiere su huso y se avisa en `caveats`. Nunca inventamos un huso.
2. **Fechas inválidas** (2026-13-99 pasaba el regex y reventaba astronomy-engine). Validación de fecha de calendario real (1900-2100) en un único helper `parseIsoDate`; error estructurado `{ ok:false, error:{ code:'invalid_date', message, hint } }`. Ninguna tool deja escapar una excepción: el wrapper de registro las convierte en `{ ok:false, error:{ code:'internal_error' } }`.
3. **Casos polares / sin oscuridad.** `data.darkness.status ∈ 'ok' | 'no_astronomical_darkness' | 'continuous_darkness'` y `data.sun.status ∈ 'normal' | 'never_sets' | 'never_rises'`, con `summary` que lo dice en una frase ("No astronomical darkness at 69.65°N on 2026-06-21: the Sun never sets."). `ok:true` porque el cálculo es correcto; lo que estaba mal era callarse.
4. **Lat/lon por separado**: resuelto por el objeto `site` con `required:[latitude,longitude]` + validación en runtime (`invalid_site`).

### Prioridad media

5. **Activity log con resultado**: cada llamada registra `running → ok | error`, duración en ms y un extracto del `summary` (o el mensaje de error). El humano ve qué devolvió el agente, no solo qué pidió.
6. **Renombrar la tool 1**: `get_observing_conditions` → **`get_night_ephemeris`** (título "Night ephemeris: darkness window, Sun and Moon"). Su description dice explícitamente que NO incluye meteorología. La meteo (Open-Meteo, decisión 6) vive solo en `compare_dark_sky_sites`. La tabla de 14 tools sigue siendo el tope: es un rename, no una tool nueva.

### Sus "missing capabilities" = nuestro roadmap

Weather → tool 14. Target visibility (alt/az, tránsito, airmass, separación lunar, ventanas) → tools 2, 7, 10. Date-range ranking (`find_best_observing_nights`) → tool 3 `rank_nights`. Site handling → objeto `site` + form declarativo. Edge cases estructurados → punto 3. No cambia el orden de los bloques.

### Dirección visual (la app tiene que impresionar en un vídeo de 3 minutos)

- **El mapa celeste es el protagonista**: grande, hermoso, cúpula estereográfica interactiva con estrellas reales (tamaño por magnitud, color por B-V), Vía Láctea sutil (contornos de d3-celestial simplificados), constelaciones trazables, planetas y Messier destacados con glifo por tipo, Luna con halo por iluminación.
- **Estética de sala de control en luz roja/ámbar se mantiene** (#05060A / #101319 / #FFB454 / #FF5C4D, IBM Plex Mono). Todo lo nuevo la respeta. Toggle de luz roja = identidad.
- **Animación con propósito**: `point_sky_map` y "añadir al plan" mueven la cúpula con easing (~1.2 s, cubic in-out) y dejan retículo/pulso visible. Es EL momento del vídeo: el humano mira y el mapa se mueve solo.
- **Favoritos del humano** tocando objetos en el mapa (marca ámbar + pulso), leídos por el agente vía `describe_current_view`.
- **El plan es un timeline visual de la noche** (altitud × tiempo: bandas de crepúsculo, interferencia lunar, bloques por objeto), no una lista.
- **60 fps**: canvas 2D con capas cacheadas (estrellas se redibujan solo si cambia tiempo/vista); WebGL solo si el canvas no llega.
- **Tiene que lucir igual en la ventana del navegador de ChatGPT** (~1100×750): layout mapa + columna lateral, sin depender de pantallas grandes; por debajo de 900 px apila.
