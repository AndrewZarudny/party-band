<#
.SYNOPSIS
  Lets phones and laptops on your Wi-Fi reach Fretwise while it runs inside WSL2.

.DESCRIPTION
  WSL2 (default NAT networking) sits behind a private virtual network, so other devices can't reach
  the dev server directly. This script, run as Administrator:
    1. finds the current WSL address (wsl hostname -I),
    2. forwards port 5173 on this PC's Wi-Fi/Ethernet address to WSL (netsh interface portproxy),
    3. allows TCP 5173 in through Windows Defender Firewall, on Private networks only,
    4. prints the address to open on a phone.

  The WSL address changes after every reboot or "wsl --shutdown", so run it again then.
  Run with -Remove to undo both the forwarding and the firewall rule.

  The forwarding listens on the PC's LAN address(es) only, not 0.0.0.0, so http://localhost:5173 on
  this PC keeps going through WSL's own localhost forwarding. The dev server then sees this PC as
  127.0.0.1 (the host, allowed everything) and every forwarded device as the WSL gateway address
  (a guest, limited to live sessions and accounts).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\windows\wifi-access.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\windows\wifi-access.ps1 -Remove
#>
param(
  [int]$Port = 5173,
  # WSL distro that runs the dev server; empty means the default distro
  [string]$Distro = '',
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$RuleName = "Fretwise dev server (TCP $Port)"
# The dev server reads this to build live-session links and QR codes with this PC's address
# (inside WSL it only knows its own internal address, which phones can't reach).
$LanFile = Join-Path $PSScriptRoot '..\..\.cache\lan-hosts.json'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Existing portproxy v4tov4 rules that listen on our port
function Get-ProxyRules {
  $rules = @()
  foreach ($line in (netsh interface portproxy show v4tov4)) {
    if ($line -match '^\s*(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s*$' -and [int]$Matches[2] -eq $Port) {
      $rules += [pscustomobject]@{ ListenAddress = $Matches[1]; ListenPort = [int]$Matches[2]; ConnectAddress = $Matches[3]; ConnectPort = [int]$Matches[4] }
    }
  }
  return $rules
}

function Remove-ProxyRules {
  foreach ($r in Get-ProxyRules) {
    netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=$($r.ListenAddress) | Out-Null
    Write-Host "  removed forwarding $($r.ListenAddress):$Port -> $($r.ConnectAddress):$($r.ConnectPort)"
  }
}

# This PC's addresses on the local network: adapters that are up and have a default gateway
# (Wi-Fi first). The WSL/Hyper-V virtual adapters have no gateway, so they are left out.
function Get-LanAddresses {
  $configs = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' }
  $sorted = $configs | Sort-Object { if ($_.InterfaceAlias -match 'Wi-?Fi|Wireless|WLAN') { 0 } else { 1 } }
  $out = @()
  foreach ($c in $sorted) {
    foreach ($a in $c.IPv4Address) { $out += [pscustomobject]@{ Alias = $c.InterfaceAlias; Address = $a.IPAddress; Index = $c.InterfaceIndex } }
  }
  return $out
}

if (-not (Test-Admin)) {
  Write-Host 'Run this from an Administrator PowerShell (right-click Windows Terminal or PowerShell > Run as administrator).' -ForegroundColor Red
  exit 1
}

if ($Remove) {
  Write-Host 'Removing Wi-Fi access to Fretwise...'
  Remove-ProxyRules
  $fw = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
  if ($fw) {
    $fw | Remove-NetFirewallRule
    Write-Host "  removed firewall rule '$RuleName'"
  }
  if (Test-Path $LanFile) { Remove-Item $LanFile -Force }
  Write-Host 'Done. Other devices can no longer reach port' $Port 'on this PC.' -ForegroundColor Green
  exit 0
}

# 1. The current WSL address (first one listed)
$wslArgs = @()
if ($Distro) { $wslArgs += @('-d', $Distro) }
$wslArgs += @('--', 'hostname', '-I')
$wslOut = (& wsl.exe @wslArgs) -join ' '
$wslIp = ($wslOut.Trim() -split '\s+' | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -First 1)
if (-not $wslIp) {
  Write-Host "Couldn't get the WSL address from 'wsl hostname -I' (got: '$wslOut'). Is WSL installed and the distro running?" -ForegroundColor Red
  exit 1
}

# 2. This PC's LAN address(es)
$lan = @(Get-LanAddresses)
if ($lan.Count -eq 0) {
  Write-Host "This PC doesn't seem to be on a network (no adapter with a default gateway). Connect to Wi-Fi and try again." -ForegroundColor Red
  exit 1
}

# portproxy needs the IP Helper service
$iph = Get-Service iphlpsvc -ErrorAction SilentlyContinue
if ($iph -and $iph.Status -ne 'Running') {
  Start-Service iphlpsvc
  Write-Host '  started the IP Helper service (needed for port forwarding)'
}

# 3. Forwarding: drop old rules for this port (old WSL or Wi-Fi address), then add one per LAN address
Write-Host "Forwarding port $Port to WSL at ${wslIp}:"
Remove-ProxyRules
foreach ($l in $lan) {
  netsh interface portproxy add v4tov4 listenport=$Port listenaddress=$($l.Address) connectport=$Port connectaddress=$wslIp | Out-Null
  Write-Host "  $($l.Address):$Port -> ${wslIp}:$Port ($($l.Alias))"
}

# 4. Firewall: one inbound rule, Private networks only (home Wi-Fi), added once
if (-not (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $RuleName -Description 'Lets devices on your home Wi-Fi reach the Fretwise dev server. Remove with wifi-access.ps1 -Remove.' `
    -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private | Out-Null
  Write-Host "  added firewall rule '$RuleName' (Private networks only)"
} else {
  Write-Host "  firewall rule '$RuleName' already there"
}

# The rule only applies on networks Windows treats as Private
foreach ($l in $lan) {
  $net = Get-NetConnectionProfile -InterfaceIndex $l.Index -ErrorAction SilentlyContinue
  if ($net -and $net.NetworkCategory -ne 'Private') {
    Write-Host ''
    Write-Host "'$($l.Alias)' ($($net.Name)) is a $($net.NetworkCategory) network, so the firewall still blocks it." -ForegroundColor Yellow
    Write-Host 'If this is your home Wi-Fi, make it Private: Settings > Network & internet > Wi-Fi > (your network) > Network profile type > Private.' -ForegroundColor Yellow
    Write-Host "Or in this window: Set-NetConnectionProfile -InterfaceIndex $($l.Index) -NetworkCategory Private" -ForegroundColor Yellow
  }
}

# Tell the dev server this PC's addresses for live-session links (best effort: forwarding works without it).
try {
  New-Item -ItemType Directory -Force (Split-Path $LanFile) | Out-Null
  $json = ConvertTo-Json -Compress @{ port = $Port; hosts = @($lan | ForEach-Object { $_.Address }) }
  [IO.File]::WriteAllText($LanFile, $json)
  Write-Host '  saved this address for live-session links and QR codes'
} catch {
  Write-Host "  couldn't save the address for live-session links ($($_.Exception.Message)); type the address below on phones instead" -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Ready. Start the app in WSL (npm run dev), then on a phone on the same Wi-Fi open:' -ForegroundColor Green
foreach ($l in $lan) { Write-Host "  http://$($l.Address):$Port" -ForegroundColor Cyan }
Write-Host "Live session links and QR codes now use this address (restart a session that's already running)."
Write-Host 'On this PC keep using http://localhost:5173 (that is how the app knows you are the host).'
Write-Host 'After a reboot or "wsl --shutdown" the WSL address changes: run this script again.'
