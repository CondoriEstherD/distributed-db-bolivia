// Pantallas de la sucursal (usuario de la sesión): historial de ventas, clientes e inventario.
// Todo se lee del servidor de la propia sucursal: sus fragmentos de la base distribuida.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Boxes, Info, PackageX, Receipt, ShieldCheck, Users, Wallet } from 'lucide-react'

import { BloqueSql, Cargando, Encabezado, Error, Indicador, Seccion, Tabla } from '@/components/comunes'
import { Segmentos } from '@/components/selector'
import { Badge } from '@/components/ui/badge'
import { api, type ConSql, DEPARTAMENTOS, fmt, foto, useEstado, useSesion } from '@/lib/api'

interface Resumen { sql: string; unidades: number; bajo_minimo: number; por_departamento: { departamento: string; ventas: number; total_bs: number }[] }
interface Venta { id_venta: number; fecha_hora: string; departamento: string; cliente: string; nit_ci: string; total_bs: number; productos: number }
interface Detalle { id_producto: number; nombre: string; cantidad: number; precio_aplicado: number; subtotal: number }
interface Cliente { id_cliente: number; nit_ci: string; razon_social: string; telefono: string | null; direccion: string | null; departamento_id: string; compras: number; total_bs: number; ultima_compra: string | null }
interface Inv { id_almacen: number; almacen: string; departamento: string; id_producto: number; producto: string; categoria: string; stock_actual: number; stock_minimo: number }

function useMiSucursal() {
  const cod = useSesion().data!.sucursal!
  const nodo = useEstado().data?.nodos.find((n) => n.cod === cod)
  return { cod, nodo }
}

function Fragmento({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-primary/15 bg-accent/60 px-3 py-2 text-xs text-accent-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" /><span>{children}</span>
    </div>
  )
}

