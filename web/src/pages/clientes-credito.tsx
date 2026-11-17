import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CreditCard, Landmark, ShieldCheck, Users } from 'lucide-react'

import { BloqueSql, Cargando, Encabezado, Error, Indicador, Seccion, Tabla } from '@/components/comunes'
import { Badge } from '@/components/ui/badge'
import { api, type ConSql, DEPARTAMENTOS, fmt } from '@/lib/api'

interface Credito { id_cliente: number; nit_ci: string; razon_social: string; departamento_id: string; limite_credito: number; saldo_pendiente: number; calificacion_riesgo: string; estado_credito: string }

const RIESGO: Record<string, string> = { A: 'border-success/30 bg-success/10 text-success', B: 'border-sky-300 bg-sky-50 text-sky-700', C: 'border-amber-300 bg-amber-50 text-amber-700', D: 'border-destructive/30 bg-destructive/10 text-destructive', E: 'border-destructive bg-destructive text-white' }
const ESTADO: Record<string, string> = { ACTIVO: 'text-success', SUSPENDIDO: 'text-amber-600', MOROSO: 'text-destructive font-medium' }

export default function ClientesCredito() {
  const q = useQuery({ queryKey: ['credito'], queryFn: () => api<ConSql<Credito>>('/central/clientes') })
  const f = q.data?.filas ?? []
  const saldo = f.reduce((s, c) => s + Number(c.saldo_pendiente), 0)
  const limite = f.reduce((s, c) => s + Number(c.limite_credito), 0)

  return (
    <>
      <Encabezado titulo="Clientes y crédito"
        descripcion="Ficha crediticia completa de los clientes con línea de crédito. Solo la administración central la ve: los datos financieros se guardan únicamente en La Paz por auditoría y regulación de crédito." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Clientes con crédito" icono={<Users />} cargando={q.isPending} valor={fmt.n(f.length)} />
        <Indicador titulo="Crédito otorgado" icono={<CreditCard />} cargando={q.isPending} valor={fmt.bsCorto(limite)} detalle={fmt.bs(limite)} />
        <Indicador titulo="Saldo por cobrar" icono={<Landmark />} cargando={q.isPending} valor={fmt.bsCorto(saldo)} detalle={fmt.bs(saldo)} />
        <Indicador titulo="Riesgo alto (D y E)" icono={<AlertTriangle />} cargando={q.isPending}
          valor={fmt.n(f.filter((c) => ['D', 'E'].includes(c.calificacion_riesgo)).length)}
          detalle={`${fmt.n(f.filter((c) => c.estado_credito === 'MOROSO').length)} en mora`} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4 text-sm">
          <div className="mb-1 flex items-center gap-2 font-medium"><Users className="size-4" /> FC1 · Datos generales</div>
          <p className="text-muted-foreground">NIT, razón social, teléfono y dirección. Fragmentado por departamento: cada sucursal guarda los suyos y los usa para facturar.</p>
        </div>
        <div className="rounded-lg border border-primary/30 bg-accent/50 p-4 text-sm">
          <div className="mb-1 flex items-center gap-2 font-medium"><ShieldCheck className="size-4" /> FC2 · Datos financieros (solo La Paz)</div>
          <p className="text-muted-foreground">Límite de crédito, saldo pendiente, calificación de riesgo y estado del crédito. Las sucursales no los guardan ni los ven.</p>
        </div>
      </div>
      <Seccion titulo="Cartera de crédito" descripcion="Reconstrucción de la fragmentación vertical: CLIENTES = FC1 (6 nodos, vía postgres_fdw) ⋈ FC2 (La Paz)">
        {q.isPending ? <Cargando filas={8} /> : q.error ? <Error error={q.error} /> : (
          <>
            <Tabla datos={f} buscar="Buscar cliente o NIT…" porPagina={15} claveFila={(c) => c.id_cliente} columnas={[
              { clave: 'razon_social', titulo: 'Cliente', valor: (c) => `${c.razon_social} ${c.nit_ci}`,
                render: (c) => <div><div className="font-medium">{c.razon_social}</div><div className="text-xs text-muted-foreground">NIT {c.nit_ci}</div></div> },
              { clave: 'departamento_id', titulo: 'Sucursal', render: (c) => <Badge variant="outline">{DEPARTAMENTOS[c.departamento_id]}</Badge> },
              { clave: 'limite_credito', titulo: 'Límite', alinear: 'der', render: (c) => fmt.bs(Number(c.limite_credito)) },
              { clave: 'saldo_pendiente', titulo: 'Saldo', alinear: 'der', render: (c) => {
                const uso = Number(c.saldo_pendiente) / Math.max(1, Number(c.limite_credito))
                return <div><div>{fmt.bs(Number(c.saldo_pendiente))}</div>
                  <div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded-full bg-muted"><div className={uso > 0.8 ? 'h-full bg-destructive' : 'h-full bg-primary/70'} style={{ width: `${Math.min(100, uso * 100)}%` }} /></div></div>
              } },
              { clave: 'calificacion_riesgo', titulo: 'Riesgo', alinear: 'centro', render: (c) => <Badge variant="outline" className={RIESGO[c.calificacion_riesgo]}>{c.calificacion_riesgo}</Badge> },
              { clave: 'estado_credito', titulo: 'Estado', render: (c) => <span className={`text-xs ${ESTADO[c.estado_credito] ?? ''}`}>{c.estado_credito}</span> },
            ]} />
            <BloqueSql sql={q.data.sql} titulo="SQL en La Paz (rol_auditor)" abierto={false} />
          </>
        )}
      </Seccion>
    </>
  )
}
