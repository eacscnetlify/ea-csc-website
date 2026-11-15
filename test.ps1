Set-Location -LiteralPath 'D:\KOLEHIYO 3RD YEAR\ES7 ENGINEERING MANAGEMENT\EA_CSC_WEBSITE_NEW'

$downloadsFolder = Join-Path $env:USERPROFILE 'Downloads'
$zipPath = Join-Path $downloadsFolder 'EA_CSC_Slice9A_Backend_Update.zip'
$extractFolder = Join-Path $env:TEMP ('EA_CSC_Slice9A_' + (Get-Date -Format 'yyyyMMdd-HHmmss'))

$migrationName = '20261114000400_turnover_controls.sql'
$verificationName = 'verify_slice9a_backend.sql'

if (-not (Test-Path -LiteralPath $zipPath)) {
    throw "ZIP not found: $zipPath"
}

if (Test-Path -LiteralPath "supabase\migrations\$migrationName") {
    throw 'The new migration file already exists. Stop and send me this message.'
}

Expand-Archive -LiteralPath $zipPath -DestinationPath $extractFolder -ErrorAction Stop

Copy-Item `
    -LiteralPath (Join-Path $extractFolder "supabase\migrations\$migrationName") `
    -Destination "supabase\migrations\$migrationName" `
    -ErrorAction Stop

Copy-Item `
    -LiteralPath (Join-Path $extractFolder "supabase\tests\$verificationName") `
    -Destination "supabase\tests\$verificationName" `
    -ErrorAction Stop

Write-Host 'Slice 9A migration and verification files copied successfully.' -ForegroundColor Green
