const { app, BrowserWindow, shell } = require('electron')

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
