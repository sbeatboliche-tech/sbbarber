# App de iPhone (App Store) — paso a paso

La app de iOS es la misma que la de Android: abre `https://sbbarber.com.ar/panel/` y desde ahí cada uno entra a su
barbería. El proyecto de Xcode está en `ios/` (Capacitor 8, Swift Package Manager, sin CocoaPods).
Lo que ya quedó hecho desde Windows: proyecto `ios/`, ícono y pantalla de inicio negros, permisos (cámara para el
escáner, fotos), notificaciones en segundo plano, español, `ITSAppUsesNonExemptEncryption = false`, y el
`AppDelegate.swift` que convierte el token de Apple en token de Firebase (así el servidor manda igual que a Android).

## Antes de la Mac (una sola vez)

1. **Apple Developer Program** (US$99/año) en developer.apple.com, con el Apple ID del dueño. Tarda 1–2 días.
2. **App en App Store Connect** (appstoreconnect.apple.com → Apps → +): nombre "SB Barber", idioma español,
   bundle ID `com.sbbarber.app` (crearlo antes en developer.apple.com → Identifiers, con *Push Notifications* tildado).
3. **Llave de notificaciones (APNs)**: developer.apple.com → Keys → + → *Apple Push Notifications service* →
   bajar el `.p8` (se baja UNA vez; guardarlo, no subirlo al repo). Anotar el Key ID y el Team ID.
4. **Firebase** (proyecto `sb-barber-6dc16`): Configuración del proyecto →
   - *Tus apps* → agregar app iOS con bundle `com.sbbarber.app` → bajar `GoogleService-Info.plist`.
   - *Cloud Messaging* → *Configuración de apps de Apple* → subir el `.p8` con Key ID y Team ID.

## En la Mac

Necesita Xcode (App Store, gratis), Node 20+ y git.

```bash
git clone https://github.com/sbeatboliche-tech/sbbarber.git && cd sbbarber/app-movil
npm install
npx cap sync ios
npm run ios          # abre Xcode
```

En Xcode (proyecto **App**, target **App**):

1. Arrastrar `GoogleService-Info.plist` a la carpeta `App/App` (tildar *Copy items if needed* y el target App).
2. **File → Add Package Dependencies…** → `https://github.com/firebase/firebase-ios-sdk` → agregar solo
   **FirebaseMessaging** al target App. (Sin esto no compila: `AppDelegate.swift` lo importa.)
3. **Signing & Capabilities**: Team = la cuenta de Apple Developer; *Automatically manage signing*.
   **+ Capability** → **Push Notifications** y **Background Modes** (tildar *Remote notifications*).
4. **General**: Version `1.0.0`, Build `1`; Minimum Deployments iOS 15 o más; Device: iPhone (iPad opcional).
5. Probar en el iPhone por cable (▶), entrar y aceptar las notificaciones. Desde recepcionista (dueños) se puede
   mandar una prueba: `POST /api/push?action=prueba`.
6. **Product → Archive** → *Distribute App* → *App Store Connect* → Upload. A los minutos aparece en
   **TestFlight** para instalarla en el iPhone antes de publicarla.

## Ficha en App Store Connect

- **Categoría**: Negocios. **Precio**: gratis (las barberías pagan por fuera; dentro de la app no hay precios
  ni botones de compra, así Apple no cobra comisión — regla 3.1.3).
- **Privacidad**: URL `https://sbbarber.com.ar/privacidad/`. Datos: email (cuenta), nombre y teléfono de
  clientes que carga la barbería; no se rastrea a nadie ni hay publicidad.
- **Cuenta para la revisión** (*App Review Information*): un admin de la barbería de prueba (`barberias/prueba`),
  con contraseña nueva generada desde ⋮ → Barberías → Barbería de prueba. En notas: "App de gestión para
  barberías. Las cuentas las crea el dueño de cada barbería; no hay registro público".
- **Capturas**: 6,7" (iPhone grande) y 6,5" — recepción, anotar un corte, cierre de caja, stock.
- **Eliminar cuenta**: la app lo tiene (regla 5.1.1(v)); mencionarlo en las notas si lo preguntan.

## Riesgos de la revisión de Apple

- **4.2 (funcionalidad mínima / "solo una web")**: ayudan las notificaciones push y la cámara del escáner.
  Si la rechazan por esto, sumar algo nativo más (por ejemplo widgets o Face ID para entrar).
- Las versiones nuevas de la web se ven sin pasar por Apple (la app carga sbbarber.com.ar). Solo hay que subir
  una versión nueva cuando cambia lo nativo (íconos, permisos, plugins).
