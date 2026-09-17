# Agent Skill: Project XiaoChun Desktop Companion (`project_xiaochun`)

This document defines a standard **Agent Skill** for autonomous AI coding assistants and automation agents (e.g., Claude Code, OpenClaw, AutoGPT, LangChain agents). By consuming this skill, an agent can detect, launch, and control Project XiaoChun to vocalize progress, deliver status alerts, and act as an interactive avatar companion on the user's desktop.

---

## 1. Skill Metadata

- **Name**: `project_xiaochun_companion`
- **Description**: Awaken and command Project XiaoChun (the desktop anime AI companion) to vocalize speech, trigger full-body gestures, display head-bubble dialogues, and focus the desktop window.
- **Official Website**: [https://xiaochun.firetable.tech](https://xiaochun.firetable.tech)
- **Repository & Downloads**: [https://github.com/FireTable/Project-XiaoChun](https://github.com/FireTable/Project-XiaoChun)
- **Releases**: [https://github.com/FireTable/Project-XiaoChun/releases](https://github.com/FireTable/Project-XiaoChun/releases)

---

## 2. Detection: How an Agent Checks if XiaoChun is Installed

Before issuing commands, an agent can verify installation by checking OS standard application locations or URL scheme availability:

### 2.1 macOS
```bash
# Check if registered in macOS Applications
ls /Applications/Project-XiaoChun.app >/dev/null 2>&1 || ls /Applications/XiaoChun.app >/dev/null 2>&1

# Check if URL Scheme 'xiaochun' is claimed by LaunchServices
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -dump | grep -i "xiaochun:"
```

### 2.2 Windows
```powershell
# Check Windows Registry for URL Protocol registration
Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\xiaochun" -ErrorAction SilentlyContinue
```

### 2.3 Inside the Local Repository
If the agent is executing within the cloned workspace:
```bash
# Check if local debug or release binary exists
test -f "src-tauri/target/debug/project-xiaochun" || test -f "src-tauri/target/release/project-xiaochun"
```

---

## 3. Invocation Strategy for Agents

When an agent wants XiaoChun to vocalize an update:

1. **Short Message (< 1,000 characters)**:
   - Construct a `xiaochun://speak?text=<url_encoded_text>` URL.
   - Execute the native system launch command.
   - **macOS**: `open "xiaochun://speak?text=..."`
   - **Windows**: `cmd /c start "" "xiaochun://speak?text=..."`
   - **Linux**: `xdg-open "xiaochun://speak?text=..."`
   - **Inside Repo**: `pnpm speak "Message here"`

2. **Long Message (> 1,000 characters)**:
   - Write the long dialogue or report into a temporary file: `/tmp/xiaochun_speech.txt`.
   - Invoke via file path parameter:
     ```bash
     open "xiaochun://speak?file=/tmp/xiaochun_speech.txt"
     ```

---

## 4. Agent Function Calling (Tool Schema Definition)

For agents supporting OpenAI / Anthropic Function Calling or MCP (Model Context Protocol), define the tool using the following JSON schema:

```json
{
  "name": "xiaochun_speak",
  "description": "Trigger Project XiaoChun on the user's desktop to speak a message out loud with full 3D body motion, lip-syncing, and dialog bubbles.",
  "parameters": {
    "type": "object",
    "properties": {
      "message": {
        "type": "string",
        "description": "The dialogue or announcement for XiaoChun to speak. Keep sentences expressive and natural."
      }
    },
    "required": ["message"]
  }
}
```

### Reference Implementation for Agents (TypeScript / Node.js)
```typescript
import { exec } from 'child_process';

export async function xiaochunSpeak(message: string): Promise<void> {
  const encoded = encodeURIComponent(message);
  const url = `xiaochun://speak?text=${encoded}`;

  let cmd = '';
  switch (process.platform) {
    case 'darwin':
      cmd = `open "${url}"`;
      break;
    case 'win32':
      cmd = `start "" "${url}"`;
      break;
    default:
      cmd = `xdg-open "${url}"`;
      break;
  }

  return new Promise((resolve, reject) => {
    exec(cmd, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
```

---

## 5. Typical Agent Scenarios

- **Task Completion Notification**:
  `xiaochunSpeak("Master! All unit tests have passed and the build succeeded.")`
- **Error / Attention Alert**:
  `xiaochunSpeak("Master, git merge conflict detected in file index.tsx!")`
- **Break Reminder**:
  `xiaochunSpeak("Master, you have been coding for two hours straight. Time to stretch and grab some water!")`
