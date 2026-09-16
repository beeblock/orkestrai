export const WINDOWS_ACCESSIBILITY_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Focus{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);}'
try {
  $r=ConvertFrom-Json ([Console]::In.ReadToEnd())
  if($r.targetId -notmatch '^\d+$'){throw 'target_changed'}
  $handle=[IntPtr]::new([Int64]$r.targetId)
  $root=[Windows.Automation.AutomationElement]::FromHandle($handle)
  $process=Get-Process -Id $root.Current.ProcessId
  if($process.ProcessName -ine $r.appId){throw 'target_changed'}
  function Check-Target {
    $owner=0
    if([Focus]::GetWindowThreadProcessId($handle,[ref]$owner) -eq 0 -or $owner -ne $process.Id -or $root.Current.ProcessId -ne $process.Id){throw 'target_changed'}
  }
  function Check-Focus {if([Focus]::GetForegroundWindow() -ne $handle){throw 'focus_changed'}}
  function Check-Interaction {Check-Target;if($r.background -ne $true){Check-Focus}}
  Check-Target
  if($r.action){Check-Interaction}
  $walker=[Windows.Automation.TreeWalker]::ControlViewWalker
  function Entry($element,$id,$strict=$false){
    $current=$element.Current
    $protectedValue=$current.IsPassword
    $actions=@();$value='';$name=''
    if(-not $protectedValue){
      $name=$current.Name;if($name.Length -gt 2000){if($strict){throw 'element_changed'};$name=$name.Substring(0,2000)}
      $pattern=$null
      if($element.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){
        $value=$pattern.Current.Value;if($value.Length -gt 20000){if($strict){throw 'element_changed'};$value=$value.Substring(0,20000)}
        if(-not $pattern.Current.IsReadOnly){$actions+='fill'}
      }
      $pattern=$null
      if($element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){$actions+='press'}
    }
    return @{id=$id;role=$current.ControlType.ProgrammaticName;name=$name;value=$value;protected=$protectedValue;enabled=$current.IsEnabled;focused=$current.HasKeyboardFocus;actions=@($actions)}
  }
  function Resolve-Element($selector){
    $element=$root
    foreach($part in @($selector.id.Split('.')|Select-Object -Skip 1)){
      $child=$walker.GetFirstChild($element)
      for($i=0;$i -lt [int]$part -and $null -ne $child;$i++){$child=$walker.GetNextSibling($child)}
      if($null -eq $child){throw 'element_changed'};$element=$child
    }
    $entry=Entry $element $selector.id $true
    if($entry.protected -or -not $entry.enabled -or $entry.role -cne $selector.role -or $entry.name -cne $selector.name -or ($selector.PSObject.Properties.Name -contains 'value' -and $entry.value -cne $selector.value)){throw 'element_changed'}
    return @{element=$element;entry=$entry}
  }
  if($r.action){
    foreach($guard in $r.guards){$null=Resolve-Element $guard}
    $target=Resolve-Element $r.element
    if($target.entry.actions -notcontains $r.action){throw 'action_unavailable'}
    Check-Interaction
    if($r.action -eq 'fill'){
      if($r.element.PSObject.Properties.Name -notcontains 'value' -or $null -eq $r.text){throw 'draft_guard_required'}
      $pattern=$target.element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
      $pattern.SetValue([string]$r.text)
    }else{($target.element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()}
  }
  $queue=[Collections.Generic.Queue[object]]::new();$queue.Enqueue(@{element=$root;id='0';depth=0})
  $entries=[Collections.Generic.List[object]]::new();$clock=[Diagnostics.Stopwatch]::StartNew();$truncated=$false;$characters=0
  while($queue.Count -gt 0){
    if($entries.Count -ge 500 -or $clock.ElapsedMilliseconds -gt 1500 -or $characters -gt 75000){$truncated=$true;break}
    $next=$queue.Dequeue();$entry=Entry $next.element $next.id;$entries.Add($entry);$characters+=$entry.name.Length+$entry.value.Length
    if(-not $entry.protected -and $next.depth -lt 24){
      $child=$walker.GetFirstChild($next.element);$index=0
      while($null -ne $child){
        if($queue.Count+$entries.Count -ge 500){$truncated=$true;break}
        $queue.Enqueue(@{element=$child;id=($next.id+'.'+$index);depth=($next.depth+1)});$index++;$child=$walker.GetNextSibling($child)
      }
    }elseif($next.depth -ge 24){$truncated=$true}
  }
  Check-Target
  if($r.action){Check-Interaction}
  @{available=$true;truncated=$truncated;elements=@($entries.ToArray())}|ConvertTo-Json -Depth 8 -Compress
}catch{
  $known=@('target_changed','focus_changed','element_changed','action_unavailable','draft_guard_required')
  $code=if($_.Exception.Message -in $known){$_.Exception.Message}else{'accessibility_failed'}
  @{error=$code}|ConvertTo-Json -Compress
}`;
