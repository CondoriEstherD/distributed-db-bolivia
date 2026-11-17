import { useQuery } from '@tanstack/react-query'
import { Activity, Boxes, Database, Receipt, Server, Workflow } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import { BloqueSql, Cargando, Encabezado, Error, EstadoBadge, Indicador, Seccion } from '@/components/comunes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, DEPARTAMENTOS, fmt, useEstado } from '@/lib/api'

const DISENO = [
  ['ventas, almacenes', 'Horizontal primaria', 'Nodo del departamento'],
  ['detalle_venta, inventario', 'Horizontal derivada', 'Junto a su venta / almacén'],
  ['clientes (FC1)', 'Vertical · datos generales', 'Nodos 1 a 6'],
  ['clientes (FC2)', 'Vertical · datos financieros', 'Solo Nodo 1'],
  ['productos_catalogo', 'Replicación total', 'Maestro en Nodo 1'],
  ['traspasos_log', 'Registro del 2PC', 'Nodo 3'],
]

interface FilaC1 { departamento_id: string; ventas: number; total_bs: number }

export default function Panorama() {
  const { data, isPending, error } = useEstado()
  const nodos = data?.nodos ?? []
  const enLinea = nodos.filter((n) => n.en_linea).length
  const ventas = nodos.reduce((s, n) => s + (n.ventas ?? 0), 0)
  const duda = nodos.reduce((s, n) => s + (n['2pc_pendientes'] ?? 0), 0)
  const replicas = nodos.filter((n) => n.replicacion === 'suscripción activa').length

  const consultas = useQuery({ queryKey: ['consultas'], queryFn: () => api<{ id: string; sql: string }[]>('/consultas') })
  const c1 = useQuery({
    queryKey: ['c1'], enabled: enLinea === 6,
    queryFn: () => api<{ filas: FilaC1[]; ms: number }>('/consultas/C1', { body: { plan: false } }),
  })

  return (
    <>
      <Encabezado titulo="Panorama nacional"
        descripcion="Sistema de Gestión Logística Nacional: una base de datos lógica repartida en 6 servidores PostgreSQL 16, uno por región. Fragmentación horizontal y vertical, replicación lógica del catálogo, consultas distribuidas con postgres_fdw y traspasos con compromiso en dos fases." />

      {error && <Error error={error} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Nodos en línea" icono={<Server />} cargando={isPending}
          valor={<span className={enLinea < 6 ? 'text-destructive' : undefined}>{enLinea} / 6</span>}
          detalle={enLinea < 6 ? 'Hay sucursales sin conexión' : 'Todas las sucursales responden'} />
        <Indicador titulo="Ventas registradas" icono={<Receipt />} cargando={isPending} valor={fmt.n(ventas)}
          detalle={enLinea < 6 ? `Suma de los ${enLinea} nodos que responden` : 'Suma de los 6 fragmentos'} />
        <Indicador titulo="Réplicas del catálogo" icono={<Workflow />} cargando={isPending} valor={`${replicas} / 5`}
          detalle="Suscripciones activas a La Paz" />
        <Indicador titulo="Transacciones 2PC en duda" icono={<Activity />} cargando={isPending}
          valor={<span className={duda ? 'text-destructive' : undefined}>{duda}</span>}
          detalle={duda ? 'Requieren recuperación' : 'Ninguna transacción pendiente'} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Servidores por sucursal</h2>
        {isPending ? <Cargando filas={3} /> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {nodos.map((n) => (
              <Card key={n.cod} className="transition-shadow hover:shadow-md">
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">Nodo {n.num} · {n.nombre}</CardTitle>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{n.servidor} · {n.direccion}</p>
                  </div>
                  <EstadoBadge estado={n.estado} />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-1.5">
                    {n.deptos.map((d) => <Badge key={d} variant="secondary">{d} · {DEPARTAMENTOS[d]}</Badge>)}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Ventas (fragmento local)</p>
                      <p className="text-lg font-semibold tabular-nums">{fmt.n(n.ventas)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">2PC en duda</p>
                      <p className="text-lg font-semibold tabular-nums">{n['2pc_pendientes'] ?? '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t pt-3 text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground"><Database className="size-3.5" />{n.replicacion}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Seccion className="lg:col-span-3" titulo="Ventas por departamento"
          descripcion={c1.data ? `Consulta global C1 desde La Paz · ${c1.data.ms} ms · cada nodo calcula su propio total`
            : 'Consulta global C1 desde La Paz'}>
          {enLinea < 6 && !isPending ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              La consulta nacional necesita los 6 fragmentos. Use la consulta tolerante (C7) en «Consultas distribuidas».
            </p>
          ) : c1.isPending ? <Cargando /> : c1.error ? <Error error={c1.error} /> : (
            <ChartContainer className="h-72 w-full" config={{ total_bs: { label: 'Total vendido', color: 'var(--chart-1)' } }}>
              <BarChart data={c1.data.filas.map((f) => ({ ...f, nombre: DEPARTAMENTOS[f.departamento_id] }))}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="nombre" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={70}
                  tickFormatter={(v: number) => `${(v / 1e6).toLocaleString('es-BO')} M`} />
                <ChartTooltip content={<ChartTooltipContent formatter={(v) => fmt.bs(Number(v))} />} />
                <Bar dataKey="total_bs" fill="var(--color-total_bs)" radius={[6, 6, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
          )}
          {consultas.data && <BloqueSql sql={consultas.data.find((c) => c.id === 'C1')?.sql ?? ''} titulo="SQL enviado al Nodo 1" abierto={false} />}
        </Seccion>

        <Seccion className="lg:col-span-2" titulo="Diseño de distribución" descripcion="Dónde vive cada relación">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Relación</TableHead><TableHead>Técnica</TableHead><TableHead>Ubicación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DISENO.map(([r, t, u]) => (
                <TableRow key={r}>
                  <TableCell className="font-mono text-xs whitespace-normal">{r}</TableCell>
                  <TableCell className="text-xs whitespace-normal">{t}</TableCell>
                  <TableCell className="text-xs whitespace-normal text-muted-foreground">{u}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <Boxes className="mt-0.5 size-4 shrink-0" />
            Cada sucursal guarda su propio stock; todas tienen los mismos productos y precios (réplica del catálogo).
          </div>
        </Seccion>
      </div>
    </>
  )
}
