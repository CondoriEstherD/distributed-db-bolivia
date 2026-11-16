import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Boxes, CheckCircle2, Loader2, Minus, PackageX, Plus, Receipt, ShoppingCart, Trash2, Wallet, WifiOff } from 'lucide-react'
import { useParams } from 'react-router'
import { toast } from 'sonner'

import { BloqueSql, Cargando, Encabezado, Error, EstadoBadge, Indicador, Seccion, Tabla } from '@/components/comunes'
import { Segmentos, Selector } from '@/components/selector'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, type ConSql, DEPARTAMENTOS, fmt, type Nodo, useEstado, useProductos } from '@/lib/api'

interface Resumen {
  sql: string; unidades: number; bajo_minimo: number
  por_departamento: { departamento: string; ventas: number; total_bs: number }[]
}
interface Venta { id_venta: number; fecha_hora: string; departamento: string; cliente: string; nit_ci: string; total_bs: number; productos: number }
interface Detalle { id_producto: number; nombre: string; cantidad: number; precio_aplicado: number; subtotal: number }
interface Inventario { id_almacen: number; almacen: string; departamento: string; id_producto: number; producto: string; categoria: string; stock_actual: number; stock_minimo: number }
interface Catalogo { id_producto: number; codigo_barras: string; nombre: string; categoria: string; precio_unitario: number }

export default function Sucursal() {
  const { cod = 'lp' } = useParams()
  const { data } = useEstado()
  const nodo = data?.nodos.find((n) => n.cod === cod)
  if (!nodo) return <Cargando />

  return (
    <>
      <Encabezado titulo={`Nodo ${nodo.num} · ${nodo.nombre}`} insignia={<EstadoBadge estado={nodo.estado} />}
        descripcion={<>
          Servidor <code className="font-mono text-xs">{nodo.servidor}</code> · <code className="font-mono text-xs">{nodo.direccion}</code> ·
          contenedor <code className="font-mono text-xs">{nodo.contenedor}</code> · base <code className="font-mono text-xs">{nodo.bd}</code>.
          Todo lo que ve aquí se lee de la base de <b>esta</b> sucursal.
        </>} />
      {nodo.en_linea ? <Contenido key={cod} nodo={nodo} /> : <SinConexion nodo={nodo} />}
    </>
  )
}

function SinConexion({ nodo }: { nodo: Nodo }) {
  const red = nodo.servidor.startsWith('vm-')
  return (
    <Seccion titulo={<span className="flex items-center gap-2"><WifiOff className="size-4 text-destructive" /> La consola no alcanza a esta sucursal</span>}
      descripcion="Desde aquí no se ven sus datos ni se pueden hacer traspasos con ella. Pero la sucursal sigue operando por su cuenta (autonomía local): sus ventas se registran en su propio servidor.">
      <p className="text-sm">
        Para demostrarlo, registre una venta directamente en el servidor de la sucursal
        {red ? <> (portal de Azure → <b>{nodo.servidor}</b> → <b>Ejecutar comando</b> → RunShellScript):</> : ':'}
      </p>
      <BloqueSql titulo="Venta local en el servidor de la sucursal" nota="bash"
        sql={`docker exec ${nodo.contenedor} psql -U rol_cajero -d ${nodo.bd} -c "SELECT * FROM venta_demo('${nodo.deptos[0]}')"`} />
      {red && (
        <p className="text-xs text-muted-foreground">
          Para restablecer: <code className="font-mono">tailscale up</code> (enlace cortado) o <code className="font-mono">docker start {nodo.contenedor}</code> (servidor apagado), en la misma pantalla del portal.
        </p>
      )}
    </Seccion>
  )
}

