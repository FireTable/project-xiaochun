#!/usr/bin/env bash
# ==============================================================================
# Project XiaoChun - Cross-Platform One-Line Installer
# Supported OS: macOS (Apple Silicon & Intel), Linux (x86_64/arm64), Windows (Bash/MSYS/WSL)
# ==============================================================================
set -euo pipefail

REPO="FireTable/project-xiaochun"
APP_NAME="Project XiaoChun"
GITHUB_API="https://api.github.com/repos/${REPO}/releases/latest"

COLOR_BLUE="\033[1;34m"
COLOR_GREEN="\033[1;32m"
COLOR_YELLOW="\033[1;33m"
COLOR_RED="\033[1;31m"
COLOR_RESET="\033[0m"

log_info() { echo -e "${COLOR_BLUE}[INFO]${COLOR_RESET} $1"; }
log_success() { echo -e "${COLOR_GREEN}[SUCCESS]${COLOR_RESET} $1"; }
log_warn() { echo -e "${COLOR_YELLOW}[WARN]${COLOR_RESET} $1"; }
log_err() { echo -e "${COLOR_RED}[ERROR]${COLOR_RESET} $1" >&2; }

OS_TYPE="$(uname -s)"
ARCH_TYPE="$(uname -m)"

log_info "Detecting platform: OS=${OS_TYPE}, Arch=${ARCH_TYPE}"

# 1. Fetch latest release assets from GitHub API
log_info "Querying latest release information from GitHub..."
RELEASE_DATA="$(curl -fsSL "${GITHUB_API}" 2>/dev/null || true)"

if [ -z "${RELEASE_DATA}" ]; then
  # Fallback to redirect location if API is rate-limited
  LATEST_TAG="$(curl -fsSI "https://github.com/${REPO}/releases/latest" | grep -i "^location:" | sed -E 's/.*tag\/(.*)/\1/' | tr -d '\r\n')"
  if [ -z "${LATEST_TAG}" ]; then
    log_err "Failed to resolve latest release tag. Please visit https://github.com/${REPO}/releases manually."
    exit 1
  fi
  RELEASE_TAG="${LATEST_TAG}"
  DOWNLOAD_BASE="https://github.com/${REPO}/releases/download/${RELEASE_TAG}"
