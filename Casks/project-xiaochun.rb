cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.2"
  sha256 arm:   "747128e98975546a0b8d0c378a6ecd65892794dd63796c193ccd4aad9bfdb944",
         intel: "c6f3e0ed458f8c5045690fdf3dfd065d6fde22dd1ef01ff6a3ff00f0b442528a"

  url "https://github.com/FireTable/project-xiaochun/releases/download/v#{version}/Project.XiaoChun_#{version}_#{arch}.dmg"
  name "Project XiaoChun"
  desc "100% Client-Native Anime Companion & Transparent Desktop Pet"
  homepage "https://github.com/FireTable/project-xiaochun"

  depends_on :macos

  app "Project XiaoChun.app"

  postflight_steps do
    run "/usr/bin/xattr", args: ["-cr", "/Applications/Project XiaoChun.app"]
  end

  zap trash: [
    "~/Library/Application Support/tech.firetable.xiaochun",
    "~/Library/Preferences/tech.firetable.xiaochun.plist",
    "~/Library/Saved Application State/tech.firetable.xiaochun.savedState",
  ]
end
