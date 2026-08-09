$ErrorActionPreference = "Stop"
$srcPath = "C:\Users\ralfs\OneDrive\Documents\Claude\Bodan_Bestellung_26_Juni.xls"
$outDir  = "C:\Users\ralfs\OneDrive\Documents\Claude\webshop\data"

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open($srcPath)

function CsvEscape($s) {
    if ($null -eq $s) { return "" }
    $s = [string]$s
    if ($s -match '[",\r\n;]') {
        $s = $s -replace '"', '""'
        return '"' + $s + '"'
    }
    return $s
}

$sheets = @(
    @{ Index = 4 },
    @{ Index = 6 },
    @{ Index = 8 },
    @{ Index = 10 },
    @{ Index = 12 }
)

$allRows = New-Object System.Collections.Generic.List[string]
$allRows.Add("Kategorie,ArtikelNr,Bezeichnung,Hersteller,Land,Qualitaet,Gebinde,PreisInklMwst,EntMwst,MwstSatz")

foreach ($s in $sheets) {
    $ws = $wb.Worksheets.Item($s.Index)
    $kategorie = $ws.Name.Replace('-', ' ').Replace('bodan2 ', '')
    Write-Output "Verarbeite: $($ws.Name) -> $kategorie"
    $used = $ws.UsedRange
    $rows = $used.Rows.Count
    $cols = $used.Columns.Count
    $data = $used.Value2   # 2D array, 1-based

    $count = 0
    for ($r = 2; $r -le $rows; $r++) {
        $artNr = $data[$r,1]
        if ([string]::IsNullOrWhiteSpace([string]$artNr)) { continue }
        if ([string]$artNr -eq "0") { continue }   # leere Platzhalterzeilen am Ende der Bodan-Listen

        $bez   = $data[$r,2]
        $hers  = $data[$r,3]
        $land  = $data[$r,4]
        $qual  = $data[$r,5]
        $geb   = $data[$r,6]
        $preis = $data[$r,7]
        $ent   = $data[$r,8]
        $mwst  = $data[$r,9]

        # cells already come back as native doubles from Value2 -- cast directly, never round-trip through string (culture pitfalls)
        $preisNum = if ($preis -eq $null) { 0.0 } else { [double]$preis }
        $entNum   = if ($ent   -eq $null) { 0.0 } else { [double]$ent }
        $mwstNum  = if ($mwst  -eq $null) { 0.0 } else { [double]$mwst }
        if ($mwstNum -lt 1) { $mwstNum = $mwstNum * 100 }  # percentage stored as fraction -> percent

        $inv = [System.Globalization.CultureInfo]::InvariantCulture
        $line = (CsvEscape $kategorie) + "," + (CsvEscape ([string]$artNr)) + "," + (CsvEscape $bez) + "," + (CsvEscape $hers) + "," + (CsvEscape $land) + "," + (CsvEscape $qual) + "," + (CsvEscape $geb) + "," + ($preisNum.ToString("0.####", $inv)) + "," + ($entNum.ToString("0.####", $inv)) + "," + ($mwstNum.ToString("0.####", $inv))
        $allRows.Add($line)
        $count++
    }
    Write-Output "$($s.Name): $count Artikel exportiert"
}

$outFile = Join-Path $outDir "produkte.csv"
[System.IO.File]::WriteAllLines($outFile, $allRows, [System.Text.Encoding]::UTF8)
Write-Output "Geschrieben: $outFile ($($allRows.Count - 1) Zeilen)"

# Zuschläge sheet
$wsZ = $wb.Worksheets.Item(14)
$zRows = New-Object System.Collections.Generic.List[string]
$zRows.Add("Art,Prozentsatz")
for ($r = 1; $r -le 20; $r++) {
    $art = $wsZ.Cells.Item($r,5).Text
    $pct = $wsZ.Cells.Item($r,6).Text
    if ([string]::IsNullOrWhiteSpace($art)) { continue }
    if ($art -eq "Art") { continue }
    $pctNum = 0.0
    $pctClean = $pct -replace '%','' -replace ',', '.'
    [double]::TryParse($pctClean, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$pctNum) | Out-Null
    $zRows.Add((CsvEscape $art) + "," + $pctNum.ToString([System.Globalization.CultureInfo]::InvariantCulture))
}
$outFileZ = Join-Path $outDir "zuschlaege.csv"
[System.IO.File]::WriteAllLines($outFileZ, $zRows, [System.Text.Encoding]::UTF8)
Write-Output "Geschrieben: $outFileZ"
foreach($l in $zRows) { Write-Output $l }

$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()
