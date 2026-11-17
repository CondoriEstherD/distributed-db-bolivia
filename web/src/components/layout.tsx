import { useQueryClient } from '@tanstack/react-query'
import {
  Boxes, Building2, ClipboardCheck, FlaskConical, Landmark, LayoutDashboard, LogOut, Network, Receipt, RefreshCw,
  Search, ShoppingCart, Tags, Truck, Users, Wifi, WifiOff,
} from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'

import { PuntoEstado } from '@/components/comunes'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { api, DEPARTAMENTOS, useEstado } from '@/lib/api'
import { cn } from '@/lib/utils'

const TIENDA = [
  { a: '/', titulo: 'Vender', icono: ShoppingCart },
  { a: '/ventas', titulo: 'Historial de ventas', icono: Receipt },
  { a: '/clientes', titulo: 'Clientes', icono: Users },
  { a: '/inventario', titulo: 'Inventario', icono: Boxes },
  { a: '/envios', titulo: 'Envíos entre sucursales', icono: Truck },
]
const CENTRAL = [
  { a: '/central', titulo: 'Panorama nacional', icono: LayoutDashboard },
  { a: '/central/clientes', titulo: 'Clientes y crédito', icono: Landmark },
  { a: '/central/catalogo', titulo: 'Catálogo y precios', icono: Tags },
  { a: '/central/consultas', titulo: 'Consultas distribuidas', icono: Search },
  { a: '/central/auditoria', titulo: 'Auditoría de traspasos', icono: ClipboardCheck },
  { a: '/central/fallas', titulo: 'Simulación de fallas', icono: FlaskConical },
]
const TITULOS = Object.fromEntries([...TIENDA, ...CENTRAL].map((o) => [o.a, o.titulo]))

function Enlace({ a, titulo, icono: Icono, extra }: { a: string; titulo: string; icono: typeof Receipt; extra?: React.ReactNode }) {
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

export function Layout({ sucursal, central }: { sucursal: string; central: boolean }) {
  const { pathname } = useLocation()
  const navegar = useNavigate()
  const cliente = useQueryClient()
  const { data, isFetching } = useEstado()
  const yo = data?.nodos.find((n) => n.cod === sucursal)
  const enRed = yo?.en_linea
  const nodosEnLinea = data?.nodos.filter((n) => n.en_linea).length

  async function salir() {
    await api('/logout', { method: 'POST' })
    navegar('/')
    cliente.clear()
    cliente.invalidateQueries({ queryKey: ['sesion'] })
  }

  return (
    <SidebarProvider>
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
                  <span className="truncate text-xs text-sidebar-foreground/60">Sucursal {yo?.nombre ?? ''}</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Mi sucursal</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{TIENDA.map((o) => <Enlace key={o.a} {...o} />)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {central && (
            <SidebarGroup>
              <SidebarGroupLabel>Administración central</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {CENTRAL.map((o) => (
                    <Enlace key={o.a} {...o} extra={o.a === '/central' && nodosEnLinea !== undefined
                      ? <SidebarMenuBadge className={cn(nodosEnLinea < 6 && 'text-red-300')}>{nodosEnLinea}/6</SidebarMenuBadge> : undefined} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
          {central && (
            <SidebarGroup className="group-data-[collapsible=icon]:hidden">
              <SidebarGroupLabel>Red de sucursales</SidebarGroupLabel>
              <SidebarGroupContent className="space-y-1 px-2 text-xs">
                {(data?.nodos ?? []).map((n) => (
                  <div key={n.cod} className="flex items-center justify-between py-0.5 text-sidebar-foreground/75">
                    <span>N{n.num} · {n.nombre}</span><PuntoEstado estado={n.estado} />
                  </div>
                ))}
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent/60 p-2 group-data-[collapsible=icon]:hidden">
            <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary/20 text-sidebar-primary">
              {central ? <Building2 className="size-4" /> : <Users className="size-4" />}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-xs font-medium">{central ? 'Casa matriz · La Paz' : `Caja · ${yo?.nombre ?? ''}`}</div>
              <div className="truncate text-[11px] text-sidebar-foreground/55">Nodo {yo?.num} · {yo?.bd}</div>
            </div>
            <Button variant="ghost" size="icon-sm" title="Cerrar sesión" onClick={salir}
              className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><LogOut /></Button>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="bg-background">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <span className="text-sm text-muted-foreground">{pathname.startsWith('/central') ? 'Administración central' : `Sucursal ${yo?.nombre ?? ''}`}</span>
          <span className="text-sm text-muted-foreground">/</span>
          <span className="text-sm font-medium">{TITULOS[pathname] ?? ''}</span>
          <div className="ml-auto flex items-center gap-2">
            {yo && (
              <span className={cn('hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium sm:inline-flex',
                enRed ? 'border-success/30 bg-success/10 text-success' : 'border-amber-300 bg-amber-50 text-amber-700')}>
                {enRed ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
                {enRed ? 'Conectada a la red nacional' : yo.estado === 'AISLADO' ? 'Sin red nacional · modo local' : 'Servidor sin respuesta'}
              </span>
            )}
            <span className="hidden text-xs text-muted-foreground md:inline">{yo?.deptos.map((d) => DEPARTAMENTOS[d]).join(' · ')}</span>
            <Button variant="ghost" size="icon-sm" title="Actualizar" onClick={() => cliente.invalidateQueries()}>
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
