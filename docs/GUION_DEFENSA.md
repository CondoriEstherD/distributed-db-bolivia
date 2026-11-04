# Guion de la defensa · 15 minutos

**Antes de empezar (10 min antes):** los 7 equipos encendidos, sin suspensión, con Tailscale activo;
`python gestion.py estado` en E7 muestra 6 nodos en línea y 5 réplicas activas; el panel está abierto
en E7 (`streamlit run dashboard/app.py`) y proyectado. **Plan B:** modo `lab` en una laptop o el video.

| Minuto | Integrante | Qué hace en pantalla | Qué explica |
|---|---|---|---|
| 0:00–1:30 | 1 · Arquitecto (E1 La Paz) | Diagrama de arquitectura del README; página **Panorama nacional** | El problema (vender sin conexión y consultar a nivel nacional), los 6 nodos y los 9 departamentos, el diseño descendente |
| 1:30–3:30 | 1 · Arquitecto (E1 La Paz) | Panorama nacional: tabla de diseño; `python -m pruebas.ejecutar_pruebas P0` | Fragmentación horizontal, derivada y vertical; reglas de corrección (completitud, reconstrucción, disyunción) con los 50 000 registros |
| 3:30–5:30 | 2 · Infraestructura (E2 Santa Cruz) | `tailscale status` y `python gestion.py estado` desde E7 | Despliegue real: un nodo por equipo, consola separada, Tailscale como WAN, `.env` común y puertos 15431–15436 |
| 5:30–7:30 | 3 · Transacciones (E3 Cochabamba) | **Consultas distribuidas**: C1 y C6 con «Mostrar plan de ejecución» | Transparencia con `postgres_fdw`: C1 agrega en cada nodo; C6 consulta solo `fv2_sc` (poda de fragmentos) |
| 7:30–9:30 | 3 · Transacciones (E3 Cochabamba) | **Traspaso 2PC**: SC → BE exitoso; después, con pausa de 10 s, E6 ejecuta `tailscale down` | Fases del 2PC, el registro en Cochabamba y el aborto atómico cuando falta un voto |
| 9:30–10:30 | 6 · Fallas (E6 Beni) | E6: `tailscale down`; `python gestion.py vender be` en E6; en E7, C7 (resumen tolerante); `tailscale up` | Autonomía local: Beni vende aislado; La Paz informa `fv6_be` FUERA DE LÍNEA sin bloquearse |
| 10:30–11:30 | 5 · Replicación y seguridad (E5 Oruro) | **Replicación del catálogo**: cambiar un precio en La Paz y verlo llegar a cada nodo | Replicación lógica asíncrona; Beni se pone al día solo al reconectar |
| 11:30–12:30 | 5 · Replicación y seguridad (E5 Oruro) | `python -m pruebas.ejecutar_pruebas P11` | Matriz CRUD con `GRANT/REVOKE`, una contraseña por rol y mínimo privilegio |
| 12:30–13:30 | 7 · Interfaz (E7 consola) | **Recuperación 2PC**: caída del coordinador en «preparado» y en «decision» → Recuperar | Transacciones en duda y presunción de aborto; quedan 0 en duda |
| 13:30–14:15 | 4 · Datos (E4 Tarija) | `python gestion.py respaldar tj` y la tabla de operación del README | Respaldo, restauración y traslado de un nodo a otro equipo si uno falla |
| 14:15–15:00 | 7 · Interfaz (E7 consola) | Informe de pruebas (`docs/INFORME_PRUEBAS.md`) y la insignia de GitHub Actions | 14/14 pruebas, integración continua y medición de latencia; cierre y preguntas |

**Aprobación del guion** (cada integrante marca cuando lo revisó):

- [ ] Integrante 1 · [ ] Integrante 2 · [ ] Integrante 3 · [ ] Integrante 4
- [ ] Integrante 5 · [ ] Integrante 6 · [ ] Integrante 7
