# Minimal built-in Windows PowerShell local HTTP server (TcpListener - needs NO admin rights, NO Node, NO Python!)
param([int]$Port = 8080, [switch]$NoBrowser)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = "http://127.0.0.1:$Port/"

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".ico"  = "image/x-icon"
  ".ics"  = "text/calendar; charset=utf-8"
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

Write-Host "KIT StudyFlow laeuft auf $url" -ForegroundColor Green
Write-Host "Fenster offen lassen zum Nutzen. Strg+C zum Beenden." -ForegroundColor Gray
if (-not $NoBrowser) { Start-Process $url }

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $stream.ReadTimeout = 3000
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $reqLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($reqLine)) { continue }

      # Drain request headers
      while ($true) {
        $hdr = $reader.ReadLine()
        if ([string]::IsNullOrEmpty($hdr)) { break }
      }

      $parts = $reqLine.Split(' ')
      $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { "/" }
      $cleanPath = ($rawPath -split '\?')[0].TrimStart('/')
      if ([string]::IsNullOrWhiteSpace($cleanPath)) { $cleanPath = "index.html" }
      $cleanPath = [System.Uri]::UnescapeDataString($cleanPath).Replace('/', '\')
      $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $cleanPath))

      if (-not $fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $fullPath -PathType Leaf)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
        $head = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
        $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
        $stream.Write($headBytes, 0, $headBytes.Length)
        $stream.Write($body, 0, $body.Length)
      } else {
        $ext = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
        $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
        $body = [System.IO.File]::ReadAllBytes($fullPath)
        $head = "HTTP/1.1 200 OK`r`nContent-Type: $mime`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
        $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
        $stream.Write($headBytes, 0, $headBytes.Length)
        $stream.Write($body, 0, $body.Length)
      }
      $stream.Flush()
    } catch {
      # Ignore aborted client connections
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
