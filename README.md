# SB Barber — Sistema Digital

Ecosistema web de la barbería **SB Barber** (Dávila 951, CABA).  
Aplicaciones estáticas en HTML puro con Firebase como backend.

---

## Estructura del proyecto

```
sbbarber/
├── index.html            → Landing pública (link en bio de Instagram)
├── pro/
│   └── index.html        → SB Barber Pro (app interna para barberos y admins)
├── recepcionista/
│   └── index.html        → App de recepción (en desarrollo)
└── turnos/
    └── index.html        → Reservas online para clientes (próximamente)
```

## Apps

| App | URL | Acceso |
|---|---|---|
| Landing / Link in bio | `/` | Público |
| SB Barber Pro | `/pro/` | Barberos y admins |
| Recepción | `/recepcionista/` | Recepcionistas |
| Turnos | `/turnos/` | Clientes |

## Tecnologías

- HTML + CSS + JavaScript vanilla
- [Tailwind CSS](https://tailwindcss.com/) (via CDN)
- [Firebase](https://firebase.google.com/) — Auth + Firestore
- [Font Awesome](https://fontawesome.com/) (via CDN)
- Hosting: GitHub Pages

## Despliegue

El proyecto se sirve directamente desde GitHub Pages.  
Cada push a `main` actualiza el sitio automáticamente.
