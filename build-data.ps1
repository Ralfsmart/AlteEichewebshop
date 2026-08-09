$ErrorActionPreference = "Stop"
$dataDir = "C:\Users\ralfs\OneDrive\Documents\Claude\webshop\data"
$jsDir   = "C:\Users\ralfs\OneDrive\Documents\Claude\webshop\js"

New-Item -ItemType Directory -Force -Path $jsDir | Out-Null

# --- Produkte ---
$rows = Import-Csv -Path (Join-Path $dataDir "produkte.csv") -Encoding UTF8
$products = foreach ($r in $rows) {
    [PSCustomObject]@{
        kat   = $r.Kategorie
        art   = $r.ArtikelNr
        bez   = $r.Bezeichnung
        hers  = $r.Hersteller
        land  = $r.Land
        qual  = $r.Qualitaet
        geb   = $r.Gebinde
        preis = [double]$r.PreisInklMwst
        mwstb = [double]$r.EntMwst
        mwst  = [double]$r.MwstSatz
    }
}
$productsJson = $products | ConvertTo-Json -Depth 3 -Compress
$out = "window.DEFAULT_PRODUCTS = " + $productsJson + ";`n"
[System.IO.File]::WriteAllText((Join-Path $jsDir "data-default.js"), $out, [System.Text.UTF8Encoding]::new($false))
Write-Output "Produkte: $($products.Count) -> js\data-default.js"

# --- Zuschlaege ---
$zrows = Import-Csv -Path (Join-Path $dataDir "zuschlaege.csv") -Encoding UTF8
$surch = foreach ($r in $zrows) {
    [PSCustomObject]@{ art = $r.Art; pct = [double]$r.Prozentsatz }
}
$surchJson = $surch | ConvertTo-Json -Depth 3 -Compress
$out2 = "window.DEFAULT_SURCHARGES = " + $surchJson + ";`n"
[System.IO.File]::AppendAllText((Join-Path $jsDir "data-default.js"), $out2, [System.Text.UTF8Encoding]::new($false))
Write-Output "Zuschlaege: $($surch.Count) -> js\data-default.js"
