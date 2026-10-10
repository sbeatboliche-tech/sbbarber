const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const fs = require('fs')

const APP_URL = 'https://sbeatboliche-tech.github.io/sbbarber/recepcionista/'

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
    win.loadURL(APP_URL)

    win.once('ready-to-show', () => win.show())

    // Abrir links externos en el browser del sistema
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url)
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
