$ErrorActionPreference = "Stop"
$srcPath = "C:\Users\ralfs\OneDrive\Documents\Claude\Bodan_Bestellung_26_Juni.xls"
$outPath = "C:\Users\ralfs\OneDrive\Documents\Claude\webshop\img\logo.png"

New-Item -ItemType Directory -Force -Path (Split-Path $outPath) | Out-Null

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $true
$excel.DisplayAlerts = $false
$excel.ScreenUpdating = $true
$wb = $excel.Workbooks.Open($srcPath)
$ws = $wb.Worksheets.Item("Titel")
$ws.Activate()
$shape = $ws.Shapes.Item("Gruppieren 2")
$shape.Select() | Out-Null
Start-Sleep -Milliseconds 800

$shape.CopyPicture(1, 2)  # xlScreen, xlBitmap
Start-Sleep -Milliseconds 1200

$chart = $wb.Charts.Add()
$chart.Activate() | Out-Null
Start-Sleep -Milliseconds 500
$chart.Paste()
Start-Sleep -Milliseconds 800
$chart.Export($outPath, "PNG")
$chart.Delete()

$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
Write-Output "Logo exportiert nach $outPath"
