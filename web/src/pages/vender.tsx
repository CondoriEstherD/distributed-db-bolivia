import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, Minus, PackageOpen, Plus, ShoppingCart, Trash2, WifiOff, X } from 'lucide-react'

import { BloqueSql } from '@/components/comunes'
import { GrillaProductos } from '@/components/productos'
import { Segmentos, Selector } from '@/components/selector'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { api, DEPARTAMENTOS, fmt, foto, nombreBase, presentacion, type Producto, useEstado, useProductos, useSesion } from '@/lib/api'

interface DatosDepto { clientes: { id_cliente: number; razon_social: string; nit_ci: string }[]; stock: Record<string, number> }
interface Comprobante { id_venta: number; total_bs: number; sql: string; terminal_local: boolean; items: { p: Producto; q: number }[]; cliente: string; depto: string }

export default function PuntoDeVenta() {
  const cod = useSesion().data!.sucursal!
  const cliente = useQueryClient()
  const { data: estado } = useEstado()
  const yo = estado?.nodos.find((n) => n.cod === cod)
  const productos = useProductos()
  const [depto, setDepto] = useState<string | null>(null)
  const dep = depto ?? yo?.deptos[0] ?? ''
  const [carrito, setCarrito] = useState<Record<number, number>>({})
  const [idCliente, setIdCliente] = useState<number | null>(null)
  const [comprobante, setComprobante] = useState<Comprobante | null>(null)
  const operable = yo && (yo.en_linea || yo.estado === 'AISLADO')

  const datos = useQuery({
    queryKey: ['clientes', cod, dep], enabled: !!dep && !!operable,
    queryFn: () => api<DatosDepto>(`/nodos/${cod}/clientes?departamento=${dep}`),
  })
  const stock = (p: number) => datos.data?.stock[p] ?? 0
  const items = Object.entries(carrito).map(([p, q]) => ({ p: productos.data!.find((x) => x.id === Number(p))!, q })).filter((i) => i.p)
  const total = items.reduce((s, i) => s + i.p.precio * i.q, 0)
  const cli = idCliente ?? datos.data?.clientes[0]?.id_cliente ?? null
  const nombreCli = datos.data?.clientes.find((c) => c.id_cliente === cli)?.razon_social ?? ''

  const cambiar = (p: number, q: number) => setCarrito((c) => {
    const n = { ...c }
    if (q <= 0) delete n[p]
    else n[p] = Math.min(q, stock(p))
    return n
  })

  const cobrar = useMutation({
    mutationFn: () => api<{ id_venta: number; total_bs: number; sql: string; terminal_local: boolean }>(`/nodos/${cod}/ventas`, {
      body: { departamento: dep, id_cliente: cli, items: items.map((i) => ({ id_producto: i.p.id, cantidad: i.q })) },
    }),
    onSuccess: (r) => {
      setComprobante({ ...r, items, cliente: nombreCli, depto: dep })
      setCarrito({})
      for (const k of ['clientes', 'resumen', 'ventas', 'inventario', 'clientes-lista']) cliente.invalidateQueries({ queryKey: [k, cod] })
      cliente.invalidateQueries({ queryKey: ['estado'] })
    },
  })

  if (yo && !operable) {
    return (
      <Alert variant="destructive" className="mt-6"><WifiOff /><AlertTitle>El servidor de la sucursal no responde</AlertTitle>
        <AlertDescription>{yo.estado === 'APAGADO' ? 'La base de datos de la sucursal está detenida: no se puede vender ni siquiera localmente.' : 'No se alcanza la máquina de la sucursal (como un corte de luz en la oficina).'}</AlertDescription></Alert>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_350px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Punto de venta</h1>
            <p className="text-sm text-muted-foreground">Sucursal {yo?.nombre} · stock de los almacenes de {DEPARTAMENTOS[dep]}</p>
          </div>
          {yo && yo.deptos.length > 1 && (
            <Segmentos valor={dep} alCambiar={(d) => { setDepto(d); setCarrito({}); setIdCliente(null) }}
              opciones={yo.deptos.map((d) => ({ valor: d, etiqueta: DEPARTAMENTOS[d] }))} />
          )}
        </div>

        {yo?.estado === 'AISLADO' && (
          <Alert className="border-amber-300 bg-amber-50 text-amber-900">
            <WifiOff /><AlertTitle>Sin conexión con la red nacional</AlertTitle>
            <AlertDescription className="text-amber-900/80">La sucursal sigue vendiendo con sus propios datos (autonomía local). Los envíos a otras sucursales quedan bloqueados hasta que vuelva la red.</AlertDescription>
          </Alert>
        )}

        {productos.isPending || datos.isPending ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}</div>
        ) : (
          <GrillaProductos productos={productos.data ?? []} stock={stock} cantidades={carrito}
            alAgregar={(p) => cambiar(p, (carrito[p] ?? 0) + 1)} alCambiar={cambiar} />
        )}
      </div>

      {/* Carrito */}
      <div className="lg:sticky lg:top-20 lg:h-fit lg:max-h-[calc(100svh-6rem)] lg:overflow-y-auto">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base"><ShoppingCart className="size-4" /> Venta actual</CardTitle>
            {items.length > 0 && <Button variant="ghost" size="sm" onClick={() => setCarrito({})}><X /> Vaciar</Button>}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Cliente</Label>
              <Selector valor={cli} alCambiar={setIdCliente} buscar="Nombre o NIT…"
                opciones={(datos.data?.clientes ?? []).map((c) => ({ valor: c.id_cliente, etiqueta: c.razon_social, detalle: `NIT ${c.nit_ci}` }))} />
            </div>
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                <PackageOpen className="size-7" /> Toque un producto para agregarlo
              </div>
            ) : (
              <div className="max-h-[340px] space-y-2 overflow-auto pr-1">
                {items.map(({ p, q }) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-lg border p-2">
                    <img src={foto(p.id)} alt="" className="size-11 shrink-0 rounded-md object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{nombreBase(p)}</div>
                      <div className="text-xs text-muted-foreground">{presentacion(p.id)} · {fmt.bs(p.precio)}</div>
                      <div className="mt-1 flex items-center gap-1">
                        <Button variant="outline" size="icon-xs" onClick={() => cambiar(p.id, q - 1)}><Minus /></Button>
                        <span className="w-8 text-center text-sm tabular-nums">{q}</span>
                        <Button variant="outline" size="icon-xs" disabled={q >= stock(p.id)} onClick={() => cambiar(p.id, q + 1)}><Plus /></Button>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-sm font-medium tabular-nums">{fmt.bs(p.precio * q)}</span>
                      <Button variant="ghost" size="icon-xs" onClick={() => cambiar(p.id, 0)}><Trash2 /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between text-muted-foreground"><span>Productos</span><span>{items.reduce((s, i) => s + i.q, 0)} u.</span></div>
              <div className="flex items-baseline justify-between"><span className="font-medium">Total</span><span className="text-2xl font-semibold tabular-nums">{fmt.bs(total)}</span></div>
            </div>
            {cobrar.error && <Alert variant="destructive"><AlertTitle>Venta rechazada</AlertTitle><AlertDescription>{cobrar.error.message}</AlertDescription></Alert>}
            <Button size="lg" className="h-11 w-full text-base" disabled={!items.length || !cli || cobrar.isPending} onClick={() => cobrar.mutate()}>
              {cobrar.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Cobrar {items.length > 0 && fmt.bs(total)}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">Se registra solo en el servidor de esta sucursal ({yo?.bd})</p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!comprobante} onOpenChange={(o) => !o && setComprobante(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="size-5 text-success" /> Venta #{comprobante?.id_venta} registrada</DialogTitle>
            <DialogDescription>
              Sucursal {yo?.nombre} · {DEPARTAMENTOS[comprobante?.depto ?? '']} · {comprobante?.cliente}
              {comprobante?.terminal_local && ' · registrada sin red nacional (terminal local)'}
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y rounded-lg border text-sm">
            {comprobante?.items.map(({ p, q }) => (
              <div key={p.id} className="flex justify-between gap-3 px-3 py-2">
                <span>{q} × {p.nombre}</span><span className="tabular-nums">{fmt.bs(p.precio * q)}</span>
              </div>
            ))}
            <div className="flex justify-between bg-muted/50 px-3 py-2 font-semibold"><span>Total</span><span className="tabular-nums">{fmt.bs(comprobante?.total_bs)}</span></div>
          </div>
          <p className="text-xs text-muted-foreground">
            El número empieza con {yo?.num}: lo asignó esta sucursal sin consultar a ninguna otra. La venta vive en el fragmento <b>FV{yo?.num}</b> y su detalle en <b>FDV{yo?.num}</b>.
          </p>
          {comprobante && <BloqueSql sql={comprobante.sql} titulo="SQL ejecutado en la sucursal" abierto={false} />}
          <DialogFooter><Button onClick={() => setComprobante(null)}>Nueva venta</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
