$ErrorActionPreference = 'Stop'

function Assert-True($Condition, $Message) {
    if (-not $Condition) { throw $Message }
}

function Invoke-Sync([int]$ExpectedExit, [string]$ExpectedStatus, [string[]]$Arguments) {
    $ErrorActionPreference = 'Continue'
    $output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $scriptPath @Arguments 2>&1
    Assert-True ($LASTEXITCODE -eq $ExpectedExit) "Unexpected exit for $Arguments. $output"
    Assert-True (($output | Out-String) -match $ExpectedStatus) "Missing status: $ExpectedStatus"
    Assert-True (($output | Out-String) -notmatch 'fixture-content') 'Sync output disclosed file contents.'
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('kioku-sync-test-' + [guid]::NewGuid().ToString('N'))
$repo = Join-Path $testRoot 'Checkout [test]'
$vault = Join-Path $testRoot 'Alternate vault [test]'
$scripts = Join-Path $repo 'scripts'
$scriptPath = Join-Path $scripts 'sync-local-files.ps1'
$sourceScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/sync-local-files.ps1'
$repoEnv = Join-Path $repo '.env.local'
$vaultEnv = Join-Path $vault 'KIOKU/env/env.local'
$originalVaultRoot = $env:KIOKU_VAULT_ROOT

try {
    [void][IO.Directory]::CreateDirectory($scripts)
    [void][IO.Directory]::CreateDirectory($vault)
    [IO.File]::Copy($sourceScript, $scriptPath)
    [IO.File]::WriteAllText($repoEnv, 'fixture-content-original')
    [IO.File]::WriteAllText((Join-Path $repo '.env.production'), 'fixture-content-excluded')
    $env:KIOKU_VAULT_ROOT = Join-Path $testRoot 'missing vault'

    Invoke-Sync 1 'Vault root must be an existing' @('-Direction', 'Export')
    Invoke-Sync 1 'Required source file' @('-Direction', 'Import', '-VaultRoot', $vault)
    Invoke-Sync 0 'Would copy' @('-Direction', 'Export', '-VaultRoot', $vault, '-DryRun')
    Assert-True (-not [IO.Directory]::Exists((Join-Path $vault 'KIOKU'))) 'Dry run created directories.'

    Invoke-Sync 0 'Copied and verified' @('-Direction', 'Export', '-VaultRoot', $vault)
    Assert-True ([IO.File]::ReadAllText($vaultEnv) -eq 'fixture-content-original') 'Export did not preserve contents.'
    Assert-True (@(Get-ChildItem -Force -LiteralPath (Split-Path -Parent $vaultEnv)).Count -eq 1) 'Export copied an unlisted file.'

    $env:KIOKU_VAULT_ROOT = $vault
    Invoke-Sync 0 'Already identical' @('-Direction', 'Import', '-Force')
    Assert-True (-not [IO.Directory]::Exists((Join-Path $repo '.kioku-local-backups'))) 'Identical file created a backup.'

    [IO.File]::WriteAllText($repoEnv, 'fixture-content-changed')
    Invoke-Sync 1 'Destination differs' @('-Direction', 'Import')
    Invoke-Sync 0 'Would back up and replace' @('-Direction', 'Import', '-Force', '-DryRun')
    Assert-True ([IO.File]::ReadAllText($repoEnv) -eq 'fixture-content-changed') 'Conflict or dry run overwrote the file.'
    Assert-True (-not [IO.Directory]::Exists((Join-Path $repo '.kioku-local-backups'))) 'Dry run created a backup.'

    Invoke-Sync 0 'Replaced and verified' @('-Direction', 'Import', '-Force')
    Assert-True ([IO.File]::ReadAllText($repoEnv) -eq 'fixture-content-original') 'Import did not restore the file.'
    $repoBackup = @(Get-ChildItem -Force -File -LiteralPath (Join-Path $repo '.kioku-local-backups'))
    Assert-True ($repoBackup.Count -eq 1) 'Expected exactly one import backup.'
    Assert-True ([IO.File]::ReadAllText($repoBackup[0].FullName) -eq 'fixture-content-changed') 'Import backup has wrong contents.'

    [IO.File]::WriteAllText($repoEnv, 'fixture-content-export')
    Invoke-Sync 0 'Replaced and verified' @('-Direction', 'Export', '-Force')
    $vaultBackup = @(Get-ChildItem -Force -File -LiteralPath (Join-Path $vault 'KIOKU/.kioku-local-backups'))
    Assert-True ($vaultBackup.Count -eq 1) 'Expected exactly one export backup.'
    Assert-True ([IO.File]::ReadAllText($vaultBackup[0].FullName) -eq 'fixture-content-original') 'Export backup has wrong contents.'
    Assert-True ([IO.File]::ReadAllText($vaultEnv) -eq 'fixture-content-export') 'Forced export did not update the vault.'

    $cleanRepo = Join-Path $testRoot 'New checkout'
    $cleanScripts = Join-Path $cleanRepo 'scripts'
    [void][IO.Directory]::CreateDirectory($cleanScripts)
    $scriptPath = Join-Path $cleanScripts 'sync-local-files.ps1'
    [IO.File]::Copy($sourceScript, $scriptPath)
    Invoke-Sync 0 'Copied and verified' @('-Direction', 'Import')
    Assert-True ([IO.File]::ReadAllText((Join-Path $cleanRepo '.env.local')) -eq 'fixture-content-export') 'Fresh checkout was not restored.'

    Write-Host 'Sync tests passed.'
} finally {
    $env:KIOKU_VAULT_ROOT = $originalVaultRoot
    if ([IO.Directory]::Exists($testRoot) -and (Split-Path -Leaf $testRoot) -match '^kioku-sync-test-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