else
  RELEASE_TAG="$(echo "${RELEASE_DATA}" | grep '"tag_name":' | head -n 1 | sed -E 's/.*"tag_name": "([^"]+)".*/\1/')"
  DOWNLOAD_BASE="https://github.com/${REPO}/releases/download/${RELEASE_TAG}"
fi

log_info "Target release version: ${RELEASE_TAG}"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

# 2. Platform-specific installer logic
case "${OS_TYPE}" in
  Darwin*)
    # macOS
    TARGET_DMG=""
    if [ "${ARCH_TYPE}" = "arm64" ]; then
      TARGET_PATTERN="aarch64.*\.dmg"
    else
      TARGET_PATTERN="x86_64.*\.dmg"
    fi

    # Find DMG URL
    if [ -n "${RELEASE_DATA}" ]; then
      DMG_URL="$(echo "${RELEASE_DATA}" | grep -o 'https://[^"]*\.dmg' | grep -E "${TARGET_PATTERN}" | head -n 1 || true)"
    else
      DMG_URL=""
    fi

    if [ -z "${DMG_URL}" ]; then
      # Construct fallback name
      CLEAN_VER="${RELEASE_TAG#v}"
      if [ "${ARCH_TYPE}" = "arm64" ]; then
        DMG_URL="${DOWNLOAD_BASE}/Project_XiaoChun_${CLEAN_VER}_aarch64.dmg"
      else
        DMG_URL="${DOWNLOAD_BASE}/Project_XiaoChun_${CLEAN_VER}_x64.dmg"
      fi
    fi

    log_info "Downloading macOS DMG from: ${DMG_URL}"
    DMG_PATH="${TMP_DIR}/XiaoChun.dmg"
    curl -fL --progress-bar "${DMG_URL}" -o "${DMG_PATH}"

    log_info "Mounting disk image..."
    MOUNT_POINT="$(hdiutil attach "${DMG_PATH}" -nobrowse -readonly | grep -E '/Volumes/' | awk -F'\t' '{print $NF}' | head -n 1)"

    if [ -z "${MOUNT_POINT}" ] || [ ! -d "${MOUNT_POINT}" ]; then
      log_err "Failed to mount disk image: ${DMG_PATH}"
      exit 1
    fi

    APP_BUNDLE="$(find "${MOUNT_POINT}" -maxdepth 2 -name "*.app" | head -n 1)"
    if [ -z "${APP_BUNDLE}" ]; then
      log_err "No .app bundle found inside mounted image."
      hdiutil detach "${MOUNT_POINT}" -quiet || true
      exit 1
    fi

    DEST_APP="/Applications/${APP_NAME}.app"
    log_info "Installing to ${DEST_APP}..."
    rm -rf "${DEST_APP}"
    cp -R "${APP_BUNDLE}" "${DEST_APP}"

    hdiutil detach "${MOUNT_POINT}" -quiet || true

    log_info "Removing macOS Gatekeeper quarantine flags..."
    xattr -cr "${DEST_APP}" || true

    log_success "🎉 ${APP_NAME} installed successfully to /Applications!"
    log_info "You can now launch it via Spotlight, Launchpad, or command: open -a \"${APP_NAME}\""
    ;;

  Linux*)
    # Linux
    if command -v dpkg >/dev/null 2>&1; then
      # Try installing .deb
      DEB_PATTERN="amd64.*\.deb"
      if [ -n "${RELEASE_DATA}" ]; then
        DEB_URL="$(echo "${RELEASE_DATA}" | grep -o 'https://[^"]*\.deb' | grep -E "${DEB_PATTERN}" | head -n 1 || true)"
      else
        DEB_URL=""
      fi

      if [ -n "${DEB_URL}" ]; then
        log_info "Downloading Debian package (.deb)..."
        DEB_PATH="${TMP_DIR}/xiaochun.deb"
        curl -fL --progress-bar "${DEB_URL}" -o "${DEB_PATH}"
        log_info "Installing package (requires sudo privileges)..."
        sudo dpkg -i "${DEB_PATH}" || sudo apt-get install -f -y
        log_success "🎉 ${APP_NAME} installed successfully via dpkg!"
        exit 0
      fi
    fi

    # Fallback to AppImage
    APPIMAGE_PATTERN="\.AppImage$"
    if [ -n "${RELEASE_DATA}" ]; then
      APPIMAGE_URL="$(echo "${RELEASE_DATA}" | grep -o 'https://[^"]*\.AppImage' | head -n 1 || true)"
    else
      APPIMAGE_URL=""
    fi

    if [ -n "${APPIMAGE_URL}" ]; then
      log_info "Downloading AppImage..."
      INSTALL_BIN="${HOME}/.local/bin"
      mkdir -p "${INSTALL_BIN}"
      APPIMAGE_FILE="${INSTALL_BIN}/project-xiaochun"
      curl -fL --progress-bar "${APPIMAGE_URL}" -o "${APPIMAGE_FILE}"
      chmod +x "${APPIMAGE_FILE}"
      log_success "🎉 ${APP_NAME} installed to ${APPIMAGE_FILE}"
      log_info "Ensure ~/.local/bin is in your PATH."
      exit 0
    fi

    log_err "No compatible Linux installer (.deb / .AppImage) found for release ${RELEASE_TAG}."
    exit 1
    ;;

  MINGW*|MSYS*|CYGWIN*)
    # Windows under Git Bash / MSYS
    MSI_URL="$(echo "${RELEASE_DATA:-}" | grep -o 'https://[^"]*x64[^"]*\.msi' | head -n 1 || true)"
    EXE_URL="$(echo "${RELEASE_DATA:-}" | grep -o 'https://[^"]*setup\.exe' | head -n 1 || true)"

    INSTALLER_URL="${MSI_URL:-$EXE_URL}"
    if [ -z "${INSTALLER_URL}" ]; then
      log_err "No Windows installer (.msi or .exe) found in release ${RELEASE_TAG}."
      exit 1
    fi

    log_info "Downloading Windows installer: ${INSTALLER_URL}"
    INSTALLER_FILE="${TMP_DIR}/XiaoChunInstaller.msi"
    curl -fL --progress-bar "${INSTALLER_URL}" -o "${INSTALLER_FILE}"

    log_info "Launching installer..."
    cmd.exe /c start "" "$(cygpath -w "${INSTALLER_FILE}")"
    log_success "Windows installer launched!"
    ;;

  *)
    log_err "Unsupported operating system: ${OS_TYPE}."
    log_info "Please download your platform's installer manually from: https://github.com/${REPO}/releases"
    exit 1
    ;;
esac
