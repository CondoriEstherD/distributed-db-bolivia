import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Ban, CheckCircle2, CircleDot, Loader2, Minus, Plus, Scale, Store, Trash2, Truck, Wifi, WifiOff, XCircle } from 'lucide-react'

import { BloqueSql, Cargando, Encabezado, Error, Seccion, Tabla } from '@/components/comunes'
import { GrillaProductos } from '@/components/productos'
import { Segmentos } from '@/components/selector'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { type Almacen, api, type ConSql, DEPARTAMENTOS, fmt, foto, useAlmacenes, useEstado, useProductos, useSesion } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Stock { id_producto: number; origen: number | null; destino: number | null; nacional: number | null }
interface Paso { tipo: 'paso' | 'fin'; texto?: string; ok?: boolean; gid?: string; error?: string }
interface Log { gid: string; origen: string; destino: string; id_almacen_origen: number; id_almacen_destino: number; items: Record<string, number>; estado: string; detalle: string | null; creado_en: string }
type Fase = 'listo' | 'verificando' | 'protocolo' | 'fin'

export default function Envios({ todasLasSucursales = false }: { todasLasSucursales?: boolean }) {
  const sesion = useSesion().data!
  const cod = sesion.sucursal!
  const cliente = useQueryClient()
  const almacenes = useAlmacenes()
  const productos = useProductos()
  const { data: estado } = useEstado()
  const propios = (almacenes.data ?? []).filter((a) => todasLasSucursales || a.nodo === cod)
  const [origenSel, setOrigen] = useState<number | null>(null)
  const origen = origenSel ?? propios[0]?.id ?? null
  const [destino, setDestino] = useState<number | null>(null)
  const [items, setItems] = useState<Record<number, number>>({})
  const [pausa, setPausa] = useState(0)
  const [fase, setFase] = useState<Fase>('listo')
  const [verif, setVerif] = useState<{ nodo: string; ok: boolean; estado: string }[]>([])
  const [pasos, setPasos] = useState<string[]>([])
  const [fin, setFin] = useState<Paso | null>(null)
  const [antes, setAntes] = useState<Stock[] | null>(null)

  const alm = (id: number | null) => almacenes.data?.find((a) => a.id === id)
  const nodoDe = (id: number | null) => estado?.nodos.find((n) => n.cod === alm(id)?.nodo)
  const ids = Object.keys(items).map(Number)
  const stock = useQuery({
    queryKey: ['stock', origen, destino, ids.join(',')], enabled: ids.length > 0 && !!origen && !!destino,
    queryFn: () => api<Stock[]>(`/traspasos/stock?origen=${origen}&destino=${destino}&productos=${ids.join(',')}`),
  })
  const log = useQuery({ queryKey: ['log2pc'], queryFn: () => api<ConSql<Log>>('/traspasos/log') })
  const s = (p: number) => stock.data?.find((x) => x.id_producto === p)
  const prod = (p: number) => productos.data?.find((x) => x.id === p)
  const cambiar = (p: number, q: number) => setItems((c) => {
    const n = { ...c }
    if (q <= 0) delete n[p]
    else n[p] = q
    return n
  })

  async function enviar() {
    if (!origen || !destino) return
    setPasos([]); setFin(null); setAntes(stock.data ?? null)
    // 1 · Verificar la red: el 2PC necesita el voto de las DOS sucursales.
    setFase('verificando')
    const e = await api<{ nodos: { cod: string; nodo: string; en_linea: boolean; estado: string }[] }>('/estado?forzar=true')
    cliente.setQueryData(['estado'], e)
    const v = [alm(origen)!.nodo, alm(destino)!.nodo].map((c) => {
      const n = e.nodos.find((x) => x.cod === c)!
      return { nodo: n.nodo, ok: n.en_linea, estado: n.estado }
    })
    setVerif(v)
    if (!v.every((x) => x.ok)) {
      setFin({ tipo: 'fin', ok: false, error: 'Una de las sucursales no está en la red nacional: el envío no se inició.' })
      setFase('fin')
      return
    }
    // 2 · Compromiso en dos fases, transmitido paso a paso.
    setFase('protocolo')
    try {
      const r = await fetch('/api/traspasos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origen, destino, items, pausa }),
      })
      if (!r.ok) {
        const er = await r.json().catch(() => ({ detail: r.statusText }))
        setFin({ tipo: 'fin', ok: false, error: er.detail })
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
      setFase('fin')
      for (const k of ['stock', 'log2pc', 'estado', 'inventario', 'clientes']) cliente.invalidateQueries({ queryKey: [k] })
    }
  }

  const otras = (estado?.nodos ?? []).filter((n) => n.cod !== alm(origen)?.nodo)
  const sucDestino = alm(destino)?.nodo
  const destinoCaido = destino && nodoDe(destino) && !nodoDe(destino)!.en_linea
  const yoCaido = nodoDe(origen) && !nodoDe(origen)!.en_linea
  const conservado = antes && stock.data && fase === 'fin' && fin?.ok && antes.every((a) => a.nacional != null && a.nacional === s(a.id_producto)?.nacional)

  return (
    <>
      <Encabezado titulo="Envíos entre sucursales"
        descripcion="Enviar mercadería a otra sucursal es una transacción distribuida: se descuenta aquí y se suma allá en un solo paso, o no ocurre nada. Antes de empezar se verifica que las dos sucursales estén conectadas a la red nacional." />

      {yoCaido && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-900"><WifiOff /><AlertTitle>Esta sucursal no está en la red nacional</AlertTitle>
          <AlertDescription className="text-amber-900/80">Puede seguir vendiendo, pero no puede enviar mercadería hasta que vuelva la conexión: el 2PC necesita el voto de ambas sucursales.</AlertDescription></Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_350px]">
        <div className="min-w-0 space-y-4">
          <Seccion titulo="1 · Ruta del envío" descripcion="Elija desde qué almacén sale la mercadería y a qué sucursal y departamento llega">
            <div className="space-y-2">
              <Label>Sale de · Sucursal {alm(origen)?.nodo_nombre}</Label>
              <ElegirAlmacen almacenes={propios} valor={origen} alCambiar={(a) => { setOrigen(a); if (alm(destino)?.nodo === alm(a)?.nodo) setDestino(null) }} />
            </div>

            <div className="space-y-2">
              <Label>Llega a · elija la sucursal de destino</Label>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                {otras.map((n) => {
                  const elegida = n.cod === sucDestino
                  return (
                    <button key={n.cod} type="button" disabled={!n.en_linea}
                      onClick={() => setDestino((almacenes.data ?? []).find((a) => a.nodo === n.cod)?.id ?? null)}
                      className={cn('flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                        elegida ? 'border-primary bg-accent ring-1 ring-primary' : 'hover:bg-muted',
                        !n.en_linea && 'cursor-not-allowed opacity-60 hover:bg-transparent')}>
                      <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-md',
                        elegida ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}><Store className="size-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">Sucursal {n.nombre}</span>
                          {elegida && <CheckCircle2 className="size-4 shrink-0 text-primary" />}
                        </div>
                        <div className="text-xs text-muted-foreground">{n.deptos.map((d) => DEPARTAMENTOS[d]).join(' · ')}</div>
                        <div className={cn('mt-1 flex items-center gap-1 text-[11px]', n.en_linea ? 'text-success' : 'text-destructive')}>
                          {n.en_linea ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
                          {n.en_linea ? 'En la red · puede recibir' : n.estado === 'AISLADO' ? 'Sin red · no puede recibir envíos' : 'Sin conexión'}
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

            {origen && destino && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                <span className="font-medium">{alm(origen)?.nombre}</span>
                <span className="text-muted-foreground">({DEPARTAMENTOS[alm(origen)!.depto]})</span>
                <Truck className="size-4 text-primary" />
                <span className="font-medium">{alm(destino)?.nombre}</span>
                <span className="text-muted-foreground">({DEPARTAMENTOS[alm(destino)!.depto]}, Sucursal {alm(destino)?.nodo_nombre})</span>
              </div>
            )}
            {destinoCaido && (
              <Alert variant="destructive"><Ban /><AlertTitle>La sucursal de destino no está en la red</AlertTitle>
                <AlertDescription>{nodoDe(destino)!.nodo} está {nodoDe(destino)!.estado.toLowerCase()}: no puede votar en el 2PC, así que el envío no se permite. Sus ventas locales no se ven afectadas.</AlertDescription></Alert>
            )}
          </Seccion>

          <Seccion titulo="2 · Productos a enviar" descripcion="Toque un producto y elija la presentación y la cantidad">
            {ids.length > 0 && (
              <div className="divide-y rounded-lg border">
                {ids.map((p) => {
                  const st = s(p)
                  const excede = st?.origen != null && items[p] > st.origen
                  return (
                    <div key={p} className="flex flex-wrap items-center gap-3 p-2">
                      <img src={foto(p)} alt="" className="size-10 rounded-md object-cover" />
                      <div className="min-w-40 flex-1"><div className="text-sm font-medium">{prod(p)?.nombre}</div>
                        <div className={cn('text-xs', excede ? 'text-destructive' : 'text-muted-foreground')}>
                          Aquí: {stock.isPending ? '…' : fmt.n(st?.origen)} · Destino: {stock.isPending ? '…' : fmt.n(st?.destino)} · Nacional: {stock.isPending ? '…' : fmt.n(st?.nacional)}
                        </div></div>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="icon-sm" onClick={() => cambiar(p, items[p] - 1)}><Minus /></Button>
                        <Input type="number" min={1} value={items[p]} onChange={(e) => cambiar(p, Number(e.target.value))} className={cn('h-7 w-16 text-center', excede && 'border-destructive')} />
                        <Button variant="outline" size="icon-sm" onClick={() => cambiar(p, items[p] + 1)}><Plus /></Button>
                      </div>
                      <Button variant="ghost" size="icon-sm" onClick={() => cambiar(p, 0)}><Trash2 /></Button>
                    </div>
                  )
                })}
              </div>
            )}
            <GrillaProductos productos={productos.data ?? []} cantidades={items} columnas="grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
              alAgregar={(p) => cambiar(p, (items[p] ?? 0) + 1)} alCambiar={cambiar} />
          </Seccion>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:h-fit lg:max-h-[calc(100svh-6rem)] lg:overflow-y-auto">
          <Seccion titulo="3 · Confirmar envío">
            <div className="space-y-3">
              <div className="flex justify-between text-sm"><Label>Pausa tras cada PREPARE (demostración)</Label><span className="text-muted-foreground tabular-nums">{pausa} s</span></div>
              <Slider min={0} max={30} step={1} value={[pausa]} onValueChange={(v) => setPausa(Array.isArray(v) ? v[0] : v)} />
              <p className="text-xs text-muted-foreground">Da tiempo para cortar el enlace de la sucursal de destino a mitad del protocolo (Administración central → Simulación de fallas) y ver el rollback.</p>
            </div>
            <Button size="lg" className="h-11 w-full" disabled={!ids.length || !destino || !!destinoCaido || !!yoCaido || fase === 'verificando' || fase === 'protocolo'} onClick={enviar}>
              {fase === 'verificando' || fase === 'protocolo' ? <Loader2 className="animate-spin" /> : <ArrowRight />}
              {fase === 'verificando' ? 'Verificando la red…' : fase === 'protocolo' ? 'Ejecutando 2PC…' : (Object.values(items).reduce((a, b) => a + b, 0) ? `Enviar ${Object.values(items).reduce((a, b) => a + b, 0)} unidades` : 'Enviar')}
            </Button>

            {verif.length > 0 && (
              <div className="space-y-1.5 rounded-lg bg-muted/50 p-3 text-sm">
                <div className="text-xs font-medium text-muted-foreground uppercase">Verificación de la red</div>
                {verif.map((v) => (
                  <div key={v.nodo} className={cn('flex items-center gap-2', v.ok ? 'text-success' : 'text-destructive')}>
                    {v.ok ? <Wifi className="size-4" /> : <WifiOff className="size-4" />} {v.nodo}: {v.ok ? 'en la red' : v.estado.toLowerCase()}
                  </div>
                ))}
              </div>
            )}
            {pasos.length > 0 && (
              <ol className="relative space-y-2.5 border-l pl-5">
                {pasos.map((p, i) => (
                  <li key={i} className="text-sm">
                    <CircleDot className={cn('absolute -left-[7px] mt-0.5 size-3.5 bg-card',
                      p.startsWith('DECISIÓN: COMMIT') || p.startsWith('✔') ? 'text-success' : p.includes('ABORTAR') || p.includes('ROLLBACK') ? 'text-destructive' : 'text-primary')} />
                    <span className={cn(p.startsWith('FASE') || p.startsWith('DECISIÓN') ? 'font-medium' : 'text-muted-foreground')}>{p}</span>
                  </li>
                ))}
                {fase === 'protocolo' && <li className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> en curso…</li>}
              </ol>
            )}
            {fin && (fin.ok ? (
              <Alert><CheckCircle2 className="text-success" /><AlertTitle>Envío confirmado en ambas sucursales</AlertTitle><AlertDescription className="font-mono text-xs">{fin.gid}</AlertDescription></Alert>
            ) : (
              <Alert variant="destructive"><XCircle /><AlertTitle>Envío no realizado</AlertTitle><AlertDescription>{fin.error} Ningún stock cambió en ninguna de las dos sucursales.</AlertDescription></Alert>
            ))}
            {conservado && <div className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm text-success"><Scale className="size-4" /> Stock nacional conservado: la mercadería solo cambió de lugar.</div>}
          </Seccion>
        </div>
      </div>

      <Seccion titulo={todasLasSucursales ? 'Todos los traspasos' : 'Mis envíos y recepciones'} descripcion="Decisiones registradas por el coordinador en el Nodo 3 (Cochabamba)">
        {log.isPending ? <Cargando /> : log.error ? <Error error={log.error} titulo="Registro no disponible" /> : (
          <>
            <Tabla datos={log.data.filas} porPagina={8} claveFila={(l) => l.gid} vacio="Todavía no hay envíos" columnas={[
              { clave: 'creado_en', titulo: 'Fecha', render: (l) => fmt.fecha(l.creado_en) },
              { clave: 'ruta', titulo: 'Ruta', render: (l) => <span className="text-xs font-medium">{l.origen.toUpperCase()} → {l.destino.toUpperCase()}</span> },
              { clave: 'items', titulo: 'Productos', render: (l) => <span className="text-xs">{Object.entries(l.items ?? {}).map(([p, q]) => `${q} × ${prod(Number(p))?.nombre ?? '#' + p}`).join(', ')}</span> },
              { clave: 'estado', titulo: 'Resultado', render: (l) => (
                <Badge variant="outline" className={l.estado === 'COMMIT' ? 'border-success/30 bg-success/10 text-success'
                  : l.estado === 'ABORTADO' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-amber-300 text-amber-700'}>
                  {l.estado === 'COMMIT' ? 'Confirmado' : l.estado === 'ABORTADO' ? 'Revertido' : l.estado}</Badge>) },
              { clave: 'detalle', titulo: 'Motivo', render: (l) => <span className="text-xs text-muted-foreground">{l.detalle ?? '—'}</span> },
            ]} />
            <BloqueSql sql={log.data.sql} nota="bd_cb" abierto={false} />
          </>
        )}
      </Seccion>
    </>
  )
}

// Departamento (si la sucursal tiene dos) y almacén: cada departamento tiene dos almacenes.
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
