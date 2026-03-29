# Zelqor CLI installer for Windows — https://zelqor.pl
# Usage: irm https://zelqor.pl/install.ps1 | iex
$ErrorActionPreference = "Stop"

$Repo = "qwizi/zelqor"
$Binary = "zelqor"
$InstallDir = if ($env:ZELQOR_INSTALL_DIR) { $env:ZELQOR_INSTALL_DIR } else { "$env:USERPROFILE\.local\bin" }

# --- Detect architecture ---
$Arch = if ([Environment]::Is64BitOperatingSystem) { "x86_64" } else { "i686" }
$Target = "windows-${Arch}"

# --- Fetch latest release ---
Write-Host "Detecting latest version..."
$Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing
$Version = $Release.tag_name
Write-Host "Latest version: $Version"

# --- Download ---
$Asset = "${Binary}-${Target}.zip"
$Url = "https://github.com/$Repo/releases/download/$Version/$Asset"

Write-Host "Downloading $Asset..."
$TmpDir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "zelqor-install-$(Get-Random)")
$ZipPath = Join-Path $TmpDir.FullName $Asset

Invoke-WebRequest -Uri $Url -OutFile $ZipPath -UseBasicParsing
Expand-Archive -Path $ZipPath -DestinationPath $TmpDir.FullName -Force

# --- Install ---
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Move-Item -Path (Join-Path $TmpDir.FullName "${Binary}.exe") -Destination (Join-Path $InstallDir "${Binary}.exe") -Force

# --- Cleanup ---
Remove-Item -Recurse -Force $TmpDir.FullName

Write-Host ""
Write-Host "Zelqor CLI $Version installed to $InstallDir\${Binary}.exe"

# --- Check PATH ---
$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($CurrentPath -notlike "*$InstallDir*") {
    Write-Host ""
    Write-Host "Adding $InstallDir to your PATH..."
    [Environment]::SetEnvironmentVariable("Path", "$CurrentPath;$InstallDir", "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Host "PATH updated. Restart your terminal to apply."
}

Write-Host ""
Write-Host "Run 'zelqor doctor' to verify your setup."
