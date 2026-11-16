// Piezas de interfaz compartidas por todas las pantallas.
import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Code2, Copy, Search, WifiOff } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { EstadoNodo } from '@/lib/api'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------------ estado de un nodo
const ESTILO: Record<EstadoNodo, { clase: string; punto: string; texto: string }> = {
  'EN LÍNEA': { clase: 'bg-success/10 text-success border-success/20', punto: 'bg-success', texto: 'En línea' },
  'SIN CONEXIÓN': { clase: 'bg-destructive/10 text-destructive border-destructive/20', punto: 'bg-destructive', texto: 'Sin conexión' },
  AISLADO: { clase: 'bg-warning/15 text-amber-700 border-warning/30', punto: 'bg-warning', texto: 'Aislado' },
  APAGADO: { clase: 'bg-destructive/10 text-destructive border-destructive/20', punto: 'bg-destructive', texto: 'Apagado' },
}

export function PuntoEstado({ estado, className }: { estado: EstadoNodo; className?: string }) {
  const e = ESTILO[estado]
  return (
    <span className={cn('relative inline-flex size-2', className)}>
      {estado === 'EN LÍNEA' && <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-50', e.punto)} />}
      <span className={cn('relative inline-flex size-2 rounded-full', e.punto)} />
    </span>
  )
}

export function EstadoBadge({ estado }: { estado: EstadoNodo }) {
  const e = ESTILO[estado]
  return (
    <Badge variant="outline" className={cn('gap-1.5 font-medium', e.clase)}>
      <PuntoEstado estado={estado} />
      {e.texto}
    </Badge>
  )
}

// ------------------------------------------------------------------ encabezado de página
export function Encabezado({ titulo, descripcion, acciones, insignia }: {
  titulo: string; descripcion?: ReactNode; acciones?: ReactNode; insignia?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
          {insignia}
        </div>
        {descripcion && <p className="max-w-3xl text-sm text-muted-foreground">{descripcion}</p>}
      </div>
      {acciones && <div className="flex shrink-0 items-center gap-2">{acciones}</div>}
    </div>
  )
}

// ------------------------------------------------------------------ indicador (KPI)
export function Indicador({ titulo, valor, detalle, icono, cargando }: {
  titulo: string; valor: ReactNode; detalle?: ReactNode; icono?: ReactNode; cargando?: boolean
}) {
  return (
    <Card size="sm" className="gap-2">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardDescription className="text-xs font-medium tracking-wide uppercase">{titulo}</CardDescription>
        <span className="text-muted-foreground [&_svg]:size-4">{icono}</span>
      </CardHeader>
      <CardContent>
        {cargando ? <Skeleton className="h-8 w-28" /> : <div className="text-2xl font-semibold tabular-nums">{valor}</div>}
        {detalle && <p className="mt-1 text-xs text-muted-foreground">{detalle}</p>}
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------------ SQL ejecutado (siempre visible)
export function BloqueSql({ sql, titulo = 'SQL ejecutado', nota, abierto = true }: {
  sql: string; titulo?: string; nota?: string; abierto?: boolean
}) {
  const [visible, setVisible] = useState(abierto)
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="overflow-hidden rounded-lg border bg-[oklch(0.2_0.03_262)] text-[oklch(0.92_0.01_255)]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5">
        <button type="button" onClick={() => setVisible(!visible)}
          className="flex items-center gap-2 text-xs font-medium text-white/80 hover:text-white">
          <Code2 className="size-3.5" /> {titulo}
          {nota && <span className="font-normal text-white/50">· {nota}</span>}
        </button>
        <button type="button" title="Copiar" className="text-white/60 hover:text-white"
          onClick={() => { navigator.clipboard.writeText(sql); setCopiado(true); setTimeout(() => setCopiado(false), 1500) }}>
          {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      {visible && (
        <pre className="max-h-80 overflow-auto px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre">
          {resaltarSql(sql)}
        </pre>
      )}
    </div>
  )
}

const PALABRAS = /\b(SELECT|FROM|WHERE|JOIN|LEFT|USING|ON|GROUP BY|ORDER BY|LIMIT|AND|OR|AS|IN|ANY|SUM|COUNT|UPDATE|SET|INSERT INTO|VALUES|CONFLICT|DO|BEGIN|PREPARE TRANSACTION|COMMIT PREPARED|ROLLBACK PREPARED|DESC|ASC|FILTER|NOT|NULL|IS|COALESCE|EXPLAIN|VERBOSE|COSTS|OFF|WITH|UNION ALL|CASE|WHEN|THEN|ELSE|END|DISTINCT|HAVING)\b/gi

function resaltarSql(sql: string) {
  return sql.split('\n').map((linea, i) => {
    const comentario = linea.indexOf('--')
    const codigo = comentario >= 0 ? linea.slice(0, comentario) : linea
    const partes: ReactNode[] = []
    let ultimo = 0
    for (const m of codigo.matchAll(PALABRAS)) {
      partes.push(codigo.slice(ultimo, m.index))
      partes.push(<span key={m.index} className="font-semibold text-[oklch(0.78_0.12_245)]">{m[0]}</span>)
      ultimo = (m.index ?? 0) + m[0].length
    }
    partes.push(codigo.slice(ultimo))
    return (
      <span key={i}>
        {partes}
        {comentario >= 0 && <span className="text-white/45 italic">{linea.slice(comentario)}</span>}
        {'\n'}
      </span>
    )
  })
}

// ------------------------------------------------------------------ carga y errores
export function Cargando({ filas = 4 }: { filas?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: filas }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  )
}

export function Error({ error, titulo = 'No se pudo obtener la información' }: { error: unknown; titulo?: string }) {
  const msg = error instanceof globalThis.Error ? error.message : String(error)
  const sinRed = /sin conexión|timeout|connect|no responde/i.test(msg)
  return (
    <Alert variant="destructive">
      {sinRed ? <WifiOff /> : <AlertTriangle />}
      <AlertTitle>{titulo}</AlertTitle>
      <AlertDescription>{msg}</AlertDescription>
    </Alert>
  )
}

// ------------------------------------------------------------------ tabla con búsqueda y paginación
export interface Columna<T> {
  clave: string
  titulo: string
  alinear?: 'izq' | 'der' | 'centro'
  ancho?: string
  render?: (fila: T) => ReactNode
  valor?: (fila: T) => string | number | null
}

export function Tabla<T extends object>({ datos, columnas, buscar, porPagina = 15, alSeleccionar, seleccion,
  vacio = 'Sin registros', claveFila }: {
  datos: T[]; columnas: Columna<T>[]; buscar?: string; porPagina?: number
  alSeleccionar?: (fila: T) => void; seleccion?: (fila: T) => boolean; vacio?: string
  claveFila?: (fila: T, i: number) => string | number
}) {
  const [texto, setTexto] = useState('')
  const [pagina, setPagina] = useState(0)
  const filtrados = useMemo(() => {
    if (!texto) return datos
    const t = texto.toLowerCase()
    return datos.filter((f) => columnas.some((c) => String(c.valor ? c.valor(f) : (f as Record<string, unknown>)[c.clave] ?? '')
      .toLowerCase().includes(t)))
  }, [datos, texto, columnas])
  const paginas = Math.max(1, Math.ceil(filtrados.length / porPagina))
  const actual = Math.min(pagina, paginas - 1)
  const visibles = filtrados.slice(actual * porPagina, (actual + 1) * porPagina)
  const alin = { izq: 'text-left', der: 'text-right', centro: 'text-center' }

  return (
    <div className="space-y-3">
      {buscar && (
        <div className="relative max-w-sm">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={texto} onChange={(e) => { setTexto(e.target.value); setPagina(0) }}
            placeholder={buscar} className="pl-8" />
        </div>
      )}
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow>
              {columnas.map((c) => (
                <TableHead key={c.clave} style={{ width: c.ancho }}
                  className={cn('h-9 text-xs font-semibold tracking-wide text-muted-foreground uppercase', alin[c.alinear ?? 'izq'])}>
                  {c.titulo}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.length === 0 && (
              <TableRow><TableCell colSpan={columnas.length} className="h-20 text-center text-muted-foreground">{vacio}</TableCell></TableRow>
            )}
            {visibles.map((f, i) => (
              <TableRow key={claveFila ? claveFila(f, i) : i} onClick={alSeleccionar ? () => alSeleccionar(f) : undefined}
                data-state={seleccion?.(f) ? 'selected' : undefined}
                className={cn(alSeleccionar && 'cursor-pointer')}>
                {columnas.map((c) => (
                  <TableCell key={c.clave} className={cn('py-2 whitespace-normal', alin[c.alinear ?? 'izq'], c.alinear === 'der' && 'tabular-nums whitespace-nowrap')}>
                    {c.render ? c.render(f) : String((f as Record<string, unknown>)[c.clave] ?? '—')}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {filtrados.length > porPagina && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{actual * porPagina + 1}–{Math.min((actual + 1) * porPagina, filtrados.length)} de {filtrados.length.toLocaleString('es-BO')}</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" disabled={actual === 0} onClick={() => setPagina(actual - 1)}><ChevronLeft /></Button>
            <span className="px-2">Página {actual + 1} de {paginas}</span>
            <Button variant="outline" size="icon-sm" disabled={actual >= paginas - 1} onClick={() => setPagina(actual + 1)}><ChevronRight /></Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ sección con título
export function Seccion({ titulo, descripcion, acciones, children, className }: {
  titulo: ReactNode; descripcion?: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-base">{titulo}</CardTitle>
          {descripcion && <CardDescription>{descripcion}</CardDescription>}
        </div>
        {acciones}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}