function Contenido({ nodo }: { nodo: Nodo }) {
  const resumen = useQuery({ queryKey: ['resumen', nodo.cod], queryFn: () => api<Resumen>(`/nodos/${nodo.cod}/resumen`) })
  const r = resumen.data
  const total = r?.por_departamento.reduce((s, d) => s + d.total_bs, 0)
  const ventas = r?.por_departamento.reduce((s, d) => s + d.ventas, 0)

  return (
    <>
      {resumen.error && <Error error={resumen.error} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Ventas de la sucursal" icono={<Receipt />} cargando={resumen.isPending} valor={fmt.n(ventas)}
          detalle={`Fragmento FV${nodo.num}`} />
        <Indicador titulo="Total vendido" icono={<Wallet />} cargando={resumen.isPending} valor={total != null ? fmt.bsCorto(total) : '—'}
          detalle={total != null ? fmt.bs(total) : undefined} />
        <Indicador titulo="Unidades en almacenes" icono={<Boxes />} cargando={resumen.isPending} valor={fmt.n(r?.unidades)}
          detalle={`Fragmento FI${nodo.num} · stock propio`} />
        <Indicador titulo="Bajo el stock mínimo" icono={<PackageX />} cargando={resumen.isPending}
          valor={<span className={r?.bajo_minimo ? 'text-amber-600' : undefined}>{fmt.n(r?.bajo_minimo)}</span>}
          detalle="Filas de inventario por reponer" />
      </div>

      <Tabs defaultValue="ventas">
        <TabsList>
          <TabsTrigger value="ventas">Ventas</TabsTrigger>
          <TabsTrigger value="inventario">Inventario</TabsTrigger>
          <TabsTrigger value="catalogo">Catálogo y precios</TabsTrigger>
          <TabsTrigger value="vender"><ShoppingCart /> Registrar venta</TabsTrigger>
        </TabsList>
        <TabsContent value="ventas" className="mt-2"><Ventas nodo={nodo} resumen={r} /></TabsContent>
        <TabsContent value="inventario" className="mt-2"><InventarioTab nodo={nodo} /></TabsContent>
        <TabsContent value="catalogo" className="mt-2"><CatalogoTab nodo={nodo} /></TabsContent>
        <TabsContent value="vender" className="mt-2"><PuntoDeVenta nodo={nodo} /></TabsContent>
      </Tabs>
    </>
  )
}

// ------------------------------------------------------------------ ventas
function Ventas({ nodo, resumen }: { nodo: Nodo; resumen?: Resumen }) {
  const [elegida, setElegida] = useState<number | null>(null)
  const ventas = useQuery({ queryKey: ['ventas', nodo.cod], queryFn: () => api<ConSql<Venta>>(`/nodos/${nodo.cod}/ventas?limite=100`) })
  const detalle = useQuery({
    queryKey: ['detalle', nodo.cod, elegida], enabled: elegida != null,
    queryFn: () => api<ConSql<Detalle>>(`/nodos/${nodo.cod}/ventas/${elegida}`),
  })

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Seccion className="xl:col-span-2" titulo="Últimas ventas"
        descripcion={<>Fragmento <b>FV{nodo.num}</b> = σ departamento ∈ {'{'}{nodo.deptos.join(', ')}{'}'} (VENTAS). Una venta de otro departamento no puede guardarse aquí (restricción CHECK). Seleccione una para ver su detalle.</>}>
        {resumen && (
          <div className="flex flex-wrap gap-2">
            {resumen.por_departamento.map((d) => (
              <Badge key={d.departamento} variant="secondary" className="gap-2 py-1">
                {DEPARTAMENTOS[d.departamento]} <span className="font-semibold">{fmt.n(d.ventas)} ventas</span> · {fmt.bsCorto(d.total_bs)}
              </Badge>
            ))}
          </div>
        )}
        {ventas.isPending ? <Cargando filas={8} /> : ventas.error ? <Error error={ventas.error} /> : (
          <>
            <Tabla datos={ventas.data.filas} buscar="Buscar por cliente, NIT o número…" porPagina={10}
              claveFila={(v) => v.id_venta} alSeleccionar={(v) => setElegida(v.id_venta)} seleccion={(v) => v.id_venta === elegida}
              columnas={[
                { clave: 'id_venta', titulo: 'N.º venta', render: (v) => <span className="font-mono text-xs">{v.id_venta}</span> },
                { clave: 'fecha_hora', titulo: 'Fecha', render: (v) => fmt.fecha(v.fecha_hora) },
                { clave: 'departamento', titulo: 'Depto.', render: (v) => <Badge variant="outline">{v.departamento}</Badge> },
                { clave: 'cliente', titulo: 'Cliente', valor: (v) => `${v.cliente} ${v.nit_ci}`,
                  render: (v) => <div><div>{v.cliente}</div><div className="text-xs text-muted-foreground">NIT {v.nit_ci}</div></div> },
                { clave: 'productos', titulo: 'Ítems', alinear: 'der' },
                { clave: 'total_bs', titulo: 'Total', alinear: 'der', render: (v) => fmt.bs(v.total_bs) },
              ]} />
            <BloqueSql sql={ventas.data.sql} nota={nodo.bd} abierto={false} />
          </>
        )}
      </Seccion>
      <Seccion titulo={elegida ? `Detalle de la venta #${elegida}` : 'Detalle de la venta'}
        descripcion={<>Fragmento derivado <b>FDV{nodo.num}</b> = DETALLE_VENTA ⋉ FV{nodo.num}: vive junto a su venta.</>}>
        {elegida == null ? <p className="py-10 text-center text-sm text-muted-foreground">Seleccione una venta de la tabla.</p>
          : detalle.isPending ? <Cargando /> : detalle.error ? <Error error={detalle.error} /> : (
            <>
              <div className="divide-y rounded-lg border">
                {detalle.data.filas.map((d) => (
                  <div key={d.id_producto} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{d.nombre}</div>
                      <div className="text-xs text-muted-foreground">{d.cantidad} × {fmt.bs(d.precio_aplicado)}</div>
                    </div>
                    <div className="tabular-nums">{fmt.bs(d.subtotal)}</div>
                  </div>
                ))}
                <div className="flex justify-between bg-muted/50 px-3 py-2 text-sm font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{fmt.bs(detalle.data.filas.reduce((s, d) => s + d.subtotal, 0))}</span>
                </div>
              </div>
              <BloqueSql sql={detalle.data.sql} nota={nodo.bd} abierto={false} />
            </>
          )}
      </Seccion>
    </div>
  )
}

