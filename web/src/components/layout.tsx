import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftRight, Database, FlaskConical, HeartPulse, LayoutDashboard, Network, RefreshCw, Search, Store, Tags,
} from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router'

import { PuntoEstado } from '@/components/comunes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { useEstado } from '@/lib/api'

const OPERACIONES = [
  { a: '/traspasos', titulo: 'Traspasos 2PC', icono: ArrowLeftRight },
  { a: '/catalogo', titulo: 'Catálogo replicado', icono: Tags },
  { a: '/consultas', titulo: 'Consultas distribuidas', icono: Search },
]
const FALLAS = [
  { a: '/fallas', titulo: 'Simulación de fallas', icono: FlaskConical },
  { a: '/recuperacion', titulo: 'Recuperación 2PC', icono: HeartPulse },
]

export const TITULOS: Record<string, string> = {
  '/': 'Panorama nacional',
  ...Object.fromEntries([...OPERACIONES, ...FALLAS].map((o) => [o.a, o.titulo])),
}

function Enlace({ a, titulo, icono: Icono, extra }: {
  a: string; titulo: string; icono: typeof Store; extra?: React.ReactNode
}) {
  const { pathname } = useLocation()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={pathname === a} tooltip={titulo} render={<NavLink to={a} />}>
        <Icono />
        <span>{titulo}</span>
      </SidebarMenuButton>
      {extra}
    </SidebarMenuItem>
  )
}

function BarraLateral() {
  const { data } = useEstado()
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<NavLink to="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Network className="size-4" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">BoliviaDistribución</span>
                <span className="truncate text-xs text-sidebar-foreground/60">SGBDD · 6 nodos</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Monitoreo</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu><Enlace a="/" titulo="Panorama nacional" icono={LayoutDashboard} /></SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Sucursales · un servidor cada una</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {(data?.nodos ?? []).map((n) => (
                <Enlace key={n.cod} a={`/sucursal/${n.cod}`} titulo={`N${n.num} · ${n.nombre}`} icono={Store}
                  extra={<SidebarMenuBadge><PuntoEstado estado={n.estado} /></SidebarMenuBadge>} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Operaciones distribuidas</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{OPERACIONES.map((o) => <Enlace key={o.a} {...o} />)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Tolerancia a fallos</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{FALLAS.map((o) => <Enlace key={o.a} {...o} />)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
          <Database className="size-3.5" />
          PostgreSQL 16 · modo {data?.modo === 'red' ? 'red (Azure + Tailscale)' : 'laboratorio'}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

export function Layout() {
  const { pathname } = useLocation()
  const { data, isFetching } = useEstado()
  const cliente = useQueryClient()
  const enLinea = data?.nodos.filter((n) => n.en_linea).length
  const titulo = pathname.startsWith('/sucursal/')
    ? `Sucursal · ${data?.nodos.find((n) => pathname.endsWith(`/${n.cod}`))?.nombre ?? ''}`
    : TITULOS[pathname] ?? ''

  return (
    <SidebarProvider>
      <BarraLateral />
      <SidebarInset className="bg-background">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <span className="text-sm text-muted-foreground">SGBDD</span>
          <span className="text-sm text-muted-foreground">/</span>
          <span className="text-sm font-medium">{titulo}</span>
          <div className="ml-auto flex items-center gap-2">
            {enLinea !== undefined && (
              <Badge variant="outline" className={enLinea === 6 ? 'border-success/30 text-success' : 'border-destructive/30 text-destructive'}>
                {enLinea}/6 nodos en línea
              </Badge>
            )}
            <Button variant="ghost" size="icon-sm" title="Actualizar todo"
              onClick={() => cliente.invalidateQueries()}>
              <RefreshCw className={isFetching ? 'animate-spin' : undefined} />
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
