param(
    [Parameter(Mandatory = $true)][string]$Apk,
    [string]$Sdk = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA/Android/Sdk" }),
    [string]$Report = ''
)
$ErrorActionPreference = 'Stop'
$apkPath = (Resolve-Path $Apk).Path
$binarySuffix = if ($env:OS -eq 'Windows_NT') { '.exe' } else { '' }
$nativeHost = if ($env:OS -eq 'Windows_NT') { 'windows-x86_64' } elseif ($IsMacOS) { 'darwin-x86_64' } else { 'linux-x86_64' }
$readelf = Join-Path $Sdk "ndk/27.2.12479018/toolchains/llvm/prebuilt/$nativeHost/bin/llvm-readelf$binarySuffix"
$zipalign = Join-Path $Sdk "build-tools/36.0.0/zipalign$binarySuffix"
$scratch = Join-Path (Split-Path $PSScriptRoot) 'work/apk-check'
New-Item -ItemType Directory -Force $scratch | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($apkPath)
try {
    $results = @(foreach ($entry in $zip.Entries) {
        if ($entry.FullName -notmatch '^lib/(arm64-v8a|x86_64)/([^/]+\.so)$') { continue }
        $abi, $library = $Matches[1], $Matches[2]
        $path = Join-Path $scratch "$abi-$library"
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $path, $true)
        $headers = & $readelf -lW $path
        if ($LASTEXITCODE) { throw "Cannot inspect $($entry.FullName)" }
        $loads = @($headers | Where-Object { $_ -match '^\s*LOAD\s' })
        $alignments = @($loads | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique)
        $bad = @($alignments | Where-Object { [Convert]::ToInt64($_, 16) -lt 16384 }).Count
        [PSCustomObject]@{ABI=$abi;Library=$library;Alignment=($alignments -join ',');Pass=($loads.Count -gt 0 -and $bad -eq 0);Bytes=$entry.Length;CompressedBytes=$entry.CompressedLength}
    })
} finally { $zip.Dispose() }
& $zipalign -c -P 16 4 $apkPath
$zipPass = $LASTEXITCODE -eq 0
$pass = $zipPass -and $results.Count -gt 0 -and @($results | Where-Object { !$_.Pass }).Count -eq 0
$summary = [PSCustomObject]@{Apk=$apkPath;Bytes=(Get-Item $apkPath).Length;SHA256=(Get-FileHash $apkPath).Hash;ZipAligned=$zipPass;Pass=$pass;Libraries=$results}
if ($Report) { $summary | ConvertTo-Json -Depth 5 | Set-Content $Report }
$results | Format-Table -AutoSize
if (!$pass) { throw 'APK does not pass the static 16 KB checks. Runtime testing is also required.' }
Write-Output "PASS: $($results.Count) 64-bit libraries and APK ZIP alignment."