// ------------------------------------------------------------------ historial de ventas
export function Ventas() {
  const { cod, nodo } = useMiSucursal()
  const [elegida, setElegida] = useState<number | null>(null)
  const resumen = useQuery({ queryKey: ['resumen', cod], queryFn: () => api<Resumen>(`/nodos/${cod}/resumen`) })
  const ventas = useQuery({ queryKey: ['ventas', cod], queryFn: () => api<ConSql<Venta>>(`/nodos/${cod}/ventas?limite=200`) })
  const detalle = useQuery({ queryKey: ['detalle', cod, elegida], enabled: elegida != null,
    queryFn: () => api<ConSql<Detalle>>(`/nodos/${cod}/ventas/${elegida}`) })
  const r = resumen.data
  const total = r?.por_departamento.reduce((s, d) => s + d.total_bs, 0)
  const n = r?.por_departamento.reduce((s, d) => s + d.ventas, 0)
  const sel = ventas.data?.filas.find((v) => v.id_venta === elegida)

  return (
    <>
      <Encabezado titulo="Historial de ventas" descripcion={`Ventas registradas por la sucursal ${nodo?.nombre ?? ''}.`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Ventas" icono={<Receipt />} cargando={resumen.isPending} valor={fmt.n(n)} />
        <Indicador titulo="Total vendido" icono={<Wallet />} cargando={resumen.isPending} valor={total != null ? fmt.bsCorto(total) : '—'} detalle={fmt.bs(total)} />
        {(r?.por_departamento ?? []).map((d) => (
          <Indicador key={d.departamento} titulo={DEPARTAMENTOS[d.departamento]} icono={<Receipt />} valor={fmt.n(d.ventas)} detalle={fmt.bs(d.total_bs)} />
        ))}
      </div>
      <Fragmento>
        Estas ventas son el fragmento <b>FV{nodo?.num}</b> = ventas de {nodo?.deptos.map((d) => DEPARTAMENTOS[d]).join(' y ')}, guardado solo en el servidor de esta sucursal ({nodo?.bd}).
        El detalle de cada venta (<b>FDV{nodo?.num}</b>) vive junto a ella. Las ventas de otros departamentos no están aquí.
      </Fragmento>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Seccion titulo="Ventas" descripcion="Seleccione una venta para ver su comprobante">
          {ventas.isPending ? <Cargando filas={8} /> : ventas.error ? <Error error={ventas.error} /> : (
            <>
              <Tabla datos={ventas.data.filas} buscar="Buscar cliente, NIT o número…" porPagina={12} claveFila={(v) => v.id_venta}
                alSeleccionar={(v) => setElegida(v.id_venta)} seleccion={(v) => v.id_venta === elegida}
                columnas={[
                  { clave: 'id_venta', titulo: 'N.º', render: (v) => <span className="font-mono text-xs">{v.id_venta}</span> },
                  { clave: 'fecha_hora', titulo: 'Fecha', render: (v) => fmt.fecha(v.fecha_hora) },
                  { clave: 'cliente', titulo: 'Cliente', valor: (v) => `${v.cliente} ${v.nit_ci}`,
                    render: (v) => <div><div className="font-medium">{v.cliente}</div><div className="text-xs text-muted-foreground">NIT {v.nit_ci} · {DEPARTAMENTOS[v.departamento]}</div></div> },
                  { clave: 'productos', titulo: 'Ítems', alinear: 'der' },
                  { clave: 'total_bs', titulo: 'Total', alinear: 'der', render: (v) => <b>{fmt.bs(v.total_bs)}</b> },
                ]} />
              <BloqueSql sql={ventas.data.sql} nota={nodo?.bd} abierto={false} />
            </>
          )}
        </Seccion>
        <Seccion titulo={elegida ? `Comprobante #${elegida}` : 'Comprobante'}>
          {elegida == null ? <p className="py-12 text-center text-sm text-muted-foreground">Seleccione una venta.</p>
            : detalle.isPending ? <Cargando /> : detalle.error ? <Error error={detalle.error} /> : (
              <>
                {sel && <div className="text-sm"><div className="font-medium">{sel.cliente}</div><div className="text-xs text-muted-foreground">NIT {sel.nit_ci} · {fmt.fecha(sel.fecha_hora)}</div></div>}
                <div className="divide-y rounded-lg border">
                  {detalle.data.filas.map((d) => (
                    <div key={d.id_producto} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <img src={foto(d.id_producto)} alt="" className="size-10 rounded-md object-cover" />
                      <div className="min-w-0 flex-1"><div className="truncate font-medium">{d.nombre}</div>
                        <div className="text-xs text-muted-foreground">{d.cantidad} × {fmt.bs(d.precio_aplicado)}</div></div>
                      <div className="tabular-nums">{fmt.bs(d.subtotal)}</div>
                    </div>
                  ))}
                  <div className="flex justify-between bg-muted/50 px-3 py-2 font-semibold"><span>Total</span>
                    <span className="tabular-nums">{fmt.bs(detalle.data.filas.reduce((s, d) => s + d.subtotal, 0))}</span></div>
                </div>
                <BloqueSql sql={detalle.data.sql} nota={nodo?.bd} abierto={false} />
              </>
            )}
        </Seccion>
      </div>
    </>
  )
}

// ------------------------------------------------------------------ clientes (FC1)
export function Clientes() {
  const { cod, nodo } = useMiSucursal()
  const q = useQuery({ queryKey: ['clientes-lista', cod], queryFn: () => api<ConSql<Cliente>>(`/nodos/${cod}/clientes-lista`) })
  const filas = q.data?.filas ?? []
  return (
    <>
      <Encabezado titulo="Clientes" descripcion={`Clientes registrados en la sucursal ${nodo?.nombre ?? ''}.`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador titulo="Clientes" icono={<Users />} cargando={q.isPending} valor={fmt.n(filas.length)} />
        <Indicador titulo="Con compras" icono={<Receipt />} cargando={q.isPending} valor={fmt.n(filas.filter((c) => c.compras > 0).length)} />
        <Indicador titulo="Datos de crédito" icono={<ShieldCheck />} valor="Solo en La Paz" detalle="Fragmento FC2" />
      </div>
      <Fragmento>
        Aquí solo están los <b>datos generales</b> del cliente (fragmento vertical <b>FC1</b>: NIT, razón social, teléfono, dirección), y solo de {nodo?.deptos.map((d) => DEPARTAMENTOS[d]).join(' y ')} (fragmentación horizontal).
        El límite de crédito, el saldo y la calificación de riesgo (<b>FC2</b>) se guardan únicamente en La Paz, por auditoría: esta sucursal no los ve.
      </Fragmento>
      <Seccion titulo="Cartera de clientes">
        {q.isPending ? <Cargando filas={8} /> : q.error ? <Error error={q.error} /> : (
          <>
            <Tabla datos={filas} buscar="Buscar por nombre, NIT o teléfono…" porPagina={15} claveFila={(c) => c.id_cliente}
              columnas={[
                { clave: 'razon_social', titulo: 'Cliente', valor: (c) => `${c.razon_social} ${c.nit_ci} ${c.telefono ?? ''}`,
                  render: (c) => <div><div className="font-medium">{c.razon_social}</div><div className="text-xs text-muted-foreground">NIT {c.nit_ci}</div></div> },
                { clave: 'telefono', titulo: 'Teléfono', render: (c) => c.telefono ?? '—' },
                { clave: 'direccion', titulo: 'Dirección', render: (c) => <span className="text-xs">{c.direccion ?? '—'}</span> },
                { clave: 'departamento_id', titulo: 'Depto.', render: (c) => <Badge variant="outline">{c.departamento_id}</Badge> },
                { clave: 'compras', titulo: 'Compras', alinear: 'der' },
                { clave: 'total_bs', titulo: 'Total comprado', alinear: 'der', render: (c) => fmt.bs(c.total_bs) },
                { clave: 'ultima_compra', titulo: 'Última compra', render: (c) => <span className="text-xs">{fmt.fecha(c.ultima_compra)}</span> },
              ]} />
            <BloqueSql sql={q.data.sql} nota={nodo?.bd} abierto={false} />
          </>
        )}
      </Seccion>
    </>
  )
}

// ------------------------------------------------------------------ inventario (FI)
export function Inventario() {
  const { cod, nodo } = useMiSucursal()
  const inv = useQuery({ queryKey: ['inventario', cod], queryFn: () => api<ConSql<Inv>>(`/nodos/${cod}/inventario`) })
  const [almacen, setAlmacen] = useState('todos')
  const almacenes = useMemo(() => [...new Map((inv.data?.filas ?? []).map((f) => [String(f.id_almacen), f.almacen]))], [inv.data])
  const filas = (inv.data?.filas ?? []).filter((f) => almacen === 'todos' || String(f.id_almacen) === almacen)
  const maximo = Math.max(1, ...filas.map((f) => f.stock_actual))
  const bajos = filas.filter((f) => f.stock_actual < f.stock_minimo).length

  return (
    <>
      <Encabezado titulo="Inventario" descripcion={`Stock de los almacenes de la sucursal ${nodo?.nombre ?? ''}.`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador titulo="Unidades en stock" icono={<Boxes />} cargando={inv.isPending} valor={fmt.n(filas.reduce((s, f) => s + f.stock_actual, 0))} />
        <Indicador titulo="Almacenes" icono={<Boxes />} cargando={inv.isPending} valor={almacenes.length} />
        <Indicador titulo="Por reponer" icono={<PackageX />} cargando={inv.isPending} valor={<span className={bajos ? 'text-amber-600' : undefined}>{fmt.n(bajos)}</span>} detalle="Bajo el stock mínimo" />
      </div>
      <Fragmento>
        Fragmento derivado <b>FI{nodo?.num}</b>: el inventario de cada almacén vive en el servidor de su sucursal. Todas las sucursales tienen los mismos productos, pero cada una con su propio stock.
      </Fragmento>
      <Seccion titulo="Existencias" acciones={
        <Segmentos valor={almacen} alCambiar={setAlmacen}
          opciones={[{ valor: 'todos', etiqueta: 'Todos' }, ...almacenes.map(([id, nombre]) => ({ valor: id, etiqueta: nombre }))]} />}>
        {inv.isPending ? <Cargando filas={8} /> : inv.error ? <Error error={inv.error} /> : (
          <>
            <Tabla datos={filas} buscar="Buscar producto o categoría…" porPagina={12} claveFila={(f) => `${f.id_almacen}-${f.id_producto}`}
              columnas={[
                { clave: 'producto', titulo: 'Producto', valor: (f) => `${f.producto} ${f.categoria}`,
                  render: (f) => <div className="flex items-center gap-3"><img src={foto(f.id_producto)} alt="" className="size-9 rounded-md object-cover" />
                    <div><div className="font-medium">{f.producto}</div><div className="text-xs text-muted-foreground">{f.categoria}</div></div></div> },
                { clave: 'almacen', titulo: 'Almacén', render: (f) => <span className="text-xs">{f.almacen}</span> },
                { clave: 'stock_actual', titulo: 'Stock', ancho: '28%', render: (f) => (
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className={f.stock_actual < f.stock_minimo ? 'h-full bg-amber-500' : 'h-full bg-primary/70'} style={{ width: `${(f.stock_actual / maximo) * 100}%` }} />
                    </div>
                    <span className="w-12 text-right tabular-nums">{fmt.n(f.stock_actual)}</span>
                  </div>) },
                { clave: 'stock_minimo', titulo: 'Estado', alinear: 'der', render: (f) => f.stock_actual < f.stock_minimo
                  ? <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700"><AlertTriangle /> Reponer</Badge>
                  : <Badge variant="outline" className="border-success/30 text-success">OK</Badge> },
              ]} />
            <BloqueSql sql={inv.data.sql} nota={nodo?.bd} abierto={false} />
          </>
        )}
      </Seccion>
    </>
  )
}
