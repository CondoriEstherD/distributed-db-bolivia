import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Building2, Loader2, Lock, MapPin, Network, Store } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, DEPARTAMENTOS } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Sucursal { cod: string; num: number; nombre: string; deptos: string[]; requiere_clave: boolean; central: boolean }

const MOSAICO = [1, 11, 16, 6, 13, 24, 8, 19, 17]

export default function Ingreso() {
  const cliente = useQueryClient()
  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: () => api<Sucursal[]>('/sucursales') })
  const [elegida, setElegida] = useState<Sucursal | null>(null)
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e?: React.FormEvent) {
    e?.preventDefault()
    if (!elegida) return
    setEnviando(true)
    setError('')
    try {
      await api('/login', { body: { sucursal: elegida.cod, clave } })
      await cliente.invalidateQueries()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      {/* Presentación de la empresa */}
      <div className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:block">
        <div className="absolute inset-0 grid grid-cols-3 gap-1 opacity-35">
          {MOSAICO.map((p) => <img key={p} src={`/productos/${p}.jpg`} alt="" className="size-full object-cover" />)}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-sidebar via-sidebar/85 to-sidebar/40" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><Network className="size-5" /></div>
            <div>
              <div className="font-semibold">BoliviaDistribución S.A.</div>
              <div className="text-xs text-sidebar-foreground/60">Logística y consumo masivo · 9 departamentos</div>
            </div>
          </div>
          <div className="max-w-md space-y-4">
            <h1 className="text-4xl leading-tight font-semibold tracking-tight">Cada sucursal vende con sus propios datos, aunque se corte la red.</h1>
            <p className="text-sidebar-foreground/70">
              Seis servidores regionales forman una sola base de datos distribuida: ventas y stock locales, catálogo replicado desde La Paz y traspasos de mercadería con compromiso en dos fases.
            </p>
          </div>
          <p className="text-xs text-sidebar-foreground/50">PostgreSQL 16 · fragmentación horizontal y vertical · replicación lógica · 2PC</p>
        </div>
      </div>

      {/* Ingreso */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-6">
          {!elegida ? (
            <>
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight">Ingresar a su sucursal</h2>
                <p className="text-sm text-muted-foreground">Elija la sucursal en la que trabaja. Cada una tiene su propia contraseña y solo ve sus propios datos.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(sucursales.data ?? []).map((s) => (
                  <button key={s.cod} type="button" onClick={() => { setElegida(s); setClave(''); setError('') }}
                    className="group flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                    <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg',
                      s.central ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground')}>
                      {s.central ? <Building2 className="size-5" /> : <Store className="size-5" />}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 font-medium">Sucursal {s.nombre}</div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" /> {s.deptos.map((d) => DEPARTAMENTOS[d]).join(' y ')}
                      </div>
                      {s.central && <Badge variant="secondary" className="text-[10px]">Casa matriz · administración central</Badge>}
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <form onSubmit={entrar} className="space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
              <button type="button" onClick={() => setElegida(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-4" /> Cambiar de sucursal
              </button>
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  {elegida.central ? <Building2 className="size-6" /> : <Store className="size-6" />}
                </div>
                <div>
                  <div className="text-lg font-semibold">Sucursal {elegida.nombre}</div>
                  <div className="text-sm text-muted-foreground">Nodo {elegida.num} · {elegida.deptos.map((d) => DEPARTAMENTOS[d]).join(' y ')}</div>
                </div>
              </div>
              {elegida.requiere_clave && (
                <div className="space-y-2">
                  <Label htmlFor="clave">Contraseña de la sucursal</Label>
                  <Input id="clave" type="password" autoFocus value={clave} onChange={(e) => setClave(e.target.value)} className="h-10" />
                </div>
              )}
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              <Button type="submit" size="lg" className="h-10 w-full" disabled={(elegida.requiere_clave && !clave) || enviando}>
                {enviando ? <Loader2 className="animate-spin" /> : <Lock />} Ingresar
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
