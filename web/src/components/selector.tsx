// Selector con búsqueda (Popover + Command) para listas largas: clientes, productos, almacenes.
import { useState, type ReactNode } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface Opcion<V> {
  valor: V
  etiqueta: string
  detalle?: ReactNode
  grupo?: string
  deshabilitada?: boolean
}

export function Selector<V extends string | number>({ opciones, valor, alCambiar, placeholder = 'Seleccione…',
  buscar = 'Buscar…', ancho = 'w-full', limpiarAlElegir, deshabilitado }: {
  opciones: Opcion<V>[]; valor?: V | null; alCambiar: (v: V) => void; placeholder?: string; buscar?: string
  ancho?: string; limpiarAlElegir?: boolean; deshabilitado?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const elegida = opciones.find((o) => o.valor === valor)
  const grupos = [...new Set(opciones.map((o) => o.grupo ?? ''))]
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger disabled={deshabilitado}
        render={<Button variant="outline" className={cn('justify-between font-normal', ancho, !elegida && 'text-muted-foreground')} />}>
        <span className="truncate">{elegida && !limpiarAlElegir ? elegida.etiqueta : placeholder}</span>
        <ChevronsUpDown className="opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder={buscar} />
          <CommandList className="max-h-72">
            <CommandEmpty>Sin resultados</CommandEmpty>
            {grupos.map((g) => (
              <CommandGroup key={g} heading={g || undefined}>
                {opciones.filter((o) => (o.grupo ?? '') === g).map((o) => (
                  <CommandItem key={String(o.valor)} value={`${o.etiqueta} ${o.valor}`} disabled={o.deshabilitada}
                    onSelect={() => { alCambiar(o.valor); setAbierto(false) }}>
                    <Check className={cn('size-4', o.valor === valor && !limpiarAlElegir ? 'opacity-100' : 'opacity-0')} />
                    <span className="flex-1 truncate">{o.etiqueta}</span>
                    {o.detalle && <span className="text-xs text-muted-foreground">{o.detalle}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// Botones segmentados para pocas opciones (p. ej. departamento TJ / CH).
export function Segmentos<V extends string>({ opciones, valor, alCambiar }: {
  opciones: { valor: V; etiqueta: ReactNode }[]; valor: V; alCambiar: (v: V) => void
}) {
  return (
    <div className="inline-flex rounded-lg border bg-muted p-0.5">
      {opciones.map((o) => (
        <button key={o.valor} type="button" onClick={() => alCambiar(o.valor)}
          className={cn('rounded-md px-3 py-1 text-sm font-medium transition-colors',
            o.valor === valor ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {o.etiqueta}
        </button>
      ))}
    </div>
  )
}
