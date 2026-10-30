$ErrorActionPreference = 'Stop'
$fixtureNames = @('AUTHOR', 'CUSTODIAN', 'INACTIVE', 'NO_PROFILE')
$suiteExitCode = 1
try {
    if (-not (Test-Path '.env.local') -or -not (Test-Path 'scripts/batch4-http.mjs')) {
        throw 'Open a terminal in the project root containing .env.local and scripts/batch4-http.mjs.'
    }
    foreach ($fixtureName in $fixtureNames) {
        $fixtureLabel = $fixtureName.ToLower().Replace('_', '-')
        $securePassword = Read-Host "Private password for batch4-$fixtureLabel@example.invalid" -AsSecureString
        $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        try {
            [Environment]::SetEnvironmentVariable("EACSC_HTTP_${fixtureName}_PASSWORD", [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer), 'Process')
        }
        finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
            $securePassword.Dispose()
        }
    }
    & node scripts/batch4-http.mjs
    $suiteExitCode = $LASTEXITCODE
}
finally {
    foreach ($fixtureName in $fixtureNames) {
        [Environment]::SetEnvironmentVariable("EACSC_HTTP_${fixtureName}_PASSWORD", $null, 'Process')
    }
}
exit $suiteExitCode
