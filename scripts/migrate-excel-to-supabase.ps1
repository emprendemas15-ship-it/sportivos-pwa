param(
  [string]$ExcelPath = 'C:\Users\victor\Downloads\SPORTIVOS (1) (1).xlsm',
  [string]$SupabaseUrl = $env:VITE_SUPABASE_URL,
  [string]$PublishableKey = $env:VITE_SUPABASE_ANON_KEY,
  [switch]$Preview
)

$ErrorActionPreference = 'Stop'
$tableNames = @('inventario_pt', 'entradas', 'ventas', 'gastos', 'creditos', 'clientes', 'costos_no_producidos')
$sheetToTable = [ordered]@{
  INVENTARIO_PT = 'inventario_pt'
  ENTRADAS = 'entradas'
  VENTAS = 'ventas'
  CREDITOS = 'creditos'
  CLIENTES = 'clientes'
  COSTOS_NO_PRODUCIDOS = 'costos_no_producidos'
}
$calculatedColumns = @{
  ENTRADAS = @('Columna1')
  CREDITOS = @('Columna1')
  CLIENTES = @('Columna1')
  COSTOS_NO_PRODUCIDOS = @('Columna1')
  GASTOS = @('MES')
}

if ((-not $SupabaseUrl -or -not $PublishableKey) -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot '..\frontend\.env.local'))) {
  foreach ($line in Get-Content (Join-Path $PSScriptRoot '..\frontend\.env.local')) {
    if ($line -match '^\s*VITE_SUPABASE_URL\s*=\s*(.*)\s*$') { if (-not $SupabaseUrl) { $SupabaseUrl = $matches[1].Trim('"').Trim("'") } }
    if ($line -match '^\s*VITE_SUPABASE_ANON_KEY\s*=\s*(.*)\s*$') { if (-not $PublishableKey) { $PublishableKey = $matches[1].Trim('"').Trim("'") } }
  }
}
if (-not $SupabaseUrl -or -not $PublishableKey) { throw 'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY.' }
if (-not (Test-Path -LiteralPath $ExcelPath)) { throw "No existe el archivo Excel: $ExcelPath" }

$headers = @{ apikey = $PublishableKey; Authorization = "Bearer $PublishableKey"; Prefer = 'return=minimal' }

function Invoke-Supabase {
  param([ValidateSet('GET', 'POST', 'DELETE')][string]$Method, [string]$Table, $Body)
  $request = @{ Uri = "$($script:SupabaseUrl.TrimEnd('/'))/rest/v1/$Table"; Method = $Method; Headers = $script:headers }
  if ($null -ne $Body) {
    $request.ContentType = 'application/json; charset=utf-8'
    $request.Body = ConvertTo-Json -InputObject @($Body) -Depth 20 -Compress
  }
  try { return Invoke-RestMethod @request }
  catch {
    $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    throw "Supabase $Method $Table falló: $detail"
  }
}

function Convert-ExcelValue {
  param($Value, [string]$Header)
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
  if ($Header -match '(?i)fecha') {
    if ($Value -is [double] -or $Value -is [decimal] -or $Value -is [int]) { return [DateTime]::FromOADate([double]$Value).ToString('yyyy-MM-dd') }
    foreach ($format in @('dd/MM/yyyy', 'd/M/yyyy', 'yyyy-MM-dd')) {
      try { return [DateTime]::ParseExact([string]$Value, $format, [Globalization.CultureInfo]::InvariantCulture).ToString('yyyy-MM-dd') } catch { }
    }
    return $null
  }
  return $Value
}

function Get-ListObjectRows {
  param($ListObject, [string[]]$DropColumns = @())
  $columnNames = @()
  for ($column = 1; $column -le $ListObject.ListColumns.Count; $column++) { $columnNames += [string]$ListObject.ListColumns.Item($column).Name }
  if (-not $ListObject.DataBodyRange) { return @() }
  $values = $ListObject.DataBodyRange.Value2
  $result = @()
  $lastDate = $null
  for ($rowIndex = 1; $rowIndex -le $ListObject.DataBodyRange.Rows.Count; $rowIndex++) {
    $row = [ordered]@{}
    $hasValue = $false
    for ($column = 1; $column -le $columnNames.Count; $column++) {
      $name = $columnNames[$column - 1]
      $value = Convert-ExcelValue $values[$rowIndex, $column] $name
      if ($name -match '(?i)^FECHA$' -and $null -eq $value -and $null -ne $lastDate) { $value = $lastDate }
      if ($name -match '(?i)^FECHA$' -and $null -ne $value) { $lastDate = $value }
      if ($null -ne $value) { $hasValue = $true }
      if ($name -notin $DropColumns) { $row[$name] = $value }
    }
    if ($hasValue) { $result += [pscustomobject]$row }
  }
  return $result
}

