$ErrorActionPreference = "Stop"
$dataDir = "C:\Users\ralfs\OneDrive\Documents\Claude\webshop\data"
$rows = Import-Csv -Path (Join-Path $dataDir "produkte.csv") -Encoding UTF8

$headers = "ArtikelNr","Bezeichnung","Hersteller","Land","Qualitaet","Gebinde","PreisInklMwst","EntMwst","MwstSatz"

function SlugFile([string]$kat) {
  $slug = $kat.ToLower()
  $slug = $slug -replace [string][char]0x00E4,'ae' -replace [string][char]0x00F6,'oe' -replace [string][char]0x00FC,'ue'
  $slug = ($slug -replace '[^a-z0-9]+','-').Trim('-')
  return "$slug.csv"
}

$cats = $rows | Select-Object -ExpandProperty Kategorie -Unique
foreach ($kat in $cats) {
  $sub = $rows | Where-Object { $_.Kategorie -eq $kat } | Select-Object $headers
  $fname = SlugFile $kat
  $outFile = Join-Path $dataDir $fname
  $sub | Export-Csv -Path $outFile -NoTypeInformation -Encoding UTF8
  Write-Output "$kat -> $fname : $($sub.Count) Artikel"
}
