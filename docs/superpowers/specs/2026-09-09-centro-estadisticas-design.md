# Centro de estadísticas — diseño

**Fecha:** 2026-09-09
**Estado:** aprobado por el usuario, pendiente de plan de implementación

## Contexto y motivación

Hoy `recepcionista/index.html` muestra cortes/ventas "Hoy" y "Ayer" en tiempo real (`listenToCuts()`, `onSnapshot` con `limit(200)`), y elegir otra fecha del calendario solo filtra en memoria lo que ya está cargado — si la fecha elegida cae fuera de los últimos ~200 documentos (unos 7-10 días para el volumen actual), no muestra nada, aunque el dato exista en Firestore.

Aparte de arreglar eso, el usuario quiere un **centro de estadísticas histórico completo**, con nivel de detalle de una empresa medianamente seria: comparaciones entre períodos, ranking de barberos, tendencias y exportación de reportes — sin que el costo de lecturas de Firestore crezca con el tiempo (el proyecto ya está cerca del límite gratis diario de 50k lecturas, motivo original de esta conversación).

**Alcance de datos:** cortes (por barbero/servicio/fecha), ventas de productos (recepción + tienda online), gastos y retiros/propinas, y visitas/conversión de la tienda online.

**Fuera de alcance (decisión explícita):** exportar/archivar datos viejos a una plataforma externa. El almacenamiento en Firestore es barato (~$0.18/GB/mes) y no es el cuello de botella real — el cuello de botella es la cantidad de *lecturas* para armar estadísticas, que este diseño resuelve sin necesitar mover datos afuera. Se puede reconsiderar en el futuro si el volumen de datos crudos se vuelve un problema real y concreto.

**Fuera de alcance (decisión explícita):** objetivos/alertas (metas de facturación, avisos de días flojos).

## Arquitectura: resúmenes diarios ("rollups")

Se agrega una colección nueva `stats_diarios/{YYYY-MM-DD}` (un documento por día) con la forma:

```
{
  fecha: "2026-09-09",
  cortes: {
    total: 12,
    facturado: 144000,
    porBarbero: {
      "Tony":  { cortes: 5, facturado: 60000, porServicio: { "Corte": 3, "Corte+Barba": 2 } },
      "Maxi":  { cortes: 4, facturado: 48000, porServicio: { ... } },
      "Stefa": { cortes: 3, facturado: 36000, porServicio: { ... } }
    }
  },
  ventas: {
    total: 8,
    facturado: 62000,
    porProducto: { "Pomada Mate": { cantidad: 3, facturado: 36000 }, ... },
    origen: { recepcion: 45000, tienda: 17000 }
  },
  gastos: { total: 15000, porCategoria: { ... } },
  retiros: { total: 30000, porBarbero: { "Tony": 10000, ... } },
  propinas: { total: 8000, porBarbero: { ... } },
  visitasTienda: { visitas: 40, llegaronACheckout: 6, completaronCompra: 2 }
}
```

Cada vez que se escribe un corte/venta/gasto/retiro/propina en `anotar`, `recepcionista` o `tienda` (endpoints `checkout.js`/`notify-transfer.js`), **además de la escritura normal** se aplica un `increment()` sobre los campos correspondientes de `stats_diarios/{fecha-de-hoy}`, en la misma operación (ambas escrituras van juntas, no una tras otra suelta). Es una escritura extra chica — no una relectura de nada — así que no suma al problema de lecturas.

La colección de visitas (`tienda_visitas`) ya escribe por IP; se le suma un `increment()` al contador diario agregado del mismo modo.

### Por qué este enfoque y no leer los datos crudos directamente

- **Leer con rango de fechas sobre las colecciones crudas** (`where(createdAt >= X, <= Y)`) funcionaría para arreglar el bug de "no puedo ver otro día", pero el costo de lectura crece con el volumen histórico: consultar un año completo con mucha actividad son miles de lecturas cada vez que se abre el panel.
- **Los resúmenes diarios** desacoplan "cuántos años de historia existen" de "cuánto cuesta ver las estadísticas": un año completo son ~365 lecturas (un documento por día), sin importar cuántos cortes/ventas haya debajo. Un mes son ~30 lecturas. Comparar dos meses (actual vs. anterior) son ~60 lecturas.

## Qué muestra la pestaña "Estadísticas" (nueva, dentro de recepcionista)

- **Selector de rango:** Hoy / Semana / Mes / Año / rango personalizado (calendario desde-hasta) — reemplaza y extiende el selector actual de Hoy/Ayer/calendario de `listenToCuts()`, que queda limitado a la vista "tiempo real de hoy y ayer" (eso se mantiene igual, en vivo, para el día a día operativo).
- **Comparaciones:** frente al período anterior de igual longitud, y frente al mismo período del año pasado (si hay datos) — variación en % de facturación, cortes, ventas.
- **Ranking de barberos:** facturación total, cantidad de cortes, ticket promedio (facturado ÷ cortes) en el rango elegido, comisión estimada usando el **% de comisión configurado actualmente** en `config_precios`/ajustes de comisiones (simplificación consciente: si la comisión de un barbero cambió en el pasado, el número histórico se recalcula con la tasa de hoy, no con la vigente en su momento — evita tener que versionar tasas de comisión en el tiempo, que agrega complejidad desproporcionada al beneficio).
- **Tendencias:** gráficos de línea/barra (por día, semana o mes según el rango) usando **Chart.js** (nueva dependencia, cargada por CDN como ya se hace con Sortable.js) — se dibujan sobre los resúmenes ya traídos, sin pegarle de nuevo a Firestore.
- **Exportar:** botón que genera un **Excel** (SheetJS) o **PDF** (jsPDF) del rango en pantalla — tabla de totales, por barbero, por producto. Se arma en el navegador con los datos ya cargados.

## Migración del historial existente

Los resúmenes diarios no existen para el historial previo a este cambio. Se agrega una función "Recalcular este día" (y una versión en lote "Recalcular rango") que:
1. Lee los documentos crudos (`all_cuts`, `ventas_productos`, `gastos`, `retiros`, `propinas`, `tienda_pedidos`) filtrados por fecha.
2. Reconstruye el documento `stats_diarios/{fecha}` desde cero con esos datos.

Esto se corre una vez por cada día histórico que se quiera tener disponible en el centro de estadísticas (tiene un costo de lectura real, proporcional a la actividad de esos días puntuales — pero es un costo único de migración, no recurrente).

## Manejo de errores

- Si falla la escritura del `increment()` sobre el resumen diario, el dato real (el corte, la venta, etc.) igual queda guardado — nunca se pierde la fuente de verdad. Un resumen desincronizado se puede arreglar con "Recalcular este día".
- Si al abrir el centro de estadísticas falta el resumen de algún día del rango (porque no se migró o porque falló su escritura), se muestra ese día en blanco/con aviso en vez de romper el resto del rango.

## Testing

- Crear un corte/venta/gasto/retiro/propina de prueba y verificar que el resumen del día se actualiza con el valor correcto.
- Comparar un resumen recalculado ("Recalcular este día") contra el total que hoy ya se puede ver a mano para un día conocido, para validar que los números cierran antes de confiar en el sistema nuevo.
- Verificar que el selector de rango en la pestaña de estadísticas trae los totales correctos para un rango de varios meses con datos migrados.
- Verificar que exportar a Excel/PDF genera un archivo legible con los mismos totales que se ven en pantalla.
