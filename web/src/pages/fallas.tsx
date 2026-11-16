import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Filter, Globe, Loader2, Play, PlayCircle, Power, RefreshCw, ShieldCheck, Store, Unplug, XCircle } from 'lucide-react'
import { toast } from 'sonner'

import { BloqueSql, Encabezado, EstadoBadge, Seccion } from '@/components/comunes'
import { Segmentos } from '@/components/selector'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, useEstado } from '@/lib/api'
import { cn } from '@/lib/utils'

type Tipo = 'cortar' | 'apagar'
interface Resultado { ok: boolean; texto: string; sql: string; segundos: number; tabla: { fragmento: string; departamento_id: string | null; ventas: number | null; estado: string }[] | null }

export default function Fallas() {
  const cliente = useQueryClient()
  const { data } = useEstado()
  const [cod, setCod] = useState('be')
  const [tipo, setTipo] = useState<Tipo>('cortar')
  const [res, setRes] = useState<Record<string, Resultado | 'cargando'>>({})
  const [accion, setAccion] = useState(false)
  const nodo = data?.nodos.find((n) => n.cod === cod)
  const otro = data?.nodos.find((n) => n.cod === (cod === 'sc' ? 'cb' : 'sc'))
  const desdePanel = data?.modo === 'lab' && nodo?.local

  const casos = [
    { clave: 'nacional', titulo: 'Consulta nacional completa', icono: Globe,
      espera: 'Necesita los 6 fragmentos: con un nodo caído debe fallar rápido y de forma controlada, sin bloquearse.' },
    { clave: 'otro', titulo: `Consulta solo de ${otro?.deptos[0] ?? ''}`, icono: Filter,
      espera: 'Eliminación de fragmentos: el optimizador no toca el nodo caído, así que funciona.' },
    { clave: 'tolerante', titulo: 'Consulta tolerante a fallos', icono: ShieldCheck,
      espera: 'resumen_nacional_disponible() consulta fragmento por fragmento e informa cuál falta.' },
    { clave: 'venta_afectado', titulo: `Venta en ${nodo?.nombre ?? ''}`, icono: Store,
      espera: 'Enlace cortado: la sucursal vende en su propio servidor (autonomía). Servidor apagado: no vende.' },
    { clave: 'venta_otro', titulo: `Venta en ${otro?.nombre ?? ''}`, icono: Store,
      espera: 'Las demás sucursales siguen operando con normalidad.' },
  ]

  async function probar(clave: string) {
    setRes((r) => ({ ...r, [clave]: 'cargando' }))
    const r = await api<Resultado>(`/verificar/${clave}?cod=${cod}`, { method: 'POST' })
    setRes((x) => ({ ...x, [clave]: r }))
  }

  async function provocar(a: string) {
    setAccion(true)
    try {
      const r = await api<{ estado: string }>(`/fallas/${cod}/${a}`, { method: 'POST' })
      setRes({})
      toast.success(`${nodo?.nodo}: ${r.estado.toLowerCase()}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAccion(false)
      cliente.invalidateQueries({ queryKey: ['estado'] })
    }
  }

  const comandos = useQuery({ queryKey: ['comandos-falla'], queryFn: () => api<Record<string, string>>('/fallas/comandos'), staleTime: Infinity })
  const cmd = (k: string) => (comandos.data?.[k] ?? '').replace('{contenedor}', nodo?.contenedor ?? '').replaceAll(' && ', ' &&\n').replaceAll('; ', ';\n')
  const [falla, vuelta] = tipo === 'cortar' ? [cmd('aislar'), cmd('reconectar')] : [cmd('apagar'), cmd('encender')]

  return (
    <>
      <Encabezado titulo="Simulación de fallas"
        descripcion="Provoque la caída de una sucursal y verifique, con consultas reales, qué sigue funcionando: autonomía local, transparencia y tolerancia a fallos." />

      <div className="grid gap-4 lg:grid-cols-5">
        <Seccion className="lg:col-span-3" titulo="1 · Provocar la falla">
          <div className="flex flex-wrap items-center gap-3">
            <Segmentos valor={cod} alCambiar={(c) => { setCod(c); setRes({}) }}
              opciones={(data?.nodos ?? []).map((n) => ({ valor: n.cod, etiqueta: `N${n.num} ${n.nombre}` }))} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {([['cortar', Unplug, 'Cortar el enlace de red', 'El servidor sigue encendido y atiende a su sucursal (puede vender), pero ningún otro nodo lo alcanza: no hay consulta nacional completa ni traspasos con esa sucursal.'],
              ['apagar', Power, 'Apagar el servidor de base de datos', 'Caída total: la sucursal deja de atender incluso localmente. Al encenderlo, PostgreSQL se recupera y la réplica del catálogo se pone al día sola.']] as const)
              .map(([t, Icono, titulo, texto]) => (
                <button key={t} type="button" onClick={() => setTipo(t)}
                  className={cn('rounded-lg border p-3 text-left transition-colors', tipo === t ? 'border-primary bg-accent' : 'hover:bg-muted')}>
                  <div className="flex items-center gap-2 text-sm font-medium"><Icono className="size-4" /> {titulo}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{texto}</p>
                </button>
              ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={accion || !nodo?.en_linea} onClick={() => provocar(tipo === 'cortar' ? 'aislar' : 'apagar')}>
              {accion ? <Loader2 className="animate-spin" /> : tipo === 'cortar' ? <Unplug /> : <Power />}
              {tipo === 'cortar' ? 'Cortar el enlace WAN' : 'Apagar el servidor'}
            </Button>
            <Button variant="outline" disabled={accion || nodo?.en_linea} onClick={() => provocar(tipo === 'cortar' ? 'reconectar' : 'encender')}>
              <RefreshCw /> Restaurar
            </Button>
          </div>
          {!desdePanel && comandos.data && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                El panel ejecuta el comando en el servidor de la sucursal. Equivalente manual: portal de Azure → <b>{nodo?.servidor}</b> → <b>Ejecutar comando</b> → RunShellScript.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <BloqueSql titulo="Provocar la falla" nota="bash" abierto={false} sql={falla} />
                <BloqueSql titulo="Restaurar" nota="bash" abierto={false} sql={vuelta} />
              </div>
            </div>
          )}
        </Seccion>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Estado actual</CardTitle>
            <CardDescription>Se actualiza cada 10 s</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.nodos ?? []).map((n) => (
              <div key={n.cod} className={cn('flex items-center justify-between rounded-md px-2 py-1.5 text-sm', n.cod === cod && 'bg-muted')}>
                <span>Nodo {n.num} · {n.nombre}</span>
                <EstadoBadge estado={n.estado} />
              </div>
            ))}
            <Button variant="outline" size="sm" className="mt-2 w-full"
              onClick={() => { api('/estado?forzar=true').then(() => cliente.invalidateQueries({ queryKey: ['estado'] })) }}>
              <RefreshCw /> Actualizar ahora
            </Button>
          </CardContent>
        </Card>
      </div>

      <Seccion titulo="2 · Verificar el comportamiento" descripcion="Cada prueba se ejecuta de verdad contra los nodos"
        acciones={<Button variant="outline" onClick={async () => { for (const c of casos) await probar(c.clave) }}><PlayCircle /> Probar todo</Button>}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {casos.map((c) => {
            const r = res[c.clave]
            return (
              <div key={c.clave} className={cn('flex flex-col gap-3 rounded-lg border p-4',
                r && r !== 'cargando' && (r.ok ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5'))}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium"><c.icono className="size-4 text-muted-foreground" /> {c.titulo}</div>
                  {r && r !== 'cargando' && <Badge variant="outline">{r.segundos} s</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{c.espera}</p>
                {r && r !== 'cargando' && (
                  <div className={cn('flex items-start gap-2 text-sm', r.ok ? 'text-success' : 'text-destructive')}>
                    {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
                    <span>{r.texto}</span>
                  </div>
                )}
                {r && r !== 'cargando' && r.tabla && (
                  <div className="space-y-1 rounded-md bg-muted/50 p-2 text-xs">
                    {[...new Map(r.tabla.map((t) => [t.fragmento, t])).values()].map((t) => (
                      <div key={t.fragmento} className="flex justify-between gap-2">
                        <span className="font-mono">{t.fragmento}</span>
                        <span className={t.estado.startsWith('EN') ? 'text-success' : 'text-destructive'}>{t.estado.startsWith('EN') ? 'EN LÍNEA' : 'FUERA DE LÍNEA'}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Button size="sm" variant="secondary" className="mt-auto" disabled={r === 'cargando'} onClick={() => probar(c.clave)}>
                  {r === 'cargando' ? <Loader2 className="animate-spin" /> : <Play />} Probar
                </Button>
              </div>
            )
          })}
        </div>
      </Seccion>
    </>
  )
}
