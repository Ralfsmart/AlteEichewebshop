Add-Type -AssemblyName System.Drawing
$src = "C:\Users\ralfs\OneDrive\Documents\Claude\webshop\img\logo.png"

$bmp = [System.Drawing.Bitmap]::FromFile($src)
Write-Output "Orig size: $($bmp.Width) x $($bmp.Height)"

$rect = New-Object System.Drawing.Rectangle 0, 0, 430, 440
$cropped = New-Object System.Drawing.Bitmap $rect.Width, $rect.Height
$g = [System.Drawing.Graphics]::FromImage($cropped)
$g.DrawImage($bmp, (New-Object System.Drawing.Rectangle 0, 0, $rect.Width, $rect.Height), $rect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$bmp.Dispose()

$cropped.Save("C:\Users\ralfs\OneDrive\Documents\Claude\webshop\img\logo_cropped.png", [System.Drawing.Imaging.ImageFormat]::Png)
$cropped.Dispose()
Write-Output "Gespeichert: img\logo_cropped.png"
