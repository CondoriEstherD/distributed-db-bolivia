// Cliente de la API del SGBDD (api/main.py). Toda llamada usa la cookie de sesión del panel.
import { useQuery } from '@tanstack/react-query'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(ruta: string, opciones: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`/api${ruta}`, {
    method: opciones.method ?? (opciones.body ? 'POST' : 'GET'),
    headers: opciones.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
    credentials: 'same-origin',
  })
  if (!r.ok) {
    const detalle = await r.json().catch(() => ({ detail: r.statusText }))
    if (r.status === 401) window.dispatchEvent(new Event('sgbdd:sesion-expirada'))
    throw new ApiError(r.status, typeof detalle.detail === 'string' ? detalle.detail : 'Error de la API')
  }
  return r.json()
}

// ------------------------------------------------------------------ tipos
export type EstadoNodo = 'EN LÍNEA' | 'SIN CONEXIÓN' | 'AISLADO' | 'APAGADO'

export interface Nodo {
  cod: string
  num: number
  nombre: string
  nodo: string
  deptos: string[]
  contenedor: string
  bd: string
  servidor: string
  direccion: string
  estado: EstadoNodo
  en_linea: boolean
  ventas: number | null
  '2pc_pendientes': number | null
  replicacion: string | null
  local: boolean
}

export interface Producto {
  id: number
  nombre: string
  categoria: string
  codigo_barras: string
  precio: number
}

export interface Almacen {
  id: number
  nodo: string
  nodo_nombre: string
  num: number
  depto: string
  nombre: string
}

export interface ConSql<T> {
  sql: string
  filas: T[]
}

export const DEPARTAMENTOS: Record<string, string> = {
  LP: 'La Paz', SC: 'Santa Cruz', CB: 'Cochabamba', TJ: 'Tarija', CH: 'Chuquisaca',
  OR: 'Oruro', PO: 'Potosí', BE: 'Beni', PA: 'Pando',
}

// ------------------------------------------------------------------ consultas compartidas
export function useEstado() {
  return useQuery({
    queryKey: ['estado'],
    queryFn: () => api<{ modo: 'lab' | 'red'; nodos: Nodo[] }>('/estado'),
    refetchInterval: 10_000,
  })
}

export function useProductos() {
  return useQuery({ queryKey: ['productos'], queryFn: () => api<Producto[]>('/productos'), staleTime: 60_000 })
}

export function useAlmacenes() {
  return useQuery({ queryKey: ['almacenes'], queryFn: () => api<Almacen[]>('/almacenes'), staleTime: Infinity })
}

// ------------------------------------------------------------------ formatos (Bolivia)
const miles = new Intl.NumberFormat('es-BO')
const dinero = new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fecha = new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' })

export const fmt = {
  n: (v: number | null | undefined) => (v == null ? '—' : miles.format(v)),
  bs: (v: number | null | undefined) => (v == null ? '—' : `Bs ${dinero.format(v)}`),
  bsCorto: (v: number) =>
    v >= 1e6 ? `Bs ${dinero.format(v / 1e6)} M` : v >= 1e3 ? `Bs ${dinero.format(v / 1e3)} mil` : `Bs ${dinero.format(v)}`,
  fecha: (v: string | null | undefined) => (v ? fecha.format(new Date(v)) : '—'),
}
