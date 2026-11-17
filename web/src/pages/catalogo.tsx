import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock, Crown, Loader2, Send, WifiOff } from 'lucide-react'
import { toast } from 'sonner'

import { BloqueSql, Encabezado, Error } from '@/components/comunes'
import { GrillaProductos } from '@/components/productos'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, fmt, foto, useProductos } from '@/lib/api'

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
  const [editado, setEditado] = useState<string | null>(null)
  const p =productos.data?.find((x) => x.id === id)

  const replicas = useQuery({
    queryKey: ['replicas', id], refetchInterval: 2_000,
    queryFn: () => api<{ sql: string; replicas: Replica[] }>(`/catalogo/${id}/replicas`),
  })
  const maestro = replicas.data?.replicas.find((r) => r.cod === 'lp')?.precio
  const precio = editado ?? (maestro != null ? String(maestro) : '')

  const publicar = useMutation({
    mutationFn: () => api<{ sql: string }>(`/catalogo/${id}/precio`, { body: { precio: Number(precio) } }),
    onSuccess: () => {
      setEditado(null)
      toast.success('Precio publicado en La Paz', { description: 'Observe cómo llega a cada sucursal.' })
      cliente.invalidateQueries({ queryKey: ['replicas', id] })
      cliente.invalidateQueries({ queryKey: ['productos'] })
    },
  })

  return (
    <>
      <Encabezado titulo="Catálogo y precios"
        descripcion="Los mismos productos y precios en las 6 sucursales. Solo La Paz modifica el catálogo; cada cambio viaja a las demás por replicación lógica asíncrona (consistencia eventual)." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <GrillaProductos productos={productos.data ?? []} modo="elegir" seleccionado={id}
            alAgregar={(x) => { setId(x); setEditado(null); publicar.reset() }} />
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:h-fit lg:max-h-[calc(100svh-6rem)] lg:overflow-y-auto">
          {p && (
            <Card className="overflow-hidden pt-0">
              <img src={foto(p.id)} alt={p.nombre} className="aspect-[16/10] w-full object-cover" />
              <CardContent className="space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground uppercase">{p.categoria} · {p.codigo_barras}</div>
                  <div className="text-lg font-semibold">{p.nombre}</div>
                </div>
                <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="precio">Precio en todas las sucursales (Bs)</Label>
                    <Input id="precio" type="number" min={0.5} step={0.5} value={precio} onChange={(e) => setEditado(e.target.value)} className="h-10 text-lg" />
                  </div>
                  <Button className="h-10" disabled={!(Number(precio) > 0) || Number(precio) === maestro || publicar.isPending} onClick={() => publicar.mutate()}>
                    {publicar.isPending ? <Loader2 className="animate-spin" /> : <Send />} Publicar
                  </Button>
                </div>
                {publicar.error && <Error error={publicar.error} titulo="No se pudo publicar" />}
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground uppercase">Precio en cada sucursal · en vivo</div>
                  {(replicas.data?.replicas ?? []).map((r) => {
                    const e = ESTADO[r.replica]
                    return (
                      <div key={r.cod} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                        <span>{r.nodo.replace('Nodo ', 'N')}</span>
                        <span className="flex items-center gap-2"><span className="tabular-nums">{fmt.bs(r.precio)}</span>
                          <Badge variant="outline" className={`gap-1 ${e.clase}`}><e.icono /> {e.texto}</Badge></span>
                      </div>
                    )
                  })}
                  <p className="text-[11px] text-muted-foreground">Una sucursal sin red queda «pendiente» y se pone al día sola al reconectarse.</p>
                </div>
                <BloqueSql titulo="SQL en La Paz" abierto={false} sql={publicar.data?.sql ??
                  `UPDATE productos_catalogo SET precio_unitario = ${Number(precio || 0).toFixed(2)}\nWHERE id_producto = ${id};  -- como rol_admin_catalogo`} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
