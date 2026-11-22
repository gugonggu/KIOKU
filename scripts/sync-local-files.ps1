# The allowlist below and the vault MANIFEST.md must describe the same files.
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Import', 'Export')]
    [string]$Direction,
    [string]$VaultRoot,
    [switch]$Force,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Get-SyncItem([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if ($item.LinkType -in @('SymbolicLink', 'Junction', 'HardLink')) {
        throw "Use a regular file or directory instead of a link: $Path"
    }
    return $item
}

function Assert-DirectoryOrMissing([string]$Path) {
    $item = Get-SyncItem $Path
    if ($item -and -not $item.PSIsContainer) { throw "Expected a directory: $Path" }
}

function Get-ContentHash([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

try {
    if (-not $PSBoundParameters.ContainsKey('VaultRoot')) { $VaultRoot = $env:KIOKU_VAULT_ROOT }
    if ([string]::IsNullOrWhiteSpace($VaultRoot)) {
        throw 'Specify the Obsidian vault root with -VaultRoot or KIOKU_VAULT_ROOT.'
    }
    $vault = Get-SyncItem $VaultRoot
    if (-not $vault -or -not $vault.PSIsContainer -or $vault.PSProvider.Name -ne 'FileSystem') {
        throw 'Vault root must be an existing filesystem directory. Pass the vault itself, not its KIOKU folder.'
    }

    $repoRoot = Split-Path -Parent $PSScriptRoot
    $vaultProject = Join-Path $vault.FullName 'KIOKU'
    $vaultEnv = Join-Path $vaultProject 'env'
    Assert-DirectoryOrMissing $vaultProject
    Assert-DirectoryOrMissing $vaultEnv

    $repoFile = Join-Path $repoRoot '.env.local'
    $vaultFile = Join-Path $vaultEnv 'env.local'
    $source, $destination, $backupRoot = $repoFile, $vaultFile, $vaultProject
    if ($Direction -eq 'Import') {
        $source, $destination, $backupRoot = $vaultFile, $repoFile, $repoRoot
    }
    if ($source -eq $destination) { throw 'The source and destination must be different files.' }

    $sourceItem = Get-SyncItem $source
    if (-not $sourceItem -or $sourceItem.PSIsContainer) { throw "Required source file is missing or invalid: $source" }
    $destinationItem = Get-SyncItem $destination
    if ($destinationItem -and $destinationItem.PSIsContainer) { throw "Expected a destination file: $destination" }

    $sourceHash = Get-ContentHash $source
    $destinationHash = $null
    if ($destinationItem) {
        $destinationHash = Get-ContentHash $destination
        if ($sourceHash -eq $destinationHash) {
            Write-Host "Already identical: $destination"
            return
        }
        if (-not $Force) { throw "Destination differs: $destination. Use -Force to back up and replace it." }
    }

    $backupDir = Join-Path $backupRoot '.kioku-local-backups'
    if ($destinationItem) { Assert-DirectoryOrMissing $backupDir }
    if ($DryRun) {
        if ($destinationItem) {
            Write-Host "Would back up and replace: $source -> $destination (backup in $backupDir)"
        } else {
            Write-Host "Would copy: $source -> $destination"
        }
        return
    }

    $destinationDir = Split-Path -Parent $destination
    [void][IO.Directory]::CreateDirectory($destinationDir)
    $copyId = [guid]::NewGuid().ToString('N')
    $pendingCopy = Join-Path $destinationDir ".env.local.sync-$copyId.tmp"
    try {
        [IO.File]::Copy($source, $pendingCopy)
        if ((Get-ContentHash $pendingCopy) -ne $sourceHash) {
            throw 'Copy verification failed. The source may have changed during the copy.'
        }
        if ($destinationItem) {
            [void][IO.Directory]::CreateDirectory($backupDir)
            $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
            $backup = Join-Path $backupDir ".env.local.$stamp.$copyId.bak"
            if ((Get-ContentHash $destination) -ne $destinationHash) {
                throw 'Destination changed during the copy. Retry after checking both files.'
            }
            [IO.File]::Replace($pendingCopy, $destination, $backup)
            Write-Host "Backup saved: $backup"
        } else {
            # Move fails if a destination file appeared during the copy.
            [IO.File]::Move($pendingCopy, $destination)
        }
        if ((Get-ContentHash $destination) -ne $sourceHash) { throw "Destination verification failed: $destination" }
        if ($destinationItem) {
            Write-Host "Replaced and verified: $destination"
        } else {
            Write-Host "Copied and verified: $destination"
        }
    } finally {
        if ([IO.File]::Exists($pendingCopy)) { [IO.File]::Delete($pendingCopy) }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
