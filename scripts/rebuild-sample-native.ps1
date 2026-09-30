param(
    [string]$Sdk = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA/Android/Sdk" }),
    [string]$NdkVersion = '27.2.12479018'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$work = Join-Path $root 'work'
$ndk = Join-Path $Sdk "ndk/$NdkVersion"
$binarySuffix = if ($env:OS -eq 'Windows_NT') { '.exe' } else { '' }
$cmake = Join-Path $Sdk "cmake/3.22.1/bin/cmake$binarySuffix"
$ninja = Join-Path $Sdk "cmake/3.22.1/bin/ninja$binarySuffix"
if (!(Test-Path "$env:JAVA_HOME/include/jvmti.h")) { throw 'Set JAVA_HOME to a JDK (17 recommended).' }
New-Item -ItemType Directory -Force $work | Out-Null

function Fetch-Archive($name, $url, $sha) {
    $archive = Join-Path $work "$name.tar.gz"
    if (!(Test-Path $archive)) { Invoke-WebRequest $url -OutFile $archive }
    if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne $sha) { throw "Checksum mismatch: $name" }
    if (!(Test-Path (Join-Path $work $name))) {
        & tar -xzf $archive -C $work
        if ($LASTEXITCODE) { throw "Cannot extract $name" }
    }
}
Fetch-Archive 'yoga-2.0.1' 'https://github.com/facebook/yoga/archive/refs/tags/v2.0.1.tar.gz' '4C80663B557027CDAA6A836CC087D735BB149B8FF27CBE8442FC5E09CEC5ED92'
Fetch-Archive 'litho-0.50.1' 'https://github.com/facebook/litho/archive/refs/tags/v0.50.1.tar.gz' '37ABC94F8EFD522BBF1F29144E84595BD2540F18BDA20C2C6270D5FAB0813049'
Fetch-Archive 'fresco-3.1.3' 'https://github.com/facebook/fresco/archive/refs/tags/v3.1.3.tar.gz' '97C2F1DC49DF7D9C8A2C350ECF5FA65AC5F6D7425F0AA1DFA2190545CBE75346'
Fetch-Archive 'libjpeg-turbo-1.5.3' 'https://github.com/libjpeg-turbo/libjpeg-turbo/archive/refs/tags/1.5.3.tar.gz' '1A17020F859CB12711175A67EAB5C71FC1904E04B587046218E36106E07EABDE'

# AndroidX's native library keeps the JNI API of the bundled inspection AAR.
$androidxCommit = '7149a4f1503ff96028c91e147e81bfacfef87eb2'
$nativePath = 'inspection/inspection/src/main/native'
$nativeRoot = Join-Path $work "androidx/$nativePath"
$marker = Join-Path $nativeRoot '.source-commit'
if (!(Test-Path $marker) -or (Get-Content $marker -Raw).Trim() -ne $androidxCommit) {
    $parent = Invoke-RestMethod "https://api.github.com/repos/androidx/androidx/contents/inspection/inspection/src/main?ref=$androidxCommit"
    $native = $parent | Where-Object name -eq 'native'
    $tree = Invoke-RestMethod "https://api.github.com/repos/androidx/androidx/git/trees/$($native.sha)?recursive=1"
    foreach ($entry in ($tree.tree | Where-Object type -eq 'blob')) {
        $destination = Join-Path $nativeRoot $entry.path
        New-Item -ItemType Directory -Force (Split-Path $destination) | Out-Null
        Invoke-WebRequest "https://raw.githubusercontent.com/androidx/androidx/$androidxCommit/$nativePath/$($entry.path)" -OutFile $destination
    }
    Set-Content $marker $androidxCommit
}
$dexter = Join-Path $work 'dexter'
$dexterCommit = 'd992a222ec28b56efa29f9104db060379298049c'
if (!(Test-Path "$dexter/.git")) {
    & git clone https://android.googlesource.com/platform/tools/dexter $dexter
    if ($LASTEXITCODE) { throw 'Cannot fetch dexter' }
}
& git -C $dexter checkout --detach $dexterCommit
if ($LASTEXITCODE) { throw 'Cannot select pinned dexter revision' }

