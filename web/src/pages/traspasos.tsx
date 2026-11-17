// Traspasos entre sucursales: dos «sí» de personas (origen solicita, destino acepta) y luego el
// 2PC, que pide el voto de las dos bases de datos.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight, Ban, CheckCircle2, CircleDot, Clock, Inbox, Loader2, Minus, Plus, Send, Store, Trash2, Truck, Wifi, WifiOff, X, XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { BloqueSql, Cargando, Encabezado, Error, Seccion } from '@/components/comunes'
import { GrillaProductos } from '@/components/productos'
import { Segmentos } from '@/components/selector'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type Almacen, api, type ConSql, DEPARTAMENTOS, fmt, foto, type Producto, useAlmacenes, useEstado, useProductos, useSesion } from '@/lib/api'
import { cn } from '@/lib/utils'

export interface SolicitudT {
  id: number; origen: string; destino: string; id_almacen_origen: number; id_almacen_destino: number
  items: Record<string, number>; nota: string | null; estado: string; motivo: string | null; gid: string | null
  creado_en: string; respondido_en: string | null
}
interface Stock { id_producto: number; origen: number | null; destino: number | null; nacional: number | null }
interface Paso { tipo: 'paso' | 'fin'; texto?: string; ok?: boolean; gid?: string; error?: string }

export const ESTADO_SOLICITUD: Record<string, { texto: string; clase: string }> = {
  PENDIENTE: { texto: 'Esperando respuesta', clase: 'border-amber-300 bg-amber-50 text-amber-700' },
  ACEPTADA: { texto: 'Ejecutando 2PC', clase: 'border-sky-300 bg-sky-50 text-sky-700' },
  COMPLETADA: { texto: 'Completado', clase: 'border-success/30 bg-success/10 text-success' },
  FALLIDA: { texto: 'Revertido (2PC)', clase: 'border-destructive/30 bg-destructive/10 text-destructive' },
  RECHAZADA: { texto: 'Rechazado', clase: 'border-destructive/30 bg-destructive/10 text-destructive' },
  CANCELADA: { texto: 'Cancelado', clase: 'border-border bg-muted text-muted-foreground' },
}

export function useSolicitudes() {
  return useQuery({ queryKey: ['solicitudes'], queryFn: () => api<ConSql<SolicitudT>>('/solicitudes'), refetchInterval: 8_000 })
}

