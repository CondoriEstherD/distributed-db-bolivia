import { useQuery } from '@tanstack/react-query'

import { BloqueSql, Cargando, Error, Seccion, Tabla } from '@/components/comunes'
import { Badge } from '@/components/ui/badge'
import { api, type ConSql, fmt, useProductos } from '@/lib/api'
import Recuperacion from '@/pages/recuperacion'

interface Log { gid: string; origen: string; destino: string; id_almacen_origen: number; id_almacen_destino: number; items: Record<string, number>; estado: string; detalle: string | null; creado_en: string }

export default function Auditoria() {
  const productos = useProductos()
  const log = useQuery({ queryKey: ['log2pc'], queryFn: () => api<ConSql<Log>>('/traspasos/log'), refetchInterval: 10_000 })
  const nombre = (p: string) => productos.data?.find((x) => x.id === Number(p))?.nombre ?? `#${p}`
  return (
    <>
      <Recuperacion />
      <Seccion titulo="Registro de decisiones del coordinador"
        descripcion="traspasos_log en el Nodo 3 (Cochabamba, hub de traspasos). La decisión COMMIT escrita aquí es el punto irrevocable del protocolo; la recuperación decide con este registro.">
        {log.isPending ? <Cargando /> : log.error ? <Error error={log.error} titulo="Nodo 3 sin conexión" /> : (
          <>
            <Tabla datos={log.data.filas} buscar="Buscar gid, sucursal o motivo…" porPagina={10} claveFila={(l) => l.gid} columnas={[
              { clave: 'creado_en', titulo: 'Fecha', render: (l) => fmt.fecha(l.creado_en) },
              { clave: 'gid', titulo: 'Transacción global', render: (l) => <span className="font-mono text-xs">{l.gid}</span> },
              { clave: 'ruta', titulo: 'Ruta', valor: (l) => `${l.origen} ${l.destino}`,
                render: (l) => <span className="text-xs font-medium">{l.id_almacen_origen} ({l.origen.toUpperCase()}) → {l.id_almacen_destino} ({l.destino.toUpperCase()})</span> },
              { clave: 'items', titulo: 'Productos', render: (l) => <span className="text-xs">{Object.entries(l.items ?? {}).map(([p, q]) => `${q} × ${nombre(p)}`).join(', ')}</span> },
              { clave: 'estado', titulo: 'Decisión', render: (l) => (
                <Badge variant="outline" className={l.estado === 'COMMIT' ? 'border-success/30 bg-success/10 text-success'
                  : l.estado === 'ABORTADO' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-amber-300 text-amber-700'}>{l.estado}</Badge>) },
              { clave: 'detalle', titulo: 'Motivo', render: (l) => <span className="text-xs text-muted-foreground">{l.detalle ?? '—'}</span> },
            ]} />
            <BloqueSql sql={log.data.sql} nota="bd_cb" abierto={false} />
          </>
        )}
      </Seccion>
    </>
  )
}
