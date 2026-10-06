cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.19"
  sha256 arm:   "d0853e4f1c13faf60b451f0e9f98c76e8327cfc5e8ba955f8724a237c8dc7a52",
         intel: "58f382cbd9835e86f13379f85fc733afd7a674102ca962b1a26a1bbfe2d813a6"

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
