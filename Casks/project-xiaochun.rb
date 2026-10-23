cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.38"
  sha256 arm:   "a306e244de8cced8626d13e9e2cefa9e55a331bbff3274abb2748d047abcd2d8",
         intel: "20f21a408c8c172980c61a9ff384398bd14adb531e01b94655441bd16d201316"

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