export default function Traspasos() {
  const cod = useSesion().data!.sucursal!
  const sol = useSolicitudes()
  const porRecibir = (sol.data?.filas ?? []).filter((s) => s.destino === cod && s.estado === 'PENDIENTE')
  const [pestana, setPestana] = useState<string>('nuevo')

  return (
    <>
      <Encabezado titulo="Traspasos entre sucursales"
        descripcion="Mover mercadería de una sucursal a otra necesita dos confirmaciones: el encargado que la envía la solicita y el encargado que la recibe la acepta. Recién entonces se ejecuta el traspaso con compromiso en dos fases: se descuenta aquí y se suma allá en un solo paso, o no ocurre nada." />
      <Tabs value={pestana} onValueChange={(v) => setPestana(String(v))}>
        <TabsList className="h-9">
          <TabsTrigger value="nuevo"><Send /> Nuevo traspaso</TabsTrigger>
          <TabsTrigger value="recibir"><Inbox /> Por recibir
            {porRecibir.length > 0 && <Badge className="ml-1 h-5 bg-amber-500 px-1.5 text-white">{porRecibir.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="enviados"><Truck /> Enviados</TabsTrigger>
        </TabsList>
        <TabsContent value="nuevo" className="mt-4"><NuevoTraspaso alEnviar={() => setPestana('enviados')} /></TabsContent>
        <TabsContent value="recibir" className="mt-4"><PorRecibir /></TabsContent>
        <TabsContent value="enviados" className="mt-4"><Enviados /></TabsContent>
      </Tabs>
    </>
  )
}

// ------------------------------------------------------------------ 1 · nuevo traspaso (solicitud del origen)
function NuevoTraspaso({ alEnviar }: { alEnviar: () => void }) {
  const cod = useSesion().data!.sucursal!
  const cliente = useQueryClient()
  const almacenes = useAlmacenes()
  const productos = useProductos()
  const { data: estado } = useEstado()
  const propios = (almacenes.data ?? []).filter((a) => a.nodo === cod)
  const [origenSel, setOrigen] = useState<number | null>(null)
  const origen = origenSel ?? propios[0]?.id ?? null
  const [destino, setDestino] = useState<number | null>(null)
  const [items, setItems] = useState<Record<number, number>>({})
  const [nota, setNota] = useState('')
  const alm = (id: number | null) => almacenes.data?.find((a) => a.id === id)
  const ids = Object.keys(items).map(Number)
  const stock = useQuery({
    queryKey: ['stock', origen, destino, ids.join(',')], enabled: ids.length > 0 && !!origen && !!destino,
    queryFn: () => api<Stock[]>(`/traspasos/stock?origen=${origen}&destino=${destino}&productos=${ids.join(',')}`),
  })
  const s = (p: number) => stock.data?.find((x) => x.id_producto === p)
  const prod = (p: number) => productos.data?.find((x) => x.id === p)
  const otras = (estado?.nodos ?? []).filter((n) => n.cod !== cod)
  const sucDestino = alm(destino)?.nodo
  const yo = estado?.nodos.find((n) => n.cod === cod)
  const excede = ids.some((p) => s(p)?.origen != null && items[p] > (s(p)!.origen ?? 0))
  const cambiar = (p: number, q: number) => setItems((c) => {
    const n = { ...c }
    if (q <= 0) delete n[p]
    else n[p] = q
    return n
  })

  const solicitar = useMutation({
    mutationFn: () => api<{ id: number }>('/solicitudes', { body: { origen, destino, items, nota } }),
    onSuccess: (r) => {
      toast.success(`Solicitud #${r.id} enviada a la sucursal ${alm(destino)?.nodo_nombre}`, { description: 'Queda pendiente hasta que su encargado la acepte.' })
      setItems({}); setNota(''); setDestino(null)
      cliente.invalidateQueries({ queryKey: ['solicitudes'] })
      alEnviar()
    },
  })

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_350px]">
      <div className="min-w-0 space-y-4">
        {yo && !yo.en_linea && (
          <Alert className="border-amber-300 bg-amber-50 text-amber-900"><WifiOff /><AlertTitle>Esta sucursal no está en la red nacional</AlertTitle>
            <AlertDescription className="text-amber-900/80">Puede seguir vendiendo, pero no puede solicitar ni recibir traspasos hasta que vuelva la conexión.</AlertDescription></Alert>
        )}
        <Seccion titulo="1 · Ruta del traspaso" descripcion="Desde qué almacén sale la mercadería y a qué sucursal y departamento llega">
          <div className="space-y-2">
            <Label>Sale de · Sucursal {yo?.nombre}</Label>
            <ElegirAlmacen almacenes={propios} valor={origen} alCambiar={setOrigen} />
          </div>
          <div className="space-y-2">
            <Label>Llega a · sucursal de destino</Label>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
              {otras.map((n) => {
                const elegida = n.cod === sucDestino
                return (
                  <button key={n.cod} type="button" onClick={() => setDestino((almacenes.data ?? []).find((a) => a.nodo === n.cod)?.id ?? null)}
                    className={cn('flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                      elegida ? 'border-primary bg-accent ring-1 ring-primary' : 'hover:bg-muted')}>
                    <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-md', elegida ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                      <Store className="size-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm leading-tight font-medium">Sucursal {n.nombre}</span>
                        {elegida && <CheckCircle2 className="size-4 shrink-0 text-primary" />}
                      </div>
                      <div className="text-xs text-muted-foreground">{n.deptos.map((d) => DEPARTAMENTOS[d]).join(' · ')}</div>
                      <div className={cn('mt-1 flex items-center gap-1 text-[11px]', n.en_linea ? 'text-success' : 'text-amber-600')}>
                        {n.en_linea ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
                        {n.en_linea ? 'En la red' : 'Sin red: verá la solicitud cuando vuelva'}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
          {sucDestino && (
            <div className="space-y-2">
              <Label>Departamento y almacén de destino</Label>
              <ElegirAlmacen almacenes={(almacenes.data ?? []).filter((a) => a.nodo === sucDestino)} valor={destino} alCambiar={setDestino} />
            </div>
          )}
        </Seccion>

        <Seccion titulo="2 · Productos" descripcion="Toque un producto, elija la presentación y la cantidad">
          <GrillaProductos productos={productos.data ?? []} cantidades={items} columnas="grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
            alAgregar={(p) => cambiar(p, (items[p] ?? 0) + 1)} alCambiar={cambiar} />
        </Seccion>
      </div>

      <div className="space-y-4 lg:sticky lg:top-20 lg:h-fit lg:max-h-[calc(100svh-6rem)] lg:overflow-y-auto">
        <Seccion titulo="3 · Solicitar">
          {origen && destino ? (
            <div className="space-y-1 rounded-lg bg-muted/60 p-3 text-sm">
              <div className="flex items-center gap-2"><span className="text-muted-foreground">De</span><b>{alm(origen)?.nombre}</b><span className="text-xs text-muted-foreground">{DEPARTAMENTOS[alm(origen)!.depto]}</span></div>
              <div className="flex items-center gap-2"><span className="text-muted-foreground">A</span><b>{alm(destino)?.nombre}</b><span className="text-xs text-muted-foreground">{DEPARTAMENTOS[alm(destino)!.depto]} · Suc. {alm(destino)?.nodo_nombre}</span></div>
            </div>
          ) : <p className="text-sm text-muted-foreground">Elija la sucursal de destino.</p>}

          {ids.length === 0 ? <p className="text-sm text-muted-foreground">Agregue productos desde el catálogo.</p> : (
            <div className="divide-y rounded-lg border">
              {ids.map((p) => {
                const st = s(p)
                const falta = st?.origen != null && items[p] > st.origen
                return (
                  <div key={p} className="flex items-center gap-2 p-2">
                    <img src={foto(p)} alt="" className="size-9 rounded-md object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{prod(p)?.nombre}</div>
                      <div className={cn('text-[11px]', falta ? 'text-destructive' : 'text-muted-foreground')}>Disponible aquí: {stock.isPending ? '…' : fmt.n(st?.origen)}</div>
                    </div>
                    <Button variant="outline" size="icon-xs" onClick={() => cambiar(p, items[p] - 1)}><Minus /></Button>
                    <span className="w-7 text-center text-sm tabular-nums">{items[p]}</span>
                    <Button variant="outline" size="icon-xs" onClick={() => cambiar(p, items[p] + 1)}><Plus /></Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => cambiar(p, 0)}><Trash2 /></Button>
                  </div>
                )
              })}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="nota">Nota para la sucursal de destino (opcional)</Label>
            <Input id="nota" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: reposición por campaña de fin de mes" />
          </div>
          {excede && <p className="text-xs text-destructive">Hay productos con más unidades que las disponibles: el 2PC los rechazará al ejecutarse.</p>}
          {solicitar.error && <Error error={solicitar.error} titulo="No se pudo enviar la solicitud" />}
          <Button size="lg" className="h-11 w-full" disabled={!ids.length || !destino || solicitar.isPending || !yo?.en_linea} onClick={() => solicitar.mutate()}>
            {solicitar.isPending ? <Loader2 className="animate-spin" /> : <Send />} Solicitar traspaso
          </Button>
          <p className="text-[11px] text-muted-foreground">La mercadería no se mueve todavía: el encargado de la sucursal de destino debe aceptar.</p>
        </Seccion>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ tarjeta de una solicitud
function TarjetaSolicitud({ s, productos, almacenes, children }: {
  s: SolicitudT; productos: Producto[]; almacenes: Almacen[]; children?: React.ReactNode
}) {
  const alm = (id: number) => almacenes.find((a) => a.id === id)
  const e = ESTADO_SOLICITUD[s.estado] ?? ESTADO_SOLICITUD.PENDIENTE
  const unidades = Object.values(s.items).reduce((a, b) => a + b, 0)
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span>Solicitud #{s.id}</span>
            <Badge variant="outline" className={e.clase}>{e.texto}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
            <b>Suc. {alm(s.id_almacen_origen)?.nodo_nombre}</b>
            <span className="text-xs text-muted-foreground">({alm(s.id_almacen_origen)?.nombre})</span>
            <ArrowRight className="size-3.5 text-muted-foreground" />
            <b>Suc. {alm(s.id_almacen_destino)?.nodo_nombre}</b>
            <span className="text-xs text-muted-foreground">({alm(s.id_almacen_destino)?.nombre}, {DEPARTAMENTOS[alm(s.id_almacen_destino)?.depto ?? '']})</span>
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground"><Clock className="mr-1 inline size-3" />{fmt.fecha(s.creado_en)}<div>{unidades} unidades</div></div>
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(s.items).map(([p, q]) => {
          const pr = productos.find((x) => x.id === Number(p))
          return (
            <div key={p} className="flex items-center gap-2 rounded-lg border bg-muted/30 py-1 pr-3 pl-1">
              <img src={foto(Number(p))} alt="" className="size-8 rounded-md object-cover" />
              <span className="text-xs"><b>{q}</b> × {pr?.nombre ?? `#${p}`}</span>
            </div>
          )
        })}
      </div>
      {s.nota && <p className="rounded-md bg-muted/50 px-3 py-2 text-xs italic">“{s.nota}”</p>}
      {s.motivo && <p className="text-xs text-muted-foreground">Motivo: {s.motivo}</p>}
      {s.gid && <p className="font-mono text-[11px] text-muted-foreground">2PC: {s.gid}</p>}
      {children}
    </div>
  )
}

// ------------------------------------------------------------------ 2 · por recibir (aceptación del destino)
function PorRecibir() {
  const cod = useSesion().data!.sucursal!
  const cliente = useQueryClient()
  const sol = useSolicitudes()
  const productos = useProductos()
  const almacenes = useAlmacenes()
  const { data: estado } = useEstado()
  const [pausa, setPausa] = useState(0)
  const [enCurso, setEnCurso] = useState<number | null>(null)
  const [pasos, setPasos] = useState<Record<number, string[]>>({})
  const [fin, setFin] = useState<Record<number, Paso>>({})
  const [motivo, setMotivo] = useState<Record<number, string>>({})
  const [rechazando, setRechazando] = useState<number | null>(null)
  const pendientes = (sol.data?.filas ?? []).filter((s) => s.destino === cod && s.estado === 'PENDIENTE')
  const recientes = (sol.data?.filas ?? []).filter((s) => s.destino === cod && s.estado !== 'PENDIENTE').slice(0, 10)
  const refrescar = () => ['solicitudes', 'stock', 'log2pc', 'estado', 'inventario', 'clientes'].forEach((k) => cliente.invalidateQueries({ queryKey: [k] }))

  async function aceptar(id: number) {
    setEnCurso(id); setPasos((x) => ({ ...x, [id]: [] })); setFin((x) => { const n = { ...x }; delete n[id]; return n })
    try {
      const r = await fetch(`/api/solicitudes/${id}/aceptar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pausa }) })
      if (!r.ok) {
        const e = await r.json().catch(() => ({ detail: r.statusText }))
        setFin((x) => ({ ...x, [id]: { tipo: 'fin', ok: false, error: e.detail } }))
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
          if (m.tipo === 'paso') setPasos((x) => ({ ...x, [id]: [...(x[id] ?? []), m.texto!] }))
          else setFin((x) => ({ ...x, [id]: m }))
        }
      }
    } finally {
      setEnCurso(null)
      refrescar()
    }
  }

  async function rechazar(id: number) {
    try {
      await api(`/solicitudes/${id}/rechazar`, { body: { motivo: motivo[id] ?? '' } })
      toast.success(`Solicitud #${id} rechazada`)
      setRechazando(null)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      refrescar()
    }
  }

  const procesadas = Object.keys(fin).map(Number)
  const mostrar = [...pendientes, ...(sol.data?.filas ?? []).filter((s) => procesadas.includes(s.id) && s.estado !== 'PENDIENTE')]

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-3">
        {sol.isPending ? <Cargando /> : sol.error ? <Error error={sol.error} titulo="Las solicitudes viven en Cochabamba (Nodo 3), que no responde" /> : mostrar.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-14 text-sm text-muted-foreground">
            <Inbox className="size-8" /> No hay traspasos esperando su aceptación
          </div>
        ) : mostrar.map((s) => {
          const origenNodo = estado?.nodos.find((n) => n.cod === s.origen)
          const f = fin[s.id]
          return (
            <TarjetaSolicitud key={s.id} s={s} productos={productos.data ?? []} almacenes={almacenes.data ?? []}>
              {s.estado === 'PENDIENTE' && !f && (
                rechazando === s.id ? (
                  <div className="flex flex-wrap gap-2">
                    <Input autoFocus value={motivo[s.id] ?? ''} onChange={(e) => setMotivo((x) => ({ ...x, [s.id]: e.target.value }))} placeholder="Motivo del rechazo (opcional)" className="h-8 flex-1" />
                    <Button size="sm" variant="destructive" onClick={() => rechazar(s.id)}>Confirmar rechazo</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRechazando(null)}>Volver</Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" disabled={enCurso !== null} onClick={() => aceptar(s.id)}>
                      {enCurso === s.id ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Aceptar y recibir
                    </Button>
                    <Button size="sm" variant="outline" disabled={enCurso !== null} onClick={() => setRechazando(s.id)}><X /> Rechazar</Button>
                    {origenNodo && !origenNodo.en_linea && <span className="flex items-center gap-1 text-xs text-amber-600"><WifiOff className="size-3" /> La sucursal de origen no está en la red: no se podrá ejecutar ahora</span>}
                  </div>
                )
              )}
              {(pasos[s.id]?.length ?? 0) > 0 && (
                <ol className="relative space-y-2 border-l pl-5">
                  {pasos[s.id].map((p, i) => (
                    <li key={i} className="text-xs">
                      <CircleDot className={cn('absolute -left-[7px] mt-0.5 size-3.5 bg-card',
                        p.startsWith('DECISIÓN: COMMIT') || p.startsWith('✔') ? 'text-success' : p.includes('ABORTAR') || p.includes('ROLLBACK') ? 'text-destructive' : 'text-primary')} />
                      <span className={cn(p.startsWith('FASE') || p.startsWith('DECISIÓN') ? 'font-medium' : 'text-muted-foreground')}>{p}</span>
                    </li>
                  ))}
                  {enCurso === s.id && <li className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> en curso…</li>}
                </ol>
              )}
              {f && (f.ok
                ? <Alert><CheckCircle2 className="text-success" /><AlertTitle>Traspaso recibido</AlertTitle><AlertDescription>Confirmado en las dos sucursales: el stock se descontó en origen y se sumó aquí, en un solo paso.</AlertDescription></Alert>
                : <Alert variant="destructive"><XCircle /><AlertTitle>No se realizó</AlertTitle><AlertDescription>{f.error} Ningún stock cambió en ninguna de las dos sucursales.</AlertDescription></Alert>)}
            </TarjetaSolicitud>
          )
        })}
        {recientes.length > 0 && (
          <details className="rounded-xl border bg-card p-4">
            <summary className="cursor-pointer text-sm font-medium">Respondidas recientemente ({recientes.length})</summary>
            <div className="mt-3 space-y-3">{recientes.map((s) => <TarjetaSolicitud key={s.id} s={s} productos={productos.data ?? []} almacenes={almacenes.data ?? []} />)}</div>
          </details>
        )}
      </div>
      <div className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
        <Seccion titulo="¿Qué pasa al aceptar?">
          <ol className="list-decimal space-y-1.5 pl-4 text-xs text-muted-foreground">
            <li>Usted da el segundo «sí» (el primero lo dio quien envía).</li>
            <li>Se verifica que las dos sucursales estén en la red nacional.</li>
            <li><b>Fase 1:</b> cada base prepara su cambio y vota (PREPARE).</li>
            <li><b>Decisión</b> registrada en Cochabamba.</li>
            <li><b>Fase 2:</b> COMMIT en ambas. Si algo falla, ROLLBACK en ambas.</li>
          </ol>
          <div className="space-y-2 border-t pt-3">
            <div className="flex justify-between text-xs"><Label>Pausa tras cada PREPARE (demostración)</Label><span className="tabular-nums text-muted-foreground">{pausa} s</span></div>
            <Slider min={0} max={30} step={1} value={[pausa]} onValueChange={(v) => setPausa(Array.isArray(v) ? v[0] : v)} />
            <p className="text-[11px] text-muted-foreground">Da tiempo para cortar el enlace de una sucursal a mitad del protocolo y ver el rollback.</p>
          </div>
        </Seccion>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ 3 · enviados (solicitudes del origen)
function Enviados() {
  const cod = useSesion().data!.sucursal!
  const cliente = useQueryClient()
  const sol = useSolicitudes()
  const productos = useProductos()
  const almacenes = useAlmacenes()
  const mias = (sol.data?.filas ?? []).filter((s) => s.origen === cod)
  const cancelar = useMutation({
    mutationFn: (id: number) => api(`/solicitudes/${id}/cancelar`, { method: 'POST' }),
    onSuccess: () => { toast.success('Solicitud cancelada'); cliente.invalidateQueries({ queryKey: ['solicitudes'] }) },
    onError: (e) => toast.error(e.message),
  })
  return (
    <div className="space-y-3">
      {sol.isPending ? <Cargando /> : sol.error ? <Error error={sol.error} /> : mias.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-14 text-sm text-muted-foreground"><Truck className="size-8" /> Esta sucursal todavía no solicitó traspasos</div>
      ) : mias.map((s) => (
        <TarjetaSolicitud key={s.id} s={s} productos={productos.data ?? []} almacenes={almacenes.data ?? []}>
          {s.estado === 'PENDIENTE' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Esperando que la sucursal de destino acepte.</span>
              <Button size="sm" variant="ghost" className="ml-auto" disabled={cancelar.isPending} onClick={() => cancelar.mutate(s.id)}><Ban /> Cancelar</Button>
            </div>
          )}
        </TarjetaSolicitud>
      ))}
      {sol.data && <BloqueSql sql={sol.data.sql} nota="bd_cb · solicitudes en el hub de traspasos" abierto={false} />}
    </div>
  )
}

// ------------------------------------------------------------------ departamento y almacén
function ElegirAlmacen({ almacenes, valor, alCambiar }: { almacenes: Almacen[]; valor: number | null; alCambiar: (id: number) => void }) {
  const deptos = [...new Set(almacenes.map((a) => a.depto))]
  const depto = almacenes.find((a) => a.id === valor)?.depto ?? deptos[0]
  if (!deptos.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {deptos.length > 1 ? (
        <Segmentos valor={depto} alCambiar={(d) => alCambiar(almacenes.find((a) => a.depto === d)!.id)}
          opciones={deptos.map((d) => ({ valor: d, etiqueta: DEPARTAMENTOS[d] }))} />
      ) : <Badge variant="secondary" className="h-8 px-3">{DEPARTAMENTOS[depto]}</Badge>}
      <Segmentos valor={String(valor ?? '')} alCambiar={(v) => alCambiar(Number(v))}
        opciones={almacenes.filter((a) => a.depto === depto).map((a) => ({ valor: String(a.id), etiqueta: a.nombre }))} />
    </div>
  )
}
