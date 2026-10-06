cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.21"
  sha256 arm:   "64b34347f29854a821bc562da3ff44e9ea3c2260bead183c6dcce272e0cab38c",
         intel: "0645d3e7f412b313df7ce01337edabe87ba457ec20dcbd8721a6a30b6b1cef97"

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
