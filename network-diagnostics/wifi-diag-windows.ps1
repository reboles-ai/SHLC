# Wi-Fi / Home Network Diagnostics - Windows (READ-ONLY)
# Makes NO changes to system, adapter, router, or DNS settings.
# Does NOT require Administrator. Run in a normal PowerShell window:
#   powershell -ExecutionPolicy Bypass -File .\wifi-diag-windows.ps1
# Output: wifi-diag-report.txt on your Desktop. Takes about 4-5 minutes.

$ErrorActionPreference = 'SilentlyContinue'
$out = Join-Path ([Environment]::GetFolderPath('Desktop')) 'wifi-diag-report.txt'
function H($t) { "`n==================== $t ====================" }

function PingStats($target, $count = 50) {
    $raw = ping -n $count $target
    $times = @()
    foreach ($l in $raw) {
        if ($l -match 'time[=<](\d+)ms') { $times += [int]$Matches[1] }
    }
    $lost = $count - $times.Count
    if ($times.Count -gt 1) {
        $diffs = for ($i = 1; $i -lt $times.Count; $i++) { [math]::Abs($times[$i] - $times[$i-1]) }
        $jit = ($diffs | Measure-Object -Average).Average
        $m = $times | Measure-Object -Average -Minimum -Maximum
        $sorted = $times | Sort-Object
        $p95 = $sorted[[math]::Floor(0.95 * ($sorted.Count - 1))]
        "{0,-15} sent={1} recv={2} loss={3:N1}%  min={4}ms avg={5:N1}ms p95={6}ms max={7}ms jitter={8:N1}ms" -f `
            $target, $count, $times.Count, (100 * $lost / $count), $m.Minimum, $m.Average, $p95, $m.Maximum, $jit
    } else { "{0,-15} FAILED - {1} of {2} replies" -f $target, $times.Count, $count }
}

& {
    "Wi-Fi Diagnostics Report - $(Get-Date)"

    H "1. OS / ADAPTER / WI-FI LINK"
    (Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber | Format-List | Out-String).Trim()
    netsh wlan show interfaces
    "--- Physical adapters ---"
    Get-NetAdapter -Physical | Select-Object Name, InterfaceDescription, Status, LinkSpeed, DriverVersion, DriverDate | Format-Table -AutoSize | Out-String -Width 250
    "--- Wireless driver capabilities (supported bands / Wi-Fi standards) ---"
    netsh wlan show drivers | Select-String -Pattern 'Driver|Vendor|Date|Version|Radio types|Band'

    H "2. NEARBY NETWORKS / CHANNEL CONGESTION"
    "(If this is empty, Windows 11 needs Location Services ON: Settings > Privacy & security > Location)"
    $scan = netsh wlan show networks mode=bssid
    $scan
    "--- Networks per channel (BSSIDs seen) ---"
    $scan | Select-String 'Channel\s+:\s+(\d+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } |
        Group-Object | Sort-Object { [int]$_.Name } | ForEach-Object { "Channel {0,4}: {1} AP(s)" -f $_.Name, $_.Count }

    $gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1).NextHop
    H "3-4. PING: ROUTER ($gw) vs INTERNET (50 each)"
    PingStats $gw
    PingStats '1.1.1.1'
    PingStats '8.8.8.8'

    H "5. TRACEROUTE to google.com"
    tracert -d -h 20 -w 1000 google.com

    H "6. DNS RESOLUTION SPEED (ms, 5 domains each)"
    "Current DNS servers:"
    Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object ServerAddresses | Select-Object InterfaceAlias, ServerAddresses | Format-Table -AutoSize | Out-String
    $domains = 'amazon.com','wikipedia.org','microsoft.com','netflix.com','reddit.com'
    $currentDns = (Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object ServerAddresses | Select-Object -First 1).ServerAddresses[0]
    foreach ($srv in @($currentDns, '1.1.1.1', '8.8.8.8')) {
        $t = foreach ($d in $domains) { (Measure-Command { Resolve-DnsName $d -Server $srv -DnsOnly -NoHostsFile -Type A | Out-Null }).TotalMilliseconds }
        $m = $t | Measure-Object -Average -Maximum
        "{0,-15} avg={1:N0}ms max={2:N0}ms" -f $srv, $m.Average, $m.Maximum
    }

    H "7. SPEED TEST (Cloudflare, single stream)"
    $dl = curl.exe -s -o NUL -w "%{speed_download}" "https://speed.cloudflare.com/__down?bytes=100000000"
    "Download: {0:N1} Mbps" -f ([double]$dl * 8 / 1e6)
    $tmp = Join-Path $env:TEMP 'wifidiag_up.bin'
    [IO.File]::WriteAllBytes($tmp, (New-Object byte[] 25000000))
    $ul = curl.exe -s -o NUL -w "%{speed_upload}" -X POST --data-binary "@$tmp" "https://speed.cloudflare.com/__up"
    Remove-Item $tmp -Force
    "Upload:   {0:N1} Mbps" -f ([double]$ul * 8 / 1e6)
    "(Single-stream test; on plans over ~300 Mbps also run speed.cloudflare.com in a browser for comparison.)"

    H "8. LOCAL ISSUES"
    "--- VPN / virtual adapters ---"
    Get-NetAdapter | Where-Object { $_.InterfaceDescription -match 'VPN|TAP|WireGuard|Tunnel|Cisco|Fortinet|Palo|Zscaler|Nord|Express|Proton|Tailscale' } |
        Select-Object Name, InterfaceDescription, Status | Format-Table -AutoSize | Out-String
    Get-VpnConnection | Select-Object Name, ConnectionStatus | Format-Table -AutoSize | Out-String
    "--- Processes with most open network connections ---"
    Get-NetTCPConnection -State Established | Group-Object OwningProcess | Sort-Object Count -Descending | Select-Object -First 10 |
        ForEach-Object { "{0,4} conns  {1}" -f $_.Count, (Get-Process -Id $_.Name).ProcessName }
    "--- Known bandwidth-heavy apps running ---"
    Get-Process | Where-Object { $_.ProcessName -match 'OneDrive|Dropbox|GoogleDrive|steam|EpicGames|Battle|qbittorrent|utorrent|Teams|zoom|backblaze|carbonite|iCloud' } |
        Select-Object ProcessName -Unique | Format-Table -HideTableHeaders | Out-String
    "--- Delivery Optimization (Windows Update peer sharing) ---"
    Get-DeliveryOptimizationStatus | Select-Object FileId, Status, BytesFromPeers, BytesFromHttp -First 5 | Format-Table | Out-String
    "--- Wi-Fi adapter power / advanced settings ---"
    $wifi = Get-NetAdapter -Physical | Where-Object { $_.InterfaceDescription -match 'Wi-?Fi|Wireless|802\.11|WLAN' } | Select-Object -First 1
    if ($wifi) {
        Get-NetAdapterPowerManagement -Name $wifi.Name | Format-List | Out-String
        Get-NetAdapterAdvancedProperty -Name $wifi.Name | Select-Object DisplayName, DisplayValue | Format-Table -AutoSize | Out-String -Width 200
    }
    "--- Power plan: Wireless Adapter power-saving mode (0=Max Performance ... 3=Max Power Saving) ---"
    powercfg /query SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1
    "--- Power source ---"
    (Get-CimInstance Win32_Battery | Select-Object BatteryStatus, EstimatedChargeRemaining | Format-List | Out-String)

    "`nDONE."
} *>&1 | Tee-Object -FilePath $out

Write-Host "`nReport saved to: $out" -ForegroundColor Green
