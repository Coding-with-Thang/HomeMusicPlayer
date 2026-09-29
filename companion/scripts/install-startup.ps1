$ErrorActionPreference = "Stop"
$companionDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = (Get-Command npm).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "start" -WorkingDirectory $companionDirectory
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "HomeAudioPlayerCompanion" -Action $action -Trigger $trigger -Settings $settings -Description "Streams your music library to HomeAudioPlayer over Tailscale." -Force
Write-Host "HomeAudioPlayer Companion will start when you sign in."
