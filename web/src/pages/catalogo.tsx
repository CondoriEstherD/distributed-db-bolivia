import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock, Crown, Loader2, Send, WifiOff } from 'lucide-react'
import { toast } from 'sonner'

import { BloqueSql, Encabezado, Error, Seccion } from '@/components/comunes'
import { Selector } from '@/components/selector'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, fmt, useProductos } from '@/lib/api'

interface Replica { cod: string; nodo: string; precio: number | null; replica: 'maestro' | 'sincronizada' | 'pendiente' | 'sin conexión' }

const ESTADO = {
  maestro: { icono: Crown, clase: 'border-primary/30 bg-primary/10 text-primary', texto: 'Maestro' },
  sincronizada: { icono: CheckCircle2, clase: 'border-success/30 bg-success/10 text-success', texto: 'Sincronizada' },
  pendiente: { icono: Clock, clase: 'border-amber-300 bg-amber-50 text-amber-700', texto: 'Pendiente' },
  'sin conexión': { icono: WifiOff, clase: 'border-destructive/30 bg-destructive/10 text-destructive', texto: 'Sin conexión' },
}

export default function Catalogo() {
  const cliente = useQueryClient()
  const productos = useProductos()
  const [id, setId] = useState(10)
  const [editado, setEditado] = useState<string | null>(null)  // null = mostrar el precio actual del maestro
  const replicas = useQuery({
    queryKey: ['replicas', id], refetchInterval: 2_000,
    queryFn: () => api<{ sql: string; replicas: Replica[] }>(`/catalogo/${id}/replicas`),
  })
  const maestro = replicas.data?.replicas.find((r) => r.cod === 'lp')?.precio
  const precio = editado ?? (maestro != null ? String(maestro) : '')
  const setPrecio = setEditado

  const publicar = useMutation({
    mutationFn: () => api<{ sql: string }>(`/catalogo/${id}/precio`, { body: { precio: Number(precio) } }),
    onSuccess: () => {
      setEditado(null)
      toast.success('Precio publicado en La Paz', { description: 'Observe cómo llega a cada réplica.' })
      cliente.invalidateQueries({ queryKey: ['replicas', id] })
      cliente.invalidateQueries({ queryKey: ['productos'] })
    },
  })

  return (
    <>
      <Encabezado titulo="Catálogo replicado"
        descripcion="El catálogo se modifica solo en La Paz (publicación pub_catalogo) y se replica de forma asíncrona a los nodos 2 a 6: consistencia eventual. En las réplicas la escritura está revocada." />

      <div className="grid gap-4 lg:grid-cols-5">
        <Seccion className="lg:col-span-2" titulo="Cambiar el precio en el maestro" descripcion="Nodo 1 · La Paz, como rol_admin_catalogo">
          <div className="space-y-2">
            <Label>Producto</Label>
            <Selector valor={id} alCambiar={(v) => { setId(v); setEditado(null); publicar.reset() }} buscar="Nombre o categoría…"
              opciones={(productos.data ?? []).map((p) => ({ valor: p.id, etiqueta: p.nombre, grupo: p.categoria, detalle: fmt.bs(p.precio) }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="precio">Nuevo precio (Bs)</Label>
            <Input id="precio" type="number" min={0.5} step={0.5} value={precio} onChange={(e) => setPrecio(e.target.value)} />
          </div>
          <Button className="w-full" disabled={!(Number(precio) > 0) || publicar.isPending} onClick={() => publicar.mutate()}>
            {publicar.isPending ? <Loader2 className="animate-spin" /> : <Send />} Publicar cambio
          </Button>
          {publicar.error && <Error error={publicar.error} titulo="No se pudo publicar" />}
          <BloqueSql titulo="SQL en La Paz" sql={publicar.data?.sql ??
            `UPDATE productos_catalogo SET precio_unitario = ${Number(precio || 0).toFixed(2)}\nWHERE id_producto = ${id};  -- como rol_admin_catalogo`} />
        </Seccion>

        <Seccion className="lg:col-span-3" titulo="Precio en cada nodo (en vivo)"
          descripcion="Se actualiza cada 2 s. Una réplica sin conexión queda pendiente y se pone al día sola al reconectarse.">
          {replicas.error && <Error error={replicas.error} />}
          <div className="grid gap-3 sm:grid-cols-2">
            {(replicas.data?.replicas ?? []).map((r) => {
              const e = ESTADO[r.replica]
              return (
                <div key={r.cod} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <div className="text-sm font-medium">{r.nodo}</div>
                    <div className="text-lg font-semibold tabular-nums">{fmt.bs(r.precio)}</div>
                  </div>
                  <Badge variant="outline" className={`gap-1 ${e.clase}`}><e.icono /> {e.texto}</Badge>
                </div>
              )
            })}
          </div>
          {replicas.data && <BloqueSql sql={replicas.data.sql + ';  -- en cada uno de los 6 nodos'} abierto={false} />}
        </Seccion>
      </div>
    </>
  )
}
