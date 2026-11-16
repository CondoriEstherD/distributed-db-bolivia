import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Clock, Layers, Loader2, Play, ShieldCheck } from 'lucide-react'

import { BloqueSql, Cargando, Encabezado, Error, Seccion, Tabla } from '@/components/comunes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api, fmt } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Consulta { id: string; titulo: string; rol: string; sql: string }
interface Resultado { filas: Record<string, unknown>[]; ms: number; plan?: string; fragmentos?: string[] }

const formatear = (v: unknown) => {
  if (v == null) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? fmt.n(v) : v.toLocaleString('es-BO', { maximumFractionDigits: 2 })
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmt.fecha(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function Consultas() {
  const lista = useQuery({ queryKey: ['consultas'], queryFn: () => api<Consulta[]>('/consultas') })
  const [id, setId] = useState('C1')
  const [plan, setPlan] = useState(true)
  const ejec = useMutation({ mutationFn: (v: { id: string; plan: boolean }) => api<Resultado>(`/consultas/${v.id}`, { body: { plan: v.plan } }) })
  const c = lista.data?.find((x) => x.id === id)
  const columnas = ejec.data?.filas[0] ? Object.keys(ejec.data.filas[0]) : []

  return (
    <>
      <Encabezado titulo="Consultas distribuidas"
        descripcion="El analista consulta el esquema «nacional» del Nodo 1 sin indicar nodos: las particiones remotas (postgres_fdw) ocultan dónde está cada fragmento. Es la transparencia de ubicación y de fragmentación." />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Seccion titulo="Consultas de referencia" className="h-fit">
          {lista.isPending ? <Cargando /> : (
            <div className="-mx-2 space-y-1">
              {lista.data?.map((x) => (
                <button key={x.id} type="button" onClick={() => { setId(x.id); ejec.reset() }}
                  className={cn('w-full rounded-md px-2 py-2 text-left text-sm transition-colors',
                    x.id === id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                  <span className="font-semibold">{x.id}</span> · {x.titulo}
                </button>
              ))}
            </div>
          )}
        </Seccion>

        <div className="space-y-4">
          {c && (
            <Seccion titulo={`${c.id} · ${c.titulo}`}
              acciones={<Badge variant="secondary" className="gap-1"><ShieldCheck /> {c.rol}</Badge>}>
              <BloqueSql sql={c.sql} titulo="SQL enviado al Nodo 1 (La Paz)" />
              <div className="flex flex-wrap items-center gap-4">
                <Button onClick={() => ejec.mutate({ id, plan })} disabled={ejec.isPending}>
                  {ejec.isPending ? <Loader2 className="animate-spin" /> : <Play />} Ejecutar consulta
                </Button>
                <div className="flex items-center gap-2">
                  <Switch id="plan" checked={plan} onCheckedChange={setPlan} />
                  <Label htmlFor="plan">Mostrar plan de ejecución (fragmentos consultados)</Label>
                </div>
              </div>
            </Seccion>
          )}

          {ejec.error && (
            <>
              <Error error={ejec.error} titulo="La consulta falló" />
              <p className="text-xs text-muted-foreground">Si un nodo está caído, pruebe C6 (solo Santa Cruz: no lo necesita) o C7 (resumen tolerante a fallos).</p>
            </>
          )}
          {ejec.data && (
            <>
              <Seccion titulo="Resultado"
                acciones={<Badge variant="outline" className="gap-1"><Clock /> {fmt.n(ejec.data.filas.length)} filas · {fmt.n(ejec.data.ms)} ms</Badge>}>
                <Tabla datos={ejec.data.filas} porPagina={10}
                  columnas={columnas.map((k) => ({
                    clave: k, titulo: k.replaceAll('_', ' '),
                    alinear: typeof ejec.data.filas[0][k] === 'number' ? 'der' as const : 'izq' as const,
                    render: (f: Record<string, unknown>) => {
                      const v = f[k]
                      if (k === 'estado' && typeof v === 'string')
                        return <Badge variant="outline" className={v.startsWith('EN') ? 'text-success' : 'text-destructive'}>{v}</Badge>
                      return formatear(v)
                    },
                  }))} />
              </Seccion>
              {ejec.data.plan && (
                <Seccion titulo={<span className="flex items-center gap-2"><Layers className="size-4" /> Fragmentos que consultó el optimizador</span>}
                  descripcion="Prefijo f…N_xx = fragmento remoto del nodo N (vía postgres_fdw) · sin prefijo = tabla local de La Paz">
                  <div className="flex flex-wrap gap-2">
                    {ejec.data.fragmentos?.length ? ejec.data.fragmentos.map((f) => (
                      <Badge key={f} variant="secondary" className="font-mono">{f}</Badge>
                    )) : <span className="text-sm text-muted-foreground">—</span>}
                  </div>
                  <BloqueSql sql={ejec.data.plan} titulo="EXPLAIN (VERBOSE, COSTS OFF)" abierto={false} />
                </Seccion>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