$abis = @('x86_64', 'arm64-v8a', 'x86', 'armeabi-v7a')
$buildRoot = Join-Path $work 'native-build/all'
foreach ($abi in $abis) {
    $build = Join-Path $buildRoot $abi
    & $cmake -S "$PSScriptRoot/native-16k" -B $build -G Ninja "-DCMAKE_MAKE_PROGRAM=$ninja" "-DCMAKE_TOOLCHAIN_FILE=$ndk/build/cmake/android.toolchain.cmake" "-DSOURCE_ROOT=$work" "-DANDROID_ABI=$abi" -DANDROID_PLATFORM=android-21 -DANDROID_STL=c++_shared -DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON -DCMAKE_BUILD_TYPE=Release
    if ($LASTEXITCODE) { throw "CMake configure failed: $abi" }
    & $cmake --build $build --target yoga flexlayout imagepipeline native-filters native-imagetranscoder art_tooling -j 8
    if ($LASTEXITCODE) { throw "Native compilation failed: $abi" }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$repository = Join-Path $root 'android/third-party/generated-16k/maven'
function Repack-Aar($source, $destination, $library, $relativeLibrary) {
    $inputZip = [IO.Compression.ZipFile]::OpenRead($source)
    $outFile = [IO.File]::Create($destination)
    $outputZip = [IO.Compression.ZipArchive]::new($outFile, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($entry in $inputZip.Entries) {
            if ($entry.FullName.EndsWith('/')) { continue }
            if ($entry.FullName -match "^jni/([^/]+)/$([regex]::Escape($library))$") {
                $abi = $Matches[1]
                [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($outputZip, (Join-Path $buildRoot "$abi/$relativeLibrary"), $entry.FullName) | Out-Null
            } elseif ($entry.FullName -match '^jni/([^/]+)/libc\+\+_shared.so$') {
                # fbjni 0.7 supplies the compatible shared C++ runtime consistently.
                continue
            } else {
                $newEntry = $outputZip.CreateEntry($entry.FullName)
                $inputStream = $entry.Open()
                $outputStream = $newEntry.Open()
                try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
            }
        }
    } finally { $outputZip.Dispose(); $outFile.Dispose(); $inputZip.Dispose() }
}
$modules = @(
    @('com.facebook.yoga', 'yoga', '2.0.1', 'libyoga.so', 'yoga/libyoga.so'),
    @('com.facebook.litho', 'litho-flexlayout', '0.50.1', 'libflexlayout.so', 'libflexlayout.so'),
    @('com.facebook.fresco', 'imagepipeline-native', '3.1.3', 'libimagepipeline.so', 'libimagepipeline.so'),
    @('com.facebook.fresco', 'nativeimagefilters', '3.1.3', 'libnative-filters.so', 'libnative-filters.so'),
    @('com.facebook.fresco', 'nativeimagetranscoder', '3.1.3', 'libnative-imagetranscoder.so', 'libnative-imagetranscoder.so')
)
foreach ($module in $modules) {
    $group, $artifact, $version, $library, $relativeLibrary = $module
    $groupPath = $group.Replace('.', '/')
    $downloadRoot = Join-Path $work "native-aars/$artifact"
    New-Item -ItemType Directory -Force $downloadRoot | Out-Null
    foreach ($extension in @('aar', 'pom')) {
        $file = Join-Path $downloadRoot "$artifact-$version.$extension"
        if (!(Test-Path $file)) {
            $classifier = if ($artifact -eq 'yoga' -and $extension -eq 'aar') { '-debug' } else { '' }
            Invoke-WebRequest "https://repo.maven.apache.org/maven2/$groupPath/$artifact/$version/$artifact-$version$classifier.$extension" -OutFile $file
        }
    }
    $newVersion = "$version-16k"
    $destination = Join-Path $repository "$groupPath/$artifact/$newVersion"
    New-Item -ItemType Directory -Force $destination | Out-Null
    Repack-Aar "$downloadRoot/$artifact-$version.aar" "$destination/$artifact-$newVersion.aar" $library $relativeLibrary
    [xml]$pom = Get-Content "$downloadRoot/$artifact-$version.pom"
    $pom.project.version = $newVersion
    $pom.project.packaging = 'aar'
    $pom.Save((Join-Path $destination "$artifact-$newVersion.pom"))
}
$inspectionOutput = Join-Path $root 'android/third-party/generated-16k/inspection-16k.aar'
New-Item -ItemType Directory -Force (Split-Path $inspectionOutput) | Out-Null
Repack-Aar (Join-Path $root 'android/plugins/inspection-lib/inspection-1.0.0.aar') $inspectionOutput 'libart_tooling.so' 'libart_tooling.so'
Write-Output 'Native AARs rebuilt for all four ABIs.'
