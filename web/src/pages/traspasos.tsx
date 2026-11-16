import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Ban, CheckCircle2, CircleDot, Loader2, Minus, Plus, Scale, Trash2, XCircle } from 'lucide-react'

import { BloqueSql, Cargando, Encabezado, Error, Seccion, Tabla } from '@/components/comunes'
import { Selector } from '@/components/selector'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type ConSql, fmt, useAlmacenes, useEstado, useProductos } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Stock { id_producto: number; origen: number | null; destino: number | null; nacional: number | null }
interface Paso { tipo: 'paso' | 'fin'; texto?: string; ok?: boolean; gid?: string; error?: string }
interface Log { gid: string; origen: string; destino: string; id_almacen_origen: number; id_almacen_destino: number; items: Record<string, number>; estado: string; detalle: string | null; creado_en: string }

export default function Traspasos() {
  const cliente = useQueryClient()
  const almacenes = useAlmacenes()
  const productos = useProductos()
  const { data: estado } = useEstado()
  const [origen, setOrigen] = useState(201)
  const [destino, setDestino] = useState(601)
  const [items, setItems] = useState<Record<number, number>>({ 10: 5 })
  const [pausa, setPausa] = useState(0)
  const [pasos, setPasos] = useState<string[]>([])
  const [fin, setFin] = useState<Paso | null>(null)
  const [antes, setAntes] = useState<Stock[] | null>(null)
  const [corriendo, setCorriendo] = useState(false)

  const ids = Object.keys(items).map(Number)
  const alm = (id: number) => almacenes.data?.find((a) => a.id === id)
  const nodoDe = (id: number) => estado?.nodos.find((n) => n.cod === alm(id)?.nodo)
  const caidos = [nodoDe(origen), nodoDe(destino)].filter((n) => n && !n.en_linea)
  const mismo = alm(origen)?.nodo === alm(destino)?.nodo
  const bloqueo = mismo ? 'El origen y el destino son de la misma sucursal: un traspaso es entre sucursales distintas.'
    : caidos.length ? `${caidos.map((n) => `${n!.nodo} (${n!.estado.toLowerCase()})`).join(' y ')}. El 2PC necesita el voto de ambas sucursales por la red nacional, así que el traspaso no se permite. Si la sucursal solo perdió el enlace, sus ventas locales siguen permitidas (autonomía local).`
      : null

  const stock = useQuery({
    queryKey: ['stock', origen, destino, ids.join(',')], enabled: ids.length > 0 && !bloqueo,
    queryFn: () => api<Stock[]>(`/traspasos/stock?origen=${origen}&destino=${destino}&productos=${ids.join(',')}`),
  })
  const log = useQuery({ queryKey: ['log2pc'], queryFn: () => api<ConSql<Log>>('/traspasos/log') })

  const nombre = (p: number) => productos.data?.find((x) => x.id === p)?.nombre ?? `#${p}`
  const s = (p: number) => stock.data?.find((x) => x.id_producto === p)
  const cambiar = (p: number, q: number) => setItems((c) => {
    const n = { ...c }
    if (q <= 0) delete n[p]
    else n[p] = q
    return n
  })

  async function ejecutar() {
    setCorriendo(true); setPasos([]); setFin(null); setAntes(stock.data ?? null)
    try {
      const r = await fetch('/api/traspasos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origen, destino, items, pausa }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({ detail: r.statusText }))
        setFin({ tipo: 'fin', ok: false, error: e.detail })
        return
      }
      const lector = r.body!.getReader()
      const dec = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await lector.read()
        if (done) break
        buffer += dec.decode(value, { stream: true })
        const lineas = buffer.split('\n')
        buffer = lineas.pop() ?? ''
        for (const l of lineas.filter(Boolean)) {
          const m: Paso = JSON.parse(l)
          if (m.tipo === 'paso') setPasos((p) => [...p, m.texto!])
          else setFin(m)
        }
      }
    } finally {
      setCorriendo(false)
      cliente.invalidateQueries({ queryKey: ['stock'] })
      cliente.invalidateQueries({ queryKey: ['log2pc'] })
      cliente.invalidateQueries({ queryKey: ['estado'] })
    }
  }

  const opcionesAlm = (almacenes.data ?? []).map((a) => {
    const n = estado?.nodos.find((x) => x.cod === a.nodo)
    return { valor: a.id, etiqueta: `${a.id} · ${a.nombre} — ${a.nodo_nombre}`, grupo: `Nodo ${a.num} · ${a.nodo_nombre}`,
      detalle: n && !n.en_linea ? 'sin conexión' : undefined }
  })
  const conservado = antes && stock.data && !corriendo && fin?.ok &&
    antes.every((a) => a.nacional != null && a.nacional === s(a.id_producto)?.nacional)

  return (
    <>
      <Encabezado titulo="Traspasos interdepartamentales (2PC)"
        descripcion="Mover mercadería entre almacenes de dos sucursales es una transacción distribuida: todos los productos se confirman en ambos nodos o no se mueve ninguno. Cada sucursal tiene su propio stock; el total nacional de cada producto no cambia, solo se mueve de lugar." />

      <div className="grid gap-4 xl:grid-cols-3">
        <Seccion className="xl:col-span-2" titulo="Preparar el traspaso">
          <div className="grid items-end gap-3 md:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-2">
              <Label>Almacén de origen</Label>
              <Selector valor={origen} alCambiar={setOrigen} opciones={opcionesAlm} buscar="Buscar almacén o sucursal…" />
            </div>
            <ArrowRight className="mx-auto mb-2 hidden size-5 text-muted-foreground md:block" />
            <div className="space-y-2">
              <Label>Almacén de destino</Label>
              <Selector valor={destino} alCambiar={setDestino} opciones={opcionesAlm} buscar="Buscar almacén o sucursal…" />
            </div>
          </div>

          {bloqueo && (
            <Alert variant="destructive"><Ban /><AlertTitle>Traspaso no permitido</AlertTitle><AlertDescription>{bloqueo}</AlertDescription></Alert>
          )}

          <div className="space-y-2">
            <Label>Productos a traspasar</Label>
            <Selector limpiarAlElegir deshabilitado={!!bloqueo} placeholder="Buscar y agregar un producto…" buscar="Nombre o categoría…"
              alCambiar={(p) => cambiar(p, items[p] ?? 1)}
              opciones={(productos.data ?? []).map((p) => ({ valor: p.id, etiqueta: p.nombre, grupo: p.categoria, detalle: `#${p.id}` }))} />
          </div>

          {ids.length > 0 && !bloqueo && (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="bg-muted/60">
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Stock origen</TableHead>
                    <TableHead className="text-right">Stock destino</TableHead>
                    <TableHead className="text-right">Stock nacional</TableHead>
                    <TableHead className="w-44 text-center">Cantidad</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ids.map((p) => {
                    const st = s(p)
                    const excede = st?.origen != null && items[p] > st.origen
                    return (
                      <TableRow key={p}>
                        <TableCell><div className="font-medium">{nombre(p)}</div><div className="text-xs text-muted-foreground">#{p}</div></TableCell>
                        <TableCell className={cn('text-right tabular-nums', excede && 'text-destructive')}>{stock.isPending ? '…' : fmt.n(st?.origen)}</TableCell>
                        <TableCell className="text-right tabular-nums">{stock.isPending ? '…' : fmt.n(st?.destino)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{stock.isPending ? '…' : fmt.n(st?.nacional)}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="outline" size="icon-sm" onClick={() => cambiar(p, items[p] - 1)}><Minus /></Button>
                            <Input type="number" min={1} value={items[p]} onChange={(e) => cambiar(p, Number(e.target.value))}
                              className={cn('h-7 w-16 text-center tabular-nums', excede && 'border-destructive')} />
                            <Button variant="outline" size="icon-sm" onClick={() => cambiar(p, items[p] + 1)}><Plus /></Button>
                          </div>
                        </TableCell>
                        <TableCell><Button variant="ghost" size="icon-sm" onClick={() => cambiar(p, 0)}><Trash2 /></Button></TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {stock.data?.some((x) => x.nacional == null) && !bloqueo && (
            <p className="text-xs text-muted-foreground">Stock nacional no disponible: requiere los 6 nodos en línea.</p>
          )}

          <div className="grid gap-4 border-t pt-4 md:grid-cols-[1fr_auto] md:items-end">
            <div className="space-y-3">
              <div className="flex justify-between text-sm"><Label>Pausa después de cada PREPARE</Label><span className="tabular-nums text-muted-foreground">{pausa} s</span></div>
              <Slider min={0} max={30} step={1} value={[pausa]} onValueChange={(v) => setPausa(Array.isArray(v) ? v[0] : v)} />
              <p className="text-xs text-muted-foreground">Da tiempo para cortar el enlace WAN de la sucursal de destino a mitad del protocolo (en otra pestaña: Simulación de fallas → Cortar el enlace WAN) y ver cómo se revierte en ambas.</p>
            </div>
            <Button size="lg" disabled={!!bloqueo || !ids.length || corriendo} onClick={ejecutar}>
              {corriendo ? <Loader2 className="animate-spin" /> : <ArrowRight />} Ejecutar traspaso
            </Button>
          </div>
          <SqlParticipantes />
        </Seccion>

        <Seccion titulo="Protocolo en ejecución" descripcion="Cada paso del coordinador, en tiempo real">
          {pasos.length === 0 && !fin ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Ejecute un traspaso para ver las fases del 2PC.</p>
          ) : (
            <ol className="relative space-y-3 border-l pl-5">
              {pasos.map((p, i) => (
                <li key={i} className="text-sm">
                  <CircleDot className={cn('absolute -left-[7px] mt-0.5 size-3.5 bg-card',
                    p.startsWith('DECISIÓN: COMMIT') || p.startsWith('✔') ? 'text-success' : p.includes('ABORTAR') || p.includes('ROLLBACK') ? 'text-destructive' : 'text-primary')} />
                  <span className={cn(p.startsWith('FASE') || p.startsWith('DECISIÓN') ? 'font-medium' : 'text-muted-foreground')}>{p}</span>
                </li>
              ))}
              {corriendo && <li className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> en curso…</li>}
            </ol>
          )}
          {fin && (fin.ok ? (
            <Alert><CheckCircle2 className="text-success" /><AlertTitle>Confirmado en ambas sucursales</AlertTitle><AlertDescription className="font-mono text-xs">{fin.gid}</AlertDescription></Alert>
          ) : (
            <Alert variant="destructive"><XCircle /><AlertTitle>Traspaso abortado</AlertTitle><AlertDescription>{fin.error}. Ningún stock cambió en ninguna de las dos sucursales (atomicidad).</AlertDescription></Alert>
          ))}
        </Seccion>
      </div>

      {antes && fin && !corriendo && (
        <Seccion titulo="Stock antes y después" descripcion="Origen, destino y total nacional de cada producto"
          acciones={conservado ? <Badge className="gap-1.5 bg-success text-white"><Scale /> Stock nacional conservado</Badge> : undefined}>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Producto</TableHead><TableHead className="text-right">Origen</TableHead>
              <TableHead className="text-right">Destino</TableHead><TableHead className="text-right">Nacional</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {antes.map((a) => {
                const d = s(a.id_producto)
                const cel = (x: number | null, y: number | null | undefined) => (
                  <span className="tabular-nums">{fmt.n(x)} <span className="text-muted-foreground">→</span>{' '}
                    <b className={cn(y != null && x != null && y < x && 'text-destructive', y != null && x != null && y > x && 'text-success')}>{fmt.n(y)}</b></span>)
                return (
                  <TableRow key={a.id_producto}>
                    <TableCell>{nombre(a.id_producto)}</TableCell>
                    <TableCell className="text-right">{cel(a.origen, d?.origen)}</TableCell>
                    <TableCell className="text-right">{cel(a.destino, d?.destino)}</TableCell>
                    <TableCell className="text-right">{cel(a.nacional, d?.nacional)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Seccion>
      )}

      <Seccion titulo="Registro de decisiones del coordinador" descripcion="traspasos_log en el Nodo 3 (Cochabamba): la decisión COMMIT escrita aquí es el punto irrevocable del protocolo">
          {log.isPending ? <Cargando /> : log.error ? <Error error={log.error} titulo="Nodo 3 sin conexión" /> : (
            <Tabla datos={log.data.filas} porPagina={8} claveFila={(l) => l.gid} columnas={[
              { clave: 'creado_en', titulo: 'Fecha', render: (l) => fmt.fecha(l.creado_en) },
              { clave: 'ruta', titulo: 'Ruta', render: (l) => <span className="text-xs">{l.id_almacen_origen} ({l.origen.toUpperCase()}) → {l.id_almacen_destino} ({l.destino.toUpperCase()})</span> },
              { clave: 'items', titulo: 'Productos', render: (l) => <span className="text-xs">{Object.entries(l.items ?? {}).map(([p, q]) => `${q} × ${nombre(Number(p))}`).join(', ')}</span> },
              { clave: 'estado', titulo: 'Decisión', render: (l) => (
                <Badge variant="outline" className={l.estado === 'COMMIT' ? 'border-success/30 bg-success/10 text-success'
                  : l.estado === 'ABORTADO' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-amber-300 text-amber-700'}>{l.estado}</Badge>) },
              { clave: 'detalle', titulo: 'Motivo', render: (l) => <span className="text-xs text-muted-foreground">{l.detalle ?? '—'}</span> },
            ]} />
          )}
      </Seccion>
    </>
  )
}

function SqlParticipantes() {
  const sqlP = useQuery({ queryKey: ['sql2pc'], queryFn: () => api<{ descontar: string; acreditar: string }>('/traspasos/sql'), staleTime: Infinity })
  if (!sqlP.data) return null
  return (
            <BloqueSql titulo="SQL de cada participante (fase 1 y 2)" abierto={false} sql={`-- Origen: una sentencia por producto; vota NO si alguno no alcanza
BEGIN;
${sqlP.data.descontar};
PREPARE TRANSACTION '<gid>-origen';

-- Destino
BEGIN;
${sqlP.data.acreditar};
PREPARE TRANSACTION '<gid>-destino';

-- Decisión en traspasos_log (Nodo 3), luego fase 2 en ambos:
COMMIT PREPARED '<gid>-…';   -- o ROLLBACK PREPARED`} />
  )
}
