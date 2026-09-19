cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.6"
  sha256 arm:   "3f812db1a7a930c83d2d72304ad7fb27b7ce12b49134dddf9502fb07b6cd0fbb",
         intel: "ea48ef4e5e9786b7e00d08746db3b3484830d4b6121d5d4d494f6576d56d0212"

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
