import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Lock, Network } from 'lucide-react'
import { Route, Routes } from 'react-router'

import { Layout } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import Catalogo from '@/pages/catalogo'
import Consultas from '@/pages/consultas'
import Fallas from '@/pages/fallas'
import Panorama from '@/pages/panorama'
import Recuperacion from '@/pages/recuperacion'
import Sucursal from '@/pages/sucursal'
import Traspasos from '@/pages/traspasos'

interface Sesion { requiere_clave: boolean; autorizado: boolean; modo: string }

function Acceso() {
  const cliente = useQueryClient()
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError('')
    try {
      await api('/login', { body: { clave } })
      await cliente.invalidateQueries()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-[radial-gradient(ellipse_at_top,oklch(0.93_0.03_255),var(--background)_60%)] p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Network className="size-5" />
          </div>
          <CardTitle className="text-lg">BoliviaDistribución S.A.</CardTitle>
          <CardDescription>Sistema de Gestión de Base de Datos Distribuida</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={entrar} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="clave">Contraseña del panel</Label>
              <Input id="clave" type="password" autoFocus value={clave} onChange={(e) => setClave(e.target.value)} />
            </div>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" className="w-full" disabled={!clave || enviando}>
              {enviando ? <Loader2 className="animate-spin" /> : <Lock />} Ingresar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function App() {
  const cliente = useQueryClient()
  const sesion = useQuery({ queryKey: ['sesion'], queryFn: () => api<Sesion>('/sesion'), staleTime: Infinity })

  useEffect(() => {  // cookie vencida: volver a la pantalla de acceso
    const volver = () => cliente.invalidateQueries({ queryKey: ['sesion'] })
    window.addEventListener('sgbdd:sesion-expirada', volver)
    return () => window.removeEventListener('sgbdd:sesion-expirada', volver)
  }, [cliente])

  if (sesion.isPending) {
    return <div className="flex min-h-svh items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
  }
  if (sesion.isError) {
    return <div className="p-8 text-destructive">No se pudo contactar con la API (¿está corriendo uvicorn?): {sesion.error.message}</div>
  }
  if (!sesion.data.autorizado) return <Acceso />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Panorama />} />
        <Route path="sucursal/:cod" element={<Sucursal />} />
        <Route path="traspasos" element={<Traspasos />} />
        <Route path="catalogo" element={<Catalogo />} />
        <Route path="consultas" element={<Consultas />} />
        <Route path="fallas" element={<Fallas />} />
        <Route path="recuperacion" element={<Recuperacion />} />
      </Route>
    </Routes>
  )
}
