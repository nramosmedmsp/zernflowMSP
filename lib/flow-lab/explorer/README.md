# Explorador de caminos

Dado un flujo, recorre con el simulador (`lib/flow-lab`) todos los caminos posibles y cuenta cómo termina cada uno. Es puro (sin base ni red) y usa las mismas acciones del laboratorio: `clientSays`, `advanceTime`, `closeCase`, `changeStage`.

```ts
import { exploreFlow, exploreSummaryText } from "@/lib/flow-lab/explorer";

const result = exploreFlow(catalog, { flowId, channel: "whatsapp", maxDepth: 12, maxPaths: 60 });
result.paths;     // cada camino: pasos, conversación, nodos, estado final, cambios, cómo terminó
result.tree;      // árbol de decisiones (ramas etiquetadas con la elección)
result.coverage;  // nodos y salidas de condición que ningún camino recorrió
exploreSummaryText(result);
```

## Cómo explora

1. **Arranque.** Usa el disparador del flujo: el mensaje que lo activa (palabra clave, botón, bienvenida, por defecto, gestión nueva) o el evento (se cierra una gestión, cambia la etapa, cliente sin responder; deja lista una gestión abierta del tipo que pide). Sin `profile` prueba los perfiles de ejemplo y un contacto de cada tipo hasta que el flujo se dispare. Solo participan el flujo y los flujos a los que salta.
2. **Esperas.** En cada espera de respuesta prueba cada botón o respuesta rápida del último mensaje (como botón, o como el número de la opción si el canal lo pasó a lista numerada), las respuestas libres que llevan a ramas que ningún botón cubre (se construyen con los valores de las condiciones `contains`, `equals`, `gt`, `lt`... sobre `{{message}}`, más una genérica que no entra por ninguna) y, si `noReply`, la rama «el cliente no responde». Los nodos Espera avanzan el reloj.
3. **Recorrido a lo ancho.** Todas las opciones de una espera antes de seguir más abajo; si se acaba el cupo de caminos, quedan sin explorar las ramas más profundas (marcadas `skipped` en el árbol).
4. **Estado de partida.** Cada vez que un camino evalúa una condición sobre el contacto o la gestión (etiqueta, campo, tipo de contacto, tipo o etapa de la gestión, equipo, responsable, horario, canal, suscripción) o una prueba A/B, se repite desde un estado que cumpla las demás opciones. Un camino de una variante solo se conserva si difiere de los que ya había (así se descartan las variantes que el propio flujo anula). Los flujos que arrancan por un evento en WhatsApp se prueban también con la ventana de 24 h cerrada.
5. **Límites.** `maxDepth` (12 respuestas o pasos del tiempo por camino), `maxPaths` (60), `maxVariants` (12) y `maxActions` (tope de acciones del simulador). Detecta ciclos: si el flujo vuelve a esperar en el mismo nodo con el mismo estado, el camino termina en `cycle`.

## Lo que no puede probar

- Condiciones sobre variables distintas de `message` (`variable:plan`...): no hay forma de fijarlas desde fuera; queda un aviso y esa salida puede quedar sin recorrer.
- «Fuera de horario» si el espacio atiende las 24 horas.
- Respuestas del cliente a un menú que no sea el último mensaje del bot, solicitudes HTTP, IA y secuencias (igual que el laboratorio).
- Condiciones sobre el mensaje que llega al arrancar el flujo (solo se explora lo que contesta el cliente en una espera).
