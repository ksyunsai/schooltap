[CmdletBinding()]
param(
    [string]$AndroidSdk,
    [string]$Jdk,
    [string]$Keystore
)

$ErrorActionPreference = 'Stop'
$isWindowsHost = [IO.Path]::DirectorySeparatorChar -eq '\'
$executableSuffix = if ($isWindowsHost) { '.exe' } else { '' }
$projectRoot = $PSScriptRoot
$sourceRoot = Join-Path $projectRoot 'app/src/main'

if (!$AndroidSdk) { $AndroidSdk = $env:ANDROID_HOME }
if (!$AndroidSdk) { $AndroidSdk = $env:ANDROID_SDK_ROOT }
if (!$AndroidSdk -and $env:LOCALAPPDATA) { $AndroidSdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
if (!$AndroidSdk -or !(Test-Path -LiteralPath $AndroidSdk -PathType Container)) {
    throw 'Android SDK required. Set ANDROID_HOME or pass -AndroidSdk.'
}
if (!$Jdk) { $Jdk = $env:JAVA_HOME }
if (!$Jdk) {
    $javacCommand = Get-Command "javac$executableSuffix" -ErrorAction SilentlyContinue
    if ($javacCommand) { $Jdk = Split-Path -Parent (Split-Path -Parent $javacCommand.Source) }
}
if (!$Jdk -and $env:ProgramFiles) { $Jdk = Join-Path $env:ProgramFiles 'Android/Android Studio/jbr' }
if (!$Jdk -or !(Test-Path -LiteralPath (Join-Path $Jdk "bin/javac$executableSuffix") -PathType Leaf)) {
    throw 'A full JDK 17 or 21 is required. Set JAVA_HOME or pass -Jdk.'
}

$tools = Join-Path $AndroidSdk 'build-tools/36.0.0'
$platform = @('android-36', 'android-36.0', 'android-37.0', 'android-37') |
    ForEach-Object { Join-Path $AndroidSdk "platforms/$_/android.jar" } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (!$platform -or !(Test-Path -LiteralPath (Join-Path $tools 'lib/d8.jar'))) {
    throw 'Install Android SDK Platform 36 (or 37) and Build-Tools 36.0.0.'
}
if (!$Keystore) {
    $standardDebugKey = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.android/debug.keystore'
    if (Test-Path -LiteralPath $standardDebugKey -PathType Leaf) {
        $Keystore = $standardDebugKey
    } else {
        $keyRoot = [Environment]::GetFolderPath('LocalApplicationData')
        if (!$keyRoot) { $keyRoot = [IO.Path]::GetTempPath() }
        $keyDirectory = Join-Path $keyRoot 'SchoolTapPilot'
        try { [void][IO.Directory]::CreateDirectory($keyDirectory) }
        catch [UnauthorizedAccessException] {
            $keyDirectory = Join-Path ([IO.Path]::GetTempPath()) 'SchoolTapPilot'
            [void][IO.Directory]::CreateDirectory($keyDirectory)
        }
        $Keystore = Join-Path $keyDirectory 'debug.keystore'
    }
}

function Invoke-Checked([string]$command, [string[]]$arguments) {
    & $command @arguments
    if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($command)) failed (exit $LASTEXITCODE)." }
}
function Get-JdkTool([string]$name) { return (Join-Path $Jdk "bin/$name$executableSuffix") }
function Get-SdkTool([string]$name) { return (Join-Path $tools "$name$executableSuffix") }

