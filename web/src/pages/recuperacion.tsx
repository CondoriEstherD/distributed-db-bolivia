import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, HeartPulse, Hourglass, Loader2, Zap } from 'lucide-react'

import { BloqueSql, Cargando, Encabezado, Error, Seccion, Tabla } from '@/components/comunes'
import { Segmentos } from '@/components/selector'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { api, fmt } from '@/lib/api'

interface EnDuda { nodo: string; gid: string | null; preparada: string | null; sin_conexion: boolean }

export default function Recuperacion() {
  const cliente = useQueryClient()
  const [momento, setMomento] = useState<'preparado' | 'decision'>('preparado')
  const [edad, setEdad] = useState(0)
  const duda = useQuery({ queryKey: ['en-duda'], queryFn: () => api<EnDuda[]>('/recuperacion/en-duda'), refetchInterval: 5_000 })
  const refrescar = () => { cliente.invalidateQueries({ queryKey: ['en-duda'] }); cliente.invalidateQueries({ queryKey: ['estado'] }) }
  const simular = useMutation({
    mutationFn: () => api<{ salida: string; cayo: boolean }>('/recuperacion/simular', { body: { momento } }), onSettled: refrescar,
  })
  const recuperar = useMutation({
    mutationFn: () => api<{ mensajes: string[] }>('/recuperacion/recuperar', { body: { edad_minima: edad } }), onSettled: refrescar,
  })
  const pendientes = (duda.data ?? []).filter((d) => d.gid)
  const sinConexion = (duda.data ?? []).filter((d) => d.sin_conexion)

  return (
    <>
      <Encabezado titulo="Recuperación de transacciones 2PC"
        descripcion="Si el coordinador cae entre las dos fases, los participantes quedan con transacciones PREPARADAS que bloquean filas («en duda»). La recuperación consulta la decisión en traspasos_log (Nodo 3): si dice COMMIT confirma; si no, revierte (presunción de aborto)." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="1 · Simular la caída del coordinador"
          descripcion="Lanza un traspaso de 7 unidades del producto 11 (almacén 201 Santa Cruz → 601 Beni) y detiene el coordinador a mitad del protocolo.">
          <div className="space-y-2">
            <Label>Momento de la caída</Label>
            <Segmentos valor={momento} alCambiar={setMomento} opciones={[
              { valor: 'preparado', etiqueta: 'Tras PREPARE (sin decisión)' },
              { valor: 'decision', etiqueta: 'Tras decidir COMMIT' },
            ]} />
            <p className="text-xs text-muted-foreground">
              {momento === 'preparado' ? 'No hay COMMIT en el log: la recuperación hará ROLLBACK PREPARED en ambos (presunción de aborto).'
                : 'El COMMIT ya está en el log: la recuperación hará COMMIT PREPARED en ambos.'}
            </p>
          </div>
          <Button onClick={() => simular.mutate()} disabled={simular.isPending}>
            {simular.isPending ? <Loader2 className="animate-spin" /> : <Zap />} Lanzar traspaso y hacer caer el coordinador
          </Button>
          {simular.error && <Error error={simular.error} />}
          {simular.data && (
            <>
              {simular.data.cayo && (
                <Alert className="border-amber-300 bg-amber-50 text-amber-900"><Hourglass /><AlertTitle>El coordinador cayó</AlertTitle>
                  <AlertDescription>Quedaron transacciones en duda en Santa Cruz y Beni, con sus filas bloqueadas.</AlertDescription></Alert>
              )}
              <BloqueSql titulo="Salida del coordinador" nota="texto" sql={simular.data.salida} />
            </>
          )}
        </Seccion>

        <Seccion titulo="2 · Resolver las transacciones en duda">
          <div className="space-y-3">
            <div className="flex justify-between text-sm"><Label>Resolver solo las preparadas hace más de</Label><span className="tabular-nums text-muted-foreground">{edad} s</span></div>
            <Slider min={0} max={120} step={5} value={[edad]} onValueChange={(v) => setEdad(Array.isArray(v) ? v[0] : v)} />
            <p className="text-xs text-muted-foreground">En producción se deja un margen para no interferir con traspasos en curso.</p>
          </div>
          <Button variant="outline" onClick={() => recuperar.mutate()} disabled={recuperar.isPending}>
            {recuperar.isPending ? <Loader2 className="animate-spin" /> : <HeartPulse />} Ejecutar recuperación
          </Button>
          {recuperar.error && <Error error={recuperar.error} />}
          {recuperar.data && (
            <>
              <Alert><CheckCircle2 className="text-success" /><AlertTitle>{recuperar.data.mensajes.length} acciones de recuperación</AlertTitle></Alert>
              <BloqueSql titulo="Acciones" nota="texto" sql={recuperar.data.mensajes.join('\n')} />
            </>
          )}
        </Seccion>
      </div>

      <Seccion titulo="Transacciones preparadas en cada nodo" descripcion="pg_prepared_xacts · se actualiza cada 5 s">
        {duda.isPending ? <Cargando /> : duda.error ? <Error error={duda.error} /> : pendientes.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 p-4 text-sm text-success">
            <CheckCircle2 className="size-4" /> No hay transacciones en duda en ningún nodo{sinConexion.length > 0 && ` (sin conexión: ${sinConexion.map((s) => s.nodo).join(', ')})`}.
          </div>
        ) : (
          <Tabla datos={pendientes} claveFila={(d) => d.gid!} columnas={[
            { clave: 'nodo', titulo: 'Nodo' },
            { clave: 'gid', titulo: 'Identificador global (gid)', render: (d) => <span className="font-mono text-xs">{d.gid}</span> },
            { clave: 'preparada', titulo: 'Preparada', render: (d) => fmt.fecha(d.preparada) },
          ]} />
        )}
      </Seccion>
    </>
  )
}
