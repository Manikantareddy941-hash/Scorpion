# SCORPION: AI-Powered DevSecOps Orchestration

SCORPION is a production-grade security orchestration platform that automates vulnerability detection and AI-assisted remediation across the entire SDLC.

## 🚀 Key Features

### 🛡️ GitHub CI/CD Security Gate
Automatically enforce security policies on every Pull Request. SCORPION acts as a GitHub App that scans PR branches and sets commit statuses (✅ Success / ❌ Failure), physically blocking merges if critical vulnerabilities or secrets are detected.

### 🔌 VS Code Security Extension
Bring security intelligence directly into the IDE.
- **Inline Squiggles**: Real-time vulnerability highlighting in the editor.
- **AI-Powered Diff Fix**: Review side-by-side AI-generated patches and apply them with one click.
- **Security Sidebar**: Dedicated view to navigate and manage workspace findings.

### 🧠 AI Remediation Engine
Leveraging **Google Gemini AI**, SCORPION doesn't just find bugs—it understands them. It generates context-aware patches for SAST (Semgrep), SCA (Trivy), and Secrets (Gitleaks) findings.

### 📊 DevSecOps Command Center
A high-fidelity dashboard powered by **Appwrite Realtime** featuring:
- **Security Pulse**: Radar charts mapping threat vectors.
- **Scan Registry**: Full audit trail of CI, IDE, Manual, and Scheduled scans.
- **CI Gate Pass Rate**: Analytics on pipeline security integrity.

## 🏗️ Architecture

- **Frontend**: React (Vite), Tailwind CSS, Recharts.
- **Backend**: Node.js, Express, Octokit (GitHub App), node-appwrite.
- **Realtime/DB**: Appwrite Cloud.
- **Security Toolchain**: Trivy, Semgrep, Gitleaks.
- **AI**: Google Gemini Pro.

## 🛠️ Getting Started

### Backend Setup
1. `cd backend`
2. `npm install`
3. Configure `backend/.env` with your Appwrite and GitHub App credentials.
4. `npm run dev`

### Frontend Setup
1. `npm install`
2. `npm run dev`

### IDE Extension
1. `cd scorpion-vscode`
2. `npm install`
3. Open in VS Code and press **F5** to run.

---
*Built for modern DevSecOps teams who want to move fast without breaking security.*
