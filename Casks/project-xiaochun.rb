cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.20"
  sha256 arm:   "349d9a2a98e128fd4f8e8ac9e6cdce62646c2084952586ec9ab07fbb49dcc650",
         intel: "17dfc5687fa9f116c967cb2640dd22da0c7cf732b02a5c84207c31a617f4c057"

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
