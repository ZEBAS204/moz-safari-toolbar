<# Check this:
https://github.com/MrOtherGuy/fx-autoconfig
#>

# HKLM: shortcut of Registry::HKEY_LOCAL_MACHINE\
$basePath = "HKLM:SOFTWARE\Mozilla"

# Get all registry keys under the base path
$keys = Get-ChildItem -Path $basePath -Recurse

# Initialize an array to hold results
$results = @()

# Loop through each key and check for the desired value names
foreach ($key in $keys) {
  try {
      # Check if the values exist
      $installDir = Get-ItemProperty -Path $key.PSPath -Name "Install Directory" -ErrorAction SilentlyContinue
      $pathToExe = Get-ItemProperty -Path $key.PSPath -Name "PathToExe" -ErrorAction SilentlyContinue

      # Add results to the array if values are found
      if ($installDir -or $pathToExe) {
          $result = @{
              KeyPath = $key.PSPath
              InstallDirectory = $installDir.'Install Directory'
              PathToExe = $pathToExe.'PathToExe'
          }
          $results += $result
      }
  } catch {
      # Handle errors (if needed)
      Write-Host "Error accessing $($key.PSPath): $_"
  }
}

# Filter results to include only those containing "firefox"
$results = $results | Where-Object {
    $_.InstallDirectory -like '*firefox*' -or $_.PathToExe -like '*firefox*'
}

# Output results
$results | Format-Table -AutoSize


exit
