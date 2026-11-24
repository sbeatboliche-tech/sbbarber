# Imprime una foto (o un PDF) en la impresora indicada, o en la predeterminada de Windows.
# La foto se ajusta a la hoja sin recortar, centrada, y se gira la hoja si la foto es apaisada.
param(
    [Parameter(Mandatory = $true)][string]$Archivo,
    [int]$Copias = 1,
    [string]$Impresora = ''
)
$ErrorActionPreference = 'Stop'
if ($Copias -lt 1) { $Copias = 1 }

if ($Archivo -match '\.pdf$') {
    # Los PDF los imprime el programa que los abre (Adobe, Edge, etc.)
    for ($i = 0; $i -lt $Copias; $i++) {
        if ($Impresora) { Start-Process -FilePath $Archivo -Verb PrintTo -ArgumentList "`"$Impresora`"" -WindowStyle Hidden }
        else { Start-Process -FilePath $Archivo -Verb Print -WindowStyle Hidden }
    }
    exit 0
}

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($Archivo)
try {
    # La foto del celu puede venir rotada por EXIF: se endereza antes de imprimir
    if ($img.PropertyIdList -contains 0x0112) {
        switch ([int]$img.GetPropertyItem(0x0112).Value[0]) {
            3 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
            6 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
            8 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
        }
    }
    for ($i = 0; $i -lt $Copias; $i++) {
        $pd = New-Object System.Drawing.Printing.PrintDocument
        if ($Impresora) { $pd.PrinterSettings.PrinterName = $Impresora }
        if (-not $pd.PrinterSettings.IsValid) { throw "No se encontró la impresora '$($pd.PrinterSettings.PrinterName)'" }
        $pd.DocumentName = [System.IO.Path]::GetFileName($Archivo)
        $pd.PrintController = New-Object System.Drawing.Printing.StandardPrintController  # sin ventanita de "Imprimiendo"
        $pd.DefaultPageSettings.Landscape = ($img.Width -gt $img.Height)
        $pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(15, 15, 15, 15)
        $pd.add_PrintPage({
            param($s, $e)
            $m = $e.MarginBounds
            $escala = [Math]::Min($m.Width / $img.Width, $m.Height / $img.Height)
            $w = [int]($img.Width * $escala); $h = [int]($img.Height * $escala)
            $x = $m.X + [int](($m.Width - $w) / 2); $y = $m.Y + [int](($m.Height - $h) / 2)
            $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $e.Graphics.DrawImage($img, $x, $y, $w, $h)
            $e.HasMorePages = $false
        })
        $pd.Print()
        $pd.Dispose()
    }
} finally {
    $img.Dispose()
}
