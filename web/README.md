# Panel web (frontend)

Aplicación React que muestra el SGBDD como un sistema de ventas: ingreso por sucursal, punto de venta,
traspasos con aprobación y la administración central. Habla con la API de Python (`api/main.py`).

> Para **usar** el panel no hace falta nada de esta carpeta: la versión compilada ya está en `web/dist`
> y la sirve la API (`abrir_panel.bat`). Esto solo es para **modificar** el frontend.

**Stack:** React 19 · TypeScript · Vite · Tailwind CSS 4 · shadcn/ui (Base UI) · TanStack Query ·
React Router · Recharts.

## Desarrollo

Requiere Node.js 22 o superior.

```powershell
cd web
npm install
# En otra ventana, la API:  .\.venv\Scripts\python.exe -m uvicorn api.main:app --port 8000
npm run dev        # http://localhost:5173 (redirige /api al puerto 8000)
```

## Publicar un cambio

```powershell
npm run build      # genera web/dist
```

Suba también `web/dist` al repositorio: así las demás laptops usan el panel sin instalar Node.

## Estructura

```
src/
├── App.tsx                 rutas y control de sesión
├── lib/api.ts              cliente de la API, tipos y formatos (Bs, fechas)
├── components/
│   ├── layout.tsx          barra lateral, encabezado y estado de la red
│   ├── comunes.tsx         tablas, indicadores, bloque de SQL, estados de carga y error
│   ├── productos.tsx       catálogo con fotos (una tarjeta por producto)
│   ├── selector.tsx        selector con búsqueda y botones segmentados
│   └── ui/                 componentes base de shadcn/ui
└── pages/
    ├── ingreso.tsx         elegir sucursal y contraseña
    ├── vender.tsx          punto de venta
    ├── tienda.tsx          historial de ventas, clientes e inventario
    ├── traspasos.tsx       nuevo traspaso, por recibir y enviados
    ├── panorama.tsx        administración central: vista nacional
    ├── clientes-credito.tsx · catalogo.tsx · consultas.tsx · auditoria.tsx · recuperacion.tsx · fallas.tsx
public/productos/           fotos de los productos (créditos en CREDITOS.md)
```