$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$buildToken = 'schooltap-build-' + [Guid]::NewGuid().ToString('N')
$scratch = Join-Path $tempParent $buildToken
$outputDirectory = Join-Path $projectRoot 'build'
$output = Join-Path $outputDirectory 'SchoolTap-Reader-debug.apk'
[void][IO.Directory]::CreateDirectory($scratch)
try {
    $classes = Join-Path $scratch 'classes'
    $generated = Join-Path $scratch 'generated'
    $dexDirectory = Join-Path $scratch 'dex'
    foreach ($directory in @($classes, $generated, $dexDirectory, $outputDirectory)) {
        [void][IO.Directory]::CreateDirectory($directory)
    }

    # AGP derives the manifest package from the namespace. aapt2 requires it explicitly.
    [xml]$manifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'AndroidManifest.xml') -Raw -Encoding UTF8
    $manifest.DocumentElement.SetAttribute('package', 'kr.schooltap.reader')
    $manifestFile = Join-Path $scratch 'AndroidManifest.xml'
    $manifest.Save($manifestFile)
    $resourceZip = Join-Path $scratch 'resources.zip'
    $resourceApk = Join-Path $scratch 'resources.apk'
    Invoke-Checked (Get-SdkTool 'aapt2') @('compile', '--dir', (Join-Path $sourceRoot 'res'), '-o', $resourceZip)
    Invoke-Checked (Get-SdkTool 'aapt2') @('link', '--manifest', $manifestFile, '-I', $platform, '-A', (Join-Path $sourceRoot 'assets'),
        '--min-sdk-version', '24', '--target-sdk-version', '36', '--version-code', '1', '--version-name', '0.1.0',
        '--debug-mode', '--java', $generated, '-o', $resourceApk, $resourceZip)

    $sources = Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'java'), $generated -Recurse -File -Filter '*.java'
    $bootPath = $platform + [IO.Path]::PathSeparator + (Join-Path $tools 'core-lambda-stubs.jar')
    $javacArgs = @('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', $bootPath, '-d', $classes)
    Invoke-Checked (Get-JdkTool 'javac') ($javacArgs + @($sources.FullName))
    $classesJar = Join-Path $scratch 'classes.jar'
    Invoke-Checked (Get-JdkTool 'jar') @('cf', $classesJar, '-C', $classes, '.')
    Invoke-Checked (Get-JdkTool 'java') @('-cp', (Join-Path $tools 'lib/d8.jar'), 'com.android.tools.r8.D8',
        '--min-api', '24', '--lib', $platform, '--output', $dexDirectory, $classesJar)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::Open($resourceApk, [IO.Compression.ZipArchiveMode]::Update)
    try {
        foreach ($dex in Get-ChildItem -LiteralPath $dexDirectory -Filter '*.dex' -File) {
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $dex.FullName, $dex.Name)
        }
    } finally { $archive.Dispose() }
    $aligned = Join-Path $scratch 'aligned.apk'
    Invoke-Checked (Get-SdkTool 'zipalign') @('-p', '-f', '4', $resourceApk, $aligned)

    if (!(Test-Path -LiteralPath $Keystore -PathType Leaf)) {
        $newKey = [IO.Path]::GetFullPath($Keystore) + '.' + [Guid]::NewGuid().ToString('N')
        try {
            Invoke-Checked (Get-JdkTool 'keytool') @('-genkeypair', '-keystore', $newKey, '-storetype', 'JKS',
                '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-keyalg', 'RSA',
                '-keysize', '2048', '-validity', '10000', '-dname', 'CN=SchoolTap Pilot, O=SchoolTap, C=KR')
            try { [IO.File]::Move($newKey, [IO.Path]::GetFullPath($Keystore)) }
            catch [IO.IOException] { if (!(Test-Path -LiteralPath $Keystore -PathType Leaf)) { throw } }
        } finally {
            if ([IO.File]::Exists($newKey)) { [IO.File]::Delete($newKey) }
        }
    }
    $signed = Join-Path $scratch 'signed.apk'
    $signerJar = Join-Path $tools 'lib/apksigner.jar'
    Invoke-Checked (Get-JdkTool 'java') @('-jar', $signerJar, 'sign', '--ks', $Keystore, '--ks-key-alias',
        'androiddebugkey', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--v4-signing-enabled', 'false', '--out', $signed, $aligned)
    Invoke-Checked (Get-JdkTool 'java') @('-jar', $signerJar, 'verify', '--verbose', $signed)
    Copy-Item -LiteralPath $signed -Destination $output -Force
    Write-Output "Verified debug APK: $output"
} finally {
    $resolved = [IO.Path]::GetFullPath($scratch)
    if ([IO.Path]::GetDirectoryName($resolved) -eq $tempParent -and [IO.Path]::GetFileName($resolved) -eq $buildToken) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
