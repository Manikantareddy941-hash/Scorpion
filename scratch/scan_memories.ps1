$chatsPath = "C:\Users\manik\.gemini\tmp\scorpion\chats"
$keywords = @("my name is", "i work as", "i am a", "my age", "i live in", "i prefer", "always", "never", "my role", "my project", "i built", "i work at", "do not", "my skill")

$results = @()
Get-ChildItem -Path $chatsPath -Filter *.jsonl -ErrorAction SilentlyContinue | ForEach-Object {
    $file = $_.FullName
    $lines = Get-Content -Path $file -ErrorAction SilentlyContinue
    foreach ($line in $lines) {
        if ($line -match '"type":"USER_INPUT"') {
            foreach ($kw in $keywords) {
                if ($line -match "(?i)\b$kw\b") {
                    # Try to extract the content
                    if ($line -match '"content":"([^"]+)"') {
                        $content = $matches[1]
                        $results += "[file: $($_.Name)] $content"
                        break
                    }
                }
            }
        }
    }
}
$results | Out-File "c:\Users\manik\OneDrive\Desktop\Scorpion\scratch\extracted_memories.txt"
