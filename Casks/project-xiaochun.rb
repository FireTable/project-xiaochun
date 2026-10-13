cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.30"
  sha256 arm:   "0c7d56963d81754722ea20e74f9e8799bcbe108d45aac729e660fe7a93e6987e",
         intel: "68d19899fd5d48208085cd09faef32c5df5f13b2d85633176f07f5c84eab2489"

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
