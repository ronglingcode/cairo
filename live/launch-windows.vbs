Option Explicit

Dim files, shell, appFolder, pointer, reader, executable
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
appFolder = files.GetParentFolderName(WScript.ScriptFullName)
pointer = files.BuildPath(appFolder, "release\latest-windows.txt")

If Not files.FileExists(pointer) Then
    MsgBox "Build Cairo Live with npm run package first.", vbExclamation, "Cairo Live"
    WScript.Quit 1
End If

Set reader = files.OpenTextFile(pointer, 1, False, -1)
executable = reader.ReadLine()
reader.Close
If Not files.FileExists(executable) Then
    MsgBox "The latest Cairo Live build is missing. Run npm run package again.", vbExclamation, "Cairo Live"
    WScript.Quit 1
End If

shell.CurrentDirectory = files.GetParentFolderName(executable)
shell.Run Chr(34) & executable & Chr(34), 1, False
