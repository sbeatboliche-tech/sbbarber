const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const APP_URL = 'https://sbeatboliche-tech.github.io/sbbarber/recepcionista/'

// Los links que abren otra ventana van a Chrome aunque el navegador predeterminado de Windows sea
// Internet Explorer / Edge. Si Chrome no está instalado, se usa el predeterminado.
function rutaChrome() {
    const e = process.env
    return [
        e.PROGRAMFILES && path.join(e.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
        e['PROGRAMFILES(X86)'] && path.join(e['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
        e.LOCALAPPDATA && path.join(e.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    ].find(p => p && fs.existsSync(p))
}

function abrirEnChrome(url) {
    if (!/^https?:\/\//i.test(url)) return shell.openExternal(url) // mailto:, whatsapp:, etc.
    const chrome = process.platform === 'win32' && rutaChrome()
    if (!chrome) return shell.openExternal(url)
    try {
        spawn(chrome, [url], { detached: true, stdio: 'ignore' }).unref()
    } catch {
        shell.openExternal(url)
    }
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 900,
        minHeight: 600,
        title: 'SB Barber — Recepción',
        icon: __dirname + '/build/icon.png',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
        backgroundColor: '#0f1115',
        show: false,
    })

    win.setMenuBarVisibility(false)
    // Borra la caché HTTP (no los datos ni la sesión) antes de cargar: si no, después de un push
    // la app seguía mostrando la versión vieja de recepcionista
    win.webContents.session.clearCache().finally(() => win.loadURL(APP_URL))

    win.once('ready-to-show', () => win.show())

    // Abrir links externos en Chrome (ver abrirEnChrome)
    win.webContents.setWindowOpenHandler(({ url }) => {
        abrirEnChrome(url)
        return { action: 'deny' }
    })

    // Las descargas (ej. foto de los perdidos) se guardan directo en el Escritorio, sin preguntar
    win.webContents.session.on('will-download', (_e, item) => {
        const ext = path.extname(item.getFilename())
        const base = path.basename(item.getFilename(), ext)
        let destino = path.join(app.getPath('desktop'), base + ext)
        for (let i = 1; fs.existsSync(destino); i++) destino = path.join(app.getPath('desktop'), `${base} (${i})${ext}`)
        item.setSavePath(destino)
        item.once('done', (_ev, state) => { if (state === 'completed') shell.showItemInFolder(destino) })
    })

    win.webContents.on('did-fail-load', () => {
        win.loadFile(__dirname + '/offline.html')
    })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
