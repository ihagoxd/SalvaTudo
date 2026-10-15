# Cria os atalhos do SalvaTudo na área de trabalho e no menu Iniciar,
# com o ícone do app. Pode rodar de novo à vontade: só substitui.
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$alvo = Join-Path $env:WINDIR 'System32\wscript.exe'
$vbs = Join-Path $raiz 'scripts\iniciar-oculto.vbs'
$icone = Join-Path $raiz 'public\icones\salvatudo.ico'

$shell = New-Object -ComObject WScript.Shell
$destinos = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
)

foreach ($pasta in $destinos) {
  if (-not (Test-Path -LiteralPath $pasta)) { continue }
  $lnk = $shell.CreateShortcut((Join-Path $pasta 'SalvaTudo.lnk'))
  $lnk.TargetPath = $alvo
  $lnk.Arguments = '"' + $vbs + '"'
  $lnk.WorkingDirectory = $raiz
  $lnk.IconLocation = "$icone,0"
  $lnk.Description = 'SalvaTudo - videos, musicas e fotos na qualidade original'
  $lnk.Save()
  Write-Host "  Atalho criado: $($lnk.FullName)"
}
