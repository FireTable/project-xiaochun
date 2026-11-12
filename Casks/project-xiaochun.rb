cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.15"
  sha256 arm:   "4880c00496d0adc8f67fab0b31cee8bee5f39bb5800ca511ac943a8b0ce57eab",
         intel: "f1ce4e26a06a56627388e10844f9ad353f0ddf7d1e449623fe4c063ceb3a0551"

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
