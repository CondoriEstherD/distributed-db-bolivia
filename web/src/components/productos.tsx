// Catálogo visual: una tarjeta por producto (25) con su foto; al tocarla se elige la presentación (8).
import { useMemo, useState } from 'react'
import { Check, Minus, Plus, Search } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { fmt, foto, nombreBase, presentacion, type Producto } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Grupo { base: number; nombre: string; categoria: string; variantes: Producto[] }

function agrupar(productos: Producto[]): Grupo[] {
  const m = new Map<number, Grupo>()
  for (const p of productos) {
    const base = Math.floor((p.id - 1) / 8) + 1
    if (!m.has(base)) m.set(base, { base, nombre: nombreBase(p), categoria: p.categoria, variantes: [] })
    m.get(base)!.variantes.push(p)
  }
  return [...m.values()]
}

export function GrillaProductos({ productos, stock, cantidades = {}, alAgregar, alCambiar, seleccionado, modo = 'carrito', columnas }: {
  productos: Producto[]
  stock?: (id: number) => number
  cantidades?: Record<number, number>
  alAgregar?: (id: number) => void
  alCambiar?: (id: number, q: number) => void
  seleccionado?: number
  modo?: 'carrito' | 'elegir'
  columnas?: string
}) {
  const [categoria, setCategoria] = useState('Todas')
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState<Grupo | null>(null)
  const grupos = useMemo(() => agrupar(productos), [productos])
  const categorias = ['Todas', ...new Set(grupos.map((g) => g.categoria))]
  const visibles = grupos.filter((g) => (categoria === 'Todas' || g.categoria === categoria)
    && (!texto || `${g.nombre} ${g.categoria} ${g.variantes.map((v) => v.codigo_barras).join(' ')}`.toLowerCase().includes(texto.toLowerCase())))

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar producto, categoría o código de barras…" className="h-10 pl-9" />
      </div>
      <div className="flex flex-wrap gap-2">
        {categorias.map((c) => (
          <button key={c} type="button" onClick={() => setCategoria(c)}
            className={cn('rounded-full border px-3 py-1 text-sm transition-colors',
              c === categoria ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}>{c}</button>
        ))}
      </div>
      <div className={cn('grid gap-3', columnas ?? 'grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4')}>
        {visibles.map((g) => {
          const enCarrito = g.variantes.reduce((s, v) => s + (cantidades[v.id] ?? 0), 0)
          const disponible = stock ? g.variantes.reduce((s, v) => s + stock(v.id), 0) : null
          const desde = Math.min(...g.variantes.map((v) => v.precio))
          const elegido = g.variantes.some((v) => v.id === seleccionado)
          return (
            <button key={g.base} type="button" onClick={() => setAbierto(g)}
              className={cn('group relative overflow-hidden rounded-xl border bg-card text-left transition-all hover:-translate-y-0.5 hover:shadow-lg',
                (enCarrito > 0 || elegido) && 'ring-2 ring-primary', disponible === 0 && 'opacity-50')}>
              <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                <img src={foto(g.variantes[0].id)} alt={g.nombre} loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
                {enCarrito > 0 && <span className="absolute top-2 right-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-2 text-sm font-semibold text-primary-foreground shadow">{enCarrito}</span>}
              </div>
              <div className="space-y-1 p-3">
                <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{g.categoria}</div>
                <div className="font-medium">{g.nombre}</div>
                <div className="flex items-end justify-between gap-2">
                  <span className="text-sm"><span className="text-muted-foreground">desde </span><b className="tabular-nums">{fmt.bs(desde)}</b></span>
                  <span className="text-xs text-muted-foreground">{disponible != null ? `${fmt.n(disponible)} u.` : `${g.variantes.length} present.`}</span>
                </div>
              </div>
            </button>
          )
        })}
        {visibles.length === 0 && <p className="col-span-full py-16 text-center text-sm text-muted-foreground">No hay productos con ese filtro.</p>}
      </div>

      <Dialog open={!!abierto} onOpenChange={(o) => !o && setAbierto(null)}>
        <DialogContent className="sm:max-w-lg">
          {abierto && (
            <>
              <img src={foto(abierto.variantes[0].id)} alt="" className="-mx-4 -mt-4 aspect-[16/7] w-[calc(100%+2rem)] max-w-none rounded-t-xl object-cover" />
              <DialogHeader>
                <DialogTitle>{abierto.nombre}</DialogTitle>
                <DialogDescription>{abierto.categoria} · elija la presentación</DialogDescription>
              </DialogHeader>
              <div className="max-h-[50vh] divide-y overflow-auto rounded-lg border">
                {abierto.variantes.map((v) => {
                  const s = stock?.(v.id)
                  const q = cantidades[v.id] ?? 0
                  return (
                    <div key={v.id} className={cn('flex items-center gap-3 px-3 py-2', v.id === seleccionado && 'bg-accent')}>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{presentacion(v.id)}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{v.codigo_barras}{s != null && ` · ${s ? `${fmt.n(s)} disponibles` : 'agotado'}`}</div>
                      </div>
                      <div className="w-24 text-right text-sm font-semibold tabular-nums">{fmt.bs(v.precio)}</div>
                      {modo === 'elegir' ? (
                        <Button size="sm" variant={v.id === seleccionado ? 'default' : 'outline'} onClick={() => { alAgregar?.(v.id); setAbierto(null) }}>
                          {v.id === seleccionado ? <Check /> : null} Elegir
                        </Button>
                      ) : q > 0 ? (
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="icon-xs" onClick={() => alCambiar?.(v.id, q - 1)}><Minus /></Button>
                          <span className="w-7 text-center text-sm tabular-nums">{q}</span>
                          <Button variant="outline" size="icon-xs" disabled={s != null && q >= s} onClick={() => alCambiar?.(v.id, q + 1)}><Plus /></Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" disabled={s === 0} onClick={() => alAgregar?.(v.id)}><Plus /> Agregar</Button>
                      )}
                    </div>
                  )
                })}
              </div>
              {modo === 'carrito' && (
                <DialogFooter>
                  <Badge variant="secondary" className="mr-auto self-center">{abierto.variantes.reduce((s, v) => s + (cantidades[v.id] ?? 0), 0)} en la lista</Badge>
                  <Button onClick={() => setAbierto(null)}>Listo</Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
