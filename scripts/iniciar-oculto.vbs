' Abre o SalvaTudo como aplicativo: o servidor roda escondido (sem janela preta)
' e a janela do app abre sozinha. Fechando a janela, o SalvaTudo encerra.
Option Explicit

Dim fso, sh, pasta, codigo
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
pasta = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = pasta

' Node.js instalado?
codigo = sh.Run("cmd /c where node >nul 2>nul", 0, True)
If codigo <> 0 Then
  MsgBox "O Node.js nao esta instalado neste computador." & vbCrLf & vbCrLf & _
         "Baixe a versao LTS em https://nodejs.org, instale e abra o SalvaTudo de novo.", _
         vbExclamation, "SalvaTudo"
  WScript.Quit 1
End If

' Primeira vez: a instalacao precisa mostrar o andamento.
If Not fso.FolderExists(pasta & "\node_modules\express") Then
  sh.Run """" & pasta & "\SalvaTudo.bat""", 1, False
  WScript.Quit 0
End If

' 0 = janela escondida; False = nao espera terminar
sh.Run "node src\server.js --app", 0, False
