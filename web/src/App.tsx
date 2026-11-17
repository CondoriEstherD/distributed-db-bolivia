import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Navigate, Route, Routes } from 'react-router'

import { Layout } from '@/components/layout'
import { useSesion } from '@/lib/api'
import Auditoria from '@/pages/auditoria'
import Catalogo from '@/pages/catalogo'
import ClientesCredito from '@/pages/clientes-credito'
import Consultas from '@/pages/consultas'
import Fallas from '@/pages/fallas'
import Ingreso from '@/pages/ingreso'
import Panorama from '@/pages/panorama'
import { Clientes, Inventario, Ventas } from '@/pages/tienda'
import Traspasos from '@/pages/traspasos'
import PuntoDeVenta from '@/pages/vender'

export default function App() {
  const cliente = useQueryClient()
  const sesion = useSesion()

  useEffect(() => {  // cookie vencida: volver a la pantalla de ingreso
    const volver = () => cliente.invalidateQueries({ queryKey: ['sesion'] })
    window.addEventListener('sgbdd:sesion-expirada', volver)
    return () => window.removeEventListener('sgbdd:sesion-expirada', volver)
  }, [cliente])

  if (sesion.isPending) {
    return <div className="flex min-h-svh items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
  }
  if (sesion.isError) {
    return <div className="p-8 text-destructive">No se pudo contactar con la API (¿está corriendo abrir_panel.bat?): {sesion.error.message}</div>
  }
  if (!sesion.data.autorizado || !sesion.data.sucursal) return <Ingreso />

  const central = sesion.data.central
  return (
    <Routes>
      <Route element={<Layout sucursal={sesion.data.sucursal} central={central} />}>
        <Route index element={<PuntoDeVenta />} />
        <Route path="ventas" element={<Ventas />} />
        <Route path="clientes" element={<Clientes />} />
        <Route path="inventario" element={<Inventario />} />
        <Route path="traspasos" element={<Traspasos />} />
        {central && (
          <Route path="central">
            <Route index element={<Panorama />} />
            <Route path="clientes" element={<ClientesCredito />} />
            <Route path="catalogo" element={<Catalogo />} />
            <Route path="consultas" element={<Consultas />} />
            <Route path="auditoria" element={<Auditoria />} />
            <Route path="fallas" element={<Fallas />} />
          </Route>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