// ------------------------------------------------------------------ inventario
function InventarioTab({ nodo }: { nodo: Nodo }) {
  const inv = useQuery({ queryKey: ['inventario', nodo.cod], queryFn: () => api<ConSql<Inventario>>(`/nodos/${nodo.cod}/inventario`) })
  const [almacen, setAlmacen] = useState('todos')
  const almacenes = useMemo(() => [...new Map((inv.data?.filas ?? []).map((f) => [String(f.id_almacen), f.almacen]))], [inv.data])
  const filas = (inv.data?.filas ?? []).filter((f) => almacen === 'todos' || String(f.id_almacen) === almacen)
  const maximo = Math.max(1, ...filas.map((f) => f.stock_actual))

  return (
    <Seccion titulo="Inventario de la sucursal"
      descripcion={<>Fragmento derivado <b>FI{nodo.num}</b> = INVENTARIO ⋉ almacenes de la sucursal. Los mismos productos que en las demás sucursales, con cantidades propias.</>}>
      {inv.isPending ? <Cargando filas={8} /> : inv.error ? <Error error={inv.error} /> : (
        <>
          <Segmentos valor={almacen} alCambiar={setAlmacen}
            opciones={[{ valor: 'todos', etiqueta: 'Todos los almacenes' }, ...almacenes.map(([id, n]) => ({ valor: id, etiqueta: `${id} · ${n}` }))]} />
          <Tabla datos={filas} buscar="Buscar producto o categoría…" porPagina={12} claveFila={(f) => `${f.id_almacen}-${f.id_producto}`}
            columnas={[
              { clave: 'almacen', titulo: 'Almacén', render: (f) => <span className="text-xs">{f.id_almacen} · {f.almacen}</span> },
              { clave: 'producto', titulo: 'Producto', valor: (f) => `${f.producto} ${f.categoria} ${f.id_producto}`,
                render: (f) => <div><div>{f.producto}</div><div className="text-xs text-muted-foreground">#{f.id_producto} · {f.categoria}</div></div> },
              { clave: 'stock_actual', titulo: 'Stock', ancho: '30%', render: (f) => (
                <div className="flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className={f.stock_actual < f.stock_minimo ? 'h-full bg-amber-500' : 'h-full bg-primary/70'}
                      style={{ width: `${(f.stock_actual / maximo) * 100}%` }} />
                  </div>
                  <span className="w-12 text-right tabular-nums">{fmt.n(f.stock_actual)}</span>
                </div>
              ) },
              { clave: 'stock_minimo', titulo: 'Estado', alinear: 'der', render: (f) => f.stock_actual < f.stock_minimo
                ? <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700"><AlertTriangle /> Reponer</Badge>
                : <Badge variant="outline" className="border-success/30 text-success">OK</Badge> },
            ]} />
          <BloqueSql sql={inv.data.sql} nota={nodo.bd} abierto={false} />
        </>
      )}
    </Seccion>
  )
}

// ------------------------------------------------------------------ catálogo
function CatalogoTab({ nodo }: { nodo: Nodo }) {
  const cat = useQuery({ queryKey: ['catalogo', nodo.cod], queryFn: () => api<ConSql<Catalogo>>(`/nodos/${nodo.cod}/catalogo`) })
  return (
    <Seccion titulo="Catálogo de productos (réplica)"
      descripcion={nodo.cod === 'lp' ? 'La Paz guarda el maestro del catálogo: los cambios de precio se hacen aquí y se replican a los otros 5 nodos.'
        : 'Copia del catálogo maestro de La Paz, recibida por replicación lógica. Mismos productos y precios en las 6 sucursales; aquí la escritura está revocada.'}
      acciones={<Badge variant="secondary">{nodo.cod === 'lp' ? 'Maestro' : 'Réplica de solo lectura'}</Badge>}>
      {cat.isPending ? <Cargando filas={8} /> : cat.error ? <Error error={cat.error} /> : (
        <>
          <Tabla datos={cat.data.filas} buscar="Buscar producto, categoría o código…" porPagina={12} claveFila={(p) => p.id_producto}
            columnas={[
              { clave: 'id_producto', titulo: 'ID', render: (p) => <span className="font-mono text-xs">{p.id_producto}</span> },
              { clave: 'nombre', titulo: 'Producto' },
              { clave: 'categoria', titulo: 'Categoría', render: (p) => <Badge variant="outline">{p.categoria}</Badge> },
              { clave: 'codigo_barras', titulo: 'Código de barras', render: (p) => <span className="font-mono text-xs">{p.codigo_barras}</span> },
              { clave: 'precio_unitario', titulo: 'Precio', alinear: 'der', render: (p) => fmt.bs(p.precio_unitario) },
            ]} />
          <BloqueSql sql={cat.data.sql} nota={nodo.bd} abierto={false} />
        </>
      )}
    </Seccion>
  )
}

// ------------------------------------------------------------------ punto de venta (transacción 100 % local)
function PuntoDeVenta({ nodo }: { nodo: Nodo }) {
  const cliente = useQueryClient()
  const [depto, setDepto] = useState(nodo.deptos[0])
  const [idCliente, setIdCliente] = useState<number | null>(null)
  const [carrito, setCarrito] = useState<Record<number, number>>({})
  const productos = useProductos()
  const datos = useQuery({
    queryKey: ['clientes', nodo.cod, depto],
    queryFn: () => api<{ clientes: { id_cliente: number; razon_social: string; nit_ci: string }[]; stock: Record<string, number> }>(
      `/nodos/${nodo.cod}/clientes?departamento=${depto}`),
  })
  const items = Object.entries(carrito).map(([p, q]) => ({ id_producto: Number(p), cantidad: q }))
  const precio = (p: number) => productos.data?.find((x) => x.id === p)?.precio ?? 0
  const total = items.reduce((s, i) => s + precio(i.id_producto) * i.cantidad, 0)
  const cliElegido = idCliente ?? datos.data?.clientes[0]?.id_cliente ?? null
  const sql = `SELECT registrar_venta('${depto}', ${cliElegido}, ${nodo.num * 100 + 1},\n       '${JSON.stringify(items)}'::jsonb);   -- como rol_cajero en ${nodo.bd}`

  const vender = useMutation({
    mutationFn: () => api<{ id_venta: number; total_bs: number; sql: string }>(`/nodos/${nodo.cod}/ventas`,
      { body: { departamento: depto, id_cliente: cliElegido, items } }),
    onSuccess: (r) => {
      toast.success(`Venta #${r.id_venta} registrada en ${nodo.nombre}`, { description: fmt.bs(r.total_bs) })
      setCarrito({})
      for (const k of ['resumen', 'ventas', 'inventario', 'clientes']) cliente.invalidateQueries({ queryKey: [k, nodo.cod] })
      cliente.invalidateQueries({ queryKey: ['estado'] })
    },
  })

  const cambiar = (p: number, q: number) => setCarrito((c) => {
    const n = { ...c }
    if (q <= 0) delete n[p]
    else n[p] = q
    return n
  })

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Seccion className="xl:col-span-2" titulo="Nueva venta"
        descripcion="Transacción 100 % local: usa el catálogo replicado, el cliente (FC1) y el inventario de esta sucursal. No necesita a ningún otro nodo, por eso funciona aunque la sucursal pierda la red.">
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          {nodo.deptos.length > 1 && (
            <div className="space-y-2">
              <Label>Departamento</Label>
              <Segmentos valor={depto} alCambiar={(d) => { setDepto(d); setIdCliente(null); setCarrito({}) }}
                opciones={nodo.deptos.map((d) => ({ valor: d, etiqueta: DEPARTAMENTOS[d] }))} />
            </div>
          )}
          <div className="space-y-2">
            <Label>Cliente</Label>
            <Selector valor={cliElegido} alCambiar={setIdCliente} buscar="Buscar por nombre o NIT…"
              opciones={(datos.data?.clientes ?? []).map((c) => ({ valor: c.id_cliente, etiqueta: c.razon_social, detalle: `NIT ${c.nit_ci}` }))} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Agregar producto</Label>
          <Selector limpiarAlElegir placeholder="Buscar y agregar un producto…" buscar="Nombre, categoría o código…"
            alCambiar={(p) => cambiar(p, (carrito[p] ?? 0) + 1)}
            opciones={(productos.data ?? []).map((p) => ({
              valor: p.id, etiqueta: `${p.nombre}`, grupo: p.categoria,
              detalle: `${fmt.bs(p.precio)} · stock ${fmt.n(datos.data?.stock[p.id] ?? 0)}`,
              deshabilitada: !(datos.data?.stock[p.id] ?? 0),
            }))} />
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-sm text-muted-foreground">
            <ShoppingCart className="size-6" /> Agregue productos a la venta
          </div>
        ) : (
          <div className="divide-y rounded-lg border">
            {items.map(({ id_producto: p, cantidad: q }) => {
              const prod = productos.data?.find((x) => x.id === p)
              const stock = datos.data?.stock[p] ?? 0
              return (
                <div key={p} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{prod?.nombre}</div>
                    <div className={q > stock ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                      {fmt.bs(prod?.precio)} · stock en {depto}: {fmt.n(stock)}{q > stock && ' — insuficiente'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon-sm" onClick={() => cambiar(p, q - 1)}><Minus /></Button>
                    <Input type="number" min={1} value={q} onChange={(e) => cambiar(p, Number(e.target.value))}
                      className="h-7 w-16 text-center tabular-nums" />
                    <Button variant="outline" size="icon-sm" onClick={() => cambiar(p, q + 1)}><Plus /></Button>
                  </div>
                  <div className="w-28 text-right text-sm tabular-nums">{fmt.bs((prod?.precio ?? 0) * q)}</div>
                  <Button variant="ghost" size="icon-sm" onClick={() => cambiar(p, 0)}><Trash2 /></Button>
                </div>
              )
            })}
          </div>
        )}
      </Seccion>

      <Seccion titulo="Resumen" descripcion={`Se registra en ${nodo.bd} como rol_cajero`}>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Productos</span><span>{items.length}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Unidades</span><span>{items.reduce((s, i) => s + i.cantidad, 0)}</span></div>
          <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{fmt.bs(total)}</span></div>
        </div>
        <Button className="w-full" size="lg" disabled={!items.length || !cliElegido || vender.isPending} onClick={() => vender.mutate()}>
          {vender.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Registrar venta
        </Button>
        {vender.error && (
          <Alert variant="destructive"><AlertTriangle /><AlertTitle>Venta rechazada por la base</AlertTitle>
            <AlertDescription>{vender.error.message}</AlertDescription></Alert>
        )}
        {vender.data && !vender.isPending && (
          <Alert><CheckCircle2 className="text-success" /><AlertTitle>Venta #{vender.data.id_venta} registrada</AlertTitle>
            <AlertDescription>El número empieza con {nodo.num}: lo asignó esta sucursal sin consultar a ninguna otra.</AlertDescription></Alert>
        )}
        <BloqueSql sql={sql} titulo="SQL que se enviará" />
      </Seccion>
    </div>
  )
}
