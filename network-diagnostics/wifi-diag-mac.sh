#!/bin/bash
# Wi-Fi / Home Network Diagnostics - macOS (READ-ONLY)
# Makes NO changes to system, router, or DNS settings.
# Does NOT require sudo. Run in Terminal:
#   bash wifi-diag-mac.sh
# Output: ~/Desktop/wifi-diag-report.txt  (about 4-5 minutes)

OUT="$HOME/Desktop/wifi-diag-report.txt"
h() { printf "\n==================== %s ====================\n" "$1"; }

pingstats() {
  # Extract RTTs in order (for jitter), then a sorted copy (for p95). Portable BSD awk.
  TIMES=$(ping -c 50 -i 0.5 "$1" 2>/dev/null | sed -n 's/.*time=\([0-9.]*\).*/\1/p')
  P95=$(printf "%s\n" $TIMES | sort -n | awk '{a[NR]=$1} END{if(NR) print a[int(0.95*(NR-1))+1]}')
  printf "%s\n" $TIMES | awk -v t="$1" -v p95="$P95" '
    NF { v=$1+0; n++; s+=v; if(n==1||v<mn)mn=v; if(v>mx)mx=v; if(n>1){d=v-p; if(d<0)d=-d; j+=d}; p=v }
    END { if(n<2){printf "%-15s FAILED - %d of 50 replies\n", t, n; exit}
          printf "%-15s sent=50 recv=%d loss=%.1f%%  min=%.1fms avg=%.1fms p95=%sms max=%.1fms jitter=%.1fms\n",
                 t, n, 100*(50-n)/50, mn, s/n, p95, mx, j/(n-1) }'
}

{
  echo "Wi-Fi Diagnostics Report - $(date)"

  h "1. OS / ADAPTER / WI-FI LINK"
  sw_vers
  WIFI_IF=$(networksetup -listallhardwareports | awk '/Wi-Fi/{getline; print $2}')
  echo "Wi-Fi interface: $WIFI_IF"
  ipconfig getsummary "$WIFI_IF" 2>/dev/null | grep -E 'SSID|BSSID|Security'
  system_profiler SPAirPortDataType 2>/dev/null | sed -n '/Current Network Information/,/Other Local Wi-Fi Networks/p'
  system_profiler SPAirPortDataType 2>/dev/null | grep -E 'Card Type|Firmware Version|Supported PHY Modes|Supported Channels|Country Code' | head -6

  h "2. NEARBY NETWORKS / CHANNEL CONGESTION"
  echo "(Network names may show as <redacted> unless Terminal has Location permission — channels still count.)"
  system_profiler SPAirPortDataType 2>/dev/null | sed -n '/Other Local Wi-Fi Networks/,$p'
  echo "--- Networks per channel ---"
  system_profiler SPAirPortDataType 2>/dev/null | sed -n '/Other Local Wi-Fi Networks/,$p' | \
    awk '/Channel:/{print $2" "$3}' | sort | uniq -c | sort -k2 -n

  GW=$(route -n get default 2>/dev/null | awk '/gateway/{print $2}')
  h "3-4. PING: ROUTER ($GW) vs INTERNET (50 each)"
  pingstats "$GW"
  pingstats 1.1.1.1
  pingstats 8.8.8.8

  h "5. TRACEROUTE to google.com"
  traceroute -n -m 20 -w 1 -q 2 google.com 2>&1

  h "6. DNS RESOLUTION SPEED (ms, 5 domains each)"
  echo "Current DNS servers:"; scutil --dns | awk '/nameserver\[/{print $3}' | sort -u
  CUR=$(scutil --dns | awk '/nameserver\[0\]/{print $3; exit}')
  for SRV in "$CUR" 1.1.1.1 8.8.8.8; do
    TOT=0; MAX=0
    for D in amazon.com wikipedia.org microsoft.com netflix.com reddit.com; do
      T=$(dig @"$SRV" "$D" +tries=1 +time=3 | awk '/Query time/{print $4}'); T=${T:-3000}
      TOT=$((TOT+T)); [ "$T" -gt "$MAX" ] && MAX=$T
    done
    printf "%-15s avg=%dms max=%dms\n" "$SRV" $((TOT/5)) "$MAX"
  done

  h "7. SPEED TEST (Apple networkQuality, multi-stream)"
  networkQuality -v 2>&1 || echo "networkQuality unavailable (needs macOS 12+)"

  h "8. LOCAL ISSUES"
  echo "--- VPN / tunnel interfaces & configured VPNs ---"
  scutil --nc list 2>/dev/null
  ifconfig | grep -E '^(utun|ipsec|ppp|tun|tap)' | cut -d: -f1
  echo "--- Top processes by network bytes (snapshot) ---"
  nettop -P -L 1 -x -J bytes_in,bytes_out 2>/dev/null | sort -t, -k2 -nr | head -12
  echo "--- Known bandwidth-heavy apps running ---"
  ps -axo comm | grep -iE 'Dropbox|OneDrive|Google Drive|bird|cloudd|Steam|Backblaze|Time Machine|backupd|Transmission|qbittorrent|zoom|Teams' | sort -u
  echo "--- Power settings ---"
  pmset -g | grep -E 'lowpowermode|powernap|networkoversleep|womp'
  pmset -g batt | head -2

  echo; echo "DONE."
} 2>&1 | tee "$OUT"

echo; echo "Report saved to: $OUT"