function Get-RangeRows {
  param($Worksheet, [string[]]$DropColumns = @())
  $range = $Worksheet.UsedRange
  $values = $range.Value2
  $columnNames = @()
  for ($column = 1; $column -le $range.Columns.Count; $column++) { $columnNames += [string]$values[1, $column] }
  $result = @()
  for ($rowIndex = 2; $rowIndex -le $range.Rows.Count; $rowIndex++) {
    $row = [ordered]@{}
    $hasValue = $false
    for ($column = 1; $column -le $columnNames.Count; $column++) {
      $name = $columnNames[$column - 1]
      if (-not $name) { continue }
      $value = Convert-ExcelValue $values[$rowIndex, $column] $name
      if ($null -ne $value) { $hasValue = $true }
      if ($name -notin $DropColumns) { $row[$name] = $value }
    }
    if ($hasValue) { $result += [pscustomobject]$row }
  }
  return $result
}

function Insert-Rows {
  param([string]$Table, [array]$Rows)
  for ($start = 0; $start -lt $Rows.Count; $start += 50) {
    $end = [Math]::Min($start + 49, $Rows.Count - 1)
    $batch = @($Rows[$start..$end])
    Invoke-Supabase -Method POST -Table $Table -Body $batch | Out-Null
  }
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$workbook = $null
$sourceRows = @{}
try {
  $workbook = $excel.Workbooks.Open($ExcelPath, $null, $true)
  foreach ($sheetName in $sheetToTable.Keys) {
    $sheet = $workbook.Worksheets.Item($sheetName)
    if ($sheet.Visible -ne -1) { throw "La hoja $sheetName no está visible; se canceló la importación." }
    $table = $sheet.ListObjects.Item(1)
    $drop = $calculatedColumns[$sheetName]
    $rawRows = Get-ListObjectRows -ListObject $table -DropColumns $drop
    $rowList = New-Object 'System.Collections.Generic.List[object]'
    foreach ($item in $rawRows) {
      if ($item -is [array]) { foreach ($nested in $item) { $rowList.Add($nested) } }
      else { $rowList.Add($item) }
    }
    $sourceRows[$sheetToTable[$sheetName]] = $rowList.ToArray()
  }
  $expenseSheet = $workbook.Worksheets.Item('GASTOS')
  if ($expenseSheet.Visible -ne -1) { throw 'La hoja GASTOS no está visible; se canceló la importación.' }
  $rawExpenses = Get-RangeRows -Worksheet $expenseSheet -DropColumns $calculatedColumns.GASTOS
  $expenseRows = New-Object 'System.Collections.Generic.List[object]'
  foreach ($item in $rawExpenses) {
    if ($item -is [array]) { foreach ($nested in $item) { $expenseRows.Add($nested) } }
    else { $expenseRows.Add($item) }
  }
  $sourceRows['gastos'] = $expenseRows.ToArray()
}
finally {
  if ($workbook) { $workbook.Close($false) }
  $excel.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
}

$backups = @{}
$schemaColumns = @{}
foreach ($table in $tableNames) {
  $remoteRows = Invoke-Supabase -Method GET -Table "${table}?select=*" -Body $null
  $backupRows = New-Object 'System.Collections.Generic.List[object]'
  foreach ($item in $remoteRows) {
    if ($item -is [array]) { foreach ($nested in $item) { $backupRows.Add($nested) } }
    else { $backupRows.Add($item) }
  }
  $backups[$table] = $backupRows.ToArray()
  if ($backups[$table].Count -eq 0) { throw "No se pudo validar el esquema de $table porque la tabla remota está vacía." }
  $schemaColumns[$table] = @($backups[$table][0].PSObject.Properties.Name)
  $allowedColumns = @{}
  foreach ($columnName in $schemaColumns[$table]) { $allowedColumns[[string]$columnName] = $true }
  foreach ($row in $sourceRows[$table]) {
    $unknown = @($row.PSObject.Properties.Name | Where-Object { -not $allowedColumns.ContainsKey([string]$_) })
    if ($unknown.Count -gt 0) { throw "La importación se canceló antes de borrar datos: $table no acepta las columnas $($unknown -join ', ')." }
  }
}

Write-Output 'Preflight Sportivos: filas Excel frente a filas remotas'
foreach ($table in $tableNames) { Write-Output ("  {0}: Excel={1}; remoto actual={2}" -f $table, $sourceRows[$table].Count, $backups[$table].Count) }
if ($Preview) { Write-Output 'Vista previa únicamente; no se modificó ninguna tabla.'; exit 0 }

$writeStarted = $false
try {
  $writeStarted = $true
  foreach ($table in $tableNames) { Invoke-Supabase -Method DELETE -Table "${table}?id=gte.0" -Body $null | Out-Null }
  foreach ($table in $tableNames) { Insert-Rows -Table $table -Rows $sourceRows[$table] }
  Write-Output 'Importación de las hojas visibles completada.'
  foreach ($table in $tableNames) { Write-Output ("  {0}: {1} registros" -f $table, $sourceRows[$table].Count) }
}
catch {
  $migrationError = $_.Exception.Message
  if ($writeStarted) {
    Write-Output 'Falló la importación; restaurando las tablas remotas anteriores.'
    try {
      foreach ($table in $tableNames) { Invoke-Supabase -Method DELETE -Table "${table}?id=gte.0" -Body $null | Out-Null }
      foreach ($table in $tableNames) { Insert-Rows -Table $table -Rows $backups[$table] }
    }
    catch { throw "Error de migración y restauración: $($_.Exception.Message)" }
    throw "Se revirtió la migración. Error original: $migrationError"
  }
  throw
}
